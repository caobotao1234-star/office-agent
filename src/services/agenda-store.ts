import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgendaItem, AgendaItemPriority, AgendaItemSource, AgendaItemStatus, AgendaItemType } from '../types/index.js';
import { logger } from '../core/logger.js';

const log = logger.child('AgendaStore');

export type AgendaChangeCallback = () => void;

export interface CreateAgendaItemInput {
  type: AgendaItemType;
  title: string;
  triggerAt: Date;
  description?: string;
  deadlineAt?: Date;
  timezone?: string;
  priority?: AgendaItemPriority;
  source?: AgendaItemSource;
  sourceMessage?: string;
  context?: string;
  composePrompt?: string;
}

export interface UpdateAgendaItemInput {
  title?: string;
  description?: string;
  triggerAt?: Date;
  deadlineAt?: Date;
  timezone?: string;
  priority?: AgendaItemPriority;
  status?: AgendaItemStatus;
  sourceMessage?: string;
  context?: string;
  composePrompt?: string;
}

interface AgendaFile {
  items?: SerializedAgendaItem[];
}

type SerializedAgendaItem = Omit<AgendaItem, 'triggerAt' | 'deadlineAt' | 'createdAt' | 'updatedAt' | 'deliveredAt' | 'cancelledAt'> & {
  triggerAt: string;
  deadlineAt?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  cancelledAt?: string;
};

export class AgendaStore {
  private items: AgendaItem[] = [];
  private changeCallbacks = new Set<AgendaChangeCallback>();

  constructor(private filePath: string) {
    this.load();
  }

  create(input: CreateAgendaItemInput): AgendaItem {
    const now = new Date();
    const item: AgendaItem = {
      id: randomUUID(),
      type: input.type,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      triggerAt: input.triggerAt,
      ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
      timezone: input.timezone ?? 'Asia/Shanghai',
      priority: input.priority ?? 'medium',
      status: 'pending',
      source: input.source ?? 'llm',
      ...(input.sourceMessage ? { sourceMessage: input.sourceMessage } : {}),
      ...(input.context ? { context: input.context } : {}),
      ...(input.composePrompt ? { composePrompt: input.composePrompt } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(item);
    this.save();
    log.info('agenda created', { id: item.id, type: item.type, triggerAt: item.triggerAt.toISOString(), priority: item.priority });
    return item;
  }

  update(id: string, updates: UpdateAgendaItemInput): AgendaItem {
    const item = this.get(id);
    if (!item) throw new Error(`Agenda item not found: ${id}`);

    if (updates.title !== undefined) item.title = updates.title;
    if (updates.description !== undefined) item.description = updates.description;
    if (updates.triggerAt !== undefined) item.triggerAt = updates.triggerAt;
    if (updates.deadlineAt !== undefined) item.deadlineAt = updates.deadlineAt;
    if (updates.timezone !== undefined) item.timezone = updates.timezone;
    if (updates.priority !== undefined) item.priority = updates.priority;
    if (updates.status !== undefined) item.status = updates.status;
    if (updates.sourceMessage !== undefined) item.sourceMessage = updates.sourceMessage;
    if (updates.context !== undefined) item.context = updates.context;
    if (updates.composePrompt !== undefined) item.composePrompt = updates.composePrompt;
    item.updatedAt = new Date();

    this.save();
    log.info('agenda updated', { id: item.id, status: item.status, triggerAt: item.triggerAt.toISOString() });
    return item;
  }

  cancel(id: string, now = new Date()): AgendaItem {
    const item = this.get(id);
    if (!item) throw new Error(`Agenda item not found: ${id}`);
    item.status = 'cancelled';
    item.cancelledAt = now;
    item.updatedAt = now;
    this.save();
    log.info('agenda cancelled', { id });
    return item;
  }

  markDelivered(id: string, now = new Date()): AgendaItem {
    const item = this.get(id);
    if (!item) throw new Error(`Agenda item not found: ${id}`);
    item.status = 'delivered';
    item.deliveredAt = now;
    item.updatedAt = now;
    this.save();
    log.info('agenda delivered', { id });
    return item;
  }

  get(id: string): AgendaItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  list(filter?: { status?: AgendaItemStatus; type?: AgendaItemType }): AgendaItem[] {
    return this.items
      .filter((item) => !filter?.status || item.status === filter.status)
      .filter((item) => !filter?.type || item.type === filter.type)
      .sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime())
      .map((item) => ({ ...item }));
  }

  due(now = new Date()): AgendaItem[] {
    return this.items
      .filter((item) => item.status === 'pending' && item.triggerAt.getTime() <= now.getTime())
      .sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime())
      .map((item) => ({ ...item }));
  }

  nextPendingTime(): Date | null {
    let next: Date | null = null;
    for (const item of this.items) {
      if (item.status !== 'pending') continue;
      if (!next || item.triggerAt.getTime() < next.getTime()) {
        next = item.triggerAt;
      }
    }
    return next;
  }

  onChange(callback: AgendaChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const items = this.items.map(serializeAgendaItem);
      fs.writeFileSync(this.filePath, JSON.stringify({ items }, null, 2), 'utf-8');
    } catch (err) {
      log.error('save failed', { filePath: this.filePath, error: err instanceof Error ? err.message : String(err) });
    }
    this.emitChange();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as AgendaFile;
      this.items = (parsed.items ?? []).map(deserializeAgendaItem);
      log.info('agenda loaded', { count: this.items.length, filePath: this.filePath });
    } catch (err) {
      log.error('load failed', { filePath: this.filePath, error: err instanceof Error ? err.message : String(err) });
      this.items = [];
    }
  }

  private emitChange(): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback();
      } catch (err) {
        log.error('change callback failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

function serializeAgendaItem(item: AgendaItem): SerializedAgendaItem {
  return {
    ...item,
    triggerAt: item.triggerAt.toISOString(),
    deadlineAt: item.deadlineAt?.toISOString(),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    deliveredAt: item.deliveredAt?.toISOString(),
    cancelledAt: item.cancelledAt?.toISOString(),
  };
}

function deserializeAgendaItem(item: SerializedAgendaItem): AgendaItem {
  return {
    ...item,
    triggerAt: new Date(item.triggerAt),
    deadlineAt: item.deadlineAt ? new Date(item.deadlineAt) : undefined,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
    deliveredAt: item.deliveredAt ? new Date(item.deliveredAt) : undefined,
    cancelledAt: item.cancelledAt ? new Date(item.cancelledAt) : undefined,
  };
}
