/**
 * `oa doctor` — local environment and capability diagnostics.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LarkCliRunOptions, LarkCliRunResult } from '../../services/lark-cli-runner.js';
import { runLarkCli } from '../../services/lark-cli-runner.js';
import { isDashScopeVisionModel } from '../../core/dashscope-llm.js';
import { loadFeishuMultiUserConfig } from '../../server/feishu-multi-user-config.js';

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
  advice?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
}

export type DoctorRunner = (args: string[], options?: LarkCliRunOptions) => Promise<LarkCliRunResult>;

export interface DoctorOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  dataDir?: string;
  logDir?: string;
  runner?: DoctorRunner;
}

export async function doctor(options: DoctorOptions = {}): Promise<void> {
  const report = await runDoctorChecks(options);
  console.log(formatDoctorReport(report));
}

export async function runDoctorChecks(options: DoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const dataDir = options.dataDir ?? path.join(os.homedir(), '.office-agent');
  const logDir = options.logDir ?? env['OFFICE_AGENT_LOG_DIR'] ?? path.join(cwd, 'logs');
  const runner = options.runner ?? runLarkCli;
  const checks: DoctorCheck[] = [];

  checks.push(checkEnvFile(cwd));
  checks.push(checkProvider(env));
  checks.push(checkModelCapabilities(env));
  checks.push(checkFeishuBotConfig(env, cwd));
  checks.push(checkWritableDir('数据目录', dataDir));
  checks.push(checkWritableDir('日志目录', logDir));
  checks.push(await checkLarkCliVersion(runner));
  checks.push(await checkLarkCliAuth(runner, env, cwd));
  checks.push(await checkFeishuCliReadProbe(runner, env, cwd));

  return { checks };
}

async function checkFeishuCliReadProbe(
  runner: DoctorRunner,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<DoctorCheck> {
  if (isTruthy(env['OFFICE_AGENT_DOCTOR_SKIP_FEISHU_PROBES'])) {
    return {
      name: '飞书 CLI 读权限探测',
      status: 'warn',
      detail: 'skipped by OFFICE_AGENT_DOCTOR_SKIP_FEISHU_PROBES',
    };
  }

  const profiles = collectConfiguredCliProfiles(env, cwd);
  if (profiles.length === 0) {
    return {
      name: '飞书 CLI 读权限探测',
      status: 'warn',
      detail: 'no configured cli profiles',
      advice: '配置 FEISHU_CLI_PROFILE 或 FEISHU_MULTI_USER_CONFIG 后可探测飞书读权限。',
    };
  }

  const sampled = profiles.slice(0, 3);
  const results = await Promise.all(sampled.map(async (profile) => {
    const args = [
      '--profile', profile,
      'docs', '+search',
      '--query', 'OfficeAgentDoctorProbe',
      '--page-size', '1',
      '--as', 'user',
      '--format', 'json',
    ];
    try {
      const result = await runner(args, { timeoutMs: 12_000, maxOutputBytes: 16_384 });
      const ok = result.exitCode === 0 && !result.timedOut && !result.aborted;
      return {
        profile,
        ok,
        detail: summarizeProbeOutput(result),
      };
    } catch (err) {
      return { profile, ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }));

  const failed = results.filter((result) => !result.ok);
  const suffix = profiles.length > sampled.length ? `; sampled=${sampled.length}/${profiles.length}` : '';
  if (failed.length === 0) {
    return {
      name: '飞书 CLI 读权限探测',
      status: 'ok',
      detail: `docs search probe ok: ${sampled.join(', ')}${suffix}`,
    };
  }

  return {
    name: '飞书 CLI 读权限探测',
    status: 'warn',
    detail: `probe failed: ${failed.map((result) => `${result.profile}(${result.detail})`).join('; ')}${suffix}`,
    advice: '检查该 profile 是否已 auth login、开放平台是否开通 docs 搜索/读取权限、应用是否已发布并在正确企业下授权。',
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ['Office Agent Doctor', ''];
  for (const check of report.checks) {
    lines.push(`${statusIcon(check.status)} ${check.name}: ${check.detail}`);
    if (check.advice) lines.push(`   建议: ${check.advice}`);
  }
  const failed = report.checks.filter((check) => check.status === 'fail').length;
  const warned = report.checks.filter((check) => check.status === 'warn').length;
  lines.push('');
  lines.push(`结果: ${failed} fail, ${warned} warn, ${report.checks.length - failed - warned} ok`);
  return lines.join('\n');
}

function checkEnvFile(cwd: string): DoctorCheck {
  const envPath = path.join(cwd, '.env');
  if (fs.existsSync(envPath)) {
    return { name: '.env', status: 'ok', detail: `.env exists at ${envPath}` };
  }
  return {
    name: '.env',
    status: 'warn',
    detail: '当前目录没有 .env',
    advice: '复制 .env.example 为 .env，并配置 LLM 与飞书参数。',
  };
}

function checkProvider(env: NodeJS.ProcessEnv): DoctorCheck {
  const resolved = resolveProvider(env);
  if (!resolved.ok) {
    return {
      name: 'LLM Provider',
      status: 'fail',
      detail: resolved.error,
      advice: 'OFFICE_AGENT_LLM_PROVIDER 只能是 dashscope 或 deepseek。',
    };
  }

  const keyName = resolved.provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'DASHSCOPE_API_KEY';
  const hasKey = !!env[keyName];
  return {
    name: 'LLM Provider',
    status: hasKey ? 'ok' : 'warn',
    detail: `${resolved.provider}/${resolved.model}${hasKey ? ' key configured' : ` missing ${keyName}`}`,
    advice: hasKey ? undefined : `配置 ${keyName} 后才能真正调用模型。`,
  };
}

function checkModelCapabilities(env: NodeJS.ProcessEnv): DoctorCheck {
  const resolved = resolveProvider(env);
  if (!resolved.ok) {
    return { name: '模型能力', status: 'fail', detail: resolved.error };
  }
  const vision = resolved.provider === 'dashscope' && isDashScopeVisionModel(resolved.model);
  const nativeSearch = resolved.provider === 'dashscope' && !vision;
  return {
    name: '模型能力',
    status: 'ok',
    detail: [
      `toolCalling=true`,
      `streaming=true`,
      `vision=${vision}`,
      `imageDataUrl=${vision}`,
      `nativeSearch=${nativeSearch}`,
    ].join(', '),
  };
}

function checkFeishuBotConfig(env: NodeJS.ProcessEnv, cwd: string): DoctorCheck {
  try {
    const config = loadFeishuMultiUserConfig(env, cwd);
    const userCount = config.apps.reduce((sum, app) => sum + app.users.length, 0);
    const profileCount = new Set(config.apps.flatMap((app) => [
      app.defaultCliProfile,
      ...app.users.map((user) => user.cliProfile),
    ].filter((profile): profile is string => !!profile))).size;
    return {
      name: '飞书机器人配置',
      status: profileCount > 0 ? 'ok' : 'warn',
      detail: config.source === 'file'
        ? `multi-user config: apps=${config.apps.length}, users=${userCount}, cliProfiles=${profileCount}`
        : `legacy config: app=${config.apps[0]?.key ?? 'default'}, cliProfile=${profileCount > 0 ? 'configured' : 'missing'}`,
      advice: profileCount > 0 ? undefined : '为每个飞书用户配置 cliProfile，并完成 lark-cli --profile <profile> auth login。',
    };
  } catch (err) {
    const hasAppId = !!env['FEISHU_APP_ID'];
    const hasSecret = !!env['FEISHU_APP_SECRET'];
    if (hasAppId || hasSecret || env['FEISHU_MULTI_USER_CONFIG']) {
      return {
        name: '飞书机器人配置',
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
        advice: '检查 FEISHU_MULTI_USER_CONFIG 指向的 JSON，或补齐 FEISHU_APP_ID/FEISHU_APP_SECRET。',
      };
    }
  }

  const hasAppId = !!env['FEISHU_APP_ID'];
  const hasSecret = !!env['FEISHU_APP_SECRET'];
  return {
    name: '飞书机器人配置',
    status: 'warn',
    detail: `missing ${[!hasAppId ? 'FEISHU_APP_ID' : '', !hasSecret ? 'FEISHU_APP_SECRET' : ''].filter(Boolean).join(', ')}`,
    advice: '如果要用 npm run feishu，需要在飞书开放平台创建应用并配置 App ID/Secret。',
  };
}

function checkWritableDir(name: string, dir: string): DoctorCheck {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probe, 'ok', 'utf-8');
    fs.rmSync(probe, { force: true });
    return { name, status: 'ok', detail: `writable: ${dir}` };
  } catch (err) {
    return {
      name,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      advice: `检查目录权限：${dir}`,
    };
  }
}

async function checkLarkCliVersion(runner: DoctorRunner): Promise<DoctorCheck> {
  try {
    const result = await runner(['--version'], { timeoutMs: 5_000, maxOutputBytes: 4_096 });
    const output = (result.stdout || result.stderr).trim();
    if (result.exitCode === 0 && !result.timedOut && !result.aborted) {
      return { name: 'lark-cli', status: 'ok', detail: output || 'lark-cli available' };
    }
    return {
      name: 'lark-cli',
      status: 'warn',
      detail: `exitCode=${result.exitCode} ${output}`,
      advice: '运行 npm install，或检查 @larksuite/cli 是否可用。',
    };
  } catch (err) {
    return {
      name: 'lark-cli',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      advice: '运行 npm install 后再试。',
    };
  }
}

async function checkLarkCliAuth(
  runner: DoctorRunner,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<DoctorCheck> {
  const profiles = collectConfiguredCliProfiles(env, cwd);
  if (profiles.length > 0) {
    return checkLarkCliProfilesAuth(runner, profiles);
  }

  try {
    const result = await runner(['auth', 'status'], { timeoutMs: 8_000, maxOutputBytes: 8_192 });
    const output = (result.stdout || result.stderr).trim();
    if (result.exitCode === 0 && !result.timedOut && !result.aborted && isAuthStatusUsable(output)) {
      return { name: 'lark-cli auth', status: 'ok', detail: summarizeAuthStatus(output) };
    }
    return {
      name: 'lark-cli auth',
      status: 'warn',
      detail: summarizeAuthStatus(output) || `exitCode=${result.exitCode}`,
      advice: '运行 oa feishu login 完成 user 身份授权；bot 身份还需要飞书开放平台权限。',
    };
  } catch (err) {
    return {
      name: 'lark-cli auth',
      status: 'warn',
      detail: err instanceof Error ? err.message : String(err),
      advice: '运行 oa feishu login 或 oa feishu doctor 查看官方 CLI 状态。',
    };
  }
}

async function checkLarkCliProfilesAuth(runner: DoctorRunner, profiles: string[]): Promise<DoctorCheck> {
  const sampled = profiles.slice(0, 5);
  const results = await Promise.all(sampled.map(async (profile) => {
    try {
      const result = await runner(['--profile', profile, 'auth', 'status'], { timeoutMs: 8_000, maxOutputBytes: 8_192 });
      const output = (result.stdout || result.stderr).trim();
      const ok = result.exitCode === 0 && !result.timedOut && !result.aborted && isAuthStatusUsable(output);
      return { profile, ok, detail: summarizeAuthStatus(output) || `exitCode=${result.exitCode}` };
    } catch (err) {
      return { profile, ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }));

  const failed = results.filter((result) => !result.ok);
  const suffix = profiles.length > sampled.length ? `; sampled=${sampled.length}/${profiles.length}` : '';
  if (failed.length === 0) {
    return {
      name: 'lark-cli auth',
      status: 'ok',
      detail: `profiles ok: ${sampled.join(', ')}${suffix}`,
    };
  }

  return {
    name: 'lark-cli auth',
    status: 'warn',
    detail: `profiles with auth issue: ${failed.map((result) => `${result.profile}(${result.detail})`).join('; ')}${suffix}`,
    advice: '对失败的 profile 运行 lark-cli --profile <profile> auth login。',
  };
}

export function collectConfiguredCliProfiles(env: NodeJS.ProcessEnv, cwd: string): string[] {
  try {
    const config = loadFeishuMultiUserConfig(env, cwd);
    const profiles = new Set<string>();
    for (const app of config.apps) {
      if (app.defaultCliProfile) profiles.add(app.defaultCliProfile);
      for (const user of app.users) {
        if (user.cliProfile) profiles.add(user.cliProfile);
      }
    }
    return [...profiles].sort();
  } catch {
    return [];
  }
}

function summarizeAuthStatus(output: string): string {
  if (!output) return 'auth status ok';
  try {
    const parsed = JSON.parse(output) as {
      identity?: string;
      tokenStatus?: string;
      userOpenId?: string;
      userName?: string;
      identities?: {
        bot?: { status?: string; available?: boolean };
        user?: { status?: string; available?: boolean; tokenStatus?: string; openId?: string };
      };
    };
    const bot = parsed.identities?.bot;
    const user = parsed.identities?.user;
    return [
      `identity=${parsed.identity ?? 'unknown'}`,
      `bot=${bot?.status ?? (bot?.available ? 'available' : 'unknown')}`,
      `user=${user?.status ?? parsed.tokenStatus ?? 'unknown'}`,
      `token=${user?.tokenStatus ?? parsed.tokenStatus ?? 'unknown'}`,
      `openId=${maskId(user?.openId ?? parsed.userOpenId)}`,
    ].join(', ');
  } catch {
    return output.length > 500 ? `${output.slice(0, 500)}...` : output;
  }
}

function isAuthStatusUsable(output: string): boolean {
  if (!output) return true;
  try {
    const parsed = JSON.parse(output) as {
      tokenStatus?: string;
      status?: string;
      identities?: {
        bot?: { status?: string; available?: boolean };
        user?: { status?: string; available?: boolean; tokenStatus?: string };
      };
    };
    const candidates = [
      parsed.tokenStatus,
      parsed.status,
      parsed.identities?.user?.tokenStatus,
      parsed.identities?.user?.status,
    ].filter((value): value is string => !!value);
    if (candidates.length === 0) return true;
    return !candidates.some((value) => /needs_refresh|expired|invalid|disabled|unauthorized|not[_ -]?logged/i.test(value));
  } catch {
    return true;
  }
}

function summarizeProbeOutput(result: LarkCliRunResult): string {
  if (result.timedOut) return 'timeout';
  if (result.aborted) return 'aborted';
  const output = (result.stderr || result.stdout || '').trim();
  const summary = output.length > 240 ? `${output.slice(0, 240)}...` : output;
  return summary || `exitCode=${result.exitCode}`;
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function maskId(value: string | undefined): string {
  if (!value) return 'unknown';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function statusIcon(status: DoctorStatus): string {
  switch (status) {
    case 'ok': return '[OK]';
    case 'warn': return '[WARN]';
    case 'fail': return '[FAIL]';
  }
}

function resolveProvider(env: NodeJS.ProcessEnv): { ok: true; provider: 'dashscope' | 'deepseek'; model: string } | { ok: false; error: string } {
  const explicitProvider = env['OFFICE_AGENT_LLM_PROVIDER']?.trim().toLowerCase();
  if (explicitProvider && !['dashscope', 'qwen', 'bailian', 'deepseek'].includes(explicitProvider)) {
    return { ok: false, error: `未知 OFFICE_AGENT_LLM_PROVIDER: ${explicitProvider}` };
  }

  const provider = explicitProvider === 'deepseek'
    ? 'deepseek'
    : explicitProvider === 'qwen' || explicitProvider === 'bailian' || explicitProvider === 'dashscope'
      ? 'dashscope'
      : env['DEEPSEEK_MODEL']?.startsWith('deepseek-')
        ? 'deepseek'
        : 'dashscope';

  return {
    ok: true,
    provider,
    model: provider === 'deepseek'
      ? env['DEEPSEEK_MODEL'] ?? 'deepseek-v4-pro'
      : env['DASHSCOPE_MODEL'] ?? 'qwen-plus',
  };
}
