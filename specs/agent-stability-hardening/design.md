# 设计

## 启动前 Preflight

新增 `src/services/feishu-startup-preflight.ts`：

- 输入：`FeishuMultiUserConfig`、`env/cwd/runner`。
- 输出：`PreflightReport { issues, ok }`。
- 检查项：
  - 收集每个 app 的 `defaultCliProfile` 和 user `cliProfile`。
  - `lark-cli profile list` 必须成功。
  - 配置中引用的 profile 必须存在。
  - profile appId 与 app.appId 不一致则 fail。
  - `lark-cli --profile <profile> auth status` 失败或 token 明确过期则 fail。
  - raw `feishu-users.json` 中明文 `appSecret` 输出 warn。

`src/server/feishu-bot.ts` 在启动 WebSocket 前运行 preflight。fail 时退出，warn 时继续但写日志。

## LarkCli 重试

在 `LarkCliTool` 内封装 `runWithRetry`：

- `maxAttempts` 默认 3，可由 `OFFICE_AGENT_LARK_CLI_RETRY_ATTEMPTS` 覆盖。
- read/help/dry-run：对 DNS、连接、EOF、502/503/504、超时等瞬时错误重试。
- actual write：只对 `lookup/no such host/EAI_AGAIN/ENOTFOUND/connection refused/network unreachable` 等请求未到达服务端的错误重试。
- 对不安全写错误不重试，并在 ToolResult.output 中写 `retrySkippedReason`。

这样兼顾稳定性和副作用安全。

## 任务中断恢复

扩展 `OperationLedger`：

- `getLastRecoverable()`：返回最近的 `running/partial/failed` 记录。
- `formatResumePrompt(note?)`：生成给 LLM 的恢复 prompt。

扩展斜杠命令：

- 新增 `/resume`。
- 用户输入匹配“继续刚才的任务/继续上一步/继续完成上一步”时，直接走恢复入口。

恢复 prompt 明确要求：

- 不要重复已成功的非幂等写操作。
- 先检查状态或读取目标，再继续剩余步骤。
- 如果无法判断是否完成，要向用户说明需要确认。

## 测试策略

- preflight 使用 fake runner 覆盖成功、缺 profile、auth 失败、appId mismatch。
- LarkCliTool replay 覆盖读重试、写低风险重试、不安全写不重试。
- OperationLedger 覆盖 recoverable 选择和 resume prompt。
- slash command 覆盖 `/resume` 映射和自然语言入口的最小行为。

## 第二阶段：运行可靠性基线

### `oa smoke`

新增 CLI 命令 `oa smoke`，定位为“本地快速验收”：

- 复用 `doctor` 的本地配置检查结果。
- 对当前工具 schema 做 provider-compatible 检查，确保发给 OpenAI-compatible provider 的 schema 不含 `oneOf/const/default/{}` 等高风险结构。
- 如果配置了飞书 CLI profile，抽样执行：
  - `docs +create --api-version v2 --doc-format markdown --content - --as user --dry-run`
  - `base +base-create --name "Office Agent Smoke" --as user --dry-run`
- 默认不调用真实 LLM。需要真实模型连通性时用 `--real-llm` 或环境变量显式打开。

### Replay Eval 扩展

`src/evals/replay.ts` 增加近期真实失败的稳定用例：

- 文档正文走 `--content -`/`stdin`，避免多行内容破坏工具 JSON。
- Base 创建使用 `base +base-create --name`，后续表/记录使用 `--base-token` 和 `--json`。
- 工具参数坏 JSON 时，harness 不把 malformed tool_call 原样回灌给模型。

### Lark CLI Recipe

新增轻量静态 recipe 服务，不替代官方 `--help`：

- 针对 docs/base/calendar/im/tasks/wiki 等高频命令提供“正确参数形状”和“常见错误”。
- `LarkCliTool` 在阻止未指导写操作、已知命令校验失败时附带 recipe，帮助模型下一轮修正。
- `LarkCliKnowledgeBase` 继续缓存真实 `--help`，recipe 只做高频路径兜底。

### 写操作副作用账本

新增 `OperationIdempotencyLedger`：

- QueryEngine 在执行非 read-only 工具前记录 `started`，执行后更新 `succeeded/failed`。
- 记录输入签名、工具名、命令 key、输出摘要和错误摘要。
- 第一阶段只做审计和恢复提示，不做自动去重拦截，避免误杀合法重复写。

### Session/模型切换隔离

QueryEngine 对 session channel 增加模型 namespace：

- 保存和恢复时使用 `channel__model_<safeModel>`。
- CLI/飞书同一个用户切换 provider/model 后会启动新历史，不直接恢复旧模型工具调用协议。
- 手动历史文件仍保留，便于调试。

### 主动提醒投递可靠性

NotificationService 返回投递结果：

- `attempted/succeeded/failed`。
- 单个 channel 失败不影响其他 channel。

AgendaScheduler 只有 `succeeded > 0` 才标记日程 delivered。无 channel 或全失败时保持 pending，下一次 tick 或 channel 恢复后继续补发。
