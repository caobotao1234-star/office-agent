/**
 * 快速测试 DashScope API 连通性
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDashScopeLLM } from './core/dashscope-llm.js';

// 加载 .env
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}

async function main() {
  const apiKey = process.env['DASHSCOPE_API_KEY'];
  if (!apiKey) { console.error('缺少 API key'); return; }

  const model = process.env['DASHSCOPE_MODEL'] || 'qwen-plus';
  console.log(`测试 DashScope API (${model})...`);

  const llm = createDashScopeLLM({ apiKey, model });
  const ac = new AbortController();

  try {
    const result = await llm.query(
      '你是一个办公助理。',
      '用一句话介绍你自己。',
      ac.signal,
    );
    console.log(`✅ API 响应: ${result}`);
  } catch (err) {
    console.error(`❌ API 错误:`, err);
  }
}

main();
