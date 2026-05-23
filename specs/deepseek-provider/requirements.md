# DeepSeek V4 Provider 需求

## 目标

让 Office Agent 可以通过官方 DeepSeek OpenAI-compatible API 使用 DeepSeek V4 文本模型，同时明确当前多模态边界。

## 用户故事

- 作为用户，我可以在 `.env` 中配置 DeepSeek API Key，然后用 DeepSeek V4 跑 CLI 和飞书机器人。
- 作为用户，我可以选择 `deepseek-v4-pro` 或 `deepseek-v4-flash`。
- 作为 Agent 维护者，我需要 DeepSeek provider 支持普通对话、流式输出和 Function Calling。
- 作为用户，我需要知道 DeepSeek 官方 API 当前是否支持图片输入，以及当前 Agent 对图片消息的真实处理方式。

## 接受标准

- 新增 DeepSeek LLM client，兼容现有 `LLMClient`。
- `OFFICE_AGENT_LLM_PROVIDER=deepseek` 或 `-m deepseek-v4-pro` 可以选择 DeepSeek。
- CLI 和飞书机器人共用同一 provider 解析逻辑。
- 不把 API Key 写进代码或 README 示例真实值。
- 单元测试覆盖 DeepSeek 非流式、流式、tool calls、provider 选择和缺 key 错误。
- README 和 `.env.example` 说明 DeepSeek 配置和多模态限制。

## 非目标

- 不接非官方 DeepSeek 多模态服务。
- 不为 DeepSeek 实现图片 OCR 或非官方视觉路由；图片输入由支持 vision capability 的其他 provider/model 处理。
- 不移除 DashScope；DeepSeek 是可选 provider。

## 官方文档结论

- DeepSeek 官方文档列出 `deepseek-v4-flash` 和 `deepseek-v4-pro`，OpenAI base URL 为 `https://api.deepseek.com`。
- Chat Completion 文档中的消息 `content` 是 string，模型能力表列出 JSON Output、Tool Calls、Prefix/FIM 等，未列出图片输入或 vision API。
- 因此当前只适配 DeepSeek 文本/工具调用 API。
