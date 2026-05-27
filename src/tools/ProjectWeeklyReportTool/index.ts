import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import { ProjectNotFoundError } from '../../services/project-dashboard-service.js';
import type { ProjectWeeklyReportService } from '../../services/project-weekly-report-service.js';

const GenerateInput = z.object({
  action: z.literal('generate'),
  project: z.string().optional().describe('Project name, key, id, or alias. Use this for natural language project lookup.'),
  projectId: z.string().optional().describe('Exact project id/key when known.'),
  periodStart: z.coerce.date().optional().describe('Optional report period start. Defaults to local Monday 00:00 of the current week.'),
  periodEnd: z.coerce.date().optional().describe('Optional report period end. Defaults to now.'),
  limit: z.number().int().positive().max(50).default(12),
});

const ProjectWeeklyReportToolInput = z.discriminatedUnion('action', [
  GenerateInput,
]);

export type ProjectWeeklyReportToolInput = z.infer<typeof ProjectWeeklyReportToolInput>;

export class ProjectWeeklyReportTool implements Tool<ProjectWeeklyReportToolInput, unknown> {
  readonly name = 'ProjectWeeklyReportTool';
  readonly description = [
    'Read-only project weekly report generator.',
    'Use it before answering requests like "生成 Apollo 项目周报", "这个项目本周进展怎么样", or "每周五自动发项目周报".',
    'It reads ProjectDashboard data and returns Markdown plus structured sections: weekly progress, open tasks, risks, commitments, next-week plan, and Feishu sync sources.',
    'For scheduled reports, first use this tool to verify the report shape, then use CronTool to schedule a recurring prompt that calls for the same project weekly report.',
    'If the user wants the report written to Feishu, call this tool first, then use LarkCli docs +create/+update with the Markdown.',
  ].join(' ');
  readonly inputSchema = ProjectWeeklyReportToolInput;

  constructor(private service: ProjectWeeklyReportService) {}

  isEnabled(): boolean { return true; }

  isReadOnly(_input: ProjectWeeklyReportToolInput): boolean {
    return true;
  }

  checkPermissions(_input: ProjectWeeklyReportToolInput): PermissionResult {
    return { allowed: true };
  }

  async call(input: ProjectWeeklyReportToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      if (!input.project && !input.projectId) {
        return {
          success: false,
          output: null,
          error: '请提供 project 或 projectId；如果不确定项目名，先用 ProjectDashboardTool action=list。',
        };
      }

      return {
        success: true,
        output: this.service.generate({
          project: input.project,
          projectId: input.projectId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          limit: input.limit,
        }),
      };
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
