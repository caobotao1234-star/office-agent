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
  pageSize: z.coerce.number().min(1).max(200).default(50),
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

const CreateDocumentInput = z.object({
  action: z.literal('create_document'),
  title: z.string().min(1).describe('Document title'),
  folderToken: z.string().optional().describe('Folder token to create in. Omit for root.'),
});

const AppendContentInput = z.object({
  action: z.literal('append_content'),
  documentId: z.string().min(1).describe('Document ID to append content to'),
  content: z.string().min(1).describe('Text content to append (supports Markdown-like formatting)'),
});

const ListBlocksInput = z.object({
  action: z.literal('list_blocks'),
  documentId: z.string().min(1).describe('Document ID to list blocks from'),
});

const InsertBlockInput = z.object({
  action: z.literal('insert_block'),
  documentId: z.string().min(1).describe('Document ID'),
  parentBlockId: z.string().min(1).describe('Parent block ID to insert under (usually document_id for root level)'),
  index: z.coerce.number().describe('Insert BEFORE this index position. To insert AFTER block at index N, use index N+1. Use -1 for end.'),
  content: z.string().min(1).describe('Text content to insert'),
});

const FeishuConnectorInput = z.discriminatedUnion('action', [
  ListFolderInput,
  GetDocumentInput,
  GetDocumentRawInput,
  SendMessageInput,
  CreateCalendarEventInput,
  WatchDocumentsInput,
  WatchMessagesInput,
  CreateDocumentInput,
  AppendContentInput,
  ListBlocksInput,
  InsertBlockInput,
]);

export type FeishuConnectorInput = z.infer<typeof FeishuConnectorInput>;

// ============================================================
// FeishuConnector Tool
// ============================================================

export class FeishuConnectorTool implements Tool<FeishuConnectorInput, unknown> {
  readonly name = 'FeishuConnector';
  readonly description =
    'Feishu (Lark) integration: list_folder, get_document, get_document_raw, ' +
    'create_document (create new doc), append_content (write to existing doc), ' +
    'send_message, create_calendar_event, watch_documents, watch_messages. ' +
    'Use list_folder with folderToken="root" to browse root. ' +
    'Use get_document_raw to read. Use create_document + append_content to write.';
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
           input.action === 'get_document_raw' ||
           input.action === 'list_blocks';
  }

  checkPermissions(_input: FeishuConnectorInput): PermissionResult {
    if (!this.enabled) return { allowed: false, reason: '飞书连接器未启用' };
    return { allowed: true };
  }

  requiresUserConfirmation(input: FeishuConnectorInput): boolean {
    return input.action === 'send_message' ||
           input.action === 'create_calendar_event' ||
           input.action === 'create_document' ||
           input.action === 'append_content' ||
           input.action === 'insert_block';
  }

  async call(input: FeishuConnectorInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'list_folder': return await this.listFolder(input.folderToken, input.pageSize);
        case 'get_document': return await this.getDocument(input.documentId);
        case 'get_document_raw': return await this.getDocumentRaw(input.documentId);
        case 'send_message': return await this.sendMessage(input.chatId, input.content);
        case 'create_calendar_event': return await this.createCalendarEvent(input);
        case 'create_document': return await this.createDocument(input.title, input.folderToken);
        case 'append_content': return await this.appendContent(input.documentId, input.content);
        case 'list_blocks': return await this.listBlocks(input.documentId);
        case 'insert_block': return await this.insertBlock(input.documentId, input.parentBlockId, input.index, input.content);
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

    try {
      const res = await client.drive.v1.file.list({
        params: {
          folder_token: token || undefined,
          page_size: pageSize,
        },
      } as any);

      const { logger } = await import('../../core/logger.js');
      logger.debug('list_folder API response', {
        hasData: !!res.data,
        code: (res as any).code,
        msg: (res as any).msg,
        fileCount: res.data?.files?.length ?? 0,
      }, 'FeishuConnector');

      if (!res.data) {
        return { success: false, output: null, error: `获取文件夹内容失败: code=${(res as any).code}, msg=${(res as any).msg}` };
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
    } catch (err) {
      const { logger } = await import('../../core/logger.js');
      logger.error('list_folder failed', { error: err instanceof Error ? err.message : String(err), folderToken }, 'FeishuConnector');
      return { success: false, output: null, error: `文件夹访问失败: ${err instanceof Error ? err.message : String(err)}` };
    }
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

  private async createDocument(title: string, folderToken?: string): Promise<ToolResult<unknown>> {
    const client = this.getClient();

    try {
      const res = await client.docx.v1.document.create({
        data: {
          title,
          folder_token: folderToken || undefined,
        },
      });

      const doc = (res.data as any)?.document;
      if (!doc) {
        return { success: false, output: null, error: '创建文档失败' };
      }

      return {
        success: true,
        output: {
          created: true,
          documentId: doc.document_id,
          title: doc.title,
          url: `https://ihaier.feishu.cn/docx/${doc.document_id}`,
        },
      };
    } catch (err) {
      return { success: false, output: null, error: `创建文档失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // ----------------------------------------------------------
  // Real API: Append content to existing document
  // ----------------------------------------------------------

  private async appendContent(documentId: string, content: string): Promise<ToolResult<unknown>> {
    const client = this.getClient();

    try {
      // Split content into paragraphs and create text blocks
      const paragraphs = content.split('\n').filter(line => line.trim());

      const children = paragraphs.map(text => ({
        block_type: 2 as const, // text paragraph
        text: {
          elements: [{
            text_run: {
              content: text,
              text_element_style: {},
            },
          }],
        },
      }));

      const res = await client.docx.v1.documentBlockChildren.create({
        path: { document_id: documentId, block_id: documentId },
        params: { document_revision_id: '-1' },
        data: {
          children,
          index: -1,
        },
      } as any);

      if ((res as any).code && (res as any).code !== 0) {
        return { success: false, output: null, error: `写入失败: code=${(res as any).code}, msg=${(res as any).msg}` };
      }

      return {
        success: true,
        output: {
          appended: true,
          documentId,
          paragraphCount: paragraphs.length,
        },
      };
    } catch (err) {
      return { success: false, output: null, error: `写入文档失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // ----------------------------------------------------------
  // Real API: List document blocks (for finding insertion points)
  // ----------------------------------------------------------

  private async listBlocks(documentId: string): Promise<ToolResult<unknown>> {
    const client = this.getClient();

    try {
      const res = await client.docx.v1.documentBlock.list({
        path: { document_id: documentId },
        params: { page_size: 100 },
      });

      const blocks = ((res.data as any)?.items ?? []).map((b: any, i: number) => ({
        index: i,
        blockId: b.block_id,
        blockType: b.block_type,
        parentId: b.parent_id,
        text: this.extractBlockText(b),
        hint: `To insert AFTER this block, use index=${i + 1}`,
      }));

      return {
        success: true,
        output: { documentId, blockCount: blocks.length, blocks },
      };
    } catch (err) {
      return { success: false, output: null, error: `获取文档结构失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** Extract readable text from a block for identification */
  private extractBlockText(block: any): string {
    const types: Record<number, string> = { 2: 'text', 3: 'heading1', 4: 'heading2', 5: 'heading3', 12: 'bullet', 13: 'ordered' };
    const key = types[block.block_type];
    if (!key) return `[type=${block.block_type}]`;
    const elements = block[key]?.elements ?? [];
    return elements.map((e: any) => e.text_run?.content ?? '').join('');
  }

  // ----------------------------------------------------------
  // Real API: Insert block at specific position
  // ----------------------------------------------------------

  private async insertBlock(documentId: string, parentBlockId: string, index: number, content: string): Promise<ToolResult<unknown>> {
    const client = this.getClient();

    try {
      const paragraphs = content.split('\n').filter(line => line.trim());
      const children = paragraphs.map(text => ({
        block_type: 2 as const,
        text: {
          elements: [{
            text_run: { content: text, text_element_style: {} },
          }],
        },
      }));

      const res = await client.docx.v1.documentBlockChildren.create({
        path: { document_id: documentId, block_id: parentBlockId },
        params: { document_revision_id: '-1' },
        data: { children, index },
      } as any);

      if ((res as any).code && (res as any).code !== 0) {
        return { success: false, output: null, error: `插入失败: code=${(res as any).code}, msg=${(res as any).msg}` };
      }

      return {
        success: true,
        output: { inserted: true, documentId, parentBlockId, index, paragraphCount: paragraphs.length },
      };
    } catch (err) {
      return { success: false, output: null, error: `插入文档失败: ${err instanceof Error ? err.message : String(err)}` };
    }
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
