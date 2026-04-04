/**
 * CalendarTool — Calendar event management via Feishu Calendar API.
 *
 * Operations: create, query, delete
 * Uses Feishu SDK when FEISHU_APP_ID is configured, otherwise stub.
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

const DeleteEventInput = z.object({
  action: z.literal('delete'),
  eventId: z.string().min(1),
});

const CalendarToolInput = z.discriminatedUnion('action', [
  CreateEventInput,
  QueryEventsInput,
  DeleteEventInput,
]);

export type CalendarToolInput = z.infer<typeof CalendarToolInput>;

// ============================================================
// CalendarTool
// ============================================================

export class CalendarTool implements Tool<CalendarToolInput, unknown> {
  readonly name = 'CalendarTool';
  readonly description = 'Manage calendar events: create new events, query existing ones, delete events. Uses Feishu Calendar API when configured.';
  readonly inputSchema = CalendarToolInput;

  private enabled = true;
  private larkClient: any = null;

  private getClient(): any {
    if (this.larkClient) return this.larkClient;
    const appId = process.env['FEISHU_APP_ID'];
    const appSecret = process.env['FEISHU_APP_SECRET'];
    if (!appId || !appSecret) return null;
    // Dynamic import to avoid hard dependency
    try {
      const Lark = require('@larksuiteoapi/node-sdk');
      this.larkClient = new Lark.Client({ appId, appSecret });
      return this.larkClient;
    } catch {
      return null;
    }
  }

  isEnabled(): boolean { return this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }

  isReadOnly(input: CalendarToolInput): boolean {
    return input.action === 'query';
  }

  checkPermissions(_input: CalendarToolInput): PermissionResult {
    return { allowed: true };
  }

  requiresUserConfirmation(input: CalendarToolInput): boolean {
    return input.action === 'create' || input.action === 'delete';
  }

  async call(input: CalendarToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'create': return await this.createEvent(input);
        case 'query': return await this.queryEvents(input);
        case 'delete': return await this.deleteEvent(input.eventId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: null, error: `日程操作失败: ${message}` };
    }
  }

  private async createEvent(input: z.infer<typeof CreateEventInput>): Promise<ToolResult<unknown>> {
    const client = this.getClient();
    if (!client) {
      return { success: true, output: { created: true, summary: input.summary, stub: true, message: '[stub] 飞书未配置，日程仅记录在本地' } };
    }

    try {
      // Get primary calendar ID first
      const calendarId = await this.getPrimaryCalendarId(client);
      if (!calendarId) {
        return { success: false, output: null, error: '无法获取主日历，请检查 calendar 权限' };
      }

      const res = await client.calendar.v4.calendarEvent.create({
        path: { calendar_id: calendarId },
        data: {
          summary: input.summary,
          description: input.description || undefined,
          start_time: { timestamp: String(Math.floor(input.startTime.getTime() / 1000)) },
          end_time: { timestamp: String(Math.floor(input.endTime.getTime() / 1000)) },
          location: input.location ? { name: input.location } : undefined,
        },
      });

      const event = (res.data as any)?.event;
      return {
        success: true,
        output: {
          created: true,
          eventId: event?.event_id,
          summary: input.summary,
          startTime: input.startTime.toISOString(),
          endTime: input.endTime.toISOString(),
        },
      };
    } catch (err) {
      return { success: false, output: null, error: `飞书日历创建失败: ${err instanceof Error ? err.message : err}` };
    }
  }

  private async queryEvents(input: z.infer<typeof QueryEventsInput>): Promise<ToolResult<unknown>> {
    const client = this.getClient();
    if (!client) {
      return { success: true, output: { events: [], stub: true, message: '[stub] 飞书未配置' } };
    }

    try {
      const calendarId = await this.getPrimaryCalendarId(client);
      if (!calendarId) {
        return { success: false, output: null, error: '无法获取主日历' };
      }

      const res = await client.calendar.v4.calendarEvent.list({
        path: { calendar_id: calendarId },
        params: {
          start_time: String(Math.floor(input.startTime.getTime() / 1000)),
          end_time: String(Math.floor(input.endTime.getTime() / 1000)),
          page_size: 50,
        },
      });

      const items = ((res.data as any)?.items ?? []).map((e: any) => ({
        eventId: e.event_id,
        summary: e.summary,
        startTime: e.start_time?.timestamp ? new Date(Number(e.start_time.timestamp) * 1000).toISOString() : null,
        endTime: e.end_time?.timestamp ? new Date(Number(e.end_time.timestamp) * 1000).toISOString() : null,
        location: e.location?.name,
        description: e.description,
      }));

      return { success: true, output: { events: items, count: items.length } };
    } catch (err) {
      return { success: false, output: null, error: `飞书日历查询失败: ${err instanceof Error ? err.message : err}` };
    }
  }

  private async deleteEvent(eventId: string): Promise<ToolResult<unknown>> {
    const client = this.getClient();
    if (!client) {
      return { success: false, output: null, error: '飞书未配置，无法删除日程' };
    }

    try {
      const calendarId = await this.getPrimaryCalendarId(client);
      if (!calendarId) {
        return { success: false, output: null, error: '无法获取主日历' };
      }

      await client.calendar.v4.calendarEvent.delete({
        path: { calendar_id: calendarId, event_id: eventId },
      });

      return { success: true, output: { deleted: true, eventId } };
    } catch (err) {
      return { success: false, output: null, error: `飞书日历删除失败: ${err instanceof Error ? err.message : err}` };
    }
  }

  private async getPrimaryCalendarId(client: any): Promise<string | null> {
    try {
      const res = await client.calendar.v4.calendar.primary({});
      return (res.data as any)?.calendars?.[0]?.calendar?.calendar_id ?? null;
    } catch {
      // Fallback: try listing calendars
      try {
        const listRes = await client.calendar.v4.calendar.list({ params: { page_size: 10 } });
        const calendars = (listRes.data as any)?.calendar_list ?? [];
        const primary = calendars.find((c: any) => c.type === 'primary') ?? calendars[0];
        return primary?.calendar_id ?? null;
      } catch {
        return null;
      }
    }
  }
}
