import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { logger } from '../core/logger.js';

const log = logger.child('LarkCliKnowledgeBase');

const HelpEntrySchema = z.object({
  commandKey: z.string(),
  args: z.array(z.string()),
  help: z.string(),
  recordedAt: z.string(),
  cliVersion: z.string().optional(),
});

const CacheFileSchema = z.object({
  entries: z.array(HelpEntrySchema).default([]),
});

export interface LarkCliHelpEntry {
  commandKey: string;
  args: string[];
  help: string;
  recordedAt: Date;
  cliVersion?: string;
}

type SerializedHelpEntry = z.infer<typeof HelpEntrySchema>;

export class LarkCliKnowledgeBase {
  private entries = new Map<string, LarkCliHelpEntry>();

  constructor(
    private filePath = path.join(os.homedir(), '.office-agent', 'lark-cli-help-cache.json'),
    private maxHelpChars = 12_000,
  ) {
    this.load();
  }

  recordHelp(input: {
    commandKey: string;
    args: string[];
    help: string;
    cliVersion?: string;
    recordedAt?: Date;
  }): LarkCliHelpEntry {
    const help = input.help.trim();
    const entry: LarkCliHelpEntry = {
      commandKey: input.commandKey,
      args: [...input.args],
      help: help.length > this.maxHelpChars ? help.slice(0, this.maxHelpChars) : help,
      recordedAt: input.recordedAt ?? new Date(),
      ...(input.cliVersion ? { cliVersion: input.cliVersion } : {}),
    };
    this.entries.set(input.commandKey, entry);
    this.save();
    log.info('help cached', { commandKey: input.commandKey, helpLength: entry.help.length });
    return cloneEntry(entry);
  }

  get(commandKey: string): LarkCliHelpEntry | undefined {
    const entry = this.entries.get(commandKey);
    return entry ? cloneEntry(entry) : undefined;
  }

  summarize(commandKey: string, maxChars = 2_000): string | undefined {
    const entry = this.entries.get(commandKey);
    if (!entry) return undefined;
    const lines = entry.help
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim());
    const summary = lines.join('\n');
    return summary.length > maxChars ? `${summary.slice(0, maxChars)}\n...` : summary;
  }

  listKnownCommands(): string[] {
    return [...this.entries.keys()].sort();
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const entries = [...this.entries.values()].map(serializeEntry);
      fs.writeFileSync(this.filePath, JSON.stringify({ entries }, null, 2), 'utf-8');
    } catch (err) {
      log.error('save failed', { filePath: this.filePath, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = CacheFileSchema.parse(JSON.parse(fs.readFileSync(this.filePath, 'utf-8')));
      this.entries = new Map(parsed.entries.map((entry) => [entry.commandKey, deserializeEntry(entry)]));
      log.info('cache loaded', { filePath: this.filePath, count: this.entries.size });
    } catch (err) {
      log.warn('cache load failed', { filePath: this.filePath, error: err instanceof Error ? err.message : String(err) });
      this.entries = new Map();
    }
  }
}

function serializeEntry(entry: LarkCliHelpEntry): SerializedHelpEntry {
  return {
    commandKey: entry.commandKey,
    args: entry.args,
    help: entry.help,
    recordedAt: entry.recordedAt.toISOString(),
    cliVersion: entry.cliVersion,
  };
}

function deserializeEntry(entry: SerializedHelpEntry): LarkCliHelpEntry {
  return {
    commandKey: entry.commandKey,
    args: entry.args,
    help: entry.help,
    recordedAt: new Date(entry.recordedAt),
    ...(entry.cliVersion ? { cliVersion: entry.cliVersion } : {}),
  };
}

function cloneEntry(entry: LarkCliHelpEntry): LarkCliHelpEntry {
  return {
    ...entry,
    args: [...entry.args],
    recordedAt: new Date(entry.recordedAt),
  };
}
