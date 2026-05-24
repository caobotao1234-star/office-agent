import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LarkCliKnowledgeBase } from './lark-cli-knowledge-base.js';

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lark-cli-kb-')), 'cache.json');
}

describe('LarkCliKnowledgeBase', () => {
  it('records, summarizes, and reloads command help', () => {
    const filePath = tmpFile();
    const kb = new LarkCliKnowledgeBase(filePath);
    kb.recordHelp({
      commandKey: 'docs +create',
      args: ['docs', '+create', '--help'],
      help: 'Usage:\n  lark-cli docs +create\n\nFlags:\n  --content string\n  --doc-format string',
      recordedAt: new Date('2026-05-24T00:00:00.000Z'),
    });

    expect(kb.listKnownCommands()).toEqual(['docs +create']);
    expect(kb.summarize('docs +create')).toContain('--content string');

    const reloaded = new LarkCliKnowledgeBase(filePath);
    expect(reloaded.get('docs +create')?.recordedAt.toISOString()).toBe('2026-05-24T00:00:00.000Z');
  });

  it('ignores corrupt cache files', () => {
    const filePath = tmpFile();
    fs.writeFileSync(filePath, '{ bad json', 'utf-8');
    const kb = new LarkCliKnowledgeBase(filePath);
    expect(kb.listKnownCommands()).toEqual([]);
  });
});
