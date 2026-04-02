/**
 * `oa chat` — 交互式对话模式
 */
import * as readline from 'node:readline';
import type { StreamEvent } from '../../types/index.js';
import { getAgent } from '../agent-factory.js';

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

      console.log();
      process.stdout.write('\x1b[33mAgent>\x1b[0m ');

      try {
        for await (const event of agent.handleMessage(trimmed)) {
          renderEvent(event);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n\x1b[31m❌ ${msg}\x1b[0m`);
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
  /help               显示此帮助
  quit                退出
`);
}
