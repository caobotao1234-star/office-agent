/**
 * Insights Engine — 使用分析引擎（参考 Hermes Agent InsightsEngine）
 *
 * 综合 token 用量、工具使用频率、会话模式、活跃时段等数据，
 * 生成完整的使用洞察报告。通过 /stats 命令触发。
 */
import type { TokenTracker } from '../core/token-tracker.js';
import type { UsageStats } from '../core/usage-stats.js';

export interface InsightsReport {
  period: string;
  totalSessions: number;
  totalToolCalls: number;
  topTools: Array<{ name: string; count: number; pct: number }>;
  activityByHour: number[];   // 24 slots, count per hour
  activityByDay: number[];    // 7 slots (0=Sun), count per day
  peakHour: number;
  peakDay: string;
  avgToolsPerSession: number;
  formatted: string;
}

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export class InsightsEngine {
  constructor(
    private tokenTracker: TokenTracker,
    private usageStats: UsageStats,
  ) {}

  generate(): InsightsReport {
    // Get raw data from token tracker
    const tokenReport = this.tokenTracker.formatDetailReport();
    const usageReport = this.usageStats.formatReport();

    // Parse tool usage from UsageStats
    const toolData = this.parseToolUsage(usageReport);
    const totalToolCalls = toolData.reduce((s, t) => s + t.count, 0);
    const topTools = toolData.slice(0, 10).map(t => ({
      ...t,
      pct: totalToolCalls > 0 ? Math.round(t.count / totalToolCalls * 100) : 0,
    }));

    // Parse activity patterns from token records
    const { byHour, byDay, totalSessions } = this.parseActivityPatterns(tokenReport);

    const peakHour = byHour.indexOf(Math.max(...byHour));
    const peakDayIdx = byDay.indexOf(Math.max(...byDay));
    const avgToolsPerSession = totalSessions > 0
      ? Math.round(totalToolCalls / totalSessions * 10) / 10
      : 0;

    const formatted = this.formatReport({
      totalSessions,
      totalToolCalls,
      topTools,
      byHour,
      byDay,
      peakHour,
      peakDayIdx,
      avgToolsPerSession,
    });

    return {
      period: '全部',
      totalSessions,
      totalToolCalls,
      topTools,
      activityByHour: byHour,
      activityByDay: byDay,
      peakHour,
      peakDay: DAY_NAMES[peakDayIdx] ?? '未知',
      avgToolsPerSession,
      formatted,
    };
  }

  private parseToolUsage(report: string): Array<{ name: string; count: number }> {
    const tools: Array<{ name: string; count: number }> = [];
    const lines = report.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s+(\S+)\s+(\d+)次/);
      if (match) {
        tools.push({ name: match[1]!, count: parseInt(match[2]!, 10) });
      }
    }
    return tools.sort((a, b) => b.count - a.count);
  }

  private parseActivityPatterns(report: string): {
    byHour: number[];
    byDay: number[];
    totalSessions: number;
  } {
    const byHour = new Array(24).fill(0) as number[];
    const byDay = new Array(7).fill(0) as number[];
    let totalSessions = 0;

    // Parse "最近 10 次调用" section for time patterns
    const lines = report.split('\n');
    for (const line of lines) {
      const timeMatch = line.match(/(\d{2}):(\d{2}):\d{2}/);
      if (timeMatch) {
        const hour = parseInt(timeMatch[1]!, 10);
        byHour[hour]!++;
        totalSessions++;
      }
    }

    // Estimate day distribution from "最近 7 天" section
    for (const line of lines) {
      const dayMatch = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d+)次/);
      if (dayMatch) {
        const date = new Date(dayMatch[1]!);
        const dayOfWeek = date.getDay();
        byDay[dayOfWeek]! += parseInt(dayMatch[2]!, 10);
      }
    }

    return { byHour, byDay, totalSessions: Math.max(totalSessions, 1) };
  }

  private formatReport(data: {
    totalSessions: number;
    totalToolCalls: number;
    topTools: Array<{ name: string; count: number; pct: number }>;
    byHour: number[];
    byDay: number[];
    peakHour: number;
    peakDayIdx: number;
    avgToolsPerSession: number;
  }): string {
    const lines: string[] = ['📊 使用洞察报告'];

    // Overview
    lines.push('\n═══ 概览 ═══');
    lines.push(`  总会话数: ${data.totalSessions}`);
    lines.push(`  总工具调用: ${data.totalToolCalls}`);
    lines.push(`  平均每次对话工具调用: ${data.avgToolsPerSession}`);

    // Top tools
    if (data.topTools.length > 0) {
      lines.push('\n═══ 最常用工具 ═══');
      const maxCount = data.topTools[0]?.count ?? 1;
      for (const t of data.topTools) {
        const barLen = Math.max(1, Math.round(t.count / maxCount * 15));
        const bar = '█'.repeat(barLen);
        lines.push(`  ${t.name.padEnd(18)} ${String(t.count).padStart(5)}次 (${String(t.pct).padStart(2)}%) ${bar}`);
      }
    }

    // Activity by hour
    lines.push('\n═══ 活跃时段 ═══');
    const maxHour = Math.max(...data.byHour, 1);
    for (let h = 7; h <= 23; h++) {
      const count = data.byHour[h]!;
      if (count === 0) continue;
      const bar = '█'.repeat(Math.max(1, Math.round(count / maxHour * 15)));
      lines.push(`  ${String(h).padStart(2)}:00  ${bar} ${count}`);
    }
    lines.push(`  高峰时段: ${data.peakHour}:00`);

    // Activity by day
    lines.push('\n═══ 活跃日 ═══');
    const maxDay = Math.max(...data.byDay, 1);
    for (let d = 1; d <= 5; d++) { // 周一到周五
      const count = data.byDay[d]!;
      const bar = count > 0 ? '█'.repeat(Math.max(1, Math.round(count / maxDay * 15))) : '░';
      lines.push(`  ${DAY_NAMES[d]}  ${bar} ${count}`);
    }
    // Weekend
    for (const d of [6, 0]) {
      const count = data.byDay[d]!;
      if (count > 0) {
        const bar = '█'.repeat(Math.max(1, Math.round(count / maxDay * 15)));
        lines.push(`  ${DAY_NAMES[d]}  ${bar} ${count}`);
      }
    }
    lines.push(`  最活跃: ${DAY_NAMES[data.peakDayIdx]}`);

    return lines.join('\n');
  }
}
