import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgendaStore } from './agenda-store.js';
import { CommitmentTrackerService } from './commitment-tracker-service.js';
import { OfficeContextStore } from './office-context-store.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-commitment-tracker-'));
  const agendaStore = new AgendaStore(path.join(dir, 'agenda.json'));
  const officeContextStore = new OfficeContextStore(path.join(dir, 'office-context.json'));
  const service = new CommitmentTrackerService(agendaStore, officeContextStore);
  return { agendaStore, officeContextStore, service };
}

describe('CommitmentTrackerService', () => {
  it('groups commitments into overdue, due soon, and upcoming', () => {
    const { agendaStore, officeContextStore, service } = setup();
    officeContextStore.upsert({ type: 'person', title: '张三', summary: '客户接口人', aliases: ['Zhang San'] });
    officeContextStore.upsert({ type: 'project', title: 'Apollo', summary: '客户演示项目' });
    agendaStore.create({
      type: 'commitment',
      title: '我答应张三发 Apollo 方案',
      triggerAt: new Date('2026-05-25T09:00:00.000Z'),
      deadlineAt: new Date('2026-05-25T18:00:00.000Z'),
      priority: 'high',
      context: 'Apollo',
    });
    agendaStore.create({
      type: 'follow_up',
      title: '张三答应给我 Apollo 反馈',
      triggerAt: new Date('2026-05-28T09:00:00.000Z'),
      priority: 'medium',
      context: 'Apollo',
    });
    agendaStore.create({
      type: 'deadline',
      title: 'Apollo 阶段复盘',
      triggerAt: new Date('2026-06-10T09:00:00.000Z'),
      deadlineAt: new Date('2026-06-12T18:00:00.000Z'),
      priority: 'low',
    });

    const summary = service.summarize({
      project: 'Apollo',
      now: new Date('2026-05-26T10:00:00.000Z'),
      windowDays: 3,
    });

    expect(summary.counts.total).toBe(3);
    expect(summary.counts.overdue).toBe(1);
    expect(summary.counts.dueSoon).toBe(1);
    expect(summary.counts.owedByUser).toBe(1);
    expect(summary.counts.owedToUser).toBe(1);
    expect(summary.overdue[0]?.direction).toBe('owed_by_user');
    expect(summary.dueSoon[0]?.direction).toBe('owed_to_user');
    expect(summary.byPerson[0]?.person).toBe('张三');
    expect(summary.nextActions.join('\n')).toContain('催办');
  });

  it('filters commitments by person', () => {
    const { agendaStore, officeContextStore, service } = setup();
    officeContextStore.upsert({ type: 'person', title: '李四', summary: '研发负责人' });
    agendaStore.create({
      type: 'commitment',
      title: '李四承诺周五给我接口文档',
      triggerAt: new Date('2026-05-29T09:00:00.000Z'),
      priority: 'high',
    });
    agendaStore.create({
      type: 'commitment',
      title: '张三承诺给我报价',
      triggerAt: new Date('2026-05-29T09:00:00.000Z'),
      priority: 'high',
    });

    const items = service.list({ person: '李四' });

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toContain('接口文档');
  });

  it('ignores ordinary reminders', () => {
    const { agendaStore, service } = setup();
    agendaStore.create({
      type: 'reminder',
      title: '喝水',
      triggerAt: new Date('2026-05-29T09:00:00.000Z'),
    });

    expect(service.list()).toEqual([]);
  });
});
