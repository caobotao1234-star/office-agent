import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferWriteCommandKey, OperationIdempotencyLedger } from './operation-idempotency-ledger.js';

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-write-ledger-')), 'write-ledger.json');
}

describe('OperationIdempotencyLedger', () => {
  it('records write start and finish with resource refs', () => {
    const filePath = tmpFile();
    const ledger = new OperationIdempotencyLedger(filePath);
    const id = ledger.start({
      turnId: 'turn_1',
      toolName: 'LarkCli',
      commandKey: 'docs +create',
      input: { args: ['docs', '+create', '--content', '-'], stdin: '<title>T</title>' },
      now: new Date('2026-05-26T00:00:00.000Z'),
    });

    ledger.finish(id, {
      success: true,
      output: {
        data: {
          docx_token: 'docx_1',
          url: 'https://example.feishu.cn/docx/docx_1',
        },
      },
    }, new Date('2026-05-26T00:00:01.000Z'));

    const entry = ledger.list()[0]!;
    expect(entry.status).toBe('succeeded');
    expect(entry.turnId).toBe('turn_1');
    expect(entry.commandKey).toBe('docs +create');
    expect(entry.resourceRefs.join('\n')).toContain('docx_token=docx_1');
    expect(entry.finishedAt?.toISOString()).toBe('2026-05-26T00:00:01.000Z');

    const reloaded = new OperationIdempotencyLedger(filePath);
    expect(reloaded.list()[0]?.signature).toBe(entry.signature);
  });

  it('records failures and trims old entries', () => {
    const ledger = new OperationIdempotencyLedger(tmpFile(), 2);
    const first = ledger.start({ toolName: 'A', input: { a: 1 }, now: new Date('2026-05-26T00:00:00.000Z') });
    ledger.finish(first, { success: false, output: null, error: 'boom' });
    ledger.start({ toolName: 'B', input: { b: 2 }, now: new Date('2026-05-26T00:00:01.000Z') });
    ledger.start({ toolName: 'C', input: { c: 3 }, now: new Date('2026-05-26T00:00:02.000Z') });

    const entries = ledger.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.toolName)).toEqual(['B', 'C']);
  });

  it('infers lark-cli command keys for write ledger records', () => {
    expect(inferWriteCommandKey('LarkCli', { args: ['--profile', 'alice', 'base', '+base-create', '--name', 'T'] })).toBe('base +base-create');
    expect(inferWriteCommandKey('LarkCli', { args: ['api', 'POST', '/open-apis/foo', '--data', '{}'] })).toBe('api POST /open-apis/foo');
    expect(inferWriteCommandKey('OtherTool', { args: ['base', '+base-create'] })).toBeUndefined();
  });
});
