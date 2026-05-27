import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import type { CommitmentTrackerService } from '../../services/commitment-tracker-service.js';

const BaseQuery = {
  project: z.string().optional().describe('Optional project name/key/alias filter.'),
  person: z.string().optional().describe('Optional person name/alias filter.'),
  status: z.enum(['pending', 'delivered', 'cancelled']).optional(),
  windowDays: z.number().int().positive().max(90).default(7),
  limit: z.number().int().positive().max(100).default(50),
};

const ListInput = z.object({
  action: z.literal('list'),
  ...BaseQuery,
});

const SummaryInput = z.object({
  action: z.literal('summary'),
  ...BaseQuery,
});

const CommitmentTrackerToolInput = z.discriminatedUnion('action', [
  ListInput,
  SummaryInput,
]);

export type CommitmentTrackerToolInput = z.infer<typeof CommitmentTrackerToolInput>;

export class CommitmentTrackerTool implements Tool<CommitmentTrackerToolInput, unknown> {
  readonly name = 'CommitmentTrackerTool';
  readonly description = [
    'Read-only commitment tracker for secretary-style follow-up.',
    'Use it before answering questions like "我答应了谁什么", "谁还欠我什么", "哪些承诺快到期", "帮我看要催谁", or "这个项目还有哪些跟进".',
    'It reads Agenda commitment/deadline/follow_up items and groups them by overdue, due soon, person, project, and rough responsibility direction.',
    'Use AgendaTool to create/update commitments; this tool only reads and summarizes.',
  ].join(' ');
  readonly inputSchema = CommitmentTrackerToolInput;

  constructor(private service: CommitmentTrackerService) {}

  isEnabled(): boolean { return true; }

  isReadOnly(_input: CommitmentTrackerToolInput): boolean {
    return true;
  }

  checkPermissions(_input: CommitmentTrackerToolInput): PermissionResult {
    return { allowed: true };
  }

  async call(input: CommitmentTrackerToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      const query = {
        project: input.project,
        person: input.person,
        status: input.status,
        windowDays: input.windowDays,
        limit: input.limit,
      };
      switch (input.action) {
        case 'list':
          return { success: true, output: { items: this.service.list(query) } };
        case 'summary':
          return { success: true, output: this.service.summarize(query) };
      }
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
