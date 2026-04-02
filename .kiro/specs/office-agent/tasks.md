# 实现计划：Office Agent（办公智能助理）

## 概述

基于 Claude Code 架构模式，使用 TypeScript + Node.js 实现办公 AI Agent 系统。按照从底层基础设施到上层功能的顺序，逐步构建 QueryEngine 主循环、Tool 系统、Memory 系统、Skill 系统、Sub-Agent、提醒引擎、定时调度、离开摘要、语音输入和主动建议等核心模块。

## 任务

- [x] 1. 搭建项目基础结构与核心类型定义
  - [x] 1.1 初始化 TypeScript + Node.js 项目
    - 创建 `package.json`、`tsconfig.json`，配置 ESM 模块、严格模式
    - 安装核心依赖：`zod`（schema 验证）、`uuid`（ID 生成）、`cron-parser`（cron 表达式解析）
    - 安装开发依赖：`vitest`（测试框架）、`typescript`
    - 创建目录结构：`src/`、`src/core/`、`src/tools/`、`src/skills/`、`src/services/`
    - _需求: 全局_

  - [x] 1.2 定义核心数据模型与类型
    - 创建 `src/types/index.ts`，定义所有核心接口和类型
    - 包含：`TaskItem`、`TaskStatus`、`TaskPriority`、`TaskSource`
    - 包含：`InformationEntry`、`InformationType`、`InformationSource`、`ExtractedEntity`
    - 包含：`MemoryEntry`、`MemoryType`、`MemorySource`、`MemoryQuery`
    - 包含：`UserConfig`（工作时间、提醒配置、离开摘要、飞书配置、工具启用状态）
    - 包含：`Message`、`StreamEvent`、`ToolResult`、`ToolContext`
    - 包含：`CronTask`、`BackgroundTaskState`、`Reminder`、`Suggestion`
    - 使用 Zod schema 为 `TaskItem` 和 `InformationEntry` 定义验证规则
    - _需求: 4.1, 14.1, 14.2, 12.1-12.5, 3.1-3.2_

  - [ ]* 1.3 编写 TaskItem 和 InformationEntry 的序列化往返一致性属性测试
    - **属性 1: TaskItem 往返一致性** — 任意有效 TaskItem 序列化为 JSON 后反序列化应产生等价对象
    - **属性 2: InformationEntry 往返一致性** — 任意有效 InformationEntry 序列化后反序列化应产生等价对象
    - **验证: 需求 14.3, 14.4**

- [-] 2. 实现 Tool_System 工具系统框架
  - [x] 2.1 实现 Tool 基础接口与 ToolRegistry
    - 创建 `src/core/tool-system.ts`
    - 定义 `Tool` 接口：`name`、`description`、`inputSchema`、`isEnabled()`、`isReadOnly()`、`checkPermissions()`、`call()`、`requiresUserConfirmation()`
    - 实现 `ToolRegistry` 类：工具注册、按名称查找、列出已启用工具、加载/卸载工具模块
    - 实现权限检查逻辑：写操作默认需要用户确认，读操作不需要
    - _需求: 9.1, 9.3, 9.4, 9.5_

  - [ ]* 2.2 编写 ToolRegistry 单元测试
    - 测试工具注册、查找、启用/禁用、权限检查逻辑
    - _需求: 9.1, 9.3, 9.4_

  - [ ] 2.3 实现 TaskManager 工具
    - 创建 `src/tools/TaskManager/index.ts`
    - 实现任务 CRUD：创建 TaskItem（含描述、截止日期、优先级、项目、来源）
    - 实现状态追踪：pending → in_progress → completed / overdue / cancelled
    - 实现逾期检测：截止日期已过且未完成的任务自动标记为 overdue
    - 实现任务拆解：大任务生成子任务方案，支持 parentTaskId / subtaskIds 关联
    - 实现筛选查询：按项目、状态、优先级、截止日期筛选
    - 数据持久化到 `~/.office-agent/tasks.json`
    - _需求: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7_

  - [ ]* 2.4 编写 TaskManager 单元测试
    - 测试任务创建、状态流转、逾期检测、筛选查询
    - _需求: 4.1, 4.5, 4.6, 4.7_

- [ ] 3. 检查点 — 确保基础结构和工具框架测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 4. 实现 Memory_System 记忆系统
  - [ ] 4.1 实现记忆持久化层
    - 创建 `src/core/memory-system.ts`
    - 实现 `MemorySystem` 类的持久化操作：`store()`、`update()`、`delete()`、`deleteAll()`
    - 记忆以 Markdown + YAML frontmatter 格式存储在 `~/.office-agent/memdir/` 目录
    - 每条记忆包含 frontmatter 元数据：title、type、tags、source、project、created、updated、access_count、last_accessed
    - 按类型分目录存储：preferences/、projects/、colleagues/、decisions/、auto/
    - 实现 `search()` 方法：支持按 projectId、type、tags、timeRange、keyword、sortBy 检索
    - 实现 `exportAll()` 方法：支持导出为 JSON 或 Markdown 格式
    - _需求: 3.1, 3.2, 3.5, 3.6, 3.8, 3.9, 12.5, 14.1_

  - [ ] 4.2 实现记忆上下文注入层（Side Query）
    - 实现 `findRelevantMemories()` 方法
    - 扫描 memdir/ 目录下所有记忆文件的 frontmatter（标题 + 标签 + 类型）构建记忆清单
    - 使用轻量级 LLM side query，传入当前对话意图 + 记忆清单，选出最多 5 条最相关记忆
    - 读取选中记忆的完整内容，返回用于注入上下文
    - _需求: 3.4, 3.11_

  - [ ] 4.3 实现自动记忆提取
    - 实现 `extractAndStoreFromConversation()` 方法
    - 对话结束后自动从对话内容中提取值得长期记忆的信息
    - 提取类型：用户偏好、重要决策、关键结论、承诺、同事信息
    - 无需用户手动指示"记住这个"
    - _需求: 3.3, 3.10_

  - [ ]* 4.4 编写 Memory_System 单元测试
    - 测试记忆存储、检索、更新、删除、导出
    - 测试 frontmatter 解析和生成
    - _需求: 3.1, 3.5, 3.6, 3.8_

- [ ] 5. 实现 Context_Manager 上下文管理器
  - [ ] 5.1 实现 Token 预算分配与上下文组装
    - 创建 `src/core/context-manager.ts`
    - 实现 `allocateBudget()` 方法：为系统提示、记忆注入、对话历史、工具结果分配 token 预算
    - 实现 `buildContext()` 方法：组装系统提示 + 记忆 + 对话历史 + 工具定义为完整上下文
    - _需求: 15.4_

  - [ ] 5.2 实现自动压缩机制
    - 实现 `shouldAutoCompact()` 方法：token 使用量达到上下文窗口 90% 时触发
    - 实现 `compact()` 方法：将历史对话压缩为结构化摘要，保留关键信息（任务状态变更、重要决策、用户指令）
    - 压缩过程中将值得长期保留的信息提取到 Memory_System 持久化层
    - 压缩后用户无需感知，对话继续正常进行
    - _需求: 15.1, 15.2, 15.3, 15.5_

  - [ ]* 5.3 编写 Context_Manager 单元测试
    - 测试 token 预算分配、压缩触发条件、压缩结果
    - _需求: 15.1, 15.4_

- [ ] 6. 实现 QueryEngine 主循环引擎
  - [ ] 6.1 实现 QueryEngine 核心循环
    - 创建 `src/core/query-engine.ts`
    - 实现 `QueryEngine` 类，采用 `async function*` 异步生成器模式
    - 实现 `submitMessage()` 方法：接收用户输入 → 组装上下文（调用 ContextManager + MemorySystem）→ 调用 LLM API → 处理流式响应
    - 当 LLM 返回 `tool_use` 时，通过 ToolRegistry 执行工具调用并将结果反馈给 LLM 继续循环
    - 每轮对话结束后触发自动记忆提取（调用 MemorySystem.extractAndStoreFromConversation）
    - 实现 `interrupt()` 方法支持中断当前请求
    - 实现 `getMessages()` 和 `getSessionId()` 方法
    - _需求: 11.1, 11.3, 11.6_

  - [ ] 6.2 实现斜杠命令解析器
    - 创建 `src/core/slash-command.ts`
    - 解析 `/tasks`、`/remind`、`/project`、`/daily-report` 等斜杠命令
    - 将斜杠命令转换为对应的工具调用或技能触发
    - 支持参数化调用（如 `/task-breakdown "完成Q2产品规划"`）
    - _需求: 11.5, 10.3, 10.8_

  - [ ]* 6.3 编写 QueryEngine 单元测试
    - 测试消息提交、工具调用循环、中断机制
    - 测试斜杠命令解析
    - _需求: 11.1, 11.5_

- [ ] 7. 检查点 — 确保核心引擎和记忆系统测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 8. 实现 Skill_System 技能系统
  - [ ] 8.1 实现技能加载器与执行引擎
    - 创建 `src/core/skill-system.ts`
    - 实现 `SkillSystem` 类：`loadSkills()`、`findSkill()`、`executeSkill()`、`suggestSkill()`
    - 实现 SKILL.md 文件解析：解析 Markdown + YAML frontmatter 格式，提取 name、description、when_to_use、allowed_tools、execution_mode
    - 支持三种技能来源：bundled（内置）、user（用户自定义）、mcp（远程）
    - 实现 `inline` 执行模式：在当前上下文中执行技能指令
    - 实现 `fork` 执行模式：创建独立子 Agent 执行技能，完成后返回结果
    - 支持 `$ARGUMENTS` 变量替换实现参数化调用
    - _需求: 10.1, 10.3, 10.5, 10.6, 10.7, 10.8_

  - [ ] 8.2 创建内置技能文件
    - 创建 `src/skills/bundled/daily-report.md`：每日工作汇报生成（inline 模式）
    - 创建 `src/skills/bundled/meeting-notes.md`：会议纪要整理（inline 模式）
    - 创建 `src/skills/bundled/task-breakdown.md`：大任务拆解（fork 模式）
    - 创建 `src/skills/bundled/feishu-sync.md`：飞书文档状态同步（inline 模式）
    - 创建 `src/skills/bundled/weekly-report.md`：周报生成（fork 模式）
    - 每个技能文件包含完整的 YAML frontmatter 和执行指令
    - _需求: 10.2, 10.4, 10.5_

  - [ ]* 8.3 编写 Skill_System 单元测试
    - 测试技能文件解析、技能查找、参数替换、执行模式选择
    - _需求: 10.1, 10.5, 10.8_

- [ ] 9. 实现 Sub_Agent 动态子 Agent 管理
  - [ ] 9.1 实现 SubAgentManager
    - 创建 `src/core/sub-agent-manager.ts`
    - 实现 `SubAgentManager` 类：`create()`、`delegate()`、`archive()`、`list()`、`getByProject()`
    - 每个 Sub_Agent 拥有独立的 memdir 子目录（`~/.office-agent/agents/{project-id}/memdir/`）
    - Sub_Agent 继承 Main_Agent 核心能力但上下文限定在项目范围内
    - 项目结束时将关键信息归档到 Main_Agent 记忆系统后注销
    - 创建 Sub_Agent 时需要用户确认
    - _需求: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 9.2 实现 SubAgentTool
    - 创建 `src/tools/SubAgentTool/index.ts`
    - 作为 Tool_System 中的工具，供 Main_Agent 通过 LLM 调用来管理子 Agent
    - 支持操作：创建子 Agent、委派任务、查看列表、归档注销
    - _需求: 8.1, 8.3, 8.5_

  - [ ]* 9.3 编写 SubAgentManager 单元测试
    - 测试子 Agent 创建、委派、归档、列表查询
    - _需求: 8.1, 8.4, 8.5_

- [ ] 10. 实现 Reminder_Engine 提醒引擎
  - [ ] 10.1 实现定时提醒与截止日期提醒
    - 创建 `src/services/reminder-engine.ts`
    - 实现 `scheduleDailyBriefing()`：每日待办清单生成（默认工作日 9:00）
    - 实现 `scheduleWeeklySummary()`：每周工作总结生成（默认周五 17:00）
    - 实现 `checkDeadlines()`：检测截止日期不足 24 小时的紧急提醒、不足 3 天的预警提醒
    - 支持用户自定义提醒频率、时间、每个任务的提醒提前量
    - 任务完成后自动取消待发送提醒
    - 非工作时间暂停非紧急提醒
    - _需求: 5.1-5.5, 6.1-6.4, 12.2, 12.3_

  - [ ] 10.2 实现智能判断提醒
    - 实现 `analyzeForSmartReminders()` 方法
    - 检测延迟性表述（"稍后做"、"回头处理"、"明天再说"）创建跟进提醒
    - 检测承诺追踪（"我来处理"、"我发给你"）并在合理时间检查是否兑现
    - 检测项目停滞：超过设定天数无更新的项目触发提醒
    - 基于任务创建时间、优先级、用户活动模式检测可能遗忘的任务
    - 每条智能提醒包含提醒原因说明
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 10.3 编写 Reminder_Engine 单元测试
    - 测试截止日期提醒触发逻辑、智能提醒检测、提醒取消
    - _需求: 5.1, 6.1, 6.4, 7.1_

- [ ] 11. 实现 Cron_Scheduler 定时调度器
  - [ ] 11.1 实现 CronScheduler 核心
    - 创建 `src/services/cron-scheduler.ts`
    - 实现 `CronScheduler` 类：`create()`、`update()`、`delete()`、`list()`
    - 支持标准 cron 表达式，使用用户本地时区
    - 支持两种任务类型：一次性任务（执行后自动删除）和循环任务（按 cron 重复）
    - 实现 `start()` / `stop()` 调度循环
    - 触发时将任务 prompt 注入 Main_Agent 消息队列
    - 实现 durable 模式：持久化到 `~/.office-agent/cron-tasks.json`，重启后自动恢复
    - 实现 `checkMissedTasks()`：系统离线期间错过的一次性任务在恢复后补执行
    - _需求: 17.1-17.7_

  - [ ]* 11.2 编写 CronScheduler 单元测试
    - 测试任务创建、cron 表达式解析、持久化恢复、补执行逻辑
    - _需求: 17.2, 17.3, 17.5, 17.7_

- [ ] 12. 检查点 — 确保技能系统、子 Agent、提醒和调度测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 13. 实现 Document_Parser 文档解析器
  - [ ] 13.1 实现多格式文档解析
    - 创建 `src/tools/DocumentParser/index.ts`
    - 实现飞书云文档解析：通过 Feishu API 获取文档内容并转换为 InformationEntry
    - 实现 Excel 解析：使用 `xlsx` 库解析表格数据
    - 实现 Word 解析：使用 `mammoth` 库解析 docx 文件
    - 实现网页解析：使用 `cheerio` 库提取网页正文
    - 实现纯文本解析
    - 不支持的格式返回明确错误提示并建议转换
    - 实现 `formatOutput()` 方法：将 InformationEntry 转换回可读文本
    - _需求: 1.2, 1.3, 1.4, 1.5, 1.6, 14.5, 14.6_

  - [ ]* 13.2 编写 DocumentParser 单元测试
    - 测试各格式解析、错误处理、格式化输出
    - _需求: 1.2, 1.3, 1.6, 14.5_

- [ ] 14. 实现 Feishu_Connector 飞书连接器
  - [ ] 14.1 实现飞书 API 对接
    - 创建 `src/tools/FeishuConnector/index.ts`
    - 实现消息发送：`sendMessage()`
    - 实现文档监控：`watchDocuments()` 通过事件订阅监听文档变更
    - 实现消息监控：`watchMessages()` 监听用户飞书消息
    - 实现日程创建：`createCalendarEvent()`
    - 实现事件订阅：`startEventSubscription()` / `stopEventSubscription()`
    - 实现断连恢复：记录断连时间，恢复后自动重连并补拉变更
    - 支持用户配置监控范围（文档空间、文件夹、聊天群组）
    - _需求: 2.1-2.6, 9.2_

  - [ ]* 14.2 编写 Feishu_Connector 单元测试
    - 测试消息发送、事件订阅、断连恢复逻辑（使用 mock）
    - _需求: 2.1, 2.5, 2.6_

- [ ] 15. 实现辅助工具模块
  - [ ] 15.1 实现 ReminderTool、MemoryTool、CronTool、BackgroundTaskTool
    - 创建 `src/tools/ReminderTool/index.ts`：创建/修改/删除提醒的 Tool 接口
    - 创建 `src/tools/MemoryTool/index.ts`：记忆手动增删查改的 Tool 接口
    - 创建 `src/tools/CronTool/index.ts`：定时任务管理的 Tool 接口
    - 创建 `src/tools/BackgroundTaskTool/index.ts`：后台任务管理的 Tool 接口
    - 每个工具实现 `Tool` 接口，包含 inputSchema、权限检查、用户确认逻辑
    - _需求: 5.1, 6.3, 3.6, 17.6, 18.1_

  - [ ] 15.2 实现 EmailTool 和 CalendarTool
    - 创建 `src/tools/EmailTool/index.ts`：邮件发送 Tool
    - 创建 `src/tools/CalendarTool/index.ts`：日程创建与查询 Tool
    - 写操作需要用户确认后执行
    - 执行失败时报告原因并建议手动操作
    - _需求: 9.2, 9.5, 9.6_

  - [ ]* 15.3 编写辅助工具模块单元测试
    - 测试各工具的输入验证、权限检查、错误处理
    - _需求: 9.5, 9.6_

- [ ] 16. 实现 Background_Task 后台任务管理器
  - [ ] 16.1 实现 BackgroundTaskManager
    - 创建 `src/services/background-task-manager.ts`
    - 实现 `spawn()`：派发耗时任务为后台异步执行，不阻塞主对话
    - 实现 `cancel()`：支持取消正在执行的后台任务
    - 实现 `getStatus()` / `list()`：查看任务状态（pending、running、completed、failed、cancelled）
    - 实现 `onComplete()` 回调：任务完成时通知用户并展示结果摘要
    - 失败时报告原因并建议重试或手动处理
    - _需求: 18.1-18.6_

  - [ ]* 16.2 编写 BackgroundTaskManager 单元测试
    - 测试任务派发、取消、状态查询、完成回调
    - _需求: 18.1, 18.5, 18.6_

- [ ] 17. 检查点 — 确保所有工具模块和后台任务测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 18. 实现 Away_Summary_Engine 离开摘要引擎
  - [ ] 18.1 实现离开检测与摘要生成
    - 创建 `src/services/away-summary-engine.ts`
    - 实现 `checkUserActivity()`：检测用户是否离开（无交互超过阈值时间）
    - 实现 `generateSummary()`：使用轻量级 LLM 调用生成摘要
    - 摘要内容包含：离开期间飞书消息要点、任务状态变更、即将到期任务、离开前工作上下文
    - 仅在用户确实离开超过阈值后才触发，避免频繁打扰
    - 离开期间无新事件时不生成摘要，仅恢复工作上下文
    - 支持用户配置触发阈值时间（默认 5 分钟）
    - _需求: 16.1-16.5_

  - [ ]* 18.2 编写 Away_Summary_Engine 单元测试
    - 测试离开检测、摘要生成条件、无事件时不生成
    - _需求: 16.1, 16.3, 16.5_

- [ ] 19. 实现 Voice Service 语音输入服务
  - [ ] 19.1 实现语音录制与转文本
    - 创建 `src/services/voice-service.ts`
    - 实现 `startRecording()` / `stopRecording()`：录音控制
    - 实现 `transcribe()`：语音转文本（调用 STT API）
    - 实现 `startStreamTranscription()`：流式语音识别，实时显示识别文本
    - 实现 `checkAvailability()`：检查语音输入可用性
    - 置信度低时标记 `needsConfirmation` 请求用户确认
    - _需求: 19.1-19.5_

  - [ ]* 19.2 编写 Voice Service 单元测试
    - 测试录音状态管理、转写结果处理、置信度判断
    - _需求: 19.1, 19.5_

- [ ] 20. 实现 PromptSuggestion 主动建议引擎
  - [ ] 20.1 实现建议生成与管理
    - 创建 `src/services/prompt-suggestion.ts`
    - 实现 `generateSuggestions()`：基于当前任务、即将到期任务、用户活动模式生成 1-3 条建议
    - 实现 `dismissSuggestion()`：记录用户忽略的建议，避免重复建议
    - 建议以非侵入性方式展示，用户可点击采纳或忽略
    - 用户点击建议时作为用户输入直接执行
    - _需求: 20.1-20.5_

  - [ ]* 20.2 编写 PromptSuggestion 单元测试
    - 测试建议生成、去重逻辑、忽略记录
    - _需求: 20.1, 20.4_

- [ ] 21. 实现数据安全与用户配置
  - [ ] 21.1 实现敏感信息加密存储
    - 创建 `src/core/security.ts`
    - 实现 AES-256-GCM 加密/解密工具函数
    - 对 API 密钥、认证令牌等敏感信息加密存储
    - 所有用户数据存储在本地设备，默认不上传外部服务器
    - 调用 LLM API 时仅发送必要上下文，避免发送完整数据库
    - _需求: 13.1, 13.2, 13.4_

  - [ ] 21.2 实现用户配置管理与数据删除
    - 创建 `src/core/user-config.ts`
    - 实现 UserConfig 的加载、保存、更新（持久化到 `~/.office-agent/config.json`）
    - 支持配置工作时间段、提醒激进程度、离开摘要阈值、飞书配置、工具启用状态
    - 实现数据删除：支持删除指定记忆条目或全部数据，确认后彻底删除不可恢复
    - _需求: 12.1, 12.3, 13.3, 13.5_

  - [ ]* 21.3 编写安全与配置单元测试
    - 测试加密/解密往返一致性、配置加载保存、数据删除
    - _需求: 13.4, 13.5, 12.1_

- [ ] 22. 集成与串联 — 将所有组件连接到 QueryEngine 主循环
  - [ ] 22.1 实现 Main_Agent 入口与组件装配
    - 创建 `src/main.ts` 作为系统入口
    - 初始化所有组件：QueryEngine、ToolRegistry（注册所有工具）、MemorySystem、ContextManager、SkillSystem、SubAgentManager、ReminderEngine、CronScheduler、BackgroundTaskManager、AwaySummaryEngine、VoiceService、PromptSuggestionEngine
    - 构建系统提示（system prompt）：包含 Agent 角色定义、可用工具描述、行为准则
    - 实现主对话循环：用户输入 → QueryEngine.submitMessage() → 流式输出响应
    - 集成离开摘要：用户回来时自动触发 AwaySummaryEngine
    - 集成主动建议：每轮对话结束后触发 PromptSuggestionEngine
    - 集成定时调度：启动 CronScheduler 调度循环
    - 集成提醒引擎：启动 ReminderEngine 定期检查
    - _需求: 11.1, 11.2, 11.3, 11.4, 1.1, 9.3_

  - [ ] 22.2 实现信息采集流程串联
    - 用户文本输入 → Main_Agent 解析提取关键信息 → 存入 Memory_System
    - 用户上传文件 → DocumentParser 解析 → 存入 Memory_System
    - 飞书消息/文档变更 → FeishuConnector 通知 → Main_Agent 提取信息 → 存入 Memory_System
    - 从飞书消息中识别新任务 → 创建 TaskItem 并标记来源
    - 用户指令含义模糊时主动询问澄清
    - _需求: 1.1, 2.2, 2.4, 4.2, 11.2_

  - [ ] 22.3 实现技能触发与子 Agent 委派串联
    - 斜杠命令或自然语言触发技能 → SkillSystem 加载并执行
    - Main_Agent 判断场景适合某技能时主动建议或自动调用
    - 讨论已有 Sub_Agent 的项目时自动委派给对应 Sub_Agent
    - 记忆冲突时以当前实际状态为准并更新过时记忆
    - _需求: 10.3, 10.4, 8.3, 3.7_

  - [ ]* 22.4 编写集成测试
    - 测试完整对话流程：用户输入 → 记忆检索 → LLM 调用 → 工具执行 → 记忆提取
    - 测试技能触发流程
    - 测试提醒触发流程
    - _需求: 11.1, 10.3, 5.1_

- [ ] 23. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点任务用于阶段性验证，确保增量开发的正确性
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 所有工具模块遵循统一的 Tool 接口，支持热插拔
- 数据全部存储在用户本地 `~/.office-agent/` 目录下
