# 飞书 CLI 集成需求

## 目标

将 Office Agent 的飞书执行层切换到官方 `lark-cli`，让 Agent 通过稳定、可脚本化、可诊断的 CLI 调用飞书开放平台能力，而不是继续在项目内维护一组有限的飞书 SDK 工具实现。

## 用户故事

- 作为用户，我可以在本地配置一次飞书开放平台应用和用户授权，然后让 `oa chat` 通过官方 CLI 操作飞书。
- 作为用户，我可以直接运行 `oa feishu ...` 执行 `lark-cli` 命令，完成诊断、授权检查、文档读取、消息发送等操作。
- 作为 Agent，我可以调用一个通用的 `LarkCli` 工具，先用 `schema`/`--help` 探索命令，再执行具体的飞书操作。
- 作为维护者，我不需要为每个飞书 API 在代码中手写 SDK 调用，新增能力优先由官方 CLI 覆盖。
- 作为用户，我希望飞书 Bot 不只是被动回复，还能在日程、任务截止、显式提醒到期时主动给我发消息。
- 作为维护者，我希望失败时能在工程目录里直接看到完整日志，定位 lark-cli、提醒循环、飞书 Bot 和通知链路问题。

## 接受标准

- 项目依赖中固定包含 `@larksuite/cli`，`npm install` 后可使用本地 `lark-cli`。
- CLI 支持 `oa feishu ...` 和 `oa lark ...` 透传到官方 `lark-cli`。
- Agent 注册 `LarkCli` 工具，并在系统提示词中明确飞书操作默认使用该工具。
- 旧的 `FeishuConnector` 和 `CalendarTool` 默认不再暴露给 LLM，避免与官方 CLI 路径冲突。
- 写入、删除、发送等副作用操作必须具备显式确认字段或使用 `--dry-run`。
- `docs +create --api-version v2` 必须使用当前 CLI 认可的参数，不能创建空文档或 untitled 文档后谎称成功。
- 飞书 Bot 需要记录用户最近的 `chat_id`，服务重启后恢复主动推送通道。
- 日志默认写入工程目录 `logs/agent-YYYY-MM-DD.log`，并对密钥、token、secret 做脱敏。
- 无真实飞书凭证时，基础测试、类型检查、构建和 CLI 帮助命令仍可运行。

## 非目标

- 不重写官方 `lark-cli` 的功能。
- 不在测试中调用真实飞书 API。
- 不自动创建或修改用户的飞书开放平台应用。
- 不把 App Secret、user access token、refresh token 写入代码、README 或测试。
- 不尝试绕过飞书权限模型；主动推送只能推给曾经与机器人建立过会话且权限允许的 chat。

## 环境与兼容性

- Node.js 版本保持项目现状：`>=18`。
- `@larksuite/cli` 要求 Node.js `>=16`，与项目兼容。
- 默认使用飞书中国区；国际版 Lark 由用户在 `lark-cli config init` 中选择或后续用官方 CLI 配置。

## 安全约束

- Agent 不直接接收或存储飞书密钥；密钥交给 `lark-cli`/系统 keychain 管理。
- 对用户私有日历、消息、文档等能力，默认推荐 user 身份授权。
- 对机器人收发消息和事件通道，仍保留现有飞书机器人服务的 App ID/App Secret 配置方式。
- 高风险操作优先使用 `--dry-run`；真正执行时要求 `confirmed: true`。
- `.env` 可以配置 `LARK_CLI_NO_PROXY=1` 规避 WSL 代理 EOF/502，但它不是密钥，也不影响 App 权限。

## 可测试性

- 新增 runner 单元测试，验证本地 `lark-cli --help` 可调用。
- 新增工具单元测试，验证写操作未确认会被阻止。
- 新增收件人存储与提醒循环测试，验证主动推送恢复所需的本地状态可持久化。
- 保留现有 84 个测试，并扩展期望的工具注册列表。
- 构建后运行 `oa feishu --help` 做 CLI smoke test。
