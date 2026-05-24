import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FeishuSyncKnowledgeCapture, extractDurableSnippets } from './feishu-sync-knowledge-capture.js';
import { OfficeContextStore } from './office-context-store.js';
import type { FeishuSyncSource } from './feishu-sync-store.js';
import type { LarkCliRunResult } from './lark-cli-runner.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-sync-capture-'));
}

describe('FeishuSyncKnowledgeCapture', () => {
  it('extracts durable decision, risk, owner, and time snippets', () => {
    const snippets = extractDurableSnippets([
      '决定采用 qwen-vl-plus 处理图片输入',
      '风险：飞书 Base 字段参数容易写错',
      '张三负责 Apollo 前端',
      '5月30日前完成客户演示材料',
    ].join('\n'));

    expect(snippets.map((item) => item.type)).toEqual(['knowledge', 'knowledge', 'relationship', 'task']);
  });

  it('writes extracted snippets into office context', () => {
    const dir = tmpDir();
    const store = new OfficeContextStore(path.join(dir, 'office-context.json'));
    const capture = new FeishuSyncKnowledgeCapture(store);
    const source: FeishuSyncSource = {
      id: 'source-1',
      type: 'doc',
      title: 'Apollo 方案',
      args: ['docs', '+fetch'],
      tags: ['apollo'],
      syncEnabled: true,
      createdAt: new Date('2026-05-24T00:00:00.000Z'),
      updatedAt: new Date('2026-05-24T00:00:00.000Z'),
      lastSyncedAt: new Date('2026-05-24T00:00:00.000Z'),
    };
    const result: LarkCliRunResult = {
      command: 'lark-cli docs +fetch',
      args: ['docs', '+fetch'],
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      aborted: false,
      truncated: false,
    };

    const output = capture.capture({
      source,
      result,
      content: '结论：本周先完成灰度发布\n李四负责上线验证',
      contentHash: 'hash-1',
    });

    expect(output.contexts).toBe(2);
    expect(store.search({ tags: ['auto-capture'] })).toHaveLength(2);
  });
});
