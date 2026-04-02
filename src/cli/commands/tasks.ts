/**
 * `oa tasks` — 查看当前任务列表
 */
import { getAgent } from '../agent-factory.js';

export async function tasks(): Promise<void> {
  const agent = getAgent();

  const result = await agent.toolRegistry.execute(
    'TaskManager',
    { action: 'list' },
    { abortSignal: new AbortController().signal, userConfig: agent.getConfig() },
  );

  if (!result.success) {
    console.error('❌', result.error);
    return;
  }

  const items = result.output as Array<{
    id: string;
    description: string;
    status: string;
    priority: string;
    dueDate?: string;
    projectId?: string;
  }>;

  if (items.length === 0) {
    console.log('📋 暂无任务');
    return;
  }

  console.log(`📋 任务列表 (${items.length} 项)\n`);

  const statusIcon: Record<string, string> = {
    pending: '⏳',
    in_progress: '🔄',
    completed: '✅',
    overdue: '⚠️',
    cancelled: '🚫',
  };

  for (const t of items) {
    const icon = statusIcon[t.status] ?? '•';
    const due = t.dueDate ? ` 截止: ${new Date(t.dueDate).toLocaleDateString('zh-CN')}` : '';
    const proj = t.projectId ? ` [${t.projectId}]` : '';
    console.log(`  ${icon} [${t.priority}] ${t.description}${due}${proj}`);
  }
}
