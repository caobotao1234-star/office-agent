import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LarkCliRunResult } from './lark-cli-runner.js';
import type { FeishuPreflightRunner } from './feishu-startup-preflight.js';
import { formatFeishuPreflightReport, runFeishuStartupPreflight } from './feishu-startup-preflight.js';
import { loadFeishuMultiUserConfig } from '../server/feishu-multi-user-config.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-preflight-'));
}

function result(args: string[], stdout: string, exitCode = 0, stderr = ''): LarkCliRunResult {
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

function writeConfig(cwd: string, value: unknown): void {
  fs.writeFileSync(path.join(cwd, 'feishu-users.json'), JSON.stringify(value, null, 2), 'utf-8');
}

describe('Feishu startup preflight', () => {
  it('passes when configured profiles exist and auth status is ready', async () => {
    const cwd = tmpDir();
    writeConfig(cwd, {
      apps: [
        {
          key: 'team',
          appId: 'cli_team',
          appSecret: '${FEISHU_APP_SECRET_TEAM}',
          users: [{ openId: 'ou_alice', cliProfile: 'alice' }],
        },
      ],
    });
    const config = loadFeishuMultiUserConfig({
      FEISHU_MULTI_USER_CONFIG: './feishu-users.json',
      FEISHU_APP_SECRET_TEAM: 'secret',
    }, cwd);
    const runner: FeishuPreflightRunner = async (args) => {
      if (args.join(' ') === 'profile list') {
        return result(args, JSON.stringify([{ name: 'alice', appId: 'cli_team', tokenStatus: 'valid' }]));
      }
      return result(args, JSON.stringify({ tokenStatus: 'valid' }));
    };

    const report = await runFeishuStartupPreflight(config, { runner });

    expect(report.ok).toBe(true);
    expect(report.checkedProfiles).toEqual(['alice']);
    expect(formatFeishuPreflightReport(report)).toContain('[OK]');
  });

  it('fails for missing profile, app mismatch, missing user binding and bad auth', async () => {
    const cwd = tmpDir();
    writeConfig(cwd, {
      apps: [
        {
          key: 'team',
          appId: 'cli_team',
          appSecret: '${FEISHU_APP_SECRET_TEAM}',
          users: [
            { openId: 'ou_missing', cliProfile: 'missing' },
            { openId: 'ou_wrong', cliProfile: 'wrong-app' },
            { openId: 'ou_no_profile' },
            { openId: 'ou_bad_auth', cliProfile: 'bad-auth' },
          ],
        },
      ],
    });
    const config = loadFeishuMultiUserConfig({
      FEISHU_MULTI_USER_CONFIG: './feishu-users.json',
      FEISHU_APP_SECRET_TEAM: 'secret',
    }, cwd);
    const runner: FeishuPreflightRunner = async (args) => {
      if (args.join(' ') === 'profile list') {
        return result(args, JSON.stringify([
          { name: 'wrong-app', appId: 'cli_other', tokenStatus: 'valid' },
          { name: 'bad-auth', appId: 'cli_team', tokenStatus: 'valid' },
        ]));
      }
      if (args[1] === 'bad-auth') return result(args, '', 1, 'not logged in');
      return result(args, JSON.stringify({ tokenStatus: 'valid' }));
    };

    const report = await runFeishuStartupPreflight(config, { runner });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'missing_profile',
      'profile_app_mismatch',
      'user_missing_cli_profile',
      'auth_status_failed',
    ]));
  });

  it('warns about plain appSecret without printing the secret', async () => {
    const cwd = tmpDir();
    writeConfig(cwd, {
      apps: [
        {
          key: 'plain',
          appId: 'cli_plain',
          appSecret: 'real-secret-should-not-print',
          users: [{ openId: 'ou_plain', cliProfile: 'plain-profile' }],
        },
      ],
    });
    const config = loadFeishuMultiUserConfig({
      FEISHU_MULTI_USER_CONFIG: './feishu-users.json',
    }, cwd);
    const runner: FeishuPreflightRunner = async (args) => {
      if (args.join(' ') === 'profile list') {
        return result(args, JSON.stringify([{ name: 'plain-profile', appId: 'cli_plain', tokenStatus: 'valid' }]));
      }
      return result(args, JSON.stringify({ tokenStatus: 'valid' }));
    };

    const report = await runFeishuStartupPreflight(config, { runner });
    const formatted = formatFeishuPreflightReport(report);

    expect(report.ok).toBe(true);
    expect(report.issues.find((issue) => issue.code === 'plain_app_secret')?.level).toBe('warn');
    expect(formatted).not.toContain('real-secret-should-not-print');
  });

  it('can skip auth status checks with an explicit warning', async () => {
    const cwd = tmpDir();
    writeConfig(cwd, {
      apps: [
        {
          key: 'team',
          appId: 'cli_team',
          appSecret: '${FEISHU_APP_SECRET_TEAM}',
          users: [{ openId: 'ou_alice', cliProfile: 'alice' }],
        },
      ],
    });
    const config = loadFeishuMultiUserConfig({
      FEISHU_MULTI_USER_CONFIG: './feishu-users.json',
      FEISHU_APP_SECRET_TEAM: 'secret',
    }, cwd);
    const calls: string[][] = [];
    const runner: FeishuPreflightRunner = async (args) => {
      calls.push(args);
      return result(args, JSON.stringify([{ name: 'alice', appId: 'cli_team', tokenStatus: 'valid' }]));
    };

    const report = await runFeishuStartupPreflight(config, {
      runner,
      env: { OFFICE_AGENT_FEISHU_PREFLIGHT_SKIP_AUTH: '1' },
    });

    expect(report.ok).toBe(true);
    expect(report.issues.map((issue) => issue.code)).toContain('auth_status_skipped');
    expect(calls).toEqual([['profile', 'list']]);
  });
});
