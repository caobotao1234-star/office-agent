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

/** Default interval: 15 minutes */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/** Minimum interval between LLM reminder checks: 10 minutes */
const MIN_CHECK_INTERVAL_MS = 10 * 60 * 1000;

export class ReminderLoop {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private reminderEngine: ReminderEngine;
  private notificationService: NotificationService;
  private toolRegistry: ToolRegistry;
  private llm: LLMClient;
  private getConfig: () => UserConfig;
  private lastLLMCheckAt: number = 0;
  private intervalMs: number;

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
    this.intervalId = setInterval(() => { void this.tick(); }, this.intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async tick(now = new Date()): Promise<void> {
    if (!this.notificationService.hasChannels()) return;

    // 1. Always deliver user-created scheduled reminders (these are explicit, not LLM-decided)
    await this.deliverScheduledReminders(now);

    // 2. LLM-driven smart check — throttled to avoid excessive API calls
    const elapsed = now.getTime() - this.lastLLMCheckAt;
    if (elapsed >= MIN_CHECK_INTERVAL_MS) {
      await this.smartCheck(now);
      this.lastLLMCheckAt = now.getTime();
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
      }
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
        return;
      }

      // LLM decided to remind — send it
      await this.notificationService.notify(trimmed);
    } catch {
      // LLM call failed — silently skip this cycle
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
