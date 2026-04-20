/**
 * Error Classifier — API 错误自动分类与恢复策略（参考 Hermes Agent error_classifier）
 *
 * 对 LLM API 错误进行细粒度分类，每种错误类型有不同的恢复策略：
 * - 限流 → 等待后重试
 * - 认证失败 → 不重试，提示用户
 * - 余额不足 → 不重试，提示用户
 * - 模型不可用 → 可降级到其他模型
 * - 网络错误 → 短暂等待后重试
 * - 上下文过长 → 触发压缩后重试
 */

export type ErrorCategory =
  | 'rate_limit'       // 429 限流
  | 'auth_failed'      // 401/403 认证失败
  | 'quota_exceeded'   // 402 余额不足
  | 'model_unavailable'// 404 模型不存在
  | 'context_too_long' // 400 上下文超长
  | 'bad_request'      // 400 其他请求错误
  | 'server_error'     // 500+ 服务端错误
  | 'network_error'    // 网络连接失败
  | 'timeout'          // 请求超时
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  retryDelayMs: number;
  userMessage: string;  // 面向用户的中文提示
}

export function classifyApiError(error: unknown): ClassifiedError {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  // Extract HTTP status code if present
  const statusMatch = msg.match(/(\d{3})/);
  const status = statusMatch ? parseInt(statusMatch[1]!, 10) : 0;

  // Rate limit (429)
  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    const delay = extractRetryDelay(msg) ?? 5000;
    return {
      category: 'rate_limit',
      message: msg,
      retryable: true,
      retryDelayMs: delay,
      userMessage: `请求太频繁，${Math.ceil(delay / 1000)}秒后自动重试...`,
    };
  }

  // Auth failed (401/403)
  if (status === 401 || status === 403 || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return {
      category: 'auth_failed',
      message: msg,
      retryable: false,
      retryDelayMs: 0,
      userMessage: 'API 认证失败，请检查 DASHSCOPE_API_KEY 配置。',
    };
  }

  // Quota exceeded (402)
  if (status === 402 || lower.includes('insufficient') || lower.includes('quota') || lower.includes('余额')) {
    return {
      category: 'quota_exceeded',
      message: msg,
      retryable: false,
      retryDelayMs: 0,
      userMessage: 'API 额度不足，请充值或更换 API Key。',
    };
  }

  // Context too long
  if (lower.includes('context length') || lower.includes('too long') || lower.includes('max_tokens') ||
      lower.includes('maximum context') || lower.includes('token limit')) {
    return {
      category: 'context_too_long',
      message: msg,
      retryable: true,
      retryDelayMs: 0,
      userMessage: '对话太长了，正在压缩上下文后重试...',
    };
  }

  // Model not found (404)
  if (status === 404 || lower.includes('model not found') || lower.includes('does not exist')) {
    return {
      category: 'model_unavailable',
      message: msg,
      retryable: false,
      retryDelayMs: 0,
      userMessage: '模型不可用，请检查 DASHSCOPE_MODEL 配置。',
    };
  }

  // Bad request (400)
  if (status === 400) {
    return {
      category: 'bad_request',
      message: msg,
      retryable: false,
      retryDelayMs: 0,
      userMessage: '请求格式错误，请稍后重试。',
    };
  }

  // Server error (500+)
  if (status >= 500) {
    return {
      category: 'server_error',
      message: msg,
      retryable: true,
      retryDelayMs: 3000,
      userMessage: '服务暂时不可用，3秒后自动重试...',
    };
  }

  // Network errors
  if (lower.includes('fetch failed') || lower.includes('econnrefused') ||
      lower.includes('enotfound') || lower.includes('network')) {
    return {
      category: 'network_error',
      message: msg,
      retryable: true,
      retryDelayMs: 2000,
      userMessage: '网络连接失败，2秒后自动重试...',
    };
  }

  // Timeout
  if (lower.includes('timeout') || lower.includes('aborted')) {
    return {
      category: 'timeout',
      message: msg,
      retryable: true,
      retryDelayMs: 1000,
      userMessage: '请求超时，正在重试...',
    };
  }

  return {
    category: 'unknown',
    message: msg,
    retryable: false,
    retryDelayMs: 0,
    userMessage: `出错了: ${msg.slice(0, 100)}`,
  };
}

/** Extract retry delay from error message (e.g. "retry after 5s") */
function extractRetryDelay(msg: string): number | null {
  const match = msg.match(/retry\s*(?:after|in)\s*(\d+)\s*(s|ms|seconds?|milliseconds?)/i);
  if (!match) return null;
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  return unit.startsWith('ms') || unit.startsWith('milli') ? value : value * 1000;
}
