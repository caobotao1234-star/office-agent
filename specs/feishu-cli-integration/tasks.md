# 飞书 CLI 集成任务

## T1 依赖与文档

- 状态：DONE
- 文件：`package.json`、`package-lock.json`、`.env.example`、`README.md`
- 实现说明：加入 `@larksuite/cli`，补充本地飞书 CLI 配置与运行说明。
- 验证命令：`./node_modules/.bin/lark-cli --help`
- 完成标准：本地 CLI 可显示帮助。

## T2 Runner 封装

- 状态：DONE
- 文件：`src/services/lark-cli-runner.ts`
- 实现说明：封装本地 `lark-cli` 调用、超时、AbortSignal、输出截断。
- 验证命令：`npm test -- src/services/lark-cli-runner.test.ts`
- 完成标准：runner 能调用 `lark-cli --help`，并能处理失败命令。

## T3 Agent 工具

- 状态：DONE
- 文件：`src/tools/LarkCliTool/index.ts`
- 实现说明：新增通用 `LarkCli` 工具，要求 argv 数组；写操作不做逐次权限确认，但在执行前必须先通过同一命令 `--help` 或 `--dry-run` 校验命令。
- 验证命令：`npm test -- src/tools/LarkCliTool/index.test.ts`
- 完成标准：读命令可执行，写命令未完成命令校验会被阻止。

## T4 CLI 透传

- 状态：DONE
- 文件：`src/cli/index.ts`、`src/cli/commands/feishu.ts`
- 实现说明：支持 `oa feishu ...` / `oa lark ...`，并提供 `setup/status/doctor` 入口。
- 验证命令：`npm run build && node dist/cli/index.js feishu --help`
- 完成标准：构建后的 CLI 能展示 `lark-cli` 帮助。

## T5 主 Agent 接入

- 状态：DONE
- 文件：`src/main.ts`、`src/main.test.ts`
- 实现说明：注册 `LarkCli`，系统提示词说明飞书默认走官方 CLI，默认禁用旧 SDK 飞书工具。
- 验证命令：`npm test -- src/main.test.ts`
- 完成标准：工具列表包含 `LarkCli`，测试通过。

## T6 全量验证与提交

- 状态：DONE
- 文件：全部变更
- 实现说明：运行 typecheck、build、unit tests、CLI smoke，确认 git diff 后提交。
- 验证命令：`npm run typecheck && npm run build && npm test`
- 完成标准：所有可离线验证通过并完成 git commit。

## T7 修复通用 CLI 参数误猜与失败误报

- 状态：DONE
- 文件：`src/tools/LarkCliTool/index.ts`、`src/main.ts`、`src/core/query-engine.ts`
- 实现说明：继续保持泛化 `LarkCli`，补充最新 CLI 使用规则，并把工具失败的 `error` 完整回传给模型，避免 `output=null` 时幻觉成功。
- 验证命令：`npm test -- src/tools/LarkCliTool/index.test.ts src/core/query-engine.test.ts && npm run typecheck && npm test`
- 完成标准：Agent 必须先通过 `--help`/`schema` 理解不熟悉的参数；写操作执行前必须满足同一命令 `--help` 或 `--dry-run` 门禁。工具失败时模型能看到 error、stdout、stderr。

## T8 飞书主动推送恢复

- 状态：DONE
- 文件：`src/server/feishu-bot.ts`、`src/services/feishu-recipient-store.ts`、`src/services/agenda-scheduler.test.ts`
- 实现说明：记录飞书用户最近 `chat_id`，服务启动时恢复通知通道，让提醒循环无需等待用户再次发消息也能主动推送。
- 验证命令：`npm test -- src/services/feishu-recipient-store.test.ts src/services/agenda-scheduler.test.ts`
- 完成标准：用户至少联系过一次机器人后，重启 `npm run feishu` 能恢复该用户的主动推送通道。

## T9 云文档创建防空文档校验

- 状态：DONE
- 文件：`src/tools/LarkCliTool/index.ts`、`src/tools/LarkCliTool/index.test.ts`、`src/main.ts`
- 实现说明：保留通用 CLI 工具，但对已知高风险 `docs +create --api-version v2` 参数做本地校验，阻止 `--title`、`--markdown`、缺少 `--doc-format`、Markdown 缺少 `<title>` 等会导致空文档/untitled 的命令。
- 验证命令：`npm test -- src/tools/LarkCliTool/index.test.ts`
- 完成标准：Agent 误猜旧参数时工具直接失败并返回可修复提示，不能再把失败当成功。

## T10 全链路日志

- 状态：DONE
- 文件：`src/core/logger.ts`、`src/cli/commands/chat.ts`、`src/cli/commands/ask.ts`、`src/cli/commands/feishu.ts`、`src/services/lark-cli-runner.ts`、`src/tools/LarkCliTool/index.ts`、`src/services/agenda-scheduler.ts`、`src/services/notification-service.ts`、`src/server/feishu-bot.ts`
- 实现说明：日志默认写入工程目录 `logs/agent-YYYY-MM-DD.log`，覆盖 CLI 对话、Ask、工具调用、lark-cli 子进程、提醒循环、通知通道、飞书 Bot 和收件人恢复。
- 验证命令：`npm run typecheck && npm test`
- 完成标准：正常运行和错误路径均能在日志中看到模块、时间、命令、失败原因，敏感字段会被脱敏。

## T11 修复短周期主动提醒不触发

- 状态：DONE
- 文件：`src/services/agenda-store.ts`、`src/services/agenda-scheduler.ts`、`src/services/notification-service.ts`、`src/services/agenda-scheduler.test.ts`
- 实现说明：Agenda 变更和通知通道变更会触发最近到期 timer 重排，避免 1 分钟提醒必须等待轮询。
- 验证命令：`npm test -- src/services/agenda-scheduler.test.ts src/services/agenda-store.test.ts src/services/notification-service.test.ts && npm run typecheck`
- 完成标准：新建短周期提醒后，会在到期时主动触发；通知通道稍后恢复时，已到期提醒会立刻补发。
