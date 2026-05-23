import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OfficeContextRecord, OfficeContextStore, OfficeContextType } from './office-context-store.js';
import { logger } from '../core/logger.js';

const log = logger.child('ContextWikiCompiler');

export interface WikiPageInfo {
  title: string;
  type: OfficeContextType;
  key: string;
  path: string;
  updatedAt: string;
}

export interface WikiCompileResult {
  wikiDir: string;
  indexPath: string;
  pageCount: number;
  compiledAt: string;
}

interface WikiManifest {
  compiledAt: string;
  pages: WikiPageInfo[];
}

const TYPE_DIRS: Record<OfficeContextType, string> = {
  person: 'people',
  project: 'projects',
  document: 'documents',
  meeting: 'meetings',
  task: 'tasks',
  business_process: 'processes',
  relationship: 'relationships',
  knowledge: 'knowledge',
  misc: 'misc',
};

export class ContextWikiCompiler {
  constructor(
    private store: OfficeContextStore,
    private wikiDir: string,
  ) {}

  compile(now = new Date()): WikiCompileResult {
    fs.mkdirSync(this.wikiDir, { recursive: true });
    for (const dir of Object.values(TYPE_DIRS)) {
      fs.mkdirSync(path.join(this.wikiDir, dir), { recursive: true });
    }

    const records = this.store.list();
    const pages = records.map((record) => this.writePage(record));
    const compiledAt = now.toISOString();
    this.writeIndex(pages, compiledAt);
    this.writeManifest({ compiledAt, pages });

    log.info('wiki compiled', { pageCount: pages.length, wikiDir: this.wikiDir });
    return {
      wikiDir: this.wikiDir,
      indexPath: path.join(this.wikiDir, 'index.md'),
      pageCount: pages.length,
      compiledAt,
    };
  }

  listPages(): WikiPageInfo[] {
    return this.loadManifest().pages;
  }

  readPage(pagePath: string): string | null {
    const normalized = normalizePagePath(pagePath);
    const fullPath = path.join(this.wikiDir, normalized);
    if (!fullPath.startsWith(this.wikiDir) || !fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  }

  search(keyword: string, limit = 10): Array<WikiPageInfo & { excerpt: string }> {
    const terms = keyword.toLowerCase().split(/[\s,，。;；:：/|]+/).filter(Boolean);
    if (terms.length === 0) return [];

    return this.listPages()
      .map((page) => {
        const content = this.readPage(page.path) ?? '';
        const haystack = `${page.title}\n${page.key}\n${content}`.toLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { page, score, content };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.page.updatedAt.localeCompare(a.page.updatedAt))
      .slice(0, limit)
      .map((item) => ({
        ...item.page,
        excerpt: excerpt(item.content, terms),
      }));
  }

  private writePage(record: OfficeContextRecord): WikiPageInfo {
    const dir = TYPE_DIRS[record.type];
    const filename = `${slugify(record.title)}-${shortHash(record.key)}.md`;
    const relativePath = `${dir}/${filename}`;
    const fullPath = path.join(this.wikiDir, relativePath);
    fs.writeFileSync(fullPath, renderRecordPage(record), 'utf-8');
    return {
      title: record.title,
      type: record.type,
      key: record.key,
      path: relativePath,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private writeIndex(pages: WikiPageInfo[], compiledAt: string): void {
    const byType = new Map<OfficeContextType, WikiPageInfo[]>();
    for (const page of pages) {
      const arr = byType.get(page.type) ?? [];
      arr.push(page);
      byType.set(page.type, arr);
    }

    const lines = ['# Office Agent Wiki', '', `_编译时间: ${compiledAt}_`, ''];
    for (const type of Object.keys(TYPE_DIRS) as OfficeContextType[]) {
      const typedPages = byType.get(type) ?? [];
      if (typedPages.length === 0) continue;
      lines.push(`## ${type}`, '');
      for (const page of typedPages.sort((a, b) => a.title.localeCompare(b.title))) {
        lines.push(`- [${page.title}](${page.path})`);
      }
      lines.push('');
    }
    lines.push('---', `共 ${pages.length} 个页面`);
    fs.writeFileSync(path.join(this.wikiDir, 'index.md'), lines.join('\n'), 'utf-8');
  }

  private writeManifest(manifest: WikiManifest): void {
    fs.writeFileSync(path.join(this.wikiDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  }

  private loadManifest(): WikiManifest {
    const manifestPath = path.join(this.wikiDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { compiledAt: '', pages: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as WikiManifest;
      return { compiledAt: parsed.compiledAt ?? '', pages: Array.isArray(parsed.pages) ? parsed.pages : [] };
    } catch {
      return { compiledAt: '', pages: [] };
    }
  }
}

function renderRecordPage(record: OfficeContextRecord): string {
  const lines = [
    `# ${record.title}`,
    '',
    '<!-- Generated by Office Agent ContextWikiCompiler. Edit source context instead of this page. -->',
    '',
    '## Summary',
    '',
    record.summary,
    '',
    '## Metadata',
    '',
    `- Type: ${record.type}`,
    `- Key: ${record.key}`,
    `- Status: ${record.status ?? 'unknown'}`,
    `- Confidence: ${record.confidence}`,
    `- Updated: ${record.updatedAt.toISOString()}`,
    `- Last seen: ${record.lastSeenAt.toISOString()}`,
  ];

  if (record.aliases.length > 0) lines.push(`- Aliases: ${record.aliases.join(', ')}`);
  if (record.tags.length > 0) lines.push(`- Tags: ${record.tags.join(', ')}`);
  if (record.projectId) lines.push(`- Project: ${record.projectId}`);

  if (record.relations.length > 0) {
    lines.push('', '## Relations', '');
    for (const relation of record.relations) {
      lines.push(`- ${relation.type}: ${relation.targetTitle ?? relation.targetKey ?? relation.targetId ?? 'unknown'}${relation.description ? ` — ${relation.description}` : ''}`);
    }
  }

  if (record.sourceRefs.length > 0) {
    lines.push('', '## Sources', '');
    for (const ref of record.sourceRefs) {
      const target = ref.url ? `[${ref.title ?? ref.url}](${ref.url})` : ref.title ?? ref.id ?? ref.type;
      lines.push(`- ${ref.type}: ${target}${ref.observedAt ? ` (${ref.observedAt.toISOString()})` : ''}`);
    }
  }

  if (Object.keys(record.metadata).length > 0) {
    lines.push('', '## Raw Metadata', '', '```json', JSON.stringify(record.metadata, null, 2), '```');
  }

  return `${lines.join('\n')}\n`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function normalizePagePath(pagePath: string): string {
  return pagePath.replace(/^\/+/, '').replace(/\.\.+/g, '.');
}

function excerpt(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  const first = terms
    .map((term) => lower.indexOf(term))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 80);
  const end = Math.min(content.length, first + 220);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}
