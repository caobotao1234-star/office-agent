import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ContextWikiCompiler } from '../../services/context-wiki-compiler.js';
import { OfficeContextStore } from '../../services/office-context-store.js';
import { WikiTool } from './index.js';

function createTool(): { tool: WikiTool; store: OfficeContextStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-tool-'));
  const store = new OfficeContextStore(path.join(dir, 'office-context.json'));
  const compiler = new ContextWikiCompiler(store, path.join(dir, 'wikidir'));
  return { tool: new WikiTool(compiler), store };
}

const ctx = { abortSignal: new AbortController().signal, userConfig: {} as never };

async function callTool(tool: WikiTool, input: unknown) {
  return tool.call(tool.inputSchema.parse(input), ctx);
}

describe('WikiTool', () => {
  it('compiles, lists, searches, and reads wiki pages', async () => {
    const { tool, store } = createTool();
    store.upsert({
      type: 'person',
      key: 'person:zhang-san',
      title: '张三',
      summary: 'Apollo 项目前端负责人。',
      source: 'manual',
    });

    const compiled = await callTool(tool, { action: 'compile' });
    expect(compiled.success).toBe(true);
    expect((compiled.output as any).pageCount).toBe(1);

    const listed = await callTool(tool, { action: 'list' });
    const pages = listed.output as Array<{ path: string; title: string }>;
    expect(pages[0]?.title).toBe('张三');

    const searched = await callTool(tool, { action: 'search', keyword: '前端' });
    expect(searched.success).toBe(true);
    expect(searched.output as any[]).toHaveLength(1);

    const read = await callTool(tool, { action: 'read', path: pages[0]!.path });
    expect(read.success).toBe(true);
    expect((read.output as any).content).toContain('Apollo');
  });

  it('fails when reading a missing page', async () => {
    const { tool } = createTool();
    const result = await callTool(tool, { action: 'read', path: 'missing.md' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
