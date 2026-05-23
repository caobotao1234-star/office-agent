import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgendaStore } from './agenda-store.js';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-agenda-'));
  return path.join(dir, 'agenda.json');
}

describe('AgendaStore', () => {
  it('creates, persists, and restores agenda items with dates', () => {
    const file = tmpFile();
    const store = new AgendaStore(file);
    const triggerAt = new Date('2026-05-23T10:00:00.000Z');

    const created = store.create({
      type: 'deadline',
      title: '提交方案',
      triggerAt,
      deadlineAt: new Date('2026-05-23T12:00:00.000Z'),
      priority: 'high',
      context: '客户项目',
    });

    const restored = new AgendaStore(file);
    const items = restored.list();

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(created.id);
    expect(items[0]?.triggerAt).toBeInstanceOf(Date);
    expect(items[0]?.triggerAt.toISOString()).toBe(triggerAt.toISOString());
    expect(items[0]?.deadlineAt?.toISOString()).toBe('2026-05-23T12:00:00.000Z');
  });

  it('queries due and next pending items', () => {
    const store = new AgendaStore(tmpFile());
    store.create({ type: 'reminder', title: '已到期', triggerAt: new Date('2026-05-23T10:00:00.000Z') });
    store.create({ type: 'follow_up', title: '未来', triggerAt: new Date('2026-05-23T11:00:00.000Z') });

    expect(store.due(new Date('2026-05-23T10:30:00.000Z')).map((item) => item.title)).toEqual(['已到期']);
    expect(store.nextPendingTime()?.toISOString()).toBe('2026-05-23T10:00:00.000Z');
  });

  it('marks delivered and cancelled items', () => {
    const store = new AgendaStore(tmpFile());
    const delivered = store.create({ type: 'reminder', title: '提醒', triggerAt: new Date() });
    const cancelled = store.create({ type: 'commitment', title: '承诺', triggerAt: new Date() });

    store.markDelivered(delivered.id, new Date('2026-05-23T10:00:00.000Z'));
    store.cancel(cancelled.id, new Date('2026-05-23T11:00:00.000Z'));

    expect(store.get(delivered.id)?.status).toBe('delivered');
    expect(store.get(delivered.id)?.deliveredAt?.toISOString()).toBe('2026-05-23T10:00:00.000Z');
    expect(store.get(cancelled.id)?.status).toBe('cancelled');
    expect(store.due(new Date(Date.now() + 60_000))).toHaveLength(0);
  });

  it('emits change events on mutation', () => {
    const store = new AgendaStore(tmpFile());
    const cb = vi.fn();
    const unsubscribe = store.onChange(cb);

    const item = store.create({ type: 'reminder', title: '提醒', triggerAt: new Date() });
    store.update(item.id, { title: '更新提醒' });
    unsubscribe();
    store.cancel(item.id);

    expect(cb).toHaveBeenCalledTimes(2);
  });
});
