/**
 * 共享的 Agent 工厂 — CLI 各子命令复用
 *
 * ============================================================
 * 🎓 LangChain 学习笔记 — Step 1 变更点
 * ============================================================
 *
 * 【变更前】
 *   import { createDashScopeLLM } from '../core/dashscope-llm.js';
 *   const llm = createDashScopeLLM({ apiKey, model, tokenTracker, baseUrl });
 *
 * 【变更后】
 *   import { createLangChainLLM } from '../core/langchain-llm.js';
 *   const llm = createLangChainLLM({ apiKey, model, tokenTracker, baseUrl });
 *
 * 接口完全一样（都返回 LLMClient），所以其他代码不需要改动。
 * 这就是"适配器模式"的好处：内部实现换了，外部无感知。
 *
 * 【保留 dashscope-llm.ts 的原因】
 *   1. 作为学习对照：你可以对比手搓版和 LangChain 版的代码量差异
 *   2. 作为 fallback：如果 LangChain 有 bug，可以快速切回手搓版
 *   3. 后续 Step 3 重构 QueryEngine 后，这个适配器层也会被移除
 * ============================================================
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { createOfficeAgent, type OfficeAgent } from '../main.js';
import { resolveMainModel, resolveSideModel } from '../core/model-registry.js';
import { TokenTracker } from '../core/token-tracker.js';

// 🎓 【关键变更】从手搓的 DashScope 客户端切换到 LangChain 封装
// 旧代码: import { createDashScopeLLM } from '../core/dashscope-llm.js';
// 新代码: 使用 LangChain 的 ChatOpenAI 作为底层
import { createLangChainLLM } from '../core/langchain-llm.js';

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

  // 🎓 【核心变更】
  // 旧代码: const llm = createDashScopeLLM({ apiKey, model, tokenTracker, baseUrl });
  //   → 内部是手写的 fetch() + SSE 解析 + tool_calls 处理（~200 行）
  //
  // 新代码: const llm = createLangChainLLM({ apiKey, model, tokenTracker, baseUrl });
  //   → 内部是 LangChain 的 ChatOpenAI（自动处理一切）
  //
  // 两者返回的都是 LLMClient 接口，所以 createOfficeAgent 完全不需要改
  const llm = createLangChainLLM({
    apiKey: main.apiKey,
    model: main.model,
    tokenTracker,
    baseUrl: main.baseUrl,
  });

  // 🎓 Side LLM（轻量模型，用于记忆检索、上下文压缩等后台任务）
  // 同样从手搓版切换到 LangChain 版
  let sideLlm: ReturnType<typeof createLangChainLLM> | undefined;
  const side = resolveSideModel();
  if (side) {
    sideLlm = createLangChainLLM({
      apiKey: side.apiKey,
      model: side.model,
      baseUrl: side.baseUrl,
      maxTokens: 2048,
      temperature: 0.3,
    });
  }

  return createOfficeAgent({ llm, sideLlm, baseDir: DATA_DIR, model: main.model });
}
