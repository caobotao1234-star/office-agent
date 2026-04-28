/**
 * FeishuCLI Tool — 通过飞书官方 CLI 操作飞书（用户身份）
 *
 * 与 FeishuConnector（SDK + 应用身份）并存，通过 .env 的 FEISHU_BACKEND 切换。
 * CLI 以用户身份运行，权限更大，覆盖更广（200+ API）。
 *
 * 依赖：npm install -g @larksuite/cli && lark-cli auth login --recommend
 */
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';

const exec = promisify(execFile);
const log = logger.child('FeishuCLI');

// ============================================================
// Input Schema
// ============================================================

const RunCommandInput = z.object({
  action: z.literal('run'),
  command: z.string().min(1).describe('lark-cli 命令（不含 lark-cli 前缀），如 "calendar +agenda" 或 "im +messages-send --chat-id oc_xxx --text hello"'),
  format: z.enum(['json', 'pretty', 'table']).default('json'),
});

const CalendarAgendaInput = z.object({
  action: z.literal('calendar_agenda'),
});

const SendMessageInput = z.object({
  action: z.literal('send_message'),
  chatId: z.string().min(1).describe('群聊或单聊 ID'),
  text: z.string().min(1),
});

const SearchMessagesInput = z.object({
  action: z.literal('search_messages'),
  query: z.string().min(1).describe('搜索关键词'),
  chatId: z.string().optional().describe('限定在某个群聊中搜索'),
});

const ReadDocInput = z.object({
  action: z.literal('read_doc'),
  docToken: z.string().min(1).describe('文档 token'),
});

const CreateDocInput = z.object({
  action: z.literal('create_doc'),
  title: z.string().min(1),
  content: z.string().optional().describe('Markdown 格式的文档内容'),
  folderToken: z.string().optional(),
});

const SearchDocsInput = z.object({
  action: z.literal('search_docs'),
  query: z.string().min(1),
});

const ReadSheetInput = z.object({
  action: z.literal('read_sheet'),
  spreadsheetToken: z.string().min(1),
  sheetId: z.string().optional(),
  range: z.string().optional(),
});

const ListTasksInput = z.object({
  action: z.literal('list_tasks'),
});

const CreateTaskInput = z.object({
  action: z.literal('create_task'),
  summary: z.string().min(1),
  dueDate: z.string().optional().describe('截止日期 YYYY-MM-DD'),
});

const SearchUsersInput = z.object({
  action: z.literal('search_users'),
  query: z.string().min(1).describe('用户名、邮箱或手机号'),
});

const ListMailInput = z.object({
  action: z.literal('list_mail'),
  query: z.string().optional().describe('搜索关键词'),
});

const SendMailInput = z.object({
  action: z.literal('send_mail'),
  to: z.string().min(1).describe('收件人邮箱'),
  subject: z.string().min(1),
  body: z.string().min(1),
});

const ListApprovalsInput = z.object({
  action: z.literal('list_approvals'),
});

const ChatHistoryInput = z.object({
  action: z.literal('chat_history'),
  chatId: z.string().min(1),
  count: z.number().default(20).describe('获取最近 N 条消息'),
});

const FeishuCLIInput = z.discriminatedUnion('action', [
  RunCommandInput,
  CalendarAgendaInput,
  SendMessageInput,
  SearchMessagesInput,
  ReadDocInput,
  CreateDocInput,
  SearchDocsInput,
  ReadSheetInput,
  ListTasksInput,
  CreateTaskInput,
  SearchUsersInput,
  ListMailInput,
  SendMailInput,
  ListApprovalsInput,
  ChatHistoryInput,
]);

export type FeishuCLIInput = z.infer<typeof FeishuCLIInput>;

// ============================================================
// FeishuCLI Tool
// ============================================================

export class FeishuCLITool implements Tool<FeishuCLIInput, unknown> {
  readonly name = 'FeishuCLI';
  readonly description = [
    '飞书 CLI 工具（用户身份）：以你的身份操作飞书，覆盖消息、文档、表格、日历、邮件、任务、审批等。',
    'Actions: run(执行任意 lark-cli 命令), calendar_agenda(查看日程), send_message(发消息),',
    'search_messages(搜索消息), read_doc(读文档), create_doc(创建文档), search_docs(搜索文档),',
    'read_sheet(读表格), list_tasks(查看任务), create_task(创建任务), search_users(搜索用户),',
    'list_mail(查看邮件), send_mail(发邮件), list_approvals(查看审批), chat_history(聊天记录)。',
  ].join(' ');
  readonly inputSchema = FeishuCLIInput;

  private enabled = true;

  isEnabled(): boolean { return this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }

  isReadOnly(input: FeishuCLIInput): boolean {
    const readActions = new Set([
      'calendar_agenda', 'search_messages', 'read_doc', 'search_docs',
      'read_sheet', 'list_tasks', 'search_users', 'list_mail',
      'list_approvals', 'chat_history',
    ]);
    return readActions.has(input.action);
  }

  checkPermissions(): PermissionResult { return { allowed: true }; }

  requiresUserConfirmation(input: FeishuCLIInput): boolean {
    const writeActions = new Set(['send_message', 'create_doc', 'create_task', 'send_mail', 'run']);
    return writeActions.has(input.action);
  }

  async call(input: FeishuCLIInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'run':
          return await this.runRaw(input.command, input.format);
        case 'calendar_agenda':
          return await this.runCmd('calendar +agenda');
        case 'send_message':
          return await this.runCmd(`im +messages-send --chat-id "${input.chatId}" --text "${this.escapeArg(input.text)}"`);
        case 'search_messages': {
          const chatFilter = input.chatId ? ` --chat-id "${input.chatId}"` : '';
          return await this.runCmd(`im +messages-search --query "${this.escapeArg(input.query)}"${chatFilter}`);
        }
        case 'read_doc':
          return await this.runCmd(`docs +read --doc-token "${input.docToken}"`);
        case 'create_doc': {
          let cmd = `docs +create --title "${this.escapeArg(input.title)}"`;
          if (input.content) cmd += ` --content "${this.escapeArg(input.content)}"`;
          if (input.folderToken) cmd += ` --folder-token "${input.folderToken}"`;
          return await this.runCmd(cmd);
        }
        case 'search_docs':
          return await this.runCmd(`drive +search --query "${this.escapeArg(input.query)}"`);
        case 'read_sheet': {
          let cmd = `sheets +read --spreadsheet-token "${input.spreadsheetToken}"`;
          if (input.sheetId) cmd += ` --sheet-id "${input.sheetId}"`;
          if (input.range) cmd += ` --range "${input.range}"`;
          return await this.runCmd(cmd);
        }
        case 'list_tasks':
          return await this.runCmd('task +list');
        case 'create_task': {
          let cmd = `task +create --summary "${this.escapeArg(input.summary)}"`;
          if (input.dueDate) cmd += ` --due "${input.dueDate}"`;
          return await this.runCmd(cmd);
        }
        case 'search_users':
          return await this.runCmd(`contact +search --query "${this.escapeArg(input.query)}"`);
        case 'list_mail': {
          const q = input.query ? ` --query "${this.escapeArg(input.query)}"` : '';
          return await this.runCmd(`mail +list${q}`);
        }
        case 'send_mail':
          return await this.runCmd(`mail +send --to "${input.to}" --subject "${this.escapeArg(input.subject)}" --body "${this.escapeArg(input.body)}"`);
        case 'list_approvals':
          return await this.runCmd('approval +list');
        case 'chat_history':
          return await this.runCmd(`im +messages-list --chat-id "${input.chatId}" --page-size ${input.count}`);
      }
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Execute a lark-cli command and return parsed output */
  private async runCmd(cmd: string): Promise<ToolResult<unknown>> {
    return this.runRaw(cmd, 'json');
  }

  private async runRaw(cmd: string, format: string): Promise<ToolResult<unknown>> {
    const fullCmd = `${cmd} --format ${format}`;
    log.debug('Executing lark-cli', { cmd: fullCmd });

    try {
      const args = fullCmd.split(/\s+/);
      const { stdout, stderr } = await exec('lark-cli', args, {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 5, // 5MB
      });

      if (stderr && stderr.trim()) {
        log.warn('lark-cli stderr', { stderr: stderr.slice(0, 500) });
      }

      // Try to parse as JSON
      const trimmed = stdout.trim();
      if (format === 'json' && trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          return { success: true, output: parsed };
        } catch {
          // Not valid JSON, return as text
        }
      }

      return { success: true, output: trimmed };
    } catch (err: any) {
      const message = err.stderr || err.message || String(err);
      log.error('lark-cli failed', { cmd: fullCmd, error: message.slice(0, 500) });

      if (message.includes('not found') || message.includes('not recognized')) {
        return {
          success: false, output: null,
          error: 'lark-cli 未安装。请运行: npm install -g @larksuite/cli && lark-cli auth login --recommend',
        };
      }
      if (message.includes('auth') || message.includes('login') || message.includes('token')) {
        return {
          success: false, output: null,
          error: '飞书 CLI 未登录。请运行: lark-cli auth login --recommend',
        };
      }

      return { success: false, output: null, error: `飞书 CLI 错误: ${message.slice(0, 200)}` };
    }
  }

  private escapeArg(s: string): string {
    return s.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}
