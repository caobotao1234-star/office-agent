import { describe, expect, it } from 'vitest';
import { LarkCliTool, requiresWriteConfirmation } from './index.js';

describe('LarkCliTool', () => {
  it('allows read-only help commands', async () => {
    const tool = new LarkCliTool();
    const result = await tool.call(
      { args: ['--help'], timeoutMs: 10_000, confirmed: false },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.output)).toContain('lark-cli');
  });

  it('blocks side-effect commands without confirmation', async () => {
    const tool = new LarkCliTool();
    const result = await tool.call(
      { args: ['im', '+messages-send', '--chat-id', 'oc_xxx', '--text', 'hello'], timeoutMs: 10_000, confirmed: false },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('可能会修改飞书数据');
    expect(JSON.stringify(result.output)).toContain('--dry-run');
  });

  it('classifies common read and write commands', () => {
    expect(requiresWriteConfirmation(['docs', '+fetch', '--url', 'https://example.com'])).toBe(false);
    expect(requiresWriteConfirmation(['schema', 'im.messages.create'])).toBe(false);
    expect(requiresWriteConfirmation(['sheets', '+write', '--spreadsheet-token', 'sht_x'])).toBe(true);
    expect(requiresWriteConfirmation(['sheets', '+write', '--spreadsheet-token', 'sht_x', '--dry-run'])).toBe(false);
  });
});
