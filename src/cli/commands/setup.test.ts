import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LarkCliRunResult } from '../../services/lark-cli-runner.js';
import { buildFeishuQuickstart, buildFeishuSetupGuide, type SetupRunner } from './setup.js';

function result(args: string[], stdout: string, exitCode = 0): LarkCliRunResult {
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

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-setup-'));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function profileRunner(profiles: unknown[]): SetupRunner {
  return async (args) => {
    if (args.join(' ') === 'profile list') return result(args, JSON.stringify(profiles));
    return result(args, '[]');
  };
}

describe('setup command', () => {
  it('renders a Feishu setup guide with current profiles and env-secret example', async () => {
    const runner: SetupRunner = async (args) => {
      if (args.join(' ') === 'profile list') {
        return result(args, JSON.stringify([
          {
            name: 'alice',
            appId: 'cli_alice',
            active: true,
            user: 'Alice',
            tokenStatus: 'ready',
          },
        ]));
      }
      return result(args, '[]');
    };

    const guide = await buildFeishuSetupGuide({
      env: {
        FEISHU_APP_ID: 'cli_alice',
        FEISHU_APP_SECRET: 'secret',
        FEISHU_CLI_PROFILE: 'alice',
      },
      runner,
      cwd: process.cwd(),
    });

    expect(guide).toContain('alice');
    expect(guide).toContain('FEISHU_APP_SECRET_MY_COMPANY');
    expect(guide).toContain('im.message.receive_v1');
    expect(guide).toContain('npm run lark -- --profile alice auth login');
  });

  it('falls back to a default profile name when lark-cli profile list fails', async () => {
    const runner: SetupRunner = async (args) => result(args, '', 1);

    const guide = await buildFeishuSetupGuide({
      env: {},
      runner,
      cwd: process.cwd(),
    });

    expect(guide).toContain('未发现 profile');
    expect(guide).toContain('my-new-company');
  });

  it('quickstart replaces placeholder user and writes env pointer when enough context is available', async () => {
    const cwd = tempDir();
    const dataDir = path.join(cwd, 'data');
    fs.writeFileSync(path.join(cwd, '.env'), 'DASHSCOPE_API_KEY=sk-test\n', 'utf-8');
    writeJson(path.join(cwd, 'feishu-users.json'), {
      apps: [
        {
          key: 'cbt-app',
          appId: 'cli_team',
          appSecret: '${FEISHU_APP_SECRET_CBT}',
          users: [
            { openId: 'ou_xxx', cliProfile: 'alice', label: 'Alice' },
          ],
        },
      ],
    });
    writeJson(path.join(dataDir, 'feishu-recipients.json'), {
      recipients: [
        {
          appKey: 'cbt-app',
          senderId: 'ou_real',
          chatId: 'oc_real',
          updatedAt: '2026-05-25T00:00:00.000Z',
        },
      ],
    });

    const report = await buildFeishuQuickstart([], {
      cwd,
      dataDir,
      env: {
        FEISHU_APP_SECRET_CBT: 'secret',
      },
      runner: profileRunner([
        {
          name: 'my-new-company',
          appId: 'cli_team',
          user: '曹博弢',
          tokenStatus: 'valid',
        },
      ]),
    });

    expect(report).toContain('已写入');
    expect(report).toContain('cliProfile: my-new-company');
    const config = JSON.parse(fs.readFileSync(path.join(cwd, 'feishu-users.json'), 'utf-8'));
    expect(config.apps[0].users).toEqual([
      { openId: 'ou_real', cliProfile: 'my-new-company', label: '曹博弢' },
    ]);
    expect(fs.readFileSync(path.join(cwd, '.env'), 'utf-8')).toContain('FEISHU_MULTI_USER_CONFIG=feishu-users.json');
  });

  it('quickstart can create a new config file and supports dry-run without writing', async () => {
    const cwd = tempDir();
    const dataDir = path.join(cwd, 'data');
    writeJson(path.join(dataDir, 'feishu-recipients.json'), {
      recipients: [
        {
          appKey: 'new-app',
          senderId: 'ou_new',
          chatId: 'oc_new',
          updatedAt: '2026-05-25T00:00:00.000Z',
        },
      ],
    });

    const dryRun = await buildFeishuQuickstart(['--dry-run'], {
      cwd,
      dataDir,
      env: {},
      runner: profileRunner([
        {
          name: 'bob',
          appId: 'cli_new',
          user: 'Bob',
          tokenStatus: 'valid',
        },
      ]),
    });

    expect(dryRun).toContain('Dry run，未写入文件');
    expect(dryRun).toContain('"appId": "cli_new"');
    expect(fs.existsSync(path.join(cwd, 'feishu-users.json'))).toBe(false);

    const written = await buildFeishuQuickstart([], {
      cwd,
      dataDir,
      env: {},
      runner: profileRunner([
        {
          name: 'bob',
          appId: 'cli_new',
          user: 'Bob',
          tokenStatus: 'valid',
        },
      ]),
    });

    expect(written).toContain('已写入');
    const config = JSON.parse(fs.readFileSync(path.join(cwd, 'feishu-users.json'), 'utf-8'));
    expect(config.apps[0]).toMatchObject({
      key: 'new-app',
      appId: 'cli_new',
      appSecret: '${FEISHU_APP_SECRET_NEW_APP}',
      users: [{ openId: 'ou_new', cliProfile: 'bob', label: 'Bob' }],
    });
  });

  it('quickstart migrates plain appSecret to an env reference without printing the secret', async () => {
    const cwd = tempDir();
    const dataDir = path.join(cwd, 'data');
    writeJson(path.join(cwd, 'feishu-users.json'), {
      apps: [
        {
          key: 'plain-secret-app',
          appId: 'cli_plain',
          appSecret: 'real-secret-should-not-print',
          users: [],
        },
      ],
    });
    writeJson(path.join(dataDir, 'feishu-recipients.json'), {
      recipients: [
        {
          appKey: 'plain-secret-app',
          senderId: 'ou_plain',
          chatId: 'oc_plain',
          updatedAt: '2026-05-25T00:00:00.000Z',
        },
      ],
    });

    const report = await buildFeishuQuickstart([], {
      cwd,
      dataDir,
      env: {},
      runner: profileRunner([
        {
          name: 'plain-profile',
          appId: 'cli_plain',
          user: 'Plain',
          tokenStatus: 'valid',
        },
      ]),
    });

    expect(report).toContain('明文 appSecret');
    expect(report).not.toContain('real-secret-should-not-print');
    const config = JSON.parse(fs.readFileSync(path.join(cwd, 'feishu-users.json'), 'utf-8'));
    expect(config.apps[0].appSecret).toBe('${FEISHU_APP_SECRET_PLAIN_SECRET_APP}');
  });

  it('quickstart prints candidates and a copyable command when information is missing', async () => {
    const cwd = tempDir();

    const report = await buildFeishuQuickstart([], {
      cwd,
      dataDir: path.join(cwd, 'data'),
      env: {},
      runner: profileRunner([
        { name: 'alice', appId: 'cli_a', tokenStatus: 'valid' },
        { name: 'bob', appId: 'cli_b', tokenStatus: 'valid' },
      ]),
    });

    expect(report).toContain('还缺少必要信息');
    expect(report).toContain('--open-id <ou_xxx>');
    expect(report).toContain('--profile <lark-cli-profile>');
    expect(fs.existsSync(path.join(cwd, 'feishu-users.json'))).toBe(false);
  });
});
