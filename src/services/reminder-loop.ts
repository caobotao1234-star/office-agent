/**
 * ReminderLoop — LLM-driven smart reminder system.
 *
 * Instead of fixed rules (< 24h = urgent, etc.), this loop periodically
 * asks the LLM to review the user's current tasks, deadlines, and context,
 * then decide whether to send a reminder and what to say.
 *
 * The LLM acts like a real human assistant — it considers:
 * - Task priority and urgency
 * - How recently the user was reminded about something
 * - Time of day (don't disturb outside working hours)
 * - What the user has been working on recently
 * - Whether a reminder would actually be helpful right now
 *
 * Also delivers user-created scheduled reminders (from ReminderTool).
 *
 * Requirements: 5, 6, 7
 */

import type { LLMClient } from '../core/llm-client.js';
import type { ReminderEngine } from './reminder-engine.js';
import type { NotificationService } from './notification-service.js';
import type { ToolRegistry } from '../core/tool-system.js';
import type { TaskItem, UserConfig } from '../types/index.js';
import { logger } from '../core/logger.js';

const log = logger.child('ReminderLoop');

/** Default interval: 15 minutes */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/** Minimum interval between LLM reminder checks: 10 minutes */
const MIN_CHECK_INTERVAL_MS = 10 * 60 * 1000;

export class ReminderLoop {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private nextDueTimerId: ReturnType<typeof setTimeout> | null = null;
  private reminderEngine: ReminderEngine;
  private notificationService: NotificationService;
  private toolRegistry: ToolRegistry;
  private llm: LLMClient;
  private getConfig: () => UserConfig;
  private lastLLMCheckAt: number = 0;
  private intervalMs: number;
  private recentReminderKeys = new Map<string, number>();
  private unsubscribeReminderChanges: (() => void) | null = null;
  private unsubscribeChannelChanges: (() => void) | null = null;
  private tickInFlight = false;
  private tickAgain = false;

  constructor(opts: {
    reminderEngine: ReminderEngine;
    notificationService: NotificationService;
    toolRegistry: ToolRegistry;
    llm: LLMClient;
    getConfig: () => UserConfig;
    intervalMs?: number;
  }) {
    this.reminderEngine = opts.reminderEngine;
    this.notificationService = opts.notificationService;
    this.toolRegistry = opts.toolRegistry;
    this.llm = opts.llm;
    this.getConfig = opts.getConfig;
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  start(): void {
    if (this.intervalId) return;
    this.unsubscribeReminderChanges = this.reminderEngine.onChange(() => {
      this.scheduleNextDueTick();
    });
    this.unsubscribeChannelChanges = this.notificationService.onChannelChange(() => {
      if (this.notificationService.hasChannels()) {
        void this.tick();
      } else {
        this.clearNextDueTimer();
      }
    });
    this.intervalId = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.scheduleNextDueTick();
    void this.tick();
    log.info('started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.clearNextDueTimer();
      this.unsubscribeReminderChanges?.();
      this.unsubscribeReminderChanges = null;
      this.unsubscribeChannelChanges?.();
      this.unsubscribeChannelChanges = null;
      log.info('stopped');
    }
  }

  async tick(now = new Date()): Promise<void> {
    if (this.tickInFlight) {
      this.tickAgain = true;
      return;
    }
    this.tickInFlight = true;

    try {
      if (!this.notificationService.hasChannels()) {
        log.debug('skip tick: no notification channels');
        return;
      }
      log.debug('tick', { now: now.toISOString() });

      // 1. Always deliver user-created scheduled reminders (these are explicit, not LLM-decided)
      await this.deliverScheduledReminders(now);

      // 2. Deterministic deadline checks should not wait for the LLM.
      await this.deliverDeadlineReminders(now);

      // 3. LLM-driven smart check — throttled to avoid excessive API calls
      const elapsed = now.getTime() - this.lastLLMCheckAt;
      if (elapsed >= MIN_CHECK_INTERVAL_MS) {
        await this.smartCheck(now);
        this.lastLLMCheckAt = now.getTime();
      }
    } finally {
      this.tickInFlight = false;
      this.scheduleNextDueTick();
      if (this.tickAgain) {
        this.tickAgain = false;
        void this.tick();
      }
    }
  }

  /**
   * Deliver user-created reminders that have reached their scheduled time.
   * These are explicit reminders created via ReminderTool, not LLM-generated.
   */
  private async deliverScheduledReminders(now: Date): Promise<void> {
    const pending = this.reminderEngine.getPendingReminders();
    for (const r of pending) {
      if (r.delivered) continue;
      // Only deliver user-created reminders here (type = smart_followup from ReminderTool)
      if (r.scheduledAt.getTime() <= now.getTime()) {
        await this.notificationService.notify(r.message);
        r.delivered = true;
        this.reminderEngine.save();
        log.info('delivered scheduled reminder', { reminderId: r.id, type: r.type, taskId: r.taskId });
      }
    }
  }

  private async deliverDeadlineReminders(now: Date): Promise<void> {
    const tasks = await this.loadTasks();
    if (tasks.length === 0) return;

    const reminders = this.reminderEngine.checkDeadlines(tasks, now);
    for (const reminder of reminders) {
      if (reminder.delivered || reminder.scheduledAt.getTime() > now.getTime()) continue;
      const key = `${reminder.type}:${reminder.taskId ?? reminder.message}`;
      if (!this.shouldSendReminderKey(key, now)) {
        reminder.delivered = true;
        this.reminderEngine.save();
        continue;
      }
      await this.notificationService.notify(reminder.message);
      reminder.delivered = true;
      this.reminderEngine.save();
      log.info('delivered deadline reminder', { key, reminderId: reminder.id, taskId: reminder.taskId, type: reminder.type });
    }
  }

  /**
   * Ask the LLM to review current state and decide whether to remind the user.
   * The LLM sees all tasks with deadlines, current time, and working hours config,
   * then decides like a human assistant would.
   */
  private async smartCheck(now: Date): Promise<void> {
    const tasks = await this.loadTasks();
    if (tasks.length === 0) return;

    const config = this.getConfig();

    // Build context for the LLM
    const timeStr = now.toLocaleString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
      weekday: 'long', hour: '2-digit', minute: '2-digit',
    });

    const taskSummary = tasks.map(t => {
      const due = t.dueDate ? `截止: ${new Date(t.dueDate).toLocaleString('zh-CN')}` : '无截止日期';
      return `- [${t.priority}/${t.status}] ${t.description} (${due})`;
    }).join('\n');

    const systemPrompt = [
      '你是一个智能办公助理的提醒决策模块。',
      '你的任务是审视用户当前的所有待办事项，决定是否需要现在提醒用户。',
      '',
      '像一个真正的人类助理那样思考：',
      '- 紧急且重要的事情要及时提醒',
      '- 不紧急的事情不要频繁打扰',
      '- 如果现在是非工作时间，除非特别紧急，否则不提醒',
      '- 已经逾期的任务需要提醒，但语气要温和',
      '- 提醒内容要简洁、自然，像人说话一样',
      '',
      '回复规则：',
      '- 如果需要提醒，直接输出提醒内容（中文，简洁自然）',
      '- 如果不需要提醒，只输出 "SKIP"（不要输出其他任何内容）',
      '- 不要输出解释、分析过程或格式标记',
      '',
      `工作时间配置: ${config.workingHours.start}-${config.workingHours.end}`,
      `提醒强度: ${config.reminder.intensity}`,
    ].join('\n');

    const userPrompt = [
      `当前时间: ${timeStr}`,
      '',
      '当前任务列表:',
      taskSummary || '（无任务）',
    ].join('\n');

    try {
      const ac = new AbortController();
      // 10 second timeout for reminder check
      const timeout = setTimeout(() => ac.abort(), 10_000);

      const response = await this.llm.query(systemPrompt, userPrompt, ac.signal);
      clearTimeout(timeout);

      const trimmed = response.trim();

      // LLM decided no reminder needed
      if (!trimmed || trimmed === 'SKIP' || trimmed.toUpperCase().includes('SKIP')) {
        log.debug('smart check skipped');
        return;
      }

      // LLM decided to remind — send it
      await this.notificationService.notify(trimmed);
      log.info('delivered smart reminder', { length: trimmed.length });
    } catch {
      log.warn('smart check failed');
      // LLM call failed — silently skip this cycle
    }
  }

  private shouldSendReminderKey(key: string, now: Date): boolean {
    const lastSentAt = this.recentReminderKeys.get(key);
    const minGapMs = 6 * 60 * 60 * 1000;
    if (lastSentAt && now.getTime() - lastSentAt < minGapMs) return false;
    this.recentReminderKeys.set(key, now.getTime());
    return true;
  }

  private scheduleNextDueTick(): void {
    this.clearNextDueTimer();
    if (!this.intervalId || !this.notificationService.hasChannels()) return;

    const next = this.reminderEngine.getNextPendingReminderTime();
    if (!next) return;

    const now = new Date();
    const delayMs = Math.max(0, next.getTime() - now.getTime());
    if (delayMs > this.intervalMs) return;

    this.nextDueTimerId = setTimeout(() => {
      this.nextDueTimerId = null;
      void this.tick();
    }, delayMs);
    this.nextDueTimerId.unref?.();
    log.info('scheduled next due reminder tick', { scheduledAt: next.toISOString(), delayMs });
  }

  private clearNextDueTimer(): void {
    if (!this.nextDueTimerId) return;
    clearTimeout(this.nextDueTimerId);
    this.nextDueTimerId = null;
  }

  private async loadTasks(): Promise<TaskItem[]> {
    try {
      const result = await this.toolRegistry.execute(
        'TaskManager',
        { action: 'list' },
        { abortSignal: new AbortController().signal, userConfig: this.getConfig() },
      );
      return (result.success && Array.isArray(result.output)) ? result.output as TaskItem[] : [];
    } catch {
      return [];
    }
  }
}
