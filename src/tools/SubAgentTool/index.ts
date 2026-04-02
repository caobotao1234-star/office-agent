/**
 * SubAgentTool — Tool_System wrapper for SubAgentManager.
 * Allows Main_Agent to manage Sub_Agents via LLM tool calls.
 *
 * Operations: create, delegate, list, archive
 *
 * Requirements: 8.1, 8.3, 8.5
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import { SubAgentManager } from '../../core/sub-agent-manager.js';

// ============================================================
// Input Schema (discriminated union on "action")
// ============================================================

const CreateInput = z.object({
  action: z.literal('create'),
  projectName: z.string().min(1),
  initialContext: z.string().default(''),
});

const DelegateInput = z.object({
  action: z.literal('delegate'),
  agentId: z.string().min(1),
  message: z.string().min(1),
});

const ListInput = z.object({
  action: z.literal('list'),
  status: z.enum(['active', 'archived']).optional(),
});

const ArchiveInput = z.object({
  action: z.literal('archive'),
  agentId: z.string().min(1),
});

const SubAgentInput = z.discriminatedUnion('action', [
  CreateInput,
  DelegateInput,
  ListInput,
  ArchiveInput,
]);

export type SubAgentInput = z.infer<typeof SubAgentInput>;

// ============================================================
// SubAgentTool
// ============================================================

export class SubAgentTool implements Tool<SubAgentInput, unknown> {
  readonly name = 'SubAgentTool';
  readonly description =
    'Manage project-level Sub_Agents: create, delegate tasks, list, and archive.';
  readonly inputSchema = SubAgentInput;
  readonly parametersJsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'delegate', 'list', 'archive'], description: 'The operation to perform' },
      projectName: { type: 'string', description: 'Project name (for create)' },
      initialContext: { type: 'string', description: 'Initial context (for create)' },
      agentId: { type: 'string', description: 'Agent ID (for delegate/archive)' },
      message: { type: 'string', description: 'Message to delegate' },
      status: { type: 'string', enum: ['active', 'archived'], description: 'Filter by status (for list)' },
    },
    required: ['action'],
  };

  private manager: SubAgentManager;
  private enabled = true;

  constructor(manager: SubAgentManager) {
    this.manager = manager;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isReadOnly(input: SubAgentInput): boolean {
    return input.action === 'list';
  }

  checkPermissions(_input: SubAgentInput): PermissionResult {
    return { allowed: true };
  }

  requiresUserConfirmation(input: SubAgentInput): boolean {
    // create and archive are write operations that need user confirmation
    return input.action === 'create' || input.action === 'archive';
  }

  async call(input: SubAgentInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'create': {
          const result = await this.manager.create(input.projectName, input.initialContext);
          return {
            success: true,
            output: {
              agent: {
                id: result.agent.id,
                projectId: result.agent.projectId,
                projectName: result.agent.projectName,
                status: result.agent.status,
                createdAt: result.agent.createdAt.toISOString(),
              },
              requiresConfirmation: result.requiresConfirmation,
            },
          };
        }

        case 'delegate': {
          const response = await this.manager.delegate(input.agentId, input.message);
          return { success: true, output: { response } };
        }

        case 'list': {
          const agents = this.manager.list(input.status).map((a) => ({
            id: a.id,
            projectId: a.projectId,
            projectName: a.projectName,
            status: a.status,
            createdAt: a.createdAt.toISOString(),
          }));
          return { success: true, output: { agents } };
        }

        case 'archive': {
          await this.manager.archive(input.agentId);
          return { success: true, output: { archived: true } };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: null, error: message };
    }
  }
}
