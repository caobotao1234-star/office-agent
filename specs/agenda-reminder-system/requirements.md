# Agenda 提醒系统需求

## 目标

让 Office Agent 能由 LLM 在对话中自主识别明确的提醒、截止日期、承诺和跟进事项，并通过统一 Agenda 存储和后台调度主动提醒用户。提醒到点后由专门的 Reminder Composer 调用 LLM 生成自然、上下文相关的提醒内容；LLM 失败时使用保存的兜底文本。

## 用户故事

- 作为用户，我可以自然说“明天下午 3 点提醒我跟进合同”，Agent 会自主调用工具创建 Agenda，而不是依赖固定命令。
- 作为用户，我在对话中提到“周五前要交方案”“我答应下午发资料”时，Agent 可以在判断足够明确时创建 deadline / commitment / follow-up。
- 作为用户，我希望到点提醒不是机械复述，而是结合原始上下文生成简洁、人话的提醒。
- 作为维护者，我希望提醒日程有统一存储、可测试、可恢复、可诊断，而不是分散在多个临时机制中。

## 接受标准

- 新增 `AgendaTool`，由主 LLM 自主调用；系统不得在每轮对话后强制自动抽取。
- `AgendaTool` 支持创建、查询、更新、取消 Agenda 项。
- Agenda 项持久化到用户数据目录，重启后能恢复未送达项。
- 后台 `AgendaScheduler` 使用最近到期 timer 加低频兜底扫描；到期才调用 Reminder Composer，不做每分钟 LLM 轮询。
- Reminder Composer 调用 LLM 输出结构化 JSON，并对无效 JSON / 超时 / LLM 错误提供 fallback。
- 飞书 Bot 启动用户 Agent 时也必须启动 Agenda 调度器，保证飞书主动推送可用。
- 无真实 LLM / 飞书凭证时，Agenda 的存储、工具、调度和 Composer fallback 测试可通过。

## 非目标

- 不替换所有 Cron 周期任务；周期自动化仍由 `CronTool` 负责。
- 不要求每轮对话都进行后台 LLM 抽取，避免成本和噪音。
- 不在测试中调用真实 LLM 或真实飞书 API。
- 不绕过飞书消息权限；主动推送仍依赖已有通知通道。

## 环境与兼容性

- Node.js 版本保持项目要求：`>=18`。
- Agenda 数据文件位于现有用户数据目录内。
- 不新增外部运行时依赖。

## 安全约束

- Agenda 不保存 API key、App Secret、access token。
- Reminder Composer 日志不得记录敏感密钥；沿用全局 logger 脱敏。
- 到点提醒只通过已注册的 `NotificationService` 通道发送。

## 可测试性

- AgendaStore 单元测试覆盖持久化、日期恢复、到期查询、取消、送达。
- AgendaTool 单元测试覆盖创建、列表、取消。
- AgendaScheduler 单元测试覆盖到点触发、LLM fallback、无通道不送达。
- ReminderComposer 单元测试覆盖 JSON 成功解析和非法输出 fallback。
