/**
 * FeishuConnector Tool — Feishu (Lark) API integration.
 *
 * Operations: send_message, watch_documents, watch_messages,
 *             create_calendar_event, get_document
 *
 * All Feishu API calls are stubs for future integration.
 * Includes disconnect recovery interface.
 *
 * Requirements: 2.1-2.6, 9.2
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult, FeishuWatchConfig } from '../../types/index.js';

// ============================================================
// Input Schema (discriminated union on "action")
// ============================================================

const SendMessageInput = z.object({
  action: z.literal('send_message'),
  chatId: z.string().min(1),
  content: z.string().min(1),
});

const WatchDocumentsInput = z.object({
  action: z.literal('watch_documents'),
  spaceIds: z.array(z.string().min(1)).min(1),
});

const WatchMessagesInput = z.object({
  action: z.literal('watch_messages'),
  config: z.object({
    chatGroups: z.array(z.string()),
    documentSpaces: z.array(z.string()),
    folders: z.array(z.string()),
  }),
});

const CreateCalendarEventInput = z.object({
  action: z.literal('create_calendar_event'),
  summary: z.string().min(1),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  attendees: z.array(z.string()).default([]),
  description: z.string().default(''),
});

const GetDocumentInput = z.object({
  action: z.literal('get_document'),
  docId: z.string().min(1),
});

const FeishuConnectorInput = z.discriminatedUnion('action', [
  SendMessageInput,
  WatchDocumentsInput,
  WatchMessagesInput,
  CreateCalendarEventInput,
  GetDocumentInput,
]);

export type FeishuConnectorInput = z.infer<typeof FeishuConnectorInput>;

// ============================================================
// FeishuConnector Tool
// ============================================================

export class FeishuConnectorTool implements Tool<FeishuConnectorInput, unknown> {
  readonly name = 'FeishuConnector';
  readonly description = 'Connect to Feishu (Lark): send messages, watch documents/messages, create calendar events, get documents.';
  readonly inputSchema = FeishuConnectorInput;

  private enabled = true;
  private subscriptionActive = false;
  private disconnectTime: Date | null = null;
  private reconnectTime: Date | null = null;
  private watchConfig: FeishuWatchConfig | null = null;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isReadOnly(input: FeishuConnectorInput): boolean {
    return input.action === 'get_document';
  }

  checkPermissions(input: FeishuConnectorInput): PermissionResult {
    if (!this.enabled) {
      return { allowed: false, reason: '飞书连接器未启用，请先在设置中启用' };
    }
    return { allowed: true };
  }

  requiresUserConfirmation(input: FeishuConnectorInput): boolean {
    // Write operations need confirmation; reads and watch setup don't
    return input.action === 'send_message' || input.action === 'create_calendar_event';
  }

  async call(input: FeishuConnectorInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'send_message':
          return await this.sendMessage(input.chatId, input.content);
        case 'watch_documents':
          return await this.watchDocuments(input.spaceIds);
        case 'watch_messages':
          return await this.watchMessages(input.config);
        case 'create_calendar_event':
          return await this.createCalendarEvent(input);
        case 'get_document':
          return await this.getDocumentContent(input.docId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: null, error: message };
    }
  }

  // ----------------------------------------------------------
  // Event subscription control
  // ----------------------------------------------------------

  /** Start listening for Feishu events. */
  startEventSubscription(): void {
    // TODO: Initialize Feishu event subscription via webhook/websocket
    this.subscriptionActive = true;
    this.disconnectTime = null;
  }

  /** Stop listening for Feishu events. */
  stopEventSubscription(): void {
    this.subscriptionActive = false;
  }

  // ----------------------------------------------------------
  // Disconnect recovery
  // ----------------------------------------------------------

  /** Reconnect after a disconnect, pulling missed changes. */
  async reconnect(): Promise<void> {
    // TODO: Re-establish connection and pull changes since disconnectTime
    this.reconnectTime = new Date();
    this.subscriptionActive = true;
    this.disconnectTime = null;
  }

  /** Get the time gap during which the connector was disconnected. */
  getDisconnectGap(): { start: Date; end: Date } | null {
    if (!this.disconnectTime) return null;
    return {
      start: this.disconnectTime,
      end: this.reconnectTime ?? new Date(),
    };
  }

  /** Record a disconnect event (called when connection drops). */
  recordDisconnect(): void {
    this.disconnectTime = new Date();
    this.subscriptionActive = false;
  }

  // ----------------------------------------------------------
  // Watch config
  // ----------------------------------------------------------

  getWatchConfig(): FeishuWatchConfig | null {
    return this.watchConfig;
  }

  isSubscriptionActive(): boolean {
    return this.subscriptionActive;
  }

  // ----------------------------------------------------------
  // API stubs
  // ----------------------------------------------------------

  /** TODO: Integrate Feishu Open API — send message */
  private async sendMessage(chatId: string, content: string): Promise<ToolResult<unknown>> {
    // TODO: POST /im/v1/messages with chatId and content
    return {
      success: true,
      output: { sent: true, chatId, contentLength: content.length, message: '[stub] 消息发送成功' },
    };
  }

  /** TODO: Integrate Feishu Open API — watch documents */
  private async watchDocuments(spaceIds: string[]): Promise<ToolResult<unknown>> {
    // TODO: Subscribe to document change events for given spaces
    return {
      success: true,
      output: { watching: true, spaceIds, message: '[stub] 文档监控已启动' },
    };
  }

  /** TODO: Integrate Feishu Open API — watch messages */
  private async watchMessages(config: FeishuWatchConfig): Promise<ToolResult<unknown>> {
    // TODO: Subscribe to message events for configured groups
    this.watchConfig = config;
    return {
      success: true,
      output: { watching: true, config, message: '[stub] 消息监控已启动' },
    };
  }

  /** TODO: Integrate Feishu Open API — create calendar event */
  private async createCalendarEvent(input: {
    summary: string;
    startTime: Date;
    endTime: Date;
    attendees: string[];
    description: string;
  }): Promise<ToolResult<unknown>> {
    // TODO: POST /calendar/v4/calendars/:calendarId/events
    return {
      success: true,
      output: {
        created: true,
        summary: input.summary,
        startTime: input.startTime.toISOString(),
        endTime: input.endTime.toISOString(),
        message: '[stub] 日程创建成功',
      },
    };
  }

  /** TODO: Integrate Feishu Open API — get document content */
  private async getDocumentContent(docId: string): Promise<ToolResult<unknown>> {
    // TODO: GET /docx/v1/documents/:document_id/raw_content
    return {
      success: true,
      output: { docId, content: `[stub] 文档 ${docId} 内容`, message: '[stub] 文档获取成功' },
    };
  }
}
