import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { LarkCliRunOptions, LarkCliRunResult } from '../../services/lark-cli-runner.js';
import { runLarkCli } from '../../services/lark-cli-runner.js';
import { loadFeishuMultiUserConfig } from '../../server/feishu-multi-user-config.js';
import { writeJsonFileAtomic } from '../../services/json-store.js';

export type SetupRunner = (args: string[], options?: LarkCliRunOptions) => Promise<LarkCliRunResult>;

export interface SetupOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  dataDir?: string;
  runner?: SetupRunner;
}

interface CliProfileSummary {
  name: string;
  appId?: string;
  active?: boolean;
  user?: string;
  tokenStatus?: string;
}

const HELP = `
Office Agent setup

用法:
  oa setup feishu                    输出飞书 CLI / bot / 多用户配置向导
  oa setup feishu quickstart         自动绑定飞书 openId 到 lark-cli profile
  oa setup feishu quickstart --dry-run
  oa setup feishu quickstart --app cbt-app --open-id ou_xxx --profile my-new-company --label 我
`.trim();

export async function setup(args: string[], options: SetupOptions = {}): Promise<void> {
  const target = args[0];
  if (!target || target === '-h' || target === '--help' || target === 'help') {
    console.log(HELP);
    return;
  }

  if (target !== 'feishu' && target !== 'lark') {
    console.error(`未知 setup 目标: ${target}`);
    console.log(HELP);
    process.exit(1);
  }

  const subcommand = args[1];
  if (subcommand === '-h' || subcommand === '--help' || subcommand === 'help') {
    console.log(HELP);
    return;
  }
  if (subcommand === 'quickstart' || subcommand === 'bind-user') {
    console.log(await buildFeishuQuickstart(args.slice(2), options));
    return;
  }

  if (subcommand) {
    console.error(`未知 feishu setup 子命令: ${subcommand}`);
    console.log(HELP);
    process.exit(1);
  }

  console.log(await buildFeishuSetupGuide(options));
}

interface FeishuSetupFile {
  apps: FeishuSetupApp[];
}

interface FeishuSetupApp {
  key: string;
  appId: string;
  appSecret: string;
  defaultCliProfile?: string;
  allowUnmappedUsersWithDefaultProfile?: boolean;
  enabled?: boolean;
  users: FeishuSetupUser[];
}

interface FeishuSetupUser {
  openId: string;
  cliProfile?: string;
  label?: string;
  enabled?: boolean;
}

interface FeishuRecipientSummary {
  appKey: string;
  senderId: string;
  chatId: string;
  updatedAt: string;
}

interface QuickstartArgs {
  app?: string;
  openId?: string;
  profile?: string;
  label?: string;
  appId?: string;
  secretEnv?: string;
  config?: string;
  dryRun: boolean;
}

export async function buildFeishuQuickstart(rawArgs: string[], options: SetupOptions = {}): Promise<string> {
  if (rawArgs.includes('-h') || rawArgs.includes('--help') || rawArgs.includes('help')) {
    return [
      'Office Agent 飞书 Quickstart',
      '',
      '用法:',
      '  oa setup feishu quickstart',
      '  oa setup feishu quickstart --dry-run',
      '  oa setup feishu quickstart --app cbt-app --open-id ou_xxx --profile my-new-company --label 我',
      '',
      '可选参数:',
      '  --app <key>          feishu-users.json 里的 app key',
      '  --open-id <ou_xxx>   飞书消息事件里的用户 open_id',
      '  --profile <name>     本机 lark-cli profile 名称，必须存在于 profile list',
      '  --label <name>       配置备注名',
      '  --app-id <cli_xxx>   飞书开放平台 App ID',
      '  --secret-env <ENV>   保存真实 App Secret 的环境变量名',
      '  --config <path>      feishu-users.json 路径',
      '  --dry-run            只预览，不写文件',
    ].join('\n');
  }

  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const dataDir = options.dataDir ?? path.join(os.homedir(), '.office-agent');
  const runner = options.runner ?? runLarkCli;
  const args = parseQuickstartArgs(rawArgs);
  const profiles = await listProfiles(runner);
  const recipients = readFeishuRecipients(path.join(dataDir, 'feishu-recipients.json'));
  const configPath = resolveQuickstartConfigPath(args.config, env, cwd);
  const existingConfig = readFeishuSetupFile(configPath);
  const appKey = args.app ?? inferAppKey(existingConfig, recipients);
  const selectedProfile = selectProfile(args.profile, profiles, existingConfig, appKey);
  const openId = args.openId ?? inferOpenId(recipients, appKey);
  const app = appKey ? existingConfig?.apps.find((item) => item.key === appKey) : undefined;
  const appId = args.appId ?? app?.appId ?? selectedProfile?.appId;
  const existingSecretEnv = extractEnvReference(app?.appSecret);
  const appSecretWasPlain = !!app?.appSecret && !existingSecretEnv;
  const secretEnv = args.secretEnv ?? existingSecretEnv ?? (appKey ? `FEISHU_APP_SECRET_${toEnvSuffix(appKey)}` : undefined);
  const label = args.label ?? selectedProfile?.user ?? '我';

  const missing = [
    appKey ? undefined : '--app',
    openId ? undefined : '--open-id',
    selectedProfile?.name ? undefined : '--profile',
    appId ? undefined : '--app-id',
    secretEnv ? undefined : '--secret-env',
  ].filter((item): item is string => !!item);

  const lines = [
    'Office Agent 飞书 Quickstart',
    '',
    `Config: ${path.relative(cwd, configPath) || configPath}${fs.existsSync(configPath) ? '' : ' (will create)'}`,
    '',
    '当前 lark-cli profiles:',
    profiles.length > 0 ? profiles.map(formatProfile).join('\n') : '   未发现 profile。先运行 npm run lark -- config init 或 profile add。',
    '',
    '当前飞书消息用户:',
    recipients.length > 0 ? recipients.map(formatRecipient).join('\n') : '   未发现消息用户。先运行 npm run feishu，让用户给 bot 发 ping。',
  ];

  if (missing.length > 0) {
    lines.push(
      '',
      `还缺少必要信息: ${missing.join(', ')}`,
      '',
      '推荐命令:',
      buildSuggestedQuickstartCommand({ appKey, openId, profile: selectedProfile?.name, label, appId, secretEnv }),
      '',
      '说明: quickstart 不会创建飞书开放平台应用，也不会替你完成 auth login；它只维护 Agent 的 openId -> cliProfile 映射。',
    );
    return lines.join('\n');
  }

  if (!appKey || !openId || !selectedProfile?.name || !appId || !secretEnv) {
    throw new Error('quickstart 参数解析失败：必要参数为空。');
  }
  const profileName = selectedProfile.name;
  const nextConfig = upsertFeishuBinding(existingConfig ?? { apps: [] }, {
    appKey,
    appId,
    secretEnv,
    openId,
    profile: profileName,
    label,
  });
  const rendered = JSON.stringify(nextConfig, null, 2);
  const envPointer = path.relative(cwd, configPath) || configPath;
  const envWrite = ensureEnvConfigPointer(cwd, env, envPointer, args.dryRun);
  const secretConfigured = !!env[secretEnv];

  lines.push(
    '',
    '计划:',
    `- app: ${appKey} (${appId})`,
    `- openId: ${openId}`,
    `- cliProfile: ${profileName}`,
    `- label: ${label}`,
    `- appSecret: \${${secretEnv}}${secretConfigured ? ' (env exists)' : ' (env missing)'}`,
  );

  if (args.dryRun) {
    lines.push('', 'Dry run，未写入文件。将写入内容:', rendered);
  } else {
    writeJsonFileAtomic(configPath, nextConfig);
    lines.push('', `已写入: ${configPath}`);
  }

  if (envWrite) {
    lines.push(envWrite);
  }
  if (appSecretWasPlain) {
    lines.push('检测到 feishu-users.json 里有明文 appSecret，已改为环境变量引用。');
  }
  if (!secretConfigured) {
    lines.push(`请在 .env 里补充: ${secretEnv}=真实AppSecret`);
  }

  lines.push(
    '',
    '下一步验证:',
    `npm run lark -- --profile ${profileName} auth status`,
    'npx tsx src/cli/index.ts debug feishu-profiles',
    'npx tsx src/cli/index.ts doctor',
    'npm run feishu',
  );

  return lines.join('\n');
}

export async function buildFeishuSetupGuide(options: SetupOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const runner = options.runner ?? runLarkCli;
  const profiles = await listProfiles(runner);
  const configSummary = summarizeFeishuConfig(env, cwd);
  const recommendedProfile = profiles[0]?.name ?? 'my-new-company';

  return [
    'Office Agent 飞书接入向导',
    '',
    '1. 当前 lark-cli profiles',
    profiles.length > 0
      ? profiles.map((profile) => formatProfile(profile)).join('\n')
      : '   未发现 profile。需要先创建或绑定一个 profile。',
    '',
    '2. 当前 Agent 飞书配置',
    configSummary,
    '',
    '3. 创建或绑定 CLI profile',
    '   如果要让 CLI 帮你创建新开放平台应用入口：',
    `   npm run lark -- config init --name ${recommendedProfile} --new --brand feishu`,
    '',
    '   如果已经在开放平台创建了应用，用 App ID/Secret 添加 profile：',
    '   read -s FEISHU_APP_SECRET',
    `   printf '%s' "$FEISHU_APP_SECRET" | npm run lark -- profile add --name ${recommendedProfile} --app-id cli_xxx --app-secret-stdin --brand feishu`,
    '   unset FEISHU_APP_SECRET',
    '',
    '4. 登录用户身份',
    `   npm run lark -- --profile ${recommendedProfile} auth login --recommend --domain all`,
    `   npm run lark -- --profile ${recommendedProfile} auth status`,
    '',
    '5. 配置 Agent 多用户映射',
    '   .env 推荐写：',
    '   FEISHU_MULTI_USER_CONFIG=./feishu-users.json',
    '   FEISHU_APP_SECRET_MY_COMPANY=你的真实 App Secret',
    '',
    '   feishu-users.json 推荐写 appSecret 环境变量引用：',
    '   {',
    '     "apps": [',
    '       {',
    '         "key": "my-new-company",',
    '         "appId": "cli_xxx",',
    '         "appSecret": "${FEISHU_APP_SECRET_MY_COMPANY}",',
    '         "users": [',
    `           { "openId": "ou_xxx", "cliProfile": "${recommendedProfile}", "label": "我" }`,
    '         ]',
    '       }',
    '     ]',
    '   }',
    '',
    '6. 飞书开放平台必须手动确认',
    '   - 开启机器人能力',
    '   - 事件订阅选择长连接',
    '   - 订阅 im.message.receive_v1',
    '   - 权限管理开启消息、云文档、Base、日历、任务、通讯录等需要的权限',
    '   - 发布/生效应用权限，并把机器人添加到单聊或群聊',
    '',
    '7. 获取 openId',
    '   启动 npm run feishu 后，让用户给 bot 发 ping。',
    '   未绑定用户会收到可复制 JSON 片段，日志里也会打印 appKey:openId。',
    '',
    '8. 检查',
    '   npx tsx src/cli/index.ts doctor',
    '   npm run feishu',
  ].join('\n');
}

async function listProfiles(runner: SetupRunner): Promise<CliProfileSummary[]> {
  try {
    const result = await runner(['profile', 'list'], { timeoutMs: 5_000, maxOutputBytes: 32_768 });
    if (result.exitCode !== 0 || result.timedOut || result.aborted) return [];
    const parsed = JSON.parse(result.stdout || '[]') as Array<Record<string, unknown>>;
    return parsed
      .map((profile) => ({
        name: String(profile['name'] ?? ''),
        appId: typeof profile['appId'] === 'string' ? profile['appId'] : undefined,
        active: typeof profile['active'] === 'boolean' ? profile['active'] : undefined,
        user: typeof profile['user'] === 'string' ? profile['user'] : undefined,
        tokenStatus: typeof profile['tokenStatus'] === 'string' ? profile['tokenStatus'] : undefined,
      }))
      .filter((profile) => profile.name);
  } catch {
    return [];
  }
}

function parseQuickstartArgs(args: string[]): QuickstartArgs {
  return {
    app: getArgValue(args, '--app') ?? getArgValue(args, '--app-key'),
    openId: getArgValue(args, '--open-id') ?? getArgValue(args, '--openId'),
    profile: getArgValue(args, '--profile'),
    label: getArgValue(args, '--label'),
    appId: getArgValue(args, '--app-id') ?? getArgValue(args, '--appId'),
    secretEnv: getArgValue(args, '--secret-env') ?? getArgValue(args, '--secretEnv'),
    config: getArgValue(args, '--config'),
    dryRun: args.includes('--dry-run'),
  };
}

function getArgValue(args: string[], flag: string): string | undefined {
  const eq = args.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function resolveQuickstartConfigPath(configArg: string | undefined, env: NodeJS.ProcessEnv, cwd: string): string {
  const raw = configArg ?? env['FEISHU_MULTI_USER_CONFIG'] ?? './feishu-users.json';
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

function readFeishuSetupFile(filePath: string): FeishuSetupFile | null {
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<FeishuSetupFile>;
  return {
    apps: Array.isArray(parsed.apps)
      ? parsed.apps.map((app) => ({
        key: String((app as FeishuSetupApp).key ?? ''),
        appId: String((app as FeishuSetupApp).appId ?? ''),
        appSecret: String((app as FeishuSetupApp).appSecret ?? ''),
        defaultCliProfile: (app as FeishuSetupApp).defaultCliProfile,
        allowUnmappedUsersWithDefaultProfile: (app as FeishuSetupApp).allowUnmappedUsersWithDefaultProfile,
        enabled: (app as FeishuSetupApp).enabled,
        users: Array.isArray((app as FeishuSetupApp).users) ? (app as FeishuSetupApp).users.map((user) => ({ ...user })) : [],
      })).filter((app) => app.key)
      : [],
  };
}

function readFeishuRecipients(filePath: string): FeishuRecipientSummary[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { recipients?: unknown[] };
    return (parsed.recipients ?? [])
      .map((value) => {
        if (!value || typeof value !== 'object') return null;
        const item = value as Record<string, unknown>;
        if (typeof item['senderId'] !== 'string' || typeof item['chatId'] !== 'string' || typeof item['updatedAt'] !== 'string') return null;
        return {
          appKey: typeof item['appKey'] === 'string' && item['appKey'] ? item['appKey'] : 'default',
          senderId: item['senderId'],
          chatId: item['chatId'],
          updatedAt: item['updatedAt'],
        };
      })
      .filter((item): item is FeishuRecipientSummary => !!item);
  } catch {
    return [];
  }
}

function inferAppKey(config: FeishuSetupFile | null, recipients: FeishuRecipientSummary[]): string | undefined {
  if (config?.apps.length === 1) return config.apps[0]!.key;
  const keys = [
    ...(config?.apps.map((app) => app.key) ?? []),
    ...recipients.map((recipient) => recipient.appKey),
  ].filter(unique);
  return keys.length === 1 ? keys[0] : undefined;
}

function selectProfile(
  explicitProfile: string | undefined,
  profiles: CliProfileSummary[],
  config: FeishuSetupFile | null,
  appKey: string | undefined,
): CliProfileSummary | undefined {
  if (explicitProfile) return profiles.find((profile) => profile.name === explicitProfile);
  const appId = config?.apps.find((app) => app.key === appKey)?.appId;
  const matchingAppProfiles = appId ? profiles.filter((profile) => profile.appId === appId) : [];
  const validMatching = matchingAppProfiles.filter((profile) => profile.tokenStatus === 'valid');
  if (validMatching.length === 1) return validMatching[0];
  if (matchingAppProfiles.length === 1) return matchingAppProfiles[0];
  const validProfiles = profiles.filter((profile) => profile.tokenStatus === 'valid');
  if (validProfiles.length === 1) return validProfiles[0];
  return profiles.length === 1 ? profiles[0] : undefined;
}

function inferOpenId(recipients: FeishuRecipientSummary[], appKey: string | undefined): string | undefined {
  const scoped = appKey ? recipients.filter((recipient) => recipient.appKey === appKey) : recipients;
  const openIds = scoped.map((recipient) => recipient.senderId).filter(unique);
  return openIds.length === 1 ? openIds[0] : undefined;
}

function extractEnvReference(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const braced = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim());
  const simple = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value.trim());
  return braced?.[1] ?? simple?.[1];
}

function upsertFeishuBinding(
  config: FeishuSetupFile,
  input: { appKey: string; appId: string; secretEnv: string; openId: string; profile: string; label: string },
): FeishuSetupFile {
  const next: FeishuSetupFile = {
    apps: config.apps.map((app) => ({
      ...app,
      users: app.users.map((user) => ({ ...user })),
    })),
  };
  let app = next.apps.find((item) => item.key === input.appKey);
  if (!app) {
    app = {
      key: input.appKey,
      appId: input.appId,
      appSecret: `\${${input.secretEnv}}`,
      users: [],
    };
    next.apps.push(app);
  }
  if (!app.appId || app.appId === 'cli_xxx') app.appId = input.appId;
  if (!app.appSecret || app.appSecret === 'xxx' || !extractEnvReference(app.appSecret)) {
    app.appSecret = `\${${input.secretEnv}}`;
  }

  let user = app.users.find((item) => item.openId === input.openId);
  if (!user) {
    user = app.users.find((item) => item.openId === 'ou_xxx' || item.openId === '填写用户 openId');
  }
  if (!user) {
    user = { openId: input.openId };
    app.users.push(user);
  }
  user.openId = input.openId;
  user.cliProfile = input.profile;
  user.label = input.label;
  return next;
}

function ensureEnvConfigPointer(cwd: string, env: NodeJS.ProcessEnv, configRelativePath: string, dryRun: boolean): string | null {
  if (env['FEISHU_MULTI_USER_CONFIG']) return null;
  const envPath = path.join(cwd, '.env');
  const line = `FEISHU_MULTI_USER_CONFIG=${configRelativePath}`;
  if (dryRun) return `Dry run，建议写入 .env: ${line}`;

  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  if (/^FEISHU_MULTI_USER_CONFIG=/m.test(existing)) return null;
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(envPath, `${prefix}${line}\n`, 'utf-8');
  return `已写入 .env: ${line}`;
}

function buildSuggestedQuickstartCommand(input: {
  appKey?: string;
  openId?: string;
  profile?: string;
  label?: string;
  appId?: string;
  secretEnv?: string;
}): string {
  const args = [
    'npx tsx src/cli/index.ts setup feishu quickstart',
    input.appKey ? `--app ${shellArg(input.appKey)}` : '--app <appKey>',
    input.openId ? `--open-id ${shellArg(input.openId)}` : '--open-id <ou_xxx>',
    input.profile ? `--profile ${shellArg(input.profile)}` : '--profile <lark-cli-profile>',
    input.label ? `--label ${shellArg(input.label)}` : undefined,
    input.appId ? `--app-id ${shellArg(input.appId)}` : '--app-id <cli_xxx>',
    input.secretEnv ? `--secret-env ${shellArg(input.secretEnv)}` : '--secret-env FEISHU_APP_SECRET_XXX',
  ].filter(Boolean);
  return args.join(' ');
}

function formatRecipient(recipient: FeishuRecipientSummary): string {
  return `   - ${recipient.appKey}:${recipient.senderId}, chatId=${recipient.chatId}, updatedAt=${recipient.updatedAt}`;
}

function toEnvSuffix(value: string): string {
  const suffix = value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return suffix || 'APP';
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}

function summarizeFeishuConfig(env: NodeJS.ProcessEnv, cwd: string): string {
  try {
    const config = loadFeishuMultiUserConfig(env, cwd);
    const appLines = config.apps.map((app) => {
      const profileCount = new Set([
        app.defaultCliProfile,
        ...app.users.map((user) => user.cliProfile),
      ].filter(Boolean)).size;
      return `   - ${app.key}: appId=${app.appId}, users=${app.users.length}, cliProfiles=${profileCount}`;
    });
    return [
      `   ${config.source === 'file' ? `多用户配置: ${path.relative(cwd, config.configPath ?? '') || config.configPath}` : '单用户兼容配置'}`,
      ...appLines,
    ].join('\n');
  } catch (err) {
    return `   未完成或配置有误：${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatProfile(profile: CliProfileSummary): string {
  return [
    `   - ${profile.name}`,
    profile.appId ? `appId=${profile.appId}` : undefined,
    profile.active ? 'active=true' : undefined,
    profile.tokenStatus ? `token=${profile.tokenStatus}` : undefined,
    profile.user ? `user=${profile.user}` : undefined,
  ].filter(Boolean).join(', ');
}
