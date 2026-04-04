/**
 * Unified Error Types for Office Agent
 *
 * 规范：
 * - Tool 层：catch 后返回 { success: false, output: null, error: 人话描述 }
 * - Service 层：抛出 AppError，由调用方决定如何处理
 * - 面向用户的错误信息用中文，内部日志用英文
 */

export class AppError extends Error {
  /** Error code for programmatic handling */
  readonly code: string;
  /** User-friendly message in Chinese */
  readonly userMessage: string;
  /** Original error for logging */
  readonly cause?: Error;

  constructor(code: string, userMessage: string, internalMessage?: string, cause?: Error) {
    super(internalMessage ?? userMessage);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.cause = cause;
  }
}

// ============================================================
// Common error factories
// ============================================================

export const Errors = {
  /** Feishu API errors */
  feishuPermission: (detail: string) =>
    new AppError('FEISHU_PERMISSION', `飞书权限不足: ${detail}`, `Feishu permission denied: ${detail}`),

  feishuNotConfigured: () =>
    new AppError('FEISHU_NOT_CONFIGURED', '飞书未配置，请在 .env 中设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET'),

  feishuApiError: (status: number, msg: string) =>
    new AppError('FEISHU_API_ERROR', `飞书接口错误 (${status}): ${msg}`, `Feishu API ${status}: ${msg}`),

  /** Tool errors */
  toolNotFound: (name: string) =>
    new AppError('TOOL_NOT_FOUND', `工具 ${name} 不存在`),

  toolDisabled: (name: string) =>
    new AppError('TOOL_DISABLED', `工具 ${name} 未启用`),

  toolExecutionFailed: (name: string, detail: string) =>
    new AppError('TOOL_EXEC_FAILED', `${name} 执行失败: ${detail}`),

  /** Config errors */
  configPathNotFound: (path: string) =>
    new AppError('CONFIG_PATH_NOT_FOUND', `配置项不存在: ${path}`),

  /** LLM errors */
  llmApiError: (status: number, detail: string) =>
    new AppError('LLM_API_ERROR', `LLM 接口错误 (${status})`, `DashScope API ${status}: ${detail}`),

  llmTimeout: () =>
    new AppError('LLM_TIMEOUT', '请求超时，请稍后重试'),

  /** General */
  notFound: (what: string) =>
    new AppError('NOT_FOUND', `${what} 不存在`),

  invalidInput: (detail: string) =>
    new AppError('INVALID_INPUT', `输入无效: ${detail}`),
};

/**
 * Extract a user-friendly error message from any error.
 * Use this in tool catch blocks to ensure consistent error output.
 */
export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.userMessage;
  if (err instanceof Error) return err.message;
  return String(err);
}
