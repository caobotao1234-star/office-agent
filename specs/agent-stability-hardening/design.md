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
