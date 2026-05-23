# 办公上下文系统设计

## 架构概览

办公上下文系统分四步演进：

1. `OfficeContextStore` + `OfficeContextTool`：本地结构化上下文库，供 Agent 自主保存和检索。
2. `KnowledgeCaptureTool`：从对话、文档、群聊、会议内容中提取上下文，写入 `OfficeContextStore`、`AgendaTool`、`MemoryTool`。
3. `FeishuIngestTool`：通过 `LarkCli` 按需读取飞书文档、群聊、日历、Base、任务、通讯录，并交给提取工具处理。
4. `ReplayEval`：回放关键对话，验证工具调用、失败处理、提醒和飞书写操作门禁。

本次先实现第 1 步。它不调用 LLM，也不访问飞书，只提供稳定、可测试的数据底座。

## 模块边界

- `src/services/office-context-store.ts`
  - 本地 JSON 持久化。
  - 负责记录标准化、upsert、search、delete。
  - 不依赖 LLM、不依赖飞书。

- `src/tools/OfficeContextTool/index.ts`
  - 暴露给 LLM 的工具层。
  - 使用 Zod 校验输入。
  - 调用 `OfficeContextStore`。

- `src/main.ts`
  - 初始化 `OfficeContextStore`。
  - 注册 `OfficeContextTool`。
  - 系统提示词加入办公上下文使用规则。

## 数据模型

`OfficeContextRecord` 是轻量通用实体，避免第一版过早拆成很多表：

- `id`：UUID。
- `type`：`person | project | document | meeting | task | business_process | relationship | knowledge | misc`。
- `key`：可选稳定去重键。未提供时用 `type:title` 归一化生成。
- `title`：实体标题。
- `summary`：当前可用摘要。
- `status`：可选状态，例如 active、blocked、done、draft。
- `aliases`：别名，用于搜索人名/项目简称。
- `tags`：标签。
- `projectId`：关联项目 ID。
- `source`：`conversation | feishu_doc | feishu_message | feishu_calendar | feishu_base | manual | import | tool`。
- `sourceRefs`：来源引用列表，包含类型、ID、URL、标题和时间。
- `relations`：实体关系，例如 person owns project、meeting produced task。
- `metadata`：少量 JSON 结构化补充信息。
- `confidence`：0 到 1 的置信度。
- `createdAt`、`updatedAt`、`lastSeenAt`：时间字段。

第一版不强制 schema 化每类实体的私有字段，避免工具 schema 过重。后续可基于真实使用频率拆出专用字段或索引。

## 搜索策略

第一版使用确定性本地搜索：

- 类型、项目、标签过滤。
- 关键词匹配 `title`、`summary`、`aliases`、`tags`、`sourceRefs.title`。
- 简单打分：标题/别名命中权重大于摘要命中；越新越靠前。

后续 RAG 阶段再引入 SQLite FTS 或 embedding。

## 错误处理

- JSON 文件不存在：视为空库。
- JSON 文件损坏：记录日志，返回空库，不覆盖原文件。
- upsert 输入缺少标题或摘要：由 Zod 拦截。
- delete 未找到：返回失败错误。
- 工具异常：返回 `{ success: false, error }`，不声称成功。

## 测试策略

- `office-context-store.test.ts`
  - upsert 新记录。
  - 使用相同 key 更新已有记录。
  - 持久化后重新加载。
  - 搜索类型、关键词、标签。
  - 删除记录。

- `OfficeContextTool/index.test.ts`
  - 调用 upsert/search/get/delete。
  - 验证错误路径。

- `main.test.ts`
  - 验证 `OfficeContextTool` 默认注册。

## 性能考虑

第一版用内存数组和 JSON 文件，适合个人秘书场景。预计上下文记录在几千条以内时足够。后续如果文档/群聊摄取量变大，再切 SQLite FTS。

## 安全考虑

- 不保存密钥和 token。
- 不做项目内权限 policy。
- 数据只写入用户本地 `baseDir`。
- 对外部飞书资源只保存引用，不复制凭据。

## 迁移说明

新增文件路径：

- `<baseDir>/office-context.json`

现有 `memories/`、`tasks.json`、`agenda.json` 不迁移。未来可做一次性索引器，把已有任务、记忆、agenda 以来源引用方式写入上下文库。
