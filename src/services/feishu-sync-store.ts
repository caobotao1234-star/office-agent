import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger } from '../core/logger.js';

const log = logger.child('FeishuSyncStore');

export const FeishuSyncSourceTypeSchema = z.enum([
  'doc',
  'docs_search',
  'wiki_node',
  'chat_messages',
  'message_search',
  'calendar_agenda',
  'base_records',
  'task_search',
  'contact_search',
  'raw',
]);

export type FeishuSyncSourceType = z.infer<typeof FeishuSyncSourceTypeSchema>;

export interface FeishuSyncSource {
  id: string;
  type: FeishuSyncSourceType;
  title: string;
  args: string[];
  projectId?: string;
  tags: string[];
  syncEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt?: Date;
  lastChangedAt?: Date;
  lastHash?: string;
  lastError?: string;
  lastCommand?: string;
}

export interface UpsertFeishuSyncSourceInput {
  id?: string;
  type: FeishuSyncSourceType;
  title: string;
  args: string[];
  projectId?: string;
  tags?: string[];
  syncEnabled?: boolean;
}

export interface MarkSyncedInput {
  id: string;
  contentHash: string;
  command: string;
  changed: boolean;
  syncedAt?: Date;
}

export interface MarkFailedInput {
  id: string;
  error: string;
  command?: string;
  syncedAt?: Date;
}

interface FeishuSyncFile {
  sources?: SerializedFeishuSyncSource[];
}

type SerializedFeishuSyncSource = Omit<
  FeishuSyncSource,
  'createdAt' | 'updatedAt' | 'lastSyncedAt' | 'lastChangedAt'
> & {
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
  lastChangedAt?: string;
};

const SerializedSourceSchema = z.object({
  id: z.string(),
  type: FeishuSyncSourceTypeSchema,
  title: z.string(),
  args: z.array(z.string()),
  projectId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  syncEnabled: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSyncedAt: z.string().optional(),
  lastChangedAt: z.string().optional(),
  lastHash: z.string().optional(),
  lastError: z.string().optional(),
  lastCommand: z.string().optional(),
});

const FeishuSyncFileSchema = z.object({
  sources: z.array(SerializedSourceSchema).default([]),
});

export class FeishuSyncStore {
  private sources: FeishuSyncSource[] = [];

  constructor(private filePath: string) {
    this.load();
  }

  upsert(input: UpsertFeishuSyncSourceInput, now = new Date()): FeishuSyncSource {
    if (!input.title.trim()) throw new Error('Feishu sync source title is required');
    if (input.args.length === 0) throw new Error('Feishu sync source args are required');

    const existing = input.id ? this.sources.find((source) => source.id === input.id) : undefined;
    if (existing) {
      existing.type = input.type;
      existing.title = input.title.trim();
      existing.args = [...input.args];
      existing.projectId = input.projectId;
      existing.tags = uniqueClean(input.tags ?? []);
      existing.syncEnabled = input.syncEnabled ?? existing.syncEnabled;
      existing.updatedAt = now;
      this.save();
      log.info('source updated', { id: existing.id, type: existing.type, title: existing.title });
      return cloneSource(existing);
    }

    const created: FeishuSyncSource = {
      id: input.id ?? randomUUID(),
      type: input.type,
      title: input.title.trim(),
      args: [...input.args],
      projectId: input.projectId,
      tags: uniqueClean(input.tags ?? []),
      syncEnabled: input.syncEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.sources.push(created);
    this.save();
    log.info('source added', { id: created.id, type: created.type, title: created.title });
    return cloneSource(created);
  }

  get(id: string): FeishuSyncSource | undefined {
    const source = this.sources.find((item) => item.id === id);
    return source ? cloneSource(source) : undefined;
  }

  list(filter: { type?: FeishuSyncSourceType; syncEnabled?: boolean } = {}): FeishuSyncSource[] {
    return this.sources
      .filter((source) => !filter.type || source.type === filter.type)
      .filter((source) => filter.syncEnabled === undefined || source.syncEnabled === filter.syncEnabled)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(cloneSource);
  }

  delete(id: string): boolean {
    const before = this.sources.length;
    this.sources = this.sources.filter((source) => source.id !== id);
    if (this.sources.length === before) return false;
    this.save();
    log.info('source deleted', { id });
    return true;
  }

  markSynced(input: MarkSyncedInput): FeishuSyncSource {
    const source = this.sources.find((item) => item.id === input.id);
    if (!source) throw new Error(`Feishu sync source not found: ${input.id}`);

    const syncedAt = input.syncedAt ?? new Date();
    source.lastSyncedAt = syncedAt;
    source.lastHash = input.contentHash;
    source.lastCommand = input.command;
    source.lastError = undefined;
    if (input.changed) source.lastChangedAt = syncedAt;
    source.updatedAt = syncedAt;
    this.save();
    log.info('source synced', { id: source.id, changed: input.changed, hash: input.contentHash });
    return cloneSource(source);
  }

  markFailed(input: MarkFailedInput): FeishuSyncSource {
    const source = this.sources.find((item) => item.id === input.id);
    if (!source) throw new Error(`Feishu sync source not found: ${input.id}`);

    const syncedAt = input.syncedAt ?? new Date();
    source.lastSyncedAt = syncedAt;
    source.lastError = input.error;
    if (input.command) source.lastCommand = input.command;
    source.updatedAt = syncedAt;
    this.save();
    log.warn('source sync failed', { id: source.id, error: input.error });
    return cloneSource(source);
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify({ sources: this.sources.map(serializeSource) }, null, 2),
      'utf-8',
    );
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = FeishuSyncFileSchema.safeParse(JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as FeishuSyncFile);
      if (!parsed.success) throw new Error(parsed.error.message);
      this.sources = parsed.data.sources.map(deserializeSource);
      log.info('sources loaded', { count: this.sources.length, filePath: this.filePath });
    } catch (err) {
      log.error('source load failed', { filePath: this.filePath, error: err instanceof Error ? err.message : String(err) });
      this.sources = [];
    }
  }
}

function serializeSource(source: FeishuSyncSource): SerializedFeishuSyncSource {
  return {
    ...source,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
    lastSyncedAt: source.lastSyncedAt?.toISOString(),
    lastChangedAt: source.lastChangedAt?.toISOString(),
  };
}

function deserializeSource(source: z.infer<typeof SerializedSourceSchema>): FeishuSyncSource {
  return {
    ...source,
    createdAt: parseDate(source.createdAt) ?? new Date(0),
    updatedAt: parseDate(source.updatedAt) ?? new Date(0),
    lastSyncedAt: parseDate(source.lastSyncedAt),
    lastChangedAt: parseDate(source.lastChangedAt),
  };
}

function cloneSource(source: FeishuSyncSource): FeishuSyncSource {
  return {
    ...source,
    args: [...source.args],
    tags: [...source.tags],
    createdAt: new Date(source.createdAt),
    updatedAt: new Date(source.updatedAt),
    lastSyncedAt: source.lastSyncedAt ? new Date(source.lastSyncedAt) : undefined,
    lastChangedAt: source.lastChangedAt ? new Date(source.lastChangedAt) : undefined,
  };
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function uniqueClean(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const normalized = clean.toLowerCase();
    if (!clean || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(clean);
  }
  return output;
}
