/**
 * Office Agent
 */
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import type { LLMClient } from './core/llm-client.js';
import type { StreamEvent, UserConfig } from './types/index.js';

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
import { OperationLedger } from './core/operation-ledger.js';

import { TokenTracker } from './core/token-tracker.js';
import { UsageStats } from './core/usage-stats.js';

import { CronScheduler } from './services/cron-scheduler.js';
import { AwaySummaryEngine } from './services/away-summary-engine.js';
import { NotificationService } from './services/notification-service.js';
import { AgendaStore } from './services/agenda-store.js';
import { ReminderComposer } from './services/reminder-composer.js';
import { AgendaScheduler } from './services/agenda-scheduler.js';
import { OfficeContextStore } from './services/office-context-store.js';
import { FeishuSyncStore } from './services/feishu-sync-store.js';
import { FeishuSyncScheduler, type FeishuSyncTickSummary } from './services/feishu-sync-scheduler.js';
import { ContextWikiCompiler } from './services/context-wiki-compiler.js';
import { FeishuSyncKnowledgeCapture } from './services/feishu-sync-knowledge-capture.js';

import { TaskManagerTool } from './tools/TaskManager/index.js';
import { SubAgentTool } from './tools/SubAgentTool/index.js';
import { MemoryTool } from './tools/MemoryTool/index.js';
import { CronTool } from './tools/CronTool/index.js';
import { ConfigTool } from './tools/ConfigTool/index.js';
import { WebSearchTool } from './tools/WebSearchTool/index.js';
import { SkillCreatorTool } from './tools/SkillCreatorTool/index.js';
import { LarkCliTool } from './tools/LarkCliTool/index.js';
import { AgendaTool } from './tools/AgendaTool/index.js';
import { OfficeContextTool } from './tools/OfficeContextTool/index.js';
import { KnowledgeCaptureTool } from './tools/KnowledgeCaptureTool/index.js';
import { FeishuIngestTool } from './tools/FeishuIngestTool/index.js';
import { WikiTool } from './tools/WikiTool/index.js';

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
    '- CREATE reminder/deadline/commitment/follow-up with a concrete time → AgendaTool action "create"',
    '- DELETE task → TaskManager action "delete" (use description if no ID)',
    '- UPDATE task status → TaskManager action "update" (use description if no ID)',
    '- CREATE project → SubAgentTool action "create"',
    '- SAVE info → MemoryTool action "store"',
    '- DELETE ALL memories → call MemoryTool search first, then delete each one. Repeat until search returns empty.',
    '',
    '## Absolute rules:',
    '- If you say "created/deleted/done" but did not call a tool, YOU ARE LYING.',
    '- The user can see "[本轮调用了 N 个工具]" — if it says 0, they know you faked it.',
    '- If a tool returns an error, you MUST report the failure honestly. NEVER say "success" when the tool failed.',
    '- The user can see tool results in debug logs. If you lie about success/failure, you will be caught.',
    '- Keep responses SHORT. No tables unless asked.',
    '- NEVER stop mid-task to say "I am now going to..." or "Let me check...". Just DO IT.',
    '- If a user asks about tasks AND projects, call BOTH tools in one round, then reply with combined results.',
    '- Complete the ENTIRE request in ONE response. Do not wait for user to ask again.',
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
    '# Office Context System',
    '',
    '- Use OfficeContextTool as the structured office context graph for people, projects, documents, meetings, tasks, business processes, relationships, durable knowledge, and miscellaneous office context.',
    '- Search OfficeContextTool before answering questions about project status, stakeholders, responsibilities, documents, meetings, business processes, or prior office context.',
    '- Upsert OfficeContextTool records when you learn stable context from conversation, Feishu docs/messages/calendar/base, meetings, or tool results.',
    '- Use MemoryTool for loose facts, preferences, raw notes, and quick knowledge cards; use OfficeContextTool for durable structured entities and relationships.',
    '- Include sourceRefs when the source is known, and use stable keys such as project:<name>, person:<name>, doc:<token>, meeting:<date-topic>, process:<name>.',
    '- Use KnowledgeCaptureTool for batch extraction when a conversation, Feishu source, meeting, or tool result contains multiple durable facts, entities, commitments, or relationships.',
    '- Use WikiTool to compile or read the human-readable local wiki generated from OfficeContextTool records.',
    '',
    '# Agenda & Proactive Reminders',
    '',
    '- Use AgendaTool when the user states a concrete reminder time, deadline, commitment, or follow-up point.',
    '- Do NOT run agenda extraction every turn. Call AgendaTool autonomously only when there is a clear useful trigger.',
    '- For explicit reminders, set triggerAt to the reminder time.',
    '- For deadlines, set deadlineAt to the actual due time and triggerAt to when the user should be reminded.',
    '- Include sourceMessage/context so the Reminder Composer can generate a useful message at trigger time.',
    '- Do not rely on CronTool for one-time reminders; use AgendaTool. Keep CronTool for recurring automation.',
    '- When AgendaTool succeeds, briefly tell the user what was scheduled and when.',
    '',
    '# Feishu Cloud Documents',
    '',
    '- Use LarkCli for ALL Feishu/Lark work: messages, docs, sheets, base, calendar, tasks, wiki, contacts, meetings, and raw OpenAPI calls',
    '- Use FeishuIngestTool when you need to fetch, register, or sync Feishu docs, wiki nodes, chat messages, message search, calendar agenda, Base records, tasks, or contacts into the agent context.',
    '- If the user asks to keep a doc/group/base/project up to date, register it with FeishuIngestTool addSource, then use syncSource/syncAll when refreshing context.',
    '- The user has granted high-trust standing authorization for all operations available to the current Feishu credentials and OAuth scopes.',
    '- Do not ask for permission before executing Feishu side effects. Ask only when the target, content, or intent is ambiguous.',
    '- Use lark-cli schema or --help through LarkCli when you are unsure about parameters. Never guess flags',
    '- Before write operations, call the same shortcut with --help or run a successful --dry-run first; this is for command correctness, not user permission',
    '- If any LarkCli call fails, report the failure and use stderr/stdout to repair the command. Never claim success after success=false',
    '- Current docs v2 quick reference:',
    '  - Create doc: lark-cli docs +create --api-version v2 --doc-format markdown --content "<title>Title</title>\\n# Body" --as user',
    '  - Update doc: lark-cli docs +update --api-version v2 --doc DOC --command append|overwrite --doc-format markdown --content "..." --as user',
    '  - Fetch doc: lark-cli docs +fetch --api-version v2 --doc DOC --doc-format markdown --format json --as user',
    '  - Do NOT use --title or --markdown with docs +create --api-version v2; those are not valid v2 flags',
    '- Prefer high-level shortcut commands such as sheets +read, im +messages-send, calendar +agenda',
    '- Prefer --as user for personal data (calendar, private docs, messages) and --as bot for bot-owned actions',
    '- Prefer --format json for machine-readable output',
    '- Base quick reference:',
    '  - Create Base: lark-cli base +base-create --name "Name" --as user',
    '  - Create table: lark-cli base +table-create --base-token BASE --name "Table" --fields "[...]" --as user',
    '  - Create field: lark-cli base +field-create --base-token BASE --table-id TABLE --json "{...}" --as user',
    '  - Batch create records: lark-cli base +record-batch-create --base-token BASE --table-id TABLE --json "{\\"fields\\":[...],\\"rows\\":[...]}" --as user',
    '  - Base commands usually do NOT support --format json; use -q only when --help shows it.',
    '  - Do NOT use base +create, --title, or --base for Base creation/table creation.',
    '  - Function arguments MUST be strict JSON. If args contains --json/--fields, escape the nested JSON as a string inside the args array.',
    '- For side-effect operations, run --dry-run first when unsure, then execute directly if the command and target are clear',
    '- When user asks you to read their project docs, search/fetch via LarkCli first, then read each doc',
    '- Extract key information (milestones, deadlines, decisions, plans) and store as memories',
    '- If something is unclear, ASK the user before storing as memory',
    '',
    '# Available Commands',
    '',
    '/tasks /remind /agenda /report /meeting-notes /meeting',
    '/task-breakdown /feishu-sync /dev-workflow /okr /draft',
    '/project /memory /cron /usage /usage detail /help',
    '',
    'Do not recommend commands not in this list.',
    '',
    '# Response Rules',
    '',
    '- Default language: Chinese',
    '- Be BRIEF. 1-3 sentences for simple answers. No tables unless asked.',
    '- After completing a task or answering a question, you MAY append 1-3 follow-up suggestions.',
    '  Format them as: "💡 你可以继续：" followed by numbered items.',
    '  Only suggest when it makes sense (not after simple greetings or time queries).',
    '  Suggestions should be actionable and relevant to the current context.',
    '- When user asks about time, use the injected current time.',
    '- When deleting/updating tasks, use description if you do not know the ID.',
    '- For token usage, tell user to type /usage.',
    '- When user asks to change settings (working hours, away summary threshold, timezone, etc.), use ConfigTool.',
    '',
    '# Knowledge Capture (知识卡片)',
    '',
    '- CRITICAL for ADHD users: when user sends useful information, store it with the right tool instead of only saying "收到".',
    '- Use OfficeContextTool for structured durable entities: people, projects, documents, meetings, responsibilities, business processes, relationships, and project status.',
    '- Use MemoryTool for loose facts, preferences, raw notes, credentials/accounts, and quick knowledge cards.',
    '- Use AgendaTool for concrete reminder times, deadlines, commitments, and follow-up points.',
    '- Use KnowledgeCaptureTool when one source contains several items that should be saved across OfficeContextTool, MemoryTool, and AgendaTool.',
    '- Examples:',
    '  - "张三负责 Apollo 前端" → OfficeContextTool person/project relationship',
    '  - "项目预算200万" → OfficeContextTool project or MemoryTool project_context',
    '  - "服务器密码xxx" → MemoryTool preference',
    '  - "答应周五给客户方案" → AgendaTool commitment and OfficeContextTool relationship if useful',
    '- Tag records with relevant project names and keywords for easy retrieval.',
    '- When user asks "张三负责什么" or "这个项目现在怎样", search OfficeContextTool first. When user asks loose facts like "服务器密码是什么", search MemoryTool.',
    '',
    '# Smart Scheduling',
    '',
    '- When you notice the user repeatedly asks for similar tasks (e.g. always formats reports the same way,',
    '  always follows the same review checklist), proactively suggest creating a custom skill using SkillCreator.',
    '  Say: "我发现你经常让我做XX，要不要我创建一个专属技能，以后自动按这个流程来？"',
    '  Only create after user confirms.',
    '',
    '- When user mentions periodic reports (周报, 月报, 日报) or recurring events,',
    '  proactively create a CronTool recurring task to automate it.',
    '  Example: user says "周报每周五下午5点" → create cron task with expression "0 17 * * 5"',
    '  and prompt "生成本周项目周报并推送给用户".',
    '- When user mentions one-time deadlines or reminders, create an AgendaTool item.',
    '- Be proactive: if user discusses a project milestone, suggest creating a reminder.',
    '- Make reminders feel natural and human — vary the wording, consider context.',
    '',
    '# Project Document Management',
    '',
    '- When reading Feishu docs, determine which project they belong to:',
    '  1. If the doc is in a project-named folder, associate it with that project',
    '  2. If the content clearly mentions a specific project, associate it',
    '  3. If unclear, ASK the user which project this doc belongs to',
    '- Store extracted info as memories tagged with the project name',
    '- When generating reports, pull from project-tagged memories and task records',
  ].join('\n');
}
export interface OfficeAgent {
  queryEngine: QueryEngine;
  toolRegistry: ToolRegistry;
  memorySystem: MemorySystem;
  contextManager: ContextManager;
  skillSystem: SkillSystem;
  subAgentManager: SubAgentManager;
  agendaStore: AgendaStore;
  officeContextStore: OfficeContextStore;
  feishuSyncStore: FeishuSyncStore;
  feishuSyncScheduler: FeishuSyncScheduler;
  contextWikiCompiler: ContextWikiCompiler;
  agendaScheduler: AgendaScheduler;
  cronScheduler: CronScheduler;
  awaySummaryEngine: AwaySummaryEngine;
  notificationService: NotificationService;
  usageStats: UsageStats;
  configManager: UserConfigManager;
  operationLedger: OperationLedger;
  dataDir: string;

  handleMessage(input: string, images?: string[]): AsyncGenerator<StreamEvent>;
  start(): Promise<void>;
  stop(): void;
  getConfig(): UserConfig;
}

export interface CreateOfficeAgentOptions {
  llm: LLMClient;
  baseDir?: string;
  contextWindowSize?: number;
  model?: string;
}

function getFeishuSyncIntervalMs(config: UserConfig): number {
  const fromEnv = Number(process.env['FEISHU_SYNC_INTERVAL_MINUTES']);
  const minutes = Number.isFinite(fromEnv) && fromEnv > 0
    ? fromEnv
    : config.feishu.syncIntervalMinutes ?? 0;
  return minutes > 0 ? minutes * 60_000 : 0;
}

function shouldFeishuSyncOnStart(config: UserConfig): boolean {
  const fromEnv = process.env['FEISHU_SYNC_ON_START'];
  if (fromEnv !== undefined) return ['1', 'true', 'yes', 'on'].includes(fromEnv.trim().toLowerCase());
  return config.feishu.syncOnStart ?? false;
}

function getMaxToolRounds(): number {
  const fromEnv = Number(process.env['OFFICE_AGENT_MAX_TOOL_ROUNDS']);
  if (!Number.isFinite(fromEnv) || fromEnv <= 0) return 30;
  return Math.min(80, Math.max(5, Math.floor(fromEnv)));
}

async function runFeishuSyncTick(
  tool: FeishuIngestTool,
  signal: AbortSignal,
  userConfig: UserConfig,
): Promise<FeishuSyncTickSummary> {
  const result = await tool.call(
    tool.inputSchema.parse({
      action: 'syncAll',
      includeDisabled: false,
      force: false,
      limit: 20,
    }),
    { abortSignal: signal, userConfig },
  );

  const output = result.output as { count?: number; changed?: number; failed?: number } | null;
  return {
    count: output?.count ?? 0,
    changed: output?.changed ?? 0,
    failed: output?.failed ?? (result.success ? 0 : 1),
  };
}

export function createOfficeAgent(options: CreateOfficeAgentOptions): OfficeAgent {
  const { llm, baseDir, contextWindowSize, model } = options;
  const dataDir = baseDir ?? BASE_DIR;

  const configManager = new UserConfigManager(dataDir);
  const config = configManager.load();

  const memorySystem = new MemorySystem(path.join(dataDir, 'memdir'), llm);
  const contextManager = new ContextManager(contextWindowSize ?? 128_000, llm);
  const toolRegistry = new ToolRegistry();

  const agendaStore = new AgendaStore(path.join(dataDir, 'agenda.json'));
  const officeContextStore = new OfficeContextStore(path.join(dataDir, 'office-context.json'));
  const feishuSyncStore = new FeishuSyncStore(path.join(dataDir, 'feishu-sync-sources.json'));
  const contextWikiCompiler = new ContextWikiCompiler(officeContextStore, path.join(dataDir, 'wikidir'));
  const reminderComposer = new ReminderComposer(llm);
  const cronScheduler = new CronScheduler(
    path.join(dataDir, 'cron-tasks.json'),
    (task) => { void agent.handleMessage(task.prompt); },
  );
  const awaySummaryEngine = new AwaySummaryEngine(llm, config.awaySummary.thresholdMinutes);
  const skillSystem = new SkillSystem(BUNDLED_SKILLS_DIR, USER_SKILLS_DIR, llm);
  const subAgentManager = new SubAgentManager(llm, path.join(dataDir, 'agents'));

  const notificationService = new NotificationService();
  const usageStats = new UsageStats(path.join(dataDir, 'usage-stats.json'));
  const operationLedger = new OperationLedger(path.join(dataDir, 'operation-ledger.json'));
  const feishuSyncKnowledgeCapture = new FeishuSyncKnowledgeCapture(officeContextStore);
  const feishuIngestTool = new FeishuIngestTool(
    feishuSyncStore,
    officeContextStore,
    undefined,
    feishuSyncKnowledgeCapture,
  );
  const feishuSyncScheduler = new FeishuSyncScheduler(
    async (signal) => runFeishuSyncTick(feishuIngestTool, signal, configManager.get()),
    notificationService,
    getFeishuSyncIntervalMs(config),
  );

  toolRegistry.register(new TaskManagerTool(dataDir));
  toolRegistry.register(new LarkCliTool());
  toolRegistry.register(new OfficeContextTool(officeContextStore));
  toolRegistry.register(new KnowledgeCaptureTool(officeContextStore, memorySystem, agendaStore));
  toolRegistry.register(feishuIngestTool);
  toolRegistry.register(new WikiTool(contextWikiCompiler));
  toolRegistry.register(new AgendaTool(agendaStore));
  toolRegistry.register(new MemoryTool(memorySystem));
  toolRegistry.register(new CronTool(cronScheduler));
  toolRegistry.register(new SubAgentTool(subAgentManager));
  toolRegistry.register(new ConfigTool(configManager));
  toolRegistry.register(new WebSearchTool());
  toolRegistry.register(new SkillCreatorTool(path.join(dataDir, 'skills')));

  // Disable WebSearch when the active model/provider exposes native search.
  // This avoids presenting two search paths to the model.
  if (llm.capabilities?.webSearchNative) {
    const webSearch = toolRegistry.listAll().find(t => t.name === 'WebSearch');
    if (webSearch && 'setEnabled' in webSearch) {
      (webSearch as any).setEnabled(false);
    }
  }

  const toolDescriptions = toolRegistry
    .listEnabled()
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join('\n');
  const systemPrompt = buildSystemPrompt(toolDescriptions);

  const sessionStore = new SessionStore(dataDir);

  const agendaScheduler = new AgendaScheduler(
    agendaStore,
    notificationService,
    reminderComposer,
  );

  const queryEngine = new QueryEngine({
    model: model ?? 'claude-sonnet-4-20250514',
    systemPrompt,
    tools: toolRegistry,
    memorySystem,
    contextManager,
    llm,
    sessionStore,
    getUserConfig: () => configManager.get(),
    maxToolRounds: getMaxToolRounds(),
    operationLedger,
  });

  const agent: OfficeAgent = {
    queryEngine, toolRegistry, memorySystem, contextManager,
    skillSystem, subAgentManager, agendaStore, officeContextStore, feishuSyncStore, feishuSyncScheduler, contextWikiCompiler, agendaScheduler, cronScheduler,
    awaySummaryEngine, notificationService,
    usageStats, configManager, operationLedger,
    dataDir,
    handleMessage: (input: string, images?: string[]) => handleMessage(agent, input, images),
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
  agent.awaySummaryEngine.recordActivity();
  agent.queryEngine.restoreLastSession();
  agent.agendaScheduler.start();
  agent.feishuSyncScheduler.start();
  const config = agent.configManager.get();
  if (shouldFeishuSyncOnStart(config) && agent.feishuSyncScheduler.isEnabled()) {
    void agent.feishuSyncScheduler.tick();
  }
}

function stopAgent(agent: OfficeAgent): void {
  agent.cronScheduler.stop();
  agent.agendaScheduler.stop();
  agent.feishuSyncScheduler.stop();
}

async function* handleMessage(
  agent: OfficeAgent,
  input: string,
  images?: string[],
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

  // Track tool usage from stream events
  for await (const event of agent.queryEngine.submitMessage(input, images)) {
    if (event.type === 'tool_use') {
      agent.usageStats.record(event.toolName, 'tool');
    }
    yield event;
  }

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
    yield { type: 'text', content: `未知命令: /${parsed.command}。可用命令: /tasks, /remind, /daily-report, /weekly-report, /meeting-notes, /task-breakdown, /feishu-sync, /sync, /wiki, /project, /memory, /cron, /usage, /debug, /help, /db, /reset, /undo` };
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
  const dataDir = agent.dataDir;

  switch (target) {
    case 'usage': {
      const tracker = new TokenTracker(path.join(dataDir, 'token-usage.json'));
      const report = args === 'detail' ? tracker.formatDetailReport() : tracker.formatReport();
      yield { type: 'text', content: report };
      yield { type: 'done' };
      return;
    }

    case 'stats': {
      yield { type: 'text', content: agent.usageStats.formatReport() };
      yield { type: 'done' };
      return;
    }

    case 'debug': {
      const sub = args.trim() || 'last';
      if (sub !== 'last') {
        yield { type: 'text', content: '用法: /debug last' };
      } else {
        yield { type: 'text', content: agent.operationLedger.formatLast() };
      }
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
          '  /agenda             查看/管理主动提醒日程',
          '  /report             生成报告（日报/周报/月报/季度/半年/年度/项目）',
          '  /meeting-notes      整理会议纪要（简版）',
          '  /meeting            会议全流程管理',
          '  /task-breakdown     拆解大任务',
          '  /feishu-sync        同步飞书状态',
          '  /sync               同步飞书关注源',
          '  /wiki               编译/查看本地知识 Wiki',
          '  /dev-workflow       软件开发流程管理',
          '  /okr                OKR目标管理',
          '  /draft              起草邮件/消息',
          '  /project            查看项目列表',
          '  /memory <关键词>    搜索记忆',
          '  /cron               查看定时任务',
          '  /usage              查看 token 用量',
          '  /usage detail       查看详细用量',
          '  /stats              查看工具/技能使用统计',
          '  /debug last         查看最近一轮调试摘要',
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

    case 'sync': {
      const sub = args.trim();
      const result = await agent.toolRegistry.execute(
        'FeishuIngestTool',
        sub === 'list'
          ? { action: 'listSources' }
          : { action: 'syncAll', includeDisabled: false, force: sub === 'force', limit: 20 },
        { abortSignal: new AbortController().signal, userConfig: agent.getConfig() },
      );
      if (!result.success) {
        yield { type: 'text', content: `❌ 同步失败: ${result.error}` };
        yield { type: 'done' };
        return;
      }

      if (sub === 'list') {
        const sources = (result.output as any[]) ?? [];
        if (sources.length === 0) {
          yield { type: 'text', content: '暂无飞书同步关注源。你可以说“把这个飞书文档登记为长期关注源”。' };
        } else {
          const lines = [`飞书同步关注源 (${sources.length}):`];
          for (const source of sources) {
            lines.push(`- ${source.title} (${source.type}) ${source.syncEnabled ? 'enabled' : 'disabled'}${source.lastSyncedAt ? ` last=${new Date(source.lastSyncedAt).toLocaleString('zh-CN')}` : ''}`);
          }
          yield { type: 'text', content: lines.join('\n') };
        }
      } else {
        const output = result.output as { count?: number; changed?: number; failed?: number };
        yield { type: 'text', content: `✅ 飞书同步完成：${output.count ?? 0} 个来源，${output.changed ?? 0} 个有变化，${output.failed ?? 0} 个失败。` };
      }
      yield { type: 'done' };
      return;
    }

    case 'wiki': {
      const [sub = 'list', ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const rawInput =
        sub === 'compile'
          ? { action: 'compile' }
          : sub === 'search'
            ? { action: 'search', keyword: rest.join(' ') }
            : sub === 'read'
              ? { action: 'read', path: rest.join(' ') }
              : { action: 'list' };

      const result = await agent.toolRegistry.execute(
        'WikiTool',
        rawInput,
        { abortSignal: new AbortController().signal, userConfig: agent.getConfig() },
      );

      if (!result.success) {
        yield { type: 'text', content: `❌ Wiki 操作失败: ${result.error}` };
        yield { type: 'done' };
        return;
      }

      if (sub === 'compile') {
        const output = result.output as { pageCount?: number; indexPath?: string };
        yield { type: 'text', content: `✅ Wiki 已编译：${output.pageCount ?? 0} 个页面\n${output.indexPath ?? ''}`.trim() };
      } else if (sub === 'search') {
        const pages = (result.output as any[]) ?? [];
        yield { type: 'text', content: pages.length ? pages.map((p) => `- ${p.title} (${p.path})\n  ${p.excerpt}`).join('\n') : '未找到匹配的 Wiki 页面。' };
      } else if (sub === 'read') {
        const output = result.output as { content?: string };
        yield { type: 'text', content: output.content ?? '' };
      } else {
        const pages = (result.output as any[]) ?? [];
        yield { type: 'text', content: pages.length ? pages.map((p) => `- ${p.title} (${p.type}) ${p.path}`).join('\n') : 'Wiki 还没有页面。先运行 /wiki compile。' };
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

  agent.usageStats.record(skillName, 'skill');

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
