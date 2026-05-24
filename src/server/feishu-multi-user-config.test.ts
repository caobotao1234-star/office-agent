import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadFeishuMultiUserConfig,
  resolveFeishuUser,
  safeFeishuUserKey,
} from './feishu-multi-user-config.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-feishu-config-'));
}

describe('feishu multi-user config', () => {
  it('loads multi-app config from FEISHU_MULTI_USER_CONFIG', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'feishu-users.json'), JSON.stringify({
      apps: [
        {
          key: 'alice-app',
          appId: 'cli_alice',
          appSecret: 'secret-alice',
          users: [
            { openId: 'ou_alice', cliProfile: 'alice', label: 'Alice' },
          ],
        },
        {
          key: 'bob-app',
          appId: 'cli_bob',
          appSecret: 'secret-bob',
          users: [
            { openId: 'ou_bob', cliProfile: 'bob' },
          ],
        },
      ],
    }), 'utf-8');

    const config = loadFeishuMultiUserConfig(
      { FEISHU_MULTI_USER_CONFIG: './feishu-users.json' },
      dir,
    );

    expect(config.source).toBe('file');
    expect(config.apps).toHaveLength(2);
    expect(config.apps.map((app) => app.key)).toEqual(['alice-app', 'bob-app']);
  });

  it('keeps unmapped users unconfigured by default in file config', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'feishu-users.json'), JSON.stringify({
      apps: [
        {
          key: 'team-app',
          appId: 'cli_team',
          appSecret: 'secret',
          defaultCliProfile: 'owner',
          users: [
            { openId: 'ou_owner', cliProfile: 'owner' },
          ],
        },
      ],
    }), 'utf-8');

    const config = loadFeishuMultiUserConfig(
      { FEISHU_MULTI_USER_CONFIG: './feishu-users.json' },
      dir,
    );
    const resolved = resolveFeishuUser(config.apps[0]!, 'ou_other');

    expect(resolved.configured).toBe(false);
    expect(resolved.cliProfile).toBeUndefined();
    expect(resolved.problem).toContain('没有绑定');
  });

  it('uses explicit user binding for CLI profile', () => {
    const app = loadFeishuMultiUserConfig({
      FEISHU_APP_ID: 'cli_default',
      FEISHU_APP_SECRET: 'secret',
      FEISHU_CLI_PROFILE: 'legacy-user',
    }).apps[0]!;

    const resolved = resolveFeishuUser(app, 'ou_legacy');

    expect(resolved.userKey).toBe('default:ou_legacy');
    expect(resolved.cliProfile).toBe('legacy-user');
    expect(resolved.configured).toBe(true);
  });

  it('rejects duplicate app keys and duplicate users', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'duplicate-apps.json'), JSON.stringify({
      apps: [
        { key: 'same', appId: 'cli_1', appSecret: 'secret', users: [] },
        { key: 'same', appId: 'cli_2', appSecret: 'secret', users: [] },
      ],
    }), 'utf-8');
    expect(() => loadFeishuMultiUserConfig(
      { FEISHU_MULTI_USER_CONFIG: './duplicate-apps.json' },
      dir,
    )).toThrow('重复 app key');

    fs.writeFileSync(path.join(dir, 'duplicate-users.json'), JSON.stringify({
      apps: [
        {
          key: 'one',
          appId: 'cli_1',
          appSecret: 'secret',
          users: [
            { openId: 'ou_same', cliProfile: 'a' },
            { openId: 'ou_same', cliProfile: 'b' },
          ],
        },
      ],
    }), 'utf-8');
    expect(() => loadFeishuMultiUserConfig(
      { FEISHU_MULTI_USER_CONFIG: './duplicate-users.json' },
      dir,
    )).toThrow('重复用户');
  });

  it('makes user keys safe for paths', () => {
    expect(safeFeishuUserKey('app:ou_1/abc')).not.toContain('/');
    expect(safeFeishuUserKey('app:ou_1/abc')).toContain('_3A');
  });
});
