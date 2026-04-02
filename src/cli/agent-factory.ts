/**
 * 共享的 Agent 工厂 — CLI 各子命令复用
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { createOfficeAgent, type OfficeAgent } from '../main.js';
import { createDashScopeLLM } from '../core/dashscope-llm.js';

const DATA_DIR = path.join(os.homedir(), '.office-agent');

export function getAgent(modelOverride?: string): OfficeAgent {
  const apiKey = process.env['DASHSCOPE_API_KEY'];
  if (!apiKey) {
    console.error('❌ 缺少 DASHSCOPE_API_KEY');
    console.error('   请在项目根目录创建 .env 文件：');
    console.error('   DASHSCOPE_API_KEY=sk-xxx');
    process.exit(1);
  }

  const model = modelOverride ?? process.env['DASHSCOPE_MODEL'] ?? 'qwen-plus';

  const llm = createDashScopeLLM({
    apiKey,
    model,
    maxTokens: 4096,
    temperature: 0.7,
  });

  return createOfficeAgent({ llm, baseDir: DATA_DIR, model });
}
