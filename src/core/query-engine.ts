/**
 * QueryEngine — Core conversation loop for Office Agent.
 *
 * Supports two modes:
 * 1. Native function calling (queryWithTools) — reliable, structured tool calls
 * 2. Prompt-based fallback (query/queryStream) — for LLMs without native tool support
 */
import { randomUUID } from 'node:crypto';
import { zodToJsonSchema } from './schema-utils.js';
import { logger } from './logger.js';
import type { Message, StreamEvent } from '../types/index.js';
import type { LLMClient, LLMMessage, LLMToolDef } from './llm-client.js';
import type { MemorySystem } from './memory-system.js';
import type { ContextManager } from './context-manager.js';
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
  private sessionChannel: string | undefined;

  constructor(config: QueryEngineConfig) {
    this.config = config;
    this.sessionId = randomUUID();
    this.maxToolRounds = config.maxToolRounds ?? 10;
    this.sessionStore = config.sessionStore;
  }

  /** Set a channel name for session persistence (e.g. "feishu-{userId}") */
  setSessionChannel(channel: string): void {
    this.sessionChannel = channel;
  }

  /** 从磁盘恢复上一次会话（支持按 channel 隔离） */
  restoreLastSession(channel?: string): boolean {
    if (!this.sessionStore) return false;
    const ch = channel ?? this.sessionChannel;
    const lastId = this.sessionStore.getLastSessionId(ch);
    if (!lastId) return false;
    const msgs = this.sessionStore.load(lastId);
    if (msgs.length === 0) return false;
    // Only keep last 20 messages to prevent context overflow
    this.messages = msgs.length > 20 ? msgs.slice(-20) : msgs;
    this.sessionId = lastId;
    return true;
  }

  /** 保存当前会话到磁盘 */
  private saveSession(): void {
    if (this.sessionStore && this.messages.length > 0) {
      this.sessionStore.save(this.sessionId, this.messages, this.sessionChannel);
    }
  }

  /**
   * Build the full system prompt with three-layer memory injection:
   * Layer 1: MEMORY.md index (always present)
   * Layer 2: Relevant memories selected by LLM side query (on-demand)
   */
  private async buildDynamicSystemPrompt(
    userMessage: string,
    signal: AbortSignal,
  ): Promise<string> {
    // 实时时间注入 — 每次对话都取最新时间
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Generate upcoming week calendar for date reasoning
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const upcomingDates: string[] = [];
    for (let i = 0; i <= 14; i++) {
      const d = new Date(now.getTime() + i * 86400000);
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const wd = weekDays[d.getDay()]!;
      upcomingDates.push(`${m}月${day}日(周${wd})`);
    }

    let prompt = this.config.systemPrompt;
    prompt += `\n\n# 当前时间（实时，每次对话更新）\n\n${dateStr} ${timeStr}`;
    prompt += `\n\n未来两周日历: ${upcomingDates.join(', ')}`;
    prompt += `\n\n注意：这是此刻的真实时间。对话历史中出现的任何时间都是过去的，回答"现在几点"时必须使用上面这个时间。用户说"下周X"时，请对照上面的日历确认具体日期。`;

    // Layer 1: Reload latest MEMORY.md index
    const index = this.config.memorySystem.loadIndex();
    if (index) {
      prompt += '\n\n# 记忆索引\n\n' + index;
      logger.debug(`memory index loaded`, { lines: index.split('\n').length }, 'QueryEngine');
    }

    // Layer 2: On-demand recall — only when there are enough memories to justify a side query
    const allMemoryCount = index ? index.split('\n').filter(l => l.startsWith('-')).length : 0;
    if (allMemoryCount > 20) {
      // Only do LLM side query when there are enough memories to select from
      const memories = await this.config.memorySystem.findRelevantMemories(userMessage, signal);
      if (memories.length > 0) {
        logger.debug(`relevant memories found`, { count: memories.length, titles: memories.map(m => m.title) }, 'QueryEngine');
        prompt += '\n\n## 相关记忆（自动召回）\n\n' +
          memories.map(m =>
            `### [${m.type}] ${m.title}\n${m.content}`
          ).join('\n\n');
      }
    }

    return prompt;
  }

  async *submitMessage(userMessage: string): AsyncGenerator<StreamEvent> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.messages.push({ role: 'user', content: userMessage, timestamp: new Date() });
    logger.debug(`submitMessage: "${userMessage.slice(0, 80)}"`, { msgCount: this.messages.length }, 'QueryEngine');

    try {
      const systemPrompt = await this.buildDynamicSystemPrompt(userMessage, signal);
      logger.debug(`systemPrompt built`, { length: systemPrompt.length, estimatedTokens: Math.ceil(systemPrompt.length / 4) }, 'QueryEngine');

      const hasNativeTools = !!this.config.llm.queryWithTools;
      if (hasNativeTools) {
        yield* this.executeWithNativeTools(systemPrompt, signal);
      } else if (this.config.llm.queryStream) {
        yield* this.executeWithStream(systemPrompt, signal);
      } else {
        yield* this.executeBasic(systemPrompt, signal);
      }

      // Auto memory extraction — only every 5 turns to save tokens
      // (每 5 轮对话提取一次，而不是每次都提取)
      const userMsgCount = this.messages.filter(m => m.role === 'user').length;
      if (userMsgCount > 0 && userMsgCount % 5 === 0) {
        this.config.memorySystem.extractAndStoreFromConversation(this.messages).catch((err) => {
          console.error('[MemoryExtraction] 自动记忆提取失败:', err instanceof Error ? err.message : err);
        });
      }

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
    const toolDefs: LLMToolDef[] = this.config.tools.listEnabled().map(t => {
      const params = zodToJsonSchema(t.inputSchema);
      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: params,
        },
      };
    });


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
      logger.debug(`LLM round ${rounds}`, {
        hasToolCalls: !!(result.toolCalls?.length),
        toolCallCount: result.toolCalls?.length ?? 0,
        contentLength: result.content?.length ?? 0,
      }, 'QueryEngine');

      // LLM returned tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        // Add assistant message with tool_calls to LLM history
        llmMessages.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.toolCalls,
        });

        // Record assistant message with tool_calls
        this.messages.push({
          role: 'assistant',
          content: result.content ?? '',
          timestamp: new Date(),
        });

        for (const tc of result.toolCalls) {
          let parsedInput: unknown;
          try { parsedInput = JSON.parse(tc.function.arguments); } catch { parsedInput = {}; }

          yield { type: 'tool_use', toolName: tc.function.name, input: parsedInput };
          logger.debug(`tool call: ${tc.function.name}`, { args: JSON.stringify(parsedInput).slice(0, 200) }, 'QueryEngine');

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
      // Use streaming for the final text response (better UX)
      if (this.config.llm.queryStream && rounds === 1 && !result.content) {
        // First round, no content and no tools — stream directly
        yield* this.executeWithStream(systemPrompt, signal);
        return;
      }

      if (this.config.llm.queryStream && result.content) {
        // Re-request with streaming for the final text
        // Build a simple prompt from the last few messages
        const lastMsgs = llmMessages.slice(-6);
        const streamPrompt = lastMsgs.filter(m => m.role === 'system').map(m => m.content).join('\n') || systemPrompt;
        const streamUser = lastMsgs.filter(m => m.role !== 'system').map(m => `[${m.role}] ${(m.content ?? '').slice(0, 500)}`).join('\n');

        // We already have the non-streamed content, just output it char by char for streaming effect
        const content = result.content;
        const chunkSize = 4;
        for (let i = 0; i < content.length; i += chunkSize) {
          yield { type: 'text', content: content.slice(i, i + chunkSize) };
          // Small delay for streaming effect
          await new Promise(r => setTimeout(r, 15));
        }
        this.messages.push({ role: 'assistant', content, timestamp: new Date() });
      } else {
        const content = result.content ?? '';
        if (content) {
          yield { type: 'text', content };
          this.messages.push({ role: 'assistant', content, timestamp: new Date() });
        }
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

  interrupt(): void { this.abortController?.abort(); }
  getMessages(): readonly Message[] { return this.messages; }
  getSessionId(): string { return this.sessionId; }
}
