/**
 * 共享的 Agent 工厂 — CLI 各子命令复用
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { createOfficeAgent, type OfficeAgent } from '../main.js';
import { createDashScopeLLM } from '../core/dashscope-llm.js';
import { resolveMainModel, resolveSideModel } from '../core/model-registry.js';
import { TokenTracker } from '../core/token-tracker.js';

const DATA_DIR = path.join(os.homedir(), '.office-agent');

let _tokenTracker: TokenTracker | null = null;

export function getTokenTracker(): TokenTracker {
  if (!_tokenTracker) {
    _tokenTracker = new TokenTracker(path.join(DATA_DIR, 'token-usage.json'));
  }
  return _tokenTracker;
}

export function getAgent(modelOverride?: string): OfficeAgent {
  const main = modelOverride
    ? { model: modelOverride, apiKey: process.env['LLM_API_KEY'] ?? '', baseUrl: process.env['LLM_BASE_URL'] }
    : resolveMainModel();

  const tokenTracker = getTokenTracker();
  const llm = createDashScopeLLM({
    apiKey: main.apiKey, model: main.model, tokenTracker, baseUrl: main.baseUrl,
  });

  let sideLlm: ReturnType<typeof createDashScopeLLM> | undefined;
  const side = resolveSideModel();
  if (side) {
    sideLlm = createDashScopeLLM({
      apiKey: side.apiKey, model: side.model, baseUrl: side.baseUrl,
      maxTokens: 2048, temperature: 0.3,
    });
  }

  return createOfficeAgent({ llm, sideLlm, baseDir: DATA_DIR, model: main.model });
}
