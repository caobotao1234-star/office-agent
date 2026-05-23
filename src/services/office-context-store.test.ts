import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OfficeContextStore } from './office-context-store.js';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-context-store-'));
  return path.join(dir, 'office-context.json');
}

describe('OfficeContextStore', () => {
  it('upserts and persists context records', () => {
    const file = tmpFile();
    const store = new OfficeContextStore(file);

    const created = store.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo 项目',
      summary: '核心增长项目，当前处于方案评审阶段。',
      status: 'active',
      tags: ['增长', '重点'],
      aliases: ['Apollo'],
      source: 'conversation',
      sourceRefs: [{ type: 'conversation', id: 'msg-1', title: '首次讨论' }],
      confidence: 0.8,
    }, new Date('2026-05-23T01:00:00.000Z'));

    expect(created.id).toBeTruthy();
    expect(created.key).toBe('project:apollo');
    expect(created.createdAt.toISOString()).toBe('2026-05-23T01:00:00.000Z');

    const restored = new OfficeContextStore(file);
    const loaded = restored.get('project:apollo');
    expect(loaded?.title).toBe('Apollo 项目');
    expect(loaded?.tags).toEqual(['增长', '重点']);
    expect(loaded?.sourceRefs[0]?.observedAt).toBeUndefined();
  });

  it('updates existing records by key and merges arrays', () => {
    const store = new OfficeContextStore(tmpFile());

    const first = store.upsert({
      type: 'person',
      key: 'person:zhang-san',
      title: '张三',
      summary: '前端负责人。',
      aliases: ['三哥'],
      tags: ['frontend'],
      source: 'manual',
      relations: [{ type: 'owns', targetKey: 'project:apollo' }],
    }, new Date('2026-05-23T01:00:00.000Z'));

    const second = store.upsert({
      type: 'person',
      key: 'person:zhang-san',
      title: '张三',
      summary: '前端负责人，负责 Apollo 项目落地。',
      aliases: ['张工'],
      tags: ['owner'],
      source: 'feishu_message',
      sourceRefs: [{ type: 'feishu_message', id: 'om_1', title: '群聊承诺' }],
    }, new Date('2026-05-23T02:00:00.000Z'));

    expect(second.id).toBe(first.id);
    expect(second.summary).toContain('Apollo');
    expect(second.aliases).toEqual(['三哥', '张工']);
    expect(second.tags).toEqual(['frontend', 'owner']);
    expect(second.relations).toHaveLength(1);
    expect(second.sourceRefs).toHaveLength(1);
    expect(second.updatedAt.toISOString()).toBe('2026-05-23T02:00:00.000Z');
  });

  it('searches by keyword, type, tags, project and source', () => {
    const store = new OfficeContextStore(tmpFile());

    store.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo 项目',
      summary: '增长看板和多维表格自动化。',
      tags: ['growth', 'base'],
      source: 'feishu_base',
    });
    store.upsert({
      type: 'document',
      key: 'doc:weekly',
      title: '周报模板',
      summary: '项目周报写作格式。',
      projectId: 'project:apollo',
      tags: ['report'],
      source: 'feishu_doc',
    });
    store.upsert({
      type: 'person',
      key: 'person:li-si',
      title: '李四',
      summary: '后端负责人。',
      tags: ['backend'],
      source: 'manual',
    });

    expect(store.search({ keyword: 'Apollo' }).map((item) => item.key)).toContain('project:apollo');
    expect(store.search({ type: 'document' })).toHaveLength(1);
    expect(store.search({ tags: ['report'], projectId: 'project:apollo' })[0]?.key).toBe('doc:weekly');
    expect(store.search({ source: 'feishu_base' })[0]?.key).toBe('project:apollo');
    expect(store.search({ keyword: '负责人', limit: 1 })).toHaveLength(1);
  });

  it('deletes records by id or key', () => {
    const store = new OfficeContextStore(tmpFile());
    const created = store.upsert({
      type: 'knowledge',
      title: '发布流程',
      summary: '上线前需要完成评审、灰度和回滚预案。',
      source: 'manual',
    });

    expect(store.delete(created.id)).toBe(true);
    expect(store.get(created.id)).toBeUndefined();
    expect(store.delete(created.id)).toBe(false);

    store.upsert({
      type: 'knowledge',
      key: 'process:release',
      title: '发布流程',
      summary: '上线前需要完成评审、灰度和回滚预案。',
      source: 'manual',
    });

    expect(store.delete('process:release')).toBe(true);
    expect(store.search({ keyword: '发布' })).toHaveLength(0);
  });

  it('returns an empty store when the file is invalid', () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{bad json', 'utf-8');

    const store = new OfficeContextStore(file);
    expect(store.search()).toEqual([]);
  });
});
