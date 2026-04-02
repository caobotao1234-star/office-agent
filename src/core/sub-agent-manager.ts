/**
 * SubAgentManager — Dynamic project-level Sub_Agent management.
 *
 * Each Sub_Agent has an isolated memdir under ~/.office-agent/agents/{project-id}/memdir/
 * and inherits Main_Agent capabilities scoped to its project context.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LLMClient } from './llm-client.js';
import { MemorySystem } from './memory-system.js';

// ============================================================
// Types
// ============================================================

export interface SubAgent {
  id: string;
  projectId: string;
  projectName: string;
  status: 'active' | 'archived';
  createdAt: Date;
  memoryDir: string;
}

/** Serialisable shape stored on disk. */
interface SubAgentRecord {
  id: string;
  projectId: string;
  projectName: string;
  status: 'active' | 'archived';
  createdAt: string;
  memoryDir: string;
}

export interface CreateSubAgentResult {
  agent: SubAgent;
  /** True — caller should confirm with the user before finalising. */
  requiresConfirmation: true;
}

// ============================================================
// SubAgentManager
// ============================================================

export class SubAgentManager {
  private baseDir: string;
  private llm: LLMClient;
  private agents: SubAgent[] = [];
  private registryPath: string;

  constructor(llm: LLMClient, baseDir?: string) {
    this.baseDir = baseDir ?? path.join(
      process.env['HOME'] ?? process.env['USERPROFILE'] ?? '.',
      '.office-agent',
      'agents',
    );
    this.llm = llm;
    this.registryPath = path.join(this.baseDir, 'registry.json');
    this.loadRegistry();
  }

  // ----------------------------------------------------------
  // Persistence
  // ----------------------------------------------------------

  private ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
  }

  private loadRegistry(): void {
    if (!fs.existsSync(this.registryPath)) {
      this.agents = [];
      return;
    }
    try {
      const raw = fs.readFileSync(this.registryPath, 'utf-8');
      const records: SubAgentRecord[] = JSON.parse(raw);
      this.agents = records.map((r) => ({
        ...r,
        createdAt: new Date(r.createdAt),
      }));
    } catch {
      this.agents = [];
    }
  }

  private saveRegistry(): void {
    this.ensureDir(this.baseDir);
    const records: SubAgentRecord[] = this.agents.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    }));
    fs.writeFileSync(this.registryPath, JSON.stringify(records, null, 2), 'utf-8');
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Create a new Sub_Agent for a project.
   * Returns a result flagged with `requiresConfirmation: true` so the caller
   * can present it to the user before proceeding (Requirement 8.6).
   */
  async create(projectName: string, initialContext: string): Promise<CreateSubAgentResult> {
    const projectId = projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Prevent duplicates for the same project
    const existing = this.agents.find(
      (a) => a.projectId === projectId && a.status === 'active',
    );
    if (existing) {
      return { agent: existing, requiresConfirmation: true };
    }

    const id = randomUUID();
    const memoryDir = path.join(this.baseDir, projectId, 'memdir');
    this.ensureDir(memoryDir);

    const agent: SubAgent = {
      id,
      projectId,
      projectName,
      status: 'active',
      createdAt: new Date(),
      memoryDir,
    };

    // Store initial context as the first memory entry in the sub-agent's memdir
    if (initialContext) {
      const subMemory = new MemorySystem(memoryDir);
      await subMemory.store({
        title: `${projectName} — 初始上下文`,
        content: initialContext,
        type: 'project_context',
        tags: [projectName, 'initial'],
        source: 'user_input',
        updatedAt: new Date(),
      });
    }

    this.agents.push(agent);
    this.saveRegistry();

    return { agent, requiresConfirmation: true };
  }

  /**
   * Delegate a message to a Sub_Agent. Uses the LLM scoped to the
   * sub-agent's project memory context.
   */
  async delegate(agentId: string, message: string): Promise<string> {
    const agent = this.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Sub_Agent "${agentId}" not found`);
    if (agent.status === 'archived') throw new Error(`Sub_Agent "${agentId}" is archived`);

    // Build project-scoped context from the sub-agent's memdir
    const subMemory = new MemorySystem(agent.memoryDir);
    const memories = await subMemory.search({ limit: 10, sortBy: 'recency' });
    const contextBlock = memories.map((m) => `[${m.type}] ${m.title}: ${m.content}`).join('\n');

    const systemPrompt =
      `You are a project-scoped assistant for "${agent.projectName}". ` +
      `Use the following project context to answer the user's request.\n\n` +
      `## Project Context\n${contextBlock}`;

    const controller = new AbortController();
    return this.llm.query(systemPrompt, message, controller.signal);
  }

  /**
   * Archive a Sub_Agent: extract key memories into the main memory system,
   * then mark as archived (Requirement 8.4).
   */
  async archive(agentId: string, mainMemory?: MemorySystem): Promise<void> {
    const agent = this.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Sub_Agent "${agentId}" not found`);
    if (agent.status === 'archived') return; // idempotent

    // Migrate key memories to main memory system
    if (mainMemory) {
      const subMemory = new MemorySystem(agent.memoryDir);
      const entries = await subMemory.search({ limit: 50 });
      for (const entry of entries) {
        await mainMemory.store({
          title: `[归档:${agent.projectName}] ${entry.title}`,
          content: entry.content,
          type: entry.type,
          tags: [...entry.tags, `archived:${agent.projectId}`],
          source: entry.source,
          projectId: agent.projectId,
          updatedAt: new Date(),
        });
      }
    }

    agent.status = 'archived';
    this.saveRegistry();
  }

  /** List all Sub_Agents (optionally filter by status). */
  list(status?: 'active' | 'archived'): SubAgent[] {
    if (status) return this.agents.filter((a) => a.status === status);
    return [...this.agents];
  }

  /** Get the active Sub_Agent for a given project id. */
  getByProject(projectId: string): SubAgent | undefined {
    return this.agents.find((a) => a.projectId === projectId && a.status === 'active');
  }
}
