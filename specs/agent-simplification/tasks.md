# Agent 瘦身与架构审阅任务

## T1 审阅与范围确认

- 状态：DONE
- 文件：`src/main.ts`、`src/types/index.ts`、`README.md`、`src/skills/bundled/*`、`.kiro/specs/office-agent/*`
- 实现说明：识别 stub 工具、旧飞书 SDK 路径、未启用服务、旧提醒工具和过期蓝图。
- 验证命令：`rg -n "DocumentParser|EmailTool|FeishuConnector|CalendarTool|BackgroundTask|ReminderTool|PromptSuggestion|enabledTools" src specs README.md .kiro`
- 完成标准：删除/保留范围明确，兼容风险记录到 design。

## T2 Spec 落地

- 状态：DONE
- 文件：`specs/agent-simplification/requirements.md`、`specs/agent-simplification/design.md`、`specs/agent-simplification/tasks.md`
- 实现说明：记录需求、设计、任务和兼容边界。
- 验证命令：人工检查 spec 文件。
- 完成标准：spec 文件齐全。

## T3 运行时工具瘦身

- 状态：DONE
- 文件：`src/main.ts`、`src/core/slash-command.ts`、`src/types/index.ts`、`src/core/user-config.ts`、`src/cli/commands/config.ts`
- 实现说明：移除下线工具注册和未启用服务装配，`/remind` 改走 `AgendaTool`，删除不再使用的类型和配置字段。
- 验证命令：`npm test -- src/main.test.ts src/core/slash-command.test.ts`
- 完成标准：工具名单和路由测试通过。

## T4 删除下线实现与旧蓝图

- 状态：DONE
- 文件：`src/tools/*`、`src/services/*`、`.kiro/specs/office-agent/*`
- 实现说明：删除会虚假成功或不在主流程中的工具/服务源码，删除旧提醒兼容层和早期大而全蓝图。
- 验证命令：`rg -n "DocumentParser|EmailTool|FeishuConnector|CalendarTool|BackgroundTask|PromptSuggestion|ReminderEngine|ReminderLoop|reminderAdvance" src --glob '!*.test.ts'`
- 完成标准：运行时代码不再引用下线模块；README 只保留下线说明。

## T5 文档、技能与测试更新

- 状态：DONE
- 文件：`README.md`、`src/skills/bundled/*.md`、`src/main.test.ts`、`src/core/slash-command.test.ts`
- 实现说明：同步当前工具面，内置技能统一引用 `LarkCli` 和 `AgendaTool`。
- 验证命令：`npm test`
- 完成标准：全量测试通过，文档不再描述已删除能力。

## T6 全量验证与提交

- 状态：DONE
- 文件：全部变更
- 实现说明：运行 typecheck、build、unit tests、CLI smoke，检查 diff 后提交。
- 验证命令：`npm run typecheck && npm test && npm run build && node dist/cli/index.js --help`
- 完成标准：验证通过并完成 git commit。

## T7 删除旧提醒兼容层和重叠调度字段

- 状态：DONE
- 文件：`src/main.ts`、`src/server/feishu-bot.ts`、`src/services/reminder-engine.ts`、`src/services/reminder-loop.ts`、`src/services/cron-scheduler.ts`、`src/tools/CronTool/index.ts`、`src/tools/TaskManager/index.ts`、`src/types/index.ts`
- 实现说明：彻底删除 `ReminderEngine/ReminderLoop` 和对应测试；删除 `TaskItem.reminderAdvance`；`CronTool/CronScheduler` 只保留 recurring，one-time 统一交给 Agenda。
- 验证命令：`npm run typecheck && npm test && npm run build && node dist/cli/index.js --help`
- 完成标准：运行时代码不再引用旧提醒兼容层，验证通过。

## T8 高信任工具执行模式

- 状态：DONE
- 文件：`src/core/tool-system.ts`、`src/tools/*/index.ts`、`src/main.ts`、`README.md`、`specs/*`
- 实现说明：删除 `requiresUserConfirmation()` 和 `ToolRegistry.needsConfirmation()`，不再设计项目内 TrustPolicy；Agent 在已授权工具和飞书 CLI 登录态内自动执行。`LarkCliTool` 保留写操作命令校验，要求先查同一命令 `--help` 或完成 `--dry-run`。
- 验证命令：`npm run typecheck && npm test && npm run build && node dist/cli/index.js --help`
- 完成标准：代码和文档不再要求 `confirmed` 字段或逐次权限确认，验证通过。
