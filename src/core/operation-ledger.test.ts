import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OperationLedger } from './operation-ledger.js';

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'operation-ledger-')), 'ledger.json');
}

describe('OperationLedger', () => {
  it('records a turn with tool results and formats debug summary', () => {
    const filePath = tmpFile();
    const ledger = new OperationLedger(filePath);
    const turnId = ledger.startTurn({
      userMessage: '创建飞书文档',
      imageCount: 1,
      model: 'qwen-vl-plus',
      now: new Date('2026-05-24T00:00:00.000Z'),
    });

    ledger.recordToolUse(turnId, 'LarkCli', { args: ['docs', '+create'] });
    ledger.recordToolResult(turnId, 'LarkCli', { success: false, output: null, error: 'missing --content' });
    ledger.finishTurn(turnId, { status: 'partial', finalText: '文档创建失败', now: new Date('2026-05-24T00:00:02.000Z') });

    const summary = ledger.formatLast();
    expect(summary).toContain('部分完成');
    expect(summary).toContain('LarkCli failed: missing --content');
    expect(summary).toContain('图片 1 张');

    const reloaded = new OperationLedger(filePath);
    expect(reloaded.getLast()?.turnId).toBe(turnId);
  });

  it('keeps only the newest entries', () => {
    const ledger = new OperationLedger(tmpFile(), 2);
    const first = ledger.startTurn({ userMessage: '1', model: 'm' });
    ledger.startTurn({ userMessage: '2', model: 'm' });
    ledger.startTurn({ userMessage: '3', model: 'm' });

    expect(ledger.list().map((entry) => entry.turnId)).not.toContain(first);
    expect(ledger.list()).toHaveLength(2);
  });
});
