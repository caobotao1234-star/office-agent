import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';

import { ContextManager } from '../core/context-manager.js';
import type { LLMClient, LLMMessage, LLMQueryResult, LLMToolDef } from '../core/llm-client.js';
import { MemorySystem } from '../core/memory-system.js';
import { QueryEngine } from '../core/query-engine.js';
import { ToolRegistry, type Tool } from '../core/tool-system.js';
import { UserConfigManager } from '../core/user-config.js';
import type { StreamEvent, ToolContext, ToolResult } from '../types/index.js';

type ReplayStep =
  | {
      type: 'tool';
      name: string;
      arguments?: Record<string, unknown>;
      rawArguments?: string;
    }
  | {
      type: 'final';
      content: string;
      expectLastToolResultIncludes?: string[];
      expectLatestUserImageCount?: number;
    };

interface ReplayTool {
  name: string;
  result: ToolResult;
}

interface ReplayCase {
  name: string;
  userMessage: string;
  images?: string[];
  steps: ReplayStep[];
  tools: ReplayTool[];
  expectToolNames: string[];
  expectFinalIncludes: string;
  capabilities?: LLMClient['capabilities'];
}

const REPLAY_CASES: ReplayCase[] = [
  {
    name: 'explicit reminder creates agenda item',
    userMessage: '明天下午 3 点提醒我给客户发方案',
    steps: [
      {
        type: 'tool',
        name: 'AgendaTool',
        arguments: {
          action: 'create',
          type: 'reminder',
          title: '给客户发方案',
          triggerAt: '2026-05-24T15:00:00+08:00',
          priority: 'medium',
        },
      },
      {
        type: 'final',
        content: '已设置提醒：明天下午 3 点给客户发方案。',
        expectLastToolResultIncludes: ['"success":true', 'agenda_1'],
      },
    ],
    tools: [
      {
        name: 'AgendaTool',
        result: { success: true, output: { id: 'agenda_1', title: '给客户发方案' } },
      },
    ],
    expectToolNames: ['AgendaTool'],
    expectFinalIncludes: '已设置提醒',
  },
  {
    name: 'feishu command failure is surfaced',
    userMessage: '读取这个飞书文档：https://example.feishu.cn/docx/xxx',
    steps: [
      {
        type: 'tool',
        name: 'LarkCli',
        arguments: {
          command: 'lark-cli docs +fetch --api-version v2 --doc xxx --doc-format markdown --format json --as user',
        },
      },
      {
        type: 'final',
        content: '读取失败：docs +fetch failed。请先确认文档权限或 CLI 登录状态。',
        expectLastToolResultIncludes: ['"success":false', 'docs +fetch failed'],
      },
    ],
    tools: [
      {
        name: 'LarkCli',
        result: { success: false, output: null, error: 'docs +fetch failed' },
      },
    ],
    expectToolNames: ['LarkCli'],
    expectFinalIncludes: '读取失败',
  },
  {
    name: 'durable project knowledge is captured',
    userMessage: '记一下：张三负责 Apollo 项目前端，周五前要给客户演示。',
    steps: [
      {
        type: 'tool',
        name: 'KnowledgeCaptureTool',
        arguments: {
          source: 'conversation',
          contextItems: [
            {
              type: 'person',
              key: 'person:张三',
              title: '张三',
              summary: '负责 Apollo 项目前端。',
              relations: [{ type: 'responsible_for', targetKey: 'project:apollo', targetTitle: 'Apollo 项目' }],
            },
          ],
          agendaItems: [
            {
              type: 'commitment',
              title: 'Apollo 项目客户演示',
              triggerAt: '2026-05-29T10:00:00+08:00',
              deadlineAt: '2026-05-29T18:00:00+08:00',
              priority: 'high',
            },
          ],
        },
      },
      {
        type: 'final',
        content: '已记入上下文，并创建 Apollo 项目客户演示的跟进提醒。',
        expectLastToolResultIncludes: ['"success":true', 'captured'],
      },
    ],
    tools: [
      {
        name: 'KnowledgeCaptureTool',
        result: { success: true, output: { captured: 2 } },
      },
    ],
    expectToolNames: ['KnowledgeCaptureTool'],
    expectFinalIncludes: '已记入上下文',
  },
  {
    name: 'vision model receives image input',
    userMessage: '帮我识别这张图，并告诉我下一步该怎么做',
    images: ['data:image/png;base64,aW1hZ2U='],
    steps: [
      {
        type: 'final',
        content: '这张图看起来是一张测试图片，我会根据图中内容继续处理。',
        expectLatestUserImageCount: 1,
      },
    ],
    tools: [],
    expectToolNames: [],
    expectFinalIncludes: '测试图片',
    capabilities: { vision: true },
  },
  {
    name: 'base creation repairs invalid cli attempts',
    userMessage: '做个多维表格，把你的能力写进去',
    steps: [
      {
        type: 'tool',
        name: 'LarkCli',
        arguments: {
          args: ['base', '+create', '--title', 'Office Agent 能力表', '--as', 'user'],
        },
      },
      {
        type: 'tool',
        name: 'LarkCli',
        arguments: {
          args: ['base', '+base-create', '--help'],
        },
      },
      {
        type: 'tool',
        name: 'LarkCli',
        arguments: {
          args: ['base', '+base-create', '--name', 'Office Agent 能力表', '--as', 'user', '--dry-run'],
        },
      },
      {
        type: 'tool',
        name: 'LarkCli',
        arguments: {
          args: ['base', '+base-create', '--name', 'Office Agent 能力表', '--as', 'user'],
        },
      },
      {
        type: 'final',
        content: '已创建多维表格，并记录了可继续补表字段和记录。',
        expectLastToolResultIncludes: ['"success":true', 'base_token'],
      },
    ],
    tools: [
      {
        name: 'LarkCli',
        result: { success: false, output: { helpHint: ['base', '+base-create', '--help'] }, error: 'base 没有 +create 子命令' },
      },
      {
        name: 'LarkCli',
        result: { success: true, output: { stdout: 'Usage: lark-cli base +base-create --name NAME --as user' } },
      },
      {
        name: 'LarkCli',
        result: { success: true, output: { stdout: '{"api":[{"method":"POST"}]}' } },
      },
      {
        name: 'LarkCli',
        result: { success: true, output: { data: { base: { base_token: 'base_token_1' } } } },
      },
    ],
    expectToolNames: ['LarkCli', 'LarkCli', 'LarkCli', 'LarkCli'],
    expectFinalIncludes: '已创建多维表格',
  },
  {
    name: 'docs creation uses stdin for multiline content',
    userMessage: '创建一份飞书文档，介绍你的能力，正文写详细一点',
    steps: [
      {
        type: 'tool',
        name: 'LarkCli',
        arguments: {
          args: [
            'docs',
            '+create',
            '--api-version',
            'v2',
            '--doc-format',
            'markdown',
            '--content',
            '-',
            '--as',
            'user',
          ],
          stdin: '<title>Office Agent 能力说明</title>\n# Office Agent\n\n- 任务\n- 文档\n- 日程',
        },
      },
      {
        type: 'final',
        content: '已创建飞书文档并写入能力说明。',
        expectLastToolResultIncludes: ['"success":true', 'docx_token'],
      },
    ],
    tools: [
      {
        name: 'LarkCli',
        result: { success: true, output: { stdout: '{"docx_token":"docx_token_1","url":"https://example.feishu.cn/docx/docx_token_1"}' } },
      },
    ],
    expectToolNames: ['LarkCli'],
    expectFinalIncludes: '已创建飞书文档',
  },
  {
    name: 'base creation continues through table and record writes',
    userMessage: '做个多维表格，把你的所有能力写进去',
    steps: [
      {
        type: 'tool',
        name: 'LarkCli',
        arguments: {
          args: ['base', '+base-create', '--name', 'Office Agent 能力表', '--as', 'user'],
        },
      },
      {
        type: 'tool',
        name: 'LarkCli',
        arguments: {
          args: ['base', '+table-create', '--base-token', 'base_token_1', '--name', '能力清单', '--as', 'user'],
        },
      },
      {
        type: 'tool',
        name: 'LarkCli',
        arguments: {
          args: [
            'base',
            '+record-batch-create',
            '--base-token',
            'base_token_1',
            '--table-id',
            'tbl_1',
            '--json',
            '{"fields":["能力","怎么用"],"rows":[["任务管理","直接说要记录的待办"],["飞书文档","让我创建、读取或更新文档"]]}',
            '--as',
            'user',
          ],
        },
      },
      {
        type: 'final',
        content: '已创建多维表格、能力清单表，并写入能力记录。',
        expectLastToolResultIncludes: ['"success":true', 'created":2'],
      },
    ],
    tools: [
      {
        name: 'LarkCli',
        result: { success: true, output: { data: { base: { base_token: 'base_token_1' } } } },
      },
      {
        name: 'LarkCli',
        result: { success: true, output: { data: { table: { id: 'tbl_1' } } } },
      },
      {
        name: 'LarkCli',
        result: { success: true, output: { created: 2 } },
      },
    ],
    expectToolNames: ['LarkCli', 'LarkCli', 'LarkCli'],
    expectFinalIncludes: '已创建多维表格',
  },
  {
    name: 'malformed docs arguments are repaired before tool execution',
    userMessage: '创建飞书文档，里面有带引号的内容',
    steps: [
      {
        type: 'tool',
        name: 'LarkCli',
        rawArguments: '{"args":["docs","+create","--api-version","v2","--doc-format","markdown","--content","<title>能力说明</title>\\n他说 "创建文档" 时要用 stdin","--as","user"]}',
      },
      {
        type: 'final',
        content: '已创建文档，含引号内容也正常写入。',
        expectLastToolResultIncludes: ['"success":true'],
      },
    ],
    tools: [
      {
        name: 'LarkCli',
        result: { success: true, output: { stdout: '{"ok":true}' } },
      },
    ],
    expectToolNames: ['LarkCli'],
    expectFinalIncludes: '已创建文档',
  },
  {
    name: 'project status uses project dashboard',
    userMessage: 'Apollo 项目现在怎么样，有什么风险和下一步？',
    steps: [
      {
        type: 'tool',
        name: 'ProjectDashboardTool',
        arguments: {
          action: 'get',
          project: 'Apollo',
          limit: 10,
        },
      },
      {
        type: 'final',
        content: 'Apollo 项目当前 active。主要风险是客户演示稿逾期；下一步应先处理演示稿并跟进客户方案承诺。',
        expectLastToolResultIncludes: ['"success":true', '客户演示稿逾期', '客户方案承诺'],
      },
    ],
    tools: [
      {
        name: 'ProjectDashboardTool',
        result: {
          success: true,
          output: {
            project: { title: 'Apollo', status: 'active' },
            risks: ['任务逾期：客户演示稿逾期'],
            nextActions: ['处理任务：客户演示稿逾期', '承诺：客户方案承诺'],
          },
        },
      },
    ],
    expectToolNames: ['ProjectDashboardTool'],
    expectFinalIncludes: '主要风险',
  },
];

class ScriptedLLM implements LLMClient {
  private cursor = 0;
  readonly capabilities: LLMClient['capabilities'];

  constructor(private readonly steps: ReplayStep[], capabilities?: LLMClient['capabilities']) {
    this.capabilities = capabilities;
  }

  async query(): Promise<string> {
    return '';
  }

  async queryWithTools(
    messages: LLMMessage[],
    _tools: LLMToolDef[],
    _signal: AbortSignal,
  ): Promise<LLMQueryResult> {
    const step = this.steps[this.cursor++];
    if (!step) throw new Error('Replay script ended before QueryEngine finished');

    if (step.type === 'tool') {
      return {
        content: null,
        toolCalls: [
              {
                id: `replay-tool-${this.cursor}`,
                function: {
                  name: step.name,
                  arguments: step.rawArguments ?? JSON.stringify(step.arguments ?? {}),
                },
              },
        ],
      };
    }

    const lastToolMessage = [...messages].reverse().find((message) => message.role === 'tool');
    const lastToolContent = typeof lastToolMessage?.content === 'string' ? lastToolMessage.content : '';
    for (const expected of step.expectLastToolResultIncludes ?? []) {
      assert.ok(
        lastToolContent.includes(expected),
        `Expected last tool result to include "${expected}", got: ${lastToolContent || '<none>'}`,
      );
    }
    if (step.expectLatestUserImageCount !== undefined) {
      const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
      const imageCount = Array.isArray(latestUserMessage?.content)
        ? latestUserMessage.content.filter((part) => part.type === 'image_url').length
        : 0;
      assert.equal(imageCount, step.expectLatestUserImageCount);
    }

    return { content: step.content, toolCalls: null };
  }
}

function createReplayTool(name: string, results: ToolResult[], calls: Array<{ name: string; input: unknown }>): Tool {
  return {
    name,
    description: `Replay fake tool: ${name}`,
    inputSchema: z.object({}).passthrough(),
    isEnabled: () => true,
    isReadOnly: () => false,
    checkPermissions: () => ({ allowed: true }),
    call: async (input: unknown, _context: ToolContext) => {
      calls.push({ name, input });
      const result = results.shift();
      if (!result) return { success: false, output: null, error: `Replay result queue exhausted for ${name}` };
      return result;
    },
  };
}

async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

async function runCase(testCase: ReplayCase): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-replay-'));
  const calls: Array<{ name: string; input: unknown }> = [];

  try {
    const llm = new ScriptedLLM(testCase.steps, testCase.capabilities);
    const registry = new ToolRegistry();
    const resultsByTool = new Map<string, ToolResult[]>();
    for (const tool of testCase.tools) {
      const results = resultsByTool.get(tool.name) ?? [];
      results.push(tool.result);
      resultsByTool.set(tool.name, results);
    }
    for (const [name, results] of resultsByTool) registry.register(createReplayTool(name, results, calls));

    const engine = new QueryEngine({
      model: 'replay-script',
      systemPrompt: 'You are a replay-tested office assistant.',
      tools: registry,
      memorySystem: new MemorySystem(path.join(tempDir, 'memdir'), llm),
      contextManager: new ContextManager(128_000, llm),
      llm,
      maxToolRounds: 5,
      getUserConfig: () => UserConfigManager.getDefault(),
    });

    const events = await collectEvents(engine.submitMessage(testCase.userMessage, testCase.images));
    const actualToolNames = events
      .filter((event): event is Extract<StreamEvent, { type: 'tool_use' }> => event.type === 'tool_use')
      .map((event) => event.toolName);
    const finalText = events
      .filter((event): event is Extract<StreamEvent, { type: 'text' }> => event.type === 'text')
      .map((event) => event.content)
      .join('');

    assert.deepEqual(actualToolNames, testCase.expectToolNames);
    assert.deepEqual(calls.map((call) => call.name), testCase.expectToolNames);
    assert.ok(finalText.includes(testCase.expectFinalIncludes), `Final text mismatch: ${finalText}`);
    assert.equal(events.at(-1)?.type, 'done');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function runReplayEval(cases = REPLAY_CASES): Promise<void> {
  const failures: Array<{ name: string; error: unknown }> = [];

  for (const testCase of cases) {
    try {
      await runCase(testCase);
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failures.push({ name: testCase.name, error });
      console.error(`FAIL ${testCase.name}`);
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length}/${cases.length} replay cases failed`);
  }

  console.log(`Replay eval passed: ${cases.length}/${cases.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runReplayEval().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
