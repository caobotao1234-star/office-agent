---
name: feishu-sync
description: 同步飞书文档和消息状态
when_to_use: 当用户要求同步飞书、查看飞书更新、拉取飞书消息时
allowed_tools: [FeishuIngestTool, KnowledgeCaptureTool, OfficeContextTool, LarkCli, MemoryTool, TaskManager, AgendaTool]
execution_mode: inline
---

# 飞书状态同步

请按以下步骤同步飞书状态：

1. 如果已有关注源，优先用 FeishuIngestTool syncAll 拉取所有启用来源的最新变更
2. 如果用户给了具体文档、群聊、日历、Base 或关键词，用 FeishuIngestTool fetchOnce 或 addSource + syncSource 拉取
3. 对发生变化的来源，先查看 FeishuIngestTool 返回的上下文记录和内容预览
4. 如果内容里有稳定项目状态、人和关系、会议结论、业务流程、决策、承诺或 deadline，用 KnowledgeCaptureTool 批量写入 OfficeContextTool、MemoryTool 和 AgendaTool
5. 对明确的新任务和行动项，必要时使用 TaskManager 创建对应任务
4. 汇总同步结果：
   - 哪些来源已同步
   - 哪些来源发生变化
   - 关键变更摘要
   - 新增任务列表
   - 新增/更新的上下文和记忆
   - 需要用户关注的事项

如果用户提供了额外要求：$ARGUMENTS
