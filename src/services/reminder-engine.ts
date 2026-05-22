/**
 * ReminderEngine — Scheduled reminders, deadline alerts, and smart reminders.
 *
 * Task 10.1: Daily briefing, weekly summary, deadline checks,
 *            custom reminder advance, auto-cancel on completion,
 *            pause non-urgent during off-hours.
 * Task 10.2: Smart reminders — deferred-action detection, commitment tracking,
 *            stale project detection, forgotten task detection.
 *
 * Requirements: 5.1-5.5, 6.1-6.4, 7.1-7.5, 12.2, 12.3
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Reminder, TaskItem, Message, UserConfig } from '../types/index.js';
import { logger } from '../core/logger.js';

const log = logger.child('ReminderEngine');

// ============================================================
// Time helpers
// ============================================================

/** Parse "HH:MM" into { hour, minute }. */
function parseTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':').map(Number);
  return { hour: h, minute: m };
}

/** Check if `now` falls within the user's configured working hours. */
function isWorkingTime(now: Date, config: UserConfig): boolean {
  const day = now.getDay(); // 0=Sun … 6=Sat
  if (!config.workingHours.workDays.includes(day)) return false;

  const { hour: startH, minute: startM } = parseTime(config.workingHours.start);
  const { hour: endH, minute: endM } = parseTime(config.workingHours.end);

  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= startH * 60 + startM && mins < endH * 60 + endM;
}

/** Check if today is a working day. */
function isWorkDay(now: Date, config: UserConfig): boolean {
  return config.workingHours.workDays.includes(now.getDay());
}

// ============================================================
// Smart-reminder regex patterns
// ============================================================

const DEFERRED_PATTERNS = [
  /稍后做/,
  /回头处理/,
  /明天再说/,
  /等一下再/,
  /待会儿/,
  /之后再/,
  /晚点/,
  /later/i,
  /do it later/i,
  /deal with it tomorrow/i,
];

const COMMITMENT_PATTERNS = [
  /我来处理/,
  /我发给你/,
  /我去做/,
  /我来搞定/,
  /我负责/,
  /交给我/,
  /I'll handle/i,
  /I'll send/i,
  /I will take care/i,
];

// ============================================================
// ReminderEngine
// ============================================================

export class ReminderEngine {
  private config: UserConfig;
  private pendingReminders: Reminder[] = [];
  private cancelledTaskIds = new Set<string>();
  private storagePath: string | undefined;

  constructor(config: UserConfig, storagePath?: string) {
    this.config = config;
    this.storagePath = storagePath;
    this.load();
  }

  // ----------------------------------------------------------
  // Configuration
  // ----------------------------------------------------------

  /** Update the user config (e.g. after user changes settings). */
  updateConfig(config: UserConfig): void {
    this.config = config;
  }

  setReminderIntensity(level: 'low' | 'standard' | 'high'): void {
    this.config.reminder.intensity = level;
  }

  // ----------------------------------------------------------
  // Pending reminders management
  // ----------------------------------------------------------

  getPendingReminders(): Reminder[] {
    return this.pendingReminders;
  }

  addReminder(reminder: Reminder): void {
    this.pendingReminders.push(reminder);
    this.save();
  }

  save(): void {
    if (!this.storagePath) return;
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify({
        pendingReminders: this.pendingReminders,
        cancelledTaskIds: [...this.cancelledTaskIds],
      }, null, 2));
    } catch (err) {
      log.error('save failed', { error: err instanceof Error ? err.message : String(err), storagePath: this.storagePath });
    }
  }

  /** Cancel all pending reminders for a given task. */
  cancelReminder(taskId: string): void {
    this.cancelledTaskIds.add(taskId);
    this.pendingReminders = this.pendingReminders.filter(
      (r) => r.taskId !== taskId,
    );
    this.save();
  }

  // ----------------------------------------------------------
  // 10.1 — Scheduled reminders
  // ----------------------------------------------------------

  /**
   * Generate a daily briefing reminder.
   * Only fires on working days at the configured time.
   */
  scheduleDailyBriefing(tasks: TaskItem[], now = new Date()): Reminder | null {
    if (!isWorkDay(now, this.config)) return null;

    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const dueTodayOrInProgress = tasks.filter(
      (t) =>
        (t.status === 'pending' || t.status === 'in_progress') &&
        !this.cancelledTaskIds.has(t.id),
    );

    const dueToday = dueTodayOrInProgress.filter(
      (t) => t.dueDate && t.dueDate.getTime() <= todayEnd.getTime(),
    );
    const inProgress = dueTodayOrInProgress.filter(
      (t) => t.status === 'in_progress',
    );

    const lines: string[] = ['📋 今日待办清单'];
    if (dueToday.length > 0) {
      lines.push(`\n今日截止 (${dueToday.length}):`);
      dueToday.forEach((t) => lines.push(`  - [${t.priority}] ${t.description}`));
    }
    if (inProgress.length > 0) {
      lines.push(`\n进行中 (${inProgress.length}):`);
      inProgress.forEach((t) => lines.push(`  - ${t.description}`));
    }
    if (dueToday.length === 0 && inProgress.length === 0) {
      lines.push('\n今天暂无紧急待办，保持好状态！');
    }

    const { hour, minute } = parseTime(this.config.reminder.dailyBriefingTime);
    const scheduledAt = new Date(now);
    scheduledAt.setHours(hour, minute, 0, 0);

    const reminder: Reminder = {
      id: randomUUID(),
      type: 'daily_briefing',
      message: lines.join('\n'),
      reason: '每日定时待办清单',
      scheduledAt,
      delivered: false,
    };
    this.pendingReminders.push(reminder);
    this.save();
    return reminder;
  }

  /**
   * Generate a weekly summary reminder.
   * Only fires on the configured summary day.
   */
  scheduleWeeklySummary(tasks: TaskItem[], now = new Date()): Reminder | null {
    if (now.getDay() !== this.config.reminder.weeklySummaryDay) return null;

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const completedThisWeek = tasks.filter(
      (t) => t.status === 'completed' && t.completedAt && t.completedAt >= weekAgo,
    );
    const pending = tasks.filter(
      (t) => t.status === 'pending' || t.status === 'in_progress',
    );
    const overdue = tasks.filter((t) => t.status === 'overdue');

    const lines: string[] = ['📊 本周工作总结'];
    lines.push(`\n已完成 (${completedThisWeek.length}):`);
    completedThisWeek.forEach((t) => lines.push(`  ✅ ${t.description}`));
    if (pending.length > 0) {
      lines.push(`\n未完成 (${pending.length}):`);
      pending.forEach((t) => lines.push(`  ⏳ ${t.description}`));
    }
    if (overdue.length > 0) {
      lines.push(`\n已逾期 (${overdue.length}):`);
      overdue.forEach((t) => lines.push(`  ⚠️ ${t.description}`));
    }

    const { hour, minute } = parseTime(this.config.reminder.weeklySummaryTime);
    const scheduledAt = new Date(now);
    scheduledAt.setHours(hour, minute, 0, 0);

    const reminder: Reminder = {
      id: randomUUID(),
      type: 'weekly_summary',
      message: lines.join('\n'),
      reason: '每周定时工作总结',
      scheduledAt,
      delivered: false,
    };
    this.pendingReminders.push(reminder);
    this.save();
    return reminder;
  }

  // ----------------------------------------------------------
  // 10.1 — Deadline reminders
  // ----------------------------------------------------------

  /**
   * Check all tasks for approaching deadlines.
   * - < 24h → urgent
   * - < 3 days → warning (only for 'pending' tasks)
   * Respects per-task `reminderAdvance`, auto-cancels completed tasks,
   * and pauses non-urgent reminders outside working hours.
   */
  checkDeadlines(tasks: TaskItem[], now = new Date()): Reminder[] {
    const reminders: Reminder[] = [];
    const working = isWorkingTime(now, this.config);

    for (const task of tasks) {
      // Skip completed / cancelled / already-cancelled tasks
      if (task.status === 'completed' || task.status === 'cancelled') continue;
      if (this.cancelledTaskIds.has(task.id)) continue;
      if (!task.dueDate) continue;

      const msLeft = task.dueDate.getTime() - now.getTime();
      const hoursLeft = msLeft / (1000 * 60 * 60);

      // Per-task custom advance (in minutes), converted to hours
      const customAdvanceHours = task.reminderAdvance
        ? task.reminderAdvance / 60
        : undefined;

      // Urgent: < 24h (or custom advance)
      const urgentThreshold = customAdvanceHours ?? 24;
      if (hoursLeft > 0 && hoursLeft <= urgentThreshold && (task.status === 'pending' || task.status === 'in_progress')) {
        reminders.push({
          id: randomUUID(),
          type: 'deadline_urgent',
          taskId: task.id,
          message: `🚨 紧急：「${task.description}」将在 ${Math.ceil(hoursLeft)} 小时后截止`,
          reason: `截止日期不足 ${Math.ceil(urgentThreshold)} 小时`,
          scheduledAt: now,
          delivered: false,
        });
        continue; // don't also send a warning
      }

      // Warning: < 3 days, only for pending tasks
      const warningThreshold = customAdvanceHours ?? 72;
      if (hoursLeft > 0 && hoursLeft <= warningThreshold && task.status === 'pending') {
        // Non-urgent → skip outside working hours
        if (!working) continue;

        reminders.push({
          id: randomUUID(),
          type: 'deadline_warning',
          taskId: task.id,
          message: `⚠️ 预警：「${task.description}」将在 ${Math.ceil(hoursLeft / 24)} 天后截止，当前状态仍为待开始`,
          reason: `截止日期不足 3 天且任务尚未开始`,
          scheduledAt: now,
          delivered: false,
        });
      }
    }

    this.pendingReminders.push(...reminders);
    if (reminders.length > 0) this.save();
    return reminders;
  }

  // ----------------------------------------------------------
  // 10.2 — Smart reminders
  // ----------------------------------------------------------

  /**
   * Analyze messages and tasks for smart reminders:
   * 1. Deferred-action detection (延迟性表述)
   * 2. Commitment tracking (承诺追踪)
   * 3. Stale project detection (项目停滞)
   * 4. Forgotten task detection (遗忘任务)
   */
  analyzeForSmartReminders(
    messages: Message[],
    tasks: TaskItem[],
    now = new Date(),
  ): Reminder[] {
    const reminders: Reminder[] = [];

    // 1. Deferred-action detection
    reminders.push(...this.detectDeferredActions(messages, now));

    // 2. Commitment tracking
    reminders.push(...this.detectCommitments(messages, now));

    // 3. Stale project detection
    reminders.push(...this.detectStaleProjects(tasks, now));

    // 4. Forgotten task detection
    reminders.push(...this.detectForgottenTasks(tasks, now));

    this.pendingReminders.push(...reminders);
    if (reminders.length > 0) this.save();
    return reminders;
  }

  private load(): void {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8')) as {
        pendingReminders?: Array<Omit<Reminder, 'scheduledAt'> & { scheduledAt: string }>;
        cancelledTaskIds?: string[];
      };
      this.pendingReminders = (parsed.pendingReminders ?? []).map((r) => ({
        ...r,
        scheduledAt: new Date(r.scheduledAt),
      }));
      this.cancelledTaskIds = new Set(parsed.cancelledTaskIds ?? []);
      log.info('loaded reminders', { count: this.pendingReminders.length, storagePath: this.storagePath });
    } catch (err) {
      log.error('load failed', { error: err instanceof Error ? err.message : String(err), storagePath: this.storagePath });
      this.pendingReminders = [];
      this.cancelledTaskIds = new Set();
    }
  }

  // ----------------------------------------------------------
  // Smart reminder sub-routines
  // ----------------------------------------------------------

  private detectDeferredActions(messages: Message[], now: Date): Reminder[] {
    const reminders: Reminder[] = [];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const pattern of DEFERRED_PATTERNS) {
        if (pattern.test(msg.content)) {
          reminders.push({
            id: randomUUID(),
            type: 'smart_followup',
            message: `🔔 跟进提醒：你之前提到「${this.excerpt(msg.content)}」，是否已经处理？`,
            reason: `检测到延迟性表述「${pattern.source}」，创建跟进提醒`,
            scheduledAt: this.computeFollowupTime(now),
            delivered: false,
          });
          break; // one reminder per message
        }
      }
    }

    return reminders;
  }

  private detectCommitments(messages: Message[], now: Date): Reminder[] {
    const reminders: Reminder[] = [];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const pattern of COMMITMENT_PATTERNS) {
        if (pattern.test(msg.content)) {
          reminders.push({
            id: randomUUID(),
            type: 'smart_commitment',
            message: `📌 承诺追踪：你曾说「${this.excerpt(msg.content)}」，请确认是否已兑现`,
            reason: `检测到承诺表述「${pattern.source}」，需要在合理时间内检查是否兑现`,
            scheduledAt: this.computeCommitmentCheckTime(now),
            delivered: false,
          });
          break;
        }
      }
    }

    return reminders;
  }

  private detectStaleProjects(tasks: TaskItem[], now: Date): Reminder[] {
    const staleDays = this.config.smartReminder.staleProjectDays;
    const staleThreshold = staleDays * 24 * 60 * 60 * 1000;

    // Group tasks by projectId, find projects with no recent updates
    const projectMap = new Map<string, Date>();
    for (const task of tasks) {
      if (!task.projectId) continue;
      if (task.status === 'completed' || task.status === 'cancelled') continue;

      const existing = projectMap.get(task.projectId);
      if (!existing || task.updatedAt > existing) {
        projectMap.set(task.projectId, task.updatedAt);
      }
    }

    const reminders: Reminder[] = [];
    for (const [projectId, lastUpdate] of projectMap) {
      if (now.getTime() - lastUpdate.getTime() > staleThreshold) {
        const daysSinceUpdate = Math.floor(
          (now.getTime() - lastUpdate.getTime()) / (24 * 60 * 60 * 1000),
        );
        reminders.push({
          id: randomUUID(),
          type: 'smart_stale_project',
          message: `📁 项目停滞提醒：项目「${projectId}」已 ${daysSinceUpdate} 天没有更新`,
          reason: `项目超过 ${staleDays} 天无任何更新，可能需要关注`,
          scheduledAt: now,
          delivered: false,
        });
      }
    }

    return reminders;
  }

  private detectForgottenTasks(tasks: TaskItem[], now: Date): Reminder[] {
    const reminders: Reminder[] = [];

    // Intensity affects thresholds
    const intensityMultiplier =
      this.config.reminder.intensity === 'high' ? 0.5
        : this.config.reminder.intensity === 'low' ? 2
          : 1;

    for (const task of tasks) {
      if (task.status !== 'pending') continue;
      if (this.cancelledTaskIds.has(task.id)) continue;

      const ageHours =
        (now.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60);

      // Threshold based on priority (hours since creation without progress)
      const baseThreshold: Record<string, number> = {
        urgent: 4,
        high: 24,
        medium: 72,
        low: 168, // 7 days
      };

      const threshold =
        (baseThreshold[task.priority] ?? 72) * intensityMultiplier;

      if (ageHours >= threshold) {
        reminders.push({
          id: randomUUID(),
          type: 'smart_followup',
          taskId: task.id,
          message: `💡 遗忘提醒：「${task.description}」创建于 ${Math.floor(ageHours / 24)} 天前，优先级为 ${task.priority}，但仍未开始`,
          reason: `任务创建已超过 ${Math.floor(ageHours)} 小时，优先级 ${task.priority}，可能被遗忘`,
          scheduledAt: now,
          delivered: false,
        });
      }
    }

    return reminders;
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  /** Truncate message content for display. */
  private excerpt(content: string, maxLen = 30): string {
    return content.length > maxLen ? content.slice(0, maxLen) + '…' : content;
  }

  /** Compute a reasonable follow-up time (next working hour, ~2h later). */
  private computeFollowupTime(now: Date): Date {
    const followup = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    return followup;
  }

  /** Compute a reasonable commitment check time (~4h later). */
  private computeCommitmentCheckTime(now: Date): Date {
    return new Date(now.getTime() + 4 * 60 * 60 * 1000);
  }
}
