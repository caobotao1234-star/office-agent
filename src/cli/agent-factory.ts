/**
 * 共享的 Agent 工厂 — CLI 各子命令复用
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { createOfficeAgent, type OfficeAgent } from '../main.js';
import { TokenTracker } from '../core/token-tracker.js';
import { createConfiguredLLM } from '../core/llm-provider.js';

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
  const tokenTracker = getTokenTracker();
  let configured;
  try {
    configured = createConfiguredLLM({ modelOverride, tokenTracker });
  } catch (err) {
    console.error('❌', err instanceof Error ? err.message : String(err));
    console.error('   请检查 .env 中的 OFFICE_AGENT_LLM_PROVIDER、DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY。');
    process.exit(1);
  }

  return createOfficeAgent({ llm: configured.llm, baseDir: DATA_DIR, model: configured.model });
}
