import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

const NonEmptyString = z.string().trim().min(1);

const FeishuUserBindingSchema = z.object({
  openId: NonEmptyString,
  cliProfile: NonEmptyString.optional(),
  label: z.string().trim().optional(),
  enabled: z.boolean().default(true),
});

const FeishuAppConfigSchema = z.object({
  key: z.string().trim().min(1).regex(/^[A-Za-z0-9_.-]+$/, 'app key 只能包含字母、数字、下划线、点和短横线'),
  appId: NonEmptyString,
  appSecret: NonEmptyString,
  defaultCliProfile: NonEmptyString.optional(),
  allowUnmappedUsersWithDefaultProfile: z.boolean().default(false),
  enabled: z.boolean().default(true),
  users: z.array(FeishuUserBindingSchema).default([]),
});

const FeishuMultiUserConfigSchema = z.object({
  apps: z.array(FeishuAppConfigSchema).min(1),
});

export type FeishuUserBinding = z.infer<typeof FeishuUserBindingSchema>;
export type FeishuAppConfig = z.infer<typeof FeishuAppConfigSchema>;

export interface FeishuMultiUserConfig {
  source: 'file' | 'legacy';
  configPath?: string;
  apps: FeishuAppConfig[];
}

export interface ResolvedFeishuUser {
  appKey: string;
  openId: string;
  userKey: string;
  safeUserKey: string;
  label?: string;
  cliProfile?: string;
  configured: boolean;
  problem?: string;
}

export function loadFeishuMultiUserConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): FeishuMultiUserConfig {
  const configPath = getOptionalEnv(env, 'FEISHU_MULTI_USER_CONFIG');
  if (configPath) {
    const resolvedPath = path.isAbsolute(configPath) ? configPath : path.resolve(cwd, configPath);
    const raw = readJsonConfig(resolvedPath);
    const parsed = FeishuMultiUserConfigSchema.parse(raw);
    const apps = parsed.apps
      .filter((app) => app.enabled)
      .map((app) => ({
        ...app,
        appSecret: resolveEnvReference(app.appSecret, env, `apps.${app.key}.appSecret`),
      }));
    validateUniqueApps(apps);
    return { source: 'file', configPath: resolvedPath, apps };
  }

  const appId = getOptionalEnv(env, 'FEISHU_APP_ID');
  const appSecret = resolveOptionalEnvReference(getOptionalEnv(env, 'FEISHU_APP_SECRET'), env, 'FEISHU_APP_SECRET');
  if (!appId || !appSecret) {
    throw new Error('缺少飞书配置：请设置 FEISHU_MULTI_USER_CONFIG，或设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET。');
  }

  const defaultCliProfile = getOptionalEnv(env, 'FEISHU_CLI_PROFILE') ?? getOptionalEnv(env, 'LARK_CLI_PROFILE');
  const app: FeishuAppConfig = {
    key: getOptionalEnv(env, 'FEISHU_APP_KEY') ?? 'default',
    appId,
    appSecret,
    defaultCliProfile,
    allowUnmappedUsersWithDefaultProfile: true,
    enabled: true,
    users: [],
  };
  validateUniqueApps([app]);
  return { source: 'legacy', apps: [app] };
}

export function resolveFeishuUser(app: FeishuAppConfig, openId: string): ResolvedFeishuUser {
  const binding = app.users.find((user) => user.openId === openId);
  const userKey = `${app.key}:${openId}`;
  const safeUserKey = safeFeishuUserKey(userKey);

  if (binding && binding.enabled === false) {
    return {
      appKey: app.key,
      openId,
      userKey,
      safeUserKey,
      label: binding.label,
      configured: false,
      problem: '当前飞书用户在多用户配置中已被禁用。',
    };
  }

  const cliProfile = binding?.cliProfile
    ?? (app.allowUnmappedUsersWithDefaultProfile ? app.defaultCliProfile : undefined);
  const configured = !!cliProfile;
  const label = binding?.label;

  return {
    appKey: app.key,
    openId,
    userKey,
    safeUserKey,
    label,
    cliProfile,
    configured,
    ...(configured ? {} : { problem: buildMissingCliProfileProblem(app.key, openId) }),
  };
}

export function safeFeishuUserKey(userKey: string): string {
  return encodeURIComponent(userKey).replaceAll('%', '_');
}

export function buildMissingCliProfileProblem(appKey: string, openId: string): string {
  const snippet = buildFeishuUserBindingSnippet(openId);
  return [
    `当前飞书用户没有绑定 lark-cli profile（app=${appKey}, openId=${openId}）。`,
    '请把下面这段加入 FEISHU_MULTI_USER_CONFIG 指向的 JSON 中对应 app 的 users 数组：',
    '```json',
    snippet,
    '```',
    '然后运行 lark-cli --profile <profile> auth login 完成授权，或让管理员绑定已有 profile。',
  ].join('\n');
}

export function buildFeishuUserBindingSnippet(openId: string, cliProfile = '填写该用户本机 lark-cli profile', label = '填写用户名字'): string {
  return JSON.stringify({
    openId,
    cliProfile,
    label,
  }, null, 2);
}

function readJsonConfig(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(`FEISHU_MULTI_USER_CONFIG 指向的文件不存在：${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`读取飞书多用户配置失败：${message}`);
  }
}

function validateUniqueApps(apps: FeishuAppConfig[]): void {
  const appKeys = new Set<string>();
  for (const app of apps) {
    if (appKeys.has(app.key)) {
      throw new Error(`飞书多用户配置存在重复 app key：${app.key}`);
    }
    appKeys.add(app.key);

    const openIds = new Set<string>();
    for (const user of app.users) {
      if (openIds.has(user.openId)) {
        throw new Error(`飞书 app ${app.key} 存在重复用户 openId：${maskOpenId(user.openId)}`);
      }
      openIds.add(user.openId);
    }
  }
}

function getOptionalEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function resolveOptionalEnvReference(
  value: string | undefined,
  env: NodeJS.ProcessEnv,
  label: string,
): string | undefined {
  return value ? resolveEnvReference(value, env, label) : undefined;
}

export function resolveEnvReference(value: string, env: NodeJS.ProcessEnv = process.env, label = 'value'): string {
  const trimmed = value.trim();
  const braced = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(trimmed);
  const simple = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  const envName = braced?.[1] ?? simple?.[1];
  if (!envName) return value;

  const resolved = getOptionalEnv(env, envName);
  if (!resolved) {
    throw new Error(`${label} 引用了环境变量 ${envName}，但该变量未配置。请在 .env 或系统环境变量中设置它。`);
  }
  return resolved;
}

function maskOpenId(openId: string): string {
  if (openId.length <= 8) return `${openId.slice(0, 2)}***`;
  return `${openId.slice(0, 4)}***${openId.slice(-4)}`;
}
