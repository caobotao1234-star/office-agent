import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReminderLoop } from './reminder-loop.js';
import { ReminderEngine } from './reminder-engine.js';
import { NotificationService } from './notification-service.js';
import { ToolRegistry } from '../core/tool-system.js';
import { UserConfigManager } from '../core/user-config.js';

describe('ReminderLoop', () => {
  let reminderEngine: ReminderEngine;
  let notificationService: NotificationService;
  let toolRegistry: ToolRegistry;
  let config: ReturnType<typeof UserConfigManager.getDefault>;
  let notifyCb: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = UserConfigManager.getDefault();
    reminderEngine = new ReminderEngine(config);
    notificationService = new NotificationService();
    toolRegistry = new ToolRegistry();
    notifyCb = vi.fn<(message: string) => void>();
    notificationService.addChannel(notifyCb as any);
  });

  function createLoop() {
    return new ReminderLoop({
      reminderEngine,
      notificationService,
      toolRegistry,
      getConfig: () => config,
    });
  }

  it('should not notify when no channels registered', async () => {
    const ns = new NotificationService(); // no channels
    const loop = new ReminderLoop({
      reminderEngine,
      notificationService: ns,
      toolRegistry,
      getConfig: () => config,
    });
    await loop.tick();
    expect(notifyCb).not.toHaveBeenCalled();
  });

  it('should deliver due reminders', async () => {
    const now = new Date();
    // Manually add a pending reminder that is already due
    reminderEngine.getPendingReminders().push({
      id: 'test-1',
      type: 'smart_followup',
      message: '测试提醒',
      reason: 'test',
      scheduledAt: new Date(now.getTime() - 1000), // 1 second ago
      delivered: false,
    });

    const loop = createLoop();
    await loop.tick(now);

    expect(notifyCb).toHaveBeenCalledWith('测试提醒');
  });

  it('should not deliver future reminders', async () => {
    const now = new Date();
    reminderEngine.getPendingReminders().push({
      id: 'test-2',
      type: 'smart_followup',
      message: '未来提醒',
      reason: 'test',
      scheduledAt: new Date(now.getTime() + 60_000), // 1 minute from now
      delivered: false,
    });

    const loop = createLoop();
    await loop.tick(now);

    expect(notifyCb).not.toHaveBeenCalled();
  });

  it('should not deliver already-delivered reminders', async () => {
    const now = new Date();
    reminderEngine.getPendingReminders().push({
      id: 'test-3',
      type: 'smart_followup',
      message: '已送达',
      reason: 'test',
      scheduledAt: new Date(now.getTime() - 1000),
      delivered: true,
    });

    const loop = createLoop();
    await loop.tick(now);

    expect(notifyCb).not.toHaveBeenCalled();
  });

  it('should start and stop interval', () => {
    const loop = createLoop();
    loop.start();
    loop.start(); // idempotent
    loop.stop();
    loop.stop(); // idempotent
  });
});
