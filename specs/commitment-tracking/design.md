# 设计

## 架构概览

```text
CommitmentTrackerTool
  -> CommitmentTrackerService
      -> AgendaStore
      -> OfficeContextStore
```

`AgendaTool` 继续负责创建和更新日程；承诺追踪只负责读取、分类和摘要。

## 数据模型

`TrackedCommitment`：

- `id/type/title/status/priority`
- `triggerAt/deadlineAt/dueAt`
- `direction`: `owed_by_user | owed_to_user | unknown`
- `people`: 从人名上下文和文本中匹配。
- `projects`: 从项目上下文和文本中匹配。
- `sourceMessage/context/description`

`CommitmentSummary`：

- `overdue`
- `dueSoon`
- `upcoming`
- `byPerson`
- `nextActions`
- `counts`

## 匹配策略

- 只读取 `AgendaItem.type in commitment/deadline/follow_up`。
- 项目/人过滤基于：
  - `title/description/context/sourceMessage/composePrompt` 文本包含。
  - OfficeContext 中项目/人的 title/alias/key。
- 方向判断：
  - 包含“我答应/我承诺/我要/我会/我负责”等，归为 `owed_by_user`。
  - 包含某个人名并出现“答应/承诺/负责/会/要给我”等，归为 `owed_to_user`。
  - 其他归为 `unknown`。

## 错误处理

- 无匹配项时返回空摘要。
- 方向判断不确定时必须返回 `unknown`，不强行编造。

## 测试策略

- Service 测试：
  - 逾期、临近到期、未来分组。
  - 按人/项目过滤。
  - 方向启发式。
- Tool 测试：
  - `list` 和 `summary` 都只读。
- Replay eval：
  - 用户问承诺情况时，模型调用 CommitmentTrackerTool 后回答。
