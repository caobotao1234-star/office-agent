# 项目自动周报设计

## 架构

```text
User asks for weekly report
  -> QueryEngine
  -> ProjectWeeklyReportTool
  -> ProjectWeeklyReportService
  -> ProjectDashboardService
  -> Markdown + structured sections
  -> LLM answers / optionally LarkCli docs +create / CronTool
```

## 模块

- `src/services/project-weekly-report-service.ts`
  - 读取 `ProjectDashboardService.buildDashboard()` 输出。
  - 按报告周期过滤近期上下文和同步源变化。
  - 生成结构化 sections 和 Markdown。

- `src/tools/ProjectWeeklyReportTool/index.ts`
  - 暴露 `generate` 动作。
  - 只读工具。
  - not found 时返回候选项目。

- `src/main.ts`
  - 注册工具。
  - 系统提示：生成项目周报前调用该工具；定时周报用 CronTool，正文再由该工具生成。

- `src/evals/replay.ts`
  - 增加周报调用回放。

## 数据模型

`ProjectWeeklyReport`：

- `project`
- `period`
- `generatedAt`
- `sections`
  - `summary`
  - `weeklyProgress`
  - `openTasks`
  - `risks`
  - `commitments`
  - `nextWeekPlan`
  - `sources`
- `markdown`
- `warnings`
- `suggestedCronPrompt`

## 周期规则

- 默认生成“本周一 00:00 到当前时间”的周报。
- 用户传 `periodStart` / `periodEnd` 时使用指定范围。
- 时间以运行时本地 `Date` 为准；Markdown 中使用 `YYYY-MM-DD`。

## 内容来源

- 本周进展：项目上下文中本周期更新的 document/meeting/knowledge/task/business_process。
- 风险：项目驾驶舱 `risks`。
- 待办：项目驾驶舱 open/high priority/overdue tasks。
- 承诺和截止日期：项目驾驶舱 Agenda。
- 来源：飞书同步源状态和最近变更。
- 下周计划：项目驾驶舱 `nextActions`。

## 错误处理

- 找不到项目：复用 `ProjectNotFoundError`，返回候选。
- 数据不足：生成“暂无明确记录”的段落，不编造。
- 底层 tasks 文件坏：透传 dashboard warnings。

## 测试

- 单元测试覆盖：
  - 正常生成 Markdown。
  - 默认本周周期。
  - 项目不存在时抛出 not found。
  - 工具只读且返回候选。
- Replay eval 覆盖 LLM 对项目周报请求调用工具。
