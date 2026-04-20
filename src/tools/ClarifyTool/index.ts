/**
 * ClarifyTool — 主动澄清工具（参考 Hermes Agent clarify_tool）
 *
 * 让 agent 向用户提出结构化的选择题或开放式问题。
 * 在飞书场景下渲染为编号列表，用户回复数字即可选择。
 *
 * 使用场景：
 * - 任务含义模糊，需要用户选择方向
 * - 有多个可行方案，让用户决策
 * - 完成任务后征求反馈
 * - 提议创建技能或更新记忆时确认
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';

const MAX_CHOICES = 4;

const ClarifyInput = z.object({
  question: z.string().min(1).describe('要向用户提出的问题'),
  choices: z.array(z.string()).max(MAX_CHOICES).optional()
    .describe('最多4个预设选项。省略则为开放式问题。用户总是可以自由回答。'),
});

export type ClarifyInput = z.infer<typeof ClarifyInput>;

export class ClarifyTool implements Tool<ClarifyInput, unknown> {
  readonly name = 'Clarify';
  readonly description = [
    '向用户提出澄清问题。支持两种模式：',
    '1. 选择题 — 提供最多4个选项，用户选一个或自由回答。',
    '2. 开放式 — 省略 choices，用户自由回答。',
    '当任务模糊、有多个方案、或需要用户决策时使用。',
    '不要用于简单的是/否确认。',
  ].join(' ');
  readonly inputSchema = ClarifyInput;

  private enabled = true;

  isEnabled(): boolean { return this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }
  isReadOnly(): boolean { return true; }
  checkPermissions(): PermissionResult { return { allowed: true }; }
  requiresUserConfirmation(): boolean { return false; }

  async call(input: ClarifyInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    const { question, choices } = input;

    // Format the question for display
    // The actual user interaction happens in the chat layer —
    // we return the formatted question as the tool result,
    // and the agent will present it to the user in its response.
    const parts: string[] = [`❓ ${question}`];

    if (choices && choices.length > 0) {
      const trimmed = choices.filter(c => c.trim()).slice(0, MAX_CHOICES);
      trimmed.forEach((c, i) => {
        parts.push(`  ${i + 1}. ${c}`);
      });
      parts.push(`  ${trimmed.length + 1}. 其他（自由回答）`);
    }

    const formatted = parts.join('\n');

    return {
      success: true,
      output: {
        question,
        choices: choices ?? null,
        formatted,
        instruction: '请将上面的问题直接展示给用户，等待用户在下一条消息中回复。不要自己回答这个问题。',
      },
    };
  }
}
