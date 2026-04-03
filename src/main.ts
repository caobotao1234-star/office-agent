/**
 * Office Agent
 */
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import type { LLMClient } from './core/llm-client.js';
import type { StreamEvent, Message, Suggestion, UserConfig } from './types/index.js';

import { QueryEngine } from './core/query-engine.js';
import { ToolRegistry } from './core/tool-system.js';
import { MemorySystem } from './core/memory-system.js';
import { ContextManager } from './core/context-manager.js';
import { SkillSystem } from './core/skill-system.js';
import type { SkillResult } from './core/skill-system.js';
import { SubAgentManager } from './core/sub-agent-manager.js';
import { UserConfigManager } from './core/user-config.js';
import { SessionStore } from './core/session-store.js';
import { isSlashCommand, parseSlashCommand, resolveCommand } from './core/slash-command.js';

import { TokenTracker } from './core/token-tracker.js';

import { ReminderEngine } from './services/reminder-engine.js';
import { CronScheduler } from './services/cron-scheduler.js';
import { BackgroundTaskManager } from './services/background-task-manager.js';
import { AwaySummaryEngine } from './services/away-summary-engine.js';
import { VoiceService } from './services/voice-service.js';
import { PromptSuggestionEngine } from './services/prompt-suggestion.js';

import { TaskManagerTool } from './tools/TaskManager/index.js';
import { SubAgentTool } from './tools/SubAgentTool/index.js';
import { DocumentParserTool } from './tools/DocumentParser/index.js';
import { FeishuConnectorTool } from './tools/FeishuConnector/index.js';
import { ReminderTool } from './tools/ReminderTool/index.js';
import { MemoryTool } from './tools/MemoryTool/index.js';
import { CronTool } from './tools/CronTool/index.js';
import { BackgroundTaskTool } from './tools/BackgroundTaskTool/index.js';
import { EmailTool } from './tools/EmailTool/index.js';
import { CalendarTool } from './tools/CalendarTool/index.js';

const BASE_DIR = path.join(os.homedir(), '.office-agent');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS_DIR = path.join(__dirname, 'skills', 'bundled');
const USER_SKILLS_DIR = path.join(BASE_DIR, 'skills');

function buildSystemPrompt(toolDescriptions: string): string {
  return [
    '# Office Agent',
    '',
    'You are Office Agent, a professional office assistant.',
    '',
    '# CRITICAL RULE: ALWAYS use tools — for BOTH actions AND queries',
    '',
    'You have tools. USE THEM. Do not answer from memory or context alone.',
    '',
    '## For queries (user asks "what tasks/projects/memories do I have"):',
    '- LIST tasks → call TaskManager with action "list"',
    '- LIST projects → call SubAgentTool with action "list"',
    '- SEARCH memories → call MemoryTool with action "search"',
    '- NEVER answer "you have X tasks" without first calling the tool to check',
    '',
    '## For actions (user asks to create/delete/update):',
    '- CREATE task → TaskManager action "create"',
    '- DELETE task → TaskManager action "delete" (use description if no ID)',
    '- UPDATE task status → TaskManager action "update" (use description if no ID)',
    '- CREATE project → SubAgentTool action "create"',
    '- SAVE info → MemoryTool action "store"',
    '- DELETE ALL memories → call MemoryTool search first, then delete each one. Repeat until search returns empty.',
    '',
    '## Absolute rules:',
    '- If you say "created/deleted/done" but did not call a tool, YOU ARE LYING.',
    '- The user can see "[本轮调用了 N 个工具]" — if it says 0, they know you faked it.',
    '- Keep responses SHORT. No tables unless asked. No suggestions unless asked.',
    '',
    '# Available Tools',
    '',
    toolDescriptions,
    '',
    '# Memory System',
    '',
    '- Memory index is injected dynamically each turn',
    '- Use MemoryTool to store important information',
    '- When you learn project details from Feishu docs, store key info (milestones, deadlines, decisions) as memories',
    '',
    '# Feishu Cloud Documents',
    '',
    '- Use FeishuConnector list_folder to browse folders (folderToken="root" for root)',
    '- Use FeishuConnector get_document_raw to read document content as text',
    '- When user asks you to read their project docs, browse folders first, then read each doc',
    '- Extract key information (milestones, deadlines, decisions, plans) and store as memories',
    '- If something is unclear, ASK the user before storing as memory',
    '',
    '# Available Commands',
    '',
    '/tasks /remind /daily-report /weekly-report /meeting-notes',
    '/task-breakdown /feishu-sync /project /memory /cron',
    '/usage /usage detail /help',
    '',
    'Do not recommend commands not in this list.',
    '',
    '# Response Rules',
    '',
    '- Default language: Chinese',
    '- Be BRIEF. 1-3 sentences for simple answers. No tables unless asked.',
    '- Do NOT append numbered suggestions/recommendations at the end.',
    '- When user asks about time, use the injected current time.',
    '- When deleting/updating tasks, use description if you do not know the ID.',
    '- For token usage, tell user to type /usage.',
  ].join('\n');
}
export interface OfficeAgent {
  queryEngine: QueryEngine;
  toolRegistry: ToolRegistry;
  memorySystem: MemorySystem;
  contextManager: ContextManager;
  skillSystem: SkillSystem;
  subAgentManager: SubAgentManager;
  reminderEngine: ReminderEngine;
  cronScheduler: CronScheduler;
  backgroundTaskManager: BackgroundTaskManager;
  awaySummaryEngine: AwaySummaryEngine;
  voiceService: VoiceService;
  promptSuggestionEngine: PromptSuggestionEngine;
  configManager: UserConfigManager;

  handleMessage(input: string): AsyncGenerator<StreamEvent>;
  start(): Promise<void>;
  stop(): void;
  getConfig(): UserConfig;
}

export interface HandleMessageResult {
  events: AsyncGenerator<StreamEvent>;
  suggestions?: Suggestion[];
  awaySummary?: string | null;
}

export interface CreateOfficeAgentOptions {
  llm: LLMClient;
  baseDir?: string;
  contextWindowSize?: number;
  model?: string;
}

export function createOfficeAgent(options: CreateOfficeAgentOptions): OfficeAgent {
  const { llm, baseDir, contextWindowSize, model } = options;
  const dataDir = baseDir ?? BASE_DIR;

  const configManager = new UserConfigManager(dataDir);
  const config = configManager.load();

  const memorySystem = new MemorySystem(path.join(dataDir, 'memdir'), llm);
  const contextManager = new ContextManager(contextWindowSize ?? 128_000, llm);
  const toolRegistry = new ToolRegistry();

  const reminderEngine = new ReminderEngine(config);
  const cronScheduler = new CronScheduler(
    path.join(dataDir, 'cron-tasks.json'),
    (task) => { void agent.handleMessage(task.prompt); },
  );
  const backgroundTaskManager = new BackgroundTaskManager();
  const awaySummaryEngine = new AwaySummaryEngine(llm, config.awaySummary.thresholdMinutes);
  const voiceService = new VoiceService();
  const promptSuggestionEngine = new PromptSuggestionEngine(llm);
  const skillSystem = new SkillSystem(BUNDLED_SKILLS_DIR, USER_SKILLS_DIR, llm);
  const subAgentManager = new SubAgentManager(llm, path.join(dataDir, 'agents'));

  toolRegistry.register(new TaskManagerTool());
  toolRegistry.register(new DocumentParserTool());
  toolRegistry.register(new FeishuConnectorTool());
  toolRegistry.register(new EmailTool());
  toolRegistry.register(new CalendarTool());
  toolRegistry.register(new ReminderTool(reminderEngine));
  toolRegistry.register(new MemoryTool(memorySystem));
  toolRegistry.register(new CronTool(cronScheduler));
  toolRegistry.register(new BackgroundTaskTool(backgroundTaskManager));
  toolRegistry.register(new SubAgentTool(subAgentManager));

  const toolDescriptions = toolRegistry
    .listAll()
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join('\n');
  const systemPrompt = buildSystemPrompt(toolDescriptions);

  const sessionStore = new SessionStore(dataDir);
  const queryEngine = new QueryEngine({
    model: model ?? 'claude-sonnet-4-20250514',
    systemPrompt,
    tools: toolRegistry,
    memorySystem,
    contextManager,
    llm,
    sessionStore,
  });

  const agent: OfficeAgent = {
    queryEngine, toolRegistry, memorySystem, contextManager,
    skillSystem, subAgentManager, reminderEngine, cronScheduler,
    backgroundTaskManager, awaySummaryEngine, voiceService,
    promptSuggestionEngine, configManager,
    handleMessage: (input: string) => handleMessage(agent, input),
    start: () => startAgent(agent),
    stop: () => stopAgent(agent),
    getConfig: () => configManager.get(),
  };

  return agent;
}

async function startAgent(agent: OfficeAgent): Promise<void> {
  agent.configManager.load();
  await agent.skillSystem.loadSkills();
  agent.cronScheduler.start();
  agent.cronScheduler.checkMissedTasks();
  agent.awaySummaryEngine.recordActivity();
  agent.queryEngine.restoreLastSession();
}

function stopAgent(agent: OfficeAgent): void {
  agent.cronScheduler.stop();
}

async function* handleMessage(
  agent: OfficeAgent,
  input: string,
): AsyncGenerator<StreamEvent> {

  const activityStatus = agent.awaySummaryEngine.checkUserActivity();
  if (activityStatus.isAway) {
      const messages = [...agent.queryEngine.getMessages()];
    const ac = new AbortController();
    try {
      const summary = await agent.awaySummaryEngine.generateSummary(messages, ac.signal);
      if (summary) {
        yield { type: 'text', content: summary };
      }
    } catch {
      // non-critical
    }
  }
  agent.awaySummaryEngine.recordActivity();

  if (isSlashCommand(input)) {
    yield* handleSlashCommand(agent, input);
    return;
  }

  yield* agent.queryEngine.submitMessage(input);

  // Suggestions disabled — LLM was already appending its own, causing duplication
}

async function* handleSlashCommand(
  agent: OfficeAgent,
  input: string,
): AsyncGenerator<StreamEvent> {
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    yield { type: 'text', content: '无法解析命令，请检查格式。' };
    yield { type: 'done' };
    return;
  }

  const mapping = resolveCommand(parsed.command);
  if (!mapping) {
    yield { type: 'text', content: `未知命令: /${parsed.command}。可用命令: /tasks, /remind, /daily-report, /weekly-report, /meeting-notes, /task-breakdown, /feishu-sync, /project, /memory, /cron, /usage, /help, /db, /reset, /undo` };
    yield { type: 'done' };
    return;
  }

  if (mapping.type === 'builtin') {
    yield* handleBuiltinCommand(agent, mapping.target, parsed.rawArgs);
    return;
  }

  if (mapping.type === 'skill') {
    yield* handleSkillTrigger(agent, mapping.target, parsed.rawArgs);
    return;
  }

  if (mapping.type === 'tool') {
    const naturalLanguage = buildNaturalLanguageFromCommand(parsed.command, parsed.rawArgs);
    yield* agent.queryEngine.submitMessage(naturalLanguage);
    return;
  }
}

async function* handleBuiltinCommand(
  agent: OfficeAgent,
  target: string,
  args: string,
): AsyncGenerator<StreamEvent> {
  const dataDir = path.join(os.homedir(), '.office-agent');

  switch (target) {
    case 'usage': {
      const tracker = new TokenTracker(path.join(dataDir, 'token-usage.json'));
      const report = args === 'detail' ? tracker.formatDetailReport() : tracker.formatReport();
      yield { type: 'text', content: report };
      yield { type: 'done' };
      return;
    }

    case 'help': {
      yield {
        type: 'text',
        content: [
          '可用命令:',
          '  /tasks              查看任务列表',
          '  /remind <内容>      创建提醒',
          '  /daily-report       生成每日工作汇报',
          '  /weekly-report      生成周报',
          '  /meeting-notes      整理会议纪要',
          '  /task-breakdown     拆解大任务',
          '  /feishu-sync        同步飞书状态',
          '  /project            查看项目列表',
          '  /memory <关键词>    搜索记忆',
          '  /cron               查看定时任务',
          '  /usage              查看 token 用量',
          '  /usage detail       查看详细用量',
          '  /db tasks           直接查数据库任务',
          '  /db projects        直接查数据库项目',
          '  /db memories        直接查数据库记忆',
          '  /reset [子命令]     清空数据',
          '  /undo               从回收站恢复记忆',
          '  /help               显示此帮助',
        ].join('\n'),
      };
      yield { type: 'done' };
      return;
    }

    case 'db': {
      const sub = args.trim();
      if (sub === 'tasks') {
        const result = await agent.toolRegistry.execute('TaskManager', { action: 'list' },
          { abortSignal: new AbortController().signal, userConfig: agent.getConfig() });
        const tasks = (result.output as any[]) ?? [];
        if (tasks.length === 0) {
          yield { type: 'text', content: '📋 数据库中无任务' };
        } else {
          const lines = [`📋 数据库中有 ${tasks.length} 个任务:`];
          for (const t of tasks) {
            lines.push(`  ${t.status === 'completed' ? '✅' : '⏳'} [${t.priority}] ${t.description}${t.projectId ? ' (#' + t.projectId + ')' : ''}${t.dueDate ? ' 截止:' + new Date(t.dueDate).toLocaleDateString('zh-CN') : ''}`);
          }
          yield { type: 'text', content: lines.join('\n') };
        }
      } else if (sub === 'projects') {
        const projects = agent.subAgentManager.list();
        if (projects.length === 0) {
          yield { type: 'text', content: '📁 数据库中无项目' };
        } else {
          const lines = [`📁 数据库中有 ${projects.length} 个项目:`];
          for (const p of projects) {
            lines.push(`  ${p.status === 'active' ? '🟢' : '⚪'} ${p.projectName} (${p.projectId}) [${p.status}]`);
          }
          yield { type: 'text', content: lines.join('\n') };
        }
      } else if (sub === 'memories') {
        const memories = await agent.memorySystem.search({ limit: 10 });
        if (memories.length === 0) {
          yield { type: 'text', content: '🧠 数据库中无记忆' };
        } else {
          const lines = [`🧠 数据库中有记忆 (显示最近10条):`];
          for (const m of memories) {
            lines.push(`  [${m.type}] ${m.title}`);
          }
          yield { type: 'text', content: lines.join('\n') };
        }
      } else {
        yield { type: 'text', content: '用法: /db tasks | /db projects | /db memories' };
      }
      yield { type: 'done' };
      return;
    }

    case 'reset': {
      const sub = args.trim();
      const fs = await import('node:fs');
      const rmFile = (f: string) => { const p = path.join(dataDir, f); if (fs.existsSync(p)) fs.unlinkSync(p); };
      const rmDir = (d: string) => { const p = path.join(dataDir, d); if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); };

      if (sub === 'tasks') { rmFile('tasks.json'); yield { type: 'text', content: '✅ 任务已清空' }; }
      else if (sub === 'memories' || sub === 'memory') { await agent.memorySystem.deleteAll(); yield { type: 'text', content: '✅ 记忆已清空（移到回收站，可 /undo 恢复）' }; }
      else if (sub === 'projects') { rmDir('agents'); yield { type: 'text', content: '✅ 项目已清空' }; }
      else if (sub === 'sessions' || sub === 'history') { rmDir('sessions'); rmFile('last-session.txt'); yield { type: 'text', content: '✅ 会话历史已清空' }; }
      else if (sub === 'usage' || sub === 'tokens') { rmFile('token-usage.json'); yield { type: 'text', content: '✅ Token 用量统计已清空' }; }
      else if (sub === 'config') { rmFile('config.json'); yield { type: 'text', content: '✅ 配置已重置为默认' }; }
      else if (sub === 'cron') { rmFile('cron-tasks.json'); yield { type: 'text', content: '✅ 定时任务已清空' }; }
      else if (sub === 'trash') { rmDir('trash'); yield { type: 'text', content: '✅ 回收站已清空（不可恢复）' }; }
      else if (sub === '' || sub === 'all') {
        await agent.memorySystem.deleteAll();
        for (const f of ['tasks.json', 'token-usage.json', 'last-session.txt', 'config.json', 'cron-tasks.json']) rmFile(f);
        for (const d of ['agents', 'sessions']) rmDir(d);
        yield { type: 'text', content: '✅ 全部清空（记忆移到回收站，可 /undo 恢复）。重启生效。' };
      } else {
        yield { type: 'text', content: '用法: /reset [all|tasks|memories|projects|sessions|usage|config|cron|trash]' };
      }
      yield { type: 'done' };
      return;
    }

    case 'undo': {
      const count = await agent.memorySystem.restoreFromTrash();
      if (count > 0) {
        yield { type: 'text', content: `✅ 已从回收站恢复 ${count} 个记忆文件` };
      } else {
        yield { type: 'text', content: '回收站为空，无可恢复的数据' };
      }
      yield { type: 'done' };
      return;
    }

    default:
      yield { type: 'text', content: `未知内置命令: ${target}` };
      yield { type: 'done' };
  }
}

async function* handleSkillTrigger(
  agent: OfficeAgent,
  skillName: string,
  args: string,
): AsyncGenerator<StreamEvent> {
  const skill = agent.skillSystem.findSkill(skillName);
  if (!skill) {
    yield { type: 'text', content: `\u672A\u627E\u5230\u6280\u80FD: ${skillName}` };
    yield { type: 'done' };
    return;
  }

  yield { type: 'text', content: `\u2699 \u6B63\u5728\u6267\u884C\u6280\u80FD\u300C${skill.name}\u300D...\n` };

  const result: SkillResult = await agent.skillSystem.executeSkill(skill, args);

  if (!result.success) {
    yield { type: 'text', content: `\u274C \u6280\u80FD\u6267\u884C\u5931\u8D25: ${result.output}` };
    yield { type: 'done' };
    return;
  }

  if (result.mode === 'inline') {
    yield* agent.queryEngine.submitMessage(
      `[\u6280\u80FD ${skill.name} \u8F93\u51FA]\n${result.output}\n\n\u8BF7\u6839\u636E\u4EE5\u4E0A\u6280\u80FD\u8F93\u51FA\u4E3A\u7528\u6237\u751F\u6210\u6700\u7EC8\u7ED3\u679C\u3002`,
    );
  } else {
    yield { type: 'text', content: result.output };
    yield { type: 'done' };
  }
}

export async function tryDelegateToSubAgent(
  agent: OfficeAgent,
  input: string,
): Promise<string | null> {
  const activeAgents = agent.subAgentManager.list('active');
  if (activeAgents.length === 0) return null;

  for (const sub of activeAgents) {
    if (input.includes(sub.projectName) || input.includes(sub.projectId)) {
      try {
        return await agent.subAgentManager.delegate(sub.id, input);
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function generateSuggestions(agent: OfficeAgent): Promise<Suggestion[]> {
  const taskResult = await agent.toolRegistry.execute(
    'TaskManager',
    { action: 'list' },
    { abortSignal: new AbortController().signal, userConfig: agent.getConfig() },
  );

  const tasks = taskResult.success && Array.isArray(taskResult.output)
    ? taskResult.output
    : [];

  const now = new Date();
  const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const upcomingDeadlines = tasks.filter(
    (t: { dueDate?: Date; status: string }) =>
      t.dueDate &&
      new Date(t.dueDate).getTime() <= threeDaysLater.getTime() &&
      t.status !== 'completed' &&
      t.status !== 'cancelled',
  );

  const recentMessages = agent.queryEngine.getMessages().slice(-10) as Message[];

  return agent.promptSuggestionEngine.generateSuggestions({
    currentTasks: tasks,
    recentMessages,
    upcomingDeadlines,
    userActivityPattern: { peakHour: 10, avgCompletedPerDay: 3 },
  });
}

function buildNaturalLanguageFromCommand(command: string, args: string): string {
  const commandPrompts: Record<string, string> = {
    tasks: args ? `\u67E5\u8BE2\u4EFB\u52A1: ${args}` : '\u5217\u51FA\u5F53\u524D\u6240\u6709\u5F85\u529E\u4EFB\u52A1',
    remind: args ? `\u521B\u5EFA\u63D0\u9192: ${args}` : '\u5217\u51FA\u6240\u6709\u5F85\u5904\u7406\u7684\u63D0\u9192\u4E8B\u9879',
    project: args ? `\u67E5\u770B\u9879\u76EE\u300C${args}\u300D\u72B6\u6001` : '\u5217\u51FA\u6240\u6709\u6D3B\u8DC3\u7684\u9879\u76EE\u53CA\u8FDB\u5C55',
    memory: args ? `\u641C\u7D22\u8BB0\u5FC6: ${args}` : '\u5217\u51FA\u8BB0\u5FC6\u7684\u5173\u952E\u6761\u76EE',
    cron: args ? `\u7BA1\u7406\u5B9A\u65F6\u4EFB\u52A1: ${args}` : '\u5217\u51FA\u6240\u6709\u5B9A\u65F6\u4EFB\u52A1',
  };
  return commandPrompts[command] ?? `\u6267\u884C\u547D\u4EE4 /${command} ${args}`.trim();
}
