/**
 * QueryEngine — Core conversation loop for Office Agent.
 * Reference: Claude Code's QueryEngine pattern (async generator).
 *
 * Orchestrates: user input → context assembly → LLM call → tool execution loop → memory extraction.
 */
import { randomUUID } from 'node:crypto';
import type { Message, StreamEvent, ToolResult } from '../types/index.js';
import type { LLMClient } from './llm-client.js';
import type { MemorySystem } from './memory-system.js';
import type { ContextManager, ToolDefinition } from './context-manager.js';
import type { ToolRegistry } from './tool-system.js';

// ============================================================
// Config
// ============================================================

export interface QueryEngineConfig {
  model: string;
  systemPrompt: string;
  tools: ToolRegistry;
  memorySystem: MemorySystem;
  contextManager: ContextManager;
  llm: LLMClient;
  /** Maximum tool-call rounds per message to prevent infinite loops */
  maxToolRounds?: number;
}

// ============================================================
// LLM response parsing helpers
// ============================================================

/**
 * Simple convention for LLM tool-use responses:
 * If the LLM wants to call a tool it returns a JSON block:
 *   {"tool_use": {"name": "ToolName", "input": { ... }}}
 * Otherwise the response is plain text.
 */
interface ToolUseRequest {
  name: string;
  input: unknown;
}

function parseToolUse(text: string): ToolUseRequest | null {
  try {
    // Try to extract JSON from the response (may be wrapped in markdown fences)
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed?.tool_use?.name) {
      return { name: parsed.tool_use.name, input: parsed.tool_use.input ?? {} };
    }
  } catch {
    // Not JSON or not a tool_use block — treat as plain text
  }
  return null;
}

// ============================================================
// QueryEngine
// ============================================================

export class QueryEngine {
  private config: QueryEngineConfig;
  private messages: Message[] = [];
  private sessionId: string;
  private abortController: AbortController | null = null;
  private maxToolRounds: number;

  constructor(config: QueryEngineConfig) {
    this.config = config;
    this.sessionId = randomUUID();
    this.maxToolRounds = config.maxToolRounds ?? 10;
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Submit a user message and yield streaming events.
   * Implements the full loop: context → LLM → (tool calls)* → memory extraction.
   */
  async *submitMessage(userMessage: string): AsyncGenerator<StreamEvent> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // 1. Record user message
    this.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    });

    try {
      // 2. Retrieve relevant memories
      const memories = await this.config.memorySystem.findRelevantMemories(
        userMessage,
        signal,
      );

      // 3. Build tool definitions for context
      const toolDefs: ToolDefinition[] = this.config.tools
        .listEnabled()
        .map((t) => ({ name: t.name, description: t.description }));

      // 4. Assemble context via ContextManager
      const context = this.config.contextManager.buildContext({
        systemPrompt: this.config.systemPrompt,
        memories,
        conversationHistory: this.messages,
        toolDefinitions: toolDefs,
      });

      // 5. LLM call + tool-use loop
      let rounds = 0;
      let lastAssistantContent = '';

      while (rounds < this.maxToolRounds) {
        if (signal.aborted) {
          yield { type: 'error', error: 'Request interrupted' };
          return;
        }

        rounds++;

        // Build the prompt from context messages
        const systemMsg = context.messages.find((m) => m.role === 'system');
        const nonSystemMsgs = context.messages.filter((m) => m.role !== 'system');
        const userPrompt = nonSystemMsgs.map((m) => `[${m.role}] ${m.content}`).join('\n');

        // Call LLM — use streaming if available, fall back to non-streaming
        const systemContent = systemMsg?.content ?? this.config.systemPrompt;
        let llmResponse: string;

        if (this.config.llm.queryStream) {
          // 流式：逐 token 收集，同时 yield text 事件
          const chunks: string[] = [];
          let isToolUse = false;

          for await (const chunk of this.config.llm.queryStream(systemContent, userPrompt, signal)) {
            chunks.push(chunk);

            // 检测是否是 tool_use JSON（以 { 开头的流）
            const soFar = chunks.join('');
            if (chunks.length <= 3 && soFar.trimStart().startsWith('{')) {
              isToolUse = true; // 可能是 tool_use，先不输出，等收集完
              continue;
            }

            if (!isToolUse) {
              yield { type: 'text', content: chunk };
            }
          }

          llmResponse = chunks.join('');

          // 如果之前判断可能是 tool_use 但最终不是，补输出
          if (isToolUse && !parseToolUse(llmResponse)) {
            yield { type: 'text', content: llmResponse };
            isToolUse = false;
          }
        } else {
          // 非流式回退
          llmResponse = await this.config.llm.query(systemContent, userPrompt, signal);
        }

        // Check for tool_use
        const toolReq = parseToolUse(llmResponse);

        if (toolReq) {
          // Yield tool_use event
          yield { type: 'tool_use', toolName: toolReq.name, input: toolReq.input };

          // Execute tool via ToolRegistry
          const toolResult = await this.config.tools.execute(
            toolReq.name,
            toolReq.input,
            { abortSignal: signal, userConfig: {} as never },
          );

          // Yield tool_result event
          yield { type: 'tool_result', toolName: toolReq.name, result: toolResult };

          // Append tool interaction to messages for next round
          this.messages.push({
            role: 'assistant',
            content: llmResponse,
            timestamp: new Date(),
          });
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(toolResult),
            toolName: toolReq.name,
            timestamp: new Date(),
          });

          // Rebuild context with updated messages for next iteration
          const updatedContext = this.config.contextManager.buildContext({
            systemPrompt: this.config.systemPrompt,
            memories,
            conversationHistory: this.messages,
            toolDefinitions: toolDefs,
          });
          // Update context reference for next loop iteration
          context.messages = updatedContext.messages;
          context.estimatedTokens = updatedContext.estimatedTokens;

          continue; // Next round — LLM sees tool result
        }

        // No tool_use — this is the final text response
        lastAssistantContent = llmResponse;
        // 如果是非流式模式，这里才 yield 完整文本（流式已经逐 token yield 过了）
        if (!this.config.llm.queryStream) {
          yield { type: 'text', content: llmResponse };
        }
        break;
      }

      // 6. Record assistant response
      if (lastAssistantContent) {
        this.messages.push({
          role: 'assistant',
          content: lastAssistantContent,
          timestamp: new Date(),
        });
      }

      // 7. Auto memory extraction (fire-and-forget)
      this.config.memorySystem
        .extractAndStoreFromConversation(this.messages)
        .catch(() => {});

      // 8. Done
      yield { type: 'done' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', error: message };
    } finally {
      this.abortController = null;
    }
  }

  /** Interrupt the current in-flight request. */
  interrupt(): void {
    this.abortController?.abort();
  }

  /** Get the full conversation history (read-only). */
  getMessages(): readonly Message[] {
    return this.messages;
  }

  /** Get the current session id. */
  getSessionId(): string {
    return this.sessionId;
  }
}
