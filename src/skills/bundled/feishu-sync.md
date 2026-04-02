---
name: feishu-sync
description: 同步飞书文档和消息状态
when_to_use: 当用户要求同步飞书、查看飞书更新、拉取飞书消息时
allowed_tools: [FeishuConnector, MemoryTool, TaskManager]
execution_mode: inline
---

# 飞书文档状态同步

请按以下步骤同步飞书状态：

1. 使用 FeishuConnector 拉取最新的飞书消息和文档变更
2. 从消息中提取新任务和行动项，使用 TaskManager 创建对应任务
3. 从文档变更中提取关键信息更新，使用 MemoryTool 存储
4. 汇总同步结果：
   - 新消息摘要
   - 文档变更摘要
   - 新增任务列表
   - 需要用户关注的事项

如果用户提供了额外要求：$ARGUMENTS
