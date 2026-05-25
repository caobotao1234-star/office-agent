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

function failingResult(args: string[], stderr: string): LarkCliRunResult {
  return {
    ...larkResult(args, '', 1),
    stderr,
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
      '-',
    ]);
  });

  it('moves multiline document content to stdin before invoking lark-cli', async () => {
    const calls: string[][] = [];
    const options: LarkCliRunOptions[] = [];
    const tool = new LarkCliTool(tempKnowledgeBase(), async (args, opts) => {
      calls.push(args);
      options.push(opts ?? {});
      return larkResult(args, '{"ok":true}');
    });

    const result = await tool.call(
      {
        args: [
          'docs',
          '+create',
          '--api-version',
          'v2',
          '--doc-format',
          'markdown',
          '--content',
          '<title>T</title>\n# Body\n包含 "引号" 的正文',
          '--as',
          'user',
          '--dry-run',
        ],
        timeoutMs: 10_000,
      },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(true);
    expect(calls[0]).toEqual([
      'docs',
      '+create',
      '--api-version',
      'v2',
      '--doc-format',
      'markdown',
      '--content',
      '-',
      '--as',
      'user',
      '--dry-run',
    ]);
    expect(options[0]?.stdin).toBe('<title>T</title>\n# Body\n包含 "引号" 的正文');
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

  it('retries read commands on transient lark-cli failures', async () => {
    const originalBackoff = process.env['OFFICE_AGENT_LARK_CLI_RETRY_BASE_MS'];
    process.env['OFFICE_AGENT_LARK_CLI_RETRY_BASE_MS'] = '0';
    const calls: string[][] = [];
    const tool = new LarkCliTool(tempKnowledgeBase(), async (args) => {
      calls.push(args);
      return calls.length === 1
        ? failingResult(args, 'dial tcp: lookup open.feishu.cn: no such host')
        : larkResult(args, '{"ok":true}');
    });

    const result = await tool.call(
      { args: ['docs', '+fetch', '--doc', 'doc_x'], timeoutMs: 10_000 },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(result.output)).toContain('"attempts":2');
    process.env['OFFICE_AGENT_LARK_CLI_RETRY_BASE_MS'] = originalBackoff;
  });

  it('retries actual writes only for low-risk before-request failures', async () => {
    const originalBackoff = process.env['OFFICE_AGENT_LARK_CLI_RETRY_BASE_MS'];
    process.env['OFFICE_AGENT_LARK_CLI_RETRY_BASE_MS'] = '0';
    const calls: string[][] = [];
    const tool = new LarkCliTool(tempKnowledgeBase(), async (args) => {
      calls.push(args);
      if (args.includes('--help')) return larkResult(args, 'Flags:\n  --name string');
      if (calls.length === 2) return failingResult(args, 'dial tcp: lookup open.feishu.cn: no such host');
      return larkResult(args, '{"ok":true}');
    });
    const abortSignal = new AbortController().signal;

    await tool.call(
      { args: ['base', '+base-create', '--help'], timeoutMs: 10_000 },
      { abortSignal, userConfig: {} as never },
    );
    const result = await tool.call(
      { args: ['base', '+base-create', '--name', '能力表', '--as', 'user'], timeoutMs: 10_000 },
      { abortSignal, userConfig: {} as never },
    );

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(result.output)).toContain('"retried":true');
    process.env['OFFICE_AGENT_LARK_CLI_RETRY_BASE_MS'] = originalBackoff;
  });

  it('does not retry actual writes when duplicate side effects are possible', async () => {
    const originalBackoff = process.env['OFFICE_AGENT_LARK_CLI_RETRY_BASE_MS'];
    process.env['OFFICE_AGENT_LARK_CLI_RETRY_BASE_MS'] = '0';
    const calls: string[][] = [];
    const tool = new LarkCliTool(tempKnowledgeBase(), async (args) => {
      calls.push(args);
      if (args.includes('--help')) return larkResult(args, 'Flags:\n  --name string');
      return failingResult(args, 'unexpected EOF');
    });
    const abortSignal = new AbortController().signal;

    await tool.call(
      { args: ['base', '+base-create', '--help'], timeoutMs: 10_000 },
      { abortSignal, userConfig: {} as never },
    );
    const result = await tool.call(
      { args: ['base', '+base-create', '--name', '能力表', '--as', 'user'], timeoutMs: 10_000 },
      { abortSignal, userConfig: {} as never },
    );

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(result.output)).toContain('避免重复副作用');
    process.env['OFFICE_AGENT_LARK_CLI_RETRY_BASE_MS'] = originalBackoff;
  });
});
