import { describe, expect, it } from 'vitest';
import { runLarkCli } from './lark-cli-runner.js';

describe('lark-cli runner', () => {
  it('runs the bundled lark-cli help command', async () => {
    const result = await runLarkCli(['--help'], { timeoutMs: 10_000 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('lark-cli');
    expect(result.command).toContain('lark-cli --help');
  });

  it('returns a non-zero result for an unknown command', async () => {
    const result = await runLarkCli(['definitely-not-a-real-command'], { timeoutMs: 10_000 });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('unknown command');
  });
});
