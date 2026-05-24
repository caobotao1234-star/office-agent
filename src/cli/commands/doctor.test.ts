import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDoctorReport, runDoctorChecks, type DoctorRunner } from './doctor.js';
import type { LarkCliRunResult } from '../../services/lark-cli-runner.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-doctor-'));
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

describe('doctor', () => {
  it('reports local readiness without requiring real API keys', async () => {
    const cwd = tmpDir();
    fs.writeFileSync(path.join(cwd, '.env'), 'OFFICE_AGENT_LLM_PROVIDER=deepseek\n', 'utf-8');
    const runner: DoctorRunner = async (args) => {
      if (args[0] === '--version') return result(args, 0, 'lark-cli version 1.0.0');
      return result(args, 1, '', 'not logged in');
    };

    const report = await runDoctorChecks({
      cwd,
      dataDir: path.join(cwd, 'data'),
      logDir: path.join(cwd, 'logs'),
      env: {
        OFFICE_AGENT_LLM_PROVIDER: 'deepseek',
        DEEPSEEK_MODEL: 'deepseek-v4-pro',
      },
      runner,
    });

    expect(report.checks.find((check) => check.name === '.env')?.status).toBe('ok');
    expect(report.checks.find((check) => check.name === 'LLM Provider')?.status).toBe('warn');
    expect(report.checks.find((check) => check.name === 'lark-cli')?.status).toBe('ok');
    expect(report.checks.find((check) => check.name === 'lark-cli auth')?.status).toBe('warn');
    expect(formatDoctorReport(report)).toContain('Office Agent Doctor');
  });

  it('summarizes and masks successful lark-cli auth JSON', async () => {
    const cwd = tmpDir();
    const runner: DoctorRunner = async (args) => {
      if (args[0] === '--version') return result(args, 0, 'lark-cli version 1.0.0');
      return result(args, 0, JSON.stringify({
        identity: 'user',
        tokenStatus: 'ready',
        userOpenId: 'ou_1234567890abcdef',
        userName: 'Someone',
        scope: 'very long scope list',
        identities: {
          bot: { status: 'ready', available: true },
          user: { status: 'ready', available: true, tokenStatus: 'ready', openId: 'ou_1234567890abcdef' },
        },
      }));
    };

    const report = await runDoctorChecks({
      cwd,
      dataDir: path.join(cwd, 'data'),
      logDir: path.join(cwd, 'logs'),
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      runner,
    });
    const auth = report.checks.find((check) => check.name === 'lark-cli auth');
    expect(auth?.detail).toContain('identity=user');
    expect(auth?.detail).toContain('openId=ou_1***cdef');
    expect(auth?.detail).not.toContain('Someone');
    expect(auth?.detail).not.toContain('very long scope list');
  });

  it('checks configured lark-cli profiles from multi-user Feishu config', async () => {
    const cwd = tmpDir();
    fs.writeFileSync(path.join(cwd, 'feishu-users.json'), JSON.stringify({
      apps: [
        {
          key: 'team',
          appId: 'cli_team',
          appSecret: 'secret',
          users: [
            { openId: 'ou_alice', cliProfile: 'alice' },
            { openId: 'ou_bob', cliProfile: 'bob' },
          ],
        },
      ],
    }), 'utf-8');
    const seenArgs: string[][] = [];
    const runner: DoctorRunner = async (args) => {
      seenArgs.push(args);
      if (args[0] === '--version') return result(args, 0, 'lark-cli version 1.0.0');
      return result(args, args[1] === 'bob' ? 1 : 0, args[1] === 'bob' ? '' : '{"identity":"user"}', args[1] === 'bob' ? 'not logged in' : '');
    };

    const report = await runDoctorChecks({
      cwd,
      dataDir: path.join(cwd, 'data'),
      logDir: path.join(cwd, 'logs'),
      env: {
        FEISHU_MULTI_USER_CONFIG: './feishu-users.json',
        DASHSCOPE_API_KEY: 'sk-test',
      },
      runner,
    });

    expect(seenArgs).toContainEqual(['--profile', 'alice', 'auth', 'status']);
    expect(seenArgs).toContainEqual(['--profile', 'bob', 'auth', 'status']);
    expect(seenArgs).toContainEqual([
      '--profile', 'alice',
      'docs', '+search',
      '--query', 'OfficeAgentDoctorProbe',
      '--page-size', '1',
      '--as', 'user',
      '--format', 'json',
    ]);
    expect(report.checks.find((check) => check.name === '飞书机器人配置')?.detail).toContain('users=2');
    expect(report.checks.find((check) => check.name === 'lark-cli auth')?.detail).toContain('bob');
    expect(report.checks.find((check) => check.name === '飞书 CLI 读权限探测')?.detail).toContain('bob');
  });

  it('flags invalid provider configuration', async () => {
    const cwd = tmpDir();
    const report = await runDoctorChecks({
      cwd,
      dataDir: path.join(cwd, 'data'),
      logDir: path.join(cwd, 'logs'),
      env: { OFFICE_AGENT_LLM_PROVIDER: 'bad-provider' },
      runner: async (args) => result(args, 0, 'ok'),
    });

    expect(report.checks.find((check) => check.name === 'LLM Provider')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === '模型能力')?.status).toBe('fail');
  });
});
