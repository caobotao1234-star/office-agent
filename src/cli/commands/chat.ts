/**
 * `oa chat` — 交互式对话模式
 */
import * as readline from 'node:readline';
import type { StreamEvent } from '../../types/index.js';
import { getAgent, getTokenTracker } from '../agent-factory.js';

export async function chat(modelOverride?: string): Promise<void> {
  const agent = getAgent(modelOverride);
  const model = modelOverride ?? process.env['DASHSCOPE_MODEL'] ?? 'qwen-plus';

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   🤖 Office Agent — 交互式对话           ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  模型: ${model}`);
  console.log('  命令: /tasks /remind /daily-report /help');
  console.log('  退出: quit 或 Ctrl+C');
  console.log();

  await agent.start();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question('\x1b[36m你>\x1b[0m ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { prompt(); return; }

      if (trimmed === 'quit' || trimmed === 'exit' || trimmed === '退出') {
        agent.stop();
        console.log('\n👋 再见！');
        rl.close();
        return;
      }

      if (trimmed === '/help' || trimmed === '帮助') {
        printHelp();
        prompt();
        return;
      }

      if (trimmed === '/usage' || trimmed === '/token' || trimmed === '/tokens') {
        console.log(getTokenTracker().formatReport());
        prompt();
        return;
      }

      if (trimmed === '/usage detail' || trimmed === '/token detail') {
        console.log(getTokenTracker().formatDetailReport());
        prompt();
        return;
      }

      // 直接查数据库的命令（不经过 LLM）
      if (trimmed === '/db tasks' || trimmed === '/verify tasks') {
        const result = await agent.toolRegistry.execute('TaskManager', { action: 'list' },
          { abortSignal: new AbortController().signal, userConfig: agent.getConfig() });
        const tasks = (result.output as any[]) ?? [];
        if (tasks.length === 0) { console.log('  📋 数据库中无任务'); }
        else {
          console.log(`  📋 数据库中有 ${tasks.length} 个任务:`);
          for (const t of tasks) {
            console.log(`    ${t.status === 'completed' ? '✅' : '⏳'} [${t.priority}] ${t.description}${t.projectId ? ' (#' + t.projectId + ')' : ''}${t.dueDate ? ' 截止:' + new Date(t.dueDate).toLocaleDateString('zh-CN') : ''}`);
          }
        }
        prompt(); return;
      }

      if (trimmed === '/db projects' || trimmed === '/verify projects') {
        const projects = agent.subAgentManager.list();
        if (projects.length === 0) { console.log('  📁 数据库中无项目'); }
        else {
          console.log(`  📁 数据库中有 ${projects.length} 个项目:`);
          for (const p of projects) {
            console.log(`    ${p.status === 'active' ? '🟢' : '⚪'} ${p.projectName} (${p.projectId}) [${p.status}]`);
          }
        }
        prompt(); return;
      }

      if (trimmed === '/db memories' || trimmed === '/verify memories') {
        const memories = await agent.memorySystem.search({ limit: 10 });
        if (memories.length === 0) { console.log('  🧠 数据库中无记忆'); }
        else {
          console.log(`  🧠 数据库中有记忆 (显示最近10条):`);
          for (const m of memories) {
            console.log(`    [${m.type}] ${m.title}`);
          }
        }
        prompt(); return;
      }

      if (trimmed === '/reset') {
        const confirm = await new Promise<string>(resolve => {
          rl.question('  ⚠️  确定清空所有数据？数据会移到回收站，可用 /undo 恢复。输入 yes 确认: ', resolve);
        });
        if (confirm.trim() === 'yes') {
          await agent.memorySystem.deleteAll();
          await agent.toolRegistry.execute('TaskManager', { action: 'delete_all' },
            { abortSignal: new AbortController().signal, userConfig: agent.getConfig() });
          const fs = await import('node:fs');
          const os = await import('node:os');
          const path = await import('node:path');
          const sessDir = path.join(os.homedir(), '.office-agent', 'sessions');
          if (fs.existsSync(sessDir)) fs.rmSync(sessDir, { recursive: true, force: true });
          console.log('  ✅ 全部清空（记忆已移到回收站 ~/.office-agent/trash/）。重启 npm start 生效。');
        } else {
          console.log('  已取消。');
        }
        prompt(); return;
      }

      if (trimmed === '/undo') {
        const count = await agent.memorySystem.restoreFromTrash();
        if (count > 0) {
          console.log(`  ✅ 已从回收站恢复 ${count} 个记忆文件`);
        } else {
          console.log('  回收站为空，无可恢复的数据');
        }
        prompt(); return;
      }

      console.log();
      process.stdout.write('\x1b[33mAgent>\x1b[0m ');

      let toolCallCount = 0;
      try {
        for await (const event of agent.handleMessage(trimmed)) {
          if (event.type === 'tool_use' || event.type === 'tool_result') toolCallCount++;
          renderEvent(event);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n\x1b[31m❌ ${msg}\x1b[0m`);
      }

      // 显示本轮工具调用情况
      if (toolCallCount > 0) {
        console.log(`\n  \x1b[90m[本轮调用了 ${toolCallCount / 2} 个工具]\x1b[0m`);
      } else {
        console.log(`\n  \x1b[90m[本轮未调用工具 — 回答基于上下文，非数据库]\x1b[0m`);
      }

      console.log('\n');
      prompt();
    });
  };

  prompt();
}

function renderEvent(event: StreamEvent): void {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'tool_use':
      console.log(`\n  \x1b[90m🔧 调用工具: ${event.toolName}\x1b[0m`);
      break;
    case 'tool_result': {
      const r = event.result;
      const icon = r.success ? '✅' : '❌';
      const preview = JSON.stringify(r.output).slice(0, 120);
      console.log(`  \x1b[90m${icon} ${preview}\x1b[0m`);
      process.stdout.write('\x1b[33mAgent>\x1b[0m ');
      break;
    }
    case 'error':
      console.log(`\n\x1b[31m❌ ${event.error}\x1b[0m`);
      break;
    case 'done':
      break;
  }
}

function printHelp(): void {
  console.log(`
\x1b[1m可用命令:\x1b[0m
  /tasks              查看任务列表
  /remind <内容>      创建提醒
  /daily-report       生成每日工作汇报
  /weekly-report      生成周报
  /meeting-notes      整理会议纪要
  /task-breakdown     拆解大任务
  /feishu-sync        同步飞书状态
  /project            查看项目列表
  /memory <关键词>    搜索记忆
  /cron               查看定时任务
  /usage              查看 token 用量统计
  /usage detail       查看详细用量（按模型×环节）
  /db tasks           直接查数据库中的任务（不经过 LLM）
  /db projects        直接查数据库中的项目
  /db memories        直接查数据库中的记忆
  /reset              清空所有数据（移到回收站）
  /undo               从回收站恢复记忆
  /help               显示此帮助
  quit                退出
`);
}
