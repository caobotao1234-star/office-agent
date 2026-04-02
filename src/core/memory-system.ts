/**
 * Memory System - Persistent memory storage with Markdown + YAML frontmatter
 * Reference: Claude Code's memdir module
 *
 * Memories are stored as individual Markdown files under ~/.office-agent/memdir/
 * organised by type into subdirectories:
 *   preferences/ | projects/ | colleagues/ | decisions/ | auto/
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MemoryEntry, MemoryQuery, MemoryType, MemorySource, Message } from '../types/index.js';
import type { LLMClient } from './llm-client.js';

// ============================================================
// Constants
// ============================================================

const BASE_DIR = path.join(
  process.env['HOME'] ?? process.env['USERPROFILE'] ?? '.',
  '.office-agent',
  'memdir',
);

/** Map MemoryType → subdirectory name */
const TYPE_DIR_MAP: Record<MemoryType, string> = {
  preference: 'preferences',
  task: 'auto',
  project_context: 'projects',
  colleague: 'colleagues',
  conversation_summary: 'auto',
  decision: 'decisions',
  commitment: 'auto',
};

// ============================================================
// Frontmatter helpers (no external YAML lib)
// ============================================================

function serializeFrontmatter(entry: MemoryEntry): string {
  const lines: string[] = ['---'];
  lines.push(`title: "${escapeFmString(entry.title)}"`);
  lines.push(`type: ${entry.type}`);
  lines.push(`tags: [${entry.tags.map((t) => escapeFmString(t)).join(', ')}]`);
  lines.push(`source: ${entry.source}`);
  if (entry.projectId) {
    lines.push(`project: ${entry.projectId}`);
  }
  lines.push(`created: ${entry.createdAt.toISOString()}`);
  lines.push(`updated: ${entry.updatedAt.toISOString()}`);
  lines.push(`access_count: ${entry.accessCount}`);
  lines.push(`last_accessed: ${entry.lastAccessedAt.toISOString()}`);
  lines.push('---');
  lines.push('');
  lines.push(entry.content);
  return lines.join('\n');
}

function escapeFmString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const meta: Record<string, string> = {};
  let content = raw;

  if (!raw.startsWith('---')) return { meta, content };

  const endIdx = raw.indexOf('\n---', 3);
  if (endIdx === -1) return { meta, content };

  const fmBlock = raw.slice(4, endIdx); // skip leading "---\n"
  content = raw.slice(endIdx + 4).replace(/^\n/, ''); // skip closing "---\n"

  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    meta[key] = value;
  }

  return { meta, content };
}

function parseTags(raw: string): string[] {
  // Expect format: [tag1, tag2, tag3]
  const inner = raw.replace(/^\[/, '').replace(/]$/, '').trim();
  if (!inner) return [];
  return inner.split(',').map((t) => t.trim()).filter(Boolean);
}

function metaToEntry(id: string, meta: Record<string, string>, content: string): MemoryEntry {
  return {
    id,
    title: meta['title'] ?? '',
    content,
    type: (meta['type'] ?? 'preference') as MemoryType,
    tags: parseTags(meta['tags'] ?? ''),
    source: (meta['source'] ?? 'user_input') as MemorySource,
    projectId: meta['project'] || undefined,
    createdAt: new Date(meta['created'] ?? Date.now()),
    updatedAt: new Date(meta['updated'] ?? Date.now()),
    accessCount: parseInt(meta['access_count'] ?? '0', 10),
    lastAccessedAt: new Date(meta['last_accessed'] ?? Date.now()),
  };
}

// ============================================================
// MemorySystem class
// ============================================================

export class MemorySystem {
  private baseDir: string;
  private llm: LLMClient | undefined;

  constructor(baseDir?: string, llm?: LLMClient) {
    this.baseDir = baseDir ?? BASE_DIR;
    this.llm = llm;
  }

  // ----------------------------------------------------------
  // Directory helpers
  // ----------------------------------------------------------

  private dirForType(type: MemoryType): string {
    return path.join(this.baseDir, TYPE_DIR_MAP[type]);
  }

  private filePathForEntry(type: MemoryType, id: string): string {
    return path.join(this.dirForType(type), `${id}.md`);
  }

  private ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
  }

  // ----------------------------------------------------------
  // Persistence operations
  // ----------------------------------------------------------

  /** Store a new memory entry. Returns the created entry with generated id and timestamps. */
  async store(
    input: Omit<MemoryEntry, 'id' | 'createdAt' | 'accessCount' | 'lastAccessedAt'>,
  ): Promise<MemoryEntry> {
    const now = new Date();
    const entry: MemoryEntry = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: input.updatedAt ?? now,
      accessCount: 0,
      lastAccessedAt: now,
    };

    const dir = this.dirForType(entry.type);
    this.ensureDir(dir);
    const filePath = this.filePathForEntry(entry.type, entry.id);
    fs.writeFileSync(filePath, serializeFrontmatter(entry), 'utf-8');
    return entry;
  }

  /** Update an existing memory entry. Throws if not found. */
  async update(id: string, updates: Partial<MemoryEntry>): Promise<MemoryEntry> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Memory entry "${id}" not found`);
    }

    const oldType = existing.type;
    const merged: MemoryEntry = {
      ...existing,
      ...updates,
      id, // id is immutable
      updatedAt: new Date(),
    };

    // If type changed, move file to new directory
    if (updates.type && updates.type !== oldType) {
      const oldPath = this.filePathForEntry(oldType, id);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      const newDir = this.dirForType(merged.type);
      this.ensureDir(newDir);
    }

    const filePath = this.filePathForEntry(merged.type, id);
    fs.writeFileSync(filePath, serializeFrontmatter(merged), 'utf-8');
    return merged;
  }

  /** Delete a single memory entry by id. */
  async delete(id: string): Promise<void> {
    const entry = await this.findById(id);
    if (!entry) return; // idempotent
    const filePath = this.filePathForEntry(entry.type, id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  /** Delete all memory entries. */
  async deleteAll(): Promise<void> {
    if (!fs.existsSync(this.baseDir)) return;
    fs.rmSync(this.baseDir, { recursive: true, force: true });
  }

  // ----------------------------------------------------------
  // Retrieval helpers
  // ----------------------------------------------------------

  /** Read and parse a single memory file. Returns null if file doesn't exist. */
  private readEntryFile(filePath: string): MemoryEntry | null {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { meta, content } = parseFrontmatter(raw);
    const id = path.basename(filePath, '.md');
    return metaToEntry(id, meta, content);
  }

  /** Find a memory entry by id (scans all type directories). */
  private async findById(id: string): Promise<MemoryEntry | null> {
    for (const subdir of Object.values(TYPE_DIR_MAP)) {
      const filePath = path.join(this.baseDir, subdir, `${id}.md`);
      const entry = this.readEntryFile(filePath);
      if (entry) return entry;
    }
    return null;
  }

  /** Load all memory entries from disk. */
  private loadAll(): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    if (!fs.existsSync(this.baseDir)) return entries;

    const subdirs = new Set(Object.values(TYPE_DIR_MAP));
    for (const subdir of subdirs) {
      const dir = path.join(this.baseDir, subdir);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.md')) continue;
        const entry = this.readEntryFile(path.join(dir, file));
        if (entry) entries.push(entry);
      }
    }
    return entries;
  }

  // ----------------------------------------------------------
  // Search
  // ----------------------------------------------------------

  /** Search memories with flexible query filters. */
  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    let results = this.loadAll();

    // Filter by projectId
    if (query.projectId) {
      results = results.filter((e) => e.projectId === query.projectId);
    }

    // Filter by type
    if (query.type) {
      results = results.filter((e) => e.type === query.type);
    }

    // Filter by tags (entry must contain ALL queried tags)
    if (query.tags && query.tags.length > 0) {
      const queryTags = new Set(query.tags);
      results = results.filter((e) => [...queryTags].every((t) => e.tags.includes(t)));
    }

    // Filter by time range (based on createdAt)
    if (query.timeRange) {
      const { start, end } = query.timeRange;
      results = results.filter((e) => e.createdAt >= start && e.createdAt <= end);
    }

    // Filter by keyword (search in title + content, case-insensitive)
    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      results = results.filter(
        (e) =>
          e.title.toLowerCase().includes(kw) || e.content.toLowerCase().includes(kw),
      );
    }

    // Sort
    switch (query.sortBy) {
      case 'recency':
        results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        break;
      case 'frequency':
        results.sort((a, b) => b.accessCount - a.accessCount);
        break;
      case 'relevance':
      default:
        // Default: most recently updated first
        results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        break;
    }

    // Limit
    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  // ----------------------------------------------------------
  // Export
  // ----------------------------------------------------------

  /** Export all memories in the requested format. */
  async exportAll(format: 'json' | 'markdown'): Promise<string> {
    const entries = this.loadAll();

    if (format === 'json') {
      return JSON.stringify(
        entries.map((e) => ({
          ...e,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
          lastAccessedAt: e.lastAccessedAt.toISOString(),
        })),
        null,
        2,
      );
    }

    // Markdown export: concatenate all memory files
    const sections = entries.map((e) => serializeFrontmatter(e));
    return sections.join('\n\n---\n\n');
  }

  // ----------------------------------------------------------
  // Context injection layer (task 4.2)
  // ----------------------------------------------------------

  /** Build a compact manifest of all memories (title + tags + type) for LLM selection. */
  private buildMemoryManifest(entries: MemoryEntry[]): string {
    return entries
      .map((e, i) => `[${i}] (${e.type}) ${e.title}  tags: ${e.tags.join(', ')}`)
      .join('\n');
  }

  /** Parse LLM response to extract selected memory indices. Expects comma-separated numbers. */
  private parseSelectedIndices(response: string, max: number): number[] {
    const nums = [...response.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
    return [...new Set(nums)].filter((n) => n >= 0 && n < max).slice(0, 5);
  }

  /**
   * Find memories relevant to the current conversation context.
   * Uses an LLM side query to pick the most relevant entries from a manifest.
   * Falls back to returning the 5 most recently updated entries when no LLM is available.
   */
  async findRelevantMemories(
    conversationContext: string,
    signal: AbortSignal,
  ): Promise<MemoryEntry[]> {
    const all = this.loadAll();
    if (all.length === 0) return [];

    // Fallback: no LLM — return top 5 by recency
    if (!this.llm) {
      return all
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, 5);
    }

    const manifest = this.buildMemoryManifest(all);

    const systemPrompt =
      'You are a memory relevance selector. Given a conversation context and a numbered list of memory entries, ' +
      'select up to 5 entries most relevant to the conversation. ' +
      'Reply with ONLY the index numbers separated by commas (e.g. "0,3,7"). No explanation.';

    const userPrompt =
      `## Conversation context\n${conversationContext}\n\n## Memory manifest\n${manifest}`;

    try {
      const response = await this.llm.query(systemPrompt, userPrompt, signal);
      const indices = this.parseSelectedIndices(response, all.length);

      if (indices.length === 0) {
        // LLM returned nothing useful — fall back to recency
        return all
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .slice(0, 5);
      }

      // Update access metadata for selected entries
      const selected: MemoryEntry[] = [];
      for (const idx of indices) {
        const entry = all[idx]!;
        entry.accessCount += 1;
        entry.lastAccessedAt = new Date();
        // Persist updated access metadata (fire-and-forget)
        this.update(entry.id, {
          accessCount: entry.accessCount,
          lastAccessedAt: entry.lastAccessedAt,
        }).catch(() => {});
        selected.push(entry);
      }
      return selected;
    } catch {
      // On any LLM error, degrade gracefully
      return all
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, 5);
    }
  }

  // ----------------------------------------------------------
  // Auto-extraction from conversation (task 4.3)
  // ----------------------------------------------------------

  /**
   * Extract and store noteworthy information from a conversation.
   * Uses an LLM call to identify memories worth persisting.
   * No-op when no LLM client is available.
   */
  async extractAndStoreFromConversation(messages: Message[]): Promise<void> {
    if (!this.llm || messages.length === 0) return;

    const transcript = messages
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

    const systemPrompt =
      'You are a memory extraction assistant. Analyze the conversation and extract information worth remembering long-term.\n' +
      'Extract ONLY items that fall into these categories:\n' +
      '- preference: User preferences or habits\n' +
      '- decision: Important decisions made\n' +
      '- commitment: Promises or commitments made\n' +
      '- colleague: Information about colleagues\n' +
      '- project_context: Key project conclusions or context\n\n' +
      'Reply in JSON array format. Each item: {"title":"...","content":"...","type":"...","tags":["..."]}\n' +
      'If nothing is worth extracting, reply with an empty array: []';

    const controller = new AbortController();

    try {
      const response = await this.llm.query(systemPrompt, transcript, controller.signal);

      // Parse JSON array from response (handle markdown code fences)
      const jsonStr = response.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const items: Array<{
        title: string;
        content: string;
        type: string;
        tags: string[];
      }> = JSON.parse(jsonStr);

      if (!Array.isArray(items)) return;

      const validTypes = new Set<string>([
        'preference', 'decision', 'commitment', 'colleague', 'project_context',
      ]);

      for (const item of items) {
        if (!item.title || !item.content) continue;
        const type = validTypes.has(item.type) ? item.type as MemoryType : 'decision';
        await this.store({
          title: item.title,
          content: item.content,
          type,
          tags: Array.isArray(item.tags) ? item.tags : [],
          source: 'auto_extract',
          updatedAt: new Date(),
        });
      }
    } catch {
      // Extraction failure is non-critical — silently ignore
    }
  }
}
