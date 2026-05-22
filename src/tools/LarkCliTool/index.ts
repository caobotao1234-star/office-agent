/**
 * LarkCli Tool — delegates Feishu/Lark operations to the official lark-cli.
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import { runLarkCli } from '../../services/lark-cli-runner.js';
import { logger } from '../../core/logger.js';

const log = logger.child('LarkCliTool');

const LarkCliInput = z.object({
  args: z.array(z.string().min(1))
    .min(1)
    .describe('Arguments passed after lark-cli. Do not include "lark-cli" itself. Example: ["docs","+fetch","--url","https://...","--format","json"].'),
  stdin: z.string().optional().describe('Optional stdin for commands that explicitly read from stdin.'),
  timeoutMs: z.coerce.number().min(1_000).max(300_000).default(60_000),
  confirmed: z.boolean().default(false).describe('Set true only when the user explicitly asked to execute this side-effect operation. Use --dry-run first when unsure.'),
  reason: z.string().optional().describe('Short reason why this command is being executed. Required for confirmed write operations.'),
});

export type LarkCliInput = z.infer<typeof LarkCliInput>;

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
    'Run the official lark-cli for Feishu/Lark operations: messages, docs, sheets, base, calendar, mail, tasks, wiki, contacts, meetings, approval, and raw OpenAPI calls.',
    'Pass args as an argv array after lark-cli, never as a shell string.',
    'Use lark-cli schema or --help to inspect parameters when unsure. Do not guess flags.',
    'Before any confirmed write command, inspect the command with --help or run a successful --dry-run for that same command first.',
    'Docs v2 create/update/fetch flags are version-specific: docs +create --api-version v2 uses --content and --doc-format, not --title or --markdown.',
    'Prefer --as user for personal data and --as bot for bot-owned actions.',
    'Prefer --format json for machine-readable output when --help shows the command supports it.',
    'For side-effect commands, run --dry-run first when unsure; set confirmed=true only when the user explicitly asked to execute.',
  ].join(' ');
  readonly inputSchema = LarkCliInput;

  private enabled = true;
  private verifiedWriteCommands = new Set<string>();

  isEnabled(): boolean { return this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }

  isReadOnly(input: LarkCliInput): boolean {
    return !requiresWriteConfirmation(input.args);
  }

  checkPermissions(_input: LarkCliInput): PermissionResult {
    if (!this.enabled) return { allowed: false, reason: 'LarkCli 未启用' };
    return { allowed: true };
  }

  requiresUserConfirmation(input: LarkCliInput): boolean {
    return requiresWriteConfirmation(input.args);
  }

  async call(input: LarkCliInput, context: ToolContext): Promise<ToolResult<unknown>> {
    const commandNeedsConfirmation = requiresWriteConfirmation(input.args);
    const commandKey = getCommandKey(input.args);
    const knownValidationError = validateKnownCommand(input.args);

    log.info('call', {
      args: input.args,
      commandKey,
      commandNeedsConfirmation,
      confirmed: input.confirmed,
      reason: input.reason,
    });

    if (knownValidationError) {
      log.warn('known command validation failed', { args: input.args, error: knownValidationError });
      return {
        success: false,
        output: {
          command: `lark-cli ${input.args.join(' ')}`,
          helpHint: commandKey ? [...commandKey.split(' '), '--help'] : ['--help'],
        },
        error: knownValidationError,
      };
    }

    if (commandNeedsConfirmation && !input.confirmed) {
      log.warn('blocked unconfirmed write command', { args: input.args, commandKey });
      return {
        success: false,
        output: {
          command: `lark-cli ${input.args.join(' ')}`,
          requiresConfirmation: true,
          helpHint: commandKey ? [...commandKey.split(' '), '--help'] : ['--help'],
          dryRunHint: appendDryRun(input.args),
        },
        error: '该 lark-cli 命令可能会修改飞书数据。请先使用 --dry-run 预览，或在用户明确要求执行时设置 confirmed=true。',
      };
    }

    if (commandNeedsConfirmation && commandKey && !this.verifiedWriteCommands.has(commandKey)) {
      log.warn('blocked write command without guidance', { args: input.args, commandKey });
      return {
        success: false,
        output: {
          command: `lark-cli ${input.args.join(' ')}`,
          requiresCliGuidance: true,
          helpHint: [...commandKey.split(' '), '--help'],
          dryRunHint: appendDryRun(input.args),
        },
        error: '执行写操作前必须先查看同一 lark-cli 命令的 --help，或成功运行一次同一命令的 --dry-run。不要猜参数。',
      };
    }

    if (commandNeedsConfirmation && !input.reason?.trim()) {
      log.warn('blocked confirmed write without reason', { args: input.args, commandKey });
      return {
        success: false,
        output: null,
        error: 'confirmed=true 的写操作必须提供 reason，说明用户为何授权执行。',
      };
    }

    const result = await runLarkCli(input.args, {
      stdin: input.stdin,
      timeoutMs: input.timeoutMs,
      abortSignal: context.abortSignal,
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
    };

    if (result.exitCode === 0 && commandKey && isGuidanceCommand(input.args)) {
      this.verifiedWriteCommands.add(commandKey);
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
  const positional = args.filter((arg) => !arg.startsWith('-') && arg !== 'user' && arg !== 'bot');
  if (positional.length === 0) return null;

  if (positional[0] === 'api') {
    return positional.slice(0, 3).join(' ');
  }

  if (positional[1]?.startsWith('+')) {
    return positional.slice(0, 2).join(' ');
  }

  return positional.slice(0, Math.min(3, positional.length)).join(' ');
}

function isGuidanceCommand(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h') || args.includes('--dry-run');
}

export function validateKnownCommand(args: string[]): string | null {
  const commandKey = getCommandKey(args);
  if (commandKey !== 'docs +create') return null;
  if (getFlagValue(args, '--api-version') !== 'v2') return null;
  if (args.includes('--help') || args.includes('-h') || args.includes('--dry-run')) return null;

  const invalidFlags = ['--title', '--markdown', '--format'].filter((flag) => args.includes(flag));
  if (invalidFlags.length > 0) {
    return `docs +create --api-version v2 不支持 ${invalidFlags.join(', ')}。请使用 --content，并把标题写成 <title>标题</title>。`;
  }

  const content = getFlagValue(args, '--content');
  if (!content) {
    return 'docs +create --api-version v2 必须提供 --content。创建 Markdown 文档请使用 --doc-format markdown --content "<title>标题</title>\\n# 正文"。';
  }

  const docFormat = getFlagValue(args, '--doc-format');
  if (!docFormat) {
    return 'docs +create --api-version v2 必须显式提供 --doc-format markdown 或 --doc-format xml，避免创建空文档。';
  }

  if (docFormat === 'markdown' && !/<title>[^<]+<\/title>/.test(content)) {
    return 'docs +create --api-version v2 使用 markdown 时，--content 必须包含 <title>标题</title>，否则飞书可能创建 untitled 文档。';
  }

  return null;
}

export function requiresWriteConfirmation(args: string[]): boolean {
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
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
