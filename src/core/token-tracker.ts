/**
 * Token Usage Tracker — 按模型、按天、按来源统计 token 用量
 * 持久化到 ~/.office-agent/token-usage.json
 *
 * 来源分类:
 *   chat        — 主对话（用户交互）
 *   tool_call   — function calling（工具调用轮次）
 *   side_query  — 记忆检索、记忆提取、上下文压缩等后台 LLM 调用
 *   skill       — 技能执行（fork 模式）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export type TokenSource = 'chat' | 'tool_call' | 'side_query' | 'skill';

export interface TokenUsageRecord {
  model: string;
  source: TokenSource;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: string;
}

const DEFAULT_PATH = path.join(os.homedir(), '.office-agent', 'token-usage.json');

export class TokenTracker {
  private records: TokenUsageRecord[] = [];
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_PATH;
    this.load();
  }

  /** 记录一次 API 调用的 token 用量 */
  record(model: string, promptTokens: number, completionTokens: number, source: TokenSource = 'chat'): void {
    this.records.push({
      model,
      source,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      timestamp: new Date().toISOString(),
    });
    this.save();
  }

  // ============================================================
  // 简洁报告（/usage）
  // ============================================================

  formatReport(): string {
    const lines: string[] = ['📊 Token 用量统计'];
    const todayStr = new Date().toISOString().slice(0, 10);

    if (this.records.length === 0) {
      lines.push('\n  暂无使用记录');
      return lines.join('\n');
    }

    // --- 今日 ---
    const todayRecords = this.records.filter(r => r.timestamp.slice(0, 10) === todayStr);
    lines.push(`\n═══ 今日 (${todayStr}) ═══`);
    if (todayRecords.length === 0) {
      lines.push('  暂无');
    } else {
      this.appendModelSummary(lines, todayRecords);
    }

    // --- 历史总量（按模型） ---
    const firstDate = this.records[0]!.timestamp.slice(0, 10);
    lines.push(`\n═══ 历史总量 (自 ${firstDate}) ═══`);
    this.appendModelSummary(lines, this.records);

    // --- 最近 7 天趋势 ---
    lines.push('\n═══ 最近 7 天 ═══');
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const dayRecords = this.records.filter(r => r.timestamp.slice(0, 10) === dayStr);
      const input = dayRecords.reduce((s, r) => s + r.promptTokens, 0);
      const output = dayRecords.reduce((s, r) => s + r.completionTokens, 0);
      const calls = dayRecords.length;
      if (calls === 0 && i > 0) continue; // 跳过无数据的非今天日期
      const bar = '█'.repeat(Math.min(20, Math.ceil((input + output) / 2000)));
      lines.push(`  ${dayStr}  ${pad(calls, 3)}次  入${pad(input, 7)}  出${pad(output, 7)}  ${bar}`);
    }

    return lines.join('\n');
  }

  // ============================================================
  // 详细报告（/usage detail）
  // ============================================================

  formatDetailReport(): string {
    const lines: string[] = ['📊 Token 用量详细报告'];
    const todayStr = new Date().toISOString().slice(0, 10);

    if (this.records.length === 0) {
      lines.push('\n  暂无使用记录');
      return lines.join('\n');
    }

    // --- 按模型分组 ---
    const models = this.groupByModel(this.records);
    lines.push(`\n═══ 按模型统计 ═══`);
    for (const [model, recs] of models) {
      const input = recs.reduce((s, r) => s + r.promptTokens, 0);
      const output = recs.reduce((s, r) => s + r.completionTokens, 0);
      lines.push(`\n  📦 ${model}  (${recs.length} 次调用)`);
      lines.push(`     输入: ${input.toLocaleString()} tokens`);
      lines.push(`     输出: ${output.toLocaleString()} tokens`);
      lines.push(`     合计: ${(input + output).toLocaleString()} tokens`);
    }

    // --- 按来源分组 ---
    const sources = this.groupBySource(this.records);
    lines.push(`\n═══ 按环节统计 ═══`);
    const sourceLabels: Record<TokenSource, string> = {
      chat: '💬 对话交互',
      tool_call: '🔧 工具调用',
      side_query: '🧠 后台查询（记忆/压缩）',
      skill: '⚡ 技能执行',
    };
    for (const [source, recs] of sources) {
      const input = recs.reduce((s, r) => s + r.promptTokens, 0);
      const output = recs.reduce((s, r) => s + r.completionTokens, 0);
      lines.push(`  ${sourceLabels[source as TokenSource] ?? source}  ${recs.length}次  入${pad(input, 7)}  出${pad(output, 7)}  计${pad(input + output, 8)}`);
    }

    // --- 今日按来源 × 模型 ---
    const todayRecords = this.records.filter(r => r.timestamp.slice(0, 10) === todayStr);
    if (todayRecords.length > 0) {
      lines.push(`\n═══ 今日明细 (${todayStr}) ═══`);
      const todaySources = this.groupBySource(todayRecords);
      for (const [source, recs] of todaySources) {
        const byModel = this.groupByModel(recs);
        for (const [model, modelRecs] of byModel) {
          const input = modelRecs.reduce((s, r) => s + r.promptTokens, 0);
          const output = modelRecs.reduce((s, r) => s + r.completionTokens, 0);
          lines.push(`  ${sourceLabels[source as TokenSource] ?? source} × ${model}  ${modelRecs.length}次  入${pad(input, 6)}  出${pad(output, 6)}`);
        }
      }
    }

    // --- 最近 10 次调用 ---
    lines.push('\n═══ 最近 10 次调用 ═══');
    const recent = this.records.slice(-10).reverse();
    for (const r of recent) {
      const time = r.timestamp.slice(11, 19);
      const src = sourceLabels[r.source]?.slice(0, 2) ?? r.source;
      lines.push(`  ${time}  ${src} ${r.model}  入${pad(r.promptTokens, 5)} 出${pad(r.completionTokens, 5)}`);
    }

    return lines.join('\n');
  }

  // ============================================================
  // Helpers
  // ============================================================

  private appendModelSummary(lines: string[], records: TokenUsageRecord[]): void {
    const models = this.groupByModel(records);
    const totalInput = records.reduce((s, r) => s + r.promptTokens, 0);
    const totalOutput = records.reduce((s, r) => s + r.completionTokens, 0);

    lines.push(`  调用 ${records.length} 次 | 输入 ${totalInput.toLocaleString()} | 输出 ${totalOutput.toLocaleString()} | 合计 ${(totalInput + totalOutput).toLocaleString()}`);

    if (models.size > 1) {
      for (const [model, recs] of models) {
        const input = recs.reduce((s, r) => s + r.promptTokens, 0);
        const output = recs.reduce((s, r) => s + r.completionTokens, 0);
        lines.push(`    ${model}: ${recs.length}次  入${input.toLocaleString()}  出${output.toLocaleString()}`);
      }
    }
  }

  private groupByModel(records: TokenUsageRecord[]): Map<string, TokenUsageRecord[]> {
    const map = new Map<string, TokenUsageRecord[]>();
    for (const r of records) {
      const arr = map.get(r.model) ?? [];
      arr.push(r);
      map.set(r.model, arr);
    }
    return map;
  }

  private groupBySource(records: TokenUsageRecord[]): Map<string, TokenUsageRecord[]> {
    const map = new Map<string, TokenUsageRecord[]>();
    for (const r of records) {
      const arr = map.get(r.source) ?? [];
      arr.push(r);
      map.set(r.source, arr);
    }
    return map;
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      // 兼容旧格式（没有 source 字段的记录）
      this.records = (raw as TokenUsageRecord[]).map(r => ({
        ...r,
        source: r.source ?? 'chat',
      }));
    } catch {
      this.records = [];
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.records), 'utf-8');
  }
}

function pad(n: number, width: number): string {
  return n.toLocaleString().padStart(width);
}
