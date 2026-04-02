/**
 * BackgroundTaskTool — Tool interface wrapper for BackgroundTaskManager.
 *
 * Operations: list, cancel
 * Delegates to BackgroundTaskManager for actual logic.
 *
 * Requirements: 18.1
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import type { BackgroundTaskManager } from '../../services/background-task-manager.js';

// ============================================================
// Input Schema
// ============================================================

const ListBgTaskInput = z.object({
  action: z.literal('list'),
});

const CancelBgTaskInput = z.object({
  action: z.literal('cancel'),
  taskId: z.string().min(1),
});

const BackgroundTaskToolInput = z.discriminatedUnion('action', [
  ListBgTaskInput,
  CancelBgTaskInput,
]);

export type BackgroundTaskToolInput = z.infer<typeof BackgroundTaskToolInput>;

// ============================================================
// BackgroundTaskTool
// ============================================================

export class BackgroundTaskTool implements Tool<BackgroundTaskToolInput, unknown> {
  readonly name = 'BackgroundTaskTool';
  readonly description = 'Manage background tasks: list running tasks and cancel them.';
  readonly inputSchema = BackgroundTaskToolInput;

  private manager: BackgroundTaskManager;
  private enabled = true;

  constructor(manager: BackgroundTaskManager) {
    this.manager = manager;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isReadOnly(input: BackgroundTaskToolInput): boolean {
    return input.action === 'list';
  }

  checkPermissions(_input: BackgroundTaskToolInput): PermissionResult {
    return { allowed: true };
  }

  requiresUserConfirmation(input: BackgroundTaskToolInput): boolean {
    return input.action === 'cancel';
  }

  async call(input: BackgroundTaskToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'list': {
          return { success: true, output: this.manager.list() };
        }
        case 'cancel': {
          await this.manager.cancel(input.taskId);
          return { success: true, output: { cancelled: true, taskId: input.taskId } };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: null, error: message };
    }
  }
}
