import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgendaStore } from '../../services/agenda-store.js';
import { FeishuSyncStore } from '../../services/feishu-sync-store.js';
import { OfficeContextStore } from '../../services/office-context-store.js';
import { ProjectDashboardService } from '../../services/project-dashboard-service.js';
import { ProjectDashboardTool } from './index.js';

function setupTool() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-project-dashboard-tool-'));
  const officeContextStore = new OfficeContextStore(path.join(dir, 'office-context.json'));
  const service = new ProjectDashboardService(
    officeContextStore,
    new AgendaStore(path.join(dir, 'agenda.json')),
    new FeishuSyncStore(path.join(dir, 'feishu-sync-sources.json')),
    path.join(dir, 'tasks.json'),
  );
  const tool = new ProjectDashboardTool(service);
  return { tool, officeContextStore };
}

describe('ProjectDashboardTool', () => {
  it('lists known projects', async () => {
    const { tool, officeContextStore } = setupTool();
    officeContextStore.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo',
      summary: '客户演示项目',
    });

    const result = await tool.call(
      { action: 'list', limit: 10 },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.output)).toContain('Apollo');
    expect(tool.isReadOnly({ action: 'list', limit: 10 })).toBe(true);
  });

  it('gets a dashboard for one project', async () => {
    const { tool, officeContextStore } = setupTool();
    officeContextStore.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo',
      summary: '客户演示项目',
      aliases: ['阿波罗'],
    });

    const result = await tool.call(
      { action: 'get', project: '阿波罗', limit: 10 },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.output)).toContain('"title":"Apollo"');
    expect(tool.isReadOnly({ action: 'get', project: 'Apollo', limit: 10 })).toBe(true);
  });

  it('returns candidates instead of inventing when a project is missing', async () => {
    const { tool, officeContextStore } = setupTool();
    officeContextStore.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo',
      summary: '客户演示项目',
    });

    const result = await tool.call(
      { action: 'get', project: 'Missing', limit: 10 },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('未找到项目');
    expect(JSON.stringify(result.output)).toContain('Apollo');
  });
});
