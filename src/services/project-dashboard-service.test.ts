import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgendaStore } from './agenda-store.js';
import { FeishuSyncStore } from './feishu-sync-store.js';
import { OfficeContextStore } from './office-context-store.js';
import { ProjectDashboardService, ProjectNotFoundError } from './project-dashboard-service.js';
import type { TaskItem } from '../types/index.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-project-dashboard-'));
}

function writeTasks(filePath: string, tasks: TaskItem[]): void {
  fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2), 'utf-8');
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
  const service = new ProjectDashboardService(officeContextStore, agendaStore, feishuSyncStore, taskFilePath);
  return { dir, officeContextStore, agendaStore, feishuSyncStore, taskFilePath, service };
}

describe('ProjectDashboardService', () => {
  it('builds a project dashboard from context, tasks, agenda, and sync sources', () => {
    const { officeContextStore, agendaStore, feishuSyncStore, taskFilePath, service } = setup();
    const project = officeContextStore.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo',
      summary: '客户演示项目',
      status: 'active',
      aliases: ['阿波罗项目'],
      tags: ['客户'],
      source: 'manual',
    }, new Date('2026-05-20T00:00:00.000Z'));
    officeContextStore.upsert({
      type: 'person',
      title: '张三',
      summary: '负责 Apollo 前端',
      projectId: project.key,
      source: 'conversation',
      relations: [{ type: 'responsible_for', targetKey: project.key, targetTitle: project.title }],
    });
    officeContextStore.upsert({
      type: 'document',
      title: 'Apollo 方案',
      summary: '项目方案文档',
      projectId: project.key,
      source: 'feishu_doc',
      sourceRefs: [{ type: 'feishu_doc', title: 'Apollo 方案', url: 'https://example.feishu.cn/docx/x' }],
    });
    writeTasks(taskFilePath, [
      task({
        id: 'task_1',
        description: '完成 Apollo 客户演示稿',
        priority: 'high',
        projectId: project.key,
        dueDate: new Date('2026-05-25T12:00:00.000Z'),
      }),
      task({
        id: 'task_2',
        description: '整理其他项目资料',
        priority: 'low',
      }),
    ]);
    agendaStore.create({
      type: 'commitment',
      title: 'Apollo 项目给客户发方案',
      triggerAt: new Date('2026-05-27T09:00:00.000Z'),
      deadlineAt: new Date('2026-05-27T18:00:00.000Z'),
      priority: 'high',
      context: 'Apollo',
    });
    const source = feishuSyncStore.upsert({
      type: 'doc',
      title: 'Apollo 项目文档',
      args: ['docs', '+fetch', '--doc', 'doc_x'],
      projectId: project.key,
      tags: ['Apollo'],
    });
    feishuSyncStore.markFailed({ id: source.id, error: 'permission denied', syncedAt: new Date('2026-05-26T08:00:00.000Z') });

    const dashboard = service.buildDashboard({
      project: '阿波罗项目',
      now: new Date('2026-05-26T10:00:00.000Z'),
    });

    expect(dashboard.project.title).toBe('Apollo');
    expect(dashboard.counts.openTasks).toBe(1);
    expect(dashboard.tasks.highPriority[0]?.description).toContain('客户演示稿');
    expect(dashboard.tasks.overdue[0]?.id).toBe('task_1');
    expect(dashboard.agenda.pending[0]?.title).toContain('发方案');
    expect(dashboard.context.people[0]?.title).toBe('张三');
    expect(dashboard.context.documents[0]?.sourceRefs[0]?.url).toContain('docx');
    expect(dashboard.syncSources[0]?.lastError).toBe('permission denied');
    expect(dashboard.risks.join('\n')).toContain('同步源异常');
    expect(dashboard.nextActions.join('\n')).toContain('处理任务');
  });

  it('returns candidate projects when a project cannot be found', () => {
    const { officeContextStore, service } = setup();
    officeContextStore.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo',
      summary: '客户演示项目',
    });

    expect(() => service.buildDashboard({ project: 'Missing' })).toThrow(ProjectNotFoundError);
    try {
      service.buildDashboard({ project: 'Missing' });
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectNotFoundError);
      expect((err as ProjectNotFoundError).details.candidates[0]?.title).toBe('Apollo');
    }
  });

  it('keeps dashboard usable when tasks file is corrupt', () => {
    const { officeContextStore, taskFilePath, service } = setup();
    officeContextStore.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo',
      summary: '客户演示项目',
    });
    fs.writeFileSync(taskFilePath, '{ bad json', 'utf-8');

    const dashboard = service.buildDashboard({ project: 'Apollo' });

    expect(dashboard.counts.tasks).toBe(0);
    expect(dashboard.warnings[0]).toContain('tasks.json');
  });
});
