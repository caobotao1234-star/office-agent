/**
 * DashScope LLM Client — 阿里云百炼平台（兼容 OpenAI API 格式）
 *
 * 使用 node:https 原生请求，不引入额外 HTTP 库。
 */
import type { LLMClient } from './llm-client.js';

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export interface DashScopeLLMOptions {
  apiKey: string;
  model?: string;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
}

export function createDashScopeLLM(options: DashScopeLLMOptions): LLMClient {
  const {
    apiKey,
    model = 'qwen-plus',
    maxTokens = 4096,
    temperature = 0.7,
  } = options;

  return {
    async query(system: string, user: string, signal: AbortSignal): Promise<string> {
      const body = JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature,
      });

      const response = await fetch(DASHSCOPE_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body,
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown error');
        throw new Error(`DashScope API error ${response.status}: ${errorText}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (data.error) {
        throw new Error(`DashScope API error: ${data.error.message}`);
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('DashScope API returned empty response');
      }

      return content;
    },
  };
}
