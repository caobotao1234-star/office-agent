# Agent 稳定性加固

## 目标

提升飞书 Agent 的运行稳定性：启动前提前发现配置/授权问题，飞书 CLI 网络抖动时合理重试，并在长任务中断后支持继续恢复。

## 用户故事

- 作为部署者，我希望 `npm run feishu` 启动前能检查 `feishu-users.json`、CLI profile 和授权状态，避免 bot 看似在线但操作失败。
- 作为用户，我希望飞书 CLI 遇到 DNS/网络瞬时故障时能自动重试，但不要因为重试造成重复创建文档、重复发消息。
- 作为用户，我希望长任务中断、工具轮次耗尽或网络失败后，可以说“继续刚才的任务”或使用 `/resume` 让 Agent 基于已完成工具结果继续。
- 作为部署者，我希望有 `oa smoke` 这样的快速自检，能在不真实写飞书资源、不消耗真实 LLM 的默认模式下覆盖模型 schema、CLI dry-run 和本地目录健康。
- 作为维护者，我希望最近出现过的飞书 CLI/LLM 失败能进入 replay eval，防止同类回归。
- 作为用户，我希望 Agent 调用飞书 CLI 时能拿到简明、稳定的常用命令指导，而不是每次靠模型猜参数。
- 作为用户，我希望写操作留下副作用账本，任务中断恢复时能明确知道哪些写操作已经尝试或成功，避免重复创建。
- 作为用户，我希望切换模型或 provider 后不会把旧模型不兼容的工具调用历史直接塞给新模型。
- 作为用户，我希望主动提醒发送失败时不要被错误标记为已送达，服务恢复后能继续补发。

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
- 新增 `oa smoke`：
  - 默认不调用真实 LLM。
  - 默认不创建真实飞书资源，仅做 `--help`/`--dry-run`。
  - 输出 fail/warn/ok 汇总，失败时退出非 0。
- replay eval 至少覆盖：多维表格创建修正、文档长内容 stdin、工具参数坏 JSON/修复路径。
- LarkCliTool 在要求先看 help/dry-run 时，返回常用命令 recipe 和已缓存 help 摘要。
- 写操作副作用账本记录工具名、命令 key、输入签名、状态、时间和结果摘要。
- session 恢复按 channel + 模型名隔离；切换模型后默认不恢复旧模型历史。
- AgendaScheduler 只有在通知至少一个 channel 成功后才标记 delivered；失败保持 pending，并写日志。
- 所有新增逻辑有单元测试，不依赖真实飞书网络。

## 非目标

- 不实现完整工作流编排系统。
- 不把所有工具调用做事务化。
- 不自动判断每个飞书 OpenAPI 是否幂等。
- 不持久化完整工具输出，只基于已有 ledger 摘要恢复。
- `oa smoke` 默认不替代真实端到端验收；真实 LLM/真实飞书写入仍需要显式开关。

## 环境假设

- 官方 `lark-cli` 仍由本机 `~/.lark-cli/config.json` 管理 profile。
- `feishu-users.json` 仍是 Agent 的 openId/profile 映射来源。
- 生产启动默认启用 preflight；如必须临时跳过 auth 探测，可用环境变量降级。
