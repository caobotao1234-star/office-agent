/**
 * `oa smoke` — quick local readiness check.
 *
 * Default mode avoids real LLM calls and real Feishu writes. It validates
 * local config, provider-compatible tool schemas, and lark-cli dry-run paths.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { createOfficeAgent } from '../../main.js';
import { zodToJsonSchema } from '../../core/schema-utils.js';
import type { LLMClient } from '../../core/llm-client.js';
import { createConfiguredLLM } from '../../core/llm-provider.js';
import { collectConfiguredCliProfiles, runDoctorChecks, type DoctorRunner, type DoctorStatus } from './doctor.js';
import { runLarkCli } from '../../services/lark-cli-runner.js';

export interface SmokeCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
  advice?: string;
}

export interface SmokeReport {
  checks: SmokeCheck[];
}

export interface SmokeOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  dataDir?: string;
  runner?: DoctorRunner;
  llmFactory?: () => LLMClient;
}

const FORBIDDEN_SCHEMA_KEYS = new Set(['oneOf', 'const', 'default', '$schema']);

export async function smoke(argv: string[] = []): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'real-llm': { type: 'boolean', default: false },
      'skip-feishu': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log([
      '用法: oa smoke [--real-llm] [--skip-feishu]',
      '',
      '默认只做本地和 dry-run 检查，不调用真实 LLM，不创建真实飞书资源。',
      '--real-llm     额外调用一次当前配置的 LLM 做连通性测试',
      '--skip-feishu  跳过 lark-cli dry-run 探测',
    ].join('\n'));
    return;
  }

  const report = await runSmokeChecks({
    env: process.env,
    cwd: process.cwd(),
    runner: runLarkCli,
    llmFactory: values['real-llm'] ? () => createConfiguredLLM().llm : undefined,
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-smoke-')),
    ...(values['skip-feishu'] ? { env: { ...process.env, OFFICE_AGENT_SMOKE_SKIP_FEISHU: '1' } } : {}),
  });

  console.log(formatSmokeReport(report));
  if (report.checks.some((check) => check.status === 'fail')) process.exitCode = 1;
}

export async function runSmokeChecks(options: SmokeOptions = {}): Promise<SmokeReport> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-smoke-'));
  const runner = options.runner ?? runLarkCli;
  const checks: SmokeCheck[] = [];

  const doctor = await runDoctorChecks({
    env,
    cwd,
    dataDir,
    logDir: env['OFFICE_AGENT_LOG_DIR'] ?? path.join(cwd, 'logs'),
    runner,
  });
  checks.push(...doctor.checks.map((check) => ({
    ...check,
    name: `doctor/${check.name}`,
  })));

  checks.push(checkToolSchemas(dataDir));
  checks.push(await checkOptionalRealLlm(options.llmFactory));

  if (isTruthy(env['OFFICE_AGENT_SMOKE_SKIP_FEISHU'])) {
    checks.push({
      name: 'lark-cli dry-run',
      status: 'warn',
      detail: 'skipped by OFFICE_AGENT_SMOKE_SKIP_FEISHU',
    });
  } else {
    checks.push(...await checkLarkCliDryRuns(runner, env, cwd));
  }

  return { checks };
}

export function formatSmokeReport(report: SmokeReport): string {
  const lines = ['Office Agent Smoke', ''];
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

function checkToolSchemas(dataDir: string): SmokeCheck {
  const fakeLlm: LLMClient = {
    capabilities: { toolCalling: true, streaming: true },
    async query() { return 'ok'; },
    async queryWithTools() { return { content: 'ok', toolCalls: null }; },
  };

  try {
    const agent = createOfficeAgent({
      llm: fakeLlm,
      model: 'smoke-fake-model',
      baseDir: dataDir,
    });
    const failures: string[] = [];
    for (const tool of agent.toolRegistry.listEnabled()) {
      const schema = zodToJsonSchema(tool.inputSchema);
      if (schema['type'] !== 'object') failures.push(`${tool.name}: root type is ${String(schema['type'])}`);
      for (const issue of findSchemaIssues(schema)) failures.push(`${tool.name}: ${issue}`);
    }

    agent.stop();
    if (failures.length > 0) {
      return {
        name: 'tool schema',
        status: 'fail',
        detail: failures.slice(0, 5).join('; '),
        advice: '检查 zodToJsonSchema/sanitizeToolJsonSchema，避免向 provider 发送不兼容 schema。',
      };
    }
    return {
      name: 'tool schema',
      status: 'ok',
      detail: `${agent.toolRegistry.listEnabled().length} enabled tools are provider-compatible`,
    };
  } catch (err) {
    return {
      name: 'tool schema',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkOptionalRealLlm(llmFactory: (() => LLMClient) | undefined): Promise<SmokeCheck> {
  if (!llmFactory) {
    return {
      name: 'real LLM',
      status: 'warn',
      detail: 'skipped by default',
      advice: '需要真实模型连通性时运行 oa smoke --real-llm。',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  timeout.unref?.();
  try {
    const llm = llmFactory();
    const text = await llm.query('Reply with exactly: ok', 'ok', controller.signal);
    return {
      name: 'real LLM',
      status: text.trim().length > 0 ? 'ok' : 'warn',
      detail: text.trim().length > 0 ? 'LLM responded' : 'LLM returned empty response',
    };
  } catch (err) {
    return {
      name: 'real LLM',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      advice: '检查当前 provider、API key、base URL 和模型名。',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkLarkCliDryRuns(
  runner: DoctorRunner,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<SmokeCheck[]> {
  const profiles = collectConfiguredCliProfiles(env, cwd);
  if (profiles.length === 0) {
    return [{
      name: 'lark-cli dry-run',
      status: 'warn',
      detail: 'no configured cli profiles',
      advice: '配置 feishu-users.json 里的 cliProfile 后可检查飞书 docs/base dry-run。',
    }];
  }

  const sampled = profiles.slice(0, 3);
  const checks: SmokeCheck[] = [];
  for (const profile of sampled) {
    checks.push(await runDryRunProbe(runner, profile, 'docs create dry-run', [
      '--profile', profile,
      'docs', '+create',
      '--api-version', 'v2',
      '--doc-format', 'markdown',
      '--content', '-',
      '--as', 'user',
      '--dry-run',
    ], '<title>Office Agent Smoke</title>\n# Smoke\n'));
    checks.push(await runDryRunProbe(runner, profile, 'base create dry-run', [
      '--profile', profile,
      'base', '+base-create',
      '--name', 'Office Agent Smoke',
      '--as', 'user',
      '--dry-run',
    ]));
  }
  return checks;
}

async function runDryRunProbe(
  runner: DoctorRunner,
  profile: string,
  label: string,
  args: string[],
  stdin?: string,
): Promise<SmokeCheck> {
  try {
    const result = await runner(args, {
      stdin,
      timeoutMs: 15_000,
      maxOutputBytes: 16_384,
    });
    const ok = result.exitCode === 0 && !result.timedOut && !result.aborted;
    return {
      name: `lark-cli ${label}`,
      status: ok ? 'ok' : 'fail',
      detail: ok ? `profile=${profile}` : `profile=${profile}, ${summarizeRunResult(result)}`,
      advice: ok ? undefined : '运行同一命令加 --help，确认 lark-cli 版本、参数和 profile 授权。',
    };
  } catch (err) {
    return {
      name: `lark-cli ${label}`,
      status: 'fail',
      detail: `profile=${profile}, ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function findSchemaIssues(value: unknown, pathName = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSchemaIssues(item, `${pathName}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];

  const obj = value as Record<string, unknown>;
  const issues: string[] = [];
  if (Object.keys(obj).length === 0) issues.push(`${pathName} is empty object schema`);
  for (const [key, child] of Object.entries(obj)) {
    if (FORBIDDEN_SCHEMA_KEYS.has(key)) issues.push(`${pathName}.${key} is forbidden`);
    issues.push(...findSchemaIssues(child, `${pathName}.${key}`));
  }
  return issues;
}

function summarizeRunResult(result: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; aborted: boolean }): string {
  if (result.timedOut) return 'timeout';
  if (result.aborted) return 'aborted';
  const text = (result.stderr || result.stdout || '').trim();
  return text ? text.slice(0, 240) : `exitCode=${result.exitCode}`;
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function statusIcon(status: DoctorStatus): string {
  switch (status) {
    case 'ok': return '[OK]';
    case 'warn': return '[WARN]';
    case 'fail': return '[FAIL]';
  }
}
