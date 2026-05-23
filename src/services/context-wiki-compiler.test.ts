import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OfficeContextStore } from './office-context-store.js';
import { ContextWikiCompiler } from './context-wiki-compiler.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'context-wiki-'));
}

describe('ContextWikiCompiler', () => {
  it('compiles office context records into markdown wiki pages', () => {
    const dir = tmpDir();
    const store = new OfficeContextStore(path.join(dir, 'office-context.json'));
    store.upsert({
      type: 'project',
      key: 'project:apollo',
      title: 'Apollo 项目',
      summary: '增长项目，当前需要推进 Base 自动化。',
      status: 'active',
      tags: ['growth'],
      relations: [{ type: 'owned_by', targetKey: 'person:zhang-san', targetTitle: '张三' }],
      sourceRefs: [{ type: 'feishu_doc', id: 'docx_1', title: 'Apollo 方案', url: 'https://example.feishu.cn/docx/docx_1' }],
      metadata: { contentHash: 'hash-1' },
      source: 'feishu_doc',
    }, new Date('2026-05-23T01:00:00.000Z'));

    const compiler = new ContextWikiCompiler(store, path.join(dir, 'wikidir'));
    const result = compiler.compile(new Date('2026-05-23T02:00:00.000Z'));

    expect(result.pageCount).toBe(1);
    expect(fs.existsSync(result.indexPath)).toBe(true);
    const pages = compiler.listPages();
    expect(pages).toHaveLength(1);
    expect(pages[0]?.path).toMatch(/^projects\//);

    const page = compiler.readPage(pages[0]!.path);
    expect(page).toContain('# Apollo 项目');
    expect(page).toContain('owned_by');
    expect(page).toContain('https://example.feishu.cn');
    expect(page).toContain('"contentHash": "hash-1"');
  });

  it('searches compiled wiki pages', () => {
    const dir = tmpDir();
    const store = new OfficeContextStore(path.join(dir, 'office-context.json'));
    store.upsert({
      type: 'business_process',
      key: 'process:release',
      title: '发布流程',
      summary: '上线前需要评审、灰度和回滚预案。',
      source: 'manual',
    });

    const compiler = new ContextWikiCompiler(store, path.join(dir, 'wikidir'));
    compiler.compile();

    const results = compiler.search('灰度');
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('发布流程');
    expect(results[0]?.excerpt).toContain('灰度');
  });

  it('returns null for missing pages', () => {
    const dir = tmpDir();
    const store = new OfficeContextStore(path.join(dir, 'office-context.json'));
    const compiler = new ContextWikiCompiler(store, path.join(dir, 'wikidir'));

    expect(compiler.readPage('missing.md')).toBeNull();
    expect(compiler.listPages()).toEqual([]);
  });
});
