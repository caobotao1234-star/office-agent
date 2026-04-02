---
name: meeting-notes
description: 整理会议纪要
when_to_use: 当用户要求整理会议纪要、会议记录、会议总结时
allowed_tools: [MemoryTool, TaskManager]
execution_mode: inline
---

# 会议纪要整理

请按以下步骤整理会议纪要：

1. 从用户提供的会议内容中提取关键信息
2. 识别会议中产生的行动项（Action Items）并使用 TaskManager 创建对应任务
3. 使用 MemoryTool 存储会议中的重要决策
4. 按以下格式输出会议纪要：
   - 会议主题
   - 参会人员
   - 讨论要点
   - 决策事项
   - 行动项（负责人 + 截止日期）
   - 下次会议安排

如果用户提供了额外要求：$ARGUMENTS
