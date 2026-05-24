import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OperationLedger } from '../../core/operation-ledger.js';
import { safeFeishuUserKey } from '../../server/feishu-multi-user-config.js';
import { buildDebugReport } from './debug.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-debug-'));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function seedUser(dataDir: string): { userKey: string; safeUserKey: string; userDir: string } {
  const userKey = 'team:ou_alice';
  const safeUserKey = safeFeishuUserKey(userKey);
  const userDir = path.join(dataDir, 'users', safeUserKey);
  fs.mkdirSync(userDir, { recursive: true });
  writeJson(path.join(dataDir, 'feishu-recipients.json'), {
    recipients: [
      {
        appKey: 'team',
        senderId: 'ou_alice',
        chatId: 'oc_chat',
        updatedAt: '2026-05-25T00:00:00.000Z',
      },
    ],
  });
  writeJson(path.join(userDir, 'agenda.json'), { items: [] });

  const ledger = new OperationLedger(path.join(userDir, 'operation-ledger.json'));
  const turnId = ledger.startTurn({
    userMessage: '做个多维表格',
    model: 'qwen-plus',
    now: new Date('2026-05-25T01:00:00.000Z'),
  });
  ledger.recordToolUse(turnId, 'LarkCli', { args: ['base', '+base-create'] });
  ledger.recordToolResult(turnId, 'LarkCli', { success: true, output: { base_token: 'base_x' } });
  ledger.finishTurn(turnId, {
    status: 'completed',
    finalText: '已创建多维表格',
    now: new Date('2026-05-25T01:00:02.000Z'),
  });

  return { userKey, safeUserKey, userDir };
}

describe('debug command', () => {
  it('lists Feishu recipients and isolated user directories', () => {
    const dataDir = tmpDir();
    const seeded = seedUser(dataDir);

    const report = buildDebugReport(['users'], { dataDir, cwd: dataDir, logDir: path.join(dataDir, 'logs') });

    expect(report).toContain('Office Agent Debug Users');
    expect(report).toContain('team:ou_alice');
    expect(report).toContain('chatId=oc_chat');
    expect(report).toContain(`dir=users/${seeded.safeUserKey}`);
    expect(report).toContain('exists=yes');
  });

  it('recognizes legacy openId user directories while reporting the encoded key', () => {
    const dataDir = tmpDir();
    const legacyDir = path.join(dataDir, 'users', 'ou_legacy');
    fs.mkdirSync(legacyDir, { recursive: true });
    writeJson(path.join(dataDir, 'feishu-recipients.json'), {
      recipients: [
        {
          appKey: 'default',
          senderId: 'ou_legacy',
          chatId: 'oc_legacy',
          updatedAt: '2026-05-25T00:00:00.000Z',
        },
      ],
    });

    const usersReport = buildDebugReport(['users'], { dataDir, cwd: dataDir });
    expect(usersReport).toContain('dir=users/ou_legacy');
    expect(usersReport).toContain(`legacyDirFor=${safeFeishuUserKey('default:ou_legacy')}`);
    expect(usersReport).not.toContain('Data dirs without recipient');

    const userReport = buildDebugReport(['user', 'default:ou_legacy'], { dataDir, cwd: dataDir });
    expect(userReport).toContain(`Safe key: ${safeFeishuUserKey('default:ou_legacy')}`);
    expect(userReport).toContain(`Data dir: ${legacyDir}`);
  });

  it('resolves a user and prints file state plus the recent operation ledger', () => {
    const dataDir = tmpDir();
    const seeded = seedUser(dataDir);

    const report = buildDebugReport(['user', seeded.userKey], { dataDir, cwd: dataDir });

    expect(report).toContain('Office Agent Debug User');
    expect(report).toContain(`Safe key: ${seeded.safeUserKey}`);
    expect(report).toContain('agenda.json: file');
    expect(report).toContain('LarkCli success');
    expect(report).toContain('已创建多维表格');
  });

  it('prints the last operation for a selected user', () => {
    const dataDir = tmpDir();
    const seeded = seedUser(dataDir);

    const report = buildDebugReport(['last', '--user', 'ou_alice'], { dataDir, cwd: dataDir });

    expect(report).toContain('Office Agent Debug Last');
    expect(report).toContain(`User key: ${seeded.userKey}`);
    expect(report).toContain('做个多维表格');
  });

  it('summarizes Feishu profile mappings without leaking app secrets', () => {
    const cwd = tmpDir();
    writeJson(path.join(cwd, 'feishu-users.json'), {
      apps: [
        {
          key: 'team',
          appId: 'cli_team',
          appSecret: '${FEISHU_SECRET_TEAM}',
          defaultCliProfile: 'alice',
          users: [
            { openId: 'ou_alice', cliProfile: 'alice', label: 'Alice' },
            { openId: 'ou_bob', cliProfile: 'bob', label: 'Bob' },
          ],
        },
      ],
    });

    const report = buildDebugReport(['feishu-profiles'], {
      cwd,
      dataDir: path.join(cwd, 'data'),
      env: {
        FEISHU_MULTI_USER_CONFIG: './feishu-users.json',
        FEISHU_SECRET_TEAM: 'super-secret-value',
      },
    });

    expect(report).toContain('Office Agent Debug Feishu Profiles');
    expect(report).toContain('defaultCliProfile=alice');
    expect(report).toContain('cliProfile=bob');
    expect(report).not.toContain('super-secret-value');
  });

  it('tails the latest agent log file', () => {
    const cwd = tmpDir();
    const logDir = path.join(cwd, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'agent-2026-05-25.log'), ['one', 'two', 'three'].join('\n'), 'utf-8');

    const report = buildDebugReport(['logs', '--tail', '2'], { cwd, dataDir: path.join(cwd, 'data'), logDir });

    expect(report).toContain('Office Agent Debug Logs');
    expect(report).not.toContain('\none\n');
    expect(report).toContain('two');
    expect(report).toContain('three');
  });
});
