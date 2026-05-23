import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { MemorySystem } from '../../core/memory-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import type { AgendaStore } from '../../services/agenda-store.js';
import {
  OfficeContextSourceSchema,
  OfficeContextTypeSchema,
  type OfficeContextSource,
  type OfficeContextStore,
} from '../../services/office-context-store.js';

const CaptureSourceTypeSchema = z.enum([
  'conversation',
  'feishu_doc',
  'feishu_message',
  'feishu_calendar',
  'feishu_base',
  'manual',
  'import',
  'tool',
]);

const MemoryTypeSchema = z.enum([
  'preference',
  'task',
  'project_context',
  'colleague',
  'conversation_summary',
  'decision',
  'commitment',
]);

const SourceRefInput = z.object({
  type: OfficeContextSourceSchema.optional(),
  id: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  observedAt: z.coerce.date().optional(),
});

const RelationInput = z.object({
  type: z.string().min(1),
  targetId: z.string().optional(),
  targetKey: z.string().optional(),
  targetTitle: z.string().optional(),
  description: z.string().optional(),
});

const CapturedContextInput = z.object({
  type: OfficeContextTypeSchema,
  key: z.string().optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  status: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  projectId: z.string().optional(),
  sourceRefs: z.array(SourceRefInput).default([]),
  relations: z.array(RelationInput).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0.7),
});

const CapturedMemoryInput = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  type: MemoryTypeSchema,
  tags: z.array(z.string()).default([]),
  projectId: z.string().optional(),
});

const CapturedAgendaInput = z.object({
  type: z.enum(['reminder', 'deadline', 'commitment', 'follow_up']),
  title: z.string().min(1),
  triggerAt: z.coerce.date(),
  deadlineAt: z.coerce.date().optional(),
  description: z.string().optional(),
  timezone: z.string().default('Asia/Shanghai'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  sourceMessage: z.string().optional(),
  context: z.string().optional(),
  composePrompt: z.string().optional(),
});

const CaptureInput = z.object({
  action: z.literal('capture'),
  sourceType: CaptureSourceTypeSchema,
  sourceId: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourceTitle: z.string().optional(),
  observedAt: z.coerce.date().optional(),
  contexts: z.array(CapturedContextInput).default([]),
  memories: z.array(CapturedMemoryInput).default([]),
  agendaItems: z.array(CapturedAgendaInput).default([]),
  note: z.string().optional().describe('Short explanation of what was captured and why.'),
});

const KnowledgeCaptureToolInput = z.discriminatedUnion('action', [CaptureInput]);

export type KnowledgeCaptureToolInput = z.infer<typeof KnowledgeCaptureToolInput>;

export class KnowledgeCaptureTool implements Tool<KnowledgeCaptureToolInput, unknown> {
  readonly name = 'KnowledgeCaptureTool';
  readonly description = [
    'Batch-capture useful office knowledge when the conversation or a fetched source contains durable context.',
    'Use this tool autonomously when there are people, projects, documents, meetings, business processes, decisions, commitments, deadlines, or loose facts worth saving.',
    'Do not call it every turn. Call it only when there is clear useful context to extract.',
    'The LLM supplies structured extracted items; this tool validates and writes them to OfficeContextTool storage, MemorySystem, and AgendaStore.',
    'Use contexts for structured entities and relationships, memories for loose facts/preferences/notes, and agendaItems for concrete reminders, deadlines, commitments, or follow-ups.',
  ].join(' ');
  readonly inputSchema = KnowledgeCaptureToolInput;

  constructor(
    private officeContextStore: OfficeContextStore,
    private memorySystem: MemorySystem,
    private agendaStore: AgendaStore,
  ) {}

  isEnabled(): boolean { return true; }

  isReadOnly(): boolean { return false; }

  checkPermissions(_input: KnowledgeCaptureToolInput): PermissionResult {
    return { allowed: true };
  }

  async call(input: KnowledgeCaptureToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      const source = buildSource(input);
      const now = input.observedAt ?? new Date();

      const contexts = input.contexts.map((item) => this.officeContextStore.upsert({
        type: item.type,
        key: item.key,
        title: item.title,
        summary: item.summary,
        status: item.status,
        aliases: item.aliases,
        tags: item.tags,
        projectId: item.projectId,
        source: source.officeSource,
        sourceRefs: mergeCaptureSourceRefs(source.ref, item.sourceRefs, source.officeSource),
        relations: item.relations,
        metadata: item.metadata,
        confidence: item.confidence,
        lastSeenAt: now,
      }));

      const memories = [];
      for (const item of input.memories) {
        memories.push(await this.memorySystem.store({
          title: item.title,
          content: item.content,
          type: item.type,
          tags: item.tags,
          source: source.memorySource,
          projectId: item.projectId,
          updatedAt: now,
        }));
      }

      const agendaItems = input.agendaItems.map((item) => this.agendaStore.create({
        type: item.type,
        title: item.title,
        triggerAt: item.triggerAt,
        deadlineAt: item.deadlineAt,
        description: item.description,
        timezone: item.timezone,
        priority: item.priority,
        source: 'llm',
        sourceMessage: item.sourceMessage ?? input.note,
        context: item.context,
        composePrompt: item.composePrompt,
      }));

      return {
        success: true,
        output: {
          counts: {
            contexts: contexts.length,
            memories: memories.length,
            agendaItems: agendaItems.length,
          },
          contexts,
          memories,
          agendaItems,
          source,
        },
      };
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function buildSource(input: z.infer<typeof CaptureInput>): {
  officeSource: OfficeContextSource;
  memorySource: 'user_input' | 'feishu_doc' | 'feishu_message' | 'auto_extract' | 'document_upload';
  ref: { id?: string; url?: string; title?: string; observedAt?: Date };
} {
  const officeSource = toOfficeSource(input.sourceType);
  const memorySource = toMemorySource(input.sourceType);
  return {
    officeSource,
    memorySource,
    ref: {
      id: input.sourceId,
      url: input.sourceUrl,
      title: input.sourceTitle,
      observedAt: input.observedAt,
    },
  };
}

function toOfficeSource(sourceType: z.infer<typeof CaptureSourceTypeSchema>): OfficeContextSource {
  switch (sourceType) {
    case 'conversation':
    case 'feishu_doc':
    case 'feishu_message':
    case 'feishu_calendar':
    case 'feishu_base':
    case 'manual':
    case 'import':
    case 'tool':
      return sourceType;
  }
}

function toMemorySource(
  sourceType: z.infer<typeof CaptureSourceTypeSchema>,
): 'user_input' | 'feishu_doc' | 'feishu_message' | 'auto_extract' | 'document_upload' {
  switch (sourceType) {
    case 'conversation':
    case 'manual':
      return 'user_input';
    case 'feishu_doc':
      return 'feishu_doc';
    case 'feishu_message':
      return 'feishu_message';
    case 'import':
      return 'document_upload';
    case 'feishu_calendar':
    case 'feishu_base':
    case 'tool':
      return 'auto_extract';
  }
}

function mergeCaptureSourceRefs(
  sourceRef: { id?: string; url?: string; title?: string; observedAt?: Date },
  itemRefs: Array<z.infer<typeof SourceRefInput>>,
  defaultType: OfficeContextSource,
) {
  const refs = [...itemRefs];
  if (sourceRef.id || sourceRef.url || sourceRef.title) {
    refs.unshift({
      type: defaultType,
      id: sourceRef.id,
      url: sourceRef.url,
      title: sourceRef.title,
      observedAt: sourceRef.observedAt,
    });
  }
  return refs.map((ref) => ({
    type: ref.type ?? defaultType,
    id: ref.id,
    url: ref.url,
    title: ref.title,
    observedAt: ref.observedAt,
  }));
}
