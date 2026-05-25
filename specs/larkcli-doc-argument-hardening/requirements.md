# LarkCli 文档参数稳定性

## 目标

修复飞书文档/表格类任务中，LLM 把长 Markdown 或带引号内容直接塞进 `LarkCli.args` 导致 function arguments 非法 JSON 的问题。

## 接受标准

- QueryEngine 遇到常见的 `LarkCli` 文档内容坏 JSON 时，应能安全修复并继续执行工具。
- 长/多行文档正文不再直接作为命令行参数传给 `lark-cli`，而是改为 `--content -` 或 `--markdown -` 并通过 stdin 传入。
- 修复只应用于可识别的 `docs +create` / `docs +update` 文档内容场景，避免误修其他工具参数。
- 如果无法安全修复，仍保留现有 malformed tool arguments 错误反馈。
- 新增单元测试和 CLI dry-run 验证，不依赖真实写入飞书。

## 非目标

- 不实现通用 JSON5 parser。
- 不自动猜测所有 CLI 参数。
- 不绕过 LarkCliTool 的 help/dry-run 写操作指导。
