/**
 * CLI Demo — 用 mock LLM 演示 Office Agent 完整流程
 *
 * 运行: npx tsx src/cli-demo.ts
 */
import * as readline from 'node:readline';
import * as os from 'node:os';
import * as path from 'node:path';
import { createOfficeAgent } from './main.js';
import type { LLMClient } from './core/llm-client.js';
import type { StreamEvent } from './types/index.js';

// ============================================================
// Mock LLM — 模拟 LLM 响应，让整个流程跑通
// ============================================================

const mockLLM: LLMClient = {
  async query(system: string, user: string, _signal: AbortSignal): Promise<string> {
    const input = user.toLowerCase();

    // 模拟工具调用：当用户说"查看任务"时，LLM 返回 tool_use
    if (input.includes('列出所有当前任务') || input.includes('查看任务') || input.includes('任务列表')) {
      return JSON.stringify({
        tool_use: { name: 'TaskManager', input: { action: 'list' } },
      });
    }

    // 模拟创建任务
    if (input.includes('创建任务') || input.includes('新任务')) {
      const desc = input.replace(/.*(?:创建任务|新任务)[：:\s]*/i, '') || '示例任务';
      return JSON.stringify({
        tool_use: {
          name: 'TaskManager',
          input: { action: 'create', description: desc, priority: 'medium', source: 'user_input' },
        },
      });
    }

    // 模拟记忆提取（extractAndStoreFromConversation 调用时）
    if (system.includes('memory extraction')) {
      return '[]';
    }

    // 模拟记忆相关性选择
    if (system.includes('memory relevance')) {
      return '';
    }

    // 默认回复
    return `收到你的消息：「${user.slice(0, 80)}」\n\n我是 Office Agent 的 Mock 模式。目前支持以下演示：\n- 输入 /tasks 查看任务列表\n- 输入 "创建任务：写周报" 创建新任务\n- 输入 /daily-report 触发技能\n- 输入任意文字测试对话流程\n\n要接入真实 LLM，需要实现 LLMClient 接口并传入 createOfficeAgent()。`;
  },
};

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   🤖 Office Agent v0.1.0 — CLI Demo     ║');
  console.log('║   输入消息与 Agent 交互，输入 quit 退出  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log();

  const dataDir = path.join(os.tmpdir(), 'office-agent-demo');

  const agent = createOfficeAgent({
    llm: mockLLM,
    baseDir: dataDir,
  });

  await agent.start();
  console.log('✅ Agent 已启动（技能已加载，调度器已启动）');
  console.log(`📁 数据目录: ${dataDir}`);
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question('你> ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }
      if (trimmed === 'quit' || trimmed === 'exit' || trimmed === '退出') {
        agent.stop();
        console.log('\n👋 再见！');
        rl.close();
        return;
      }

      console.log();

      // 处理消息并输出流式事件
      const gen = agent.handleMessage(trimmed);
      for await (const event of gen) {
        switch (event.type) {
          case 'text':
            process.stdout.write(event.content);
            break;
          case 'tool_use':
            console.log(`\n🔧 调用工具: ${event.toolName}`);
            console.log(`   输入: ${JSON.stringify(event.input)}`);
            break;
          case 'tool_result': {
            const result = event.result;
            console.log(`   结果: ${result.success ? '✅' : '❌'} ${JSON.stringify(result.output).slice(0, 200)}`);
            break;
          }
          case 'error':
            console.log(`\n❌ 错误: ${event.error}`);
            break;
          case 'done':
            break;
        }
      }

      console.log('\n');
      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
