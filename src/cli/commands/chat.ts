/**
 * `oa chat` — 交互式对话模式
 */
import * as readline from 'node:readline';
import type { StreamEvent } from '../../types/index.js';
import { getAgent } from '../agent-factory.js';
import { logger } from '../../core/logger.js';

export async function chat(modelOverride?: string): Promise<void> {
  logger.enableFileLogging();
  logger.setLevel((process.env['LOG_LEVEL'] as any) ?? 'info');
  const log = logger.child('CLI');
  const agent = getAgent(modelOverride);
  const model = modelOverride ?? process.env['DASHSCOPE_MODEL'] ?? 'qwen-plus';

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   🤖 Office Agent — 交互式对话           ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  模型: ${model}`);
  console.log('  命令: /tasks /remind /agenda /report /help');
  console.log(`  日志: ${process.env['OFFICE_AGENT_LOG_DIR'] ?? 'logs/agent-YYYY-MM-DD.log'}`);
  console.log('  退出: quit 或 Ctrl+C');
  console.log();
  log.info('chat started', { model });

  await agent.start();

  // Register CLI as a notification channel for proactive reminders
  agent.notificationService.addChannel((message) => {
    console.log(`\n\x1b[35m📢 提醒>\x1b[0m ${message}`);
    process.stdout.write('\x1b[36m你>\x1b[0m ');
  });

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
        // Route through agent like all other commands
      }

      // All commands (including /usage, /db, /reset, /undo, /help)
      // are now handled uniformly through agent.handleMessage()

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
        log.error('chat turn failed', { error: msg });
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
      const preview = JSON.stringify(r.success ? r.output : { error: r.error, output: r.output }).slice(0, 240);
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
  // Help is now handled by the unified builtin command system in main.ts
}
