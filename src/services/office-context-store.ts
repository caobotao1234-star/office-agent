import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger } from '../core/logger.js';
import { readJsonFile, writeJsonFileAtomic } from './json-store.js';

const log = logger.child('OfficeContextStore');

export const OfficeContextTypeSchema = z.enum([
  'person',
  'project',
  'document',
  'meeting',
  'task',
  'business_process',
  'relationship',
  'knowledge',
  'misc',
]);

export const OfficeContextSourceSchema = z.enum([
  'conversation',
  'feishu_doc',
  'feishu_message',
  'feishu_calendar',
  'feishu_base',
  'manual',
  'import',
  'tool',
]);

export type OfficeContextType = z.infer<typeof OfficeContextTypeSchema>;
export type OfficeContextSource = z.infer<typeof OfficeContextSourceSchema>;

export interface OfficeContextSourceRef {
  type: OfficeContextSource;
  id?: string;
  url?: string;
  title?: string;
  observedAt?: Date;
}

export interface OfficeContextRelation {
  type: string;
  targetId?: string;
  targetKey?: string;
  targetTitle?: string;
  description?: string;
}

export interface OfficeContextRecord {
  id: string;
  key: string;
  type: OfficeContextType;
  title: string;
  summary: string;
  status?: string;
  aliases: string[];
  tags: string[];
  projectId?: string;
  source: OfficeContextSource;
  sourceRefs: OfficeContextSourceRef[];
  relations: OfficeContextRelation[];
  metadata: Record<string, unknown>;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

export interface UpsertOfficeContextInput {
  id?: string;
  key?: string;
  type: OfficeContextType;
  title: string;
  summary: string;
  status?: string;
  aliases?: string[];
  tags?: string[];
  projectId?: string;
  source?: OfficeContextSource;
  sourceRefs?: OfficeContextSourceRef[];
  relations?: OfficeContextRelation[];
  metadata?: Record<string, unknown>;
  confidence?: number;
  lastSeenAt?: Date;
}

export interface OfficeContextSearchQuery {
  keyword?: string;
  type?: OfficeContextType;
  projectId?: string;
  tags?: string[];
  source?: OfficeContextSource;
  limit?: number;
}

type SerializedOfficeContextSourceRef = Omit<OfficeContextSourceRef, 'observedAt'> & {
  observedAt?: string;
};

type SerializedOfficeContextRecord = Omit<
  OfficeContextRecord,
  'createdAt' | 'updatedAt' | 'lastSeenAt' | 'sourceRefs'
> & {
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  sourceRefs: SerializedOfficeContextSourceRef[];
};

const SerializedSourceRefSchema = z.object({
  type: OfficeContextSourceSchema,
  id: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  observedAt: z.string().optional(),
});

const SerializedRelationSchema = z.object({
  type: z.string(),
  targetId: z.string().optional(),
  targetKey: z.string().optional(),
  targetTitle: z.string().optional(),
  description: z.string().optional(),
});

const SerializedRecordSchema = z.object({
  id: z.string(),
  key: z.string(),
  type: OfficeContextTypeSchema,
  title: z.string(),
  summary: z.string(),
  status: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  projectId: z.string().optional(),
  source: OfficeContextSourceSchema,
  sourceRefs: z.array(SerializedSourceRefSchema).default([]),
  relations: z.array(SerializedRelationSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0.7),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSeenAt: z.string(),
});

const OfficeContextFileSchema = z.object({
  records: z.array(SerializedRecordSchema).default([]),
});

export class OfficeContextStore {
  private records: OfficeContextRecord[] = [];

  constructor(private filePath: string) {
    this.load();
  }

  upsert(input: UpsertOfficeContextInput, now = new Date()): OfficeContextRecord {
    const title = input.title.trim();
    const summary = input.summary.trim();
    if (!title) throw new Error('Office context title is required');
    if (!summary) throw new Error('Office context summary is required');

    const key = normalizeKey(input.key ?? `${input.type}:${title}`);
    const existing = this.records.find((record) => record.id === input.id || record.key === key);
    if (existing) {
      existing.key = key;
      existing.type = input.type;
      existing.title = title;
      existing.summary = summary;
      if (input.status !== undefined) existing.status = input.status;
      existing.aliases = mergeStrings(existing.aliases, input.aliases ?? []);
      existing.tags = mergeStrings(existing.tags, input.tags ?? []);
      if (input.projectId !== undefined) existing.projectId = input.projectId;
      existing.source = input.source ?? existing.source;
      existing.sourceRefs = mergeSourceRefs(existing.sourceRefs, input.sourceRefs ?? []);
      existing.relations = mergeRelations(existing.relations, input.relations ?? []);
      existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
      existing.confidence = clampConfidence(input.confidence ?? existing.confidence);
      existing.lastSeenAt = input.lastSeenAt ?? now;
      existing.updatedAt = now;
      this.save();
      log.info('context updated', { id: existing.id, key: existing.key, type: existing.type });
      return cloneRecord(existing);
    }

    const record: OfficeContextRecord = {
      id: input.id ?? randomUUID(),
      key,
      type: input.type,
      title,
      summary,
      ...(input.status ? { status: input.status } : {}),
      aliases: uniqueClean(input.aliases ?? []),
      tags: uniqueClean(input.tags ?? []),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      source: input.source ?? 'manual',
      sourceRefs: (input.sourceRefs ?? []).map(cloneSourceRef),
      relations: (input.relations ?? []).map(cloneRelation),
      metadata: { ...(input.metadata ?? {}) },
      confidence: clampConfidence(input.confidence ?? 0.7),
      createdAt: now,
      updatedAt: now,
      lastSeenAt: input.lastSeenAt ?? now,
    };

    this.records.push(record);
    this.save();
    log.info('context created', { id: record.id, key: record.key, type: record.type });
    return cloneRecord(record);
  }

  get(idOrKey: string): OfficeContextRecord | undefined {
    const normalized = normalizeKey(idOrKey);
    const record = this.records.find((item) => item.id === idOrKey || item.key === normalized);
    return record ? cloneRecord(record) : undefined;
  }

  list(query: Omit<OfficeContextSearchQuery, 'keyword'> = {}): OfficeContextRecord[] {
    return this.search(query);
  }

  search(query: OfficeContextSearchQuery = {}): OfficeContextRecord[] {
    const terms = tokenize(query.keyword);
    const requiredTags = new Set((query.tags ?? []).map(normalizeToken));
    const scored = this.records
      .filter((record) => !query.type || record.type === query.type)
      .filter((record) => !query.projectId || record.projectId === query.projectId)
      .filter((record) => !query.source || record.source === query.source)
      .filter((record) => {
        if (requiredTags.size === 0) return true;
        const recordTags = new Set(record.tags.map(normalizeToken));
        return [...requiredTags].every((tag) => recordTags.has(tag));
      })
      .map((record) => ({ record, score: scoreRecord(record, terms) }))
      .filter((item) => terms.length === 0 || item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.record.updatedAt.getTime() - a.record.updatedAt.getTime();
      });

    const limit = query.limit && query.limit > 0 ? query.limit : scored.length;
    return scored.slice(0, limit).map((item) => cloneRecord(item.record));
  }

  delete(idOrKey: string): boolean {
    const normalized = normalizeKey(idOrKey);
    const before = this.records.length;
    this.records = this.records.filter((item) => item.id !== idOrKey && item.key !== normalized);
    if (this.records.length === before) return false;
    this.save();
    log.info('context deleted', { idOrKey });
    return true;
  }

  private save(): void {
    writeJsonFileAtomic(this.filePath, { records: this.records.map(serializeRecord) });
  }

  private load(): void {
    const parsed = readJsonFile(this.filePath, OfficeContextFileSchema, {
      fallback: { records: [] },
      label: 'office-context',
    });
    this.records = parsed.records.map(deserializeRecord);
    if (this.records.length > 0) log.info('context loaded', { count: this.records.length, filePath: this.filePath });
  }
}

function serializeRecord(record: OfficeContextRecord): SerializedOfficeContextRecord {
  return {
    ...record,
    sourceRefs: record.sourceRefs.map((ref) => ({
      ...ref,
      observedAt: ref.observedAt?.toISOString(),
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    lastSeenAt: record.lastSeenAt.toISOString(),
  };
}

function deserializeRecord(record: z.infer<typeof SerializedRecordSchema>): OfficeContextRecord {
  return {
    ...record,
    sourceRefs: record.sourceRefs.map((ref) => ({
      ...ref,
      observedAt: parseDate(ref.observedAt),
    })),
    createdAt: parseDate(record.createdAt) ?? new Date(0),
    updatedAt: parseDate(record.updatedAt) ?? new Date(0),
    lastSeenAt: parseDate(record.lastSeenAt) ?? new Date(0),
  };
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(value: string | undefined): string[] {
  return uniqueClean((value ?? '').toLowerCase().split(/[\s,，。;；:：/|]+/).filter(Boolean));
}

function scoreRecord(record: OfficeContextRecord, terms: string[]): number {
  if (terms.length === 0) return 1;

  const title = record.title.toLowerCase();
  const key = record.key.toLowerCase();
  const aliases = record.aliases.join(' ').toLowerCase();
  const tags = record.tags.join(' ').toLowerCase();
  const summary = record.summary.toLowerCase();
  const sourceTitles = record.sourceRefs.map((ref) => ref.title ?? '').join(' ').toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 8;
    if (key.includes(term)) score += 6;
    if (aliases.includes(term)) score += 6;
    if (tags.includes(term)) score += 4;
    if (sourceTitles.includes(term)) score += 3;
    if (summary.includes(term)) score += 2;
  }
  return score;
}

function mergeStrings(existing: string[], incoming: string[]): string[] {
  return uniqueClean([...existing, ...incoming]);
}

function uniqueClean(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const normalized = normalizeToken(clean);
    if (!clean || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(clean);
  }
  return output;
}

function mergeSourceRefs(existing: OfficeContextSourceRef[], incoming: OfficeContextSourceRef[]): OfficeContextSourceRef[] {
  const byKey = new Map<string, OfficeContextSourceRef>();
  for (const ref of [...existing, ...incoming]) {
    byKey.set(sourceRefKey(ref), cloneSourceRef(ref));
  }
  return [...byKey.values()];
}

function sourceRefKey(ref: OfficeContextSourceRef): string {
  return [ref.type, ref.id ?? '', ref.url ?? '', ref.title ?? ''].join('|');
}

function mergeRelations(existing: OfficeContextRelation[], incoming: OfficeContextRelation[]): OfficeContextRelation[] {
  const byKey = new Map<string, OfficeContextRelation>();
  for (const relation of [...existing, ...incoming]) {
    byKey.set(relationKey(relation), cloneRelation(relation));
  }
  return [...byKey.values()];
}

function relationKey(relation: OfficeContextRelation): string {
  return [
    relation.type,
    relation.targetId ?? '',
    relation.targetKey ?? '',
    relation.targetTitle ?? '',
    relation.description ?? '',
  ].join('|');
}

function cloneRecord(record: OfficeContextRecord): OfficeContextRecord {
  return {
    ...record,
    aliases: [...record.aliases],
    tags: [...record.tags],
    sourceRefs: record.sourceRefs.map(cloneSourceRef),
    relations: record.relations.map(cloneRelation),
    metadata: { ...record.metadata },
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    lastSeenAt: new Date(record.lastSeenAt),
  };
}

function cloneSourceRef(ref: OfficeContextSourceRef): OfficeContextSourceRef {
  return {
    ...ref,
    observedAt: ref.observedAt ? new Date(ref.observedAt) : undefined,
  };
}

function cloneRelation(relation: OfficeContextRelation): OfficeContextRelation {
  return { ...relation };
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.7;
  return Math.max(0, Math.min(1, value));
}
