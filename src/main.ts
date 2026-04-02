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
    '# CRITICAL RULE: You MUST use tools for actions',
    '',
    'When the user asks you to CREATE a task, CREATE a project, SAVE a memory, SET a reminder, or any other action:',
    '- You MUST call the appropriate tool (TaskManager, SubAgentTool, MemoryTool, etc.)',
    '- You MUST NOT just describe the action in text',
    '- If you respond with text saying "created" or "saved" without actually calling a tool, that is WRONG',
    '- The user can see tool calls in the UI. If no tool call appears, the action did not happen.',
    '',
    '# Available Tools',
    '',
    toolDescriptions,
    '',
    '# Memory System',
    '',
    '- Memory index is injected dynamically each turn',
    '- Use MemoryTool to store important information',
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
    '- Be concise but thorough when needed',
    '- When user asks about time, use the injected current time',
    '- For token usage, tell user to type /usage',
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
  console.log('[handleMessage] start:', input.slice(0, 50));

  const activityStatus = agent.awaySummaryEngine.checkUserActivity();
  if (activityStatus.isAway) {
    console.log('[handleMessage] away summary triggered');
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

  console.log('[handleMessage] calling submitMessage');
  yield* agent.queryEngine.submitMessage(input);
  console.log('[handleMessage] submitMessage done');

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
    yield { type: 'text', content: '\u65E0\u6CD5\u89E3\u6790\u547D\u4EE4\uFF0C\u8BF7\u68C0\u67E5\u683C\u5F0F\u3002' };
    yield { type: 'done' };
    return;
  }

  const mapping = resolveCommand(parsed.command);
  if (!mapping) {
    yield { type: 'text', content: `\u672A\u77E5\u547D\u4EE4: /${parsed.command}\u3002\u53EF\u7528\u547D\u4EE4: /tasks, /remind, /daily-report, /weekly-report, /meeting-notes, /task-breakdown, /feishu-sync, /project, /memory, /cron` };
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
