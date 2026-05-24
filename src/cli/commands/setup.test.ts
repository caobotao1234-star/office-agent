import { describe, expect, it } from 'vitest';
import type { LarkCliRunResult } from '../../services/lark-cli-runner.js';
import { buildFeishuSetupGuide, type SetupRunner } from './setup.js';

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
});
