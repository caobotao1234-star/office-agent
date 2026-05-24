import { describe, it, expect } from 'vitest';
import {
  isSlashCommand,
  parseSlashCommand,
  resolveCommand,
  COMMAND_MAP,
} from './slash-command.js';

describe('isSlashCommand', () => {
  it('returns true for valid slash commands', () => {
    expect(isSlashCommand('/tasks')).toBe(true);
    expect(isSlashCommand('/daily-report')).toBe(true);
    expect(isSlashCommand('/task-breakdown "arg"')).toBe(true);
    expect(isSlashCommand('  /remind 3pm')).toBe(true);
  });

  it('returns false for non-commands', () => {
    expect(isSlashCommand('hello')).toBe(false);
    expect(isSlashCommand('/ space')).toBe(false);
    expect(isSlashCommand('/123')).toBe(false);
    expect(isSlashCommand('')).toBe(false);
  });
});

describe('parseSlashCommand', () => {
  it('parses a simple command with no args', () => {
    const result = parseSlashCommand('/tasks');
    expect(result).toEqual({ command: 'tasks', rawArgs: '', args: [] });
  });

  it('parses a command with plain args', () => {
    const result = parseSlashCommand('/remind 下午3点开会');
    expect(result).toEqual({
      command: 'remind',
      rawArgs: '下午3点开会',
      args: ['下午3点开会'],
    });
  });

  it('parses a command with quoted args', () => {
    const result = parseSlashCommand('/task-breakdown "完成Q2产品规划"');
    expect(result).toEqual({
      command: 'task-breakdown',
      rawArgs: '"完成Q2产品规划"',
      args: ['完成Q2产品规划'],
    });
  });

  it('parses multiple arguments', () => {
    const result = parseSlashCommand('/project Q2 high');
    expect(result).toEqual({
      command: 'project',
      rawArgs: 'Q2 high',
      args: ['Q2', 'high'],
    });
  });

  it('handles mixed quoted and unquoted args', () => {
    const result = parseSlashCommand('/remind "每天早上9点" daily');
    expect(result!.args).toEqual(['每天早上9点', 'daily']);
  });

  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello world')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
  });

  it('trims leading whitespace', () => {
    const result = parseSlashCommand('  /tasks');
    expect(result!.command).toBe('tasks');
  });
});

describe('resolveCommand', () => {
  it('resolves known tool commands', () => {
    expect(resolveCommand('tasks')).toEqual({ type: 'tool', target: 'TaskManager' });
    expect(resolveCommand('remind')).toEqual({ type: 'tool', target: 'AgendaTool' });
    expect(resolveCommand('agenda')).toEqual({ type: 'tool', target: 'AgendaTool' });
    expect(resolveCommand('sync')).toEqual({ type: 'builtin', target: 'sync' });
    expect(resolveCommand('wiki')).toEqual({ type: 'builtin', target: 'wiki' });
    expect(resolveCommand('debug')).toEqual({ type: 'builtin', target: 'debug' });
  });

  it('resolves known skill commands', () => {
    expect(resolveCommand('daily-report')).toEqual({ type: 'skill', target: 'report' });
    expect(resolveCommand('task-breakdown')).toEqual({ type: 'skill', target: 'task-breakdown' });
    expect(resolveCommand('report')).toEqual({ type: 'skill', target: 'report' });
  });

  it('returns undefined for unknown commands', () => {
    expect(resolveCommand('unknown')).toBeUndefined();
    expect(resolveCommand('')).toBeUndefined();
  });

  it('covers all entries in COMMAND_MAP', () => {
    for (const [cmd, mapping] of Object.entries(COMMAND_MAP)) {
      expect(resolveCommand(cmd)).toEqual(mapping);
    }
  });
});
