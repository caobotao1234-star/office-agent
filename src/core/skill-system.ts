/**
 * Skill System — Extensible behaviour patterns for Office Agent.
 * Reference: Claude Code's SKILL.md + YAML frontmatter + inline/fork execution.
 *
 * Skills are Markdown files with YAML frontmatter defining:
 *   name, description, when_to_use, allowed_tools, execution_mode
 *
 * Three sources: bundled (shipped with system), user (custom), mcp (remote).
 * Two execution modes:
 *   - inline: returns skill instructions for injection into current context
 *   - fork:   runs skill in an independent LLM call and returns the result
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LLMClient } from './llm-client.js';

// ============================================================
// Types
// ============================================================

export interface SkillItem {
  name: string;
  description: string;
  whenToUse: string;
  allowedTools: string[];
  executionMode: 'inline' | 'fork';
  source: 'bundled' | 'user' | 'mcp';
  instructions: string; // Markdown body (after frontmatter)
}

export interface SkillResult {
  success: boolean;
  output: string;
  skillName: string;
  mode: 'inline' | 'fork';
}

// ============================================================
// Frontmatter parser (lightweight, no external YAML lib)
// ============================================================

function parseSkillFile(raw: string, source: SkillItem['source']): SkillItem | null {
  if (!raw.startsWith('---')) return null;

  const endIdx = raw.indexOf('\n---', 3);
  if (endIdx === -1) return null;

  const fmBlock = raw.slice(4, endIdx); // skip leading "---\n"
  const instructions = raw.slice(endIdx + 4).replace(/^\n/, '');

  const meta: Record<string, string> = {};
  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }

  const name = meta['name'];
  if (!name) return null;

  return {
    name,
    description: meta['description'] ?? '',
    whenToUse: meta['when_to_use'] ?? '',
    allowedTools: parseList(meta['allowed_tools'] ?? ''),
    executionMode: meta['execution_mode'] === 'fork' ? 'fork' : 'inline',
    source,
    instructions,
  };
}

/** Parse a YAML-style list value like `[A, B, C]` into a string array. */
function parseList(raw: string): string[] {
  const inner = raw.replace(/^\[/, '').replace(/]$/, '').trim();
  if (!inner) return [];
  return inner.split(',').map((s) => s.trim()).filter(Boolean);
}

// ============================================================
// SkillSystem
// ============================================================

export class SkillSystem {
  private bundledDir: string;
  private userDir: string;
  private skills: SkillItem[] = [];
  private llm: LLMClient | undefined;

  constructor(bundledDir: string, userDir: string, llm?: LLMClient) {
    this.bundledDir = bundledDir;
    this.userDir = userDir;
    this.llm = llm;
  }

  // ----------------------------------------------------------
  // Loading
  // ----------------------------------------------------------

  /** Scan bundled and user directories for .md skill files and load them. */
  async loadSkills(): Promise<SkillItem[]> {
    this.skills = [
      ...this.scanDir(this.bundledDir, 'bundled'),
      ...this.scanDir(this.userDir, 'user'),
    ];
    return this.skills;
  }

  private scanDir(dir: string, source: SkillItem['source']): SkillItem[] {
    if (!fs.existsSync(dir)) return [];
    const items: SkillItem[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const skill = parseSkillFile(raw, source);
      if (skill) items.push(skill);
    }
    return items;
  }

  // ----------------------------------------------------------
  // Lookup
  // ----------------------------------------------------------

  /** Find a skill by exact name match. */
  findSkill(nameOrTrigger: string): SkillItem | undefined {
    const q = nameOrTrigger.toLowerCase();
    return this.skills.find((s) => s.name.toLowerCase() === q);
  }

  // ----------------------------------------------------------
  // Execution
  // ----------------------------------------------------------

  /**
   * Execute a skill.
   * - inline: substitute $ARGUMENTS and return the instructions text.
   * - fork:   run the instructions in an independent LLM call and return the result.
   */
  async executeSkill(skill: SkillItem, args: string): Promise<SkillResult> {
    const body = skill.instructions.replace(/\$ARGUMENTS/g, args);

    if (skill.executionMode === 'inline') {
      return { success: true, output: body, skillName: skill.name, mode: 'inline' };
    }

    // fork mode — use LLM to execute independently
    if (!this.llm) {
      return {
        success: false,
        output: 'Fork execution requires an LLM client',
        skillName: skill.name,
        mode: 'fork',
      };
    }

    const systemPrompt =
      `You are executing the skill "${skill.name}". ` +
      `Allowed tools: ${skill.allowedTools.join(', ') || 'none'}. ` +
      'Follow the instructions below and produce the result.';

    const controller = new AbortController();
    try {
      const result = await this.llm.query(systemPrompt, body, controller.signal);
      return { success: true, output: result, skillName: skill.name, mode: 'fork' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: msg, skillName: skill.name, mode: 'fork' };
    }
  }

  // ----------------------------------------------------------
  // Skill matching
  // ----------------------------------------------------------

  /** Suggest a skill based on conversation context (simple keyword match on whenToUse). */
  suggestSkill(conversationContext: string): SkillItem | undefined {
    const ctx = conversationContext.toLowerCase();
    return this.skills.find((s) => {
      const keywords = s.whenToUse.toLowerCase().split(/[,，、\s]+/).filter(Boolean);
      return keywords.some((kw) => kw.length > 1 && ctx.includes(kw));
    });
  }

  /** Get all loaded skills. */
  getSkills(): readonly SkillItem[] {
    return this.skills;
  }
}
