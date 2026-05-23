# Agent 瘦身与架构审阅需求

## 目标

把 Office Agent 的运行时能力面收敛到已经真实可用、可测试、不会误导 LLM 的模块上。删除或下线 stub、旧飞书 SDK 路径、未启用的建议/后台任务框架，并让 README、内置技能、测试和实际工具注册保持一致。

## 用户故事

- 作为用户，我希望 Agent 暴露给 LLM 的工具都是真实可执行的，避免它声称发送邮件、解析文档或同步飞书成功但实际只是占位。
- 作为用户，我希望飞书相关能力统一走官方 `LarkCli`，减少同时维护 CLI、SDK 和 stub 工具造成的混乱。
- 作为用户，我希望一次性提醒、截止日期、承诺跟进统一走 `AgendaTool`，旧提醒工具不再出现在 LLM 工具表面。
- 作为开发者，我希望项目文档和 spec 反映当前实现，而不是保留早期“大而全”的蓝图。
- 作为开发者，我希望删除未接入主流程的服务，降低类型、测试和提示词维护成本。

## 接受标准

- `createOfficeAgent()` 不再注册 `EmailTool`、`DocumentParser`、`FeishuConnector`、`CalendarTool`、`BackgroundTaskTool`、`ReminderTool`。
- `/remind` 路由到 `AgendaTool` 语义，不再指向旧 `ReminderTool`。
- 内置技能不再引用已删除或未注册工具。
- README 的工具列表、主动提醒说明、源码结构和开发命令与当前代码一致。
- 旧 `.kiro/specs/office-agent` 早期蓝图不再作为项目当前蓝图保留。
- 删除旧 `ReminderEngine/ReminderLoop`，新提醒入口统一 Agenda。
- `npm run typecheck`、`npm test`、`npm run build` 和 CLI help smoke 通过。

## 非目标

- 不重写 QueryEngine 的工具调用主循环。
- 不在本次实现完整权限确认 UI。
- 不迁移历史 `reminders.json` 到 `agenda.json`，旧文件直接不再参与运行。
- 不改变飞书开放平台权限配置和 `LarkCli` 授权流程。

## 环境与兼容性

- Node.js >= 18。
- 保持现有 npm 脚本和 TypeScript ESM 架构。
- 测试必须不依赖真实飞书、DashScope 或外部付费 API。

## 安全约束

- 不新增硬编码密钥、token 或私有路径。
- 任何真实飞书写操作继续由 `LarkCliTool` 的确认和命令校验承担。
- 删除 stub 成功路径，避免用户误以为外部副作用已经发生。

## 可测试性

- 单元测试验证工具注册面、斜杠命令路由和核心启动停止。
- 删除旧工具后全量测试可离线运行。
- CLI smoke 验证构建产物仍可显示帮助。
