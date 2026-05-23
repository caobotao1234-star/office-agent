/**
 * `oa config` — 查看当前配置
 */
import { getAgent } from '../agent-factory.js';

export async function config(): Promise<void> {
  const agent = getAgent();
  const cfg = agent.getConfig();

  console.log('⚙️  Office Agent 配置\n');
  console.log(`  工作时间: ${cfg.workingHours.start} - ${cfg.workingHours.end}`);
  console.log(`  工作日:   ${cfg.workingHours.workDays.map(d => ['日','一','二','三','四','五','六'][d]).join('、')}`);
  console.log(`  离开阈值: ${cfg.awaySummary.thresholdMinutes} 分钟`);
  console.log(`  飞书:     ${cfg.feishu.enabled ? '已启用' : '未启用'}`);
  console.log(`  时区:     ${cfg.timezone}`);
  console.log(`  当前工具: ${agent.toolRegistry.listEnabled().map(t => t.name).join(', ')}`);
}
