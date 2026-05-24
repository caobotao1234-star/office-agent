# 飞书多用户 CLI 隔离

## 用户故事

- 作为 Office Agent 部署者，我可以在 `.env` 中指定一个多用户配置文件，维护多个飞书应用和多个用户到 `lark-cli --profile` 的绑定。
- 作为飞书用户，我和 Agent 对话时，Agent 会根据我的飞书 `open_id` 使用我自己的 CLI profile 执行云文档、消息、日历、Base、任务等操作。
- 作为飞书用户，如果我没有绑定 CLI profile 或没有完成 CLI 授权，Agent 必须明确回复配置或权限问题，不能静默使用其他用户的 CLI。
- 作为管理员，我可以按 100+ 用户规模维护配置；用户数量由配置决定，不需要改代码。

## 接受标准

- `.env` 支持 `FEISHU_MULTI_USER_CONFIG=./feishu-users.json`，JSON 文件中可以配置多个 app、多个用户绑定。
- 兼容旧的 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 单应用配置；可通过 `FEISHU_CLI_PROFILE` 或 `LARK_CLI_PROFILE` 绑定默认 CLI profile。
- 每个飞书消息处理链路都能得到稳定的 `userKey = appKey:openId`，并以它隔离数据目录、会话、队列、主动提醒收件人。
- LarkCli 工具执行时会自动为当前用户注入 `--profile <cliProfile>`；如果调用方已显式传入 `--profile`，不重复注入。
- 飞书上下文中缺少 CLI profile 时，LarkCli 工具快速失败，错误信息指导用户配置绑定和授权。
- 多应用启动时，每个 app 使用自己的 App ID/Secret 建立长连接并发送消息。
- README、`.env.example` 和 `oa doctor` 说明新的配置方式。
- 单元测试覆盖配置解析、profile 注入、未绑定失败和收件人 appKey 存储。

## 非目标

- 不实现 Web 管理后台。
- 不自动创建或刷新用户 OAuth token；用户仍需按 profile 完成官方 CLI 登录和权限授权。
- 不绕过飞书开放平台权限；CLI 能力仍受当前 app、OAuth scopes 和用户可见数据限制。
- 不在代码或示例中保存真实 App Secret、token 或私有 open_id。

## 环境与兼容性

- Node/TypeScript 项目继续使用现有 ESM、Vitest 和 `@larksuite/cli`。
- 配置文件路径支持相对当前工作目录或绝对路径。
- 用户 key 用于本地目录时必须安全转义，避免特殊字符影响路径。
