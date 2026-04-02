/**
 * QueryEngine — Core conversation loop for Office Agent.
 *
 * Supports two modes:
 * 1. Native function calling (queryWithTools) — reliable, structured tool calls
 * 2. Prompt-based fallback (query/queryStream) — for LLMs without native tool support
 */
import { randomUUID } from 'node:crypto';
import { zodToJsonSchema as zodConvert } from 'zod-to-json-schema';
import type { Message, StreamEvent } from '../types/index.js';
import type { LLMClient, LLMMessage, LLMToolDef } from './llm-client.js';
import type { MemorySystem } from './memory-system.js';
import type { ContextManager, ToolDefinition } from './context-manager.js';
import type { ToolRegistry } from './tool-system.js';

import type { SessionStore } from './session-store.js';

export interface QueryEngineConfig {
  model: string;
  systemPrompt: string;
  tools: ToolRegistry;
  memorySystem: MemorySystem;
  contextManager: ContextManager;
  llm: LLMClient;
  maxToolRounds?: number;
  sessionStore?: SessionStore;
}

export class QueryEngine {
  private config: QueryEngineConfig;
  private messages: Message[] = [];
  private sessionId: string;
  private abortController: AbortController | null = null;
  private maxToolRounds: number;
  private sessionStore: SessionStore | undefined;

  constructor(config: QueryEngineConfig) {
    this.config = config;
    this.sessionId = randomUUID();
    this.maxToolRounds = config.maxToolRounds ?? 10;
    this.sessionStore = config.sessionStore;
  }

  /** 从磁盘恢复上一次会话 */
  restoreLastSession(): boolean {
    if (!this.sessionStore) return false;
    const lastId = this.sessionStore.getLastSessionId();
    if (!lastId) return false;
    const msgs = this.sessionStore.load(lastId);
    if (msgs.length === 0) return false;
    this.messages = msgs;
    this.sessionId = lastId;
    return true;
  }

  /** 保存当前会话到磁盘 */
  private saveSession(): void {
    if (this.sessionStore && this.messages.length > 0) {
      this.sessionStore.save(this.sessionId, this.messages);
    }
  }

  async *submitMessage(userMessage: string): AsyncGenerator<StreamEvent> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.messages.push({ role: 'user', content: userMessage, timestamp: new Date() });

    try {
      // Retrieve relevant memories
      const memories = await this.config.memorySystem.findRelevantMemories(userMessage, signal);

      // Build memory context string
      const memoryBlock = memories.length > 0
        ? '\n\n## 相关记忆\n' + memories.map(m => `[${m.type}] ${m.title}: ${m.content}`).join('\n')
        : '';

      const systemPrompt = this.config.systemPrompt + memoryBlock;

      // Choose execution path
      if (this.config.llm.queryWithTools) {
        yield* this.executeWithNativeTools(systemPrompt, signal);
      } else if (this.config.llm.queryStream) {
        yield* this.executeWithStream(systemPrompt, signal);
      } else {
        yield* this.executeBasic(systemPrompt, signal);
      }

      // Auto memory extraction (fire-and-forget, but log errors)
      this.config.memorySystem.extractAndStoreFromConversation(this.messages).catch((err) => {
        console.error('[MemoryExtraction] 自动记忆提取失败:', err instanceof Error ? err.message : err);
      });

      // 持久化会话
      this.saveSession();

      yield { type: 'done' };
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.abortController = null;
    }
  }

  // ============================================================
  // Path 1: Native function calling (reliable)
  // ============================================================

  private async *executeWithNativeTools(
    systemPrompt: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    // Build tool definitions in OpenAI format
    const toolDefs: LLMToolDef[] = this.config.tools.listEnabled().map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema ? this.zodToJsonSchema(t.inputSchema) : {},
      },
    }));

    // Check if auto-compact is needed before building messages
    const estimatedTokens = this.messages.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4), 0,
    );
    if (this.config.contextManager.shouldAutoCompact(estimatedTokens)) {
      const compactResult = await this.config.contextManager.compact(
        this.messages,
        this.config.memorySystem,
      );
      this.messages = [...compactResult.compressedMessages];
    }

    // Build message history in LLM format
    let llmMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.messages.map(m => this.toLLMMessage(m)),
    ];

    let rounds = 0;

    while (rounds < this.maxToolRounds) {
      if (signal.aborted) { yield { type: 'error', error: 'Request interrupted' }; return; }
      rounds++;

      const result = await this.config.llm.queryWithTools!(llmMessages, toolDefs, signal);

      // LLM returned tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        // Add assistant message with tool_calls to history
        llmMessages.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.toolCalls,
        });

        for (const tc of result.toolCalls) {
          let parsedInput: unknown;
          try { parsedInput = JSON.parse(tc.function.arguments); } catch { parsedInput = {}; }

          yield { type: 'tool_use', toolName: tc.function.name, input: parsedInput };

          const toolResult = await this.config.tools.execute(
            tc.function.name,
            parsedInput,
            { abortSignal: signal, userConfig: {} as never },
          );

          yield { type: 'tool_result', toolName: tc.function.name, result: toolResult };

          // Add tool result to message history
          llmMessages.push({
            role: 'tool',
            content: JSON.stringify(toolResult.output),
            tool_call_id: tc.id,
            name: tc.function.name,
          });

          // Also record in our internal messages
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(toolResult),
            toolName: tc.function.name,
            timestamp: new Date(),
          });
        }

        continue; // Next round — LLM sees tool results
      }

      // LLM returned text (no tool calls) — final response
      const content = result.content ?? '';
      if (content) {
        yield { type: 'text', content };
        this.messages.push({ role: 'assistant', content, timestamp: new Date() });
      }
      break;
    }
  }

  // ============================================================
  // Path 2: Streaming (no native tools, prompt-based)
  // ============================================================

  private async *executeWithStream(
    systemPrompt: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const userPrompt = this.messages.map(m => `[${m.role}] ${m.content}`).join('\n');
    const chunks: string[] = [];

    for await (const chunk of this.config.llm.queryStream!(systemPrompt, userPrompt, signal)) {
      chunks.push(chunk);
      yield { type: 'text', content: chunk };
    }

    const fullResponse = chunks.join('');
    if (fullResponse) {
      this.messages.push({ role: 'assistant', content: fullResponse, timestamp: new Date() });
    }
  }

  // ============================================================
  // Path 3: Basic non-streaming (no native tools)
  // ============================================================

  private async *executeBasic(
    systemPrompt: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const userPrompt = this.messages.map(m => `[${m.role}] ${m.content}`).join('\n');
    const response = await this.config.llm.query(systemPrompt, userPrompt, signal);

    if (response) {
      yield { type: 'text', content: response };
      this.messages.push({ role: 'assistant', content: response, timestamp: new Date() });
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private toLLMMessage(msg: Message): LLMMessage {
    return {
      role: msg.role === 'tool' ? 'tool' : msg.role as 'user' | 'assistant',
      content: msg.content,
      ...(msg.toolName && { name: msg.toolName }),
      ...(msg.toolCallId && { tool_call_id: msg.toolCallId }),
    };
  }

  /** Convert a zod schema to JSON Schema for the API. */
  private zodToJsonSchema(schema: unknown): Record<string, unknown> {
    try {
      return zodConvert(schema as Parameters<typeof zodConvert>[0], { target: 'openApi3' }) as Record<string, unknown>;
    } catch {
      return { type: 'object' };
    }
  }

  interrupt(): void { this.abortController?.abort(); }
  getMessages(): readonly Message[] { return this.messages; }
  getSessionId(): string { return this.sessionId; }
}
