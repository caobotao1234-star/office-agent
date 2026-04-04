/**
 * ReminderLoop — Background loop that checks and delivers reminders.
 *
 * Runs every 30 seconds. Checks:
 * 1. Pending reminders from ReminderEngine (deadline alerts, smart reminders)
 * 2. Daily briefing / weekly summary at configured times
 * 3. Deadline checks on all tasks
 *
 * Delivers via NotificationService to all registered channels (CLI, Feishu, etc.)
 *
 * Requirements: 5.1-5.5, 6.1-6.4, 7.1-7.5
 */

import type { ReminderEngine } from './reminder-engine.js';
import type { NotificationService } from './notification-service.js';
import type { ToolRegistry } from '../core/tool-system.js';
import type { TaskItem, UserConfig } from '../types/index.js';

export class ReminderLoop {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private reminderEngine: ReminderEngine;
  private notificationService: NotificationService;
  private toolRegistry: ToolRegistry;
  private getConfig: () => UserConfig;
  private lastDailyBriefingDate: string | null = null;
  private lastWeeklySummaryDate: string | null = null;
  /** Track which task IDs have already been notified to prevent spam */
  private deliveredTaskIds = new Set<string>();

  constructor(opts: {
    reminderEngine: ReminderEngine;
    notificationService: NotificationService;
    toolRegistry: ToolRegistry;
    getConfig: () => UserConfig;
  }) {
    this.reminderEngine = opts.reminderEngine;
    this.notificationService = opts.notificationService;
    this.toolRegistry = opts.toolRegistry;
    this.getConfig = opts.getConfig;
  }

  start(): void {
    if (this.intervalId) return;
    // Check every 30 seconds
    this.intervalId = setInterval(() => { void this.tick(); }, 30_000);
    // Also run immediately
    void this.tick();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async tick(now = new Date()): Promise<void> {
    if (!this.notificationService.hasChannels()) return;

    const tasks = await this.loadTasks();

    // 1. Check daily briefing
    this.checkDailyBriefing(tasks, now);

    // 2. Check weekly summary
    this.checkWeeklySummary(tasks, now);

    // 3. Check deadlines — only generate new reminders for tasks
    //    that don't already have a pending/delivered reminder
    const existingTaskIds = new Set(
      this.reminderEngine.getPendingReminders()
        .filter(r => r.taskId)
        .map(r => r.taskId),
    );
    const deadlineReminders = this.reminderEngine.checkDeadlines(tasks, now);
    for (const r of deadlineReminders) {
      // Skip if we already notified about this task
      if (r.taskId && this.deliveredTaskIds.has(r.taskId)) continue;
      if (!r.delivered) {
        await this.notificationService.notify(r.message);
        r.delivered = true;
        if (r.taskId) this.deliveredTaskIds.add(r.taskId);
      }
    }

    // 4. Deliver any pending user-created reminders that are due
    const pending = this.reminderEngine.getPendingReminders();
    for (const r of pending) {
      if (r.delivered) continue;
      if (r.scheduledAt.getTime() <= now.getTime()) {
        if (r.taskId && this.deliveredTaskIds.has(r.taskId)) continue;
        await this.notificationService.notify(r.message);
        r.delivered = true;
        if (r.taskId) this.deliveredTaskIds.add(r.taskId);
      }
    }
  }

  private checkDailyBriefing(tasks: TaskItem[], now: Date): void {
    const todayStr = now.toISOString().slice(0, 10);
    if (this.lastDailyBriefingDate === todayStr) return;

    const config = this.getConfig();
    const [h, m] = config.reminder.dailyBriefingTime.split(':').map(Number);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const targetMins = h * 60 + m;

    // Fire if we're within 2 minutes of the target time
    if (Math.abs(nowMins - targetMins) <= 2) {
      const reminder = this.reminderEngine.scheduleDailyBriefing(tasks, now);
      if (reminder) {
        void this.notificationService.notify(reminder.message);
        reminder.delivered = true;
        this.lastDailyBriefingDate = todayStr;
      }
    }
  }

  private checkWeeklySummary(tasks: TaskItem[], now: Date): void {
    const todayStr = now.toISOString().slice(0, 10);
    if (this.lastWeeklySummaryDate === todayStr) return;

    const config = this.getConfig();
    if (now.getDay() !== config.reminder.weeklySummaryDay) return;

    const [h, m] = config.reminder.weeklySummaryTime.split(':').map(Number);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const targetMins = h * 60 + m;

    if (Math.abs(nowMins - targetMins) <= 2) {
      const reminder = this.reminderEngine.scheduleWeeklySummary(tasks, now);
      if (reminder) {
        void this.notificationService.notify(reminder.message);
        reminder.delivered = true;
        this.lastWeeklySummaryDate = todayStr;
      }
    }
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
