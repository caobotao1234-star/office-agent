/**
 * Slash Command Parser — Parses /command style inputs into structured results.
 *
 * Supports commands like:
 *   /tasks
 *   /remind 下午3点开会
 *   /project Q2规划
 *   /daily-report
 *   /task-breakdown "完成Q2产品规划"
 */

// ============================================================
// Types
// ============================================================

export interface SlashCommandResult {
  /** The command name without the leading slash (e.g. "tasks") */
  command: string;
  /** Raw argument string after the command (empty string if none) */
  rawArgs: string;
  /** Parsed positional arguments (handles quoted strings) */
  args: string[];
}

/** Known commands and their mapping to tool/skill names */
export const COMMAND_MAP: Record<string, { type: 'tool' | 'skill' | 'builtin'; target: string }> = {
  tasks: { type: 'tool', target: 'TaskManager' },
  remind: { type: 'tool', target: 'AgendaTool' },
  agenda: { type: 'tool', target: 'AgendaTool' },
  project: { type: 'tool', target: 'SubAgentTool' },
  memory: { type: 'tool', target: 'MemoryTool' },
  cron: { type: 'tool', target: 'CronTool' },
  'daily-report': { type: 'skill', target: 'report' },
  'weekly-report': { type: 'skill', target: 'report' },
  'monthly-report': { type: 'skill', target: 'report' },
  'project-report': { type: 'skill', target: 'report' },
  'report': { type: 'skill', target: 'report' },
  'meeting-notes': { type: 'skill', target: 'meeting-notes' },
  'task-breakdown': { type: 'skill', target: 'task-breakdown' },
  'feishu-sync': { type: 'skill', target: 'feishu-sync' },
  'dev-workflow': { type: 'skill', target: 'dev-workflow' },
  'meeting': { type: 'skill', target: 'meeting-full' },
  'okr': { type: 'skill', target: 'okr-tracking' },
  'draft': { type: 'skill', target: 'draft-message' },
  'memory-review': { type: 'skill', target: 'memory-review' },
  'decision': { type: 'skill', target: 'decision-log' },
  'retro': { type: 'skill', target: 'retrospective' },
  'retrospective': { type: 'skill', target: 'retrospective' },
  // Builtin commands — handled directly by the agent, not routed to LLM
  usage: { type: 'builtin', target: 'usage' },
  token: { type: 'builtin', target: 'usage' },
  tokens: { type: 'builtin', target: 'usage' },
  stats: { type: 'builtin', target: 'stats' },
  debug: { type: 'builtin', target: 'debug' },
  resume: { type: 'builtin', target: 'resume' },
  sync: { type: 'builtin', target: 'sync' },
  wiki: { type: 'builtin', target: 'wiki' },
  help: { type: 'builtin', target: 'help' },
  db: { type: 'builtin', target: 'db' },
  reset: { type: 'builtin', target: 'reset' },
  undo: { type: 'builtin', target: 'undo' },
};

// ============================================================
// Parser
// ============================================================

/**
 * Check whether a string looks like a slash command.
 */
export function isSlashCommand(input: string): boolean {
  return /^\/[a-zA-Z][\w-]*/.test(input.trim());
}

/**
 * Parse a slash command string into a structured result.
 * Returns null if the input is not a valid slash command.
 */
export function parseSlashCommand(input: string): SlashCommandResult | null {
  const trimmed = input.trim();
  if (!isSlashCommand(trimmed)) return null;

  // Extract command name
  const match = trimmed.match(/^\/([a-zA-Z][\w-]*)\s*(.*)/s);
  if (!match) return null;

  const command = match[1]!;
  const rawArgs = (match[2] ?? '').trim();
  const args = parseArgs(rawArgs);

  return { command, rawArgs, args };
}

/**
 * Resolve a parsed command to its tool/skill mapping.
 * Returns undefined for unknown commands.
 */
export function resolveCommand(command: string): { type: 'tool' | 'skill' | 'builtin'; target: string } | undefined {
  return COMMAND_MAP[command];
}

// ============================================================
// Argument parsing (handles quoted strings)
// ============================================================

function parseArgs(raw: string): string[] {
  if (!raw) return [];

  const args: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;

    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null; // close quote
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) args.push(current);
  return args;
}
