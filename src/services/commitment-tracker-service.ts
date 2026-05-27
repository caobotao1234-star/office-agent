import type { AgendaItem } from '../types/index.js';
import type { AgendaStore } from './agenda-store.js';
import type { OfficeContextRecord, OfficeContextStore } from './office-context-store.js';

export type CommitmentDirection = 'owed_by_user' | 'owed_to_user' | 'unknown';

export interface CommitmentTrackerQuery {
  project?: string;
  person?: string;
  status?: 'pending' | 'delivered' | 'cancelled';
  windowDays?: number;
  now?: Date;
  limit?: number;
}

export interface TrackedCommitment {
  id: string;
  type: 'commitment' | 'deadline' | 'follow_up';
  title: string;
  status: string;
  priority: string;
  triggerAt: string;
  deadlineAt?: string;
  dueAt: string;
  direction: CommitmentDirection;
  people: string[];
  projects: string[];
  description?: string;
  context?: string;
  sourceMessage?: string;
}

export interface CommitmentSummary {
  generatedAt: string;
  counts: {
    total: number;
    pending: number;
    overdue: number;
    dueSoon: number;
    owedByUser: number;
    owedToUser: number;
    unknownDirection: number;
  };
  overdue: TrackedCommitment[];
  dueSoon: TrackedCommitment[];
  upcoming: TrackedCommitment[];
  byPerson: Array<{ person: string; count: number; items: TrackedCommitment[] }>;
  nextActions: string[];
  items: TrackedCommitment[];
}

export class CommitmentTrackerService {
  constructor(
    private agendaStore: AgendaStore,
    private officeContextStore: OfficeContextStore,
  ) {}

  list(query: CommitmentTrackerQuery = {}): TrackedCommitment[] {
    const now = query.now ?? new Date();
    const limit = clampLimit(query.limit, 50);
    const people = this.officeContextStore.list({ type: 'person', limit: 500 });
    const projects = this.officeContextStore.list({ type: 'project', limit: 500 });
    const projectMatcher = query.project ? createEntityMatcher(query.project, projects) : null;
    const personMatcher = query.person ? createEntityMatcher(query.person, people) : null;

    return this.agendaStore
      .list({ status: query.status })
      .filter(isTrackableAgenda)
      .map((item) => toTrackedCommitment(item, people, projects))
      .filter((item) => !projectMatcher || projectMatcher(item))
      .filter((item) => !personMatcher || personMatcher(item))
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, limit)
      .sort((a, b) => sortTrackedCommitments(a, b, now));
  }

  summarize(query: CommitmentTrackerQuery = {}): CommitmentSummary {
    const now = query.now ?? new Date();
    const windowDays = clampWindowDays(query.windowDays);
    const dueSoonBefore = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const items = this.list({ ...query, limit: query.limit ?? 100 });
    const pending = items.filter((item) => item.status === 'pending');
    const overdue = pending.filter((item) => new Date(item.dueAt).getTime() < now.getTime());
    const dueSoon = pending.filter((item) => {
      const dueAt = new Date(item.dueAt).getTime();
      return dueAt >= now.getTime() && dueAt <= dueSoonBefore.getTime();
    });
    const upcoming = pending.filter((item) => new Date(item.dueAt).getTime() > dueSoonBefore.getTime());

    return {
      generatedAt: now.toISOString(),
      counts: {
        total: items.length,
        pending: pending.length,
        overdue: overdue.length,
        dueSoon: dueSoon.length,
        owedByUser: items.filter((item) => item.direction === 'owed_by_user').length,
        owedToUser: items.filter((item) => item.direction === 'owed_to_user').length,
        unknownDirection: items.filter((item) => item.direction === 'unknown').length,
      },
      overdue,
      dueSoon,
      upcoming,
      byPerson: groupByPerson(pending),
      nextActions: buildNextActions(overdue, dueSoon, upcoming),
      items,
    };
  }
}

function isTrackableAgenda(item: AgendaItem): item is AgendaItem & { type: 'commitment' | 'deadline' | 'follow_up' } {
  return item.type === 'commitment' || item.type === 'deadline' || item.type === 'follow_up';
}

function toTrackedCommitment(
  item: AgendaItem & { type: 'commitment' | 'deadline' | 'follow_up' },
  people: OfficeContextRecord[],
  projects: OfficeContextRecord[],
): TrackedCommitment {
  const text = agendaText(item);
  const matchedPeople = matchEntities(text, people);
  const matchedProjects = matchEntities(text, projects);
  const direction = inferDirection(text, matchedPeople);
  const dueAt = item.deadlineAt ?? item.triggerAt;
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    status: item.status,
    priority: item.priority,
    triggerAt: item.triggerAt.toISOString(),
    ...(item.deadlineAt ? { deadlineAt: item.deadlineAt.toISOString() } : {}),
    dueAt: dueAt.toISOString(),
    direction,
    people: matchedPeople.map((person) => person.title),
    projects: matchedProjects.map((project) => project.title),
    ...(item.description ? { description: item.description } : {}),
    ...(item.context ? { context: item.context } : {}),
    ...(item.sourceMessage ? { sourceMessage: item.sourceMessage } : {}),
  };
}

function agendaText(item: AgendaItem): string {
  return [
    item.title,
    item.description,
    item.context,
    item.sourceMessage,
    item.composePrompt,
  ].filter(Boolean).join(' ');
}

function matchEntities(text: string, entities: OfficeContextRecord[]): OfficeContextRecord[] {
  const normalized = normalize(text);
  return entities.filter((entity) => {
    const aliases = [entity.title, entity.key, ...entity.aliases].map(normalize).filter(Boolean);
    return aliases.some((alias) => normalized.includes(alias));
  });
}

function createEntityMatcher(query: string, entities: OfficeContextRecord[]): (item: TrackedCommitment) => boolean {
  const normalizedQuery = normalize(query);
  const matchedTitles = new Set(
    entities
      .filter((entity) => [entity.id, entity.key, entity.title, ...entity.aliases].map(normalize).some((value) => value.includes(normalizedQuery) || normalizedQuery.includes(value)))
      .map((entity) => entity.title),
  );
  return (item) => {
    const values = [...item.people, ...item.projects, item.title, item.context ?? '', item.sourceMessage ?? ''].map(normalize);
    return values.some((value) => value.includes(normalizedQuery)) ||
      [...matchedTitles].some((title) => values.includes(normalize(title)));
  };
}

function inferDirection(text: string, people: OfficeContextRecord[]): CommitmentDirection {
  const normalized = normalize(text);
  if (/我(答应|承诺|会|要|负责|需要|来)/.test(normalized)) return 'owed_by_user';
  if (people.length > 0 && /(答应|承诺|会|要|负责|需要|给我|发我|提供|交付)/.test(normalized)) return 'owed_to_user';
  if (/对方|客户|供应商|他们|她们|他|她/.test(normalized) && /(答应|承诺|会|要|负责|提供|交付)/.test(normalized)) return 'owed_to_user';
  return 'unknown';
}

function groupByPerson(items: TrackedCommitment[]): Array<{ person: string; count: number; items: TrackedCommitment[] }> {
  const groups = new Map<string, TrackedCommitment[]>();
  for (const item of items) {
    const people = item.people.length > 0 ? item.people : ['未识别人'];
    for (const person of people) {
      const group = groups.get(person) ?? [];
      group.push(item);
      groups.set(person, group);
    }
  }
  return [...groups.entries()]
    .map(([person, group]) => ({
      person,
      count: group.length,
      items: group.slice(0, 10),
    }))
    .sort((a, b) => b.count - a.count || a.person.localeCompare(b.person));
}

function buildNextActions(
  overdue: TrackedCommitment[],
  dueSoon: TrackedCommitment[],
  upcoming: TrackedCommitment[],
): string[] {
  return [...overdue, ...dueSoon, ...upcoming]
    .slice(0, 10)
    .map((item) => {
      const who = item.people.length > 0 ? `（相关人：${item.people.join(', ')}）` : '';
      const direction = item.direction === 'owed_by_user'
        ? '我方需履约'
        : item.direction === 'owed_to_user'
          ? '需要催办/跟进对方'
          : '需要确认责任方';
      return `${direction}: ${item.title}${who}`;
    });
}

function sortTrackedCommitments(a: TrackedCommitment, b: TrackedCommitment, now: Date): number {
  const ad = new Date(a.dueAt).getTime();
  const bd = new Date(b.dueAt).getTime();
  const ao = ad < now.getTime() ? 0 : 1;
  const bo = bd < now.getTime() ? 0 : 1;
  if (ao !== bo) return ao - bo;
  if (ad !== bd) return ad - bd;
  return priorityScore(b.priority) - priorityScore(a.priority);
}

function priorityScore(priority: string): number {
  switch (priority) {
    case 'urgent': return 4;
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 0;
  }
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.min(100, Math.max(1, Math.floor(value)));
}

function clampWindowDays(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return 7;
  return Math.min(90, Math.max(1, Math.floor(value)));
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
