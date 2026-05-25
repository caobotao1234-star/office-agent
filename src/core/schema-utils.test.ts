import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from './schema-utils.js';

function containsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([entryKey, entryValue]) => entryKey === key || containsKey(entryValue, key));
}

function containsEmptyObject(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsEmptyObject);
  if (!value || typeof value !== 'object') return false;
  const entries = Object.entries(value);
  return entries.length === 0 || entries.some(([, entryValue]) => containsEmptyObject(entryValue));
}

describe('schema-utils', () => {
  it('converts discriminated unions to provider-compatible object schemas', () => {
    const schema = z.discriminatedUnion('action', [
      z.object({
        action: z.literal('create'),
        description: z.string().min(1),
        dueDate: z.coerce.date().optional(),
        priority: z.enum(['high', 'medium']).default('medium'),
      }),
      z.object({
        action: z.literal('list'),
        status: z.enum(['pending', 'done']).optional(),
      }),
    ]);

    const jsonSchema = zodToJsonSchema(schema);

    expect(jsonSchema).toMatchObject({
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'list'] },
        description: { type: 'string' },
        dueDate: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium'] },
        status: { type: 'string', enum: ['pending', 'done'] },
      },
      required: ['action'],
      additionalProperties: false,
    });
    expect(containsKey(jsonSchema, 'oneOf')).toBe(false);
    expect(containsKey(jsonSchema, 'const')).toBe(false);
    expect(containsKey(jsonSchema, 'default')).toBe(false);
    expect(containsEmptyObject(jsonSchema)).toBe(false);
  });
});
