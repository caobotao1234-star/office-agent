import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgendaStore } from '../../services/agenda-store.js';
import { CommitmentTrackerService } from '../../services/commitment-tracker-service.js';
import { OfficeContextStore } from '../../services/office-context-store.js';
import { CommitmentTrackerTool } from './index.js';

function setupTool() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-commitment-tool-'));
  const agendaStore = new AgendaStore(path.join(dir, 'agenda.json'));
  const officeContextStore = new OfficeContextStore(path.join(dir, 'office-context.json'));
  const service = new CommitmentTrackerService(agendaStore, officeContextStore);
  const tool = new CommitmentTrackerTool(service);
  return { tool, agendaStore, officeContextStore };
}

const context = { abortSignal: new AbortController().signal, userConfig: {} as never };

describe('CommitmentTrackerTool', () => {
  it('summarizes tracked commitments', async () => {
    const { tool, agendaStore, officeContextStore } = setupTool();
    officeContextStore.upsert({ type: 'person', title: '张三', summary: '客户接口人' });
    agendaStore.create({
      type: 'commitment',
      title: '我答应张三发方案',
      triggerAt: new Date('2026-05-25T09:00:00.000Z'),
      priority: 'high',
    });

    const result = await tool.call({ action: 'summary', person: '张三', limit: 10, windowDays: 7 }, context);

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.output)).toContain('我答应张三发方案');
    expect(tool.isReadOnly({ action: 'summary', limit: 10, windowDays: 7 })).toBe(true);
  });

  it('lists commitments without modifying agenda', async () => {
    const { tool, agendaStore } = setupTool();
    agendaStore.create({
      type: 'follow_up',
      title: '客户承诺给我反馈',
      triggerAt: new Date('2026-05-29T09:00:00.000Z'),
    });

    const before = agendaStore.list().length;
    const result = await tool.call({ action: 'list', status: 'pending', limit: 10, windowDays: 7 }, context);
    const after = agendaStore.list().length;

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.output)).toContain('客户承诺给我反馈');
    expect(after).toBe(before);
  });
});
