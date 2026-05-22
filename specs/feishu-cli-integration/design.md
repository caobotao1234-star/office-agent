# 飞书 CLI 集成设计

## 架构概览

集成采用三层结构：

1. `@larksuite/cli` 作为官方执行层，负责认证、权限、命令实现、输出格式、dry-run 与安全处理。
2. `LarkCliRunner` 作为本项目的进程封装层，负责定位本地 CLI、超时、输出截断、AbortSignal 与非 shell 调用。
3. `LarkCli` Agent 工具和 `oa feishu` CLI 命令作为入口，分别服务于 LLM 工具调用和人类/脚本直接调用。

## 模块边界

- `src/services/lark-cli-runner.ts`
  - 只负责安全执行 `lark-cli`。
  - 不理解业务语义，不拼接 shell 字符串。
  - 默认调用项目依赖里的 `@larksuite/cli/scripts/run.js`。

- `src/tools/LarkCliTool/index.ts`
  - 向 Agent 暴露结构化工具 schema。
  - 接收 argv 数组，而不是 shell 命令字符串。
  - 对疑似写操作执行确认门禁。

- `src/cli/commands/feishu.ts`
  - 提供 `oa feishu ...` 和 `oa lark ...` 透传。
  - 对常用别名 `setup/status/doctor` 做轻量包装。

- `src/main.ts`
  - 注册 `LarkCli`。
  - 系统提示词中要求飞书操作优先使用 `LarkCli`。
  - 默认禁用 legacy `FeishuConnector` 与 `CalendarTool` 的 LLM 暴露。

## 数据结构

`LarkCli` 工具输入：

- `args: string[]`：传给 `lark-cli` 的参数，不包含二进制名。
- `stdin?: string`：可选标准输入。
- `timeoutMs?: number`：调用超时。
- `confirmed?: boolean`：是否确认执行副作用命令。
- `reason?: string`：确认原因，便于日志和调试。

工具输出：

- `command: string`：展示为 `lark-cli ...`。
- `exitCode: number | null`
- `stdout: string`
- `stderr: string`
- `timedOut: boolean`
- `truncated: boolean`

## 外部依赖

- `@larksuite/cli@^1.0.38`

官方 CLI 使用 OAuth Device Flow 和 OS-native keychain 管理凭证，本项目不复制这些凭据。

## 错误处理

- CLI 不存在：返回可操作错误，提示运行 `npm install`。
- 超时：终止子进程并返回 `timedOut: true`。
- AbortSignal 中断：终止子进程，返回中断错误。
- 非 0 退出码：工具返回 `success: false`，保留 stdout/stderr 供 Agent 修复。
- 写操作未确认：不调用 CLI，直接返回失败并提示使用 `--dry-run` 或 `confirmed: true`。

## 回退行为

- 默认不向 LLM 暴露旧 SDK 工具，避免 Agent 走 stub 或半覆盖路径。
- 如需临时回退，可设置 `OFFICE_AGENT_LEGACY_FEISHU_TOOLS=1` 后重启 Agent。

## 测试策略

- 单元测试：runner、工具确认门禁、参数构造。
- 集成测试：`createOfficeAgent` 工具注册列表。
- CLI smoke：`node dist/cli/index.js feishu --help`。
- 不用真实 App ID/App Secret，不调用真实飞书 API。

## 安全与性能

- 使用 `spawn` 且 `shell: false`，避免 shell 注入。
- 参数必须是数组，Agent 不传整段命令字符串。
- 输出默认限制大小，避免大文档或表格撑爆上下文。
- 默认超时 60 秒，单次工具调用最多 5 分钟。
- 写操作门禁不等同于完整人类确认，但能阻止未标记的副作用命令直接执行。

## 部署说明

- 用户运行 `npm install` 后会安装本地 `lark-cli`。
- 用户运行 `npm run build` 后全局 `oa` 可通过 `dist/cli/index.js` 使用。
- 用户需按最终文档完成 `lark-cli config init` 与 `lark-cli auth login --recommend --domain all`。
