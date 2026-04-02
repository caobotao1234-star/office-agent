/**
 * Context Manager — Auto-compaction and context window management.
 * Reference: Claude Code's compact service.
 *
 * Uses a simple chars/4 heuristic for token estimation.
 */
import type { Message, MemoryEntry } from '../types/index.js';
import type { LLMClient } from './llm-client.js';
import type { MemorySystem } from './memory-system.js';

// ============================================================
// Types
// ============================================================

export interface CompactResult {
  compressedMessages: Message[];
  extractedMemories: MemoryEntry[];
  summary: string;
}

// ============================================================
// ContextManager
// ============================================================

export class ContextManager {
  private contextWindowSize: number;
  private llm: LLMClient | undefined;

  /** Auto-compact triggers at 90% usage */
  private static readonly COMPACT_THRESHOLD = 0.9;

  constructor(contextWindowSize = 128_000, llm?: LLMClient) {
    this.contextWindowSize = contextWindowSize;
    this.llm = llm;
  }

  // ----------------------------------------------------------
  // Auto-compact detection (Task 5.2)
  // ----------------------------------------------------------

  shouldAutoCompact(currentTokens: number): boolean {
    return currentTokens >= this.contextWindowSize * ContextManager.COMPACT_THRESHOLD;
  }

  // ----------------------------------------------------------
  // Compaction (Task 5.2)
  // ----------------------------------------------------------

  /**
   * Compress conversation history into a structured summary.
   * When an LLM is available, generates a rich summary and extracts long-term memories.
   * Without an LLM, falls back to simple truncation (keep recent half).
   */
  async compact(
    messages: Message[],
    memorySystem?: MemorySystem,
  ): Promise<CompactResult> {
    // Separate system messages from conversation
    const systemMsgs = messages.filter((m) => m.role === 'system');
    const convMsgs = messages.filter((m) => m.role !== 'system');

    if (convMsgs.length <= 2) {
      return { compressedMessages: messages, extractedMemories: [], summary: '' };
    }

    // --- LLM-powered compaction ---
    if (this.llm) {
      return this.compactWithLLM(systemMsgs, convMsgs, memorySystem);
    }

    // --- Fallback: simple truncation ---
    return this.compactByTruncation(systemMsgs, convMsgs);
  }

  private async compactWithLLM(
    systemMsgs: Message[],
    convMsgs: Message[],
    memorySystem?: MemorySystem,
  ): Promise<CompactResult> {
    const transcript = convMsgs
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

    const systemPrompt =
      'You are a conversation compressor. Summarize the conversation into a structured summary.\n' +
      'Preserve: task status changes, important decisions, user instructions, key conclusions.\n' +
      'Also extract items worth remembering long-term as a JSON array.\n\n' +
      'Reply in this exact format:\n' +
      '## Summary\n<structured summary>\n\n' +
      '## Memories\n```json\n[{"title":"...","content":"...","type":"preference|decision|commitment|colleague|project_context","tags":["..."]}]\n```';

    const controller = new AbortController();
    let summary = '';
    const extractedMemories: MemoryEntry[] = [];

    try {
      const response = await this.llm!.query(systemPrompt, transcript, controller.signal);

      // Parse summary section
      const summaryMatch = response.match(/## Summary\s*\n([\s\S]*?)(?=## Memories|$)/);
      summary = summaryMatch?.[1]?.trim() ?? response;

      // Parse memories section
      const memoriesMatch = response.match(/```json\s*\n?([\s\S]*?)```/);
      if (memoriesMatch?.[1] && memorySystem) {
        try {
          const items: Array<{
            title: string;
            content: string;
            type: string;
            tags: string[];
          }> = JSON.parse(memoriesMatch[1]);

          if (Array.isArray(items)) {
            for (const item of items) {
              if (!item.title || !item.content) continue;
              const stored = await memorySystem.store({
                title: item.title,
                content: item.content,
                type: (item.type as MemoryEntry['type']) || 'decision',
                tags: Array.isArray(item.tags) ? item.tags : [],
                source: 'auto_extract',
                updatedAt: new Date(),
              });
              extractedMemories.push(stored);
            }
          }
        } catch {
          // JSON parse failure — non-critical
        }
      }
    } catch {
      // LLM failure — fall back to truncation
      return this.compactByTruncation(systemMsgs, convMsgs);
    }

    // Build compressed messages: system msgs + summary + recent messages
    const summaryMessage: Message = {
      role: 'system',
      content: `[Conversation Summary]\n${summary}`,
      timestamp: new Date(),
    };

    // Keep the most recent quarter of conversation for continuity
    const keepCount = Math.max(2, Math.ceil(convMsgs.length / 4));
    const recentMsgs = convMsgs.slice(-keepCount);

    return {
      compressedMessages: [...systemMsgs, summaryMessage, ...recentMsgs],
      extractedMemories,
      summary,
    };
  }

  private compactByTruncation(
    systemMsgs: Message[],
    convMsgs: Message[],
  ): CompactResult {
    // Simple strategy: keep the most recent half of conversation
    const keepCount = Math.max(2, Math.ceil(convMsgs.length / 2));
    const kept = convMsgs.slice(-keepCount);

    return {
      compressedMessages: [...systemMsgs, ...kept],
      extractedMemories: [],
      summary: '',
    };
  }
}
