import { describe, expect, it } from 'vitest';
import { getCommandKey, LarkCliTool, requiresWriteGuidance, validateKnownCommand } from './index.js';

describe('LarkCliTool', () => {
  it('allows read-only help commands', async () => {
    const tool = new LarkCliTool();
    const result = await tool.call(
      { args: ['--help'], timeoutMs: 10_000 },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.output)).toContain('lark-cli');
  });

  it('allows command-specific help for write-capable shortcuts', async () => {
    const tool = new LarkCliTool();
    const result = await tool.call(
      { args: ['docs', '+create', '--api-version', 'v2', '--help'], timeoutMs: 10_000 },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.output)).toContain('--content');
    expect(JSON.stringify(result.output)).toContain('--doc-format');
  });

  it('requires command guidance before side-effect commands', async () => {
    const tool = new LarkCliTool();
    const result = await tool.call(
      { args: ['im', '+messages-send', '--chat-id', 'oc_xxx', '--text', 'hello'], timeoutMs: 10_000 },
      { abortSignal: new AbortController().signal, userConfig: {} as never },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('必须先查看');
    expect(JSON.stringify(result.output)).toContain('--dry-run');
  });

  it('requires help or dry-run before write commands', async () => {
    const tool = new LarkCliTool();
    const result = await tool.call(
      {
        args: ['docs', '+create', '--api-version', 'v2', '--doc-format', 'markdown', '--content', '<title>T</title>\nBody'],
        timeoutMs: 10_000,
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

  it('rejects known-bad docs v2 create flags that create empty or untitled docs', () => {
    expect(validateKnownCommand(['docs', '+create', '--api-version', 'v2', '--title', 'T', '--content', 'Body'])).toContain('--title');
    expect(validateKnownCommand(['docs', '+create', '--api-version', 'v2', '--doc-format', 'markdown', '--content', '# Body'])).toContain('<title>');
    expect(validateKnownCommand(['docs', '+create', '--api-version', 'v2', '--doc-format', 'markdown', '--content', '<title>T</title>\n# Body'])).toBeNull();
  });

  it('rejects known-bad Base shortcut flags before running lark-cli', () => {
    expect(validateKnownCommand(['base', '+create', '--title', 'T', '--dry-run'])).toContain('+base-create');
    expect(validateKnownCommand(['base', '+base-create', '--title', 'T', '--as', 'user', '--dry-run'])).toContain('--name');
    expect(validateKnownCommand(['base', '+base-create', '--name', 'T', '--format', 'json', '--dry-run'])).toContain('--format');
    expect(validateKnownCommand(['base', '+base-create', '--name', 'T', '--format=json', '--dry-run'])).toContain('--format');
    expect(validateKnownCommand(['base', '+table-create', '--base', 'base_x', '--name', 'T', '--dry-run'])).toContain('--base-token');
    expect(validateKnownCommand(['base', '+table-create', '--base-token', 'base_x', '--name', 'T', '--as', 'user', '--dry-run'])).toBeNull();
    expect(validateKnownCommand(['base', '+record-batch-create', '--base-token', 'base_x', '--table-id', 'tbl_x', '--records', '[]', '--dry-run'])).toContain('--json');
  });

  it('classifies common read and write commands', () => {
    expect(requiresWriteGuidance(['docs', '+fetch', '--url', 'https://example.com'])).toBe(false);
    expect(requiresWriteGuidance(['schema', 'im.messages.create'])).toBe(false);
    expect(requiresWriteGuidance(['sheets', '+write', '--spreadsheet-token', 'sht_x'])).toBe(true);
    expect(requiresWriteGuidance(['sheets', '+write', '--spreadsheet-token', 'sht_x', '--dry-run'])).toBe(false);
  });
});
