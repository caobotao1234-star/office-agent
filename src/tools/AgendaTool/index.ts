import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import type { AgendaStore } from '../../services/agenda-store.js';

const CreateAgendaInput = z.object({
  action: z.literal('create'),
  type: z.enum(['reminder', 'deadline', 'commitment', 'follow_up']),
  title: z.string().min(1).describe('Short human-readable title of the agenda item.'),
  triggerAt: z.coerce.date().describe('When the assistant should proactively remind the user.'),
  deadlineAt: z.coerce.date().optional().describe('Actual deadline, if different from triggerAt.'),
  description: z.string().optional(),
  timezone: z.string().default('Asia/Shanghai'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  sourceMessage: z.string().optional().describe('Original user message or summary that led to this agenda item.'),
  context: z.string().optional().describe('Relevant project/user context for future reminder composition.'),
  composePrompt: z.string().optional().describe('Optional instruction for how to phrase the reminder at trigger time.'),
});

const ListAgendaInput = z.object({
  action: z.literal('list'),
  status: z.enum(['pending', 'delivered', 'cancelled']).optional(),
  type: z.enum(['reminder', 'deadline', 'commitment', 'follow_up']).optional(),
});

const UpdateAgendaInput = z.object({
  action: z.literal('update'),
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  triggerAt: z.coerce.date().optional(),
  deadlineAt: z.coerce.date().optional(),
  description: z.string().optional(),
  timezone: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['pending', 'delivered', 'cancelled']).optional(),
  sourceMessage: z.string().optional(),
  context: z.string().optional(),
  composePrompt: z.string().optional(),
});

const CancelAgendaInput = z.object({
  action: z.literal('cancel'),
  id: z.string().min(1),
});

const AgendaToolInput = z.discriminatedUnion('action', [
  CreateAgendaInput,
  ListAgendaInput,
  UpdateAgendaInput,
  CancelAgendaInput,
]);

export type AgendaToolInput = z.infer<typeof AgendaToolInput>;

export class AgendaTool implements Tool<AgendaToolInput, unknown> {
  readonly name = 'AgendaTool';
  readonly description = [
    'Create and manage proactive agenda items for reminders, deadlines, commitments, and follow-ups.',
    'The LLM should call this tool autonomously when the user states a concrete reminder time, deadline, commitment, or follow-up point.',
    'Do not call it for every conversation turn; call it only when there is a clear time or useful follow-up trigger.',
    'Use triggerAt for the proactive reminder time. For deadlines, also set deadlineAt if the actual due time differs from reminder time.',
    'At trigger time, AgendaScheduler will call the LLM ReminderComposer to generate the final message before pushing it to the user.',
  ].join(' ');
  readonly inputSchema = AgendaToolInput;

  constructor(private agendaStore: AgendaStore) {}

  isEnabled(): boolean { return true; }

  isReadOnly(input: AgendaToolInput): boolean {
    return input.action === 'list';
  }

  checkPermissions(_input: AgendaToolInput): PermissionResult {
    return { allowed: true };
  }

  async call(input: AgendaToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'create': {
          const item = this.agendaStore.create({
            type: input.type,
            title: input.title,
            triggerAt: input.triggerAt,
            deadlineAt: input.deadlineAt,
            description: input.description,
            timezone: input.timezone,
            priority: input.priority,
            source: 'llm',
            sourceMessage: input.sourceMessage,
            context: input.context,
            composePrompt: input.composePrompt,
          });
          return { success: true, output: item };
        }
        case 'list': {
          return { success: true, output: this.agendaStore.list({ status: input.status, type: input.type }) };
        }
        case 'update': {
          const item = this.agendaStore.update(input.id, {
            title: input.title,
            triggerAt: input.triggerAt,
            deadlineAt: input.deadlineAt,
            description: input.description,
            timezone: input.timezone,
            priority: input.priority,
            status: input.status,
            sourceMessage: input.sourceMessage,
            context: input.context,
            composePrompt: input.composePrompt,
          });
          return { success: true, output: item };
        }
        case 'cancel': {
          return { success: true, output: this.agendaStore.cancel(input.id) };
        }
      }
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
