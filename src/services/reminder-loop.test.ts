import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReminderLoop } from './reminder-loop.js';
import { ReminderEngine } from './reminder-engine.js';
import { NotificationService } from './notification-service.js';
import { ToolRegistry } from '../core/tool-system.js';
import { UserConfigManager } from '../core/user-config.js';
import type { LLMClient } from '../core/llm-client.js';

describe('ReminderLoop', () => {
  let reminderEngine: ReminderEngine;
  let notificationService: NotificationService;
  let toolRegistry: ToolRegistry;
  let config: ReturnType<typeof UserConfigManager.getDefault>;
  let notifyCb: ReturnType<typeof vi.fn>;
  let mockLLM: LLMClient;

  beforeEach(() => {
    config = UserConfigManager.getDefault();
    reminderEngine = new ReminderEngine(config);
    notificationService = new NotificationService();
    toolRegistry = new ToolRegistry();
    notifyCb = vi.fn<(message: string) => void>();
    notificationService.addChannel(notifyCb as any);
    mockLLM = {
      query: (async () => 'SKIP') as any,
    } as LLMClient;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createLoop(intervalMs?: number) {
    return new ReminderLoop({
      reminderEngine,
      notificationService,
      toolRegistry,
      llm: mockLLM,
      getConfig: () => config,
      intervalMs,
    });
  }

  it('should not notify when no channels registered', async () => {
    const ns = new NotificationService();
    const loop = new ReminderLoop({
      reminderEngine,
      notificationService: ns,
      toolRegistry,
      llm: mockLLM,
      getConfig: () => config,
    });
    await loop.tick();
    expect(notifyCb).not.toHaveBeenCalled();
  });

  it('should deliver due scheduled reminders', async () => {
    const now = new Date();
    reminderEngine.getPendingReminders().push({
      id: 'test-1',
      type: 'smart_followup',
      message: '测试提醒',
      reason: 'test',
      scheduledAt: new Date(now.getTime() - 1000),
      delivered: false,
    });

    const loop = createLoop();
    await loop.tick(now);

    expect(notifyCb).toHaveBeenCalledWith('测试提醒');
  });

  it('should deliver deterministic deadline reminders', async () => {
    const now = new Date();
    toolRegistry.register({
      name: 'TaskManager',
      description: 'tasks',
      inputSchema: { safeParse: (input: unknown) => ({ success: true, data: input }) } as any,
      isEnabled: () => true,
      isReadOnly: () => true,
      checkPermissions: () => ({ allowed: true }),
      requiresUserConfirmation: () => false,
      call: async () => ({
        success: true,
        output: [{
          id: 'task-1',
          description: '准备会议材料',
          status: 'pending',
          priority: 'high',
          subtaskIds: [],
          dueDate: new Date(now.getTime() + 60 * 60 * 1000),
          source: 'user_input',
          createdAt: now,
          updatedAt: now,
        }],
      }),
    });

    const loop = createLoop();
    await loop.tick(now);

    expect(notifyCb).toHaveBeenCalledWith(expect.stringContaining('准备会议材料'));
  });

  it('should not deliver future reminders', async () => {
    const now = new Date();
    reminderEngine.getPendingReminders().push({
      id: 'test-2',
      type: 'smart_followup',
      message: '未来提醒',
      reason: 'test',
      scheduledAt: new Date(now.getTime() + 60_000),
      delivered: false,
    });

    const loop = createLoop();
    await loop.tick(now);

    expect(notifyCb).not.toHaveBeenCalled();
  });

  it('should deliver newly added reminders at their due time without waiting for polling interval', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-05-22T00:00:00.000Z');
    vi.setSystemTime(now);
    const loop = createLoop(15 * 60 * 1000);
    loop.start();

    reminderEngine.addReminder({
      id: 'test-due-timer',
      type: 'smart_followup',
      message: '一分钟提醒',
      reason: 'test',
      scheduledAt: new Date(now.getTime() + 60_000),
      delivered: false,
    });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(notifyCb).not.toHaveBeenCalledWith('一分钟提醒');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(notifyCb).toHaveBeenCalledWith('一分钟提醒');
    loop.stop();
  });

  it('should recheck due reminders when a notification channel is added after start', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-05-22T00:00:00.000Z');
    vi.setSystemTime(now);
    const lateNotificationService = new NotificationService();
    const lateNotify = vi.fn<(message: string) => void>();
    const loop = new ReminderLoop({
      reminderEngine,
      notificationService: lateNotificationService,
      toolRegistry,
      llm: mockLLM,
      getConfig: () => config,
      intervalMs: 15 * 60 * 1000,
    });

    reminderEngine.addReminder({
      id: 'test-late-channel',
      type: 'smart_followup',
      message: '通道恢复提醒',
      reason: 'test',
      scheduledAt: now,
      delivered: false,
    });
    loop.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(lateNotify).not.toHaveBeenCalled();

    lateNotificationService.addChannel(lateNotify as any);
    await vi.runOnlyPendingTimersAsync();

    expect(lateNotify).toHaveBeenCalledWith('通道恢复提醒');
    loop.stop();
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
