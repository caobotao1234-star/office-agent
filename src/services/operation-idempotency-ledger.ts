import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ToolResult } from '../types/index.js';
import { readJsonFile, writeJsonFileAtomic } from './json-store.js';
import { logger } from '../core/logger.js';

const log = logger.child('WriteLedger');

const WriteEntrySchema = z.object({
  id: z.string(),
  turnId: z.string().optional(),
  toolName: z.string(),
  commandKey: z.string().optional(),
  signature: z.string(),
  inputPreview: z.string(),
  status: z.enum(['started', 'succeeded', 'failed']),
  outputPreview: z.string().optional(),
  error: z.string().optional(),
  resourceRefs: z.array(z.string()).default([]),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
});

const LedgerFileSchema = z.object({
  entries: z.array(WriteEntrySchema).default([]),
});

export type WriteOperationStatus = 'started' | 'succeeded' | 'failed';

export interface WriteOperationEntry {
  id: string;
  turnId?: string;
  toolName: string;
  commandKey?: string;
  signature: string;
  inputPreview: string;
  status: WriteOperationStatus;
  outputPreview?: string;
  error?: string;
  resourceRefs: string[];
  startedAt: Date;
  finishedAt?: Date;
}

export class OperationIdempotencyLedger {
  private entries: WriteOperationEntry[] = [];

  constructor(private filePath: string, private maxEntries = 100) {
    this.load();
  }

  start(input: {
    turnId?: string;
    toolName: string;
    commandKey?: string;
    input: unknown;
    now?: Date;
  }): string {
    const now = input.now ?? new Date();
    const signature = createSignature({
      toolName: input.toolName,
      commandKey: input.commandKey,
      input: input.input,
    });
    const id = `write_${now.getTime().toString(36)}_${signature.slice(0, 8)}`;
    const entry: WriteOperationEntry = {
      id,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      toolName: input.toolName,
      ...(input.commandKey ? { commandKey: input.commandKey } : {}),
      signature,
      inputPreview: previewJson(input.input, 900),
      status: 'started',
      resourceRefs: [],
      startedAt: now,
    };
    this.entries.push(entry);
    this.trim();
    this.save();
    log.info('write started', { id, turnId: input.turnId, toolName: input.toolName, commandKey: input.commandKey });
    return id;
  }

  finish(id: string, result: ToolResult, now = new Date()): void {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) return;
    entry.status = result.success ? 'succeeded' : 'failed';
    entry.finishedAt = now;
    entry.outputPreview = previewJson(result.output, 900);
    if (result.error) entry.error = result.error;
    entry.resourceRefs = collectResourceRefs(result.output);
    this.save();
    log.info('write finished', { id, status: entry.status, refs: entry.resourceRefs.length });
  }

  list(): WriteOperationEntry[] {
    return this.entries.map(cloneEntry);
  }

  recent(limit = 10): WriteOperationEntry[] {
    return this.entries.slice(-limit).map(cloneEntry);
  }

  private trim(): void {
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  private save(): void {
    try {
      writeJsonFileAtomic(this.filePath, { entries: this.entries.map(serializeEntry) });
    } catch (err) {
      log.error('save failed', { filePath: this.filePath, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private load(): void {
    const parsed = readJsonFile(this.filePath, LedgerFileSchema, {
      fallback: { entries: [] },
      label: 'write-ledger',
    });
    this.entries = parsed.entries.map(deserializeEntry);
    if (this.entries.length > 0) log.info('ledger loaded', { filePath: this.filePath, count: this.entries.length });
  }
}

export function inferWriteCommandKey(toolName: string, input: unknown): string | undefined {
  if (toolName !== 'LarkCli' || !input || typeof input !== 'object') return undefined;
  const args = (input as { args?: unknown }).args;
  if (!Array.isArray(args)) return undefined;
  return getLarkCliCommandKey(args.filter((arg): arg is string => typeof arg === 'string'));
}

function getLarkCliCommandKey(args: string[]): string | undefined {
  const normalized: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--profile') {
      i++;
      continue;
    }
    if (arg.startsWith('--profile=')) continue;
    normalized.push(arg);
  }
  const positional = normalized.filter((arg) => !arg.startsWith('-') && arg !== 'user' && arg !== 'bot');
  if (positional.length === 0) return undefined;
  if (positional[0] === 'api') return positional.slice(0, 3).join(' ');
  if (positional[1]?.startsWith('+')) return positional.slice(0, 2).join(' ');
  return positional.slice(0, Math.min(3, positional.length)).join(' ');
}

function serializeEntry(entry: WriteOperationEntry): z.infer<typeof WriteEntrySchema> {
  return {
    ...entry,
    startedAt: entry.startedAt.toISOString(),
    finishedAt: entry.finishedAt?.toISOString(),
  };
}

function deserializeEntry(entry: z.infer<typeof WriteEntrySchema>): WriteOperationEntry {
  return {
    ...entry,
    startedAt: new Date(entry.startedAt),
    finishedAt: entry.finishedAt ? new Date(entry.finishedAt) : undefined,
  };
}

function cloneEntry(entry: WriteOperationEntry): WriteOperationEntry {
  return {
    ...entry,
    resourceRefs: [...entry.resourceRefs],
    startedAt: new Date(entry.startedAt),
    finishedAt: entry.finishedAt ? new Date(entry.finishedAt) : undefined,
  };
}

function createSignature(input: { toolName: string; commandKey?: string; input: unknown }): string {
  return createHash('sha256')
    .update(stableStringify(input))
    .digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableStringify);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, sortForStableStringify(val)]),
    );
  }
  return value;
}

function previewJson(value: unknown, maxChars: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function collectResourceRefs(value: unknown): string[] {
  const refs = new Set<string>();
  visit(value, (key, val) => {
    if (typeof val !== 'string' || !val) return;
    if (/(token|url|id)$/i.test(key) || /^https?:\/\//.test(val)) refs.add(`${key}=${val}`);
  });
  return [...refs].slice(0, 20);
}

function visit(value: unknown, callback: (key: string, value: unknown) => void, key = ''): void {
  callback(key, value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, callback, String(index)));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      visit(childValue, callback, childKey);
    }
  }
}
