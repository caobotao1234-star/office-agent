# 工具循环控制与飞书 Base 命令修复设计

## 架构概览

本次改动放在两层：

1. `QueryEngine`：控制 Agent 工具调用生命周期，负责预算、重复调用保护和达到上限后的用户可见错误。
2. `LarkCliTool`：继续作为通用飞书 CLI 桥，但对高频且已知的 Base 命令做本地参数校验。

## QueryEngine 策略

- 默认 `maxToolRounds` 从 10 提高到 30，给多步骤办公任务留出空间。
- `OFFICE_AGENT_MAX_TOOL_ROUNDS` 可覆盖默认值，范围限制在合理区间，避免配置成无限循环。
- 新增重复工具调用保护：同一工具、同一 JSON 参数重复超过阈值后，不再真正执行工具，而是把错误结果回传给 LLM，让它换策略或总结失败。
- 如果工具轮次耗尽仍没有最终回复，输出明确错误事件，说明任务可能未完成和下一步可以继续。

## LarkCliTool Base 校验

保留泛化 CLI，不创建专用 BaseTool。仅对已知高频误用做本地校验：

- `base +create`：不存在，应使用 `base +base-create`。
- `base +base-create`：使用 `--name`，不使用 `--title` 或 `--format`。
- `base +table-create`：使用 `--base-token`，不使用 `--base` 或 `--format`。
- `base +field-create`：需要 `--base-token`、`--table-id`、`--json`。
- `base +record-batch-create`：需要 `--base-token`、`--table-id`、`--json`。

这些规则来自当前本地 `lark-cli ... --help` 输出，属于工程运行时的 CLI 兼容层。

## 错误处理

- 工具重复调用保护返回 `ToolResult(success=false)`，并记录 warning 日志。
- 工具轮次耗尽返回 `StreamEvent(type="error")`，上层飞书消息处理会直接把错误发给用户。
- CLI 已知参数错误不启动子进程，直接返回错误和 helpHint，减少 token 和 API 浪费。

## 测试策略

- `query-engine.test.ts`：覆盖上限错误和重复调用保护。
- `LarkCliTool/index.test.ts`：覆盖 Base 命令已知误用校验。
- 全量验证：`npm test`、`npm run typecheck`、`npm run build`、CLI help、ReplayEval。
