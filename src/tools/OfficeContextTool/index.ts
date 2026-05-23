import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import {
  OfficeContextSourceSchema,
  OfficeContextTypeSchema,
  type OfficeContextStore,
} from '../../services/office-context-store.js';

const SourceRefSchema = z.object({
  type: OfficeContextSourceSchema,
  id: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  observedAt: z.coerce.date().optional(),
});

const RelationSchema = z.object({
  type: z.string().min(1).describe('Relationship verb, e.g. owns, reports_to, blocks, produced, references.'),
  targetId: z.string().optional(),
  targetKey: z.string().optional(),
  targetTitle: z.string().optional(),
  description: z.string().optional(),
});

const UpsertContextInput = z.object({
  action: z.literal('upsert'),
  type: OfficeContextTypeSchema,
  key: z.string().optional().describe('Stable dedupe key, e.g. "project:apollo" or "person:zhang-san".'),
  title: z.string().min(1),
  summary: z.string().min(1),
  status: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  projectId: z.string().optional(),
  source: OfficeContextSourceSchema.default('conversation'),
  sourceRefs: z.array(SourceRefSchema).default([]),
  relations: z.array(RelationSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0.7),
  lastSeenAt: z.coerce.date().optional(),
});

const SearchContextInput = z.object({
  action: z.literal('search'),
  keyword: z.string().optional(),
  type: OfficeContextTypeSchema.optional(),
  projectId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: OfficeContextSourceSchema.optional(),
  limit: z.number().int().positive().max(100).default(20),
});

const ListContextInput = z.object({
  action: z.literal('list'),
  type: OfficeContextTypeSchema.optional(),
  projectId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: OfficeContextSourceSchema.optional(),
  limit: z.number().int().positive().max(100).default(50),
});

const GetContextInput = z.object({
  action: z.literal('get'),
  idOrKey: z.string().min(1),
});

const DeleteContextInput = z.object({
  action: z.literal('delete'),
  idOrKey: z.string().min(1),
});

const OfficeContextToolInput = z.discriminatedUnion('action', [
  UpsertContextInput,
  SearchContextInput,
  ListContextInput,
  GetContextInput,
  DeleteContextInput,
]);

export type OfficeContextToolInput = z.infer<typeof OfficeContextToolInput>;

export class OfficeContextTool implements Tool<OfficeContextToolInput, unknown> {
  readonly name = 'OfficeContextTool';
  readonly description = [
    'Maintain the structured office context graph for a secretary-style agent.',
    'Use it for people, projects, documents, meetings, tasks, business processes, relationships, durable knowledge, and miscellaneous office context.',
    'Search it before answering questions about project status, stakeholders, documents, meetings, responsibilities, business processes, or prior context.',
    'Upsert records when useful context is learned from conversation, Feishu docs/messages/calendar/base, or tool results.',
    'Use stable keys such as project:<slug>, person:<name>, doc:<token>, meeting:<date-topic>, process:<name> to avoid duplicates.',
    'Keep summaries concise and include sourceRefs whenever the source is known.',
  ].join(' ');
  readonly inputSchema = OfficeContextToolInput;

  constructor(private store: OfficeContextStore) {}

  isEnabled(): boolean { return true; }

  isReadOnly(input: OfficeContextToolInput): boolean {
    return input.action === 'search' || input.action === 'list' || input.action === 'get';
  }

  checkPermissions(_input: OfficeContextToolInput): PermissionResult {
    return { allowed: true };
  }

  async call(input: OfficeContextToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'upsert': {
          const record = this.store.upsert({
            type: input.type,
            key: input.key,
            title: input.title,
            summary: input.summary,
            status: input.status,
            aliases: input.aliases,
            tags: input.tags,
            projectId: input.projectId,
            source: input.source,
            sourceRefs: input.sourceRefs,
            relations: input.relations,
            metadata: input.metadata,
            confidence: input.confidence,
            lastSeenAt: input.lastSeenAt,
          });
          return { success: true, output: record };
        }
        case 'search': {
          return {
            success: true,
            output: this.store.search({
              keyword: input.keyword,
              type: input.type,
              projectId: input.projectId,
              tags: input.tags,
              source: input.source,
              limit: input.limit,
            }),
          };
        }
        case 'list': {
          return {
            success: true,
            output: this.store.list({
              type: input.type,
              projectId: input.projectId,
              tags: input.tags,
              source: input.source,
              limit: input.limit,
            }),
          };
        }
        case 'get': {
          const record = this.store.get(input.idOrKey);
          if (!record) return { success: false, output: null, error: `Office context not found: ${input.idOrKey}` };
          return { success: true, output: record };
        }
        case 'delete': {
          const deleted = this.store.delete(input.idOrKey);
          if (!deleted) return { success: false, output: null, error: `Office context not found: ${input.idOrKey}` };
          return { success: true, output: { deleted: true, idOrKey: input.idOrKey } };
        }
      }
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
