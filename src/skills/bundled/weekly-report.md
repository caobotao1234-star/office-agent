---
name: weekly-report
description: 生成周报
when_to_use: 当用户要求生成周报、本周总结、每周汇报时
allowed_tools: [TaskManager, MemoryTool, FeishuConnector]
execution_mode: fork
---

# 周报生成

请生成本周工作周报。$ARGUMENTS

生成步骤：

1. 使用 TaskManager 查询本周已完成的任务
2. 使用 TaskManager 查询本周进行中和未完成的任务
3. 使用 MemoryTool 检索本周的重要决策、会议记录和项目进展
4. 按以下格式生成周报：
   - 本周工作概述
   - 已完成事项（按项目分组）
   - 进行中事项及进展
   - 未完成事项及原因
   - 下周计划
   - 需要协调或支持的事项
   - 风险与问题
