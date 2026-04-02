#!/usr/bin/env node
/**
 * Office Agent CLI — 主入口
 *
 * 用法:
 *   npx tsx src/cli/index.ts              # 默认进入交互式对话
 *   npx tsx src/cli/index.ts chat         # 交互式对话
 *   npx tsx src/cli/index.ts ask "问题"   # 单次提问（非交互）
 *   npx tsx src/cli/index.ts tasks        # 查看任务列表
 *   npx tsx src/cli/index.ts config       # 查看当前配置
 *   npx tsx src/cli/index.ts --help       # 帮助
 *   npx tsx src/cli/index.ts --version    # 版本
 *
 * 后续可通过 package.json bin 字段注册为全局命令 `oa`
 */
import { parseArgs } from 'node:util';
import { chat } from './commands/chat.js';
import { ask } from './commands/ask.js';
import { tasks } from './commands/tasks.js';
import { config } from './commands/config.js';
import { loadEnv } from './env.js';

const VERSION = '0.1.0';

const HELP = `
🤖 Office Agent v${VERSION} — AI 办公助理

用法:
  oa                       进入交互式对话（默认）
  oa chat                  进入交互式对话
  oa ask <问题>            单次提问，输出后退出
  oa tasks                 查看当前任务列表
  oa config                查看当前配置

选项:
  -h, --help               显示帮助
  -v, --version            显示版本
  -m, --model <model>      指定模型（默认 qwen-plus）

示例:
  oa chat
  oa ask "帮我列出今天的待办事项"
  oa tasks
`.trim();

async function main() {
  loadEnv();

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      model: { type: 'string', short: 'm' },
    },
  });

  if (values.version) {
    console.log(VERSION);
    return;
  }

  if (values.help) {
    console.log(HELP);
    return;
  }

  const command = positionals[0] ?? 'chat';
  const modelOverride = values.model;

  switch (command) {
    case 'chat':
      await chat(modelOverride);
      break;

    case 'ask': {
      const question = positionals.slice(1).join(' ');
      if (!question) {
        console.error('❌ 请提供问题，例如: oa ask "帮我列出今天的待办"');
        process.exit(1);
      }
      await ask(question, modelOverride);
      break;
    }

    case 'tasks':
      await tasks();
      break;

    case 'config':
      await config();
      break;

    default:
      // 没有匹配的子命令，当作 ask 的问题处理
      await ask(positionals.join(' '), modelOverride);
      break;
  }
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
