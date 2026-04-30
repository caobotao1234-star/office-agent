# LangChain.js 重构学习计划

> 目标：将手搓的 Office Agent 逐步重构为 LangChain.js 版本，每一步都能运行，每一步都有充足注释说明"LangChain 在这里帮你做了什么"。

## 当前项目架构概览（手搓版）

| 模块 | 文件 | 手搓了什么 |
|------|------|-----------|
| LLM 调用层 | `llm-client.ts` + `dashscope-llm.ts` | 自定义 LLMClient 接口、手动拼 fetch 请求、手动解析 SSE 流 |
| 工具系统 | `tool-system.ts` + 16 个 Tool 实现 | 自定义 Tool 接口、Zod schema 验证、权限检查、ToolRegistry |
| 对话引擎 | `query-engine.ts` | 手写 ReAct loop（多轮工具调用循环）、消息历史管理、流式输出 |
| 记忆系统 | `memory-system.ts` | 文件系统存储、MEMORY.md 索引、LLM side query 召回 |
| 上下文管理 | `context-manager.ts` | 自动压缩、token 估算、LLM 摘要 |
| 模型注册 | `model-registry.ts` | 从 .env 解析多模型配置 |
| 技能系统 | `skill-system.ts` | Markdown frontmatter 解析、inline/fork 执行 |
| 子代理 | `sub-agent-manager.ts` | 项目隔离的子代理、独立 memdir |
| 会话持久化 | `session-store.ts` | JSON 文件存储会话历史 |

## LangChain.js 当前版本特性总结（2026 年 4 月）

### 核心包 `@langchain/core` (v0.3.x)
- **ChatModel 抽象**：统一的模型接口，支持 OpenAI / Anthropic / 阿里云等，一行切换
- **Tool 抽象**：`tool()` 函数 + Zod schema，比手搓的 Tool 接口简洁 80%
- **消息类型**：`HumanMessage`, `AIMessage`, `ToolMessage`, `SystemMessage` — 标准化消息格式
- **Runnable 协议**：所有组件统一 `.invoke()` / `.stream()` / `.batch()` 接口
- **回调系统**：内置 tracing / logging / streaming 回调链

### Agent 框架 `langchain` (v1.0)
- **`createAgent()`**：一行创建标准 ReAct agent（你手搓了 ~200 行的 query-engine）
- **Middleware**：在 agent loop 的每一步插入自定义逻辑（human-in-the-loop、日志、权限检查）
- **Provider 无关**：`"openai:gpt-5"` / `"anthropic:claude-4"` 格式直接切换模型

### LangGraph `@langchain/langgraph` (v1.1)
- **StateGraph**：有状态的多步骤工作流，节点 + 边的图结构
- **StateSchema**：类型安全的状态定义，支持 Zod 4
- **Checkpointing**：内置状态持久化（你手搓的 session-store）
- **ReducedValue**：状态累加器（类似你的消息历史管理）
- **MessagesValue**：预置的消息状态管理
- **Human-in-the-loop**：内置中断和确认机制

### 集成包
- `@langchain/community`：社区集成（各种 LLM provider、向量数据库等）
- `@langchain/openai`：OpenAI 兼容 API（你的 DashScope 就是 OpenAI 兼容格式）

---

## 重构步骤（按优先级排序）

### 第一阶段：替换已有功能（LangChain 简化手搓代码）

#### Step 1: LLM 调用层 → ChatOpenAI
- **替换**: `llm-client.ts` + `dashscope-llm.ts` + `model-registry.ts`
- **用**: `@langchain/openai` 的 `ChatOpenAI`（兼容 DashScope）
- **收益**: 删除 ~300 行手写 fetch/SSE 解析代码，自动处理流式、重试、token 计数
- **学习点**: LangChain 的模型抽象如何统一不同 provider

#### Step 2: 工具定义 → LangChain Tool
- **替换**: `tool-system.ts` 中的 Tool 接口和 ToolRegistry
- **用**: `@langchain/core/tools` 的 `tool()` 函数 + `ToolNode`
- **收益**: 工具定义从 ~50 行/个 → ~15 行/个，自动 schema 转换
- **学习点**: LangChain 如何用 Zod 自动生成 function calling schema

#### Step 3: 对话引擎 → createAgent / LangGraph ReAct
- **替换**: `query-engine.ts` 的手写 ReAct loop（~300 行）
- **用**: `langchain` 的 `createAgent()` 或 `@langchain/langgraph/prebuilt` 的 `createReactAgent()`
- **收益**: 删除最复杂的手搓代码，获得内置的工具调用循环、错误重试、流式输出
- **学习点**: LangChain agent loop 的核心机制，middleware 的用法

#### Step 4: 消息历史 → LangGraph 消息状态
- **替换**: `query-engine.ts` 中的 `messages: Message[]` 手动管理
- **用**: LangGraph 的 `MessagesValue` + `StateSchema`
- **收益**: 类型安全的消息管理，内置消息裁剪
- **学习点**: LangGraph 的状态管理模型

#### Step 5: 上下文压缩 → LangChain 消息裁剪
- **替换**: `context-manager.ts` 的手写压缩逻辑
- **用**: LangGraph 的 `trimMessages` + 自定义 summarizer node
- **收益**: 标准化的上下文窗口管理
- **学习点**: LangChain 如何处理长对话

#### Step 6: 会话持久化 → LangGraph Checkpointer
- **替换**: `session-store.ts` 的 JSON 文件存储
- **用**: `@langchain/langgraph` 的 `MemorySaver` 或 `SqliteSaver`
- **收益**: 内置的状态快照和恢复，支持多会话
- **学习点**: LangGraph 的 checkpointing 机制

### 第二阶段：引入 LangChain 新能力（本地没做的）

#### Step 7: Middleware — 权限检查 & 日志
- **新增**: 用 LangChain 1.0 的 middleware 机制替代手搓的权限检查
- **学习点**: middleware 如何在 agent loop 的每一步插入逻辑

#### Step 8: Structured Output — 结构化输出
- **新增**: 用 `.withStructuredOutput()` 让 LLM 直接返回类型安全的对象
- **学习点**: 比手动 JSON.parse 更可靠的结构化输出方式

#### Step 9: Streaming 增强 — 事件流
- **新增**: 用 `.streamEvents()` 获取细粒度的执行事件流
- **学习点**: LangChain 的流式事件系统，比手搓的 StreamEvent 更丰富

#### Step 10: Multi-Agent — LangGraph 子图
- **新增**: 用 LangGraph 的子图（subgraph）重构 sub-agent-manager
- **学习点**: LangGraph 如何编排多个 agent 协作

---

## 类比理解

| 手搓 | LangChain | 类比 |
|------|-----------|------|
| `fetch()` + SSE 解析 | `ChatOpenAI` | 汇编 `syscall` → C 的 `printf()` |
| 手写 ReAct loop | `createAgent()` | 手写事件循环 → `express.listen()` |
| `Tool` 接口 + `ToolRegistry` | `tool()` + `ToolNode` | 手写路由匹配 → `app.get('/path')` |
| `Message[]` 手动管理 | `MessagesValue` | 手写链表 → `std::vector` |
| JSON 文件存会话 | `MemorySaver` | 手写文件 IO → ORM |

## 注意事项

- 每一步改完都要能 `npm run test` 通过
- 每一步改完都要能 `npm run start` 正常对话
- 注释要说明"这里 LangChain 帮你做了什么，手搓版是怎么做的"
- 保留原有的业务逻辑（system prompt、工具行为），只替换基础设施层
