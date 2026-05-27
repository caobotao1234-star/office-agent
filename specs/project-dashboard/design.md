# 设计

## 架构概览

新增一个只读聚合层：

```text
ProjectDashboardTool
  -> ProjectDashboardService
      -> OfficeContextStore
      -> AgendaStore
      -> FeishuSyncStore
      -> tasks.json
```

LLM 负责判断什么时候需要项目驾驶舱；工具只负责确定性读取和聚合。

## 模块边界

- `src/services/project-dashboard-service.ts`
  - 读取和匹配项目。
  - 聚合任务、Agenda、上下文记录、飞书同步源。
  - 生成结构化 dashboard。
- `src/tools/ProjectDashboardTool/index.ts`
  - 暴露给 LLM 的只读工具。
  - 输入 schema：`list` / `get`。
- `src/main.ts`
  - 注册工具。
  - 系统提示中要求回答项目状态前优先调用驾驶舱。

## 数据模型

`ProjectDashboard`：

- `project`：项目 id/key/title/status/summary/tags。
- `counts`：任务、Agenda、上下文和同步源计数。
- `tasks`：未完成任务列表和高优任务列表。
- `agenda`：pending 的提醒、deadline、commitment、follow_up。
- `context`：最近上下文、人员、文档、会议、知识。
- `syncSources`：飞书同步源状态。
- `risks`：从 overdue/high/urgent task、过期 Agenda、同步错误、上下文 status 中提取的候选风险。
- `nextActions`：从任务和 Agenda 里提取的下一步候选。

## 匹配策略

`get` 优先级：

1. 精确匹配 `OfficeContextRecord.id` 或 `key`。
2. 匹配 project title/alias/key。
3. 模糊搜索项目记录。
4. 如果仍找不到，返回失败并列出候选项目。

任务和 Agenda 的项目关联：

- `projectId` 精确等于项目 `id` 或 `key`。
- 文本里包含项目 title/key/alias。
- Agenda `context/sourceMessage/description/title` 包含项目名。

## 错误处理

- `tasks.json` 缺失或损坏时按空任务处理，并在输出 warning。
- 找不到项目时返回 `success=false`，不让 LLM 编造项目状态。
- 所有输出做数量限制，避免上下文爆炸。

## 测试策略

- Service 测试：
  - 能按项目名聚合任务、Agenda、上下文和同步源。
  - 找不到项目时返回候选。
  - 损坏/缺失任务文件不影响 dashboard。
- Tool 测试：
  - `list` 和 `get` 均为只读。
  - `get` 输出 dashboard。
- Replay eval：
  - 用户问项目状态时，模型调用 `ProjectDashboardTool` 后再回答。

## 性能与安全

- 本地 JSON 文件读取，数据量按 limit 截断。
- 不访问网络，不调用 LLM，不执行写操作。
- 不打印密钥；飞书同步源只展示标题、类型、同步状态和错误摘要。
