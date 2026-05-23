# 办公上下文系统需求

## 目标

把 Office Agent 从“会调用办公工具”推进到“理解用户办公世界”的秘书型 Agent。系统需要维护项目、人、文档、会议、任务承诺、业务流程和知识之间的长期上下文，并让 LLM 通过工具自主写入、检索和更新这些上下文。

## 用户故事

- 作为用户，我希望 Agent 能记住项目状态、关键人、重要文档、会议结论和业务流程，而不是每次都重新问。
- 作为用户，我希望 Agent 能从对话、飞书文档、群聊、日历和 Base 中提取上下文，并按项目长期维护状态。
- 作为用户，我希望 Agent 在写周报、准备会议、追踪承诺时能主动查上下文库和飞书来源。
- 作为 Agent，我需要用工具保存和查询结构化办公上下文，并把来源链接、置信度和更新时间保留下来。
- 作为维护者，我需要这个能力保持轻量，不引入复杂 workflow engine，也不依赖真实飞书凭证才能测试。

## 接受标准

- 新增本地 `OfficeContextStore`，能持久化、更新、搜索、删除办公上下文记录。
- 新增 `OfficeContextTool` 暴露给 LLM，用于保存、检索和维护人、项目、文档、会议、任务、流程、关系、知识记录。
- `createOfficeAgent()` 默认注册 `OfficeContextTool`。
- 系统提示词明确：涉及项目、人、文档、会议、流程、长期状态时优先查询或写入 `OfficeContextTool`。
- 所有数据默认存储在用户 `baseDir` 下，不需要数据库服务。
- 单元测试覆盖 store 的 upsert/search/delete 和工具调用路径。
- 无真实飞书凭证、无外部 LLM key 时，测试、类型检查和构建仍可运行。

## 非目标

- 不在第一步实现飞书文档/群聊/日历/Base 的实际摄取。
- 不在第一步实现向量库或 embedding RAG。
- 不引入图数据库或复杂 workflow engine。
- 不替代现有 `TaskManager`、`AgendaTool`、`MemoryTool`，而是作为结构化办公上下文补充。
- 不实现权限 policy；继续采用高信任模式，真实权限由工具和飞书授权边界决定。

## 环境与兼容性

- 保持 Node.js `>=18`。
- 保持 TypeScript ESM 和 Vitest。
- 本地文件格式使用 JSON，后续可迁移到 SQLite/FTS，但第一版不新增运行时依赖。

## 安全约束

- 不保存飞书 App Secret、access token、refresh token。
- 来源引用只保存 URL、open_id、chat_id、文档 token 等业务引用，不保存密钥。
- 工具写入必须通过 Zod schema 校验。
- 失败时返回可读错误，不伪造保存成功。

## 可测试性

- Store 测试必须使用临时目录和本地文件。
- Tool 测试必须 mock `ToolContext`，不调用真实 LLM 或飞书。
- 主 Agent 注册测试需要验证 `OfficeContextTool` 出现在工具列表中。
