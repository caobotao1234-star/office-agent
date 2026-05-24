import * as fs from 'node:fs';
import * as path from 'node:path';
import type { z } from 'zod';
import { logger } from '../core/logger.js';

const log = logger.child('JsonStore');

export interface ReadJsonOptions<T> {
  fallback: T;
  backupCorrupt?: boolean;
  label?: string;
}

export function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  options: ReadJsonOptions<T>,
): T {
  if (!fs.existsSync(filePath)) return options.fallback;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return schema.parse(JSON.parse(raw));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('read failed', { filePath, label: options.label, error: message });
    if (options.backupCorrupt !== false) {
      backupCorruptJson(filePath);
    }
    return options.fallback;
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(value, null, 2);
  fs.writeFileSync(tmpPath, payload, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function backupCorruptJson(filePath: string, now = new Date()): string | null {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.corrupt-${formatTimestamp(now)}.bak`;
  try {
    fs.copyFileSync(filePath, backupPath);
    log.warn('corrupt json backed up', { filePath, backupPath });
    return backupPath;
  } catch (err) {
    log.error('backup failed', { filePath, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
