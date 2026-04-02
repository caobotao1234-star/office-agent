---
name: daily-report
description: 生成每日工作汇报
when_to_use: 当用户要求生成日报、工作汇报、今日总结时
allowed_tools: [TaskManager, MemoryTool, FeishuConnector]
execution_mode: inline
---

# 每日工作汇报生成

请按以下步骤生成今日工作汇报：

1. 使用 TaskManager 查询今日已完成的任务
2. 使用 TaskManager 查询今日进行中的任务
3. 使用 MemoryTool 检索今日的重要决策和会议记录
4. 按以下格式生成汇报：
   - 今日完成事项
   - 进行中事项及进展
   - 明日计划
   - 需要协调的事项

如果用户提供了额外要求：$ARGUMENTS
