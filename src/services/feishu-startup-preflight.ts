import * as fs from 'node:fs';
import type { FeishuMultiUserConfig } from '../server/feishu-multi-user-config.js';
import type { LarkCliRunOptions, LarkCliRunResult } from './lark-cli-runner.js';
import { runLarkCli } from './lark-cli-runner.js';

export type FeishuPreflightLevel = 'fail' | 'warn';

export interface FeishuPreflightIssue {
  level: FeishuPreflightLevel;
  code: string;
  message: string;
  advice?: string;
}

export interface FeishuPreflightReport {
  ok: boolean;
  issues: FeishuPreflightIssue[];
  checkedProfiles: string[];
}

export type FeishuPreflightRunner = (args: string[], options?: LarkCliRunOptions) => Promise<LarkCliRunResult>;

export interface FeishuPreflightOptions {
  runner?: FeishuPreflightRunner;
  env?: NodeJS.ProcessEnv;
  skipAuthStatus?: boolean;
}

interface ProfileSummary {
  name: string;
  appId?: string;
  tokenStatus?: string;
}

interface RequiredProfile {
  profile: string;
  appKey: string;
  appId: string;
  source: string;
}

export async function runFeishuStartupPreflight(
  config: FeishuMultiUserConfig,
  options: FeishuPreflightOptions = {},
): Promise<FeishuPreflightReport> {
  const runner = options.runner ?? runLarkCli;
  const env = options.env ?? process.env;
  const issues: FeishuPreflightIssue[] = [];
  const requiredProfiles = collectRequiredProfiles(config);
  const checkedProfiles = [...new Set(requiredProfiles.map((item) => item.profile))].sort();

  issues.push(...inspectUserProfileBindings(config));
  issues.push(...inspectPlainAppSecrets(config));

  if (requiredProfiles.length === 0) {
    issues.push({
      level: 'warn',
      code: 'no_cli_profiles',
      message: '飞书配置中没有任何 cliProfile。用户可以普通对话，但无法执行个人飞书读写操作。',
      advice: '运行 oa setup feishu quickstart，把 openId 绑定到一个 lark-cli profile。',
    });
    return buildReport(issues, checkedProfiles);
  }

  const profiles = await listProfiles(runner);
  if (!profiles.ok) {
    issues.push({
      level: 'fail',
      code: 'profile_list_failed',
      message: `无法读取 lark-cli profile list：${profiles.error}`,
      advice: '先运行 npm install，并确认 npm run lark -- profile list 可用。',
    });
    return buildReport(issues, checkedProfiles);
  }

  const profileMap = new Map(profiles.profiles.map((profile) => [profile.name, profile]));
  for (const required of requiredProfiles) {
    const profile = profileMap.get(required.profile);
    if (!profile) {
      issues.push({
        level: 'fail',
        code: 'missing_profile',
        message: `配置 ${required.source} 引用了不存在的 lark-cli profile：${required.profile}`,
        advice: `运行 npm run lark -- profile list 查看真实名称，或用 oa setup feishu quickstart 重新绑定。`,
      });
      continue;
    }

    if (profile.appId && profile.appId !== required.appId) {
      issues.push({
        level: 'fail',
        code: 'profile_app_mismatch',
        message: `profile ${required.profile} 属于 ${profile.appId}，但 ${required.source} 属于 ${required.appId}。`,
        advice: '为该飞书 app 重新创建/绑定对应 profile，避免跨企业或跨应用串号。',
      });
    }

    // `profile list` is a cached summary. It can report needs_refresh while
    // `auth status` can still refresh the token successfully. Treat auth status
    // below as the authoritative liveness check.
  }

  if (isTruthy(env['OFFICE_AGENT_FEISHU_PREFLIGHT_SKIP_AUTH']) || options.skipAuthStatus) {
    issues.push({
      level: 'warn',
      code: 'auth_status_skipped',
      message: '已跳过 lark-cli auth status 启动探测。',
      advice: '只建议临时排障时使用 OFFICE_AGENT_FEISHU_PREFLIGHT_SKIP_AUTH=1。',
    });
    return buildReport(issues, checkedProfiles);
  }

  for (const profile of checkedProfiles) {
    if (!profileMap.has(profile)) continue;
    const auth = await checkAuthStatus(runner, profile);
    if (!auth.ok) {
      issues.push({
        level: 'fail',
        code: 'auth_status_failed',
        message: `profile ${profile} auth status 不可用：${auth.error}`,
        advice: `运行 npm run lark -- --profile ${profile} auth login --recommend --domain all。`,
      });
    }
  }

  return buildReport(issues, checkedProfiles);
}

export function formatFeishuPreflightReport(report: FeishuPreflightReport): string {
  const lines = [
    'Office Agent Feishu Preflight',
    `checkedProfiles=${report.checkedProfiles.length > 0 ? report.checkedProfiles.join(', ') : '(none)'}`,
  ];
  if (report.issues.length === 0) {
    lines.push('[OK] 启动前检查通过。');
    return lines.join('\n');
  }

  for (const issue of report.issues) {
    lines.push(`[${issue.level.toUpperCase()}] ${issue.code}: ${issue.message}`);
    if (issue.advice) lines.push(`  建议: ${issue.advice}`);
  }
  return lines.join('\n');
}

function collectRequiredProfiles(config: FeishuMultiUserConfig): RequiredProfile[] {
  const required: RequiredProfile[] = [];
  for (const app of config.apps) {
    if (app.defaultCliProfile) {
      required.push({
        profile: app.defaultCliProfile,
        appKey: app.key,
        appId: app.appId,
        source: `app ${app.key}.defaultCliProfile`,
      });
    }

    for (const user of app.users) {
      if (user.enabled === false) continue;
      const profile = user.cliProfile ?? (app.allowUnmappedUsersWithDefaultProfile ? app.defaultCliProfile : undefined);
      if (!profile) continue;
      required.push({
        profile,
        appKey: app.key,
        appId: app.appId,
        source: `app ${app.key} user ${user.openId}`,
      });
    }
  }

  return required.filter((item) => {
    if (item.profile) return true;
    return false;
  });
}

function inspectUserProfileBindings(config: FeishuMultiUserConfig): FeishuPreflightIssue[] {
  const issues: FeishuPreflightIssue[] = [];
  for (const app of config.apps) {
    for (const user of app.users) {
      if (user.enabled === false) continue;
      if (user.cliProfile || (app.allowUnmappedUsersWithDefaultProfile && app.defaultCliProfile)) continue;
      issues.push({
        level: 'fail',
        code: 'user_missing_cli_profile',
        message: `app ${app.key} user ${user.openId} 没有绑定 cliProfile。`,
        advice: '运行 oa setup feishu quickstart，把该 openId 绑定到本机 lark-cli profile。',
      });
    }
  }
  return issues;
}

async function listProfiles(runner: FeishuPreflightRunner): Promise<
  | { ok: true; profiles: ProfileSummary[] }
  | { ok: false; error: string }
> {
  try {
    const result = await runner(['profile', 'list'], { timeoutMs: 8_000, maxOutputBytes: 32_768 });
    if (result.exitCode !== 0 || result.timedOut || result.aborted) {
      return { ok: false, error: summarizeResult(result) };
    }
    const parsed = JSON.parse(result.stdout || '[]') as Array<Record<string, unknown>>;
    return {
      ok: true,
      profiles: parsed
        .map((item) => ({
          name: String(item['name'] ?? ''),
          appId: typeof item['appId'] === 'string' ? item['appId'] : undefined,
          tokenStatus: typeof item['tokenStatus'] === 'string' ? item['tokenStatus'] : undefined,
        }))
        .filter((item) => item.name),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkAuthStatus(
  runner: FeishuPreflightRunner,
  profile: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await runner(['--profile', profile, 'auth', 'status'], { timeoutMs: 10_000, maxOutputBytes: 16_384 });
    if (result.exitCode !== 0 || result.timedOut || result.aborted) {
      return { ok: false, error: summarizeResult(result) };
    }
    const status = parseAuthTokenStatus(result.stdout);
    if (status && isClearlyBadTokenStatus(status.toLowerCase())) {
      return { ok: false, error: `tokenStatus=${status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function parseAuthTokenStatus(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout || '{}') as {
      tokenStatus?: string;
      identities?: { user?: { tokenStatus?: string; status?: string } };
    };
    return parsed.identities?.user?.tokenStatus ?? parsed.identities?.user?.status ?? parsed.tokenStatus ?? null;
  } catch {
    return null;
  }
}

function inspectPlainAppSecrets(config: FeishuMultiUserConfig): FeishuPreflightIssue[] {
  if (config.source !== 'file' || !config.configPath || !fs.existsSync(config.configPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(config.configPath, 'utf-8')) as { apps?: Array<{ key?: unknown; appSecret?: unknown }> };
    return (parsed.apps ?? []).flatMap((app) => {
      const secret = typeof app.appSecret === 'string' ? app.appSecret.trim() : '';
      if (!secret || /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(secret)) return [];
      return [{
        level: 'warn' as const,
        code: 'plain_app_secret',
        message: `app ${String(app.key ?? '(unknown)')} 的 appSecret 是明文。`,
        advice: '运行 oa setup feishu quickstart --secret-env FEISHU_APP_SECRET_XXX，把 JSON 改成环境变量引用。',
      }];
    });
  } catch {
    return [];
  }
}

function isClearlyBadTokenStatus(status: string): boolean {
  return ['needs_refresh', 'expired', 'invalid', 'missing', 'none', 'unavailable', 'not_logged_in'].includes(status);
}

function summarizeResult(result: LarkCliRunResult): string {
  if (result.timedOut) return 'timeout';
  if (result.aborted) return 'aborted';
  const output = (result.stderr || result.stdout || '').trim();
  return output ? output.slice(0, 500) : `exitCode=${result.exitCode}`;
}

function buildReport(issues: FeishuPreflightIssue[], checkedProfiles: string[]): FeishuPreflightReport {
  return {
    ok: issues.every((issue) => issue.level !== 'fail'),
    issues,
    checkedProfiles,
  };
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}
