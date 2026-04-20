/**
 * SkillProposer — 自动技能提议引擎
 *
 * 参考 Hermes Agent 的 self-improving skills 设计。
 * 追踪每次对话的工具调用序列（trajectory），检测重复模式，
 * 当发现用户反复执行类似的多步骤工作流时，主动提议创建可复用的 skill。
 *
 * 核心逻辑：
 * 1. 每次工具调用记录为 trajectory entry（工具名 + action）
 * 2. 每次对话结束时，将本轮 trajectory 存入历史
 * 3. 每 N 轮对话，分析历史 trajectories 是否有重复模式
 * 4. 检测到重复模式时，用 LLM 生成 skill 提议
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../core/logger.js';
import type { LLMClient } from '../core/llm-client.js';

const log = logger.child('SkillProposer');

// A single tool call in a trajectory
interface TrajectoryEntry {
  tool: string;
  action?: string;
}

// One complete conversation trajectory
interface Trajectory {
  entries: TrajectoryEntry[];
  timestamp: string;
  userIntent: string; // first user message as context
}

// A detected repeated pattern
interface DetectedPattern {
  signature: string;       // normalized tool sequence signature
  occurrences: number;
  trajectories: Trajectory[];
}

export interface SkillProposal {
  name: string;
  description: string;
  pattern: string;
  occurrences: number;
}

export class SkillProposer {
  private dataFile: string;
  private existingSkillsDir: string;
  private history: Trajectory[] = [];
  private currentTrajectory: TrajectoryEntry[] = [];
  private currentUserIntent = '';
  private llm: LLMClient;

  // Check for patterns every N conversations
  private readonly checkInterval = 5;
  // Minimum occurrences to consider a pattern
  private readonly minOccurrences = 3;
  // Max history to keep
  private readonly maxHistory = 100;

  constructor(llm: LLMClient, baseDir: string) {
    this.llm = llm;
    this.dataFile = path.join(baseDir, 'skill-trajectories.json');
    this.existingSkillsDir = path.join(baseDir, 'skills');
    this.loadHistory();
  }

  /** Record a tool call in the current trajectory */
  recordToolCall(toolName: string, input: unknown): void {
    const action = (input && typeof input === 'object' && 'action' in input)
      ? String((input as any).action)
      : undefined;
    this.currentTrajectory.push({ tool: toolName, action });
  }

  /** Set the user intent for the current trajectory */
  setUserIntent(message: string): void {
    if (!this.currentUserIntent) {
      this.currentUserIntent = message.slice(0, 200);
    }
  }

  /** Finalize current trajectory and add to history */
  endConversationTurn(): void {
    // Only record trajectories with 2+ tool calls (single tool calls aren't patterns)
    if (this.currentTrajectory.length >= 2) {
      this.history.push({
        entries: [...this.currentTrajectory],
        timestamp: new Date().toISOString(),
        userIntent: this.currentUserIntent,
      });

      // Trim history
      if (this.history.length > this.maxHistory) {
        this.history = this.history.slice(-this.maxHistory);
      }

      this.saveHistory();
    }

    // Reset for next turn
    this.currentTrajectory = [];
    this.currentUserIntent = '';
  }

  /** Check if it's time to analyze patterns */
  shouldAnalyze(): boolean {
    return this.history.length > 0 && this.history.length % this.checkInterval === 0;
  }

  /** Detect repeated tool call patterns in history */
  detectPatterns(): DetectedPattern[] {
    const signatureMap = new Map<string, Trajectory[]>();

    for (const traj of this.history) {
      const sig = this.trajectorySignature(traj);
      const existing = signatureMap.get(sig) ?? [];
      existing.push(traj);
      signatureMap.set(sig, existing);
    }

    const patterns: DetectedPattern[] = [];
    for (const [sig, trajs] of signatureMap) {
      if (trajs.length >= this.minOccurrences) {
        // Check if a skill already exists for this pattern
        if (!this.skillAlreadyExists(sig)) {
          patterns.push({
            signature: sig,
            occurrences: trajs.length,
            trajectories: trajs,
          });
        }
      }
    }

    return patterns.sort((a, b) => b.occurrences - a.occurrences);
  }

  /** Generate a skill proposal using LLM */
  async proposeSkill(pattern: DetectedPattern): Promise<SkillProposal | null> {
    const examples = pattern.trajectories.slice(0, 3).map(t => ({
      intent: t.userIntent,
      steps: t.entries.map(e => e.action ? `${e.tool}(${e.action})` : e.tool).join(' → '),
    }));

    const prompt = [
      '你是一个技能分析助手。用户反复执行了以下工作流模式：',
      '',
      `工具调用序列: ${pattern.signature}`,
      `出现次数: ${pattern.occurrences}`,
      '',
      '具体例子:',
      ...examples.map((e, i) => `${i + 1}. 用户意图: "${e.intent}" → 步骤: ${e.steps}`),
      '',
      '请为这个重复模式生成一个可复用的技能提议。',
      '用 JSON 格式回复，包含以下字段:',
      '- name: 技能名称（kebab-case，英文）',
      '- description: 一句话中文描述',
      '',
      '只返回 JSON，不要其他内容。',
    ].join('\n');

    try {
      const abortController = new AbortController();
      const response = await this.llm.query(
        '你是一个技能分析助手，只返回 JSON。',
        prompt,
        abortController.signal,
      );
      const match = response.match(/\{[\s\S]*\}/);
      if (!match) return null;

      const parsed = JSON.parse(match[0]);
      return {
        name: parsed.name ?? 'unnamed-skill',
        description: parsed.description ?? '自动检测的工作流',
        pattern: pattern.signature,
        occurrences: pattern.occurrences,
      };
    } catch (err) {
      log.debug('Failed to generate skill proposal', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /** Create a normalized signature from a trajectory */
  private trajectorySignature(traj: Trajectory): string {
    return traj.entries
      .map(e => e.action ? `${e.tool}:${e.action}` : e.tool)
      .join(' → ');
  }

  /** Check if a skill already covers this pattern */
  private skillAlreadyExists(signature: string): boolean {
    if (!fs.existsSync(this.existingSkillsDir)) return false;
    try {
      const files = fs.readdirSync(this.existingSkillsDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(this.existingSkillsDir, file), 'utf-8');
        // Check if the skill's allowed_tools match the pattern's tools
        const tools = signature.split(' → ').map(s => s.split(':')[0]!);
        const uniqueTools = [...new Set(tools)];
        const allToolsInSkill = uniqueTools.every(t => content.includes(t));
        if (allToolsInSkill && content.includes(uniqueTools.join(', '))) {
          return true;
        }
      }
    } catch { /* ignore */ }
    return false;
  }

  private loadHistory(): void {
    try {
      if (fs.existsSync(this.dataFile)) {
        this.history = JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'));
      }
    } catch {
      this.history = [];
    }
  }

  private saveHistory(): void {
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dataFile, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (err) {
      log.debug('Failed to save trajectory history', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
