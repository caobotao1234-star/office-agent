/**
 * CLI Demo — Office Agent 交互式命令行
 *
 * 运行: npx tsx src/cli-demo.ts
 *
 * 需要 .env 文件配置:
 *   DASHSCOPE_API_KEY=sk-xxx
 *   DASHSCOPE_MODEL=qwen-plus  (可选，默认 qwen-plus)
 */
import * as readline from 'node:readline';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createOfficeAgent } from './main.js';
import { createDashScopeLLM } from './core/dashscope-llm.js';
import type { StreamEvent } from './types/index.js';

// ============================================================
// 加载 .env
// ============================================================

function loadEnv(): void {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  loadEnv();

  const apiKey = process.env['DASHSCOPE_API_KEY'];
  if (!apiKey) {
    console.error('❌ 缺少 DASHSCOPE_API_KEY，请在 .env 文件中配置');
    process.exit(1);
  }

  const model = process.env['DASHSCOPE_MODEL'] || 'qwen-plus';

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   🤖 Office Agent v0.1.0                ║');
  console.log('║   你的 AI 办公助理                       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  模型: ${model}`);
  console.log(`  输入消息与 Agent 交互，输入 quit 退出`);
  console.log();

  const dataDir = path.join(os.homedir(), '.office-agent');

  const llm = createDashScopeLLM({
    apiKey,
    model,
    maxTokens: 4096,
    temperature: 0.7,
  });

  const agent = createOfficeAgent({
    llm,
    baseDir: dataDir,
    model,
  });

  await agent.start();
  console.log('✅ Agent 已启动\n');

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
      process.stdout.write('Agent> ');

      try {
        const gen = agent.handleMessage(trimmed);
        for await (const event of gen) {
          switch (event.type) {
            case 'text':
              process.stdout.write(event.content);
              break;
            case 'tool_use':
              console.log(`\n  🔧 [调用工具: ${event.toolName}]`);
              break;
            case 'tool_result': {
              const r = event.result;
              const preview = JSON.stringify(r.output).slice(0, 150);
              console.log(`  📋 [结果: ${r.success ? '✅' : '❌'} ${preview}]`);
              process.stdout.write('Agent> ');
              break;
            }
            case 'error':
              console.log(`\n  ❌ 错误: ${event.error}`);
              break;
            case 'done':
              break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n  ❌ ${msg}`);
      }

      console.log('\n');
      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
