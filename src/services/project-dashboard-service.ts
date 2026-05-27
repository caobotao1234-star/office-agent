import * as fs from 'node:fs';
import { z } from 'zod';
import { TaskItemSchema, type AgendaItem, type TaskItem } from '../types/index.js';
import type { AgendaStore } from './agenda-store.js';
import type { FeishuSyncSource, FeishuSyncStore } from './feishu-sync-store.js';
import type { OfficeContextRecord, OfficeContextStore, OfficeContextType } from './office-context-store.js';
import { logger } from '../core/logger.js';

const log = logger.child('ProjectDashboard');

const TaskFileSchema = z.array(TaskItemSchema);

export interface ProjectDashboardQuery {
  project?: string;
  projectId?: string;
  limit?: number;
  now?: Date;
}

export interface ProjectDashboardProject {
  id: string;
  key: string;
  title: string;
  summary: string;
  status?: string;
  aliases: string[];
  tags: string[];
  updatedAt: string;
}

export interface ProjectDashboard {
  project: ProjectDashboardProject;
  generatedAt: string;
  counts: {
    tasks: number;
    openTasks: number;
    highPriorityTasks: number;
    agenda: number;
    pendingAgenda: number;
    contextRecords: number;
    syncSources: number;
    syncErrors: number;
  };
  tasks: {
    open: DashboardTask[];
    highPriority: DashboardTask[];
    overdue: DashboardTask[];
  };
  agenda: {
    pending: DashboardAgendaItem[];
    overdue: DashboardAgendaItem[];
    upcoming: DashboardAgendaItem[];
  };
  context: {
    recent: DashboardContextRecord[];
    people: DashboardContextRecord[];
    documents: DashboardContextRecord[];
    meetings: DashboardContextRecord[];
    knowledge: DashboardContextRecord[];
  };
  syncSources: DashboardSyncSource[];
  risks: string[];
  nextActions: string[];
  warnings: string[];
}

export interface ProjectDashboardNotFound {
  project: string;
  candidates: ProjectDashboardProject[];
}

export interface DashboardTask {
  id: string;
  description: string;
  status: string;
  priority: string;
  dueDate?: string;
  source: string;
}

export interface DashboardAgendaItem {
  id: string;
  type: string;
  title: string;
  status: string;
  priority: string;
  triggerAt: string;
  deadlineAt?: string;
}

export interface DashboardContextRecord {
  id: string;
  key: string;
  type: string;
  title: string;
  summary: string;
  status?: string;
  updatedAt: string;
  sourceRefs: Array<{ type: string; title?: string; url?: string }>;
}

export interface DashboardSyncSource {
  id: string;
  type: string;
  title: string;
  syncEnabled: boolean;
  lastSyncedAt?: string;
  lastChangedAt?: string;
  lastError?: string;
}

export class ProjectNotFoundError extends Error {
  constructor(readonly details: ProjectDashboardNotFound) {
    super(`Project not found: ${details.project}`);
  }
}

export class ProjectDashboardService {
  constructor(
    private officeContextStore: OfficeContextStore,
    private agendaStore: AgendaStore,
    private feishuSyncStore: FeishuSyncStore,
    private taskFilePath: string,
  ) {}

  listProjects(input: { limit?: number } = {}): ProjectDashboardProject[] {
    const limit = clampLimit(input.limit, 20);
    return this.officeContextStore
      .list({ type: 'project', limit })
      .map(toDashboardProject);
  }

  buildDashboard(query: ProjectDashboardQuery): ProjectDashboard {
    const limit = clampLimit(query.limit, 20);
    const now = query.now ?? new Date();
    const project = this.findProject(query);
    if (!project) {
      throw new ProjectNotFoundError({
        project: query.projectId ?? query.project ?? '',
        candidates: this.listProjects({ limit: 10 }),
      });
    }

    const matcher = createProjectMatcher(project);
    const { tasks, warnings } = this.loadTasks();
    const projectTasks = tasks.filter((task) => isTaskForProject(task, matcher));
    const openTasks = projectTasks
      .filter((task) => !['completed', 'cancelled'].includes(task.status))
      .sort(sortTasks);
    const highPriorityTasks = openTasks.filter((task) => ['urgent', 'high'].includes(task.priority));
    const overdueTasks = openTasks.filter((task) => isTaskOverdue(task, now));

    const projectAgenda = this.agendaStore
      .list()
      .filter((item) => isAgendaForProject(item, matcher));
    const pendingAgenda = projectAgenda
      .filter((item) => item.status === 'pending')
      .sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime());
    const overdueAgenda = pendingAgenda.filter((item) => getAgendaDueTime(item).getTime() < now.getTime());
    const upcomingAgenda = pendingAgenda.filter((item) => getAgendaDueTime(item).getTime() >= now.getTime());

    const contextRecords = this.officeContextStore
      .list({ limit: 500 })
      .filter((record) => record.id !== project.id)
      .filter((record) => isContextForProject(record, matcher))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const syncSources = this.feishuSyncStore
      .list()
      .filter((source) => isSyncSourceForProject(source, matcher))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return {
      project: toDashboardProject(project),
      generatedAt: now.toISOString(),
      counts: {
        tasks: projectTasks.length,
        openTasks: openTasks.length,
        highPriorityTasks: highPriorityTasks.length,
        agenda: projectAgenda.length,
        pendingAgenda: pendingAgenda.length,
        contextRecords: contextRecords.length,
        syncSources: syncSources.length,
        syncErrors: syncSources.filter((source) => !!source.lastError).length,
      },
      tasks: {
        open: openTasks.slice(0, limit).map(toDashboardTask),
        highPriority: highPriorityTasks.slice(0, limit).map(toDashboardTask),
        overdue: overdueTasks.slice(0, limit).map(toDashboardTask),
      },
      agenda: {
        pending: pendingAgenda.slice(0, limit).map(toDashboardAgenda),
        overdue: overdueAgenda.slice(0, limit).map(toDashboardAgenda),
        upcoming: upcomingAgenda.slice(0, limit).map(toDashboardAgenda),
      },
      context: {
        recent: contextRecords.slice(0, limit).map(toDashboardContext),
        people: contextByType(contextRecords, 'person', limit),
        documents: contextByType(contextRecords, 'document', limit),
        meetings: contextByType(contextRecords, 'meeting', limit),
        knowledge: contextRecords
          .filter((record) => record.type === 'knowledge' || record.type === 'business_process')
          .slice(0, limit)
          .map(toDashboardContext),
      },
      syncSources: syncSources.slice(0, limit).map(toDashboardSyncSource),
      risks: buildRisks({
        overdueTasks,
        highPriorityTasks,
        overdueAgenda,
        syncSources,
        contextRecords,
      }).slice(0, limit),
      nextActions: buildNextActions(openTasks, pendingAgenda).slice(0, limit),
      warnings,
    };
  }

  private findProject(query: ProjectDashboardQuery): OfficeContextRecord | undefined {
    const projects = this.officeContextStore.list({ type: 'project', limit: 500 });
    const raw = (query.projectId ?? query.project ?? '').trim();
    if (!raw) return projects[0];
    const normalized = normalize(raw);

    const exact = projects.find((project) => {
      const values = [project.id, project.key, project.title, ...project.aliases].map(normalize);
      return values.includes(normalized);
    });
    if (exact) return exact;

    return this.officeContextStore.search({ type: 'project', keyword: raw, limit: 1 })[0];
  }

  private loadTasks(): { tasks: TaskItem[]; warnings: string[] } {
    if (!fs.existsSync(this.taskFilePath)) return { tasks: [], warnings: [] };
    try {
      const parsed = TaskFileSchema.parse(JSON.parse(fs.readFileSync(this.taskFilePath, 'utf-8')));
      return { tasks: parsed, warnings: [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('tasks load failed', { filePath: this.taskFilePath, error: message });
      return {
        tasks: [],
        warnings: [`tasks.json 读取失败，项目任务统计按空处理：${message}`],
      };
    }
  }
}

interface ProjectMatcher {
  ids: Set<string>;
  names: string[];
}

function createProjectMatcher(project: OfficeContextRecord): ProjectMatcher {
  const names = uniqueClean([project.title, project.key, ...project.aliases]);
  return {
    ids: new Set([project.id, project.key, ...project.aliases].map(normalize)),
    names: names.map(normalize).filter(Boolean),
  };
}

function isTaskForProject(task: TaskItem, matcher: ProjectMatcher): boolean {
  if (task.projectId && matcher.ids.has(normalize(task.projectId))) return true;
  return matcher.names.some((name) => normalize(task.description).includes(name));
}

function isAgendaForProject(item: AgendaItem, matcher: ProjectMatcher): boolean {
  const text = [
    item.title,
    item.description,
    item.context,
    item.sourceMessage,
    item.composePrompt,
  ].filter(Boolean).join(' ');
  return matcher.names.some((name) => normalize(text).includes(name));
}

function isContextForProject(record: OfficeContextRecord, matcher: ProjectMatcher): boolean {
  if (record.projectId && matcher.ids.has(normalize(record.projectId))) return true;
  const recordText = [
    record.key,
    record.title,
    record.summary,
    record.status,
    ...record.tags,
    ...record.aliases,
  ].filter(Boolean).join(' ');
  if (matcher.names.some((name) => normalize(recordText).includes(name))) return true;
  return record.relations.some((relation) => {
    const target = [relation.targetId, relation.targetKey, relation.targetTitle, relation.description]
      .filter(Boolean)
      .join(' ');
    return matcher.names.some((name) => normalize(target).includes(name)) ||
      matcher.ids.has(normalize(relation.targetId ?? '')) ||
      matcher.ids.has(normalize(relation.targetKey ?? ''));
  });
}

function isSyncSourceForProject(source: FeishuSyncSource, matcher: ProjectMatcher): boolean {
  if (source.projectId && matcher.ids.has(normalize(source.projectId))) return true;
  const text = [source.title, ...source.tags, ...source.args].join(' ');
  return matcher.names.some((name) => normalize(text).includes(name));
}

function toDashboardProject(project: OfficeContextRecord): ProjectDashboardProject {
  return {
    id: project.id,
    key: project.key,
    title: project.title,
    summary: project.summary,
    ...(project.status ? { status: project.status } : {}),
    aliases: [...project.aliases],
    tags: [...project.tags],
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toDashboardTask(task: TaskItem): DashboardTask {
  return {
    id: task.id,
    description: task.description,
    status: task.status,
    priority: task.priority,
    ...(task.dueDate ? { dueDate: task.dueDate.toISOString() } : {}),
    source: task.source,
  };
}

function toDashboardAgenda(item: AgendaItem): DashboardAgendaItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    status: item.status,
    priority: item.priority,
    triggerAt: item.triggerAt.toISOString(),
    ...(item.deadlineAt ? { deadlineAt: item.deadlineAt.toISOString() } : {}),
  };
}

function toDashboardContext(record: OfficeContextRecord): DashboardContextRecord {
  return {
    id: record.id,
    key: record.key,
    type: record.type,
    title: record.title,
    summary: record.summary,
    ...(record.status ? { status: record.status } : {}),
    updatedAt: record.updatedAt.toISOString(),
    sourceRefs: record.sourceRefs.map((ref) => ({
      type: ref.type,
      ...(ref.title ? { title: ref.title } : {}),
      ...(ref.url ? { url: ref.url } : {}),
    })),
  };
}

function toDashboardSyncSource(source: FeishuSyncSource): DashboardSyncSource {
  return {
    id: source.id,
    type: source.type,
    title: source.title,
    syncEnabled: source.syncEnabled,
    ...(source.lastSyncedAt ? { lastSyncedAt: source.lastSyncedAt.toISOString() } : {}),
    ...(source.lastChangedAt ? { lastChangedAt: source.lastChangedAt.toISOString() } : {}),
    ...(source.lastError ? { lastError: source.lastError } : {}),
  };
}

function contextByType(records: OfficeContextRecord[], type: OfficeContextType, limit: number): DashboardContextRecord[] {
  return records.filter((record) => record.type === type).slice(0, limit).map(toDashboardContext);
}

function buildRisks(input: {
  overdueTasks: TaskItem[];
  highPriorityTasks: TaskItem[];
  overdueAgenda: AgendaItem[];
  syncSources: FeishuSyncSource[];
  contextRecords: OfficeContextRecord[];
}): string[] {
  const risks: string[] = [];
  for (const task of input.overdueTasks) risks.push(`任务逾期：${task.description}`);
  for (const task of input.highPriorityTasks) {
    if (!input.overdueTasks.some((item) => item.id === task.id)) risks.push(`高优任务未完成：${task.description}`);
  }
  for (const item of input.overdueAgenda) risks.push(`${formatAgendaType(item.type)}已到期：${item.title}`);
  for (const source of input.syncSources.filter((item) => !!item.lastError)) risks.push(`同步源异常：${source.title} - ${source.lastError}`);
  for (const record of input.contextRecords) {
    if (record.status && /risk|block|delay|overdue|延期|风险|阻塞|逾期/i.test(record.status)) {
      risks.push(`上下文风险：${record.title} - ${record.status}`);
    }
  }
  return uniqueClean(risks);
}

function buildNextActions(tasks: TaskItem[], agenda: AgendaItem[]): string[] {
  const taskActions = tasks
    .slice(0, 5)
    .map((task) => `处理任务：${task.description}${task.dueDate ? `（截止 ${task.dueDate.toISOString()}）` : ''}`);
  const agendaActions = agenda
    .slice(0, 5)
    .map((item) => `${formatAgendaType(item.type)}：${item.title}（提醒 ${item.triggerAt.toISOString()}）`);
  return uniqueClean([...taskActions, ...agendaActions]);
}

function sortTasks(a: TaskItem, b: TaskItem): number {
  const pa = priorityScore(a.priority);
  const pb = priorityScore(b.priority);
  if (pb !== pa) return pb - pa;
  const ad = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bd = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

function isTaskOverdue(task: TaskItem, now: Date): boolean {
  return task.status === 'overdue' || (!!task.dueDate && task.dueDate.getTime() < now.getTime());
}

function getAgendaDueTime(item: AgendaItem): Date {
  return item.deadlineAt ?? item.triggerAt;
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

function formatAgendaType(type: string): string {
  switch (type) {
    case 'deadline': return '截止日期';
    case 'commitment': return '承诺';
    case 'follow_up': return '跟进事项';
    default: return '提醒';
  }
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function uniqueClean(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const normalized = normalize(clean);
    if (!clean || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(clean);
  }
  return output;
}
