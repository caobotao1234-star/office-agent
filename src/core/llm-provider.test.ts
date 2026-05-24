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
    expect(configured.llm.capabilities?.vision).toBe(false);
    expect(configured.llm.capabilities?.toolCalling).toBe(true);
    expect(configured.llm.capabilities?.streaming).toBe(true);
    expect(configured.llm.capabilities?.jsonMode).toBe(true);
    expect(configured.llm.capabilities?.webSearchNative).toBe(false);
    expect(configured.llm.capabilities?.supportsImageDataUrl).toBe(false);
  });

  it('marks DashScope qwen-vl models as vision-capable', () => {
    resetEnv();
    process.env['DASHSCOPE_API_KEY'] = 'sk-test';
    const configured = createConfiguredLLM({ modelOverride: 'qwen-vl-plus' });
    expect(configured.provider).toBe('dashscope');
    expect(configured.llm.capabilities?.vision).toBe(true);
    expect(configured.llm.capabilities?.toolCalling).toBe(true);
    expect(configured.llm.capabilities?.streaming).toBe(true);
    expect(configured.llm.capabilities?.webSearchNative).toBe(false);
    expect(configured.llm.capabilities?.supportsImageDataUrl).toBe(true);
  });

  it('marks DashScope text models as native-search text models', () => {
    resetEnv();
    process.env['DASHSCOPE_API_KEY'] = 'sk-test';
    const configured = createConfiguredLLM({ modelOverride: 'qwen-plus' });
    expect(configured.llm.capabilities?.vision).toBe(false);
    expect(configured.llm.capabilities?.webSearchNative).toBe(true);
    expect(configured.llm.capabilities?.supportsImageDataUrl).toBe(false);
  });
});
