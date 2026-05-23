import { describe, expect, it, vi } from 'vitest';
import { ReminderComposer } from './reminder-composer.js';
import type { AgendaItem } from '../types/index.js';
import type { LLMClient } from '../core/llm-client.js';

function item(overrides: Partial<AgendaItem> = {}): AgendaItem {
  const now = new Date('2026-05-23T10:00:00.000Z');
  return {
    id: 'agenda-1',
    type: 'deadline',
    title: '提交客户方案',
    description: '发到客户群',
    triggerAt: now,
    deadlineAt: new Date('2026-05-23T12:00:00.000Z'),
    timezone: 'Asia/Shanghai',
    priority: 'high',
    status: 'pending',
    source: 'llm',
    sourceMessage: '周六中午前要交方案',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function llm(response: string): LLMClient {
  return {
    query: vi.fn().mockResolvedValue(response),
  };
}

describe('ReminderComposer', () => {
  it('uses JSON message returned by LLM', async () => {
    const composer = new ReminderComposer(llm('{"message":"该提交客户方案了，记得发到客户群。"}'));

    await expect(composer.compose(item())).resolves.toBe('该提交客户方案了，记得发到客户群。');
  });

  it('extracts JSON object from surrounding text', async () => {
    const composer = new ReminderComposer(llm('好的：\n{"message":"现在跟进合同。"}'));

    await expect(composer.compose(item({ type: 'follow_up', title: '跟进合同' }))).resolves.toBe('现在跟进合同。');
  });

  it('falls back when LLM returns invalid JSON', async () => {
    const composer = new ReminderComposer(llm('我提醒你交方案'));

    await expect(composer.compose(item())).resolves.toBe('截止提醒：提交客户方案：发到客户群');
  });

  it('falls back when LLM throws', async () => {
    const badLLM: LLMClient = {
      query: vi.fn().mockRejectedValue(new Error('network failed')),
    };
    const composer = new ReminderComposer(badLLM);

    await expect(composer.compose(item({ type: 'commitment', title: '发送资料', description: undefined }))).resolves.toBe('承诺跟进：发送资料');
  });
});
