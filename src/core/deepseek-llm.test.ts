import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeepSeekLLM } from './deepseek-llm.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }) as Response;
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 }) as Response;
}

describe('createDeepSeekLLM', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends non-streaming chat requests to DeepSeek', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '你好' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const llm = createDeepSeekLLM({ apiKey: 'sk-test', model: 'deepseek-v4-pro' });
    const result = await llm.query('system', 'user', new AbortController().signal);

    expect(result).toBe('你好');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe('deepseek-v4-pro');
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('high');
  });

  it('streams final content and ignores reasoning content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"答案"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
      'data: [DONE]\n\n',
    ])));

    const llm = createDeepSeekLLM({ apiKey: 'sk-test' });
    const chunks: string[] = [];
    for await (const chunk of llm.queryStream!('s', 'u', new AbortController().signal)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['答案']);
  });

  it('parses tool calls from DeepSeek responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      choices: [{
        message: {
          content: null,
          reasoning_content: 'need a tool',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'TaskManager', arguments: '{"action":"list"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    })));

    const llm = createDeepSeekLLM({ apiKey: 'sk-test' });
    const result = await llm.queryWithTools!(
      [{ role: 'user', content: '列任务' }],
      [{ type: 'function', function: { name: 'TaskManager', description: 'tasks', parameters: {} } }],
      new AbortController().signal,
    );

    expect(result.content).toBeNull();
    expect(result.reasoningContent).toBe('need a tool');
    expect(result.toolCalls?.[0]?.function.name).toBe('TaskManager');
    expect(result.toolCalls?.[0]?.function.arguments).toBe('{"action":"list"}');
  });

  it('surfaces DeepSeek HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'bad key' } }, false, 401)));

    const llm = createDeepSeekLLM({ apiKey: 'sk-test' });
    await expect(llm.query('s', 'u', new AbortController().signal)).rejects.toThrow('DeepSeek API error 401');
  });
});
