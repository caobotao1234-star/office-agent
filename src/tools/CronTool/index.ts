/**
 * CronTool — Tool interface wrapper for CronScheduler.
 *
 * Operations: create, delete, list
 * Delegates to CronScheduler for actual logic.
 *
 * Requirements: 17.6
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import type { CronScheduler } from '../../services/cron-scheduler.js';

// ============================================================
// Input Schema
// ============================================================

const CreateCronInput = z.object({
  action: z.literal('create'),
  type: z.enum(['one_time', 'recurring']),
  cronExpression: z.string().optional(),
  scheduledAt: z.coerce.date().optional(),
  prompt: z.string().min(1),
  description: z.string().min(1),
  timezone: z.string().default('Asia/Shanghai'),
  durable: z.boolean().default(true),
});

const DeleteCronInput = z.object({
  action: z.literal('delete'),
  id: z.string().min(1),
});

const ListCronInput = z.object({
  action: z.literal('list'),
});

const CronToolInput = z.discriminatedUnion('action', [
  CreateCronInput,
  DeleteCronInput,
  ListCronInput,
]);

export type CronToolInput = z.infer<typeof CronToolInput>;

// ============================================================
// CronTool
// ============================================================

export class CronTool implements Tool<CronToolInput, unknown> {
  readonly name = 'CronTool';
  readonly description = 'Manage scheduled cron tasks: create, delete, and list.';
  readonly inputSchema = CronToolInput;
  readonly parametersJsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'delete', 'list'] },
      type: { type: 'string', enum: ['one_time', 'recurring'] },
      cronExpression: { type: 'string' }, scheduledAt: { type: 'string' },
      prompt: { type: 'string' }, description: { type: 'string' },
      timezone: { type: 'string' }, durable: { type: 'boolean' },
      id: { type: 'string' },
    },
    required: ['action'],
  };

  private scheduler: CronScheduler;
  private enabled = true;

  constructor(scheduler: CronScheduler) {
    this.scheduler = scheduler;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isReadOnly(input: CronToolInput): boolean {
    return input.action === 'list';
  }

  checkPermissions(_input: CronToolInput): PermissionResult {
    return { allowed: true };
  }

  requiresUserConfirmation(input: CronToolInput): boolean {
    return !this.isReadOnly(input);
  }

  async call(input: CronToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'create': {
          const task = this.scheduler.create({
            type: input.type,
            cronExpression: input.cronExpression,
            scheduledAt: input.scheduledAt,
            prompt: input.prompt,
            description: input.description,
            timezone: input.timezone,
            durable: input.durable,
          });
          return { success: true, output: task };
        }
        case 'delete': {
          this.scheduler.delete(input.id);
          return { success: true, output: { deleted: true, id: input.id } };
        }
        case 'list': {
          return { success: true, output: this.scheduler.list() };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: null, error: message };
    }
  }
}
