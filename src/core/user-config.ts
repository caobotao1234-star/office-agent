/**
 * UserConfigManager — Load, save, update user configuration.
 *
 * Persists to ~/.office-agent/config.json
 * Supports default config, partial updates, and full data deletion.
 *
 * Requirements: 12.1, 12.3, 13.3, 13.5
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { UserConfig } from '../types/index.js';

const BASE_DIR = path.join(os.homedir(), '.office-agent');
const CONFIG_FILE = path.join(BASE_DIR, 'config.json');

export class UserConfigManager {
  private configPath: string;
  private baseDir: string;
  private config: UserConfig;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? BASE_DIR;
    this.configPath = path.join(this.baseDir, 'config.json');
    this.config = UserConfigManager.getDefault();
  }

  /** Return the default configuration. */
  static getDefault(): UserConfig {
    return {
      workingHours: {
        start: '09:00',
        end: '18:00',
        workDays: [1, 2, 3, 4, 5],
      },
      reminder: {
        dailyBriefingTime: '09:00',
        weeklySummaryDay: 5,
        weeklySummaryTime: '17:00',
        intensity: 'standard',
      },
      awaySummary: {
        thresholdMinutes: 15,
      },
      feishu: {
        enabled: false,
      },
      enabledTools: [
        'TaskManager',
        'ReminderTool',
        'MemoryTool',
        'CronTool',
        'BackgroundTaskTool',
      ],
      smartReminder: {
        staleProjectDays: 7,
      },
      timezone: 'Asia/Shanghai',
    };
  }

  /** Load config from disk. Falls back to defaults if file doesn't exist or is invalid. */
  load(): UserConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<UserConfig>;
        this.config = { ...UserConfigManager.getDefault(), ...parsed };
      }
    } catch {
      // Corrupted config — use defaults
      this.config = UserConfigManager.getDefault();
    }
    return this.config;
  }

  /** Save current config to disk. */
  save(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  /** Partially update config and persist. */
  update(updates: Partial<UserConfig>): UserConfig {
    this.config = deepMerge(this.config, updates);
    this.save();
    return this.config;
  }

  /** Get the current in-memory config. */
  get(): UserConfig {
    return this.config;
  }

  /**
   * Delete all user data under ~/.office-agent/.
   * This is irreversible — all memories, tasks, config, and sessions are removed.
   */
  deleteAllData(): void {
    if (fs.existsSync(this.baseDir)) {
      fs.rmSync(this.baseDir, { recursive: true, force: true });
    }
  }
}

// ============================================================
// Deep merge helper
// ============================================================

function deepMerge(target: UserConfig, source: Partial<UserConfig>): UserConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = { ...target };
  const src = source as Record<string, unknown>;
  const tgt = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    const srcVal = src[key];
    const tgtVal = tgt[key];
    if (
      srcVal !== null &&
      srcVal !== undefined &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal) &&
      tgtVal !== null
    ) {
      result[key] = { ...(tgtVal as Record<string, unknown>), ...(srcVal as Record<string, unknown>) };
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result as UserConfig;
}
