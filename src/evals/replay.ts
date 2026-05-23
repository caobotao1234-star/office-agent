import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';

import { ContextManager } from '../core/context-manager.js';
import type { LLMClient, LLMMessage, LLMQueryResult, LLMToolDef } from '../core/llm-client.js';
import { MemorySystem } from '../core/memory-system.js';
import { QueryEngine } from '../core/query-engine.js';
import { ToolRegistry, type Tool } from '../core/tool-system.js';
import { UserConfigManager } from '../core/user-config.js';
import type { StreamEvent, ToolContext, ToolResult } from '../types/index.js';

type ReplayStep =
  | {
      type: 'tool';
      name: string;
      arguments?: Record<string, unknown>;
    }
  | {
      type: 'final';
      content: string;
      expectLastToolResultIncludes?: string[];
    };

interface ReplayTool {
  name: string;
  result: ToolResult;
}

interface ReplayCase {
  name: string;
  userMessage: string;
  steps: ReplayStep[];
  tools: ReplayTool[];
  expectToolNames: string[];
  expectFinalIncludes: string;
}

const REPLAY_CASES: ReplayCase[] = [
  {
    name: 'explicit reminder creates agenda item',
    userMessage: '明天下午 3 点提醒我给客户发方案',
    steps: [
      {
        type: 'tool',
        name: 'AgendaTool',
        arguments: {
          action: 'create',
          type: 'reminder',
          title: '给客户发方案',
          triggerAt: '2026-05-24T15:00:00+08:00',
          priority: 'medium',
        },
      },
      {
        type: 'final',
        content: '已设置提醒：明天下午 3 点给客户发方案。',
        expectLastToolResultIncludes: ['"success":true', 'agenda_1'],
      },
    ],
    tools: [
      {
        name: 'AgendaTool',
        result: { success: true, output: { id: 'agenda_1', title: '给客户发方案' } },
      },
    ],
    expectToolNames: ['AgendaTool'],
    expectFinalIncludes: '已设置提醒',
  },
  {
    name: 'feishu command failure is surfaced',
    userMessage: '读取这个飞书文档：https://example.feishu.cn/docx/xxx',
    steps: [
      {
        type: 'tool',
        name: 'LarkCli',
        arguments: {
          command: 'lark-cli docs +fetch --api-version v2 --doc xxx --doc-format markdown --format json --as user',
        },
      },
      {
        type: 'final',
        content: '读取失败：docs +fetch failed。请先确认文档权限或 CLI 登录状态。',
        expectLastToolResultIncludes: ['"success":false', 'docs +fetch failed'],
      },
    ],
    tools: [
      {
        name: 'LarkCli',
        result: { success: false, output: null, error: 'docs +fetch failed' },
      },
    ],
    expectToolNames: ['LarkCli'],
    expectFinalIncludes: '读取失败',
  },
  {
    name: 'durable project knowledge is captured',
    userMessage: '记一下：张三负责 Apollo 项目前端，周五前要给客户演示。',
    steps: [
      {
        type: 'tool',
        name: 'KnowledgeCaptureTool',
        arguments: {
          source: 'conversation',
          contextItems: [
            {
              type: 'person',
              key: 'person:张三',
              title: '张三',
              summary: '负责 Apollo 项目前端。',
              relations: [{ type: 'responsible_for', targetKey: 'project:apollo', targetTitle: 'Apollo 项目' }],
            },
          ],
          agendaItems: [
            {
              type: 'commitment',
              title: 'Apollo 项目客户演示',
              triggerAt: '2026-05-29T10:00:00+08:00',
              deadlineAt: '2026-05-29T18:00:00+08:00',
              priority: 'high',
            },
          ],
        },
      },
      {
        type: 'final',
        content: '已记入上下文，并创建 Apollo 项目客户演示的跟进提醒。',
        expectLastToolResultIncludes: ['"success":true', 'captured'],
      },
    ],
    tools: [
      {
        name: 'KnowledgeCaptureTool',
        result: { success: true, output: { captured: 2 } },
      },
    ],
    expectToolNames: ['KnowledgeCaptureTool'],
    expectFinalIncludes: '已记入上下文',
  },
];

class ScriptedLLM implements LLMClient {
  private cursor = 0;

  constructor(private readonly steps: ReplayStep[]) {}

  async query(): Promise<string> {
    return '';
  }

  async queryWithTools(
    messages: LLMMessage[],
    _tools: LLMToolDef[],
    _signal: AbortSignal,
  ): Promise<LLMQueryResult> {
    const step = this.steps[this.cursor++];
    if (!step) throw new Error('Replay script ended before QueryEngine finished');

    if (step.type === 'tool') {
      return {
        content: null,
        toolCalls: [
          {
            id: `replay-tool-${this.cursor}`,
            function: {
              name: step.name,
              arguments: JSON.stringify(step.arguments ?? {}),
            },
          },
        ],
      };
    }

    const lastToolMessage = [...messages].reverse().find((message) => message.role === 'tool');
    for (const expected of step.expectLastToolResultIncludes ?? []) {
      assert.ok(
        lastToolMessage?.content?.includes(expected),
        `Expected last tool result to include "${expected}", got: ${lastToolMessage?.content ?? '<none>'}`,
      );
    }

    return { content: step.content, toolCalls: null };
  }
}

function createReplayTool(def: ReplayTool, calls: Array<{ name: string; input: unknown }>): Tool {
  return {
    name: def.name,
    description: `Replay fake tool: ${def.name}`,
    inputSchema: z.object({}).passthrough(),
    isEnabled: () => true,
    isReadOnly: () => false,
    checkPermissions: () => ({ allowed: true }),
    call: async (input: unknown, _context: ToolContext) => {
      calls.push({ name: def.name, input });
      return def.result;
    },
  };
}

async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

async function runCase(testCase: ReplayCase): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-replay-'));
  const calls: Array<{ name: string; input: unknown }> = [];

  try {
    const llm = new ScriptedLLM(testCase.steps);
    const registry = new ToolRegistry();
    for (const tool of testCase.tools) registry.register(createReplayTool(tool, calls));

    const engine = new QueryEngine({
      model: 'replay-script',
      systemPrompt: 'You are a replay-tested office assistant.',
      tools: registry,
      memorySystem: new MemorySystem(path.join(tempDir, 'memdir'), llm),
      contextManager: new ContextManager(128_000, llm),
      llm,
      maxToolRounds: 5,
      getUserConfig: () => UserConfigManager.getDefault(),
    });

    const events = await collectEvents(engine.submitMessage(testCase.userMessage));
    const actualToolNames = events
      .filter((event): event is Extract<StreamEvent, { type: 'tool_use' }> => event.type === 'tool_use')
      .map((event) => event.toolName);
    const finalText = events
      .filter((event): event is Extract<StreamEvent, { type: 'text' }> => event.type === 'text')
      .map((event) => event.content)
      .join('');

    assert.deepEqual(actualToolNames, testCase.expectToolNames);
    assert.deepEqual(calls.map((call) => call.name), testCase.expectToolNames);
    assert.ok(finalText.includes(testCase.expectFinalIncludes), `Final text mismatch: ${finalText}`);
    assert.equal(events.at(-1)?.type, 'done');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function runReplayEval(cases = REPLAY_CASES): Promise<void> {
  const failures: Array<{ name: string; error: unknown }> = [];

  for (const testCase of cases) {
    try {
      await runCase(testCase);
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failures.push({ name: testCase.name, error });
      console.error(`FAIL ${testCase.name}`);
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length}/${cases.length} replay cases failed`);
  }

  console.log(`Replay eval passed: ${cases.length}/${cases.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runReplayEval().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
