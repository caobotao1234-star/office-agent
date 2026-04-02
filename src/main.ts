/**
 * Office Agent
 */
import * as path from 'node:path';
import * as os from 'node:os';

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
const BUNDLED_SKILLS_DIR = path.join('src', 'skills', 'bundled');
const USER_SKILLS_DIR = path.join(BASE_DIR, 'skills');

function buildSystemPrompt(toolDescriptions: string, memoryIndex: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const memorySection = memoryIndex
    ? '\n\n# 记忆索引\n\n' + memoryIndex
    : '';

  const lines = [
    '# 角色定义',
    '',
    '你是 Office Agent，一个专业的办公智能助理。',
    '',
    '# 当前时间',
    '',
    dateStr + ' ' + timeStr,
    '',
    '# 行为准则',
    '',
    '1. 主动发现并提醒可能遗忘的事项',
    '2. 回答基于记忆系统中的真实数据',
    '3. 回复简洁清晰，控制在 200 字以内',
    '4. 执行写操作前必须获得用户确认',
    '5. 自动记住对话中的重要信息',
    '6. 默认使用中文与用户交流',
    '',
    '# 可用工具',
    '',
    toolDescriptions,
    '',
    '# 记忆系统',
    '',
    '1. 记忆索引（下方已列出）',
    '2. 自动召回：每次对话开始时自动选取相关记忆',
    '3. 主动搜索：使用 MemoryTool 搜索记忆',
    '',
    '当对话中出现值得记住的信息时，使用 MemoryTool 保存。',
    memorySection,
    '',
    '# 交互规范',
    '',
    '- 用户输入斜杠命令时，直接执行对应功能',
    '- 用户指令含义模糊时，主动询问澄清',
    '- 回复要简短精炼',
  ];
  return lines.join('\n');
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
  const memoryIndex = memorySystem.loadIndex();
  const systemPrompt = buildSystemPrompt(toolDescriptions, memoryIndex);

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

  const suggestedSkill = agent.skillSystem.suggestSkill(input);
  if (suggestedSkill) {
    yield { type: 'text', content: `Skill "${suggestedSkill.name}" available. Use /${suggestedSkill.name}\n\n` };
  }

  yield* agent.queryEngine.submitMessage(input);

  try {
    const suggestions = await generateSuggestions(agent);
    if (suggestions.length > 0) {
      const suggestionText = suggestions
        .map((s: Suggestion, i: number) => `${i + 1}. ${s.text}`)
        .join('\n');
      yield { type: 'text', content: '\n\n' + suggestionText };
    }
  } catch {
    // non-critical
  }
}

async function* handleSlashCommand(
  agent: OfficeAgent,
  input: string,
): AsyncGenerator<StreamEvent> {
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    yield { type: 'text', content: 'Invalid command format.' };
    yield { type: 'done' };
    return;
  }

  const mapping = resolveCommand(parsed.command);
  if (!mapping) {
    yield { type: 'text', content: `Unknown command: /${parsed.command}. Available: /tasks, /remind, /daily-report, /weekly-report, /meeting-notes, /task-breakdown, /feishu-sync, /project, /memory, /cron` };
    yield { type: 'done' };
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

async function* handleSkillTrigger(
  agent: OfficeAgent,
  skillName: string,
  args: string,
): AsyncGenerator<StreamEvent> {
  const skill = agent.skillSystem.findSkill(skillName);
  if (!skill) {
    yield { type: 'text', content: `Skill not found: ${skillName}` };
    yield { type: 'done' };
    return;
  }

  yield { type: 'text', content: `Running skill "${skill.name}"...\n` };

  const result: SkillResult = await agent.skillSystem.executeSkill(skill, args);

  if (!result.success) {
    yield { type: 'text', content: `Skill failed: ${result.output}` };
    yield { type: 'done' };
    return;
  }

  if (result.mode === 'inline') {
    yield* agent.queryEngine.submitMessage(
      `[Skill ${skill.name} output]\n${result.output}\n\nPlease generate the final result.`,
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
    tasks: args ? `Query tasks: ${args}` : 'List all current tasks',
    remind: args ? `Create reminder: ${args}` : 'List all pending reminders',
    project: args ? `Check project "${args}" status` : 'List all active project sub-agents',
    memory: args ? `Search memory: ${args}` : 'List recent memory entries',
    cron: args ? `Manage cron tasks: ${args}` : 'List all cron tasks',
  };
  return commandPrompts[command] ?? `Execute command /${command} ${args}`.trim();
}
