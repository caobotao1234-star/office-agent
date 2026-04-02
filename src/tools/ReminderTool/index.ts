/**
 * ReminderTool — Tool interface wrapper for ReminderEngine.
 *
 * Operations: create, cancel, list
 * Delegates to ReminderEngine for actual logic.
 *
 * Requirements: 5.1, 6.3
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult, Reminder } from '../../types/index.js';
import type { ReminderEngine } from '../../services/reminder-engine.js';

// ============================================================
// Input Schema
// ============================================================

const CreateReminderInput = z.object({
  action: z.literal('create'),
  message: z.string().min(1),
  scheduledAt: z.coerce.date(),
  taskId: z.string().optional(),
});

const CancelReminderInput = z.object({
  action: z.literal('cancel'),
  taskId: z.string().min(1),
});

const ListRemindersInput = z.object({
  action: z.literal('list'),
});

const ReminderToolInput = z.discriminatedUnion('action', [
  CreateReminderInput,
  CancelReminderInput,
  ListRemindersInput,
]);

export type ReminderToolInput = z.infer<typeof ReminderToolInput>;

// ============================================================
// ReminderTool
// ============================================================

export class ReminderTool implements Tool<ReminderToolInput, unknown> {
  readonly name = 'ReminderTool';
  readonly description = 'Manage reminders: create, cancel, and list pending reminders.';
  readonly inputSchema = ReminderToolInput;

  private engine: ReminderEngine;
  private enabled = true;

  constructor(engine: ReminderEngine) {
    this.engine = engine;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isReadOnly(input: ReminderToolInput): boolean {
    return input.action === 'list';
  }

  checkPermissions(_input: ReminderToolInput): PermissionResult {
    return { allowed: true };
  }

  requiresUserConfirmation(input: ReminderToolInput): boolean {
    return !this.isReadOnly(input);
  }

  async call(input: ReminderToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'create': {
          // Delegate: the engine manages the pending list internally
          const reminders = this.engine.getPendingReminders();
          const reminder: Reminder = {
            id: crypto.randomUUID(),
            type: 'smart_followup',
            taskId: input.taskId,
            message: input.message,
            reason: '用户手动创建',
            scheduledAt: input.scheduledAt,
            delivered: false,
          };
          reminders.push(reminder);
          return { success: true, output: reminder };
        }
        case 'cancel': {
          this.engine.cancelReminder(input.taskId);
          return { success: true, output: { cancelled: true, taskId: input.taskId } };
        }
        case 'list': {
          return { success: true, output: this.engine.getPendingReminders() };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: null, error: message };
    }
  }
}
