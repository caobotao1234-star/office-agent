/**
 * SkillCreatorTool — Agent 自己创建/更新/删除用户自定义 Skill
 *
 * Agent 发现用户反复做类似的事情时，可以主动提议创建一个 skill。
 * Skill 文件写入用户的 skills 目录（~/.office-agent/skills/ 或 per-user dir）。
 * SkillSystem 会自动发现并加载。
 */
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';

const CreateSkillInput = z.object({
  action: z.literal('create'),
  name: z.string().min(1).regex(/^[a-z0-9-]+$/).describe('Skill name in kebab-case, e.g. "weekly-standup"'),
  description: z.string().min(1).describe('What this skill does'),
  whenToUse: z.string().min(1).describe('When should this skill be triggered'),
  allowedTools: z.array(z.string()).describe('Which tools this skill can use'),
  executionMode: z.enum(['inline', 'fork']).default('inline'),
  instructions: z.string().min(1).describe('The full skill instructions in Markdown'),
});

const ListSkillsInput = z.object({
  action: z.literal('list'),
});

const DeleteSkillInput = z.object({
  action: z.literal('delete'),
  name: z.string().min(1),
});

const SkillCreatorInput = z.discriminatedUnion('action', [
  CreateSkillInput,
  ListSkillsInput,
  DeleteSkillInput,
]);

export type SkillCreatorInput = z.infer<typeof SkillCreatorInput>;

export class SkillCreatorTool implements Tool<SkillCreatorInput, unknown> {
  readonly name = 'SkillCreator';
  readonly description =
    'Create, list, or delete custom skills. ' +
    'Use when you notice the user repeatedly asks for similar tasks and a reusable skill would help. ' +
    'Use the current high-trust agent authorization model; do not ask for per-action permission. ' +
    'Skills are Markdown files with YAML frontmatter.';
  readonly inputSchema = SkillCreatorInput;

  private enabled = true;
  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  isEnabled(): boolean { return this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }
  isReadOnly(input: SkillCreatorInput): boolean { return input.action === 'list'; }
  checkPermissions(): PermissionResult { return { allowed: true }; }

  async call(input: SkillCreatorInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'create': return this.createSkill(input);
        case 'list': return this.listSkills();
        case 'delete': return this.deleteSkill(input.name);
      }
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private createSkill(input: z.infer<typeof CreateSkillInput>): ToolResult<unknown> {
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }

    const filePath = path.join(this.skillsDir, `${input.name}.md`);

    // Build SKILL.md content
    const content = [
      '---',
      `name: ${input.name}`,
      `description: ${input.description}`,
      `when_to_use: ${input.whenToUse}`,
      `allowed_tools: [${input.allowedTools.join(', ')}]`,
      `execution_mode: ${input.executionMode}`,
      '---',
      '',
      input.instructions,
    ].join('\n');

    fs.writeFileSync(filePath, content, 'utf-8');

    return {
      success: true,
      output: {
        created: true,
        name: input.name,
        path: filePath,
        message: `技能「${input.name}」已创建。重启后自动加载，或下次对话时生效。`,
      },
    };
  }

  private listSkills(): ToolResult<unknown> {
    if (!fs.existsSync(this.skillsDir)) {
      return { success: true, output: { skills: [], count: 0 } };
    }

    const files = fs.readdirSync(this.skillsDir).filter(f => f.endsWith('.md'));
    const skills = files.map(f => ({
      name: f.replace('.md', ''),
      path: path.join(this.skillsDir, f),
    }));

    return { success: true, output: { skills, count: skills.length } };
  }

  private deleteSkill(name: string): ToolResult<unknown> {
    const filePath = path.join(this.skillsDir, `${name}.md`);
    if (!fs.existsSync(filePath)) {
      return { success: false, output: null, error: `技能「${name}」不存在` };
    }

    fs.unlinkSync(filePath);
    return { success: true, output: { deleted: true, name } };
  }
}
