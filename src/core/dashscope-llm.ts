/**
 * DashScope LLM Client — 阿里云百炼平台（兼容 OpenAI API 格式）
 * 支持普通请求和 SSE 流式输出。
 */
import type { LLMClient } from './llm-client.js';
import type { TokenTracker } from './token-tracker.js';

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export interface DashScopeLLMOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tokenTracker?: TokenTracker;
}

export function createDashScopeLLM(options: DashScopeLLMOptions): LLMClient {
  const {
    apiKey,
    model = 'qwen-plus',
    maxTokens = 4096,
    temperature = 0.7,
    tokenTracker,
  } = options;

  function buildMessages(system: string, user: string) {
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  function buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
  }

  return {
    // --- 非流式（用于 side query、记忆提取等轻量调用）---
    async query(system: string, user: string, signal: AbortSignal): Promise<string> {
      const response = await fetch(DASHSCOPE_BASE_URL, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          model,
          messages: buildMessages(system, user),
          max_tokens: maxTokens,
          temperature,
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown error');
        throw new Error(`DashScope API error ${response.status}: ${errorText}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        error?: { message?: string };
      };

      if (data.error) throw new Error(`DashScope: ${data.error.message}`);

      // 记录 token 用量
      if (tokenTracker && data.usage) {
        tokenTracker.record(model, data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0);
      }

      return data.choices?.[0]?.message?.content ?? '';
    },

    // --- 流式输出（SSE）---
    async *queryStream(system: string, user: string, signal: AbortSignal): AsyncGenerator<string> {
      const response = await fetch(DASHSCOPE_BASE_URL, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          model,
          messages: buildMessages(system, user),
          max_tokens: maxTokens,
          temperature,
          stream: true,
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown error');
        throw new Error(`DashScope API error ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('DashScope: no response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // 按行解析 SSE
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // 最后一行可能不完整，留到下次

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;

            const jsonStr = trimmed.slice(5).trim();
            if (jsonStr === '[DONE]') {
              // 记录 token 用量
              if (tokenTracker && lastUsage) {
                tokenTracker.record(model, lastUsage.prompt_tokens ?? 0, lastUsage.completion_tokens ?? 0);
              }
              return;
            }

            try {
              const chunk = JSON.parse(jsonStr) as {
                choices?: Array<{
                  delta?: { content?: string };
                  finish_reason?: string | null;
                }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };

              // 捕获 usage（通常在最后一个 chunk）
              if (chunk.usage) {
                lastUsage = chunk.usage;
              }

              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch {
              // 解析失败的行跳过
            }
          }
        }

        // 流结束但没收到 [DONE]，也记录 usage
        if (tokenTracker && lastUsage) {
          tokenTracker.record(model, lastUsage.prompt_tokens ?? 0, lastUsage.completion_tokens ?? 0);
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
