import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgendaStore } from '../../services/agenda-store.js';
import { AgendaTool } from './index.js';

function tool(): AgendaTool {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-agenda-tool-'));
  return new AgendaTool(new AgendaStore(path.join(dir, 'agenda.json')));
}

const context = { abortSignal: new AbortController().signal, userConfig: {} as never };

describe('AgendaTool', () => {
  it('creates and lists agenda items', async () => {
    const agendaTool = tool();
    const created = await agendaTool.call({
      action: 'create',
      type: 'deadline',
      title: '提交方案',
      triggerAt: new Date('2026-05-23T10:00:00.000Z'),
      deadlineAt: new Date('2026-05-23T12:00:00.000Z'),
      timezone: 'Asia/Shanghai',
      priority: 'high',
      sourceMessage: '周六中午前交方案',
    }, context);

    expect(created.success).toBe(true);
    const listed = await agendaTool.call({ action: 'list', status: 'pending' }, context);
    expect(listed.success).toBe(true);
    expect(JSON.stringify(listed.output)).toContain('提交方案');
  });

  it('updates and cancels agenda items', async () => {
    const agendaTool = tool();
    const created = await agendaTool.call({
      action: 'create',
      type: 'reminder',
      title: '提醒',
      triggerAt: new Date('2026-05-23T10:00:00.000Z'),
      timezone: 'Asia/Shanghai',
      priority: 'medium',
    }, context);
    const id = (created.output as { id: string }).id;

    const updated = await agendaTool.call({ action: 'update', id, title: '更新提醒', priority: 'urgent' }, context);
    expect(updated.success).toBe(true);
    expect(JSON.stringify(updated.output)).toContain('更新提醒');

    const cancelled = await agendaTool.call({ action: 'cancel', id }, context);
    expect(cancelled.success).toBe(true);
    expect(JSON.stringify(cancelled.output)).toContain('cancelled');
  });
});
