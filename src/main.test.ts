/**
 * Integration tests for src/main.ts
 * Tests: createOfficeAgent, start/stop, handleMessage (slash commands, text, skill triggers)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createOfficeAgent, tryDelegateToSubAgent } from './main.js';
import type { OfficeAgent } from './main.js';
import type { LLMClient } from './core/llm-client.js';
import type { StreamEvent } from './types/index.js';

// ============================================================
// Mock LLM
// ============================================================

function createMockLLM(response = '好的，我来帮你处理。'): LLMClient {
  return {
    query: vi.fn().mockResolvedValue(response),
  };
}

// ============================================================
// Helpers
// ============================================================

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `office-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ============================================================
// Tests
// ============================================================

describe('createOfficeAgent', () => {
  let agent: OfficeAgent;
  let baseDir: string;

  beforeEach(() => {
    baseDir = tmpDir();
    agent = createOfficeAgent({
      llm: createMockLLM(),
      baseDir,
    });
  });

  it('should create an agent with all components initialized', () => {
    expect(agent.queryEngine).toBeDefined();
    expect(agent.toolRegistry).toBeDefined();
    expect(agent.memorySystem).toBeDefined();
    expect(agent.contextManager).toBeDefined();
    expect(agent.skillSystem).toBeDefined();
    expect(agent.subAgentManager).toBeDefined();
    expect(agent.agendaStore).toBeDefined();
    expect(agent.officeContextStore).toBeDefined();
    expect(agent.agendaScheduler).toBeDefined();
    expect(agent.cronScheduler).toBeDefined();
    expect(agent.awaySummaryEngine).toBeDefined();
    expect(agent.notificationService).toBeDefined();
    expect(agent.configManager).toBeDefined();
  });

  it('should register only active, non-stub tools', () => {
    const tools = agent.toolRegistry.listAll();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'AgendaTool',
      'ConfigTool',
      'CronTool',
      'LarkCli',
      'MemoryTool',
      'OfficeContextTool',
      'SkillCreator',
      'SubAgentTool',
      'TaskManager',
      'WebSearch',
    ]);
  });

  it('should expose LarkCli and remove legacy/stub tool surfaces', () => {
    const allNames = agent.toolRegistry.listAll().map((t) => t.name);
    const enabledNames = agent.toolRegistry.listEnabled().map((t) => t.name).sort();
    expect(enabledNames).toContain('LarkCli');
    expect(allNames).not.toContain('FeishuConnector');
    expect(allNames).not.toContain('CalendarTool');
    expect(allNames).not.toContain('EmailTool');
    expect(allNames).not.toContain('DocumentParser');
    expect(allNames).not.toContain('ReminderTool');
  });

  it('should return default config via getConfig()', () => {
    const config = agent.getConfig();
    expect(config.workingHours.start).toBe('09:00');
    expect(config.timezone).toBe('Asia/Shanghai');
  });
});

describe('startAgent / stopAgent', () => {
  let agent: OfficeAgent;
  let baseDir: string;

  beforeEach(() => {
    baseDir = tmpDir();
    agent = createOfficeAgent({
      llm: createMockLLM(),
      baseDir,
    });
  });

  it('should start and stop without errors', async () => {
    await agent.start();
    // After start, skills should be loaded (may be empty if no bundled dir)
    agent.stop();
  });
});

describe('handleMessage — slash commands', () => {
  let agent: OfficeAgent;
  let baseDir: string;

  beforeEach(() => {
    baseDir = tmpDir();
    agent = createOfficeAgent({
      llm: createMockLLM(),
      baseDir,
    });
  });

  it('should handle unknown slash command gracefully', async () => {
    const events = await collectEvents(agent.handleMessage('/unknown-cmd'));
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length).toBeGreaterThan(0);
    const text = textEvents.map((e) => (e as { content: string }).content).join('');
    expect(text).toContain('未知命令');
  });

  it('should handle /tasks command by routing to QueryEngine', async () => {
    const events = await collectEvents(agent.handleMessage('/tasks'));
    // Should produce text and done events (via QueryEngine)
    expect(events.length).toBeGreaterThan(0);
    const types = events.map((e) => e.type);
    expect(types).toContain('text');
  });

  it('should handle invalid slash command format', async () => {
    const events = await collectEvents(agent.handleMessage('/'));
    // Not a valid slash command, falls through to QueryEngine
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('handleMessage — normal text', () => {
  let agent: OfficeAgent;
  let baseDir: string;

  beforeEach(() => {
    baseDir = tmpDir();
    agent = createOfficeAgent({
      llm: createMockLLM('这是一个测试回复。'),
      baseDir,
    });
  });

  it('should process normal text through QueryEngine', async () => {
    const events = await collectEvents(agent.handleMessage('你好'));
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length).toBeGreaterThan(0);
  });

  it('should include done event at the end', async () => {
    const events = await collectEvents(agent.handleMessage('帮我查看今天的任务'));
    // Should have at least a text event from QueryEngine
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});

describe('handleMessage — skill trigger', () => {
  let agent: OfficeAgent;
  let baseDir: string;

  beforeEach(() => {
    baseDir = tmpDir();
    agent = createOfficeAgent({
      llm: createMockLLM('技能执行结果'),
      baseDir,
    });
  });

  it('should report skill not found for unloaded skill', async () => {
    // Skills haven't been loaded (no start()), so /daily-report should fail gracefully
    const events = await collectEvents(agent.handleMessage('/daily-report'));
    const textEvents = events.filter((e) => e.type === 'text');
    const text = textEvents.map((e) => (e as { content: string }).content).join('');
    expect(text).toContain('未找到技能');
  });
});

describe('tryDelegateToSubAgent', () => {
  it('should return null when no active sub-agents', async () => {
    const baseDir = tmpDir();
    const agent = createOfficeAgent({
      llm: createMockLLM(),
      baseDir,
    });
    const result = await tryDelegateToSubAgent(agent, '讨论Q2规划');
    expect(result).toBeNull();
  });
});
