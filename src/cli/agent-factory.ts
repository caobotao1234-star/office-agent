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
  const apiKey = process.env['LLM_API_KEY'];
  if (!apiKey) {
    console.error('❌ 缺少 LLM_API_KEY，请在 .env 中配置');
    process.exit(1);
  }

  const model = modelOverride ?? process.env['LLM_MODEL'] ?? 'qwen-plus';
  const baseUrl = process.env['LLM_BASE_URL'];
  const tokenTracker = getTokenTracker();

  const llm = createDashScopeLLM({
    apiKey,
    model,
    maxTokens: 4096,
    temperature: 0.7,
    tokenTracker,
    baseUrl,
  });

  // Side query LLM — optional
  let sideLlm: ReturnType<typeof createDashScopeLLM> | undefined;
  const sideApiKey = process.env['SIDE_LLM_API_KEY'];
  const sideModel = process.env['SIDE_LLM_MODEL'];
  if (sideApiKey && sideModel) {
    sideLlm = createDashScopeLLM({
      apiKey: sideApiKey,
      model: sideModel,
      baseUrl: process.env['SIDE_LLM_BASE_URL'],
      maxTokens: 2048,
      temperature: 0.3,
    });
  }

  return createOfficeAgent({ llm, sideLlm, baseDir: DATA_DIR, model });
}
