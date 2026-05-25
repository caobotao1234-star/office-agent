# Agent 稳定性加固

## 目标

提升飞书 Agent 的运行稳定性：启动前提前发现配置/授权问题，飞书 CLI 网络抖动时合理重试，并在长任务中断后支持继续恢复。

## 用户故事

- 作为部署者，我希望 `npm run feishu` 启动前能检查 `feishu-users.json`、CLI profile 和授权状态，避免 bot 看似在线但操作失败。
- 作为用户，我希望飞书 CLI 遇到 DNS/网络瞬时故障时能自动重试，但不要因为重试造成重复创建文档、重复发消息。
- 作为用户，我希望长任务中断、工具轮次耗尽或网络失败后，可以说“继续刚才的任务”或使用 `/resume` 让 Agent 基于已完成工具结果继续。

## 接受标准

- 新增启动前 preflight，检查：
  - 配置文件是否可加载。
  - 每个配置用户的 `cliProfile` 是否存在。
  - profile 的 App ID 是否与飞书 app 匹配。
  - profile `auth status` 是否可用。
  - 明文 `appSecret` 给出警告，不打印 secret。
- `npm run feishu` 在 preflight fail 时退出，并输出明确修复建议。
- LarkCliTool 对瞬时故障做有限重试：
  - 读操作和 `--help`/`--dry-run` 可重试。
  - 真实写操作只对“请求尚未到达服务端”的低风险网络错误重试。
  - 不安全写失败时明确说明未自动重试，避免重复副作用。
- 支持 `/resume` 和自然语言“继续刚才的任务/继续上一步”。
- 恢复 prompt 包含上一轮输入、状态、工具结果摘要，并要求不要重复已成功的非幂等写操作。
- 所有新增逻辑有单元测试，不依赖真实飞书网络。

## 非目标

- 不实现完整工作流编排系统。
- 不把所有工具调用做事务化。
- 不自动判断每个飞书 OpenAPI 是否幂等。
- 不持久化完整工具输出，只基于已有 ledger 摘要恢复。

## 环境假设

- 官方 `lark-cli` 仍由本机 `~/.lark-cli/config.json` 管理 profile。
- `feishu-users.json` 仍是 Agent 的 openId/profile 映射来源。
- 生产启动默认启用 preflight；如必须临时跳过 auth 探测，可用环境变量降级。
