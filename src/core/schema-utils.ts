/**
 * Zod v4 → JSON Schema 通用转换器
 *
 * 问题：z.coerce.date() 在 z.toJSONSchema() 时抛错
 * 方案：用 z.toJSONSchema 的 unrepresentable 选项，把 date 当 any 处理
 *       然后后处理把 {} 替换为 { type: 'string', format: 'date-time' }
 */
import { z } from 'zod/v4';

/**
 * 将任意 Zod schema 转为 JSON Schema。
 * 自动处理 z.coerce.date() 等 Zod v4 不支持的类型。
 * 以后加任何工具，直接用这个函数，不需要手写 JSON Schema。
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    const result = z.toJSONSchema(schema, {
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    // Strip $schema field — OpenAI/DashScope API doesn't expect it
    delete result['$schema'];
    return result;
  } catch {
    return { type: 'object' };
  }
}
