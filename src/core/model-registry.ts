/**
 * Model Registry — 从 .env 自动解析模型配置
 *
 * 约定：模型名转大写、连字符转下划线，作为 env key 前缀。
 * 例如 LLM_MODEL=glm-5-fp8 → 查找 GLM_5_FP8_API_KEY 和 GLM_5_FP8_BASE_URL
 *
 * 用户只需在 .env 顶部改 LLM_MODEL / SIDE_LLM_MODEL，
 * 下面的注册表保留所有接入过的模型配置，系统自动匹配。
 */

export interface ResolvedModel {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * 将模型名转为 env key 前缀
 * glm-5-fp8 → GLM_5_FP8
 * qwen3.5-flash → QWEN3_5_FLASH
 * deepseek-v4-flash → DEEPSEEK_V4_FLASH
 */
function modelToEnvPrefix(model: string): string {
  return model
    .toUpperCase()
    .replace(/[-\.]/g, '_');
}

/**
 * 从 env 解析指定模型的配置
 * @param model 模型名（如 glm-5-fp8）
 * @returns 解析后的配置，找不到 API_KEY 则返回 null
 */
export function resolveModel(model: string): ResolvedModel | null {
  const prefix = modelToEnvPrefix(model);
  const apiKey = process.env[`${prefix}_API_KEY`];
  if (!apiKey) return null;

  const baseUrl = process.env[`${prefix}_BASE_URL`];
  return { model, apiKey, baseUrl };
}

/**
 * 解析主模型配置（LLM_MODEL）
 * 也支持直接设置 LLM_API_KEY + LLM_BASE_URL 作为 fallback
 */
export function resolveMainModel(): ResolvedModel {
  const model = process.env['LLM_MODEL'] ?? 'qwen-plus';

  // 先尝试从注册表解析
  const resolved = resolveModel(model);
  if (resolved) return resolved;

  // Fallback: 直接用 LLM_API_KEY / LLM_BASE_URL
  const apiKey = process.env['LLM_API_KEY'];
  if (apiKey) {
    return { model, apiKey, baseUrl: process.env['LLM_BASE_URL'] };
  }

  throw new Error(
    `模型 "${model}" 未配置。请在 .env 中添加 ${modelToEnvPrefix(model)}_API_KEY 和 ${modelToEnvPrefix(model)}_BASE_URL`,
  );
}

/**
 * 解析轻量模型配置（SIDE_LLM_MODEL）
 * 未设置则返回 null（调用方应 fallback 到主模型）
 */
export function resolveSideModel(): ResolvedModel | null {
  const model = process.env['SIDE_LLM_MODEL'];
  if (!model) return null;

  const resolved = resolveModel(model);
  if (resolved) return resolved;

  // Fallback: SIDE_LLM_API_KEY / SIDE_LLM_BASE_URL
  const apiKey = process.env['SIDE_LLM_API_KEY'];
  if (apiKey) {
    return { model, apiKey, baseUrl: process.env['SIDE_LLM_BASE_URL'] };
  }

  return null; // 找不到配置，fallback 到主模型
}
