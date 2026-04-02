import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemorySystem } from './memory-system.js';
import type { LLMClient } from './llm-client.js';
import type { MemoryEntry, Message } from '../types/index.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memtest-'));
}

function makeLLM(queryFn: (system: string, user: string) => string): LLMClient {
  return {
    async query(system: string, user: string, _signal: AbortSignal) {
      return queryFn(system, user);
    },
  };
}

async function seedEntries(ms: MemorySystem, count: number): Promise<MemoryEntry[]> {
  const entries: MemoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    const e = await ms.store({
      title: `Memory ${i}`,
      content: `Content for memory ${i}`,
      type: 'decision',
      tags: [`tag${i}`],
      source: 'user_input',
      updatedAt: new Date(Date.now() - (count - i) * 60_000), // older first
    });
    entries.push(e);
  }
  return entries;
}

describe('findRelevantMemories', () => {
  let dir: string;
  const signal = AbortSignal.timeout(5000);

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns empty array when no memories exist', async () => {
    const ms = new MemorySystem(dir);
    const result = await ms.findRelevantMemories('hello', signal);
    expect(result).toEqual([]);
  });

  it('returns top 5 by recency when no LLM is provided', async () => {
    const ms = new MemorySystem(dir);
    const entries = await seedEntries(ms, 8);
    const result = await ms.findRelevantMemories('anything', signal);
    expect(result).toHaveLength(5);
    // Most recently updated should come first
    expect(result[0]!.title).toBe(entries[7]!.title);
  });

  it('uses LLM to select relevant memories', async () => {
    // The LLM receives a manifest built from loadAll() order.
    // We capture the manifest to know which indices map to which entries.
    let capturedUser = '';
    const llm = makeLLM((_sys, usr) => { capturedUser = usr; return '0,2'; });
    const ms = new MemorySystem(dir, llm);
    await seedEntries(ms, 5);
    const result = await ms.findRelevantMemories('test context', signal);
    expect(result).toHaveLength(2);
    // Verify the LLM was called with a manifest
    expect(capturedUser).toContain('Memory');
    expect(capturedUser).toContain('test context');
  });

  it('falls back to recency when LLM returns no valid indices', async () => {
    const llm = makeLLM(() => 'no relevant memories');
    const ms = new MemorySystem(dir, llm);
    await seedEntries(ms, 3);
    const result = await ms.findRelevantMemories('ctx', signal);
    expect(result).toHaveLength(3);
  });

  it('falls back to recency when LLM throws', async () => {
    const llm: LLMClient = {
      async query() { throw new Error('LLM down'); },
    };
    const ms = new MemorySystem(dir, llm);
    await seedEntries(ms, 6);
    const result = await ms.findRelevantMemories('ctx', signal);
    expect(result).toHaveLength(5);
  });

  it('caps selection at 5 even if LLM returns more', async () => {
    const llm = makeLLM(() => '0,1,2,3,4,5,6,7');
    const ms = new MemorySystem(dir, llm);
    await seedEntries(ms, 8);
    const result = await ms.findRelevantMemories('ctx', signal);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});


describe('extractAndStoreFromConversation', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const sampleMessages: Message[] = [
    { role: 'user', content: '我喜欢早上9点开会', timestamp: new Date() },
    { role: 'assistant', content: '好的，我记住了你的偏好。', timestamp: new Date() },
    { role: 'user', content: '张三负责Q2的产品规划，他下周五之前要交报告', timestamp: new Date() },
  ];

  it('does nothing when no LLM is provided', async () => {
    const ms = new MemorySystem(dir);
    await ms.extractAndStoreFromConversation(sampleMessages);
    const all = await ms.search({});
    expect(all).toHaveLength(0);
  });

  it('does nothing when messages are empty', async () => {
    const llm = makeLLM(() => '[]');
    const ms = new MemorySystem(dir, llm);
    await ms.extractAndStoreFromConversation([]);
    const all = await ms.search({});
    expect(all).toHaveLength(0);
  });

  it('extracts and stores memories from conversation', async () => {
    const llm = makeLLM(() => JSON.stringify([
      { title: '用户偏好：早上开会', content: '用户喜欢早上9点开会', type: 'preference', tags: ['会议', '偏好'] },
      { title: '张三负责Q2规划', content: '张三负责Q2产品规划，下周五交报告', type: 'colleague', tags: ['张三', 'Q2'] },
    ]));
    const ms = new MemorySystem(dir, llm);
    await ms.extractAndStoreFromConversation(sampleMessages);
    const all = await ms.search({});
    expect(all).toHaveLength(2);
    expect(all.some((e) => e.type === 'preference')).toBe(true);
    expect(all.some((e) => e.type === 'colleague')).toBe(true);
    expect(all.every((e) => e.source === 'auto_extract')).toBe(true);
  });

  it('handles LLM returning empty array', async () => {
    const llm = makeLLM(() => '[]');
    const ms = new MemorySystem(dir, llm);
    await ms.extractAndStoreFromConversation(sampleMessages);
    const all = await ms.search({});
    expect(all).toHaveLength(0);
  });

  it('handles LLM returning markdown-fenced JSON', async () => {
    const llm = makeLLM(() => '```json\n[{"title":"test","content":"data","type":"decision","tags":[]}]\n```');
    const ms = new MemorySystem(dir, llm);
    await ms.extractAndStoreFromConversation(sampleMessages);
    const all = await ms.search({});
    expect(all).toHaveLength(1);
    expect(all[0]!.type).toBe('decision');
  });

  it('silently ignores LLM errors', async () => {
    const llm: LLMClient = {
      async query() { throw new Error('LLM down'); },
    };
    const ms = new MemorySystem(dir, llm);
    await ms.extractAndStoreFromConversation(sampleMessages);
    const all = await ms.search({});
    expect(all).toHaveLength(0);
  });

  it('falls back to decision type for unknown types', async () => {
    const llm = makeLLM(() => JSON.stringify([
      { title: 'test', content: 'data', type: 'unknown_type', tags: [] },
    ]));
    const ms = new MemorySystem(dir, llm);
    await ms.extractAndStoreFromConversation(sampleMessages);
    const all = await ms.search({});
    expect(all).toHaveLength(1);
    expect(all[0]!.type).toBe('decision');
  });

  it('skips items with missing title or content', async () => {
    const llm = makeLLM(() => JSON.stringify([
      { title: '', content: 'data', type: 'decision', tags: [] },
      { title: 'valid', content: 'data', type: 'decision', tags: [] },
      { title: 'no-content', content: '', type: 'decision', tags: [] },
    ]));
    const ms = new MemorySystem(dir, llm);
    await ms.extractAndStoreFromConversation(sampleMessages);
    const all = await ms.search({});
    expect(all).toHaveLength(1);
    expect(all[0]!.title).toBe('valid');
  });
});
