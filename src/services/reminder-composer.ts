import { z } from 'zod';
import type { LLMClient } from '../core/llm-client.js';
import type { AgendaItem } from '../types/index.js';
import { logger } from '../core/logger.js';

const log = logger.child('ReminderComposer');

const ComposedReminderSchema = z.object({
  message: z.string().min(1).max(2000),
});

export class ReminderComposer {
  constructor(private llm: LLMClient, private timeoutMs = 10_000) {}

  async compose(item: AgendaItem, now = new Date()): Promise<string> {
    const fallback = this.fallbackMessage(item);

    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), this.timeoutMs);
      let response: string;
      try {
        response = await this.llm.query(
          buildComposerSystemPrompt(),
          buildComposerUserPrompt(item, now),
          ac.signal,
        );
      } finally {
        clearTimeout(timeout);
      }

      const parsed = parseComposerResponse(response);
      if (!parsed) {
        log.warn('invalid composer response, using fallback', { agendaId: item.id, response: response.slice(0, 300) });
        return fallback;
      }

      log.info('composed reminder', { agendaId: item.id, length: parsed.message.length });
      return parsed.message;
    } catch (err) {
      log.warn('compose failed, using fallback', { agendaId: item.id, error: err instanceof Error ? err.message : String(err) });
      return fallback;
    }
  }

  fallbackMessage(item: AgendaItem): string {
    const prefix = item.type === 'deadline' ? '截止提醒'
      : item.type === 'commitment' ? '承诺跟进'
        : item.type === 'follow_up' ? '跟进提醒'
          : '提醒';
    const details = item.description ? `：${item.description}` : '';
    return `${prefix}：${item.title}${details}`;
  }
}

function buildComposerSystemPrompt(): string {
  return [
    '你是 Office Agent 的提醒文案生成器。',
    '你只负责把一条到期 Agenda 写成简洁、自然、可执行的中文提醒。',
    '不要解释，不要输出 Markdown 表格，不要编造事实。',
    '必须只输出 JSON，格式为 {"message":"..."}。',
  ].join('\n');
}

function buildComposerUserPrompt(item: AgendaItem, now: Date): string {
  return JSON.stringify({
    now: now.toISOString(),
    agenda: {
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.description,
      triggerAt: item.triggerAt.toISOString(),
      deadlineAt: item.deadlineAt?.toISOString(),
      priority: item.priority,
      timezone: item.timezone,
      sourceMessage: item.sourceMessage,
      context: item.context,
      composePrompt: item.composePrompt,
    },
  });
}

function parseComposerResponse(response: string): z.infer<typeof ComposedReminderSchema> | null {
  const candidates = [
    response.trim(),
    extractJsonObject(response),
  ].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    try {
      const parsed = ComposedReminderSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
