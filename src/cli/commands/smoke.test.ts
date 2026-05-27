import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatSmokeReport, runSmokeChecks, type SmokeOptions } from './smoke.js';
import type { LarkCliRunResult } from '../../services/lark-cli-runner.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-smoke-test-'));
}

function result(args: string[], exitCode: number, stdout: string, stderr = ''): LarkCliRunResult {
  return {
    command: `lark-cli ${args.join(' ')}`,
    args,
    exitCode,
    signal: null,
    stdout,
    stderr,
    timedOut: false,
    aborted: false,
    truncated: false,
  };
}

describe('smoke', () => {
  it('runs without real LLM or real Feishu probes when skipped', async () => {
    const cwd = tmpDir();
    const seenArgs: string[][] = [];
    const options: SmokeOptions = {
      cwd,
      dataDir: path.join(cwd, 'data'),
      env: {
        OFFICE_AGENT_LLM_PROVIDER: 'deepseek',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
        OFFICE_AGENT_SMOKE_SKIP_FEISHU: '1',
        OFFICE_AGENT_DOCTOR_SKIP_FEISHU_PROBES: '1',
      },
      runner: async (args) => {
        seenArgs.push(args);
        if (args[0] === '--version') return result(args, 0, 'lark-cli version 1.0.0');
        return result(args, 0, '{"identity":"user","tokenStatus":"valid"}');
      },
    };

    const report = await runSmokeChecks(options);

    expect(report.checks.find((check) => check.name === 'tool schema')?.status).toBe('ok');
    expect(report.checks.find((check) => check.name === 'real LLM')?.status).toBe('warn');
    expect(report.checks.find((check) => check.name === 'lark-cli dry-run')?.detail).toContain('skipped');
    expect(seenArgs).toEqual([['--version'], ['auth', 'status']]);
    expect(formatSmokeReport(report)).toContain('Office Agent Smoke');
  });

  it('runs docs/base dry-run probes for configured profiles', async () => {
    const cwd = tmpDir();
    fs.writeFileSync(path.join(cwd, 'feishu-users.json'), JSON.stringify({
      apps: [
        {
          key: 'team',
          appId: 'cli_team',
          appSecret: 'secret',
          users: [{ openId: 'ou_alice', cliProfile: 'alice' }],
        },
      ],
    }), 'utf-8');
    const seenArgs: string[][] = [];

    const report = await runSmokeChecks({
      cwd,
      dataDir: path.join(cwd, 'data'),
      env: {
        FEISHU_MULTI_USER_CONFIG: './feishu-users.json',
        DASHSCOPE_API_KEY: 'sk-test',
        OFFICE_AGENT_DOCTOR_SKIP_FEISHU_PROBES: '1',
      },
      runner: async (args) => {
        seenArgs.push(args);
        if (args[0] === '--version') return result(args, 0, 'lark-cli version 1.0.0');
        if (args.includes('auth')) return result(args, 0, '{"identity":"user","tokenStatus":"valid"}');
        return result(args, 0, '{"ok":true}');
      },
    });

    expect(seenArgs).toContainEqual([
      '--profile', 'alice',
      'docs', '+create',
      '--api-version', 'v2',
      '--doc-format', 'markdown',
      '--content', '-',
      '--as', 'user',
      '--dry-run',
    ]);
    expect(seenArgs).toContainEqual([
      '--profile', 'alice',
      'base', '+base-create',
      '--name', 'Office Agent Smoke',
      '--as', 'user',
      '--dry-run',
    ]);
    expect(report.checks.find((check) => check.name === 'lark-cli docs create dry-run')?.status).toBe('ok');
    expect(report.checks.find((check) => check.name === 'lark-cli base create dry-run')?.status).toBe('ok');
  });
});
