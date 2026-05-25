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
    return sanitizeToolJsonSchema(result);
  } catch {
    return { type: 'object' };
  }
}

/**
 * Convert Zod's JSON Schema into the conservative subset accepted by
 * OpenAI-compatible function-calling APIs.
 *
 * DeepSeek rejects several valid JSON Schema constructs in tool definitions:
 * root oneOf, const, default, and untyped empty schemas. This sanitizer keeps
 * runtime validation in Zod, while sending the model a looser schema it can
 * accept and follow.
 */
export function sanitizeToolJsonSchema(schema: unknown): Record<string, unknown> {
  const sanitized = sanitizeSchemaNode(schema);
  if (!isPlainObject(sanitized)) return { type: 'object' };
  if (isObjectUnionSchema(sanitized)) return mergeObjectUnion(sanitized);
  if (!sanitized['type']) sanitized['type'] = 'object';
  delete sanitized['$schema'];
  return sanitized;
}

function sanitizeSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchemaNode);
  if (!isPlainObject(value)) return value;

  if (isObjectUnionSchema(value)) return mergeObjectUnion(value);

  const next: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === '$schema' || key === 'default') continue;
    if (key === 'const') {
      next['enum'] = [val];
      continue;
    }
    next[key] = sanitizeSchemaNode(val);
  }

  if (Object.keys(next).length === 0) {
    return { type: 'string' };
  }
  return next;
}

function isObjectUnionSchema(schema: Record<string, unknown>): boolean {
  const variants = getUnionVariants(schema);
  return !!variants?.length && variants.every((variant) =>
    isPlainObject(variant) && (variant['type'] === 'object' || isPlainObject(variant['properties'])),
  );
}

function getUnionVariants(schema: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(schema['oneOf'])) return schema['oneOf'];
  if (Array.isArray(schema['anyOf'])) return schema['anyOf'];
  return null;
}

function mergeObjectUnion(schema: Record<string, unknown>): Record<string, unknown> {
  const variants = (getUnionVariants(schema) ?? [])
    .map(sanitizeSchemaNode)
    .filter(isPlainObject);

  const properties: Record<string, unknown> = {};
  const requiredSets: string[][] = [];

  for (const variant of variants) {
    const variantProperties = isPlainObject(variant['properties'])
      ? variant['properties'] as Record<string, unknown>
      : {};
    for (const [key, value] of Object.entries(variantProperties)) {
      properties[key] = mergePropertySchemas(properties[key], value);
    }
    if (Array.isArray(variant['required'])) {
      requiredSets.push(variant['required'].filter((item): item is string => typeof item === 'string'));
    }
  }

  return {
    type: 'object',
    properties,
    ...(requiredSets.length > 0 ? { required: intersectRequired(requiredSets) } : {}),
    additionalProperties: false,
  };
}

function mergePropertySchemas(existing: unknown, incoming: unknown): unknown {
  if (!existing) return incoming;
  if (!isPlainObject(existing) || !isPlainObject(incoming)) return existing;

  const existingEnum = Array.isArray(existing['enum']) ? existing['enum'] : null;
  const incomingEnum = Array.isArray(incoming['enum']) ? incoming['enum'] : null;
  if (existingEnum || incomingEnum) {
    return {
      ...existing,
      ...incoming,
      enum: [...new Set([...(existingEnum ?? []), ...(incomingEnum ?? [])])],
    };
  }

  if (existing['type'] === incoming['type']) {
    return { ...existing, ...incoming };
  }
  return existing;
}

function intersectRequired(requiredSets: string[][]): string[] {
  if (requiredSets.length === 0) return [];
  return requiredSets
    .slice(1)
    .reduce((acc, set) => acc.filter((item) => set.includes(item)), [...requiredSets[0]!]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
