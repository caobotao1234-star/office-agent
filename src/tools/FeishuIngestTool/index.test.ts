import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FeishuSyncStore } from '../../services/feishu-sync-store.js';
import { OfficeContextStore } from '../../services/office-context-store.js';
import type { LarkCliRunResult } from '../../services/lark-cli-runner.js';
import type { FeishuSyncAutoCapture } from '../../services/feishu-sync-knowledge-capture.js';
import type { ToolContext } from '../../types/index.js';
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

function createTool(runner: FeishuIngestRunner, autoCapture?: FeishuSyncAutoCapture): {
  tool: FeishuIngestTool;
  syncStore: FeishuSyncStore;
  officeContextStore: OfficeContextStore;
} {
  const dir = tmpDir();
  const syncStore = new FeishuSyncStore(path.join(dir, 'sync.json'));
  const officeContextStore = new OfficeContextStore(path.join(dir, 'office-context.json'));
  return {
    tool: new FeishuIngestTool(syncStore, officeContextStore, runner, autoCapture),
    syncStore,
    officeContextStore,
  };
}

const ctx: ToolContext = { abortSignal: new AbortController().signal, userConfig: {} as never };

async function callTool(tool: FeishuIngestTool, input: unknown, context: ToolContext = ctx) {
  return tool.call(tool.inputSchema.parse(input), context);
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

    expect(buildFeishuIngestArgs({
      type: 'chat_messages',
      title: '和张三的私聊',
      userId: 'ou_zhangsan',
      tags: [],
      syncEnabled: true,
      identity: 'user',
      fieldIds: [],
      pageAll: false,
      hasChatted: false,
      rawArgs: [],
    })).toEqual([
      'im', '+chat-messages-list',
      '--user-id', 'ou_zhangsan',
      '--page-size', '50',
      '--sort', 'desc',
      '--format', 'json',
      '--as', 'user',
    ]);
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

  it('stores chat sync as durable summary instead of raw chatter', async () => {
    const runner: FeishuIngestRunner = async (args) => createRunResult(args, [
      '哈哈今天吃什么',
      '决定采用 Apollo 方案，下周五前完成评审',
      '闲聊内容不应该长期保存',
    ].join('\n'));
    const { tool, officeContextStore } = createTool(runner);
    const added = await callTool(tool, {
      action: 'addSource',
      source: {
        type: 'chat_messages',
        title: 'Apollo 项目群',
        chatId: 'oc_apollo',
      },
    });
    const sourceId = (added.output as any).source.id as string;

    const synced = await callTool(tool, { action: 'syncSource', id: sourceId });
    expect(synced.success).toBe(true);
    const context = officeContextStore.get(`feishu:${sourceId}`);
    expect(context?.summary).toContain('聊天同步摘要');
    expect(context?.summary).toContain('决定采用 Apollo 方案');
    expect(context?.summary).not.toContain('今天吃什么');
    expect(context?.summary).not.toContain('闲聊内容不应该长期保存');
  });

  it('runs auto capture only when synced content changes', async () => {
    let runCount = 0;
    const captured: string[] = [];
    const runner: FeishuIngestRunner = async (args) => {
      runCount++;
      return createRunResult(args, '决定采用 qwen-vl-plus 处理飞书图片输入');
    };
    const autoCapture: FeishuSyncAutoCapture = {
      capture(input) {
        captured.push(input.contentHash);
        return { contexts: 1, snippets: [{ type: 'knowledge', title: '决策', summary: input.content }] };
      },
    };
    const { tool } = createTool(runner, autoCapture);
    const added = await callTool(tool, {
      action: 'addSource',
      source: { type: 'doc', title: '图片能力文档', doc: 'docx_123' },
    });
    const sourceId = (added.output as any).source.id as string;

    const first = await callTool(tool, { action: 'syncSource', id: sourceId });
    const second = await callTool(tool, { action: 'syncSource', id: sourceId });

    expect(runCount).toBe(2);
    expect(captured).toHaveLength(1);
    expect((first.output as any).autoCapture.contexts).toBe(1);
    expect((second.output as any).autoCapture).toBeUndefined();
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

  it('injects lark-cli profile when fetching in a Feishu user context', async () => {
    const calls: string[][] = [];
    const runner: FeishuIngestRunner = async (args) => {
      calls.push(args);
      return createRunResult(args, 'doc content');
    };
    const { tool } = createTool(runner);

    const result = await callTool(tool, {
      action: 'fetchOnce',
      source: {
        type: 'doc',
        title: '用户文档',
        doc: 'docx_123',
      },
    }, {
      abortSignal: new AbortController().signal,
      userConfig: {} as never,
      feishuUserKey: 'team:ou_alice',
      larkCliProfile: 'alice',
    });

    expect(result.success).toBe(true);
    expect(calls[0]?.slice(0, 2)).toEqual(['--profile', 'alice']);
  });

  it('blocks Feishu ingest when a Feishu user has no CLI profile', async () => {
    const runner: FeishuIngestRunner = async (args) => createRunResult(args, 'should not run');
    const { tool } = createTool(runner);

    const result = await callTool(tool, {
      action: 'fetchOnce',
      source: {
        type: 'doc',
        title: '用户文档',
        doc: 'docx_123',
      },
    }, {
      abortSignal: new AbortController().signal,
      userConfig: {} as never,
      feishuUserKey: 'team:ou_missing',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('没有绑定 lark-cli profile');
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
