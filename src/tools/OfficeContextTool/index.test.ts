import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OfficeContextStore } from '../../services/office-context-store.js';
import { OfficeContextTool } from './index.js';

function createTool(): OfficeContextTool {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-context-tool-'));
  return new OfficeContextTool(new OfficeContextStore(path.join(dir, 'office-context.json')));
}

const ctx = { abortSignal: new AbortController().signal, userConfig: {} as never };

async function callTool(tool: OfficeContextTool, input: unknown) {
  return tool.call(tool.inputSchema.parse(input), ctx);
}

describe('OfficeContextTool', () => {
  it('upserts and searches structured office context', async () => {
    const tool = createTool();

    const upsert = await callTool(tool, {
      action: 'upsert',
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo 项目',
      summary: '增长项目，当前需要推进多维表格自动化。',
      status: 'active',
      aliases: ['Apollo'],
      tags: ['growth'],
      source: 'conversation',
      sourceRefs: [{ type: 'conversation', id: 'msg-1', title: '用户说明' }],
      relations: [{ type: 'owned_by', targetKey: 'person:zhang-san', targetTitle: '张三' }],
      metadata: { priority: 'high' },
      confidence: 0.9,
    });

    expect(upsert.success).toBe(true);
    expect((upsert.output as any).key).toBe('project:apollo');

    const search = await callTool(tool, { action: 'search', keyword: '多维表格', type: 'project' });
    expect(search.success).toBe(true);
    expect(search.output as any[]).toHaveLength(1);
    expect((search.output as any[])[0].title).toBe('Apollo 项目');
  });

  it('gets, lists, and deletes records', async () => {
    const tool = createTool();

    await callTool(tool, {
      action: 'upsert',
      type: 'person',
      key: 'person:li-si',
      title: '李四',
      summary: '后端负责人。',
      tags: ['backend'],
      source: 'manual',
    });

    const got = await callTool(tool, { action: 'get', idOrKey: 'person:li-si' });
    expect(got.success).toBe(true);
    expect((got.output as any).title).toBe('李四');

    const listed = await callTool(tool, { action: 'list', type: 'person' });
    expect(listed.success).toBe(true);
    expect(listed.output as any[]).toHaveLength(1);

    const deleted = await callTool(tool, { action: 'delete', idOrKey: 'person:li-si' });
    expect(deleted.success).toBe(true);

    const missing = await callTool(tool, { action: 'get', idOrKey: 'person:li-si' });
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('not found');
  });

  it('reports store validation errors', async () => {
    const tool = createTool();

    const result = await callTool(tool, {
      action: 'upsert',
      type: 'knowledge',
      title: '   ',
      summary: 'should fail',
      source: 'manual',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('title');
  });
});
