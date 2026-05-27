# 项目自动周报需求

## 目标

基于现有项目驾驶舱、任务、Agenda、飞书同步源和办公上下文，生成可直接发给用户或写入飞书文档的项目周报。

第一版重点是稳定、可审计、可测试：工具只读取本地状态并生成 Markdown，不直接写飞书；LLM 负责判断何时调用工具、是否继续调用 `LarkCli` 写文档或用 `CronTool` 设置周期任务。

## 用户故事

1. 作为用户，我希望说“生成 Apollo 项目周报”时，Agent 能先读取真实项目状态，再输出周报。
2. 作为用户，我希望周报包含本周进展、风险、待办、承诺/截止日期、相关文档和下周建议。
3. 作为用户，我希望可以说“每周五自动生成 Apollo 周报”，Agent 能用现有 Cron 能力安排周期任务。
4. 作为维护者，我希望周报生成不依赖真实飞书和真实 LLM，基础测试可以离线运行。

## 接受标准

- 新增 `ProjectWeeklyReportTool`。
- 工具支持按 `project` 或 `projectId` 生成周报。
- 输出包含 Markdown 正文、结构化 sections、period、project、warnings。
- 找不到项目时返回候选项目，不编造周报。
- 系统提示要求生成项目周报前先调用该工具。
- Replay eval 覆盖“用户要求项目周报时调用 ProjectWeeklyReportTool”。
- 文档和能力矩阵同步更新。

## 非目标

- 第一版不直接创建飞书文档，不直接发消息。
- 第一版不引入 embedding/RAG。
- 第一版不强制 LLM 重写周报；LLM 可在工具输出基础上做轻微整理，但不能编造。

## 环境与兼容

- 复用 `ProjectDashboardService`。
- 不新增运行时依赖。
- 不要求真实飞书配置。

## 安全与隐私

- 不打印密钥、token 或用户私有配置。
- 周报只使用当前用户本地数据目录中的上下文、任务、Agenda 和同步源。
- 多用户隔离由现有 per-user Agent/dataDir 保证。

## 可测试性

- `ProjectWeeklyReportService` 使用本地 fake store 测试。
- `ProjectWeeklyReportTool` 使用 service mock 测试成功和 not found。
- Replay eval 使用 fake tool，不依赖真实 LLM。
