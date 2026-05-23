# Agenda 提醒系统任务

## T1 Spec 与架构确认

- 状态：DONE
- 文件：`specs/agenda-reminder-system/requirements.md`、`specs/agenda-reminder-system/design.md`、`specs/agenda-reminder-system/tasks.md`
- 实现说明：定义 AgendaTool、AgendaStore、AgendaScheduler、ReminderComposer 四层架构。
- 验证命令：人工检查 spec 文件。
- 完成标准：需求、设计和任务列表齐全。

## T2 Agenda 数据层

- 状态：DONE
- 文件：`src/types/index.ts`、`src/services/agenda-store.ts`、`src/services/agenda-store.test.ts`
- 实现说明：新增 AgendaItem 类型，支持持久化、CRUD、到期查询、最近到期时间和变更事件。
- 验证命令：`npm test -- src/services/agenda-store.test.ts`
- 完成标准：测试覆盖创建、更新、取消、送达、重启恢复。

## T3 Reminder Composer

- 状态：DONE
- 文件：`src/services/reminder-composer.ts`、`src/services/reminder-composer.test.ts`
- 实现说明：到点后调用 LLM 生成 JSON 文案，失败时 fallback。
- 验证命令：`npm test -- src/services/reminder-composer.test.ts`
- 完成标准：合法 JSON 输出可用，非法 JSON / LLM 失败走 fallback。

## T4 Agenda Scheduler

- 状态：DONE
- 文件：`src/services/agenda-scheduler.ts`、`src/services/agenda-scheduler.test.ts`
- 实现说明：使用最近到期 timer + 低频兜底扫描，到点调用 Composer 并推送。
- 验证命令：`npm test -- src/services/agenda-scheduler.test.ts`
- 完成标准：新建短期 Agenda 到点触发；无通道不送达；通道恢复补发。

## T5 AgendaTool 与 Agent 接入

- 状态：DONE
- 文件：`src/tools/AgendaTool/index.ts`、`src/tools/AgendaTool/index.test.ts`、`src/main.ts`、`src/server/feishu-bot.ts`
- 实现说明：注册 AgendaTool，提示词要求 LLM 自主调用；CLI/飞书启动 AgendaScheduler。
- 验证命令：`npm test -- src/tools/AgendaTool/index.test.ts src/main.test.ts && npm run typecheck`
- 完成标准：工具注册、CRUD、启动停止均通过测试。

## T6 全量验证与提交

- 状态：DONE
- 文件：全部变更
- 实现说明：运行 focused tests、typecheck、build、全量测试，提交代码。
- 验证命令：`npm run typecheck && npm run build && npm test`
- 完成标准：验证通过并完成 git commit。
