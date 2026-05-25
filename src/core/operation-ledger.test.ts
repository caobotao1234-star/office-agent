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

  it('builds a resume prompt from the latest recoverable turn', () => {
    const ledger = new OperationLedger(tmpFile());
    const completed = ledger.startTurn({ userMessage: '已完成任务', model: 'm', now: new Date('2026-05-24T00:00:00.000Z') });
    ledger.recordToolUse(completed, 'TaskManager', { action: 'list' });
    ledger.recordToolResult(completed, 'TaskManager', { success: true, output: [] });
    ledger.finishTurn(completed, { status: 'completed', finalText: '完成', now: new Date('2026-05-24T00:00:01.000Z') });

    const failed = ledger.startTurn({ userMessage: '创建飞书 Base 并写入能力表', model: 'qwen-plus', now: new Date('2026-05-24T00:01:00.000Z') });
    ledger.recordToolUse(failed, 'LarkCli', { args: ['base', '+base-create', '--name', '能力表'] });
    ledger.recordToolResult(failed, 'LarkCli', { success: false, output: { stderr: 'unexpected EOF' }, error: 'lark-cli 退出码 1' });
    ledger.finishTurn(failed, { status: 'partial', finalText: 'Base 创建失败', now: new Date('2026-05-24T00:01:02.000Z') });

    const prompt = ledger.formatResumePrompt('先检查是否已经创建');

    expect(ledger.getLastRecoverable()?.turnId).toBe(failed);
    expect(prompt).toContain('继续完成上一轮');
    expect(prompt).toContain('创建飞书 Base');
    expect(prompt).toContain('不要重复已经 success 的非幂等写操作');
    expect(prompt).toContain('先检查是否已经创建');
  });

  it('returns null when there is no recoverable turn', () => {
    const ledger = new OperationLedger(tmpFile());
    const turnId = ledger.startTurn({ userMessage: '列任务', model: 'm' });
    ledger.finishTurn(turnId, { status: 'completed', finalText: '无任务' });

    expect(ledger.getLastRecoverable()).toBeUndefined();
    expect(ledger.formatResumePrompt()).toBeNull();
  });
});
