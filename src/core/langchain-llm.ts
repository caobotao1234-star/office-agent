/**
 * LangChain LLM Client — 用 @langchain/openai 的 ChatOpenAI 替代手搓的 fetch 调用
 *
 * ============================================================
 * 🎓 LangChain 学习笔记 — Step 1: 模型调用层
 * ============================================================
 *
 * 【手搓版做了什么】(dashscope-llm.ts, ~200 行)
 *   1. 手动拼 fetch 请求 URL、headers、body
 *   2. 手动解析 SSE 流（逐行读取 data: 前缀，处理 [DONE] 标记）
 *   3. 手动处理 tool_calls 的 JSON 解析
 *   4. 手动拼接 /chat/completions 路径
 *   5. 手动管理 token 用量统计
 *
 * 【LangChain 帮你做了什么】
 *   1. ChatOpenAI 类自动处理所有 OpenAI 兼容 API 的请求格式
 *      - 你只需要传 model、apiKey、baseURL，它帮你拼好一切
 *      - 类比：手搓 = 自己写 HTTP 请求库；LangChain = 用 axios
 *
 *   2. .invoke() 自动处理非流式调用
 *      - 手搓版：手动 fetch → 解析 JSON → 提取 choices[0].message.content
 *      - LangChain：model.invoke([messages]) → 直接拿到 AIMessage 对象
 *
 *   3. .stream() 自动处理 SSE 流式输出
 *      - 手搓版：手动 ReadableStream → TextDecoder → 按行分割 → 解析 JSON
 *      - LangChain：for await (const chunk of model.stream()) → 直接拿到文本
 *
 *   4. .bindTools() + .invoke() 自动处理 function calling
 *      - 手搓版：手动构造 tools 数组 → 手动解析 tool_calls 响应
 *      - LangChain：model.bindTools(tools).invoke() → 自动返回 ToolCall 对象
 *
 *   5. 自动处理不同 provider 的差异
 *      - DashScope、DeepSeek、GLM 都是 OpenAI 兼容格式，但有细微差异
 *      - ChatOpenAI 内部已经处理了这些差异（重试、错误格式、流式协议等）
 *
 * 【为什么还保留 LLMClient 接口？】
 *   这一步我们用"适配器模式"：LangChain 的 ChatOpenAI 在内部工作，
 *   但对外仍然暴露 LLMClient 接口，这样 QueryEngine、MemorySystem 等
 *   不需要改动。后续 Step 3 会把 QueryEngine 也换成 LangChain agent，
 *   届时这个适配器就不需要了。
 *
 * 【关键概念】
 *   - ChatOpenAI：LangChain 对 OpenAI 兼容 API 的封装类
 *   - HumanMessage / AIMessage / SystemMessage / ToolMessage：标准化消息类型
 *   - .bindTools()：把工具定义绑定到模型上，让模型知道可以调用哪些工具
 *   - .invoke() / .stream()：统一的调用接口（Runnable 协议）
 * ============================================================
 */
import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  LLMClient,
  LLMMessage,
  LLMToolDef,
  LLMQueryResult,
  LLMToolCall,
} from './llm-client.js';
import type { TokenTracker } from './token-tracker.js';
import { logger } from './logger.js';

// ============================================================
// 配置接口
// ============================================================

export interface LangChainLLMOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tokenTracker?: TokenTracker;
  /** OpenAI 兼容 API 的 base URL（DashScope / DeepSeek / GLM 等） */
  baseUrl?: string;
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建基于 LangChain ChatOpenAI 的 LLM 客户端
 *
 * 对比手搓版 createDashScopeLLM：
 *   手搓版：~200 行（fetch + SSE 解析 + tool_calls 处理）
 *   LangChain 版：~120 行（大部分是适配器代码和注释，核心逻辑 ~30 行）
 */
export function createLangChainLLM(options: LangChainLLMOptions): LLMClient {
  const {
    apiKey,
    model = 'qwen-plus',
    maxTokens = 4096,
    temperature = 0.7,
    tokenTracker,
    baseUrl,
  } = options;

  /**
   * 🎓 这就是 LangChain 的核心简化：
   *
   * 手搓版需要：
   *   const apiUrl = baseUrl ? (baseUrl.endsWith('/chat/completions') ? ...) : DASHSCOPE_BASE_URL;
   *   function buildHeaders() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }; }
   *   const response = await fetch(apiUrl, { method: 'POST', headers: buildHeaders(), body: JSON.stringify({...}) });
   *   // ... 然后手动解析响应
   *
   * LangChain 版只需要 new ChatOpenAI({...})，它自动处理：
   *   - URL 拼接（baseURL + /chat/completions）
   *   - 请求头（Authorization: Bearer xxx）
   *   - 请求体序列化
   *   - 响应解析
   *   - 错误处理和重试
   */
  const chatModel = new ChatOpenAI({
    openAIApiKey: apiKey,
    modelName: model,
    maxTokens,
    temperature,
    // 🎓 configuration.baseURL 让 ChatOpenAI 指向任何 OpenAI 兼容 API
    // 手搓版需要自己拼 URL：baseUrl.replace(/\/+$/, '') + '/chat/completions'
    // LangChain 自动处理这个路径拼接
    configuration: baseUrl ? { baseURL: baseUrl } : undefined,
  });

  return {
    // ============================================================
    // query() — 简单文本查询（用于 side query：记忆检索、压缩等）
    // ============================================================
    /**
     * 🎓 对比：
     *   手搓版 query()：~30 行
     *     - fetch(apiUrl, { body: JSON.stringify({ model, messages, max_tokens, temperature }) })
     *     - const data = await response.json()
     *     - return data.choices?.[0]?.message?.content ?? ''
     *
     *   LangChain 版：~5 行核心代码
     *     - chatModel.invoke([messages]) → AIMessage
     *     - 返回 message.content
     *
     *   LangChain 自动处理了：错误抛出、响应格式验证、content 提取
     */
    async query(system: string, user: string, _signal: AbortSignal): Promise<string> {
      const messages: BaseMessage[] = [
        new SystemMessage(system),
        new HumanMessage(user),
      ];

      // 🎓 .invoke() 是 LangChain 的统一调用接口（Runnable 协议）
      // 所有 LangChain 组件（模型、链、agent）都有 .invoke()
      // 手搓版每个组件的调用方式都不一样
      const response = await chatModel.invoke(messages);

      // 记录 token 用量（如果有 tracker）
      // 🎓 LangChain 的 AIMessage 自带 usage_metadata，不需要手动从 response.usage 提取
      if (tokenTracker && response.usage_metadata) {
        tokenTracker.record(
          model,
          response.usage_metadata.input_tokens,
          response.usage_metadata.output_tokens,
          'side_query',
        );
      }

      // 🎓 LangChain 的 AIMessage.content 已经是 string，不需要 data.choices?.[0]?.message?.content
      return typeof response.content === 'string' ? response.content : '';
    },

    // ============================================================
    // queryStream() — 流式文本输出（SSE）
    // ============================================================
    /**
     * 🎓 这是 LangChain 简化最明显的地方：
     *
     *   手搓版 queryStream()：~60 行
     *     - fetch(..., { stream: true })
     *     - const reader = response.body.getReader()
     *     - const decoder = new TextDecoder()
     *     - while (true) { const { done, value } = await reader.read(); ... }
     *     - 按行分割 → 找 "data:" 前缀 → 解析 JSON → 提取 delta.content
     *     - 处理 [DONE] 标记 → 释放 reader
     *
     *   LangChain 版：~5 行
     *     - for await (const chunk of chatModel.stream(messages))
     *     - yield chunk.content
     *
     *   LangChain 内部帮你做了所有 SSE 解析、buffer 管理、错误处理
     */
    async *queryStream(system: string, user: string, _signal: AbortSignal): AsyncGenerator<string> {
      const messages: BaseMessage[] = [
        new SystemMessage(system),
        new HumanMessage(user),
      ];

      // 🎓 .stream() 也是 Runnable 协议的一部分
      // 手搓版需要手动管理 ReadableStream + TextDecoder + SSE 解析
      // LangChain 把这一切封装成了简单的 async iterator
      for await (const chunk of await chatModel.stream(messages)) {
        const text = typeof chunk.content === 'string' ? chunk.content : '';
        if (text) {
          yield text;
        }
      }
    },

    // ============================================================
    // queryWithTools() — 原生 Function Calling
    // ============================================================
    /**
     * 🎓 对比：
     *   手搓版 queryWithTools()：~50 行
     *     - 手动构造 tools 数组放入请求体
     *     - fetch(...) → 解析响应
     *     - 手动从 data.choices[0].message.tool_calls 提取工具调用
     *     - 手动映射 { id, type, function: { name, arguments } }
     *
     *   LangChain 版：~30 行（含适配器转换代码）
     *     - chatModel.bindTools(tools).invoke(messages)
     *     - response.tool_calls 已经是解析好的对象数组
     *
     *   .bindTools() 是 LangChain 的关键抽象：
     *     它把工具定义"绑定"到模型上，模型就知道可以调用哪些工具
     *     不同 provider 的 tool 格式不同，LangChain 自动适配
     */
    async queryWithTools(
      messages: LLMMessage[],
      tools: LLMToolDef[],
      _signal: AbortSignal,
    ): Promise<LLMQueryResult> {
      // 🎓 Step 1: 把我们的 LLMMessage 格式转换为 LangChain 的 BaseMessage 格式
      // 后续 Step 3 重构 QueryEngine 后，就不需要这个转换了
      const lcMessages = messages.map(toLangChainMessage);

      // 🎓 Step 2: 把工具定义绑定到模型
      // 手搓版：把 tools 数组直接塞进 fetch body
      // LangChain：.bindTools() 创建一个"带工具的模型副本"
      const modelWithTools = tools.length > 0
        ? chatModel.bindTools(tools.map(toLangChainTool))
        : chatModel;

      // 🎓 Step 3: 调用模型
      const response = await modelWithTools.invoke(lcMessages);

      // 记录 token 用量
      if (tokenTracker && response.usage_metadata) {
        const hasToolCalls = response.tool_calls && response.tool_calls.length > 0;
        tokenTracker.record(
          model,
          response.usage_metadata.input_tokens,
          response.usage_metadata.output_tokens,
          hasToolCalls ? 'tool_call' : 'chat',
        );
        logger.debug('tokens recorded', {
          source: hasToolCalls ? 'tool_call' : 'chat',
          prompt: response.usage_metadata.input_tokens,
          completion: response.usage_metadata.output_tokens,
        }, 'LangChainLLM');
      }

      // 🎓 Step 4: 把 LangChain 的响应转回我们的 LLMQueryResult 格式
      // LangChain 的 AIMessage.tool_calls 已经是解析好的对象：
      //   { name: string, args: Record<string, unknown>, id: string }
      // 手搓版需要自己从 JSON string 解析
      const toolCalls: LLMToolCall[] | null =
        response.tool_calls && response.tool_calls.length > 0
          ? response.tool_calls.map((tc) => ({
              id: tc.id ?? '',
              type: 'function' as const,
              function: {
                name: tc.name,
                // 🎓 注意：LangChain 的 tool_calls.args 已经是对象
                // 但我们的 LLMToolCall 接口要求 arguments 是 JSON string
                // 这是因为 QueryEngine 还在用旧接口，Step 3 会消除这个转换
                arguments: JSON.stringify(tc.args),
              },
            }))
          : null;

      return {
        content: typeof response.content === 'string' ? response.content : null,
        toolCalls,
      };
    },
  };
}

// ============================================================
// 转换辅助函数
// ============================================================

/**
 * 🎓 把我们的 LLMMessage 转换为 LangChain 的 BaseMessage
 *
 * 手搓版直接把 { role, content } 对象传给 API
 * LangChain 用类型化的消息类：HumanMessage, AIMessage, SystemMessage, ToolMessage
 * 好处：类型安全，IDE 自动补全，不会拼错 role 字段
 */
function toLangChainMessage(msg: LLMMessage): BaseMessage {
  switch (msg.role) {
    case 'system':
      return new SystemMessage(
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      );

    case 'user':
      // 🎓 HumanMessage 支持多模态内容（文本 + 图片）
      // 手搓版需要自己构造 content: [{ type: 'text', text }, { type: 'image_url', ... }]
      // LangChain 的 HumanMessage 直接接受这种格式
      if (Array.isArray(msg.content)) {
        return new HumanMessage({ content: msg.content as any });
      }
      return new HumanMessage(msg.content ?? '');

    case 'assistant': {
      // 🎓 如果 assistant 消息包含 tool_calls，需要传给 AIMessage
      // 这样 LangChain 才能正确构建多轮工具调用的上下文
      const aiMsg = new AIMessage({
        content: typeof msg.content === 'string' ? msg.content : msg.content ?? '',
      });
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        aiMsg.tool_calls = msg.tool_calls.map((tc) => ({
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
          id: tc.id,
          type: 'tool_call' as const,
        }));
        // 同时设置 additional_kwargs 以确保序列化正确
        aiMsg.additional_kwargs = {
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        };
      }
      return aiMsg;
    }

    case 'tool':
      // 🎓 ToolMessage 需要 tool_call_id 来关联是哪个工具调用的结果
      // 手搓版只是 { role: 'tool', content, tool_call_id }
      // LangChain 的 ToolMessage 是类型安全的
      return new ToolMessage({
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        tool_call_id: msg.tool_call_id ?? '',
        name: msg.name,
      });

    default:
      return new HumanMessage(typeof msg.content === 'string' ? msg.content : '');
  }
}

/**
 * 🎓 把我们的 LLMToolDef 转换为 LangChain 的工具格式
 *
 * 实际上格式几乎一样（都是 OpenAI function calling 格式），
 * 但 LangChain 的 .bindTools() 接受更灵活的输入：
 *   - OpenAI 格式的 { type: 'function', function: {...} }
 *   - Zod schema
 *   - LangChain Tool 对象
 *
 * 后续 Step 2 会把工具定义也换成 LangChain 格式，届时这个转换就不需要了
 */
function toLangChainTool(tool: LLMToolDef): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters ?? { type: 'object', properties: {} },
    },
  };
}
