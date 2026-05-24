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
