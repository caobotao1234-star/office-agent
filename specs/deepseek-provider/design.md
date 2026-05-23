# DeepSeek V4 Provider 设计

## 架构

新增两层：

1. `src/core/deepseek-llm.ts`：DeepSeek OpenAI-compatible client，实现 `LLMClient`。
2. `src/core/llm-provider.ts`：根据环境变量和 CLI `-m` 参数选择 provider。

现有 `createOfficeAgent` 不关心 provider，只接收 `LLMClient`，因此主 Agent 架构保持不变。

## 配置

环境变量：

- `OFFICE_AGENT_LLM_PROVIDER=dashscope|deepseek`
- `DEEPSEEK_API_KEY=sk-...`
- `DEEPSEEK_MODEL=deepseek-v4-pro`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_THINKING=enabled|disabled`
- `DEEPSEEK_REASONING_EFFORT=high|max`

选择规则：

- 显式 `OFFICE_AGENT_LLM_PROVIDER` 优先。
- CLI `-m deepseek-v4-pro` / `-m deepseek-v4-flash` 会自动选 DeepSeek。
- 未指定时保持 DashScope 默认，避免破坏现有用户。

## DeepSeek Client

支持：

- `query()`：非流式文本调用。
- `queryStream()`：SSE 文本流，忽略 `reasoning_content`，只输出最终 `content`。
- `queryWithTools()`：Function Calling，透传工具定义，解析 `tool_calls`。

请求默认带：

- `thinking: { type: DEEPSEEK_THINKING }`
- `reasoning_effort: DEEPSEEK_REASONING_EFFORT`

## 多模态边界

当前 `LLMClient` 消息只支持纯文本，飞书机器人也只处理文本和语音。语音先经 DashScope STT 转文字再进入 Agent。

如果未来接视觉能力，应新增独立的 `VisionClient` 或 image-to-text 预处理层，把图片理解结果转成文本上下文，再交给当前 Agent。不要把图片直接塞给纯文本 LLM。

## 测试

- mock `fetch`，不访问真实 DeepSeek。
- 覆盖 DeepSeek query、stream、tool calls。
- 覆盖 provider resolver。
- 保留全量 `npm test/typecheck/build`。
