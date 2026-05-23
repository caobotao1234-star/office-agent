import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgendaScheduler } from './agenda-scheduler.js';
import { AgendaStore } from './agenda-store.js';
import { NotificationService } from './notification-service.js';
import { ReminderComposer } from './reminder-composer.js';
import type { LLMClient } from '../core/llm-client.js';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-agenda-scheduler-'));
  return path.join(dir, 'agenda.json');
}

describe('AgendaScheduler', () => {
  let store: AgendaStore;
  let notification: NotificationService;
  let notify: ReturnType<typeof vi.fn>;
  let composer: ReminderComposer;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T00:00:00.000Z'));
    store = new AgendaStore(tmpFile());
    notification = new NotificationService();
    notify = vi.fn<(message: string) => void>();
    notification.addChannel(notify as any);
    const llm: LLMClient = {
      query: vi.fn().mockResolvedValue('{"message":"LLM 生成的提醒"}'),
    };
    composer = new ReminderComposer(llm);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers a newly created agenda item at its trigger time', async () => {
    const scheduler = new AgendaScheduler(store, notification, composer, 60_000);
    scheduler.start();
    store.create({
      type: 'reminder',
      title: '一分钟提醒',
      triggerAt: new Date(Date.now() + 60_000),
    });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(notify).toHaveBeenCalledWith('LLM 生成的提醒');
    expect(store.list({ status: 'delivered' })).toHaveLength(1);
    scheduler.stop();
  });

  it('does not mark due agenda delivered when no notification channel exists', async () => {
    const noChannelNotification = new NotificationService();
    const scheduler = new AgendaScheduler(store, noChannelNotification, composer, 60_000);
    const item = store.create({
      type: 'deadline',
      title: '提交方案',
      triggerAt: new Date(),
    });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.get(item.id)?.status).toBe('pending');
    scheduler.stop();
  });

  it('delivers overdue agenda when a notification channel is added later', async () => {
    const lateNotification = new NotificationService();
    const lateNotify = vi.fn<(message: string) => void>();
    const scheduler = new AgendaScheduler(store, lateNotification, composer, 60_000);
    store.create({
      type: 'commitment',
      title: '发资料',
      triggerAt: new Date(),
    });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(lateNotify).not.toHaveBeenCalled();

    lateNotification.addChannel(lateNotify as any);
    await vi.runOnlyPendingTimersAsync();

    expect(lateNotify).toHaveBeenCalledWith('LLM 生成的提醒');
    expect(store.list({ status: 'delivered' })).toHaveLength(1);
    scheduler.stop();
  });
});
