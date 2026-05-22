/**
 * Safe process wrapper for the official @larksuite/cli binary.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { logger } from '../core/logger.js';

const require = createRequire(import.meta.url);
const log = logger.child('LarkCliRunner');

export interface LarkCliRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  abortSignal?: AbortSignal;
}

export interface LarkCliRunResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
}

export interface LarkCliSpawnSpec {
  command: string;
  args: string[];
  displayCommand: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

export function resolveLarkCliSpawnSpec(args: string[]): LarkCliSpawnSpec {
  const explicitBin = process.env['LARK_CLI_BIN'];
  if (explicitBin) {
    return {
      command: explicitBin,
      args,
      displayCommand: shellDisplay([explicitBin, ...args]),
    };
  }

  let runScript: string;
  try {
    runScript = require.resolve('@larksuite/cli/scripts/run.js');
  } catch {
    throw new Error('未找到 @larksuite/cli。请先运行 npm install。');
  }

  return {
    command: process.execPath,
    args: [runScript, ...args],
    displayCommand: shellDisplay(['lark-cli', ...args]),
  };
}

export async function runLarkCli(
  args: string[],
  options: LarkCliRunOptions = {},
): Promise<LarkCliRunResult> {
  const spec = resolveLarkCliSpawnSpec(args);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = Date.now();
  log.info('start', { command: spec.displayCommand, timeoutMs, maxOutputBytes });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const child = spawn(spec.command, spec.args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.abortSignal?.removeEventListener('abort', onAbort);
      resolve({
        command: spec.displayCommand,
        args,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        aborted,
        truncated,
      });
      log.info('finish', {
        command: spec.displayCommand,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted,
        truncated,
        stdoutBytes,
        stderrBytes,
        stdoutTail: stdout.slice(-500),
        stderrTail: stderr.slice(-500),
      });
    };

    const append = (current: string, currentBytes: number, chunk: Buffer): [string, number] => {
      if (currentBytes >= maxOutputBytes) {
        truncated = true;
        return [current, currentBytes + chunk.length];
      }

      const remaining = maxOutputBytes - currentBytes;
      if (chunk.length > remaining) {
        truncated = true;
        return [current + chunk.subarray(0, remaining).toString('utf8'), currentBytes + chunk.length];
      }

      return [current + chunk.toString('utf8'), currentBytes + chunk.length];
    };

    const killChild = () => {
      if (!child.killed) child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 1_000).unref();
    };

    const onAbort = () => {
      aborted = true;
      killChild();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, timeoutMs);
    timer.unref();

    if (options.abortSignal?.aborted) {
      aborted = true;
      killChild();
    } else {
      options.abortSignal?.addEventListener('abort', onAbort);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      [stdout, stdoutBytes] = append(stdout, stdoutBytes, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      [stderr, stderrBytes] = append(stderr, stderrBytes, chunk);
    });

    child.on('error', (err) => {
      stderr += stderr ? `\n${err.message}` : err.message;
      log.error('spawn error', { command: spec.displayCommand, error: err.message });
      finish(null, null);
    });

    child.on('close', finish);

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

export async function runLarkCliInteractive(args: string[]): Promise<number | null> {
  const spec = resolveLarkCliSpawnSpec(args);
  log.info('interactive start', { command: spec.displayCommand });
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: 'inherit',
    });
    child.on('error', (err) => {
      log.error('interactive spawn error', { command: spec.displayCommand, error: err.message });
      reject(err);
    });
    child.on('close', (code) => {
      log.info('interactive finish', { command: spec.displayCommand, exitCode: code });
      resolve(code);
    });
  });
}

function shellDisplay(parts: string[]): string {
  return parts.map((part) => {
    if (/^[A-Za-z0-9_./:=@+-]+$/.test(part)) return part;
    return `'${part.replace(/'/g, "'\\''")}'`;
  }).join(' ');
}
