/**
 * Logger — Structured logging with levels and optional file output.
 *
 * Levels: debug < info < warn < error
 * Output: console (colored) + optional file (./logs by default)
 *
 * Usage:
 *   import { logger } from './logger.js';
 *   logger.info('Server started', { port: 3000 });
 *   logger.error('Failed to connect', { error: err.message });
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',  // gray
  info: '\x1b[36m',   // cyan
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
};
const RESET = '\x1b[0m';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

class Logger {
  private minLevel: LogLevel = 'info';
  private logDir: string | null = null;
  private fileStream: fs.WriteStream | null = null;

  /** Set minimum log level */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** Enable file logging to ./logs by default */
  enableFileLogging(baseDir?: string): void {
    this.fileStream?.end();
    const dir = baseDir ?? process.env['OFFICE_AGENT_LOG_DIR'] ?? path.join(process.cwd(), 'logs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.logDir = dir;
    const fileName = `agent-${new Date().toISOString().slice(0, 10)}.log`;
    this.fileStream = fs.createWriteStream(path.join(dir, fileName), { flags: 'a' });
  }

  /** Close file stream */
  close(): void {
    this.fileStream?.end();
    this.fileStream = null;
  }

  debug(message: string, data?: Record<string, unknown>, module = 'Agent'): void {
    this.log('debug', module, message, data);
  }

  info(message: string, data?: Record<string, unknown>, module = 'Agent'): void {
    this.log('info', module, message, data);
  }

  warn(message: string, data?: Record<string, unknown>, module = 'Agent'): void {
    this.log('warn', module, message, data);
  }

  error(message: string, data?: Record<string, unknown>, module = 'Agent'): void {
    this.log('error', module, message, data);
  }

  /** Create a child logger with a fixed module name */
  child(module: string): ModuleLogger {
    return new ModuleLogger(this, module);
  }

  private log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const safeData = data ? redact(data) as Record<string, unknown> : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      ...(safeData && Object.keys(safeData).length > 0 ? { data: safeData } : {}),
    };

    // Console output (colored)
    const time = entry.timestamp.slice(11, 19);
    const color = LEVEL_COLORS[level];
    const levelTag = level.toUpperCase().padEnd(5);
    const dataStr = safeData ? ` ${JSON.stringify(safeData)}` : '';
    console.log(`${color}${time} [${levelTag}] [${module}]${RESET} ${message}${dataStr}`);

    // File output (JSON lines)
    if (this.fileStream) {
      this.fileStream.write(JSON.stringify(entry) + '\n');
    }
  }
}

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/^(sk-|cli_|[A-Za-z0-9_-]{24,})/.test(value)) return redactString(value);
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (/secret|token|password|api[_-]?key|authorization/i.test(key)) {
      out[key] = '***REDACTED***';
    } else {
      out[key] = redact(val);
    }
  }
  return out;
}

function redactString(value: string): string {
  if (value.length <= 8) return '***REDACTED***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

class ModuleLogger {
  constructor(private parent: Logger, private module: string) {}
  debug(msg: string, data?: Record<string, unknown>): void { this.parent.debug(msg, data, this.module); }
  info(msg: string, data?: Record<string, unknown>): void { this.parent.info(msg, data, this.module); }
  warn(msg: string, data?: Record<string, unknown>): void { this.parent.warn(msg, data, this.module); }
  error(msg: string, data?: Record<string, unknown>): void { this.parent.error(msg, data, this.module); }
}

/** Global logger instance */
export const logger = new Logger();
