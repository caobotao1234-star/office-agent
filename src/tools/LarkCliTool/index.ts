/**
 * LarkCli Tool — delegates Feishu/Lark operations to the official lark-cli.
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import type { LarkCliRunOptions, LarkCliRunResult } from '../../services/lark-cli-runner.js';
import { runLarkCli } from '../../services/lark-cli-runner.js';
import { LarkCliKnowledgeBase } from '../../services/lark-cli-knowledge-base.js';
import { formatLarkCliRecipe } from '../../services/lark-cli-recipes.js';
import { logger } from '../../core/logger.js';

const log = logger.child('LarkCliTool');

const LarkCliInput = z.object({
  args: z.array(z.string().min(1))
    .min(1)
    .describe('Arguments passed after lark-cli. Do not include "lark-cli" itself. Example: ["docs","+fetch","--url","https://...","--format","json"].'),
  stdin: z.string().optional().describe('Optional stdin for commands that explicitly read from stdin. Prefer this for long/multiline docs content with --content - or --markdown -.'),
  timeoutMs: z.coerce.number().min(1_000).max(300_000).default(60_000),
  reason: z.string().optional().describe('Optional audit note for why this command is being executed.'),
});

export type LarkCliInput = z.infer<typeof LarkCliInput>;
export type LarkCliRunner = (args: string[], options?: LarkCliRunOptions) => Promise<LarkCliRunResult>;

const WRITE_KEYWORDS = [
  'add',
  'append',
  'approve',
  'bind',
  'cancel',
  'complete',
  'create',
  'delete',
  'download',
  'forward',
  'init',
  'insert',
  'invite',
  'login',
  'logout',
  'move',
  'overwrite',
  'patch',
  'reject',
  'remove',
  'reply',
  'reopen',
  'replace',
  'send',
  'set',
  'transfer',
  'update',
  'upload',
  'write',
];

const READ_ONLY_PATTERNS = [
  /^--?h(elp)?$/,
  /^help$/,
  /^doctor$/,
  /^schema$/,
  /^status$/,
  /^show$/,
  /^list$/,
  /^search$/,
  /^fetch$/,
  /^read$/,
  /^info$/,
  /^get$/,
  /^check$/,
  /^scopes$/,
];

export class LarkCliTool implements Tool<LarkCliInput, unknown> {
  readonly name = 'LarkCli';
  readonly description = [
    'Run the official lark-cli for Feishu/Lark operations: messages, docs, sheets, base, calendar, tasks, wiki, contacts, meetings, and raw OpenAPI calls.',
    'Pass args as an argv array after lark-cli, never as a shell string.',
    'Use lark-cli schema or --help to inspect parameters when unsure. Do not guess flags.',
    'The user has granted high-trust standing authorization for Feishu operations available to the current credentials and scopes.',
    'Do not ask for per-action permission. Before write commands, inspect the command with --help or run a successful --dry-run for that same command first.',
    'Docs v2 create/update/fetch flags are version-specific: docs +create --api-version v2 uses --content and --doc-format, not --title or --markdown.',
    'For long or multiline document content, use args ["docs","+create","--api-version","v2","--doc-format","markdown","--content","-","--as","user"] and put the full content in stdin.',
    'Prefer --as user for personal data and --as bot for bot-owned actions.',
    'Prefer --format json for machine-readable output when --help shows the command supports it.',
    'Ask the user only when the target, content, or intent is ambiguous.',
  ].join(' ');
  readonly inputSchema = LarkCliInput;

  private enabled = true;
  private verifiedWriteCommands = new Set<string>();

  constructor(
    private knowledgeBase = new LarkCliKnowledgeBase(),
    private runner: LarkCliRunner = runLarkCli,
  ) {}

  isEnabled(): boolean { return this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }

  isReadOnly(input: LarkCliInput): boolean {
    return !requiresWriteGuidance(input.args);
  }

  checkPermissions(_input: LarkCliInput): PermissionResult {
    if (!this.enabled) return { allowed: false, reason: 'LarkCli 未启用' };
    return { allowed: true };
  }

  async call(input: LarkCliInput, context: ToolContext): Promise<ToolResult<unknown>> {
    const normalizedInput = normalizeDocumentContentToStdin(input);
    const commandNeedsGuidance = requiresWriteGuidance(normalizedInput.args);
    const commandKey = getCommandKey(normalizedInput.args);
    const knownValidationError = validateKnownCommand(normalizedInput.args, normalizedInput.stdin);
    const profileArgs = applyLarkCliProfile(normalizedInput.args, context.larkCliProfile);

    log.info('call', {
      args: normalizedInput.args,
      commandKey,
      commandNeedsGuidance,
      reason: normalizedInput.reason,
      feishuAppKey: context.feishuAppKey,
      feishuUserKey: context.feishuUserKey,
      hasCliProfile: !!context.larkCliProfile,
      stdinBytes: normalizedInput.stdin ? Buffer.byteLength(normalizedInput.stdin, 'utf-8') : 0,
    });

    if (knownValidationError) {
      log.warn('known command validation failed', { args: normalizedInput.args, error: knownValidationError });
      const recipe = formatLarkCliRecipe(commandKey);
      return {
        success: false,
        output: {
          command: `lark-cli ${normalizedInput.args.join(' ')}`,
          helpHint: commandKey ? [...commandKey.split(' '), '--help'] : ['--help'],
          ...(recipe ? { recipe } : {}),
        },
        error: knownValidationError,
      };
    }

    if (context.feishuUserKey && !context.larkCliProfile && requiresCliProfile(normalizedInput.args)) {
      const error = [
        '当前飞书用户没有绑定 lark-cli profile，不能执行飞书读写操作。',
        '请在 FEISHU_MULTI_USER_CONFIG 指向的 JSON 中为该用户配置 cliProfile，',
        '并运行 lark-cli --profile <profile> auth login 完成授权。',
      ].join('');
      log.warn('blocked lark-cli command without user profile', {
        args: input.args,
        commandKey,
        feishuAppKey: context.feishuAppKey,
        feishuUserKey: context.feishuUserKey,
      });
      return {
        success: false,
        output: {
          command: `lark-cli ${normalizedInput.args.join(' ')}`,
          feishuAppKey: context.feishuAppKey,
          feishuUserKey: context.feishuUserKey,
          missingCliProfile: true,
        },
        error,
      };
    }

    if (commandNeedsGuidance && commandKey && !this.verifiedWriteCommands.has(commandKey)) {
      log.warn('blocked write command without guidance', { args: normalizedInput.args, commandKey });
      const cachedHelp = this.knowledgeBase.summarize(commandKey);
      const recipe = formatLarkCliRecipe(commandKey);
      return {
        success: false,
        output: {
          command: `lark-cli ${normalizedInput.args.join(' ')}`,
          requiresCliGuidance: true,
          helpHint: [...commandKey.split(' '), '--help'],
          dryRunHint: appendDryRun(normalizedInput.args),
          ...(recipe ? { recipe } : {}),
          ...(cachedHelp ? { cachedHelp } : {}),
        },
        error: '执行写操作前必须先查看同一 lark-cli 命令的 --help，或成功运行一次同一命令的 --dry-run。不要猜参数。',
      };
    }

    const { result, retry } = await runLarkCliWithRetry(this.runner, profileArgs, {
      stdin: normalizedInput.stdin,
      timeoutMs: normalizedInput.timeoutMs,
      abortSignal: context.abortSignal,
    }, {
      actualWrite: commandNeedsGuidance,
      commandKey,
    });

    const output = {
      command: result.command,
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout.trimEnd(),
      stderr: result.stderr.trimEnd(),
      timedOut: result.timedOut,
      aborted: result.aborted,
      truncated: result.truncated,
      attempts: retry.attempts,
      retried: retry.retried,
      ...(formatLarkCliRecipe(commandKey) ? { recipe: formatLarkCliRecipe(commandKey) } : {}),
      ...(retry.skippedReason ? { retrySkippedReason: retry.skippedReason } : {}),
    };

    if (result.exitCode === 0 && commandKey && isGuidanceCommand(normalizedInput.args)) {
      this.verifiedWriteCommands.add(commandKey);
      if (normalizedInput.args.includes('--help') || normalizedInput.args.includes('-h')) {
        this.knowledgeBase.recordHelp({
          commandKey,
          args: profileArgs,
          help: [result.stdout, result.stderr].filter(Boolean).join('\n'),
        });
      }
      log.info('verified write command guidance', { commandKey });
    }

    if (result.exitCode === 0 && !result.timedOut && !result.aborted) {
      log.info('success', { commandKey, exitCode: result.exitCode });
      return { success: true, output };
    }

    const failure = result.timedOut
      ? 'lark-cli 调用超时'
      : result.aborted
        ? 'lark-cli 调用已中断'
        : `lark-cli 退出码 ${result.exitCode ?? 'unknown'}`;
    log.error('failed', { commandKey, failure, output });
    return { success: false, output, error: failure };
  }
}

export function getCommandKey(args: string[]): string | null {
  const normalizedArgs = stripLarkCliGlobalOptions(args);
  const positional = normalizedArgs.filter((arg) => !arg.startsWith('-') && arg !== 'user' && arg !== 'bot');
  if (positional.length === 0) return null;

  if (positional[0] === 'api') {
    return positional.slice(0, 3).join(' ');
  }

  if (positional[1]?.startsWith('+')) {
    return positional.slice(0, 2).join(' ');
  }

  return positional.slice(0, Math.min(3, positional.length)).join(' ');
}

export function applyLarkCliProfile(args: string[], profile?: string): string[] {
  if (!profile || hasFlag(args, '--profile')) return args;
  return ['--profile', profile, ...args];
}

export function requiresCliProfile(args: string[]): boolean {
  const normalizedArgs = stripLarkCliGlobalOptions(args);
  if (normalizedArgs.length === 0) return false;
  if (normalizedArgs.includes('--help') || normalizedArgs.includes('-h')) return false;

  const first = normalizedArgs[0];
  if (!first) return false;
  return !['--version', 'version', 'help', 'doctor', 'schema'].includes(first);
}

function stripLarkCliGlobalOptions(args: string[]): string[] {
  const normalized: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--profile') {
      i++;
      continue;
    }
    if (arg.startsWith('--profile=')) continue;
    normalized.push(arg);
  }
  return normalized;
}

function isGuidanceCommand(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h') || args.includes('--dry-run');
}

export function validateKnownCommand(args: string[], stdin?: string): string | null {
  const commandKey = getCommandKey(args);
  if (args.includes('--help') || args.includes('-h')) {
    if (commandKey === 'base +create') {
      return 'base 没有 +create 子命令。创建多维表格请先运行 base +base-create --help，然后使用 base +base-create --name "名称" --as user。';
    }
    return null;
  }

  const baseValidation = validateKnownBaseCommand(args, commandKey);
  if (baseValidation) return baseValidation;

  if (commandKey !== 'docs +create') return null;
  if (getFlagValue(args, '--api-version') !== 'v2') return null;

  const invalidFlags = ['--title', '--markdown', '--format'].filter((flag) => hasFlag(args, flag));
  if (invalidFlags.length > 0) {
    return `docs +create --api-version v2 不支持 ${invalidFlags.join(', ')}。请使用 --content，并把标题写成 <title>标题</title>。`;
  }

  const content = getFlagValue(args, '--content');
  if (!content) {
    return 'docs +create --api-version v2 必须提供 --content。创建 Markdown 文档请使用 --doc-format markdown --content "<title>标题</title>\\n# 正文"。';
  }
  const contentForValidation = content === '-' ? stdin : content;
  if (content === '-' && !contentForValidation?.trim()) {
    return 'docs +create --api-version v2 使用 --content - 时，必须通过 stdin 提供文档内容。';
  }

  const docFormat = getFlagValue(args, '--doc-format');
  if (!docFormat) {
    return 'docs +create --api-version v2 必须显式提供 --doc-format markdown 或 --doc-format xml，避免创建空文档。';
  }

  if (docFormat === 'markdown' && contentForValidation && !/<title>[^<]+<\/title>/.test(contentForValidation)) {
    return 'docs +create --api-version v2 使用 markdown 时，--content 必须包含 <title>标题</title>，否则飞书可能创建 untitled 文档。';
  }

  return null;
}

function validateKnownBaseCommand(args: string[], commandKey: string | null): string | null {
  if (!commandKey?.startsWith('base ')) return null;

  if (commandKey === 'base +create') {
    return 'base 没有 +create 子命令。创建多维表格请使用 base +base-create --name "名称" --as user；创建表请使用 base +table-create --base-token BASE --name "表名" --as user。';
  }

  if (commandKey === 'base +base-create') {
    const invalidFlags = ['--title', '--format'].filter((flag) => hasFlag(args, flag));
    if (invalidFlags.length > 0) {
      return `base +base-create 不支持 ${invalidFlags.join(', ')}。请使用 --name 设置多维表格名称；该命令默认输出 JSON，可用 -q 过滤。`;
    }
    if (!getFlagValue(args, '--name')) {
      return 'base +base-create 必须提供 --name，例如：base +base-create --name "Office Agent 能力全景表" --as user。';
    }
  }

  if (commandKey === 'base +table-create') {
    const invalidFlags = ['--base', '--format'].filter((flag) => hasFlag(args, flag));
    if (invalidFlags.length > 0) {
      return `base +table-create 不支持 ${invalidFlags.join(', ')}。请使用 --base-token 指定多维表格 token；该命令默认输出 JSON，可用 -q 过滤。`;
    }
    const missing = requiredFlags(args, ['--base-token', '--name']);
    if (missing.length > 0) {
      return `base +table-create 缺少 ${missing.join(', ')}。示例：base +table-create --base-token BASE --name "能力清单" --as user。`;
    }
  }

  if (commandKey === 'base +field-create') {
    const invalidFlags = ['--base', '--field', '--format'].filter((flag) => hasFlag(args, flag));
    if (invalidFlags.length > 0) {
      return `base +field-create 不支持 ${invalidFlags.join(', ')}。请使用 --base-token、--table-id 和 --json。`;
    }
    const missing = requiredFlags(args, ['--base-token', '--table-id', '--json']);
    if (missing.length > 0) {
      return `base +field-create 缺少 ${missing.join(', ')}。示例：base +field-create --base-token BASE --table-id TABLE --json '{"name":"类别","type":"text"}' --as user。`;
    }
  }

  if (commandKey === 'base +record-batch-create') {
    const invalidFlags = ['--base', '--records', '--fields', '--format'].filter((flag) => hasFlag(args, flag));
    if (invalidFlags.length > 0) {
      return `base +record-batch-create 不支持 ${invalidFlags.join(', ')}。请使用 --base-token、--table-id 和 --json。`;
    }
    const missing = requiredFlags(args, ['--base-token', '--table-id', '--json']);
    if (missing.length > 0) {
      return `base +record-batch-create 缺少 ${missing.join(', ')}。示例：base +record-batch-create --base-token BASE --table-id TABLE --json '{"fields":["能力","怎么用"],"rows":[["任务管理","直接说待办"]]}' --as user。`;
    }
  }

  return null;
}

export function requiresWriteGuidance(args: string[]): boolean {
  if (args.includes('--help') || args.includes('-h')) return false;
  if (args.includes('--dry-run')) return false;
  if (args.length === 0) return false;

  const normalized = args
    .filter((arg) => !arg.startsWith('--format') && arg !== 'json' && arg !== 'pretty')
    .map((arg) => arg.toLowerCase());

  if (normalized.every((arg) => READ_ONLY_PATTERNS.some((pattern) => pattern.test(stripShortcutPrefix(arg))))) {
    return false;
  }

  return normalized.some((arg) => {
    const clean = stripShortcutPrefix(arg);
    return WRITE_KEYWORDS.some((keyword) =>
      clean === keyword ||
      clean.startsWith(`${keyword}-`) ||
      clean.endsWith(`-${keyword}`) ||
      clean.includes(`-${keyword}-`),
    );
  });
}

function appendDryRun(args: string[]): string[] {
  return args.includes('--dry-run') ? args : [...args, '--dry-run'];
}

function stripShortcutPrefix(arg: string): string {
  return arg.replace(/^\+/, '');
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function requiredFlags(args: string[], flags: string[]): string[] {
  return flags.filter((flag) => !getFlagValue(args, flag));
}

function hasFlag(args: string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

interface FlagOccurrence {
  flag: string;
  index: number;
  value: string;
  inline: boolean;
}

function normalizeDocumentContentToStdin(input: LarkCliInput): LarkCliInput {
  if (input.stdin) return input;
  const commandKey = getCommandKey(input.args);
  if (commandKey !== 'docs +create' && commandKey !== 'docs +update') return input;

  const occurrence = getFlagOccurrence(input.args, ['--content', '--markdown']);
  if (!occurrence) return input;
  if (occurrence.value === '-' || occurrence.value.startsWith('@')) return input;
  if (!shouldMoveContentToStdin(occurrence.value)) return input;

  const args = [...input.args];
  if (occurrence.inline) {
    args[occurrence.index] = `${occurrence.flag}=-`;
  } else {
    args[occurrence.index + 1] = '-';
  }
  return { ...input, args, stdin: occurrence.value };
}

function getFlagOccurrence(args: string[], flags: string[]): FlagOccurrence | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    for (const flag of flags) {
      if (arg === flag) {
        const value = args[i + 1];
        if (value === undefined) return null;
        return { flag, index: i, value, inline: false };
      }
      if (arg.startsWith(`${flag}=`)) {
        return { flag, index: i, value: arg.slice(flag.length + 1), inline: true };
      }
    }
  }
  return null;
}

function shouldMoveContentToStdin(value: string): boolean {
  return value.length > 500 || value.includes('\n') || value.includes('\r');
}

interface RetryState {
  attempts: number;
  retried: boolean;
  skippedReason?: string;
}

async function runLarkCliWithRetry(
  runner: LarkCliRunner,
  args: string[],
  options: LarkCliRunOptions,
  policy: { actualWrite: boolean; commandKey: string | null },
): Promise<{ result: LarkCliRunResult; retry: RetryState }> {
  const maxAttempts = getRetryAttempts();
  const retry: RetryState = { attempts: 0, retried: false };
  let lastResult: LarkCliRunResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runner(args, options);
    retry.attempts = attempt;
    lastResult = result;

    if (isSuccessfulResult(result)) return { result, retry };
    const decision = getRetryDecision(result, policy.actualWrite, attempt, maxAttempts);
    if (!decision.retry) {
      if (decision.reason) retry.skippedReason = decision.reason;
      return { result, retry };
    }

    retry.retried = true;
    log.warn('retrying lark-cli command after transient failure', {
      commandKey: policy.commandKey,
      attempt,
      maxAttempts,
      actualWrite: policy.actualWrite,
      reason: decision.reason,
    });
    await sleep(getRetryBackoffMs(attempt));
  }

  return { result: lastResult!, retry };
}

function getRetryDecision(
  result: LarkCliRunResult,
  actualWrite: boolean,
  attempt: number,
  maxAttempts: number,
): { retry: boolean; reason?: string } {
  if (attempt >= maxAttempts) return { retry: false };
  if (result.aborted) return { retry: false };
  const text = `${result.stderr}\n${result.stdout}`;
  if (!isTransientLarkCliFailure(result, text)) return { retry: false };

  if (!actualWrite) return { retry: true, reason: 'transient_read_or_guidance_failure' };
  if (isSafeBeforeRequestFailure(text)) return { retry: true, reason: 'transient_before_request_failure' };
  return {
    retry: false,
    reason: '检测到疑似瞬时故障，但这是写操作；为避免重复副作用，未自动重试。请先检查目标状态后再继续。',
  };
}

function isSuccessfulResult(result: LarkCliRunResult): boolean {
  return result.exitCode === 0 && !result.timedOut && !result.aborted;
}

function isTransientLarkCliFailure(result: LarkCliRunResult, text: string): boolean {
  if (result.timedOut) return true;
  return [
    /no such host/i,
    /lookup .*:.* no such/i,
    /\bENOTFOUND\b/i,
    /\bEAI_AGAIN\b/i,
    /\bECONNRESET\b/i,
    /\bECONNREFUSED\b/i,
    /\bETIMEDOUT\b/i,
    /network is unreachable/i,
    /connection refused/i,
    /unexpected EOF/i,
    /\bEOF\b/i,
    /\bHTTP 502\b/i,
    /\bHTTP 503\b/i,
    /\bHTTP 504\b/i,
    /502 Bad Gateway/i,
    /503 Service Unavailable/i,
    /504 Gateway Timeout/i,
  ].some((pattern) => pattern.test(text));
}

function isSafeBeforeRequestFailure(text: string): boolean {
  return [
    /no such host/i,
    /lookup .*:.* no such/i,
    /\bENOTFOUND\b/i,
    /\bEAI_AGAIN\b/i,
    /\bECONNREFUSED\b/i,
    /connection refused/i,
    /network is unreachable/i,
    /proxyconnect tcp/i,
  ].some((pattern) => pattern.test(text));
}

function getRetryAttempts(): number {
  const raw = Number(process.env['OFFICE_AGENT_LARK_CLI_RETRY_ATTEMPTS']);
  if (!Number.isFinite(raw) || raw <= 0) return 3;
  return Math.min(5, Math.max(1, Math.floor(raw)));
}

function getRetryBackoffMs(attempt: number): number {
  const raw = Number(process.env['OFFICE_AGENT_LARK_CLI_RETRY_BASE_MS']);
  const base = Number.isFinite(raw) && raw >= 0 ? raw : 50;
  return base * attempt;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
