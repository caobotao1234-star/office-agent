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

当前 `LLMClient` 已支持 OpenAI vision content parts，飞书机器人也能接收图片和富文本图片。是否把图片传入 LLM 由 provider/model 的 `capabilities.vision` 决定。

DeepSeek V4 provider 当前标记为非视觉模型，因为官方 Chat API 未公开图片输入。收到图片时会提示不支持并忽略图片；如果同条消息有文字，继续处理文字。

## 测试

- mock `fetch`，不访问真实 DeepSeek。
- 覆盖 DeepSeek query、stream、tool calls。
- 覆盖 provider resolver。
- 保留全量 `npm test/typecheck/build`。
