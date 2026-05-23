# 飞书图片输入恢复设计

## 架构

本次恢复分三层：

1. `LLMClient`：支持 `content` 为 `string | LLMContentPart[] | null`，并增加 `capabilities.vision`。
2. `QueryEngine`：`submitMessage(text, images)` 接收临时图片数组，只在发给 LLM 时把最后一条用户消息转换成 OpenAI vision content parts，不把图片持久化到 session。
3. `feishu-bot`：接收 `image` 和 `post` 消息，下载图片为 data URL；根据 `agent.queryEngine.supportsVision()` 决定是否传图。

## Provider 能力

- DashScope：模型名包含 `vl` 或 `omni` 时视为视觉模型，例如 `qwen-vl-plus`、`qwen-vl-max`。
- DeepSeek：默认不支持视觉，因为官方 Chat API 当前未公开图片输入。

后续如果接自定义视觉 OpenAI-compatible 模型，可以在 provider 解析层增加环境变量或模型名规则。

## 非视觉降级

收到图片但模型不支持视觉时：

- 有文字：回复开头提示“当前模型不支持图片识别，已忽略图片”，然后继续把文字交给 Agent。
- 无文字：直接回复提示，不调用 LLM。

## 飞书消息处理

- `image`：解析 `image_key`，下载后用默认提示“请识别并描述用户发送的图片。”
- `post`：提取文本元素、链接、at；提取 `img.image_key` 并下载。
- 下载失败：记录日志。有文字则继续处理文字；无可用内容则提示图片下载失败。

## 测试

- `query-engine.test.ts`：验证 vision 模型收到 image_url content part；纯文本模型可判断不支持。
- `llm-provider.test.ts`：验证 DeepSeek 不支持视觉，DashScope qwen-vl 支持视觉。
- 全量测试、typecheck、build、ReplayEval。
