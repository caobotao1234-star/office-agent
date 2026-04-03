/**
 * FeishuConnector Tool — Feishu (Lark) API integration.
 *
 * Real implementations for document reading via Feishu SDK.
 * Other operations (send_message, calendar, watch) remain stubs.
 *
 * Requirements: 1.2, 2.1-2.6, 9.2
 */
import { z } from 'zod';
import * as Lark from '@larksuiteoapi/node-sdk';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult, FeishuWatchConfig } from '../../types/index.js';

// ============================================================
// Input Schema (discriminated union on "action")
// ============================================================

const ListFolderInput = z.object({
  action: z.literal('list_folder'),
  folderToken: z.string().min(1).describe('Folder token from Feishu URL. Use "root" for root folder.'),
  pageSize: z.number().min(1).max(200).default(50),
});

const GetDocumentInput = z.object({
  action: z.literal('get_document'),
  documentId: z.string().min(1).describe('Document ID (token) from Feishu URL'),
});

const GetDocumentRawInput = z.object({
  action: z.literal('get_document_raw'),
  documentId: z.string().min(1).describe('Document ID (token) — returns plain text content'),
});

const SendMessageInput = z.object({
  action: z.literal('send_message'),
  chatId: z.string().min(1),
  content: z.string().min(1),
});

const CreateCalendarEventInput = z.object({
  action: z.literal('create_calendar_event'),
  summary: z.string().min(1),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  attendees: z.array(z.string()).default([]),
  description: z.string().default(''),
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

const FeishuConnectorInput = z.discriminatedUnion('action', [
  ListFolderInput,
  GetDocumentInput,
  GetDocumentRawInput,
  SendMessageInput,
  CreateCalendarEventInput,
  WatchDocumentsInput,
  WatchMessagesInput,
]);

export type FeishuConnectorInput = z.infer<typeof FeishuConnectorInput>;

// ============================================================
// FeishuConnector Tool
// ============================================================

export class FeishuConnectorTool implements Tool<FeishuConnectorInput, unknown> {
  readonly name = 'FeishuConnector';
  readonly description =
    'Feishu (Lark) integration: list_folder (list files/subfolders in a folder), ' +
    'get_document (document metadata), get_document_raw (plain text content), ' +
    'send_message, create_calendar_event, watch_documents, watch_messages. ' +
    'Use list_folder with folderToken="root" to browse root, then drill into subfolders. ' +
    'Use get_document_raw to read document content as text.';
  readonly inputSchema = FeishuConnectorInput;

  private enabled = true;
  private client: Lark.Client | null = null;
  private subscriptionActive = false;
  private disconnectTime: Date | null = null;
  private reconnectTime: Date | null = null;
  private watchConfig: FeishuWatchConfig | null = null;

  /** Lazy-init Lark client from env vars */
  private getClient(): Lark.Client {
    if (this.client) return this.client;
    const appId = process.env['FEISHU_APP_ID'] ?? '';
    const appSecret = process.env['FEISHU_APP_SECRET'] ?? '';
    if (!appId || !appSecret) {
      throw new Error('飞书未配置：请在 .env 中设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
    }
    this.client = new Lark.Client({ appId, appSecret });
    return this.client;
  }

  isEnabled(): boolean { return this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }

  isReadOnly(input: FeishuConnectorInput): boolean {
    return input.action === 'list_folder' ||
           input.action === 'get_document' ||
           input.action === 'get_document_raw';
  }

  checkPermissions(_input: FeishuConnectorInput): PermissionResult {
    if (!this.enabled) return { allowed: false, reason: '飞书连接器未启用' };
    return { allowed: true };
  }

  requiresUserConfirmation(input: FeishuConnectorInput): boolean {
    return input.action === 'send_message' || input.action === 'create_calendar_event';
  }

  async call(input: FeishuConnectorInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'list_folder': return await this.listFolder(input.folderToken, input.pageSize);
        case 'get_document': return await this.getDocument(input.documentId);
        case 'get_document_raw': return await this.getDocumentRaw(input.documentId);
        case 'send_message': return await this.sendMessage(input.chatId, input.content);
        case 'create_calendar_event': return await this.createCalendarEvent(input);
        case 'watch_documents': return this.stubResult('文档监控已启动 [stub]');
        case 'watch_messages': { this.watchConfig = input.config; return this.stubResult('消息监控已启动 [stub]'); }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: null, error: message };
    }
  }

  // ----------------------------------------------------------
  // Real API: List folder contents
  // ----------------------------------------------------------

  private async listFolder(folderToken: string, pageSize: number): Promise<ToolResult<unknown>> {
    const client = this.getClient();
    const token = folderToken === 'root' ? '' : folderToken;

    const res = await client.drive.v1.file.list({
      params: {
        folder_token: token || undefined,
        page_size: pageSize,
      },
    } as any);

    if (!res.data) {
      return { success: false, output: null, error: '获取文件夹内容失败' };
    }

    const files = (res.data.files ?? []).map((f: any) => ({
      token: f.token,
      name: f.name,
      type: f.type, // folder, doc, docx, sheet, bitable, file, etc.
      parentToken: f.parent_token,
      url: f.url,
      createdTime: f.created_time ? new Date(Number(f.created_time) * 1000).toISOString() : null,
      modifiedTime: f.modified_time ? new Date(Number(f.modified_time) * 1000).toISOString() : null,
      ownerName: f.owner_id,
    }));

    return {
      success: true,
      output: {
        folderToken: folderToken,
        fileCount: files.length,
        files,
        hasMore: res.data.has_more ?? false,
        nextPageToken: res.data.next_page_token ?? null,
      },
    };
  }

  // ----------------------------------------------------------
  // Real API: Get document metadata
  // ----------------------------------------------------------

  private async getDocument(documentId: string): Promise<ToolResult<unknown>> {
    const client = this.getClient();

    const res = await client.docx.v1.document.get({
      path: { document_id: documentId },
    });

    if (!res.data?.document) {
      return { success: false, output: null, error: `文档 ${documentId} 不存在或无权限` };
    }

    const doc = res.data.document as any;
    return {
      success: true,
      output: {
        documentId: doc.document_id,
        title: doc.title,
        revisionId: doc.revision_id,
        createTime: doc.create_time,
        updateTime: doc.update_time,
      },
    };
  }

  // ----------------------------------------------------------
  // Real API: Get document raw text content
  // ----------------------------------------------------------

  private async getDocumentRaw(documentId: string): Promise<ToolResult<unknown>> {
    const client = this.getClient();

    const res = await client.docx.v1.document.rawContent({
      path: { document_id: documentId },
    });

    if (!res.data) {
      return { success: false, output: null, error: `无法读取文档 ${documentId} 内容` };
    }

    return {
      success: true,
      output: {
        documentId,
        content: (res.data as any).content ?? '',
      },
    };
  }

  // ----------------------------------------------------------
  // Stubs for future implementation
  // ----------------------------------------------------------

  private async sendMessage(chatId: string, content: string): Promise<ToolResult<unknown>> {
    const client = this.getClient();
    try {
      await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ text: content }),
          msg_type: 'text',
        },
      });
      return { success: true, output: { sent: true, chatId } };
    } catch (err) {
      return { success: false, output: null, error: `发送失败: ${err instanceof Error ? err.message : err}` };
    }
  }

  private async createCalendarEvent(input: {
    summary: string; startTime: Date; endTime: Date; attendees: string[]; description: string;
  }): Promise<ToolResult<unknown>> {
    return this.stubResult(`[stub] 日程创建: ${input.summary}`);
  }

  private stubResult(message: string): ToolResult<unknown> {
    return { success: true, output: { message } };
  }

  // ----------------------------------------------------------
  // Event subscription (unchanged)
  // ----------------------------------------------------------
  startEventSubscription(): void { this.subscriptionActive = true; this.disconnectTime = null; }
  stopEventSubscription(): void { this.subscriptionActive = false; }
  async reconnect(): Promise<void> { this.reconnectTime = new Date(); this.subscriptionActive = true; this.disconnectTime = null; }
  getDisconnectGap(): { start: Date; end: Date } | null {
    if (!this.disconnectTime) return null;
    return { start: this.disconnectTime, end: this.reconnectTime ?? new Date() };
  }
  recordDisconnect(): void { this.disconnectTime = new Date(); this.subscriptionActive = false; }
  getWatchConfig(): FeishuWatchConfig | null { return this.watchConfig; }
  isSubscriptionActive(): boolean { return this.subscriptionActive; }
}
