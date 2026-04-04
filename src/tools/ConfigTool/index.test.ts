import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigTool } from './index.js';
import { UserConfigManager } from '../../core/user-config.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

describe('ConfigTool', () => {
  let tool: ConfigTool;
  let configManager: UserConfigManager;
  const testDir = path.join(os.tmpdir(), 'office-agent-config-test-' + Date.now());
  const ctx = { abortSignal: new AbortController().signal, userConfig: {} as any };

  beforeEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
    configManager = new UserConfigManager(testDir);
    configManager.load();
    tool = new ConfigTool(configManager);
  });

  it('should get current config', async () => {
    const result = await tool.call({ action: 'get' }, ctx);
    expect(result.success).toBe(true);
    expect((result.output as any).workingHours.start).toBe('09:00');
  });

  it('should update a config value by dot-path', async () => {
    const result = await tool.call({
      action: 'update',
      path: 'reminder.dailyBriefingTime',
      value: '08:00',
    }, ctx);
    expect(result.success).toBe(true);
    expect((result.output as any).newValue).toBe('08:00');
    expect(configManager.get().reminder.dailyBriefingTime).toBe('08:00');
  });

  it('should update nested config', async () => {
    const result = await tool.call({
      action: 'update',
      path: 'workingHours.start',
      value: '08:30',
    }, ctx);
    expect(result.success).toBe(true);
    expect(configManager.get().workingHours.start).toBe('08:30');
  });

  it('should reject invalid path', async () => {
    const result = await tool.call({
      action: 'update',
      path: 'nonexistent.field',
      value: 'test',
    }, ctx);
    expect(result.success).toBe(false);
  });

  it('should persist config to disk', async () => {
    await tool.call({ action: 'update', path: 'timezone', value: 'UTC' }, ctx);
    // Reload from disk
    const fresh = new UserConfigManager(testDir);
    fresh.load();
    expect(fresh.get().timezone).toBe('UTC');
  });
});
