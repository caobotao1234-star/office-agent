/**
 * Token Usage Tracker — 按模型、按天统计 token 用量
 * 持久化到 ~/.office-agent/token-usage.json
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface TokenUsageRecord {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: string; // ISO date string
}

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  models: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
}

export interface UsageSummary {
  today: DailyUsage;
  allTime: {
    models: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
    totalCalls: number;
    totalTokens: number;
    firstUsed: string;
  };
  recentDays: DailyUsage[]; // 最近 7 天
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
  record(model: string, promptTokens: number, completionTokens: number): void {
    this.records.push({
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      timestamp: new Date().toISOString(),
    });
    this.save();
  }

  /** 获取完整的用量摘要 */
  getSummary(): UsageSummary {
    const todayStr = new Date().toISOString().slice(0, 10);

    // 按天分组
    const byDay = new Map<string, TokenUsageRecord[]>();
    for (const r of this.records) {
      const day = r.timestamp.slice(0, 10);
      const arr = byDay.get(day) ?? [];
      arr.push(r);
      byDay.set(day, arr);
    }

    // 今日用量
    const today = this.buildDailyUsage(todayStr, byDay.get(todayStr) ?? []);

    // 全量统计
    const allTimeModels: Record<string, { prompt: number; completion: number; total: number; calls: number }> = {};
    let totalCalls = 0;
    let totalTokens = 0;

    for (const r of this.records) {
      if (!allTimeModels[r.model]) {
        allTimeModels[r.model] = { prompt: 0, completion: 0, total: 0, calls: 0 };
      }
      allTimeModels[r.model].prompt += r.promptTokens;
      allTimeModels[r.model].completion += r.completionTokens;
      allTimeModels[r.model].total += r.totalTokens;
      allTimeModels[r.model].calls += 1;
      totalCalls++;
      totalTokens += r.totalTokens;
    }

    // 最近 7 天
    const recentDays: DailyUsage[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      recentDays.push(this.buildDailyUsage(dayStr, byDay.get(dayStr) ?? []));
    }

    return {
      today,
      allTime: {
        models: allTimeModels,
        totalCalls,
        totalTokens,
        firstUsed: this.records.length > 0 ? this.records[0].timestamp.slice(0, 10) : todayStr,
      },
      recentDays,
    };
  }

  /** 格式化输出用量报告（中文） */
  formatReport(): string {
    const s = this.getSummary();
    const lines: string[] = [];

    lines.push('📊 Token 用量统计\n');

    // 今日
    lines.push(`═══ 今日 (${s.today.date}) ═══`);
    if (Object.keys(s.today.models).length === 0) {
      lines.push('  暂无使用记录');
    } else {
      for (const [model, u] of Object.entries(s.today.models)) {
        lines.push(`  模型: ${model}`);
        lines.push(`    调用次数:   ${u.calls}`);
        lines.push(`    输入 token:  ${u.prompt.toLocaleString()}`);
        lines.push(`    输出 token:  ${u.completion.toLocaleString()}`);
        lines.push(`    合计 token:  ${u.total.toLocaleString()}`);
      }
    }

    // 历史总量
    lines.push(`\n═══ 历史总量 (自 ${s.allTime.firstUsed}) ═══`);
    lines.push(`  总调用次数: ${s.allTime.totalCalls.toLocaleString()}`);
    lines.push(`  总 token:   ${s.allTime.totalTokens.toLocaleString()}`);
    for (const [model, u] of Object.entries(s.allTime.models)) {
      lines.push(`\n  模型: ${model}`);
      lines.push(`    调用次数:   ${u.calls.toLocaleString()}`);
      lines.push(`    输入 token:  ${u.prompt.toLocaleString()}`);
      lines.push(`    输出 token:  ${u.completion.toLocaleString()}`);
      lines.push(`    合计 token:  ${u.total.toLocaleString()}`);
    }

    // 最近 7 天趋势
    lines.push('\n═══ 最近 7 天 ═══');
    for (const day of s.recentDays) {
      const totalForDay = Object.values(day.models).reduce((sum, m) => sum + m.total, 0);
      const callsForDay = Object.values(day.models).reduce((sum, m) => sum + m.calls, 0);
      const bar = '█'.repeat(Math.min(30, Math.ceil(totalForDay / 1000)));
      lines.push(`  ${day.date}  ${callsForDay.toString().padStart(4)} 次  ${totalForDay.toLocaleString().padStart(8)} tokens  ${bar}`);
    }

    return lines.join('\n');
  }

  private buildDailyUsage(date: string, records: TokenUsageRecord[]): DailyUsage {
    const models: DailyUsage['models'] = {};
    for (const r of records) {
      if (!models[r.model]) {
        models[r.model] = { prompt: 0, completion: 0, total: 0, calls: 0 };
      }
      models[r.model].prompt += r.promptTokens;
      models[r.model].completion += r.completionTokens;
      models[r.model].total += r.totalTokens;
      models[r.model].calls += 1;
    }
    return { date, models };
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      this.records = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
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
