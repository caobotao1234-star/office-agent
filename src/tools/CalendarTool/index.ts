/**
 * CalendarTool — Calendar event management.
 *
 * Operations: create, query
 * Calendar operations are stubs for future integration.
 * Write operations require user confirmation.
 *
 * Requirements: 9.2, 9.5, 9.6
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';

// ============================================================
// Input Schema
// ============================================================

const CreateEventInput = z.object({
  action: z.literal('create'),
  summary: z.string().min(1),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  attendees: z.array(z.string()).default([]),
  description: z.string().default(''),
  location: z.string().optional(),
});

const QueryEventsInput = z.object({
  action: z.literal('query'),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  keyword: z.string().optional(),
});

const CalendarToolInput = z.discriminatedUnion('action', [
  CreateEventInput,
  QueryEventsInput,
]);

export type CalendarToolInput = z.infer<typeof CalendarToolInput>;

// ============================================================
// CalendarTool
// ============================================================

export class CalendarTool implements Tool<CalendarToolInput, unknown> {
  readonly name = 'CalendarTool';
  readonly description = 'Manage calendar events: create new events and query existing ones.';
  readonly inputSchema = CalendarToolInput;

  private enabled = true;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isReadOnly(input: CalendarToolInput): boolean {
    return input.action === 'query';
  }

  checkPermissions(_input: CalendarToolInput): PermissionResult {
    return { allowed: true };
  }

  requiresUserConfirmation(input: CalendarToolInput): boolean {
    return input.action === 'create'; // Only write ops need confirmation
  }

  async call(input: CalendarToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'create':
          return await this.createEvent(input);
        case 'query':
          return await this.queryEvents(input);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: null,
        error: `日程操作失败: ${message}。建议手动通过日历应用操作。`,
      };
    }
  }

  /** TODO: Integrate calendar API for actual event creation */
  private async createEvent(input: z.infer<typeof CreateEventInput>): Promise<ToolResult<unknown>> {
    // TODO: Use Google Calendar API / CalDAV / Feishu Calendar API
    return {
      success: true,
      output: {
        created: true,
        summary: input.summary,
        startTime: input.startTime.toISOString(),
        endTime: input.endTime.toISOString(),
        attendees: input.attendees,
        message: '[stub] 日程创建成功',
      },
    };
  }

  /** TODO: Integrate calendar API for querying events */
  private async queryEvents(input: z.infer<typeof QueryEventsInput>): Promise<ToolResult<unknown>> {
    // TODO: Query calendar API for events in the given time range
    return {
      success: true,
      output: {
        events: [],
        timeRange: {
          start: input.startTime.toISOString(),
          end: input.endTime.toISOString(),
        },
        message: '[stub] 日程查询完成，暂无数据',
      },
    };
  }
}
