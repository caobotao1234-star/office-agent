import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgendaStore } from './agenda-store.js';
import { FeishuSyncStore } from './feishu-sync-store.js';
import { OfficeContextStore } from './office-context-store.js';
import { ProjectDashboardService, ProjectNotFoundError } from './project-dashboard-service.js';
import { ProjectWeeklyReportService } from './project-weekly-report-service.js';
import type { TaskItem } from '../types/index.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-project-weekly-report-'));
}

function task(input: Partial<TaskItem> & { id: string; description: string }): TaskItem {
  const now = new Date('2026-05-26T00:00:00.000Z');
  return {
    id: input.id,
    description: input.description,
    status: input.status ?? 'pending',
    priority: input.priority ?? 'medium',
    projectId: input.projectId,
    parentTaskId: input.parentTaskId,
    subtaskIds: input.subtaskIds ?? [],
    dueDate: input.dueDate,
    source: input.source ?? 'user_input',
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    completedAt: input.completedAt,
  };
}

function setup() {
  const dir = tmpDir();
  const officeContextStore = new OfficeContextStore(path.join(dir, 'office-context.json'));
  const agendaStore = new AgendaStore(path.join(dir, 'agenda.json'));
  const feishuSyncStore = new FeishuSyncStore(path.join(dir, 'feishu-sync-sources.json'));
  const taskFilePath = path.join(dir, 'tasks.json');
  const dashboardService = new ProjectDashboardService(officeContextStore, agendaStore, feishuSyncStore, taskFilePath);
  const service = new ProjectWeeklyReportService(dashboardService);
  return { dir, officeContextStore, agendaStore, feishuSyncStore, taskFilePath, service };
}

describe('ProjectWeeklyReportService', () => {
  it('generates markdown weekly report from dashboard data', () => {
    const { officeContextStore, agendaStore, feishuSyncStore, taskFilePath, service } = setup();
    const project = officeContextStore.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo',
      summary: '客户演示项目',
      status: 'active',
      aliases: ['阿波罗项目'],
    });
    officeContextStore.upsert({
      type: 'knowledge',
      title: 'Apollo 方案确认',
      summary: '客户确认采用新版演示路径。',
      projectId: project.key,
      source: 'feishu_message',
      sourceRefs: [{ type: 'feishu_message', title: 'Apollo 项目群' }],
    }, new Date('2026-05-26T08:00:00.000Z'));
    officeContextStore.upsert({
      type: 'knowledge',
      title: '旧进展',
      summary: '上个月的历史记录。',
      projectId: project.key,
    }, new Date('2026-04-01T08:00:00.000Z'));
    fs.writeFileSync(taskFilePath, JSON.stringify([
      task({
        id: 'task_1',
        description: '完成 Apollo 客户演示稿',
        priority: 'high',
        projectId: project.key,
        dueDate: new Date('2026-05-25T12:00:00.000Z'),
      }),
    ], null, 2), 'utf-8');
    agendaStore.create({
      type: 'commitment',
      title: 'Apollo 项目给客户发方案',
      triggerAt: new Date('2026-05-27T09:00:00.000Z'),
      deadlineAt: new Date('2026-05-27T18:00:00.000Z'),
      priority: 'high',
      context: 'Apollo',
    });
    const source = feishuSyncStore.upsert({
      type: 'chat_messages',
      title: 'Apollo 项目群',
      args: ['im', '+chat-messages-list', '--chat-id', 'oc_x'],
      projectId: project.key,
    });
    feishuSyncStore.markSynced({
      id: source.id,
      contentHash: 'hash',
      command: 'lark-cli im +chat-messages-list',
      changed: true,
      syncedAt: new Date('2026-05-26T10:00:00.000Z'),
    });

    const report = service.generate({
      project: '阿波罗项目',
      now: new Date('2026-05-27T12:00:00.000Z'),
      periodStart: new Date('2026-05-25T00:00:00.000Z'),
      periodEnd: new Date('2026-05-27T12:00:00.000Z'),
    });

    expect(report.project.title).toBe('Apollo');
    expect(report.period.label).toBe('2026-05-25 至 2026-05-27');
    expect(report.markdown).toContain('# Apollo 项目周报');
    expect(report.markdown).toContain('Apollo 方案确认');
    expect(report.markdown).not.toContain('旧进展');
    expect(report.markdown).toContain('完成 Apollo 客户演示稿');
    expect(report.markdown).toContain('Apollo 项目给客户发方案');
    expect(report.markdown).toContain('Apollo 项目群');
    expect(report.suggestedCronPrompt).toContain('Apollo 项目周报');
  });

  it('defaults to the current week when no period is provided', () => {
    const { officeContextStore, service } = setup();
    officeContextStore.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo',
      summary: '客户演示项目',
    });

    const report = service.generate({ project: 'Apollo', now: new Date('2026-05-27T12:00:00.000Z') });

    expect(report.period.label).toBe('2026-05-25 至 2026-05-27');
    expect(report.markdown).toContain('暂无本周期内明确更新');
  });

  it('throws project not found from the dashboard service', () => {
    const { officeContextStore, service } = setup();
    officeContextStore.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo',
      summary: '客户演示项目',
    });

    expect(() => service.generate({ project: 'Missing' })).toThrow(ProjectNotFoundError);
  });
});
