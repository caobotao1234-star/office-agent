/**
 * `oa doctor` — local environment and capability diagnostics.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LarkCliRunOptions, LarkCliRunResult } from '../../services/lark-cli-runner.js';
import { runLarkCli } from '../../services/lark-cli-runner.js';
import { isDashScopeVisionModel } from '../../core/dashscope-llm.js';

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
  checks.push(checkFeishuBotConfig(env));
  checks.push(checkWritableDir('数据目录', dataDir));
  checks.push(checkWritableDir('日志目录', logDir));
  checks.push(await checkLarkCliVersion(runner));
  checks.push(await checkLarkCliAuth(runner));

  return { checks };
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

function checkFeishuBotConfig(env: NodeJS.ProcessEnv): DoctorCheck {
  const hasAppId = !!env['FEISHU_APP_ID'];
  const hasSecret = !!env['FEISHU_APP_SECRET'];
  if (hasAppId && hasSecret) {
    return { name: '飞书机器人配置', status: 'ok', detail: 'FEISHU_APP_ID and FEISHU_APP_SECRET configured' };
  }
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

async function checkLarkCliAuth(runner: DoctorRunner): Promise<DoctorCheck> {
  try {
    const result = await runner(['auth', 'status'], { timeoutMs: 8_000, maxOutputBytes: 8_192 });
    const output = (result.stdout || result.stderr).trim();
    if (result.exitCode === 0 && !result.timedOut && !result.aborted) {
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
