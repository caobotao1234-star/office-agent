/**
 * UsageStats — Tool and Skill usage statistics.
 *
 * Tracks how many times each tool and skill is called,
 * persisted to {baseDir}/usage-stats.json.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface UsageRecord {
  name: string;
  type: 'tool' | 'skill';
  count: number;
  lastUsedAt: string;
}

const DEFAULT_PATH = path.join(os.homedir(), '.office-agent', 'usage-stats.json');

export class UsageStats {
  private records = new Map<string, UsageRecord>();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_PATH;
    this.load();
  }

  /** Record a tool or skill invocation */
  record(name: string, type: 'tool' | 'skill'): void {
    const key = `${type}:${name}`;
    const existing = this.records.get(key);
    if (existing) {
      existing.count++;
      existing.lastUsedAt = new Date().toISOString();
    } else {
      this.records.set(key, { name, type, count: 1, lastUsedAt: new Date().toISOString() });
    }
    this.save();
  }

  /** Format a readable report */
  formatReport(): string {
    const lines: string[] = ['📊 工具/技能使用统计'];

    if (this.records.size === 0) {
      lines.push('\n  暂无使用记录');
      return lines.join('\n');
    }

    const tools = [...this.records.values()].filter(r => r.type === 'tool').sort((a, b) => b.count - a.count);
    const skills = [...this.records.values()].filter(r => r.type === 'skill').sort((a, b) => b.count - a.count);

    if (tools.length > 0) {
      lines.push('\n═══ 工具调用 ═══');
      const totalToolCalls = tools.reduce((s, r) => s + r.count, 0);
      lines.push(`  总计 ${totalToolCalls} 次`);
      for (const r of tools) {
        const bar = '█'.repeat(Math.min(20, Math.ceil(r.count / Math.max(1, totalToolCalls / 20))));
        lines.push(`  ${r.name.padEnd(20)} ${String(r.count).padStart(5)}次  ${bar}`);
      }
    }

    if (skills.length > 0) {
      lines.push('\n═══ 技能调用 ═══');
      for (const r of skills) {
        const lastUsed = r.lastUsedAt.slice(0, 10);
        lines.push(`  ${r.name.padEnd(20)} ${String(r.count).padStart(5)}次  最近: ${lastUsed}`);
      }
    }

    return lines.join('\n');
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as UsageRecord[];
      for (const r of raw) {
        this.records.set(`${r.type}:${r.name}`, r);
      }
    } catch {
      this.records.clear();
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify([...this.records.values()], null, 2), 'utf-8');
  }
}
