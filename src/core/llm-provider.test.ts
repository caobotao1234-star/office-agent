import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfiguredLLM, resolveLLMProvider } from './llm-provider.js';

const OLD_ENV = { ...process.env };

function resetEnv(): void {
  process.env = { ...OLD_ENV };
  delete process.env['OFFICE_AGENT_LLM_PROVIDER'];
  delete process.env['DEEPSEEK_API_KEY'];
  delete process.env['DEEPSEEK_MODEL'];
  delete process.env['DASHSCOPE_API_KEY'];
  delete process.env['DASHSCOPE_MODEL'];
}

describe('llm-provider', () => {
  afterEach(() => {
    resetEnv();
    vi.unstubAllGlobals();
  });

  it('keeps DashScope as the default provider', () => {
    resetEnv();
    expect(resolveLLMProvider()).toEqual({ provider: 'dashscope', model: 'qwen-plus' });
  });

  it('uses DeepSeek when explicitly configured', () => {
    resetEnv();
    process.env['OFFICE_AGENT_LLM_PROVIDER'] = 'deepseek';
    process.env['DEEPSEEK_MODEL'] = 'deepseek-v4-flash';
    expect(resolveLLMProvider()).toEqual({ provider: 'deepseek', model: 'deepseek-v4-flash' });
  });

  it('uses DeepSeek when model override starts with deepseek-', () => {
    resetEnv();
    expect(resolveLLMProvider('deepseek-v4-pro')).toEqual({ provider: 'deepseek', model: 'deepseek-v4-pro' });
  });

  it('requires DeepSeek API key for DeepSeek provider', () => {
    resetEnv();
    process.env['OFFICE_AGENT_LLM_PROVIDER'] = 'deepseek';
    expect(() => createConfiguredLLM()).toThrow('DEEPSEEK_API_KEY');
  });

  it('creates DeepSeek client when API key exists', () => {
    resetEnv();
    process.env['OFFICE_AGENT_LLM_PROVIDER'] = 'deepseek';
    process.env['DEEPSEEK_API_KEY'] = 'sk-test';
    const configured = createConfiguredLLM();
    expect(configured.provider).toBe('deepseek');
    expect(configured.model).toBe('deepseek-v4-pro');
    expect(configured.llm.queryWithTools).toBeTypeOf('function');
  });
});
