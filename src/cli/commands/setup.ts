import * as path from 'node:path';
import type { LarkCliRunOptions, LarkCliRunResult } from '../../services/lark-cli-runner.js';
import { runLarkCli } from '../../services/lark-cli-runner.js';
import { loadFeishuMultiUserConfig } from '../../server/feishu-multi-user-config.js';

export type SetupRunner = (args: string[], options?: LarkCliRunOptions) => Promise<LarkCliRunResult>;

export interface SetupOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
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
  oa setup feishu       输出飞书 CLI / bot / 多用户配置向导
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

  console.log(await buildFeishuSetupGuide(options));
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
