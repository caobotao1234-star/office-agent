/**
 * PromptSuggestionEngine — Proactive next-step suggestions.
 *
 * Task 20.1: generateSuggestions based on tasks / deadlines / activity,
 *            dismissSuggestion to avoid repeats, getDismissedSuggestions.
 *
 * Requirements: 20.1-20.5
 */

import { randomUUID } from 'node:crypto';
import type { LLMClient } from '../core/llm-client.js';
import type { TaskItem, Message, Suggestion } from '../types/index.js';

export interface SuggestionContext {
  currentTasks: TaskItem[];
  recentMessages: Message[];
  upcomingDeadlines: TaskItem[];
  userActivityPattern: ActivityPattern;
}

export interface ActivityPattern {
  /** Most active hour of the day (0-23). */
  peakHour: number;
  /** Average tasks completed per day. */
  avgCompletedPerDay: number;
}

export class PromptSuggestionEngine {
  private readonly llm: LLMClient | null;
  private dismissedIds = new Set<string>();

  constructor(llm?: LLMClient) {
    this.llm = llm ?? null;
  }

  // ----------------------------------------------------------
  // Generate suggestions
  // ----------------------------------------------------------

  /**
   * Produce 1-3 actionable suggestions based on the current context.
   *
   * When an LLMClient is available the suggestions are LLM-generated;
   * otherwise a simple heuristic fallback is used.
   */
  async generateSuggestions(context: SuggestionContext): Promise<Suggestion[]> {
    const raw = this.llm
      ? await this.generateWithLLM(context)
      : this.generateHeuristic(context);

    // Filter out previously dismissed suggestions (by text match)
    return raw.filter((s) => !this.dismissedIds.has(s.id));
  }

  // ----------------------------------------------------------
  // Dismiss
  // ----------------------------------------------------------

  dismissSuggestion(suggestionId: string): void {
    this.dismissedIds.add(suggestionId);
  }

  getDismissedSuggestions(): string[] {
    return [...this.dismissedIds];
  }

  // ----------------------------------------------------------
  // LLM-based generation
  // ----------------------------------------------------------

  private async generateWithLLM(context: SuggestionContext): Promise<Suggestion[]> {
    const system = [
      '你是一个办公助理。请根据用户当前的任务和上下文，生成 1-3 条简短的下一步行动建议。',
      '每条建议包含：建议内容(text)、原因(reason)、优先级(priority: high/medium/low)。',
      '以 JSON 数组格式返回，例如：[{"text":"...","reason":"...","priority":"medium"}]',
      '不要重复用户已经在做的事情。使用中文。',
    ].join('\n');

    const user = this.buildPromptContext(context);

    const ac = new AbortController();
    const response = await this.llm!.query(system, user, ac.signal);

    return this.parseLLMResponse(response);
  }

  // ----------------------------------------------------------
  // Heuristic fallback
  // ----------------------------------------------------------

  private generateHeuristic(context: SuggestionContext): Suggestion[] {
    const suggestions: Suggestion[] = [];

    // 1. Urgent deadlines
    const urgent = context.upcomingDeadlines.filter(
      (t) => t.dueDate && t.status !== 'completed' && t.status !== 'cancelled',
    );
    if (urgent.length > 0) {
      const top = urgent[0];
      suggestions.push({
        id: randomUUID(),
        text: `处理即将到期的任务「${top.description}」`,
        reason: '该任务截止日期临近',
        priority: 'high',
      });
    }

    // 2. In-progress tasks
    const inProgress = context.currentTasks.filter((t) => t.status === 'in_progress');
    if (inProgress.length > 0) {
      const top = inProgress[0];
      suggestions.push({
        id: randomUUID(),
        text: `继续推进「${top.description}」`,
        reason: '该任务正在进行中',
        priority: 'medium',
      });
    }

    // 3. Pending high-priority tasks
    const pending = context.currentTasks.filter(
      (t) => t.status === 'pending' && (t.priority === 'urgent' || t.priority === 'high'),
    );
    if (pending.length > 0 && suggestions.length < 3) {
      const top = pending[0];
      suggestions.push({
        id: randomUUID(),
        text: `开始处理高优先级任务「${top.description}」`,
        reason: `优先级为 ${top.priority}，尚未开始`,
        priority: 'medium',
      });
    }

    return suggestions.slice(0, 3);
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  private buildPromptContext(context: SuggestionContext): string {
    const lines: string[] = [];

    if (context.currentTasks.length > 0) {
      lines.push('当前任务：');
      for (const t of context.currentTasks.slice(0, 10)) {
        lines.push(`  - [${t.status}][${t.priority}] ${t.description}`);
      }
    }

    if (context.upcomingDeadlines.length > 0) {
      lines.push('即将到期：');
      for (const t of context.upcomingDeadlines.slice(0, 5)) {
        lines.push(`  - ${t.description} (截止: ${t.dueDate?.toISOString() ?? '无'})`);
      }
    }

    if (context.recentMessages.length > 0) {
      lines.push('最近对话：');
      for (const m of context.recentMessages.slice(-5)) {
        lines.push(`  [${m.role}] ${m.content.slice(0, 80)}`);
      }
    }

    return lines.join('\n');
  }

  private parseLLMResponse(response: string): Suggestion[] {
    try {
      // Extract JSON array from response (may be wrapped in markdown code block)
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) return [];

      const arr = JSON.parse(match[0]) as Array<{
        text?: string;
        reason?: string;
        priority?: string;
      }>;

      return arr
        .filter((item) => item.text)
        .slice(0, 3)
        .map((item) => ({
          id: randomUUID(),
          text: item.text!,
          reason: item.reason ?? '',
          priority: normalizePriority(item.priority),
        }));
    } catch {
      return [];
    }
  }
}

function normalizePriority(p?: string): 'high' | 'medium' | 'low' {
  if (p === 'high' || p === 'medium' || p === 'low') return p;
  return 'medium';
}
