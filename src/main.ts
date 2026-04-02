/**
 * Office Agent — 系统入口与组件装配
 *
 * 任务 22.1: createOfficeAgent 工厂函数、startAgent、stopAgent
 * 任务 22.2: handleMessage 消息处理流程（斜杠命令 / 普通文本 / 离开摘要 / 主动建议）
 * 任务 22.3: 技能触发与子 Agent 委派串联
 *
 * 需求: 11.1, 11.2, 11.3, 11.4, 1.1, 9.3, 10.3, 10.4, 8.3, 3.7
 */
import * as path from 'node:path';
import * as os from 'node:os';

import type { LLMClient } from './core/llm-client.js';
import type { StreamEvent, Message, Suggestion, UserConfig } from './types/index.js';

// Core
import { QueryEngine } from './core/query-engine.js';
import { ToolRegistry } from './core/tool-system.js';
import { MemorySystem } from './core/memory-system.js';
import { ContextManager } from './core/context-manager.js';
import { SkillSystem } from './core/skill-system.js';
import type { SkillResult } from './core/skill-system.js';
import { SubAgentManager } from './core/sub-agent-manager.js';
import { UserConfigManager } from './core/user-config.js';
import { isSlashCommand, parseSlashCommand, resolveCommand } from './core/slash-command.js';

// Services
import { ReminderEngine } from './services/reminder-engine.js';
import { CronScheduler } from './services/cron-scheduler.js';
import { BackgroundTaskManager } from './services/background-task-manager.js';
import { AwaySummaryEngine } from './services/away-summary-engine.js';
import { VoiceService } from './services/voice-service.js';
import { PromptSuggestionEngine } from './services/prompt-suggestion.js';

// Tools
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

// ============================================================
// Constants
// ============================================================

const BASE_DIR = path.join(os.homedir(), '.office-agent');
const CRON_DATA_FILE = path.join(BASE_DIR, 'cron-tasks.json');
const BUNDLED_SKILLS_DIR = path.join('src', 'skills', 'bundled');
const USER_SKILLS_DIR = path.join(BASE_DIR, 'skills');

// ============================================================
// System Prompt（中文）
// ============================================================

function buildSystemPrompt(toolDescriptions: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  return `# 角色定义

你是 Office Agent，一个专业的办公智能助理。你的职责是帮助用户管理工作信息、追踪任务、主动提醒，并通过飞书等工具协助日常办公。

你专为有 ADHD 症状或容易遗忘工作事项的用户设计，核心目标是减少信息遗漏和任务遗忘。

# 当前时间

${dateStr} ${timeStr}

所有涉及日期的推算必须基于上述当前时间。例如"下周四"是指从今天算起的下一个周四。

# 行为准则

1. **主动性**：不要等用户问，主动发现并提醒可能遗忘的事项
2. **准确性**：回答基于记忆系统中的真实数据，不确定时主动询问澄清
3. **简洁性**：回复简洁清晰，控制在 200 字以内。不要长篇大论，不要过度使用 emoji。ADHD 用户需要的是精准信息，不是信息轰炸
4. **安全性**：执行写操作（发消息、创建日程等）前必须获得用户确认
5. **记忆力**：自动记住对话中的重要信息，无需用户说"记住这个"
6. **中文优先**：默认使用中文与用户交流

# 工具调用

你可以通过工具来执行操作（如创建任务、查询信息、发送消息等）。当你需要执行操作时，系统会自动调用对应工具，你不需要手动输出 JSON。

当用户要求创建任务、设置提醒等操作时，你应该明确表示要调用工具，系统会自动处理。

# 可用工具

${toolDescriptions}

# 交互规范

- 用户输入斜杠命令（如 /tasks、/daily-report）时，直接执行对应功能
- 用户指令含义模糊时，主动询问澄清而非猜测执行
- 任务状态变更、重要决策等信息会自动存入记忆系统
- 每轮对话结束后可能生成下一步行动建议
- 回复要简短精炼，避免冗长的列表和过度解释`;
}

// ============================================================
// OfficeAgent Interface
// ============================================================

export interface OfficeAgent {
  // 核心组件引用
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

  /** 处理用户消息（斜杠命令 / 普通文本），返回流式事件 */
  handleMessage(input: string): AsyncGenerator<StreamEvent>;
  /** 启动 Agent（加载技能、启动调度器、加载配置） */
  start(): Promise<void>;
  /** 停止 Agent（停止调度器） */
  stop(): void;
  /** 获取当前用户配置 */
  getConfig(): UserConfig;
}

// ============================================================
// HandleMessage result type
// ============================================================

export interface HandleMessageResult {
  events: AsyncGenerator<StreamEvent>;
  suggestions?: Suggestion[];
  awaySummary?: string | null;
}

// ============================================================
// Factory: createOfficeAgent
// ============================================================

export interface CreateOfficeAgentOptions {
  llm: LLMClient;
  /** Override base directory for data storage (useful for testing) */
  baseDir?: string;
  /** Override context window size (default: 128000) */
  contextWindowSize?: number;
  /** Override model name */
  model?: string;
}

export function createOfficeAgent(options: CreateOfficeAgentOptions): OfficeAgent {
  const { llm, baseDir, contextWindowSize, model } = options;
  const dataDir = baseDir ?? BASE_DIR;

  // --- 1. User Config ---
  const configManager = new UserConfigManager(dataDir);
  const config = configManager.load();

  // --- 2. Core Systems ---
  const memorySystem = new MemorySystem(
    path.join(dataDir, 'memdir'),
    llm,
  );
  const contextManager = new ContextManager(contextWindowSize ?? 128_000, llm);
  const toolRegistry = new ToolRegistry();

  // --- 3. Services ---
  const reminderEngine = new ReminderEngine(config);
  const cronScheduler = new CronScheduler(
    path.join(dataDir, 'cron-tasks.json'),
    (task) => {
      // 定时任务触发时，将 prompt 注入 QueryEngine 消息队列
      // 通过 handleMessage 处理，实现调度 → 执行串联
      void agent.handleMessage(task.prompt);
    },
  );
  const backgroundTaskManager = new BackgroundTaskManager();
  const awaySummaryEngine = new AwaySummaryEngine(llm, config.awaySummary.thresholdMinutes);
  const voiceService = new VoiceService();
  const promptSuggestionEngine = new PromptSuggestionEngine(llm);
  const skillSystem = new SkillSystem(BUNDLED_SKILLS_DIR, USER_SKILLS_DIR, llm);
  const subAgentManager = new SubAgentManager(llm, path.join(dataDir, 'agents'));

  // --- 4. Register Tools ---
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

  // --- 5. Build system prompt ---
  const toolDescriptions = toolRegistry
    .listAll()
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join('\n');
  const systemPrompt = buildSystemPrompt(toolDescriptions);

  // --- 6. QueryEngine ---
  const queryEngine = new QueryEngine({
    model: model ?? 'claude-sonnet-4-20250514',
    systemPrompt,
    tools: toolRegistry,
    memorySystem,
    contextManager,
    llm,
  });

  // --- 7. Assemble OfficeAgent ---
  const agent: OfficeAgent = {
    queryEngine,
    toolRegistry,
    memorySystem,
    contextManager,
    skillSystem,
    subAgentManager,
    reminderEngine,
    cronScheduler,
    backgroundTaskManager,
    awaySummaryEngine,
    voiceService,
    promptSuggestionEngine,
    configManager,

    handleMessage: (input: string) => handleMessage(agent, input),
    start: () => startAgent(agent),
    stop: () => stopAgent(agent),
    getConfig: () => configManager.get(),
  };

  return agent;
}

// ============================================================
// startAgent / stopAgent
// ============================================================

async function startAgent(agent: OfficeAgent): Promise<void> {
  // 1. 加载用户配置
  agent.configManager.load();

  // 2. 加载技能
  await agent.skillSystem.loadSkills();

  // 3. 启动定时调度器
  agent.cronScheduler.start();

  // 4. 检查并补执行错过的定时任务
  agent.cronScheduler.checkMissedTasks();

  // 5. 记录启动时间为最后活动时间，防止刚启动就触发离开摘要
  agent.awaySummaryEngine.recordActivity();
}

function stopAgent(agent: OfficeAgent): void {
  agent.cronScheduler.stop();
}

// ============================================================
// handleMessage — 任务 22.2 & 22.3 核心流程
// ============================================================

async function* handleMessage(
  agent: OfficeAgent,
  input: string,
): AsyncGenerator<StreamEvent> {
  // --- 离开摘要检测 ---
  const activityStatus = agent.awaySummaryEngine.checkUserActivity();
  if (activityStatus.isAway) {
    const messages = [...agent.queryEngine.getMessages()];
    const ac = new AbortController();
    try {
      const summary = await agent.awaySummaryEngine.generateSummary(messages, ac.signal);
      if (summary) {
        yield { type: 'text', content: `📋 **你不在的时候：**\n${summary}\n\n---\n\n` };
      }
    } catch {
      // 摘要生成失败不阻塞主流程
    }
  }
  // 记录用户活动
  agent.awaySummaryEngine.recordActivity();

  // --- 斜杠命令检测 ---
  if (isSlashCommand(input)) {
    yield* handleSlashCommand(agent, input);
    return;
  }

  // --- 普通文本 → QueryEngine ---
  yield* agent.queryEngine.submitMessage(input);

  // --- 主动建议生成（每轮对话结束后） ---
  try {
    const suggestions = await generateSuggestions(agent);
    if (suggestions.length > 0) {
      const suggestionText = suggestions
        .map((s, i) => `${i + 1}. ${s.text}（${s.reason}）`)
        .join('\n');
      yield { type: 'text', content: `\n\n💡 **建议：**\n${suggestionText}` };
    }
  } catch {
    // 建议生成失败不阻塞
  }
}

// ============================================================
// 斜杠命令处理 — 任务 22.2
// ============================================================

async function* handleSlashCommand(
  agent: OfficeAgent,
  input: string,
): AsyncGenerator<StreamEvent> {
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    yield { type: 'text', content: '无法解析该命令，请检查格式。' };
    yield { type: 'done' };
    return;
  }

  const mapping = resolveCommand(parsed.command);
  if (!mapping) {
    yield { type: 'text', content: `未知命令: /${parsed.command}。可用命令: /tasks, /remind, /daily-report, /weekly-report, /meeting-notes, /task-breakdown, /feishu-sync, /project, /memory, /cron` };
    yield { type: 'done' };
    return;
  }

  // --- 技能触发（任务 22.3）---
  if (mapping.type === 'skill') {
    yield* handleSkillTrigger(agent, mapping.target, parsed.rawArgs);
    return;
  }

  // --- 工具调用 ---
  if (mapping.type === 'tool') {
    // 将斜杠命令转换为自然语言，交给 QueryEngine 处理
    // 这样 LLM 可以理解意图并正确调用工具
    const naturalLanguage = buildNaturalLanguageFromCommand(parsed.command, parsed.rawArgs);
    yield* agent.queryEngine.submitMessage(naturalLanguage);
    return;
  }
}

// ============================================================
// 技能触发与子 Agent 委派 — 任务 22.3
// ============================================================

async function* handleSkillTrigger(
  agent: OfficeAgent,
  skillName: string,
  args: string,
): AsyncGenerator<StreamEvent> {
  const skill = agent.skillSystem.findSkill(skillName);
  if (!skill) {
    yield { type: 'text', content: `未找到技能: ${skillName}` };
    yield { type: 'done' };
    return;
  }

  yield { type: 'text', content: `🔧 正在执行技能「${skill.name}」...\n` };

  const result: SkillResult = await agent.skillSystem.executeSkill(skill, args);

  if (!result.success) {
    yield { type: 'text', content: `❌ 技能执行失败: ${result.output}` };
    yield { type: 'done' };
    return;
  }

  if (result.mode === 'inline') {
    // inline 技能：将输出注入到 QueryEngine 上下文继续对话
    yield* agent.queryEngine.submitMessage(
      `[技能 ${skill.name} 输出]\n${result.output}\n\n请根据以上技能输出为用户生成最终结果。`,
    );
  } else {
    // fork 技能：独立执行完毕，直接返回结果
    yield { type: 'text', content: result.output };
    yield { type: 'done' };
  }
}

/**
 * 检查是否应委派给子 Agent 处理。
 * 当用户讨论的项目已有活跃的 Sub_Agent 时，自动委派。
 */
export async function tryDelegateToSubAgent(
  agent: OfficeAgent,
  input: string,
): Promise<string | null> {
  const activeAgents = agent.subAgentManager.list('active');
  if (activeAgents.length === 0) return null;

  // 简单匹配：检查输入中是否包含某个项目名称
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

// ============================================================
// 主动建议生成
// ============================================================

async function generateSuggestions(agent: OfficeAgent): Promise<Suggestion[]> {
  // 获取当前任务列表（通过 TaskManager 工具）
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

// ============================================================
// Helpers
// ============================================================

function buildNaturalLanguageFromCommand(command: string, args: string): string {
  const commandPrompts: Record<string, string> = {
    tasks: args ? `查询任务: ${args}` : '列出所有当前任务',
    remind: args ? `创建提醒: ${args}` : '列出所有待发送的提醒',
    project: args ? `查看项目「${args}」的状态` : '列出所有活跃的项目子 Agent',
    memory: args ? `搜索记忆: ${args}` : '列出最近的记忆条目',
    cron: args ? `管理定时任务: ${args}` : '列出所有定时任务',
  };
  return commandPrompts[command] ?? `执行命令 /${command} ${args}`.trim();
}
