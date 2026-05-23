# Agent 瘦身与架构审阅设计

## 架构现状

当前项目已经形成三条能力主线：

1. 对话与工具调用：`QueryEngine` + `ToolRegistry` + 原生 Function Calling。
2. 本地状态：任务、记忆、项目、会话、配置、使用量。
3. 主动能力：`AgendaTool/AgendaScheduler/ReminderComposer`、`CronScheduler`、飞书 Bot 通知通道。

早期蓝图中设计了大量办公工具，但部分实现仍是占位或与新实现重复：

- `EmailTool`：未接 SMTP/邮件 API，却返回发送成功。
- `DocumentParser`：飞书/Excel/Word/网页均返回占位内容。
- `FeishuConnector` 和 `CalendarTool`：旧 SDK 路径，与官方 `LarkCli` 重叠，且部分动作仍是 stub。
- `BackgroundTaskTool`：只有 list/cancel，生产代码没有 spawn 入口。
- `ReminderTool`、`ReminderEngine`、`ReminderLoop`：旧提醒入口和旧后台循环，与 `AgendaTool/AgendaScheduler` 重叠。
- `PromptSuggestionEngine`：实例化但主流程已注释停用。

## 目标形态

运行时只注册当前主路径工具：

- `TaskManager`
- `MemoryTool`
- `SubAgentTool`
- `AgendaTool`
- `CronTool`
- `ConfigTool`
- `LarkCli`
- `SkillCreator`
- `WebSearch`（qwen 模型默认 disabled）

保留服务：

- `AgendaScheduler` 作为唯一的一次性提醒后台调度器。
- `CronScheduler` 只负责周期自动化，不再提供 one-time 路径。
- `AwaySummaryEngine` 保留，因为它仍在 `handleMessage()` 中运行。
- `NotificationService` 继续作为 CLI/飞书主动推送统一通道。

## 模块边界

- 飞书读写：统一通过 `LarkCliTool` 调用官方 CLI。内置技能和系统提示词不再提 `FeishuConnector`/`CalendarTool`。
- 一次性提醒/截止日期/承诺：统一通过 `AgendaTool` 创建，后台由 `AgendaScheduler` 到点触发 `ReminderComposer`。
- 周期任务：继续使用 `CronTool/CronScheduler`，仅支持 recurring。
- 历史提醒：不再读取旧 `reminders.json`，不做兼容迁移。

## 数据结构

删除未使用类型：

- `InformationEntry` 与文档解析相关类型。
- `BackgroundTaskState` 与后台任务相关类型。
- `Suggestion` 与主动建议相关类型。
- `UserConfig.enabledTools`，因为当前没有任何代码用它控制工具注册。

保留类型：

- `AgendaItem` 系列类型。
- 任务、记忆、Cron、消息、工具上下文等核心类型。

## 错误处理

- 删除 stub 工具后，LLM 无法再调用会虚假成功的路径。
- 旧飞书能力改为文档/技能层统一指向 `LarkCli`，失败由 `LarkCliTool` 返回 stdout/stderr/error 供模型修正。
- `AgendaScheduler` 到期失败继续日志化，不阻断主对话。

## 测试策略

- 更新 `main.test.ts`：验证当前注册工具名单、旧工具不再注册、启动停止仍正常。
- 更新 `slash-command.test.ts`：验证 `/remind` 指向 `AgendaTool`。
- 删除仅覆盖下线工具的测试。
- 全量运行 `npm test`，并补跑 `typecheck/build/CLI help`。

## 性能考虑

- 删除停用的 `PromptSuggestionEngine` 后，不再保留未使用的 LLM 建议路径。
- `AgendaScheduler` 到点才调用 LLM composer；本地扫描不调用 LLM。
- 删除旧 `ReminderLoop` 后，后台提醒只在 Agenda 到期时调用 LLM composer。

## 安全考虑

- 移除虚假 side-effect 工具是本次最重要的安全改进。
- `requiresUserConfirmation()` 目前仍是工具接口字段，但 `QueryEngine` 没有统一确认 UI；本次不扩大改动范围，后续应单独设计成真正的执行门禁。

## 迁移说明

- 历史 `reminders.json` 不迁移，也不再读取。
- 新提醒全部写入 `agenda.json`。
- 已存在的用户 `config.json` 中如果还有 `enabledTools` 字段，会被读取但不再由默认配置生成，也不影响运行。
