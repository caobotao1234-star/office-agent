import { describe, expect, it, vi } from 'vitest';
import { FeishuSyncScheduler } from './feishu-sync-scheduler.js';
import { NotificationService } from './notification-service.js';

describe('FeishuSyncScheduler', () => {
  it('does not start or tick when disabled', async () => {
    const onTick = vi.fn();
    const notifications = new NotificationService();
    const scheduler = new FeishuSyncScheduler(onTick, notifications, 0);

    scheduler.start();
    expect(scheduler.isEnabled()).toBe(false);
    expect(await scheduler.tick()).toBeNull();
    expect(onTick).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('runs sync tick and notifies on changes', async () => {
    const onTick = vi.fn().mockResolvedValue({ count: 2, changed: 1, failed: 0 });
    const notifications = new NotificationService();
    const pushed: string[] = [];
    notifications.addChannel((message) => {
      pushed.push(message);
    });

    const scheduler = new FeishuSyncScheduler(onTick, notifications, 60_000);
    const result = await scheduler.tick();

    expect(result).toEqual({ count: 2, changed: 1, failed: 0 });
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(pushed[0]).toContain('1 个有变化');
  });

  it('collapses overlapping ticks and runs one more pass after current tick', async () => {
    let release!: () => void;
    const onTick = vi.fn().mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ count: 1, changed: 0, failed: 0 });
    }));
    const notifications = new NotificationService();
    const scheduler = new FeishuSyncScheduler(onTick, notifications, 60_000);

    const first = scheduler.tick();
    const second = scheduler.tick();
    expect(await second).toBeNull();
    release();
    expect(await first).toEqual({ count: 1, changed: 0, failed: 0 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onTick).toHaveBeenCalledTimes(2);
  });
});
