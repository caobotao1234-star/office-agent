import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { ToolResult } from '../types/index.js';
import { logger } from './logger.js';

const log = logger.child('OperationLedger');

const ToolEntrySchema = z.object({
  name: z.string(),
  inputPreview: z.string(),
  outputPreview: z.string().optional(),
  success: z.boolean().optional(),
  error: z.string().optional(),
});

const LedgerEntrySchema = z.object({
  turnId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  userMessagePreview: z.string(),
  imageCount: z.number().int().nonnegative(),
  model: z.string(),
  tools: z.array(ToolEntrySchema).default([]),
  finalTextPreview: z.string().optional(),
  error: z.string().optional(),
  status: z.enum(['running', 'completed', 'partial', 'failed']),
});

const LedgerFileSchema = z.object({
  entries: z.array(LedgerEntrySchema).default([]),
});

export type OperationStatus = 'running' | 'completed' | 'partial' | 'failed';

export interface OperationToolEntry {
  name: string;
  inputPreview: string;
  outputPreview?: string;
  success?: boolean;
  error?: string;
}

export interface OperationLedgerEntry {
  turnId: string;
  startedAt: Date;
  finishedAt?: Date;
  userMessagePreview: string;
  imageCount: number;
  model: string;
  tools: OperationToolEntry[];
  finalTextPreview?: string;
  error?: string;
  status: OperationStatus;
}

export class OperationLedger {
  private entries: OperationLedgerEntry[] = [];

  constructor(private filePath: string, private maxEntries = 20) {
    this.load();
  }

  startTurn(input: { userMessage: string; imageCount?: number; model: string; now?: Date }): string {
    const now = input.now ?? new Date();
    const turnId = `turn_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.entries.push({
      turnId,
      startedAt: now,
      userMessagePreview: preview(input.userMessage, 500),
      imageCount: input.imageCount ?? 0,
      model: input.model,
      tools: [],
      status: 'running',
    });
    this.trim();
    this.save();
    log.info('turn started', { turnId, imageCount: input.imageCount ?? 0, model: input.model });
    return turnId;
  }

  recordToolUse(turnId: string, toolName: string, input: unknown): void {
    const entry = this.find(turnId);
    if (!entry) return;
    entry.tools.push({
      name: toolName,
      inputPreview: previewJson(input, 700),
    });
    this.save();
  }

  recordToolResult(turnId: string, toolName: string, result: ToolResult): void {
    const entry = this.find(turnId);
    if (!entry) return;
    const tool = [...entry.tools].reverse().find((item) => item.name === toolName && item.success === undefined);
    const target = tool ?? entry.tools[entry.tools.length - 1];
    if (!target) return;
    target.success = result.success;
    target.outputPreview = previewJson(result.output, 700);
    if (result.error) target.error = result.error;
    this.save();
  }

  finishTurn(turnId: string, input: {
    status: Exclude<OperationStatus, 'running'>;
    finalText?: string;
    error?: string;
    now?: Date;
  }): void {
    const entry = this.find(turnId);
    if (!entry) return;
    entry.status = input.status;
    entry.finishedAt = input.now ?? new Date();
    if (input.finalText) entry.finalTextPreview = preview(input.finalText, 700);
    if (input.error) entry.error = input.error;
    this.save();
    log.info('turn finished', { turnId, status: entry.status, toolCount: entry.tools.length });
  }

  getLast(): OperationLedgerEntry | undefined {
    const entry = this.entries.at(-1);
    return entry ? cloneEntry(entry) : undefined;
  }

  list(): OperationLedgerEntry[] {
    return this.entries.map(cloneEntry);
  }

  formatLast(): string {
    const entry = this.getLast();
    if (!entry) return '暂无调试摘要。';

    const lines = [
      `最近一轮: ${entry.turnId}`,
      `状态: ${formatStatus(entry.status)}`,
      `模型: ${entry.model}`,
      `开始: ${entry.startedAt.toISOString()}`,
      ...(entry.finishedAt ? [`耗时: ${entry.finishedAt.getTime() - entry.startedAt.getTime()}ms`] : []),
      `输入: ${entry.userMessagePreview}${entry.imageCount > 0 ? `（图片 ${entry.imageCount} 张）` : ''}`,
    ];

    if (entry.tools.length > 0) {
      lines.push(`工具调用: ${entry.tools.length} 次`);
      for (const [index, tool] of entry.tools.entries()) {
        const status = tool.success === undefined ? 'running' : tool.success ? 'success' : 'failed';
        lines.push(`${index + 1}. ${tool.name} ${status}${tool.error ? `: ${tool.error}` : ''}`);
      }
    } else {
      lines.push('工具调用: 0 次');
    }

    if (entry.finalTextPreview) lines.push(`回复摘要: ${entry.finalTextPreview}`);
    if (entry.error) lines.push(`错误: ${entry.error}`);
    return lines.join('\n');
  }

  private find(turnId: string): OperationLedgerEntry | undefined {
    return this.entries.find((entry) => entry.turnId === turnId);
  }

  private trim(): void {
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify({ entries: this.entries.map(serializeEntry) }, null, 2), 'utf-8');
    } catch (err) {
      log.error('save failed', { filePath: this.filePath, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = LedgerFileSchema.parse(JSON.parse(fs.readFileSync(this.filePath, 'utf-8')));
      this.entries = parsed.entries.map(deserializeEntry);
      log.info('ledger loaded', { count: this.entries.length, filePath: this.filePath });
    } catch (err) {
      log.warn('ledger load failed', { filePath: this.filePath, error: err instanceof Error ? err.message : String(err) });
      this.entries = [];
    }
  }
}

function serializeEntry(entry: OperationLedgerEntry): z.infer<typeof LedgerEntrySchema> {
  return {
    ...entry,
    startedAt: entry.startedAt.toISOString(),
    finishedAt: entry.finishedAt?.toISOString(),
  };
}

function deserializeEntry(entry: z.infer<typeof LedgerEntrySchema>): OperationLedgerEntry {
  return {
    ...entry,
    startedAt: new Date(entry.startedAt),
    finishedAt: entry.finishedAt ? new Date(entry.finishedAt) : undefined,
  };
}

function cloneEntry(entry: OperationLedgerEntry): OperationLedgerEntry {
  return {
    ...entry,
    startedAt: new Date(entry.startedAt),
    finishedAt: entry.finishedAt ? new Date(entry.finishedAt) : undefined,
    tools: entry.tools.map((tool) => ({ ...tool })),
  };
}

function preview(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function previewJson(value: unknown, maxChars: number): string {
  try {
    return preview(JSON.stringify(value), maxChars);
  } catch {
    return preview(String(value), maxChars);
  }
}

function formatStatus(status: OperationStatus): string {
  switch (status) {
    case 'completed': return '完成';
    case 'partial': return '部分完成';
    case 'failed': return '失败';
    case 'running': return '运行中';
  }
}
