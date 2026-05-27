import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import { ProjectDashboardService, ProjectNotFoundError } from '../../services/project-dashboard-service.js';

const ListProjectsInput = z.object({
  action: z.literal('list'),
  limit: z.number().int().positive().max(50).default(20),
});

const GetProjectDashboardInput = z.object({
  action: z.literal('get'),
  project: z.string().optional().describe('Project name, key, id, or alias. Use this for natural language project lookup.'),
  projectId: z.string().optional().describe('Exact project id/key when known.'),
  limit: z.number().int().positive().max(50).default(20),
});

const ProjectDashboardToolInput = z.discriminatedUnion('action', [
  ListProjectsInput,
  GetProjectDashboardInput,
]);

export type ProjectDashboardToolInput = z.infer<typeof ProjectDashboardToolInput>;

export class ProjectDashboardTool implements Tool<ProjectDashboardToolInput, unknown> {
  readonly name = 'ProjectDashboardTool';
  readonly description = [
    'Read-only project dashboard for secretary-style project status answers.',
    'Use it before answering questions like "这个项目现在怎么样", "Apollo 有什么风险", "项目下一步是什么", or "列一下项目状态".',
    'It aggregates OfficeContext records, local tasks, Agenda reminders/deadlines/commitments, and Feishu sync source status.',
    'Use action "list" to discover projects, and action "get" to generate a structured dashboard for one project.',
    'Do not invent project status if this tool returns not found; show candidates or ask the user to clarify.',
  ].join(' ');
  readonly inputSchema = ProjectDashboardToolInput;

  constructor(private service: ProjectDashboardService) {}

  isEnabled(): boolean { return true; }

  isReadOnly(_input: ProjectDashboardToolInput): boolean {
    return true;
  }

  checkPermissions(_input: ProjectDashboardToolInput): PermissionResult {
    return { allowed: true };
  }

  async call(input: ProjectDashboardToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'list':
          return { success: true, output: { projects: this.service.listProjects({ limit: input.limit }) } };
        case 'get':
          if (!input.project && !input.projectId) {
            return {
              success: false,
              output: { candidates: this.service.listProjects({ limit: 10 }) },
              error: '请提供 project 或 projectId；如果不确定项目名，先用 action=list。',
            };
          }
          return {
            success: true,
            output: this.service.buildDashboard({
              project: input.project,
              projectId: input.projectId,
              limit: input.limit,
            }),
          };
      }
    } catch (err) {
      if (err instanceof ProjectNotFoundError) {
        return {
          success: false,
          output: err.details,
          error: `未找到项目：${err.details.project || '(empty)'}`,
        };
      }
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
