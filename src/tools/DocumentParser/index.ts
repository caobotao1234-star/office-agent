/**
 * DocumentParser Tool — Multi-format document parsing.
 *
 * Supported input types: feishu_doc, excel, word, webpage, text
 * Each format parser is a stub for future integration (xlsx, mammoth, cheerio).
 *
 * Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 14.5, 14.6
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult, InformationEntry } from '../../types/index.js';

// ============================================================
// Input Schema (discriminated union on "type")
// ============================================================

const FeishuDocInput = z.object({
  type: z.literal('feishu_doc'),
  docId: z.string().min(1),
});

const ExcelInput = z.object({
  type: z.literal('excel'),
  buffer: z.instanceof(Buffer),
  filename: z.string().min(1),
});

const WordInput = z.object({
  type: z.literal('word'),
  buffer: z.instanceof(Buffer),
  filename: z.string().min(1),
});

const WebpageInput = z.object({
  type: z.literal('webpage'),
  url: z.string().url(),
});

const TextInput = z.object({
  type: z.literal('text'),
  content: z.string().min(1),
});

const DocumentParserInput = z.discriminatedUnion('type', [
  FeishuDocInput,
  ExcelInput,
  WordInput,
  WebpageInput,
  TextInput,
]);

export type DocumentParserInput = z.infer<typeof DocumentParserInput>;

// ============================================================
// Supported formats
// ============================================================

const SUPPORTED_FORMATS = ['feishu_doc', 'excel', 'word', 'webpage', 'text'] as const;

// ============================================================
// DocumentParser Tool
// ============================================================

export class DocumentParserTool implements Tool<DocumentParserInput, InformationEntry[]> {
  readonly name = 'DocumentParser';
  readonly description = 'Parse documents in various formats (Feishu doc, Excel, Word, webpage, text) into structured InformationEntry objects.';
  readonly inputSchema = DocumentParserInput;
  readonly parametersJsonSchema = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['feishu_doc', 'excel', 'word', 'webpage', 'text'] },
      docId: { type: 'string' }, url: { type: 'string' },
      content: { type: 'string' }, filename: { type: 'string' },
    },
    required: ['type'],
  };

  private enabled = true;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isReadOnly(_input: DocumentParserInput): boolean {
    return true; // Parsing is a read-only operation
  }

  checkPermissions(_input: DocumentParserInput): PermissionResult {
    return { allowed: true };
  }

  requiresUserConfirmation(_input: DocumentParserInput): boolean {
    return false; // Read-only, no confirmation needed
  }

  async call(input: DocumentParserInput, _context: ToolContext): Promise<ToolResult<InformationEntry[]>> {
    try {
      const entries = await this.parse(input);
      return { success: true, output: entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: [], error: message };
    }
  }

  /** Parse a document input into InformationEntry items. */
  async parse(input: DocumentParserInput): Promise<InformationEntry[]> {
    switch (input.type) {
      case 'feishu_doc':
        return this.parseFeishuDoc(input.docId);
      case 'excel':
        return this.parseExcel(input.buffer, input.filename);
      case 'word':
        return this.parseWord(input.buffer, input.filename);
      case 'webpage':
        return this.parseWebpage(input.url);
      case 'text':
        return this.parseText(input.content);
      default:
        throw new Error(
          `不支持的文档格式。支持的格式：${SUPPORTED_FORMATS.join(', ')}。请将文档转换为支持的格式后重试。`,
        );
    }
  }

  /** Get list of supported formats. */
  getSupportedFormats(): string[] {
    return [...SUPPORTED_FORMATS];
  }

  /** Format an InformationEntry back to human-readable text. */
  formatOutput(entry: InformationEntry): string {
    const lines: string[] = [];
    lines.push(`# ${entry.title}`);
    lines.push(`类型: ${entry.type} | 来源: ${entry.source}`);
    if (entry.tags.length > 0) {
      lines.push(`标签: ${entry.tags.join(', ')}`);
    }
    lines.push('');
    lines.push(entry.content);
    if (entry.extractedEntities.length > 0) {
      lines.push('');
      lines.push('## 提取的实体');
      for (const entity of entry.extractedEntities) {
        lines.push(`- [${entity.type}] ${entity.value} (置信度: ${entity.confidence})`);
      }
    }
    return lines.join('\n');
  }

  // ----------------------------------------------------------
  // Format-specific parsers (stubs)
  // ----------------------------------------------------------

  /** TODO: Integrate with Feishu Open API to fetch document content */
  private async parseFeishuDoc(docId: string): Promise<InformationEntry[]> {
    // TODO: Call Feishu API to get document content, then extract structured info
    const now = new Date();
    return [{
      id: randomUUID(),
      title: `飞书文档 ${docId}`,
      content: `[飞书文档内容占位 - docId: ${docId}]`,
      type: 'reference',
      source: 'feishu_doc',
      tags: ['feishu'],
      extractedEntities: [],
      createdAt: now,
      updatedAt: now,
    }];
  }

  /** TODO: Integrate xlsx library for Excel parsing */
  private async parseExcel(buffer: Buffer, filename: string): Promise<InformationEntry[]> {
    // TODO: Use xlsx library to parse spreadsheet data
    const now = new Date();
    return [{
      id: randomUUID(),
      title: filename,
      content: `[Excel 内容占位 - ${buffer.length} bytes]`,
      type: 'reference',
      source: 'excel',
      tags: ['excel', 'spreadsheet'],
      extractedEntities: [],
      createdAt: now,
      updatedAt: now,
    }];
  }

  /** TODO: Integrate mammoth library for Word parsing */
  private async parseWord(buffer: Buffer, filename: string): Promise<InformationEntry[]> {
    // TODO: Use mammoth library to extract text from docx
    const now = new Date();
    return [{
      id: randomUUID(),
      title: filename,
      content: `[Word 内容占位 - ${buffer.length} bytes]`,
      type: 'reference',
      source: 'word',
      tags: ['word', 'document'],
      extractedEntities: [],
      createdAt: now,
      updatedAt: now,
    }];
  }

  /** TODO: Integrate cheerio library for webpage parsing */
  private async parseWebpage(url: string): Promise<InformationEntry[]> {
    // TODO: Fetch URL and use cheerio to extract main content
    const now = new Date();
    return [{
      id: randomUUID(),
      title: `网页: ${url}`,
      content: `[网页内容占位 - url: ${url}]`,
      type: 'reference',
      source: 'webpage',
      tags: ['webpage'],
      extractedEntities: [],
      createdAt: now,
      updatedAt: now,
    }];
  }

  /** Parse plain text content directly. */
  private async parseText(content: string): Promise<InformationEntry[]> {
    const now = new Date();
    return [{
      id: randomUUID(),
      title: content.slice(0, 50).replace(/\n/g, ' '),
      content,
      type: 'general',
      source: 'user_input',
      tags: [],
      extractedEntities: [],
      createdAt: now,
      updatedAt: now,
    }];
  }
}
