import { describe, expect, it } from 'vitest';
import { ProjectNotFoundError, type ProjectDashboardNotFound } from '../../services/project-dashboard-service.js';
import type { ProjectWeeklyReportService } from '../../services/project-weekly-report-service.js';
import { ProjectWeeklyReportTool } from './index.js';

const context = { abortSignal: new AbortController().signal, userConfig: {} as never };

function createService(overrides: Partial<ProjectWeeklyReportService> = {}): ProjectWeeklyReportService {
  return {
    generate: () => ({
      project: {
        id: 'project_1',
        key: 'project:apollo',
        title: 'Apollo',
        summary: '客户演示项目',
        status: 'active',
        aliases: [],
        tags: [],
        updatedAt: '2026-05-27T00:00:00.000Z',
      },
      generatedAt: '2026-05-27T12:00:00.000Z',
      period: {
        start: '2026-05-25T00:00:00.000Z',
        end: '2026-05-27T12:00:00.000Z',
        label: '2026-05-25 至 2026-05-27',
      },
      sections: {
        summary: { title: '概览', items: ['Apollo 当前状态：active。'] },
        weeklyProgress: { title: '本周进展', items: ['完成演示路径确认'] },
        openTasks: { title: '未完成任务', items: ['完成演示稿'] },
        risks: { title: '风险与阻塞', items: ['任务逾期：完成演示稿'] },
        commitments: { title: '承诺与截止日期', items: ['给客户发方案'] },
        nextWeekPlan: { title: '下周建议', items: ['处理任务：完成演示稿'] },
        sources: { title: '信息来源', items: ['Apollo 项目群'] },
      },
      markdown: '# Apollo 项目周报\n\n- 完成演示路径确认',
      warnings: [],
      suggestedCronPrompt: '生成 Apollo 项目周报',
    }),
    ...overrides,
  } as ProjectWeeklyReportService;
}

describe('ProjectWeeklyReportTool', () => {
  it('generates a report through the service', async () => {
    const tool = new ProjectWeeklyReportTool(createService());

    const result = await tool.call({ action: 'generate', project: 'Apollo', limit: 10 }, context);

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.output)).toContain('Apollo 项目周报');
    expect(tool.isReadOnly({ action: 'generate', project: 'Apollo', limit: 10 })).toBe(true);
  });

  it('returns candidates when project is not found', async () => {
    const details: ProjectDashboardNotFound = {
      project: 'Missing',
      candidates: [{
        id: 'project_1',
        key: 'project:apollo',
        title: 'Apollo',
        summary: '客户演示项目',
        aliases: [],
        tags: [],
        updatedAt: '2026-05-27T00:00:00.000Z',
      }],
    };
    const tool = new ProjectWeeklyReportTool(createService({
      generate: () => { throw new ProjectNotFoundError(details); },
    }));

    const result = await tool.call({ action: 'generate', project: 'Missing', limit: 10 }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('未找到项目');
    expect(JSON.stringify(result.output)).toContain('Apollo');
  });

  it('requires a project target', async () => {
    const tool = new ProjectWeeklyReportTool(createService());

    const result = await tool.call({ action: 'generate', limit: 10 }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('请提供 project');
  });
});
