# 设计

## QueryEngine 防御

`prepareToolCall` 在 `JSON.parse(function.arguments)` 失败后，增加一个窄口径 repair：

- 只处理 `toolName === "LarkCli"`。
- 只从 `"args": [...]` 中提取字符串数组。
- 只允许 `docs +create` / `docs +update` 且参数包含 `--content` 的场景继续。
- 对 `--content` / `--markdown` 后的正文使用宽松字符串解析，允许正文中出现未转义引号。

无法满足这些条件时，继续返回原有 parse error，让模型重新生成严格 JSON。

## LarkCliTool stdin 归一化

`LarkCliTool.call` 在校验和执行前对输入做规范化：

- `docs +create` / `docs +update` 中的 `--content` 或 `--markdown` 如果包含换行或超过阈值，自动改成 `-`。
- 原始正文放入 `stdin`，交给官方 `lark-cli` 读取。
- `validateKnownCommand` 支持 `--content -`，并校验 stdin 中仍包含 `<title>`，避免再次创建 untitled 空文档。

## 测试

- QueryEngine 测坏 JSON repair 后会真实执行 dummy LarkCli 工具。
- LarkCliTool replay 测多行正文转 stdin。
- 实际 dry-run 验证 `lark-cli docs +create --content - --dry-run` 支持 stdin。
