import { createDashScopeLLM } from './dashscope-llm.js';
import { createDeepSeekLLM } from './deepseek-llm.js';
import type { LLMClient } from './llm-client.js';
import type { TokenTracker } from './token-tracker.js';

export type LLMProviderName = 'dashscope' | 'deepseek';

export interface LLMProviderConfig {
  provider: LLMProviderName;
  model: string;
}

export interface ConfiguredLLM {
  llm: LLMClient;
  provider: LLMProviderName;
  model: string;
}

export function resolveLLMProvider(modelOverride?: string): LLMProviderConfig {
  const explicitProvider = process.env['OFFICE_AGENT_LLM_PROVIDER']?.trim().toLowerCase();
  const provider = normalizeProvider(explicitProvider)
    ?? (modelOverride?.startsWith('deepseek-') ? 'deepseek' : 'dashscope');

  if (provider === 'deepseek') {
    return {
      provider,
      model: modelOverride ?? process.env['DEEPSEEK_MODEL'] ?? 'deepseek-v4-pro',
    };
  }

  return {
    provider,
    model: modelOverride ?? process.env['DASHSCOPE_MODEL'] ?? 'qwen-plus',
  };
}

export function createConfiguredLLM(options: {
  modelOverride?: string;
  tokenTracker?: TokenTracker;
  maxTokens?: number;
  temperature?: number;
} = {}): ConfiguredLLM {
  const config = resolveLLMProvider(options.modelOverride);
  const maxTokens = options.maxTokens ?? 4096;
  const temperature = options.temperature ?? 0.7;

  if (config.provider === 'deepseek') {
    const apiKey = process.env['DEEPSEEK_API_KEY'];
    if (!apiKey) {
      throw new Error('缺少 DEEPSEEK_API_KEY。请在 .env 中设置 DEEPSEEK_API_KEY=sk-xxx，或把 OFFICE_AGENT_LLM_PROVIDER 改回 dashscope。');
    }
    return {
      ...config,
      llm: createDeepSeekLLM({
        apiKey,
        model: config.model,
        baseURL: process.env['DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com',
        maxTokens,
        temperature,
        thinking: parseThinking(process.env['DEEPSEEK_THINKING']),
        reasoningEffort: parseReasoningEffort(process.env['DEEPSEEK_REASONING_EFFORT']),
        tokenTracker: options.tokenTracker,
      }),
    };
  }

  const apiKey = process.env['DASHSCOPE_API_KEY'];
  if (!apiKey) {
    throw new Error('缺少 DASHSCOPE_API_KEY。请在 .env 中设置 DASHSCOPE_API_KEY=sk-xxx，或配置 OFFICE_AGENT_LLM_PROVIDER=deepseek。');
  }

  return {
    ...config,
    llm: createDashScopeLLM({
      apiKey,
      model: config.model,
      maxTokens,
      temperature,
      tokenTracker: options.tokenTracker,
    }),
  };
}

function normalizeProvider(value: string | undefined): LLMProviderName | undefined {
  if (!value) return undefined;
  if (value === 'dashscope' || value === 'qwen' || value === 'bailian') return 'dashscope';
  if (value === 'deepseek') return 'deepseek';
  throw new Error(`未知 OFFICE_AGENT_LLM_PROVIDER: ${value}。可选值：dashscope / deepseek`);
}

function parseThinking(value: string | undefined): 'enabled' | 'disabled' {
  if (value === 'disabled') return 'disabled';
  return 'enabled';
}

function parseReasoningEffort(value: string | undefined): 'high' | 'max' {
  if (value === 'max' || value === 'xhigh') return 'max';
  return 'high';
}
