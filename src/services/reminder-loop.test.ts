import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  function createLoop() {
    return new ReminderLoop({
      reminderEngine,
      notificationService,
      toolRegistry,
      llm: mockLLM,
      getConfig: () => config,
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
