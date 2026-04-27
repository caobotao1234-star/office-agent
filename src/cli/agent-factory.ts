/**
 * 共享的 Agent 工厂 — CLI 各子命令复用
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { createOfficeAgent, type OfficeAgent } from '../main.js';
import { createDashScopeLLM } from '../core/dashscope-llm.js';
import { TokenTracker } from '../core/token-tracker.js';

const DATA_DIR = path.join(os.homedir(), '.office-agent');

/** Shared token tracker instance */
let _tokenTracker: TokenTracker | null = null;

export function getTokenTracker(): TokenTracker {
  if (!_tokenTracker) {
    _tokenTracker = new TokenTracker(path.join(DATA_DIR, 'token-usage.json'));
  }
  return _tokenTracker;
}

export function getAgent(modelOverride?: string): OfficeAgent {
  const provider = process.env['LLM_PROVIDER'] ?? 'dashscope';

  const apiKey = provider === 'dashscope'
    ? (process.env['DASHSCOPE_API_KEY'] ?? '')
    : (process.env['LLM_API_KEY'] ?? '');
  if (!apiKey) {
    console.error('❌ 缺少 API Key');
    console.error('   请在 .env 中配置 DASHSCOPE_API_KEY 或 LLM_API_KEY');
    process.exit(1);
  }

  const model = modelOverride
    ?? (provider === 'dashscope'
      ? (process.env['DASHSCOPE_MODEL'] ?? 'qwen-plus')
      : (process.env['LLM_MODEL'] ?? 'deepseek-v4-flash'));
  const baseUrl = provider === 'dashscope'
    ? undefined
    : (process.env['LLM_BASE_URL'] ?? 'https://api.deepseek.com/v1');

  const tokenTracker = getTokenTracker();

  const llm = createDashScopeLLM({
    apiKey,
    model,
    maxTokens: 4096,
    temperature: 0.7,
    tokenTracker,
    baseUrl,
  });

  const sideQueryModel = provider === 'dashscope' ? undefined : 'qwen3.5-flash';
  return createOfficeAgent({ llm, baseDir: DATA_DIR, model, sideQueryModel });
}
