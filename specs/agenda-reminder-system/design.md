# Agenda 提醒系统设计

## 架构概览

Agenda 系统分四层：

1. `AgendaTool`：暴露给主 Agent 的工具。LLM 在对话中自主判断是否调用它创建提醒、deadline、承诺跟进或普通跟进。
2. `AgendaStore`：统一持久化 Agenda 项，负责 CRUD、到期查询、最近到期时间、变更事件。
3. `AgendaScheduler`：后台调度器。使用最近到期 timer 精确唤醒，并用低频扫描兜底；到点后调用 Composer 并推送通知。
4. `ReminderComposer`：到点后调用 LLM 生成提醒文案；要求 JSON schema 输出，失败时 fallback 到 Agenda 项保存的标题/描述。

## 模块边界

- `src/services/agenda-store.ts`
  - 管理 `AgendaItem` 持久化。
  - 不调用 LLM，不发送消息。
  - 提供 `onChange` 让调度器重新计算最近到期项。

- `src/services/reminder-composer.ts`
  - 输入 AgendaItem 和当前时间。
  - 调用 `LLMClient.query`，要求返回 `{ "message": "..." }`。
  - 使用 Zod 校验，失败时返回 fallback。

- `src/services/agenda-scheduler.ts`
  - 订阅 AgendaStore 和 NotificationService 的变更。
  - 最近到期项使用一次性 timer；同时保留低频兜底扫描。
  - 到点后调用 ReminderComposer，再通过 NotificationService 推送。

- `src/tools/AgendaTool/index.ts`
  - LLM 自主调用入口。
  - 操作包括 `create`、`list`、`update`、`cancel`。

- `src/main.ts`
  - 创建 AgendaStore / ReminderComposer / AgendaScheduler。
  - 注册 AgendaTool。
  - 启停 AgendaScheduler。

## 数据模型

`AgendaItem`：

- `id`
- `type`: `reminder | deadline | commitment | follow_up`
- `title`
- `description?`
- `triggerAt`: 触发提醒时间
- `deadlineAt?`: 真实截止时间，可不同于提醒时间
- `timezone`
- `priority`: `low | medium | high | urgent`
- `status`: `pending | delivered | cancelled`
- `source`: `llm | user | tool | migration`
- `sourceMessage?`
- `context?`
- `composePrompt?`
- `createdAt`
- `updatedAt`
- `deliveredAt?`
- `cancelledAt?`

## 错误处理

- Store 读文件失败：记录日志，使用空列表继续启动。
- Composer 超时、JSON 无效、LLM 报错：记录日志，使用 fallback 文案。
- NotificationService 无通道：Scheduler 不标记 delivered，等通道恢复后补发。
- 单条 Agenda 发送失败：当前 NotificationService 会吞掉单通道错误，Scheduler 仍按通知调用完成标记 delivered；后续可增强通知结果聚合。

## 调度策略

- 不做每分钟 LLM 轮询。
- 新 Agenda 创建或更新后，Scheduler 重新计算最近到期项。
- 最近到期项使用一次性 timer 精确触发。
- 兜底扫描默认 60 秒，扫描本地数据，不调用 LLM；只有发现到期 Agenda 才调用 Composer。

## 测试策略

- Store：用临时目录验证持久化和日期恢复。
- Tool：用真实 Store 验证输入 schema 和 CRUD。
- Composer：用 fake LLM 验证 JSON 成功与 fallback。
- Scheduler：fake timers 验证到点触发和通道恢复。
- Main：工具注册列表包含 AgendaTool，start/stop 不报错。

## 安全与性能

- LLM 仅在主 Agent 需要调用 `AgendaTool` 时、以及 Agenda 到点 compose 时使用。
- 兜底扫描是本地 O(n) 查询，不触发 LLM。
- Agenda 文件在用户本地数据目录，跟随现有本地存储策略。

## 部署说明

- 现有用户不需要迁移即可使用新 Agenda。
- 旧 `ReminderTool`、`ReminderEngine`、`ReminderLoop` 已移除，新提醒统一用 `AgendaTool` 管理。
