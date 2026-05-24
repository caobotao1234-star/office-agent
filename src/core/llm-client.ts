/**
 * LLM Client interface — abstract layer for LLM calls.
 */

/** Tool definition for native function calling */
export interface LLMToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

/** A tool call returned by the LLM */
export interface LLMToolCall {
  id: string;
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Result of a query that may include tool calls */
export interface LLMQueryResult {
  content: string | null;
  toolCalls: LLMToolCall[] | null;
  reasoningContent?: string | null;
}

/** Multimodal content part in OpenAI-compatible vision format. */
export type LLMContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

/** Chat message for multi-turn conversations */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | LLMContentPart[] | null;
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string | null;
}

export interface LLMCapabilities {
  vision?: boolean;
  toolCalling?: boolean;
  streaming?: boolean;
  jsonMode?: boolean;
  webSearchNative?: boolean;
  supportsImageDataUrl?: boolean;
  maxContextTokens?: number;
  reasoningContentReplay?: boolean;
}

export interface LLMClient {
  /** Provider/model capability flags used by input adapters. */
  capabilities?: LLMCapabilities;

  /** Simple query — returns text only. Used for side queries (memory, compact). */
  query(system: string, user: string, signal: AbortSignal): Promise<string>;

  /** Stream text token-by-token. Optional — falls back to query() if not implemented. */
  queryStream?(system: string, user: string, signal: AbortSignal): AsyncGenerator<string>;

  /**
   * Query with native tool calling support.
   * Sends full message history + tool definitions to the API.
   * Returns either text content or tool_calls.
   * Optional — falls back to prompt-based tool calling if not implemented.
   */
  queryWithTools?(
    messages: LLMMessage[],
    tools: LLMToolDef[],
    signal: AbortSignal,
  ): Promise<LLMQueryResult>;

  /**
   * Stream with native tool calling.
   * When the LLM returns text, yields string chunks.
   * When the LLM returns tool_calls, returns them in the final result.
   * Optional.
   */
  queryStreamWithTools?(
    messages: LLMMessage[],
    tools: LLMToolDef[],
    signal: AbortSignal,
  ): Promise<LLMQueryResult>;
}
