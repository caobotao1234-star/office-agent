/**
 * `oa debug` — local read-only diagnostics for runtime state and recent turns.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OperationLedger } from '../../core/operation-ledger.js';
import { loadFeishuMultiUserConfig, safeFeishuUserKey } from '../../server/feishu-multi-user-config.js';
import type { FeishuRecipient } from '../../services/feishu-recipient-store.js';

export interface DebugOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  dataDir?: string;
  logDir?: string;
}

interface DebugPaths {
  cwd: string;
  dataDir: string;
  usersDir: string;
  logDir: string;
  recipientFile: string;
}

type UserResolution =
  | {
    status: 'ok';
    input: string;
    userKey?: string;
    safeUserKey: string;
    userDir: string;
    recipient?: FeishuRecipient;
  }
  | { status: 'ambiguous'; input: string; candidates: string[] }
  | { status: 'not-found'; input: string; candidates: string[] };

const HELP = `
Office Agent debug

用法:
  oa debug users                 列出飞书收件人和用户隔离目录
  oa debug user <userKey>        查看某个用户目录、最近工具账本
  oa debug last [--user KEY]     查看最近一轮任务账本
  oa debug feishu-profiles       查看多用户 CLI profile 映射（不显示 secret）
  oa debug logs [--tail 80]      查看最新 agent 日志尾部
`.trim();

export async function debug(args: string[], options: DebugOptions = {}): Promise<void> {
  console.log(buildDebugReport(args, options));
}

export function buildDebugReport(args: string[], options: DebugOptions = {}): string {
  const command = args[0];
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    return HELP;
  }

  const paths = resolveDebugPaths(options);
  switch (command) {
    case 'users':
      return buildUsersReport(paths);
    case 'user':
      return buildUserReport(args[1], paths);
    case 'last':
      return buildLastReport(args.slice(1), paths);
    case 'feishu-profiles':
      return buildFeishuProfilesReport(paths, options.env ?? process.env);
    case 'logs':
      return buildLogsReport(args.slice(1), paths);
    default:
      return [`未知 debug 子命令: ${command}`, '', HELP].join('\n');
  }
}

function buildUsersReport(paths: DebugPaths): string {
  const recipients = readRecipients(paths.recipientFile);
  const userDirs = listUserDirs(paths.usersDir);
  const recipientDirs = new Set(recipients.flatMap((recipient) => [
    safeFeishuUserKey(`${recipient.appKey}:${recipient.senderId}`),
    recipient.senderId,
  ]));
  const orphanDirs = userDirs.filter((dir) => !recipientDirs.has(dir));

  const lines = [
    'Office Agent Debug Users',
    '',
    `Data dir: ${paths.dataDir}`,
    `Recipients: ${recipients.length}`,
  ];

  if (recipients.length === 0) {
    lines.push('- none');
  } else {
    for (const recipient of recipients) {
      const safeUserKey = safeFeishuUserKey(`${recipient.appKey}:${recipient.senderId}`);
      const userDir = resolveExistingUserDir(paths, safeUserKey, recipient.senderId);
      const dirName = path.basename(userDir);
      lines.push([
        `- ${recipient.appKey}:${recipient.senderId}`,
        `chatId=${recipient.chatId}`,
        `updatedAt=${recipient.updatedAt}`,
        `dir=users/${dirName}`,
        dirName !== safeUserKey ? `legacyDirFor=${safeUserKey}` : undefined,
        `exists=${fs.existsSync(userDir) ? 'yes' : 'no'}`,
      ].filter(Boolean).join(' '));
    }
  }

  lines.push('');
  lines.push(`User data dirs: ${userDirs.length}`);
  for (const dir of userDirs) lines.push(`- users/${dir} ${summarizeDir(path.join(paths.usersDir, dir))}`);
  if (orphanDirs.length > 0) {
    lines.push('');
    lines.push(`Data dirs without recipient: ${orphanDirs.join(', ')}`);
  }

  return lines.join('\n');
}

function buildUserReport(input: string | undefined, paths: DebugPaths): string {
  if (!input) return ['缺少 userKey。', '', '示例: oa debug user my-app:ou_xxx'].join('\n');

  const resolved = resolveDebugUser(input, paths);
  if (resolved.status !== 'ok') return formatUnresolvedUser(resolved, paths);

  const lines = [
    'Office Agent Debug User',
    '',
    `Input: ${resolved.input}`,
    `User key: ${resolved.userKey ?? '(unknown; matched by data dir)'}`,
    `Safe key: ${resolved.safeUserKey}`,
    `Data dir: ${resolved.userDir}`,
  ];

  if (resolved.recipient) {
    lines.push(`Recipient: appKey=${resolved.recipient.appKey} chatId=${resolved.recipient.chatId} updatedAt=${resolved.recipient.updatedAt}`);
  } else {
    lines.push('Recipient: not found');
  }

  lines.push('');
  lines.push('Files:');
  for (const file of trackedUserFiles()) {
    lines.push(`- ${file}: ${summarizePath(path.join(resolved.userDir, file))}`);
  }

  lines.push('');
  lines.push('Recent operation:');
  lines.push(formatLedger(path.join(resolved.userDir, 'operation-ledger.json')));
  return lines.join('\n');
}

function buildLastReport(args: string[], paths: DebugPaths): string {
  const user = getOptionValue(args, '--user');
  if (user) {
    const resolved = resolveDebugUser(user, paths);
    if (resolved.status !== 'ok') return formatUnresolvedUser(resolved, paths);
    return [
      'Office Agent Debug Last',
      '',
      `User key: ${resolved.userKey ?? resolved.safeUserKey}`,
      `Data dir: ${resolved.userDir}`,
      '',
      formatLedger(path.join(resolved.userDir, 'operation-ledger.json')),
    ].join('\n');
  }

  return [
    'Office Agent Debug Last',
    '',
    `Data dir: ${paths.dataDir}`,
    '',
    formatLedger(path.join(paths.dataDir, 'operation-ledger.json')),
  ].join('\n');
}

function buildFeishuProfilesReport(paths: DebugPaths, env: NodeJS.ProcessEnv): string {
  try {
    const config = loadFeishuMultiUserConfig(env, paths.cwd);
    const lines = [
      'Office Agent Debug Feishu Profiles',
      '',
      `Config: ${config.source}${config.configPath ? ` (${path.relative(paths.cwd, config.configPath) || config.configPath})` : ''}`,
    ];

    for (const app of config.apps) {
      lines.push([
        `- app ${app.key}`,
        `appId=${app.appId}`,
        `defaultCliProfile=${app.defaultCliProfile ?? '(none)'}`,
        `allowUnmappedUsers=${app.allowUnmappedUsersWithDefaultProfile}`,
        `users=${app.users.length}`,
      ].join(' '));
      for (const user of app.users) {
        lines.push([
          `  - openId=${user.openId}`,
          `cliProfile=${user.cliProfile ?? '(none)'}`,
          `enabled=${user.enabled}`,
          user.label ? `label=${user.label}` : undefined,
        ].filter(Boolean).join(' '));
      }
    }
    return lines.join('\n');
  } catch (err) {
    return [
      'Office Agent Debug Feishu Profiles',
      '',
      `Config error: ${err instanceof Error ? err.message : String(err)}`,
      '不会显示 appSecret；请检查 FEISHU_MULTI_USER_CONFIG、FEISHU_APP_ID、FEISHU_APP_SECRET。',
    ].join('\n');
  }
}

function buildLogsReport(args: string[], paths: DebugPaths): string {
  const tail = parsePositiveInt(getOptionValue(args, '--tail'), 80);
  const latest = latestLogFile(paths.logDir);
  const lines = [
    'Office Agent Debug Logs',
    '',
    `Log dir: ${paths.logDir}`,
    `Tail: ${tail}`,
  ];

  if (!latest) {
    lines.push('File: not found');
    return lines.join('\n');
  }

  lines.push(`File: ${latest}`);
  lines.push('');
  lines.push(...tailLines(latest, tail));
  return lines.join('\n');
}

function resolveDebugPaths(options: DebugOptions): DebugPaths {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const dataDir = options.dataDir ?? path.join(os.homedir(), '.office-agent');
  const logDir = options.logDir ?? env['OFFICE_AGENT_LOG_DIR'] ?? path.join(cwd, 'logs');
  return {
    cwd,
    dataDir,
    usersDir: path.join(dataDir, 'users'),
    logDir,
    recipientFile: path.join(dataDir, 'feishu-recipients.json'),
  };
}

function readRecipients(filePath: string): FeishuRecipient[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { recipients?: unknown[] };
    return (parsed.recipients ?? [])
      .map((item) => normalizeRecipient(item))
      .filter((item): item is FeishuRecipient => !!item);
  } catch {
    return [];
  }
}

function normalizeRecipient(value: unknown): FeishuRecipient | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item['senderId'] !== 'string' || typeof item['chatId'] !== 'string' || typeof item['updatedAt'] !== 'string') {
    return null;
  }
  return {
    appKey: typeof item['appKey'] === 'string' && item['appKey'] ? item['appKey'] : 'default',
    senderId: item['senderId'],
    chatId: item['chatId'],
    updatedAt: item['updatedAt'],
  };
}

function resolveDebugUser(input: string, paths: DebugPaths): UserResolution {
  const recipients = readRecipients(paths.recipientFile);
  const userDirs = listUserDirs(paths.usersDir);

  const candidates = recipients
    .filter((recipient) => input === recipient.senderId || input === `${recipient.appKey}:${recipient.senderId}`)
    .map((recipient) => {
      const userKey = `${recipient.appKey}:${recipient.senderId}`;
      const safeUserKey = safeFeishuUserKey(userKey);
      return { userKey, safeUserKey, recipient };
    });

  if (input.includes(':')) {
    const safeUserKey = safeFeishuUserKey(input);
    const recipient = recipients.find((item) => `${item.appKey}:${item.senderId}` === input);
    const legacyKey = input.slice(input.indexOf(':') + 1);
    return {
      status: 'ok',
      input,
      userKey: input,
      safeUserKey,
      userDir: resolveExistingUserDir(paths, safeUserKey, legacyKey),
      recipient,
    };
  }

  if (userDirs.includes(input)) {
    return {
      status: 'ok',
      input,
      safeUserKey: input,
      userDir: path.join(paths.usersDir, input),
      recipient: recipients.find((recipient) => safeFeishuUserKey(`${recipient.appKey}:${recipient.senderId}`) === input),
    };
  }

  if (candidates.length === 1) {
    const candidate = candidates[0]!;
    return {
      status: 'ok',
      input,
      userKey: candidate.userKey,
      safeUserKey: candidate.safeUserKey,
      userDir: resolveExistingUserDir(paths, candidate.safeUserKey, candidate.recipient.senderId),
      recipient: candidate.recipient,
    };
  }

  const allCandidates = [
    ...candidates.map((candidate) => candidate.userKey),
    ...recipients.map((recipient) => `${recipient.appKey}:${recipient.senderId}`),
    ...userDirs,
  ].filter(unique);

  if (candidates.length > 1) {
    return { status: 'ambiguous', input, candidates: candidates.map((candidate) => candidate.userKey) };
  }

  return { status: 'not-found', input, candidates: allCandidates.slice(0, 20) };
}

function formatUnresolvedUser(resolved: Exclude<UserResolution, { status: 'ok' }>, paths: DebugPaths): string {
  return [
    resolved.status === 'ambiguous'
      ? `用户标识不唯一: ${resolved.input}`
      : `没有找到用户: ${resolved.input}`,
    '',
    `Data dir: ${paths.dataDir}`,
    resolved.candidates.length > 0
      ? `候选项:\n${resolved.candidates.map((candidate) => `- ${candidate}`).join('\n')}`
      : '候选项: none',
  ].join('\n');
}

function listUserDirs(usersDir: string): string[] {
  if (!fs.existsSync(usersDir)) return [];
  return fs.readdirSync(usersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function resolveExistingUserDir(paths: DebugPaths, safeUserKey: string, legacyKey?: string): string {
  const safeDir = path.join(paths.usersDir, safeUserKey);
  if (fs.existsSync(safeDir)) return safeDir;
  if (legacyKey) {
    const legacyDir = path.join(paths.usersDir, legacyKey);
    if (fs.existsSync(legacyDir)) return legacyDir;
  }
  return safeDir;
}

function trackedUserFiles(): string[] {
  return [
    'tasks.json',
    'agenda.json',
    'office-context.json',
    'feishu-sync-sources.json',
    'cron-tasks.json',
    'operation-ledger.json',
    'token-usage.json',
    'config.json',
    'memdir',
    'wikidir',
    'sessions',
  ];
}

function summarizeDir(dir: string): string {
  if (!fs.existsSync(dir)) return 'missing';
  const names = fs.readdirSync(dir).slice(0, 8);
  return names.length > 0 ? `files=${names.join(',')}` : 'empty';
}

function summarizePath(filePath: string): string {
  if (!fs.existsSync(filePath)) return 'missing';
  const stat = fs.statSync(filePath);
  const type = stat.isDirectory() ? 'dir' : 'file';
  return `${type} ${stat.size}B mtime=${stat.mtime.toISOString()}`;
}

function formatLedger(filePath: string): string {
  return new OperationLedger(filePath).formatLast();
}

function latestLogFile(logDir: string): string | null {
  if (!fs.existsSync(logDir)) return null;
  const files = fs.readdirSync(logDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^agent-.*\.log$/.test(entry.name))
    .map((entry) => path.join(logDir, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? null;
}

function tailLines(filePath: string, count: number): string[] {
  const lines = fs.readFileSync(filePath, 'utf-8').trimEnd().split(/\r?\n/);
  return lines.slice(-count);
}

function getOptionValue(args: string[], flag: string): string | undefined {
  const eq = args.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}
