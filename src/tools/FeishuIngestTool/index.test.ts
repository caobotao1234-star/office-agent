import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FeishuSyncStore } from '../../services/feishu-sync-store.js';
import { OfficeContextStore } from '../../services/office-context-store.js';
import type { LarkCliRunResult } from '../../services/lark-cli-runner.js';
import { buildFeishuIngestArgs, FeishuIngestTool, type FeishuIngestRunner } from './index.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-ingest-tool-'));
}

function createRunResult(args: string[], stdout: string, exitCode = 0): LarkCliRunResult {
  return {
    command: `lark-cli ${args.join(' ')}`,
    args,
    exitCode,
    signal: null,
    stdout,
    stderr: exitCode === 0 ? '' : 'boom',
    timedOut: false,
    aborted: false,
    truncated: false,
  };
}

function createTool(runner: FeishuIngestRunner): {
  tool: FeishuIngestTool;
  syncStore: FeishuSyncStore;
  officeContextStore: OfficeContextStore;
} {
  const dir = tmpDir();
  const syncStore = new FeishuSyncStore(path.join(dir, 'sync.json'));
  const officeContextStore = new OfficeContextStore(path.join(dir, 'office-context.json'));
  return {
    tool: new FeishuIngestTool(syncStore, officeContextStore, runner),
    syncStore,
    officeContextStore,
  };
}

const ctx = { abortSignal: new AbortController().signal, userConfig: {} as never };

async function callTool(tool: FeishuIngestTool, input: unknown) {
  return tool.call(tool.inputSchema.parse(input), ctx);
}

describe('FeishuIngestTool', () => {
  it('builds known read-only lark-cli arguments', () => {
    expect(buildFeishuIngestArgs({
      type: 'doc',
      title: 'Apollo 文档',
      doc: 'docx_123',
      tags: [],
      syncEnabled: true,
      identity: 'user',
      fieldIds: [],
      pageAll: false,
      hasChatted: false,
      rawArgs: [],
    })).toEqual([
      'docs', '+fetch',
      '--api-version', 'v2',
      '--doc', 'docx_123',
      '--doc-format', 'markdown',
      '--format', 'json',
      '--as', 'user',
    ]);

    expect(buildFeishuIngestArgs({
      type: 'base_records',
      title: '项目库',
      baseToken: 'base_x',
      tableId: 'tbl_x',
      fieldIds: ['Name', 'Status'],
      tags: [],
      syncEnabled: true,
      identity: 'user',
      pageAll: false,
      hasChatted: false,
      rawArgs: [],
    })).toContain('--field-id');
  });

  it('adds a source and syncs changed content into office context', async () => {
    const calls: string[][] = [];
    const runner: FeishuIngestRunner = async (args) => {
      calls.push(args);
      return createRunResult(args, JSON.stringify({ title: 'Apollo 方案', content: '张三负责前端，本周五提交方案。' }));
    };
    const { tool, syncStore, officeContextStore } = createTool(runner);

    const added = await callTool(tool, {
      action: 'addSource',
      source: {
        type: 'doc',
        title: 'Apollo 方案',
        doc: 'docx_123',
        projectId: 'project:apollo',
        tags: ['Apollo'],
      },
    });
    expect(added.success).toBe(true);
    const sourceId = (added.output as any).source.id as string;

    const synced = await callTool(tool, { action: 'syncSource', id: sourceId });
    expect(synced.success).toBe(true);
    expect((synced.output as any).changed).toBe(true);
    expect(calls[0]).toEqual((added.output as any).args);

    const source = syncStore.get(sourceId);
    expect(source?.lastHash).toBeTruthy();
    expect(source?.lastChangedAt).toBeInstanceOf(Date);

    const context = officeContextStore.get(`feishu:${sourceId}`);
    expect(context?.type).toBe('document');
    expect(context?.source).toBe('feishu_doc');
    expect(context?.summary).toContain('张三负责前端');
    expect(context?.metadata['contentHash']).toBe(source?.lastHash);
  });

  it('detects unchanged source content and skips context update', async () => {
    let runCount = 0;
    const runner: FeishuIngestRunner = async (args) => {
      runCount++;
      return createRunResult(args, 'same content');
    };
    const { tool } = createTool(runner);
    const added = await callTool(tool, {
      action: 'addSource',
      source: { type: 'calendar_agenda', title: '今天日程' },
    });
    const sourceId = (added.output as any).source.id as string;

    const first = await callTool(tool, { action: 'syncSource', id: sourceId });
    const second = await callTool(tool, { action: 'syncSource', id: sourceId });

    expect(runCount).toBe(2);
    expect((first.output as any).changed).toBe(true);
    expect((second.output as any).changed).toBe(false);
    expect((second.output as any).contextRecord).toBeUndefined();
  });

  it('syncs all enabled sources and records failures', async () => {
    const runner: FeishuIngestRunner = async (args) => {
      if (args.includes('bad')) return createRunResult(args, '', 2);
      return createRunResult(args, `content for ${args.join(' ')}`);
    };
    const { tool, syncStore } = createTool(runner);

    const ok = await callTool(tool, {
      action: 'addSource',
      source: { type: 'docs_search', title: 'Apollo 搜索', query: 'Apollo' },
    });
    const bad = syncStore.upsert({
      type: 'raw',
      title: 'Bad raw',
      args: ['docs', '+fetch', '--doc', 'bad'],
    });

    const result = await callTool(tool, { action: 'syncAll' });
    expect(result.success).toBe(false);
    expect((result.output as any).count).toBe(2);
    expect((result.output as any).failed).toBe(1);
    expect(syncStore.get(bad.id)?.lastError).toContain('退出码');
    expect(syncStore.get((ok.output as any).source.id)?.lastHash).toBeTruthy();
  });

  it('fetches once without registering a source', async () => {
    const runner: FeishuIngestRunner = async (args) => createRunResult(args, '{"items":[{"name":"A"}]}');
    const { tool, syncStore, officeContextStore } = createTool(runner);

    const result = await callTool(tool, {
      action: 'fetchOnce',
      source: {
        type: 'base_records',
        title: '项目 Base',
        baseToken: 'base_x',
        tableId: 'tbl_x',
        tags: ['base'],
      },
    });

    expect(result.success).toBe(true);
    expect(syncStore.list()).toHaveLength(0);
    expect(officeContextStore.search({ keyword: '项目 Base' })).toHaveLength(1);
  });

  it('rejects unsafe raw ingest commands', async () => {
    expect(() => buildFeishuIngestArgs({
      type: 'raw',
      title: 'unsafe',
      rawArgs: ['docs', '+create', '--content', 'x'],
      tags: [],
      syncEnabled: true,
      identity: 'user',
      fieldIds: [],
      pageAll: false,
      hasChatted: false,
    })).toThrow('only allows known read');
  });
});
