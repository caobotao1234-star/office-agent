# 办公上下文系统任务

## T1 Spec 与路线图

- 状态：DONE
- 文件：`specs/office-context-system/requirements.md`、`specs/office-context-system/design.md`、`specs/office-context-system/tasks.md`
- 实现说明：定义秘书型 Agent 的上下文底座、数据模型、后续飞书摄取/RAG/eval 路线。
- 验证命令：人工检查 spec 文件。
- 完成标准：spec 文件齐全，任务按单步提交拆分。

## T2 本地 OfficeContextStore

- 状态：DONE
- 文件：`src/services/office-context-store.ts`、`src/services/office-context-store.test.ts`
- 实现说明：新增本地 JSON store，支持 upsert/get/list/search/delete，保存来源引用和关系。
- 验证命令：`npm test -- src/services/office-context-store.test.ts`
- 完成标准：store 单元测试通过，无外部依赖。

## T3 OfficeContextTool 与 Agent 注册

- 状态：DONE
- 文件：`src/tools/OfficeContextTool/index.ts`、`src/tools/OfficeContextTool/index.test.ts`、`src/main.ts`、`src/main.test.ts`、`README.md`
- 实现说明：把上下文库暴露给 LLM，更新系统提示词和工具列表。
- 验证命令：`npm test -- src/tools/OfficeContextTool/index.test.ts src/main.test.ts && npm run typecheck`
- 完成标准：工具注册和调用测试通过。

## T4 KnowledgeCaptureTool

- 状态：DONE
- 文件：`src/tools/KnowledgeCaptureTool/index.ts`、`src/tools/KnowledgeCaptureTool/index.test.ts`
- 实现说明：由 LLM 自主调用，从对话/文档/群聊/会议内容中提取项目、人、决策、流程、承诺等记录，写入上下文库和必要的 Agenda/Memory。
- 验证命令：`npm test -- src/tools/KnowledgeCaptureTool/index.test.ts && npm run typecheck`
- 完成标准：mock LLM/结构化输入测试通过；无真实飞书依赖。

## T5 FeishuIngestTool

- 状态：DONE
- 文件：`src/services/feishu-sync-store.ts`、`src/services/feishu-sync-store.test.ts`、`src/tools/FeishuIngestTool/index.ts`、`src/tools/FeishuIngestTool/index.test.ts`、`src/main.ts`
- 实现说明：通过 `LarkCli` 按需读取或同步飞书文档、知识库、群聊、日历、Base、任务、通讯录内容；记录关注源和内容 hash，发现变更后更新办公上下文，后续由 `KnowledgeCaptureTool` 继续深提取。
- 验证命令：`npm test -- src/tools/FeishuIngestTool/index.test.ts && npm run typecheck`
- 完成标准：离线 mock runner 测试通过；真实飞书访问只在用户环境手动验证。

## T6 ReplayEval 回放测试

- 状态：PENDING
- 文件：`src/evals/*`、`evals/fixtures/*`、`package.json`
- 实现说明：增加关键对话回放，断言必须调用的工具和失败处理行为。
- 验证命令：`npm run eval:replay`
- 完成标准：不依赖真实 LLM/飞书的回放测试通过。

## T7 项目周报与会议秘书能力

- 状态：PENDING
- 文件：`src/skills/bundled/*`、`src/tools/*`、`README.md`
- 实现说明：基于上下文库和飞书摄取，实现项目自动周报、会前准备、会后行动项追踪。
- 验证命令：对应工具测试、skill smoke 和 replay eval。
- 完成标准：能从上下文库生成带来源的项目状态和会议准备材料。
