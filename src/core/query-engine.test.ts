import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { QueryEngine } from './query-engine.js';
import { ContextManager } from './context-manager.js';
import { MemorySystem } from './memory-system.js';
import { ToolRegistry } from './tool-system.js';
import type { LLMClient } from './llm-client.js';
import type { Tool } from './tool-system.js';
import type { StreamEvent } from '../types/index.js';

// ============================================================
// Helpers
// ============================================================

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
}

function makeLLM(fn: (system: string, user: string) => string): LLMClient {
  return { async query(s, u, _sig) { return fn(s, u); } };
}

/** Collect all events from the async generator */
async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

function createDummyTool(name: string, result: unknown): Tool {
  return {
    name,
    description: `Test tool ${name}`,
    inputSchema: z.object({}).passthrough(),
    isEnabled: () => true,
    isReadOnly: () => true,
    checkPermissions: () => ({ allowed: true }),
    call: async () => ({ success: true, output: result }),
  };
}

function buildEngine(opts: {
  llmFn: (system: string, user: string) => string;
  dir: string;
  tools?: Tool[];
}) {
  const llm = makeLLM(opts.llmFn);
  const memorySystem = new MemorySystem(opts.dir, llm);
  const contextManager = new ContextManager(128_000, llm);
  const toolRegistry = new ToolRegistry();
  for (const t of opts.tools ?? []) toolRegistry.register(t);

  return new QueryEngine({
    model: 'test-model',
    systemPrompt: 'You are a test assistant.',
    tools: toolRegistry,
    memorySystem,
    contextManager,
    llm,
  });
}

// ============================================================
// Tests
// ============================================================

describe('QueryEngine', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('yields text and done events for a simple response', async () => {
    const engine = buildEngine({ llmFn: () => 'Hello!', dir });
    const events = await collectEvents(engine.submitMessage('Hi'));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'text', content: 'Hello!' });
    expect(events[1]).toEqual({ type: 'done' });
  });

  it('records user and assistant messages', async () => {
    const engine = buildEngine({ llmFn: () => 'Response', dir });
    await collectEvents(engine.submitMessage('Question'));

    const msgs = engine.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('user');
    expect(msgs[0]!.content).toBe('Question');
    expect(msgs[1]!.role).toBe('assistant');
    expect(msgs[1]!.content).toBe('Response');
  });

  it('returns a valid session id', () => {
    const engine = buildEngine({ llmFn: () => '', dir });
    expect(engine.getSessionId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('handles tool_use → tool_result → text loop', async () => {
    let callCount = 0;

    // Mock LLM with native queryWithTools
    const llm: LLMClient = {
      async query() { return ''; },
      async queryWithTools(_msgs, _tools, _signal) {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [{ id: 'tc1', function: { name: 'TestTool', arguments: '{"q":"data"}' } }],
          };
        }
        return { content: 'Final answer after tool call', toolCalls: null };
      },
    };

    const tool = createDummyTool('TestTool', { data: 42 });
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(tool);

    const engine = new QueryEngine({
      model: 'test',
      systemPrompt: 'test',
      tools: toolRegistry,
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
    });

    const events = await collectEvents(engine.submitMessage('Use a tool'));

    const types = events.map((e) => e.type);
    expect(types).toContain('tool_use');
    expect(types).toContain('tool_result');
    expect(types).toContain('text');
    expect(types[types.length - 1]).toBe('done');

    const toolUseEv = events.find((e) => e.type === 'tool_use') as Extract<StreamEvent, { type: 'tool_use' }>;
    expect(toolUseEv.toolName).toBe('TestTool');

    const textEv = events.find((e) => e.type === 'text') as Extract<StreamEvent, { type: 'text' }>;
    expect(textEv.content).toBe('Final answer after tool call');
  });

  it('passes runtime tool context into tool calls', async () => {
    let seenProfile: string | undefined;
    let callCount = 0;
    const llm: LLMClient = {
      async query() { return ''; },
      async queryWithTools() {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [{ id: 'tc1', function: { name: 'ContextTool', arguments: '{}' } }],
          };
        }
        return { content: 'done', toolCalls: null };
      },
    };

    const contextTool: Tool = {
      name: 'ContextTool',
      description: 'Captures context',
      inputSchema: z.object({}),
      isEnabled: () => true,
      isReadOnly: () => true,
      checkPermissions: () => ({ allowed: true }),
      call: async (_input, context) => {
        seenProfile = context.larkCliProfile;
        return { success: true, output: 'ok' };
      },
    };
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(contextTool);

    const engine = new QueryEngine({
      model: 'test',
      systemPrompt: 'test',
      tools: toolRegistry,
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
      getToolContext: () => ({ larkCliProfile: 'alice', feishuUserKey: 'app:ou_alice' }),
    });

    await collectEvents(engine.submitMessage('use context'));

    expect(seenProfile).toBe('alice');
  });

  it('sends latest user images as multimodal content parts', async () => {
    let userContent: unknown;
    const llm: LLMClient = {
      capabilities: { vision: true },
      async query() { return ''; },
      async queryWithTools(msgs) {
        userContent = [...msgs].reverse().find((m) => m.role === 'user')?.content;
        return { content: '我看到了图片', toolCalls: null };
      },
    };

    const engine = new QueryEngine({
      model: 'vision-test',
      systemPrompt: 'test',
      tools: new ToolRegistry(),
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
    });

    const events = await collectEvents(engine.submitMessage('看图', ['data:image/png;base64,abc']));
    expect(engine.supportsVision()).toBe(true);
    expect(userContent).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ]);
    const textEv = events.find((e) => e.type === 'text') as Extract<StreamEvent, { type: 'text' }>;
    expect(textEv.content).toBe('我看到了图片');
  });

  it('reports non-vision model capability', () => {
    const engine = buildEngine({
      llmFn: () => 'text only',
      dir,
    });
    expect(engine.supportsVision()).toBe(false);
  });

  it('passes tool errors back to the LLM, not only output', async () => {
    let callCount = 0;
    let toolMessageContent = '';

    const llm: LLMClient = {
      async query() { return ''; },
      async queryWithTools(msgs) {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [{ id: 'tc1', function: { name: 'FailTool', arguments: '{}' } }],
          };
        }

        const lastToolMsg = [...msgs].reverse().find((m) => m.role === 'tool');
        toolMessageContent = typeof lastToolMsg?.content === 'string' ? lastToolMsg.content : '';
        return { content: toolMessageContent.includes('boom') ? '工具失败：boom' : 'missing error', toolCalls: null };
      },
    };

    const failingTool: Tool = {
      name: 'FailTool',
      description: 'Always fails',
      inputSchema: z.object({}),
      isEnabled: () => true,
      isReadOnly: () => true,
      checkPermissions: () => ({ allowed: true }),
      call: async () => ({ success: false, output: null, error: 'boom' }),
    };

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(failingTool);

    const engine = new QueryEngine({
      model: 'test',
      systemPrompt: 'test',
      tools: toolRegistry,
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
    });

    const events = await collectEvents(engine.submitMessage('Use a failing tool'));
    const textEv = events.find((e) => e.type === 'text') as Extract<StreamEvent, { type: 'text' }>;

    expect(toolMessageContent).toContain('"success":false');
    expect(toolMessageContent).toContain('"error":"boom"');
    expect(textEv.content).toBe('工具失败：boom');
  });

  it('replays assistant reasoning content and tool call ids for providers that require it', async () => {
    let callCount = 0;
    let secondRoundAssistant: unknown;
    let secondRoundTool: unknown;

    const llm: LLMClient = {
      async query() { return ''; },
      async queryWithTools(msgs) {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            reasoningContent: 'I need to inspect data before answering.',
            toolCalls: [{ id: 'tc-reason', function: { name: 'ReasonTool', arguments: '{}' } }],
          };
        }

        secondRoundAssistant = msgs.find((m) => m.role === 'assistant' && m.tool_calls?.length);
        secondRoundTool = msgs.find((m) => m.role === 'tool');
        return { content: 'done', toolCalls: null };
      },
    };

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(createDummyTool('ReasonTool', 'ok'));

    const engine = new QueryEngine({
      model: 'test',
      systemPrompt: 'test',
      tools: toolRegistry,
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
    });

    await collectEvents(engine.submitMessage('use reasoned tool'));

    expect(secondRoundAssistant).toMatchObject({
      role: 'assistant',
      reasoning_content: 'I need to inspect data before answering.',
      tool_calls: [{ id: 'tc-reason' }],
    });
    expect(secondRoundTool).toMatchObject({
      role: 'tool',
      tool_call_id: 'tc-reason',
    });
  });

  it('respects maxToolRounds to prevent infinite loops', async () => {
    // LLM always returns tool_calls — should stop after maxToolRounds
    const llm: LLMClient = {
      async query() { return ''; },
      async queryWithTools() {
        return {
          content: null,
          toolCalls: [{ id: 'tc', function: { name: 'Loop', arguments: '{}' } }],
        };
      },
    };

    const tool = createDummyTool('Loop', 'ok');
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(tool);

    const engine = new QueryEngine({
      model: 'test',
      systemPrompt: 'test',
      tools: toolRegistry,
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
      maxToolRounds: 3,
    });

    const events = await collectEvents(engine.submitMessage('loop'));
    const toolUseCount = events.filter((e) => e.type === 'tool_use').length;
    expect(toolUseCount).toBe(3);
    const errorEv = events.find((e) => e.type === 'error') as Extract<StreamEvent, { type: 'error' }>;
    expect(errorEv.error).toContain('工具调用上限');
  });

  it('blocks repeated identical tool calls after the retry limit', async () => {
    let actualToolExecutions = 0;

    const llm: LLMClient = {
      async query() { return ''; },
      async queryWithTools() {
        return {
          content: null,
          toolCalls: [{ id: 'tc', function: { name: 'RepeatTool', arguments: '{"same":true}' } }],
        };
      },
    };

    const repeatedTool: Tool = {
      name: 'RepeatTool',
      description: 'Repeat test',
      inputSchema: z.object({}).passthrough(),
      isEnabled: () => true,
      isReadOnly: () => true,
      checkPermissions: () => ({ allowed: true }),
      call: async () => {
        actualToolExecutions++;
        return { success: true, output: 'ok' };
      },
    };
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(repeatedTool);

    const engine = new QueryEngine({
      model: 'test',
      systemPrompt: 'test',
      tools: toolRegistry,
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
      maxToolRounds: 3,
      maxRepeatedToolCalls: 2,
    });

    const events = await collectEvents(engine.submitMessage('repeat'));
    const repeatedGuardResult = events
      .filter((e): e is Extract<StreamEvent, { type: 'tool_result' }> => e.type === 'tool_result')
      .at(-1)?.result;

    expect(actualToolExecutions).toBe(2);
    expect(repeatedGuardResult?.success).toBe(false);
    expect(repeatedGuardResult?.error).toContain('重复调用');
  });

  it('emits an error when tools ran but the LLM produced no final answer', async () => {
    let callCount = 0;
    const llm: LLMClient = {
      async query() { return ''; },
      async queryWithTools() {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [{ id: 'tc', function: { name: 'WorkTool', arguments: '{}' } }],
          };
        }
        return { content: null, toolCalls: null };
      },
    };

    const tool = createDummyTool('WorkTool', 'ok');
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(tool);

    const engine = new QueryEngine({
      model: 'test',
      systemPrompt: 'test',
      tools: toolRegistry,
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
      maxToolRounds: 5,
    });

    const events = await collectEvents(engine.submitMessage('work'));
    const errorEv = events.find((e) => e.type === 'error') as Extract<StreamEvent, { type: 'error' }>;
    expect(errorEv.error).toContain('任务状态不应视为完成');
  });

  it('sanitizes malformed tool call arguments before sending the next LLM request', async () => {
    let callCount = 0;
    let historicalArguments = '';
    let toolMessageContent = '';

    const llm: LLMClient = {
      async query() { return ''; },
      async queryWithTools(msgs) {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'tc-bad-json',
                function: {
                  name: 'LarkCli',
                  arguments: '{"args":["base","+field-create","--json","{"name":"能力","type":"text"}"]}',
                },
              },
            ],
          };
        }

        const assistantWithToolCall = msgs.find((m) => m.role === 'assistant' && m.tool_calls?.length);
        historicalArguments = assistantWithToolCall?.tool_calls?.[0]?.function.arguments ?? '';
        JSON.parse(historicalArguments);

        const lastToolMsg = [...msgs].reverse().find((m) => m.role === 'tool');
        toolMessageContent = typeof lastToolMsg?.content === 'string' ? lastToolMsg.content : '';
        return { content: '参数错误已上报，等待重试。', toolCalls: null };
      },
    };

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(createDummyTool('LarkCli', 'should not run'));

    const engine = new QueryEngine({
      model: 'test',
      systemPrompt: 'test',
      tools: toolRegistry,
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
    });

    const events = await collectEvents(engine.submitMessage('create field'));
    const textEv = events.find((e) => e.type === 'text') as Extract<StreamEvent, { type: 'text' }>;

    expect(historicalArguments).toBe('{}');
    expect(toolMessageContent).toContain('工具参数不是合法 JSON');
    expect(textEv.content).toBe('参数错误已上报，等待重试。');
  });

  it('yields error event when LLM throws', async () => {
    const llm: LLMClient = {
      async query() { throw new Error('LLM failure'); },
    };
    const engine = new QueryEngine({
      model: 'test',
      systemPrompt: 'test',
      tools: new ToolRegistry(),
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
    });

    const events = await collectEvents(engine.submitMessage('fail'));
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('interrupt() aborts the current request', async () => {
    // LLM that hangs until aborted
    const llm: LLMClient = {
      query: (_s, _u, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    };
    const engine = new QueryEngine({
      model: 'test',
      systemPrompt: 'test',
      tools: new ToolRegistry(),
      memorySystem: new MemorySystem(dir),
      contextManager: new ContextManager(),
      llm,
    });

    const gen = engine.submitMessage('hang');
    // Interrupt after a short delay
    setTimeout(() => engine.interrupt(), 50);

    const events = await collectEvents(gen);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});
