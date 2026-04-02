/**
 * Smoke test — 非交互式验证 Agent 完整流程
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { createOfficeAgent } from './main.js';
import type { LLMClient } from './core/llm-client.js';
import type { StreamEvent } from './types/index.js';

let callCount = 0;
let lastToolUsed = false;

const mockLLM: LLMClient = {
  async query(_system: string, user: string, _signal: AbortSignal): Promise<string> {
    callCount++;
    const input = user.toLowerCase();

    if (_system.includes('memory extraction') || _system.includes('memory relevance')) {
      return '[]';
    }

    // 如果上一轮已经调用了工具，这一轮返回文本总结
    if (lastToolUsed) {
      lastToolUsed = false;
      if (input.includes('tool_result') || input.includes('"success"')) {
        return '已完成操作。';
      }
      return `Mock 回复 #${callCount}`;
    }

    if (input.includes('列出所有当前任务')) {
      lastToolUsed = true;
      return JSON.stringify({ tool_use: { name: 'TaskManager', input: { action: 'list' } } });
    }
    if (input.includes('创建任务')) {
      lastToolUsed = true;
      return JSON.stringify({
        tool_use: { name: 'TaskManager', input: { action: 'create', description: '写周报', priority: 'high', source: 'user_input' } },
      });
    }

    return `Mock 回复 #${callCount}`;
  },
};

async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

async function main() {
  const dataDir = path.join(os.tmpdir(), `office-agent-smoke-${Date.now()}`);
  console.log('=== Office Agent Smoke Test ===\n');

  // 1. 创建 Agent
  const agent = createOfficeAgent({ llm: mockLLM, baseDir: dataDir });
  console.log('✅ Agent 创建成功');

  // 2. 启动
  await agent.start();
  console.log('✅ Agent 启动成功');

  // 3. 测试普通对话
  console.log('\n--- 测试 1: 普通对话 ---');
  callCount = 0;
  let events = await collectEvents(agent.handleMessage('你好'));
  for (const ev of events) {
    if (ev.type === 'text') console.log(`  [text] ${ev.content.slice(0, 100)}`);
    else console.log(`  [${ev.type}]`);
  }

  // 4. 测试斜杠命令 /tasks
  console.log('\n--- 测试 2: /tasks 命令 ---');
  callCount = 0;
  events = await collectEvents(agent.handleMessage('/tasks'));
  for (const ev of events) {
    if (ev.type === 'text') console.log(`  [text] ${ev.content.slice(0, 100)}`);
    else if (ev.type === 'tool_use') console.log(`  [tool_use] ${(ev as any).toolName}`);
    else if (ev.type === 'tool_result') console.log(`  [tool_result] success=${(ev as any).result.success}`);
    else console.log(`  [${ev.type}]`);
  }

  // 5. 测试创建任务
  console.log('\n--- 测试 3: 创建任务 ---');
  callCount = 0;
  events = await collectEvents(agent.handleMessage('创建任务：写周报'));
  for (const ev of events) {
    if (ev.type === 'text') console.log(`  [text] ${ev.content.slice(0, 100)}`);
    else if (ev.type === 'tool_use') console.log(`  [tool_use] ${(ev as any).toolName} input=${JSON.stringify((ev as any).input).slice(0, 80)}`);
    else if (ev.type === 'tool_result') console.log(`  [tool_result] success=${(ev as any).result.success}`);
    else console.log(`  [${ev.type}]`);
  }

  // 6. 测试技能触发
  console.log('\n--- 测试 4: /daily-report 技能 ---');
  callCount = 0;
  events = await collectEvents(agent.handleMessage('/daily-report'));
  for (const ev of events) {
    if (ev.type === 'text') console.log(`  [text] ${ev.content.slice(0, 100)}`);
    else console.log(`  [${ev.type}]`);
  }

  // 7. 测试未知命令
  console.log('\n--- 测试 5: 未知命令 ---');
  events = await collectEvents(agent.handleMessage('/blah'));
  for (const ev of events) {
    if (ev.type === 'text') console.log(`  [text] ${ev.content.slice(0, 100)}`);
    else console.log(`  [${ev.type}]`);
  }

  // 8. 停止
  agent.stop();
  console.log('\n✅ Agent 停止成功');
  console.log('\n=== Smoke Test 完成 ===');
}

main().catch(console.error);
