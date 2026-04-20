/**
 * WikiEngine — 持久化知识 Wiki（参考 Karpathy LLMwiki 设计）
 *
 * 在 memdir（零散记忆条目）之上维护一层结构化的 wiki：
 * - 项目页：每个项目的综合知识页，持续更新
 * - 人物页：同事、供应商、对接人信息汇总
 * - 概念页：技术概念、方案、选型的知识积累
 * - 决策页：重要决策的演变历史
 * - index.md：知识导航索引
 * - log.md：变更日志
 *
 * 核心区别于 memdir：wiki 页面是"编译后的知识"，
 * 新信息进来时整合到已有页面，而不是新建一条独立记忆。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from './logger.js';
import type { LLMClient } from './llm-client.js';
import type { MemoryEntry } from '../types/index.js';

const log = logger.child('WikiEngine');

export type WikiPageType = 'project' | 'person' | 'concept' | 'decision' | 'general';

interface WikiPageMeta {
  title: string;
  type: WikiPageType;
  tags: string[];
  lastUpdated: string;
  sourceCount: number;
}

export class WikiEngine {
  private wikiDir: string;
  private llm: LLMClient | undefined;

  constructor(baseDir: string, llm?: LLMClient) {
    // wikidir sits alongside memdir
    this.wikiDir = path.join(baseDir, '..', 'wikidir');
    this.llm = llm;
    this.ensureStructure();
  }

  private ensureStructure(): void {
    const dirs = ['projects', 'people', 'concepts', 'decisions', 'general'];
    for (const d of dirs) {
      const dir = path.join(this.wikiDir, d);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    // Create index if not exists
    if (!fs.existsSync(this.indexPath)) {
      fs.writeFileSync(this.indexPath, '# 知识库索引\n\n_暂无内容，随着对话积累会自动生成。_\n', 'utf-8');
    }
    // Create log if not exists
    if (!fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, '# 知识库变更日志\n\n', 'utf-8');
    }
  }

  private get indexPath(): string { return path.join(this.wikiDir, 'index.md'); }
  private get logPath(): string { return path.join(this.wikiDir, 'log.md'); }

  private dirForType(type: WikiPageType): string {
    const map: Record<WikiPageType, string> = {
      project: 'projects', person: 'people', concept: 'concepts',
      decision: 'decisions', general: 'general',
    };
    return path.join(this.wikiDir, map[type]);
  }

  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'untitled';
  }

  /**
   * 当新记忆存入时调用，判断是否需要更新 wiki 页面。
   * 这是 LLMwiki 的核心：新信息整合到已有知识结构中。
   */
  async onMemoryStored(entry: MemoryEntry): Promise<void> {
    if (!this.llm) return;

    // Determine which wiki page type this memory maps to
    const pageType = this.memoryTypeToWikiType(entry.type);
    const pageTitle = this.extractPageTitle(entry);
    if (!pageTitle) return;

    const slug = this.slugify(pageTitle);
    const dir = this.dirForType(pageType);
    const filePath = path.join(dir, `${slug}.md`);

    try {
      if (fs.existsSync(filePath)) {
        // Page exists — integrate new info
        await this.updatePage(filePath, pageTitle, pageType, entry);
      } else {
        // New page — create it
        await this.createPage(filePath, pageTitle, pageType, entry);
      }

      this.updateIndex();
      this.appendLog('update', pageTitle, entry.title);
    } catch (err) {
      log.debug('Wiki update failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private memoryTypeToWikiType(memType: string): WikiPageType {
    switch (memType) {
      case 'project_context': return 'project';
      case 'colleague': return 'person';
      case 'decision': return 'decision';
      case 'preference': return 'general';
      case 'commitment': return 'general';
      default: return 'concept';
    }
  }

  private extractPageTitle(entry: MemoryEntry): string | null {
    // Try to extract a meaningful entity name from tags or title
    // For project_context, use the first project-like tag
    if (entry.tags.length > 0) {
      return entry.tags[0]!;
    }
    // Fall back to a cleaned version of the title
    const cleaned = entry.title.replace(/[：:]/g, ' ').split(/\s+/).slice(0, 3).join(' ');
    return cleaned || null;
  }

  private async createPage(
    filePath: string,
    title: string,
    type: WikiPageType,
    entry: MemoryEntry,
  ): Promise<void> {
    const typeLabel = { project: '项目', person: '人物', concept: '概念', decision: '决策', general: '综合' }[type];

    if (this.llm) {
      const controller = new AbortController();
      const response = await this.llm.query(
        `你是一个知识库维护助手。请为以下信息创建一个${typeLabel}知识页面。\n` +
        '用 Markdown 格式，包含：\n' +
        '1. 标题（# 开头）\n' +
        '2. 简要概述（2-3句话）\n' +
        '3. 关键信息（用列表）\n' +
        '4. 相关标签\n\n' +
        '保持简洁，后续会持续更新。',
        `标题: ${title}\n类型: ${typeLabel}\n信息: ${entry.title} — ${entry.content}\n标签: ${entry.tags.join(', ')}`,
        controller.signal,
      );
      fs.writeFileSync(filePath, response, 'utf-8');
    } else {
      // No LLM — simple template
      const content = [
        `# ${title}`,
        '',
        `> 类型: ${typeLabel} | 创建: ${new Date().toISOString().slice(0, 10)}`,
        '',
        `## 信息`,
        '',
        `- ${entry.title}: ${entry.content}`,
        '',
        `## 标签`,
        '',
        entry.tags.map(t => `- ${t}`).join('\n'),
        '',
      ].join('\n');
      fs.writeFileSync(filePath, content, 'utf-8');
    }

    log.debug('Wiki page created', { title, type });
  }

  private async updatePage(
    filePath: string,
    title: string,
    type: WikiPageType,
    entry: MemoryEntry,
  ): Promise<void> {
    const existing = fs.readFileSync(filePath, 'utf-8');

    if (this.llm) {
      const controller = new AbortController();
      const response = await this.llm.query(
        '你是一个知识库维护助手。以下是一个已有的知识页面，现在有新信息需要整合进去。\n' +
        '规则：\n' +
        '1. 保留已有内容的结构\n' +
        '2. 将新信息整合到合适的位置（不是简单追加）\n' +
        '3. 如果新信息与已有内容矛盾，以新信息为准并标注更新\n' +
        '4. 保持简洁，不要重复\n' +
        '5. 返回完整的更新后页面（Markdown 格式）',
        `已有页面:\n${existing.slice(0, 2000)}\n\n新信息:\n${entry.title} — ${entry.content}\n标签: ${entry.tags.join(', ')}`,
        controller.signal,
      );
      fs.writeFileSync(filePath, response, 'utf-8');
    } else {
      // No LLM — simple append
      const appendix = `\n- [${new Date().toISOString().slice(0, 10)}] ${entry.title}: ${entry.content}\n`;
      fs.appendFileSync(filePath, appendix, 'utf-8');
    }

    log.debug('Wiki page updated', { title, type });
  }

  /** Rebuild the index.md from all wiki pages */
  private updateIndex(): void {
    const categories: Record<string, Array<{ name: string; path: string }>> = {};
    const typeLabels: Record<string, string> = {
      projects: '📁 项目', people: '👤 人物', concepts: '💡 概念',
      decisions: '⚖️ 决策', general: '📝 综合',
    };

    for (const subdir of ['projects', 'people', 'concepts', 'decisions', 'general']) {
      const dir = path.join(this.wikiDir, subdir);
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      if (files.length === 0) continue;

      categories[subdir] = files.map(f => {
        const content = fs.readFileSync(path.join(dir, f), 'utf-8');
        const titleMatch = content.match(/^#\s+(.+)/m);
        return {
          name: titleMatch?.[1] ?? f.replace('.md', ''),
          path: `${subdir}/${f}`,
        };
      });
    }

    const lines = ['# 知识库索引', '', `_最后更新: ${new Date().toISOString().slice(0, 19)}_`, ''];

    for (const [subdir, pages] of Object.entries(categories)) {
      const label = typeLabels[subdir] ?? subdir;
      lines.push(`## ${label}`, '');
      for (const p of pages) {
        lines.push(`- [${p.name}](${p.path})`);
      }
      lines.push('');
    }

    const totalPages = Object.values(categories).reduce((s, arr) => s + arr.length, 0);
    lines.push(`---`, `共 ${totalPages} 个知识页面`);

    fs.writeFileSync(this.indexPath, lines.join('\n'), 'utf-8');
  }

  private appendLog(action: string, page: string, detail: string): void {
    const timestamp = new Date().toISOString().slice(0, 19);
    const entry = `## [${timestamp}] ${action} | ${page}\n\n${detail}\n\n`;
    fs.appendFileSync(this.logPath, entry, 'utf-8');
  }

  /** Load the wiki index for injection into system prompt */
  loadIndex(): string | null {
    if (!fs.existsSync(this.indexPath)) return null;
    const content = fs.readFileSync(this.indexPath, 'utf-8');
    return content.includes('暂无内容') ? null : content;
  }

  /** Read a specific wiki page */
  readPage(pagePath: string): string | null {
    const fullPath = path.join(this.wikiDir, pagePath);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  }

  /** List all wiki pages */
  listPages(): Array<{ title: string; type: string; path: string }> {
    const pages: Array<{ title: string; type: string; path: string }> = [];
    for (const subdir of ['projects', 'people', 'concepts', 'decisions', 'general']) {
      const dir = path.join(this.wikiDir, subdir);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        const content = fs.readFileSync(path.join(dir, f), 'utf-8');
        const titleMatch = content.match(/^#\s+(.+)/m);
        pages.push({
          title: titleMatch?.[1] ?? f.replace('.md', ''),
          type: subdir,
          path: `${subdir}/${f}`,
        });
      }
    }
    return pages;
  }

  /** Run a lint pass — find issues in the wiki */
  async lint(): Promise<string[]> {
    const issues: string[] = [];
    const pages = this.listPages();

    if (pages.length === 0) {
      return ['知识库为空，暂无需要检查的内容。'];
    }

    // Check for orphan pages (no inbound links)
    const allContent = pages.map(p => this.readPage(p.path) ?? '').join('\n');
    for (const p of pages) {
      const linkPattern = p.path.replace('.md', '');
      if (!allContent.includes(linkPattern) && !allContent.includes(p.title)) {
        issues.push(`孤立页面: ${p.title} (${p.path}) — 没有其他页面链接到它`);
      }
    }

    // Check for very short pages (might need enrichment)
    for (const p of pages) {
      const content = this.readPage(p.path) ?? '';
      if (content.length < 100) {
        issues.push(`内容过少: ${p.title} — 只有 ${content.length} 字符，可能需要补充`);
      }
    }

    return issues;
  }
}
