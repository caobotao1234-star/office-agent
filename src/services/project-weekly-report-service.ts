import {
  ProjectDashboardService,
  type DashboardAgendaItem,
  type DashboardContextRecord,
  type DashboardSyncSource,
  type DashboardTask,
  type ProjectDashboard,
  type ProjectDashboardProject,
} from './project-dashboard-service.js';

export interface ProjectWeeklyReportQuery {
  project?: string;
  projectId?: string;
  periodStart?: Date;
  periodEnd?: Date;
  now?: Date;
  limit?: number;
}

export interface ProjectWeeklyReportSection {
  title: string;
  items: string[];
}

export interface ProjectWeeklyReport {
  project: ProjectDashboardProject;
  generatedAt: string;
  period: {
    start: string;
    end: string;
    label: string;
  };
  sections: {
    summary: ProjectWeeklyReportSection;
    weeklyProgress: ProjectWeeklyReportSection;
    openTasks: ProjectWeeklyReportSection;
    risks: ProjectWeeklyReportSection;
    commitments: ProjectWeeklyReportSection;
    nextWeekPlan: ProjectWeeklyReportSection;
    sources: ProjectWeeklyReportSection;
  };
  markdown: string;
  warnings: string[];
  suggestedCronPrompt: string;
}

export class ProjectWeeklyReportService {
  constructor(private dashboardService: ProjectDashboardService) {}

  generate(query: ProjectWeeklyReportQuery): ProjectWeeklyReport {
    const now = query.now ?? new Date();
    const periodStart = query.periodStart ?? startOfWeek(now);
    const periodEnd = query.periodEnd ?? now;
    const limit = clampLimit(query.limit, 12);
    const dashboard = this.dashboardService.buildDashboard({
      project: query.project,
      projectId: query.projectId,
      limit,
      now,
    });

    const period = {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      label: `${formatDate(periodStart)} 至 ${formatDate(periodEnd)}`,
    };

    const sections = buildSections(dashboard, periodStart, periodEnd, limit);
    const warnings = [...dashboard.warnings];
    const markdown = renderMarkdown(dashboard.project, period.label, sections, warnings);
    return {
      project: dashboard.project,
      generatedAt: now.toISOString(),
      period,
      sections,
      markdown,
      warnings,
      suggestedCronPrompt: `生成 ${dashboard.project.title} 项目周报，并根据需要推送给用户或写入飞书文档。`,
    };
  }
}

function buildSections(
  dashboard: ProjectDashboard,
  periodStart: Date,
  periodEnd: Date,
  limit: number,
): ProjectWeeklyReport['sections'] {
  const recentContext = dashboard.context.recent.filter((record) => isWithin(record.updatedAt, periodStart, periodEnd));
  const changedSources = dashboard.syncSources.filter((source) => source.lastChangedAt && isWithin(source.lastChangedAt, periodStart, periodEnd));
  const tasks = uniqueLines([
    ...dashboard.tasks.overdue.map((task) => formatTask(task, '逾期')),
    ...dashboard.tasks.highPriority.map((task) => formatTask(task, '高优')),
    ...dashboard.tasks.open.map((task) => formatTask(task)),
  ]).slice(0, limit);
  const commitments = uniqueLines([
    ...dashboard.agenda.overdue.map((item) => formatAgenda(item, '已到期')),
    ...dashboard.agenda.upcoming.map((item) => formatAgenda(item)),
  ]).slice(0, limit);
  const progress = uniqueLines([
    ...recentContext.map(formatContextRecord),
    ...changedSources.map((source) => `同步源有变化：${source.title}${source.lastChangedAt ? `（${formatDateTime(source.lastChangedAt)}）` : ''}`),
  ]).slice(0, limit);

  return {
    summary: {
      title: '概览',
      items: [
        `${dashboard.project.title} 当前状态：${dashboard.project.status ?? '未标注'}。`,
        `本期记录：${progress.length} 条进展，${dashboard.counts.openTasks} 个未完成任务，${dashboard.counts.pendingAgenda} 个待跟进日程/承诺，${dashboard.counts.syncErrors} 个同步异常。`,
      ],
    },
    weeklyProgress: {
      title: '本周进展',
      items: nonEmpty(progress, '暂无本周期内明确更新的项目上下文或同步源变化。'),
    },
    openTasks: {
      title: '未完成任务',
      items: nonEmpty(tasks, '暂无未完成任务记录。'),
    },
    risks: {
      title: '风险与阻塞',
      items: nonEmpty(dashboard.risks.slice(0, limit), '暂无明确风险记录。'),
    },
    commitments: {
      title: '承诺与截止日期',
      items: nonEmpty(commitments, '暂无待跟进承诺或截止日期。'),
    },
    nextWeekPlan: {
      title: '下周建议',
      items: nonEmpty(dashboard.nextActions.slice(0, limit), '暂无明确下一步；建议先补充项目目标、负责人和近期任务。'),
    },
    sources: {
      title: '信息来源',
      items: nonEmpty(dashboard.syncSources.slice(0, limit).map(formatSyncSource), '暂无已登记的飞书同步源。'),
    },
  };
}

function renderMarkdown(
  project: ProjectDashboardProject,
  periodLabel: string,
  sections: ProjectWeeklyReport['sections'],
  warnings: string[],
): string {
  const blocks = [
    `# ${project.title} 项目周报`,
    '',
    `周期：${periodLabel}`,
    `项目状态：${project.status ?? '未标注'}`,
    '',
    ...Object.values(sections).flatMap((section) => [
      `## ${section.title}`,
      '',
      ...section.items.map((item) => `- ${item}`),
      '',
    ]),
  ];

  if (warnings.length > 0) {
    blocks.push('## 数据警告', '', ...warnings.map((warning) => `- ${warning}`), '');
  }

  return blocks.join('\n').trimEnd();
}

function formatTask(task: DashboardTask, prefix?: string): string {
  const parts = [
    prefix ? `${prefix}：${task.description}` : task.description,
    `优先级 ${task.priority}`,
    task.dueDate ? `截止 ${formatDateTime(task.dueDate)}` : undefined,
  ].filter(Boolean);
  return parts.join('，');
}

function formatAgenda(item: DashboardAgendaItem, prefix?: string): string {
  const due = item.deadlineAt ?? item.triggerAt;
  const parts = [
    prefix ? `${prefix}：${item.title}` : item.title,
    formatAgendaType(item.type),
    `时间 ${formatDateTime(due)}`,
    `优先级 ${item.priority}`,
  ];
  return parts.join('，');
}

function formatContextRecord(record: DashboardContextRecord): string {
  const source = record.sourceRefs[0];
  const sourceSuffix = source?.title ? `（来源：${source.title}）` : '';
  return `${record.title}：${oneLine(record.summary)}${sourceSuffix}`;
}

function formatSyncSource(source: DashboardSyncSource): string {
  const status = source.lastError
    ? `异常：${source.lastError}`
    : source.lastChangedAt
      ? `最近变化 ${formatDateTime(source.lastChangedAt)}`
      : source.lastSyncedAt
        ? `最近同步 ${formatDateTime(source.lastSyncedAt)}`
        : '尚未同步';
  return `${source.title}（${source.type}，${source.syncEnabled ? '启用' : '停用'}，${status}）`;
}

function formatAgendaType(type: string): string {
  switch (type) {
    case 'deadline': return '截止日期';
    case 'commitment': return '承诺';
    case 'follow_up': return '跟进';
    default: return '提醒';
  }
}

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function isWithin(value: string | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
}

function formatDate(value: Date): string {
  return [
    value.getFullYear(),
    pad2(value.getMonth() + 1),
    pad2(value.getDate()),
  ].join('-');
}

function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return `${formatDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function nonEmpty(values: string[], fallback: string): string[] {
  return values.length > 0 ? values : [fallback];
}

function uniqueLines(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
