import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LarkCliRunOptions, LarkCliRunResult } from '../../services/lark-cli-runner.js';
import { LarkCliKnowledgeBase } from '../../services/lark-cli-knowledge-base.js';
import { LarkCliTool, type LarkCliRunner } from './index.js';

function tempKnowledgeBase(): LarkCliKnowledgeBase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-cli-tool-replay-'));
  return new LarkCliKnowledgeBase(path.join(dir, 'cache.json'));
}

function larkResult(args: string[], stdout = '{}', exitCode = 0): LarkCliRunResult {
  return {
    command: `lark-cli ${args.join(' ')}`,
    args,
    exitCode,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
    aborted: false,
    truncated: false,
  };
}

function fakeRunner(calls: string[][]): LarkCliRunner {
  return async (args: string[], _options?: LarkCliRunOptions) => {
    calls.push(args);
    if (args.includes('--help')) {
      return larkResult(args, 'Flags:\n  --content string\n  --doc-format string\n  --dry-run');
    }
    return larkResult(args, '{"ok":true}');
  };
}

describe('LarkCliTool replay', () => {
  it('blocks unguided writes, records help, then executes with the bound user profile', async () => {
    const calls: string[][] = [];
    const tool = new LarkCliTool(tempKnowledgeBase(), fakeRunner(calls));
    const abortSignal = new AbortController().signal;

    const blocked = await tool.call(
      {
        args: ['docs', '+create', '--api-version', 'v2', '--doc-format', 'markdown', '--content', '<title>T</title>\nBody'],
        timeoutMs: 10_000,
      },
      { abortSignal, userConfig: {} as never },
    );
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('必须先查看');
    expect(calls).toHaveLength(0);

    const help = await tool.call(
      { args: ['docs', '+create', '--api-version', 'v2', '--help'], timeoutMs: 10_000 },
      { abortSignal, userConfig: {} as never },
    );
    expect(help.success).toBe(true);
    expect(calls).toEqual([
      ['docs', '+create', '--api-version', 'v2', '--help'],
    ]);

    const executed = await tool.call(
      {
        args: ['docs', '+create', '--api-version', 'v2', '--doc-format', 'markdown', '--content', '<title>T</title>\nBody'],
        timeoutMs: 10_000,
      },
      {
        abortSignal,
        userConfig: {} as never,
        feishuAppKey: 'team',
        feishuUserKey: 'team:ou_alice',
        larkCliProfile: 'alice',
      },
    );
    expect(executed.success).toBe(true);
    expect(calls[1]).toEqual([
      '--profile',
      'alice',
      'docs',
      '+create',
      '--api-version',
      'v2',
      '--doc-format',
      'markdown',
      '--content',
      '<title>T</title>\nBody',
    ]);
  });

  it('blocks Feishu user operations before the runner when no CLI profile is bound', async () => {
    const calls: string[][] = [];
    const tool = new LarkCliTool(tempKnowledgeBase(), fakeRunner(calls));

    const result = await tool.call(
      { args: ['docs', '+fetch', '--doc', 'doc_x'], timeoutMs: 10_000 },
      {
        abortSignal: new AbortController().signal,
        userConfig: {} as never,
        feishuAppKey: 'team',
        feishuUserKey: 'team:ou_missing',
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('没有绑定 lark-cli profile');
    expect(calls).toHaveLength(0);
  });

  it('rejects known-bad Base arguments before invoking the runner', async () => {
    const calls: string[][] = [];
    const tool = new LarkCliTool(tempKnowledgeBase(), fakeRunner(calls));

    const badCreate = await tool.call(
      { args: ['base', '+create', '--title', '能力表', '--dry-run'], timeoutMs: 10_000 },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );
    expect(badCreate.success).toBe(false);
    expect(badCreate.error).toContain('+base-create');

    const badTable = await tool.call(
      { args: ['base', '+table-create', '--base', 'base_x', '--name', '能力清单', '--dry-run'], timeoutMs: 10_000 },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );
    expect(badTable.success).toBe(false);
    expect(badTable.error).toContain('--base-token');
    expect(calls).toHaveLength(0);
  });
});
