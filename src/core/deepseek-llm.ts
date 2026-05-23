/**
 * DeepSeek LLM Client — official OpenAI-compatible API.
 */
import type { LLMClient, LLMMessage, LLMQueryResult, LLMToolCall, LLMToolDef } from './llm-client.js';
import type { TokenTracker } from './token-tracker.js';
import { logger } from './logger.js';

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export interface DeepSeekLLMOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  maxTokens?: number;
  temperature?: number;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'high' | 'max';
  tokenTracker?: TokenTracker;
}

export function createDeepSeekLLM(options: DeepSeekLLMOptions): LLMClient {
  const {
    apiKey,
    model = 'deepseek-v4-pro',
    baseURL = DEFAULT_DEEPSEEK_BASE_URL,
    maxTokens = 4096,
    temperature = 0.7,
    thinking = 'enabled',
    reasoningEffort = 'high',
    tokenTracker,
  } = options;

  const endpoint = `${baseURL.replace(/\/+$/, '')}/chat/completions`;

  function buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
  }

  function buildBody(input: {
    messages: LLMMessage[];
    tools?: LLMToolDef[];
    stream?: boolean;
  }): Record<string, unknown> {
    return {
      model,
      messages: input.messages,
      tools: input.tools && input.tools.length > 0 ? input.tools : undefined,
      max_tokens: maxTokens,
      temperature,
      stream: input.stream,
      thinking: { type: thinking },
      reasoning_effort: reasoningEffort,
    };
  }

  async function parseError(response: Response): Promise<Error> {
    const errorText = await response.text().catch(() => 'unknown error');
    return new Error(`DeepSeek API error ${response.status}: ${errorText}`);
  }

  function recordUsage(
    usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
    source: 'chat' | 'tool_call' | 'side_query',
  ): void {
    if (!tokenTracker || !usage) return;
    tokenTracker.record(model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, source);
    logger.debug('tokens recorded', {
      source,
      prompt: usage.prompt_tokens,
      completion: usage.completion_tokens,
    }, 'DeepSeek');
  }

  return {
    capabilities: {
      vision: false,
    },

    async query(system: string, user: string, signal: AbortSignal): Promise<string> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(buildBody({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        })),
        signal,
      });

      if (!response.ok) throw await parseError(response);

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      if (data.error) throw new Error(`DeepSeek: ${data.error.message}`);

      recordUsage(data.usage, 'side_query');
      return data.choices?.[0]?.message?.content ?? '';
    },

    async *queryStream(system: string, user: string, signal: AbortSignal): AsyncGenerator<string> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(buildBody({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          stream: true,
        })),
        signal,
      });

      if (!response.ok) throw await parseError(response);
      if (!response.body) throw new Error('DeepSeek: no response body for streaming');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (jsonStr === '[DONE]') {
              recordUsage(lastUsage, 'chat');
              return;
            }

            try {
              const chunk = JSON.parse(jsonStr) as {
                choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              if (chunk.usage) lastUsage = chunk.usage;
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) yield content;
            } catch {
              // Ignore malformed SSE fragments.
            }
          }
        }
        recordUsage(lastUsage, 'chat');
      } finally {
        reader.releaseLock();
      }
    },

    async queryWithTools(
      messages: LLMMessage[],
      tools: LLMToolDef[],
      signal: AbortSignal,
    ): Promise<LLMQueryResult> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(buildBody({ messages, tools })),
        signal,
      });

      if (!response.ok) throw await parseError(response);

      const data = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      if (data.error) throw new Error(`DeepSeek: ${data.error.message}`);

      const msg = data.choices?.[0]?.message;
      const toolCalls: LLMToolCall[] | null = msg?.tool_calls?.map((tc) => ({
        id: tc.id,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })) ?? null;

      recordUsage(data.usage, toolCalls && toolCalls.length > 0 ? 'tool_call' : 'chat');
      return {
        content: msg?.content ?? null,
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : null,
      };
    },
  };
}
