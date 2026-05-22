import { describe, expect, it } from 'vitest';
import { getCommandKey, LarkCliTool, requiresWriteConfirmation } from './index.js';

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

  it('allows command-specific help for write-capable shortcuts', async () => {
    const tool = new LarkCliTool();
    const result = await tool.call(
      { args: ['docs', '+create', '--api-version', 'v2', '--help'], timeoutMs: 10_000, confirmed: false },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.output)).toContain('--content');
    expect(JSON.stringify(result.output)).toContain('--doc-format');
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

  it('requires help or dry-run before confirmed write commands', async () => {
    const tool = new LarkCliTool();
    const result = await tool.call(
      {
        args: ['docs', '+create', '--api-version', 'v2', '--doc-format', 'markdown', '--content', '<title>T</title>\nBody'],
        timeoutMs: 10_000,
        confirmed: true,
        reason: 'user asked to create a document',
      },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('必须先查看');
    expect(JSON.stringify(result.output)).toContain('--help');
  });

  it('derives stable command keys for shortcut commands', () => {
    expect(getCommandKey(['docs', '+create', '--api-version', 'v2', '--help'])).toBe('docs +create');
    expect(getCommandKey(['im', '+messages-send', '--chat-id', 'oc_x'])).toBe('im +messages-send');
    expect(getCommandKey(['api', 'POST', '/open-apis/foo', '--data', '{}'])).toBe('api POST /open-apis/foo');
  });

  it('classifies common read and write commands', () => {
    expect(requiresWriteConfirmation(['docs', '+fetch', '--url', 'https://example.com'])).toBe(false);
    expect(requiresWriteConfirmation(['schema', 'im.messages.create'])).toBe(false);
    expect(requiresWriteConfirmation(['sheets', '+write', '--spreadsheet-token', 'sht_x'])).toBe(true);
    expect(requiresWriteConfirmation(['sheets', '+write', '--spreadsheet-token', 'sht_x', '--dry-run'])).toBe(false);
  });
});
