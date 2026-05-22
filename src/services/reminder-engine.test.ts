/**
 * ReminderEngine unit tests — deadline reminders, smart reminders, scheduling.
 * Requirements: 5.1, 6.1, 6.4, 7.1
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { ReminderEngine } from './reminder-engine.js';
import type { UserConfig, TaskItem, Message } from '../types/index.js';

// ============================================================
// Helpers
// ============================================================

function makeConfig(overrides?: Partial<UserConfig>): UserConfig {
  return {
    workingHours: { start: '09:00', end: '18:00', workDays: [1, 2, 3, 4, 5] },
    reminder: {
      dailyBriefingTime: '09:00',
      weeklySummaryDay: 5,
      weeklySummaryTime: '17:00',
      intensity: 'standard',
    },
    awaySummary: { thresholdMinutes: 5 },
    feishu: { enabled: false },
    enabledTools: [],
    smartReminder: { staleProjectDays: 7 },
    timezone: 'Asia/Shanghai',
    ...overrides,
  };
}

function makeTask(overrides?: Partial<TaskItem>): TaskItem {
  const now = new Date();
  return {
    id: 'task-1',
    description: '完成季度报告',
    status: 'pending',
    priority: 'medium',
    subtaskIds: [],
    source: 'user_input',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMessage(content: string, role: 'user' | 'assistant' = 'user'): Message {
  return { role, content, timestamp: new Date() };
}

/** Create a Date on a specific weekday (Mon=1 … Fri=5). */
function dateOnWeekday(weekday: number, hour = 10, minute = 0): Date {
  const d = new Date(2025, 0, 6); // 2025-01-06 is Monday
  d.setDate(d.getDate() + (weekday - 1));
  d.setHours(hour, minute, 0, 0);
  return d;
}

// ============================================================
// Tests
// ============================================================

describe('ReminderEngine', () => {
  let engine: ReminderEngine;

  beforeEach(() => {
    engine = new ReminderEngine(makeConfig());
  });

  // --------------------------------------------------------
  // Daily briefing
  // --------------------------------------------------------
  describe('scheduleDailyBriefing', () => {
    it('generates a briefing on a working day', () => {
      const monday = dateOnWeekday(1);
      const tasks = [makeTask({ status: 'in_progress' })];
      const r = engine.scheduleDailyBriefing(tasks, monday);
      expect(r).not.toBeNull();
      expect(r!.type).toBe('daily_briefing');
      expect(r!.message).toContain('今日待办清单');
    });

    it('returns null on a weekend', () => {
      const sunday = dateOnWeekday(0); // Sunday
      const r = engine.scheduleDailyBriefing([makeTask()], sunday);
      expect(r).toBeNull();
    });

    it('includes tasks due today', () => {
      const monday = dateOnWeekday(1, 9, 0);
      const todayEnd = new Date(monday);
      todayEnd.setHours(18, 0, 0, 0);
      const tasks = [makeTask({ dueDate: todayEnd, status: 'pending' })];
      const r = engine.scheduleDailyBriefing(tasks, monday);
      expect(r!.message).toContain('今日截止');
    });
  });

  // --------------------------------------------------------
  // Weekly summary
  // --------------------------------------------------------
  describe('scheduleWeeklySummary', () => {
    it('generates a summary on the configured day (Friday)', () => {
      const friday = dateOnWeekday(5);
      const tasks = [makeTask({ status: 'completed', completedAt: friday })];
      const r = engine.scheduleWeeklySummary(tasks, friday);
      expect(r).not.toBeNull();
      expect(r!.type).toBe('weekly_summary');
      expect(r!.message).toContain('本周工作总结');
    });

    it('returns null on non-summary day', () => {
      const monday = dateOnWeekday(1);
      const r = engine.scheduleWeeklySummary([], monday);
      expect(r).toBeNull();
    });
  });

  // --------------------------------------------------------
  // Deadline reminders
  // --------------------------------------------------------
  describe('checkDeadlines', () => {
    it('creates urgent reminder for task due in < 24h', () => {
      const now = dateOnWeekday(1, 10, 0);
      const dueIn12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
      const tasks = [makeTask({ dueDate: dueIn12h, status: 'in_progress' })];

      const reminders = engine.checkDeadlines(tasks, now);
      expect(reminders).toHaveLength(1);
      expect(reminders[0].type).toBe('deadline_urgent');
      expect(reminders[0].taskId).toBe('task-1');
    });

    it('creates warning for pending task due in < 3 days', () => {
      const now = dateOnWeekday(1, 10, 0);
      const dueIn2d = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const tasks = [makeTask({ dueDate: dueIn2d, status: 'pending' })];

      const reminders = engine.checkDeadlines(tasks, now);
      expect(reminders).toHaveLength(1);
      expect(reminders[0].type).toBe('deadline_warning');
    });

    it('skips completed tasks', () => {
      const now = dateOnWeekday(1, 10, 0);
      const dueIn12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
      const tasks = [makeTask({ dueDate: dueIn12h, status: 'completed' })];

      const reminders = engine.checkDeadlines(tasks, now);
      expect(reminders).toHaveLength(0);
    });

    it('auto-cancels reminders for cancelled tasks', () => {
      const now = dateOnWeekday(1, 10, 0);
      const dueIn12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
      const tasks = [makeTask({ dueDate: dueIn12h, status: 'in_progress' })];

      engine.cancelReminder('task-1');
      const reminders = engine.checkDeadlines(tasks, now);
      expect(reminders).toHaveLength(0);
    });

    it('respects custom reminderAdvance', () => {
      const now = dateOnWeekday(1, 10, 0);
      // Due in 30 hours — normally no urgent reminder, but custom advance = 2880 min (48h)
      const dueIn30h = new Date(now.getTime() + 30 * 60 * 60 * 1000);
      const tasks = [makeTask({ dueDate: dueIn30h, status: 'in_progress', reminderAdvance: 2880 })];

      const reminders = engine.checkDeadlines(tasks, now);
      expect(reminders).toHaveLength(1);
      expect(reminders[0].type).toBe('deadline_urgent');
    });

    it('pauses non-urgent reminders outside working hours', () => {
      // 22:00 on Monday — outside working hours
      const now = dateOnWeekday(1, 22, 0);
      const dueIn2d = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const tasks = [makeTask({ dueDate: dueIn2d, status: 'pending' })];

      const reminders = engine.checkDeadlines(tasks, now);
      // Warning is non-urgent → should be paused
      expect(reminders).toHaveLength(0);
    });

    it('still sends urgent reminders outside working hours', () => {
      const now = dateOnWeekday(1, 22, 0);
      const dueIn6h = new Date(now.getTime() + 6 * 60 * 60 * 1000);
      const tasks = [makeTask({ dueDate: dueIn6h, status: 'in_progress' })];

      const reminders = engine.checkDeadlines(tasks, now);
      expect(reminders).toHaveLength(1);
      expect(reminders[0].type).toBe('deadline_urgent');
    });
  });

  // --------------------------------------------------------
  // Smart reminders — deferred actions
  // --------------------------------------------------------
  describe('analyzeForSmartReminders — deferred actions', () => {
    it('detects "稍后做" and creates follow-up', () => {
      const msgs = [makeMessage('这个需求我稍后做')];
      const reminders = engine.analyzeForSmartReminders(msgs, []);
      expect(reminders.some((r) => r.type === 'smart_followup')).toBe(true);
      expect(reminders[0].reason).toContain('延迟性表述');
    });

    it('detects "回头处理"', () => {
      const msgs = [makeMessage('这件事回头处理一下')];
      const reminders = engine.analyzeForSmartReminders(msgs, []);
      expect(reminders.some((r) => r.type === 'smart_followup')).toBe(true);
    });

    it('ignores assistant messages', () => {
      const msgs = [makeMessage('稍后做', 'assistant')];
      const reminders = engine.analyzeForSmartReminders(msgs, []);
      expect(reminders).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // Smart reminders — commitment tracking
  // --------------------------------------------------------
  describe('analyzeForSmartReminders — commitments', () => {
    it('detects "我来处理" and creates commitment reminder', () => {
      const msgs = [makeMessage('这个问题我来处理')];
      const reminders = engine.analyzeForSmartReminders(msgs, []);
      expect(reminders.some((r) => r.type === 'smart_commitment')).toBe(true);
      expect(reminders[0].reason).toContain('承诺表述');
    });

    it('detects "我发给你"', () => {
      const msgs = [makeMessage('文件我发给你')];
      const reminders = engine.analyzeForSmartReminders(msgs, []);
      expect(reminders.some((r) => r.type === 'smart_commitment')).toBe(true);
    });
  });

  // --------------------------------------------------------
  // Smart reminders — stale projects
  // --------------------------------------------------------
  describe('analyzeForSmartReminders — stale projects', () => {
    it('detects stale project with no updates beyond threshold', () => {
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const tasks = [
        makeTask({ projectId: 'proj-a', updatedAt: tenDaysAgo, status: 'in_progress' }),
      ];

      const reminders = engine.analyzeForSmartReminders([], tasks, now);
      expect(reminders.some((r) => r.type === 'smart_stale_project')).toBe(true);
      expect(reminders.find((r) => r.type === 'smart_stale_project')!.message).toContain('proj-a');
    });

    it('does not flag recently updated projects', () => {
      const now = new Date();
      const tasks = [
        makeTask({ projectId: 'proj-b', updatedAt: now, status: 'in_progress' }),
      ];

      const reminders = engine.analyzeForSmartReminders([], tasks, now);
      expect(reminders.filter((r) => r.type === 'smart_stale_project')).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // Smart reminders — forgotten tasks
  // --------------------------------------------------------
  describe('analyzeForSmartReminders — forgotten tasks', () => {
    it('detects a high-priority task pending for > 24h', () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      const tasks = [
        makeTask({ priority: 'high', createdAt: twoDaysAgo, status: 'pending' }),
      ];

      const reminders = engine.analyzeForSmartReminders([], tasks, now);
      expect(reminders.some((r) => r.message.includes('遗忘提醒'))).toBe(true);
    });

    it('does not flag in-progress tasks', () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      const tasks = [
        makeTask({ priority: 'high', createdAt: twoDaysAgo, status: 'in_progress' }),
      ];

      const reminders = engine.analyzeForSmartReminders([], tasks, now);
      expect(reminders.filter((r) => r.message.includes('遗忘提醒'))).toHaveLength(0);
    });

    it('respects intensity setting — high intensity triggers sooner', () => {
      const highEngine = new ReminderEngine(
        makeConfig({ reminder: { dailyBriefingTime: '09:00', weeklySummaryDay: 5, weeklySummaryTime: '17:00', intensity: 'high' } }),
      );
      const now = new Date();
      // 14 hours ago — medium priority base threshold is 72h, but high intensity halves it to 36h
      // This should NOT trigger yet (14h < 36h)
      const fourteenHoursAgo = new Date(now.getTime() - 14 * 60 * 60 * 1000);
      const tasks = [makeTask({ priority: 'medium', createdAt: fourteenHoursAgo, status: 'pending' })];

      const reminders = highEngine.analyzeForSmartReminders([], tasks, now);
      expect(reminders.filter((r) => r.message.includes('遗忘提醒'))).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // cancelReminder
  // --------------------------------------------------------
  describe('cancelReminder', () => {
    it('removes pending reminders for a task and prevents future ones', () => {
      const now = dateOnWeekday(1, 10, 0);
      const dueIn12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
      const tasks = [makeTask({ dueDate: dueIn12h, status: 'in_progress' })];

      // Generate a reminder first
      engine.checkDeadlines(tasks, now);
      expect(engine.getPendingReminders()).toHaveLength(1);

      // Cancel it
      engine.cancelReminder('task-1');
      expect(engine.getPendingReminders()).toHaveLength(0);

      // Future checks should also skip this task
      const again = engine.checkDeadlines(tasks, now);
      expect(again).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('persists pending reminders for proactive delivery after restart', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-reminders-'));
      const storagePath = path.join(dir, 'reminders.json');
      const persistent = new ReminderEngine(makeConfig(), storagePath);
      const now = new Date();

      persistent.addReminder({
        id: 'reminder-1',
        type: 'smart_followup',
        message: '测试持久化提醒',
        reason: 'test',
        scheduledAt: now,
        delivered: false,
      });

      const restored = new ReminderEngine(makeConfig(), storagePath);
      expect(restored.getPendingReminders()).toHaveLength(1);
      expect(restored.getPendingReminders()[0]?.scheduledAt).toBeInstanceOf(Date);
      expect(restored.getPendingReminders()[0]?.message).toBe('测试持久化提醒');
    });
  });
});
