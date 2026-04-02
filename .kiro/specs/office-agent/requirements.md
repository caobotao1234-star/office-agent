# 需求文档：Office Agent（办公智能助理）

## 简介

Office Agent 是一个面向办公场景的 AI Agent 系统，定位为用户的私人助理/秘书。该系统专门为有 ADHD 症状或容易遗忘工作事项的用户设计，核心解决工作中信息管理混乱和任务遗忘的问题。系统参考 Claude Code 的架构模式（Tool 系统、Memory 系统、Context 管理、Plugin 架构、Sub-Agent 机制），将场景从编程替换为办公，提供信息采集、任务管理、主动提醒和动态子 Agent 管理等能力。

## 术语表

- **Office_Agent**: 办公智能助理系统的总称，包含核心引擎和所有子系统
- **Main_Agent**: 主助理 Agent，负责与用户直接交互、管理信息和任务、调度子 Agent
- **Sub_Agent**: 由 Main_Agent 动态创建的项目级子 Agent，专注于某个特定项目的上下文管理，项目结束后自动注销
- **Memory_System**: 记忆系统，负责持久化存储用户信息、任务、偏好、项目上下文等
- **Tool_System**: 工具系统，提供可插拔的能力模块（如飞书对接、邮件发送、日历管理等）
- **Reminder_Engine**: 提醒引擎，负责定时提醒、截止日期提醒和智能判断提醒
- **Task_Item**: 任务条目，包含描述、状态、截止日期、优先级、所属项目等属性
- **Information_Entry**: 信息条目，从用户输入或外部系统采集的结构化信息单元
- **Feishu_Connector**: 飞书连接器，负责与飞书开放平台 API 对接的 Tool 模块
- **Document_Parser**: 文档解析器，负责解析用户上传的各类文档（飞书云文档、Excel、Word 等）
- **Skill_System**: 技能系统，提供可扩展的预设行为模式（Skill），每个 Skill 是一个 Markdown 定义文件（含 YAML frontmatter 元数据），定义了 Agent 在特定场景下的行为指令、可用工具和执行模式
- **Skill_Item**: 技能条目，一个独立的 Skill 定义，包含名称、描述、触发条件、允许使用的工具列表、执行模式（inline/fork）等属性
- **Context_Manager**: 上下文管理器，负责管理 LLM 对话上下文窗口，包括自动压缩、记忆注入、token 预算控制
- **Cron_Scheduler**: 定时调度器，支持 cron 表达式定义的定时任务和一次性延时任务，可在后台自动执行 Agent 任务
- **Away_Summary_Engine**: 离开摘要引擎，当用户离开一段时间后回来时，自动生成期间发生的事项摘要
- **Background_Task**: 后台任务，可在不阻塞主对话的情况下异步执行的耗时任务（如批量文档同步、大型报告生成）

## 需求

### 需求 1：信息采集 — 用户主动输入

**用户故事：** 作为一个容易遗忘工作事项的用户，我希望能通过对话或上传文件的方式将工作信息告诉 Agent，以便 Agent 帮我记录和管理这些信息。

#### 验收标准

1. WHEN 用户通过对话输入文本信息, THE Main_Agent SHALL 解析文本内容并提取关键信息（任务、日期、人物、事项）存入 Memory_System
2. WHEN 用户上传飞书云文档, THE Document_Parser SHALL 解析文档内容并将结构化信息存入 Memory_System
3. WHEN 用户上传 Excel 文件, THE Document_Parser SHALL 解析表格数据并将结构化信息存入 Memory_System
4. WHEN 用户上传 Word 文件, THE Document_Parser SHALL 解析文档内容并将结构化信息存入 Memory_System
5. WHEN 用户上传网页数据, THE Document_Parser SHALL 提取网页正文内容并将结构化信息存入 Memory_System
6. IF 文档格式无法识别, THEN THE Document_Parser SHALL 返回明确的错误提示并建议用户转换为支持的格式

### 需求 2：信息采集 — 自动监控外部系统

**用户故事：** 作为一个经常在飞书上协作的用户，我希望 Agent 能自动监控我的飞书文档和消息变更，以便我不会遗漏重要信息。

#### 验收标准

1. WHILE Feishu_Connector 处于启用状态, THE Feishu_Connector SHALL 通过飞书事件订阅机制监听用户指定的云文档空间中的文档变更事件
2. WHEN 监控范围内的飞书云文档发生内容变更, THE Feishu_Connector SHALL 获取变更内容并通知 Main_Agent 进行信息提取
3. WHILE Feishu_Connector 处于启用状态, THE Feishu_Connector SHALL 监听用户的飞书消息（与同事的对话信息）
4. WHEN 收到新的飞书消息, THE Main_Agent SHALL 分析消息内容并提取其中的任务、承诺、截止日期等关键信息
5. IF 飞书 API 连接中断, THEN THE Feishu_Connector SHALL 记录断连时间并在恢复后自动重连并补拉断连期间的变更
6. THE Main_Agent SHALL 允许用户配置监控范围（指定文档空间、文件夹、聊天群组）

### 需求 3：记忆系统

**用户故事：** 作为用户，我希望 Agent 能像一个真正的秘书一样记住我所有的工作上下文，以便在任何时候都能给我准确的信息和建议。

#### 验收标准

1. THE Memory_System SHALL 采用分层存储架构：持久化层（全量数据存储在本地磁盘）和上下文注入层（按需检索相关记忆注入 LLM 上下文）
2. THE Memory_System 持久化层 SHALL 存储以下类型的记忆：用户偏好、任务记录、项目上下文、工作关系（同事信息）、历史对话摘要
3. WHEN 用户与 Main_Agent 进行对话, THE Memory_System SHALL 自动提取并存储对话中的关键信息到持久化层
4. WHEN Main_Agent 需要回答用户问题或做出建议, THE Memory_System 上下文注入层 SHALL 根据当前对话意图进行相关性检索（关键词匹配 + 语义相似度），仅将相关的记忆片段注入 LLM 上下文，而非加载全量记忆
5. THE Memory_System SHALL 为每条记忆条目生成摘要和标签索引，以支持高效的相关性检索
6. THE Memory_System SHALL 支持按项目、时间、类型、标签对记忆进行组织和检索
7. WHEN 记忆内容与当前实际状态产生冲突, THE Main_Agent SHALL 以当前实际状态为准并更新过时的记忆
8. THE Memory_System SHALL 为每条记忆记录来源（用户输入、飞书文档、飞书消息等）和时间戳
9. THE Memory_System SHALL 对记忆条目维护访问频率和最近访问时间，用于优化检索排序
10. WHEN 一轮对话结束后, THE Memory_System SHALL 自动从对话内容中提取值得长期记忆的信息（如新发现的用户偏好、重要决策、关键结论），无需用户手动指示"记住这个"
11. THE Memory_System 上下文注入层 SHALL 使用轻量级 LLM 调用（side query）对记忆清单进行相关性判断，从全量记忆中选出最多 5 条与当前对话最相关的记忆注入上下文


### 需求 4：任务管理

**用户故事：** 作为一个同时处理多个项目的用户，我希望 Agent 能帮我管理所有大小任务，包括记录、拆解和状态追踪，以便我不会遗漏任何工作事项。

#### 验收标准

1. WHEN 用户告知一个新任务, THE Main_Agent SHALL 创建 Task_Item 并记录描述、截止日期、优先级、所属项目等属性
2. WHEN Main_Agent 从飞书消息或文档中识别到新任务, THE Main_Agent SHALL 创建 Task_Item 并标记信息来源
3. WHEN 用户提交一个大型任务, THE Main_Agent SHALL 生成任务拆解方案并提交给用户确认
4. WHEN 用户收到任务拆解方案, THE Main_Agent SHALL 等待用户确认或修改后才将子任务正式纳入管理
5. THE Main_Agent SHALL 追踪每个 Task_Item 的状态（待开始、进行中、已完成、已逾期、已取消）
6. WHEN Task_Item 的截止日期已过且状态未标记为已完成, THE Main_Agent SHALL 将该 Task_Item 状态更新为已逾期
7. THE Main_Agent SHALL 支持用户随时查询任务列表，并按项目、状态、优先级、截止日期进行筛选

### 需求 5：主动提醒 — 定时提醒

**用户故事：** 作为用户，我希望每天开始工作时能收到今日待办清单，以便我对当天的工作有清晰的规划。

#### 验收标准

1. THE Reminder_Engine SHALL 支持用户配置每日提醒时间（默认为工作日早上 9:00）
2. WHEN 到达每日提醒时间, THE Reminder_Engine SHALL 生成当日待办清单，包含今日截止的任务、进行中的任务、以及需要跟进的事项
3. THE Reminder_Engine SHALL 支持用户配置每周总结时间（默认为每周五下午 5:00）
4. WHEN 到达每周总结时间, THE Reminder_Engine SHALL 生成本周工作总结，包含已完成任务、未完成任务、下周待办事项
5. THE Reminder_Engine SHALL 允许用户自定义提醒频率和时间

### 需求 6：主动提醒 — 截止日期提醒

**用户故事：** 作为用户，我希望在任务快到截止日期时收到提醒，以便我能及时完成任务避免逾期。

#### 验收标准

1. WHEN Task_Item 的截止日期距当前时间不足 24 小时且任务状态为待开始或进行中, THE Reminder_Engine SHALL 向用户发送紧急提醒
2. WHEN Task_Item 的截止日期距当前时间不足 3 天且任务状态为待开始, THE Reminder_Engine SHALL 向用户发送预警提醒
3. THE Reminder_Engine SHALL 允许用户为每个 Task_Item 自定义提醒提前量
4. IF Task_Item 已标记为已完成, THEN THE Reminder_Engine SHALL 取消该任务的所有待发送提醒

### 需求 7：主动提醒 — 智能判断提醒

**用户故事：** 作为一个有 ADHD 症状的用户，我希望 Agent 能智能判断我可能遗忘的事项并主动提醒我，以便减少因遗忘导致的工作失误。

#### 验收标准

1. WHEN 用户在对话中提到"稍后做"、"回头处理"、"明天再说"等延迟性表述, THE Main_Agent SHALL 创建跟进提醒并在适当时间提醒用户
2. WHEN 用户在飞书消息中对同事做出承诺（如"我来处理"、"我发给你"）, THE Main_Agent SHALL 创建承诺追踪条目并在合理时间内检查是否已兑现
3. WHEN 某个进行中的项目超过用户设定的天数没有任何更新, THE Main_Agent SHALL 提醒用户关注该项目进展
4. WHEN Main_Agent 检测到用户可能遗忘了某个任务（基于任务创建时间、优先级、用户近期活动模式）, THE Main_Agent SHALL 生成智能提醒
5. THE Main_Agent SHALL 在智能提醒中说明提醒原因，帮助用户理解为什么收到该提醒

### 需求 8：动态子 Agent 管理

**用户故事：** 作为同时参与多个项目的用户，我希望每个项目有专属的 Agent 来管理项目上下文，以便不同项目的信息不会混淆。

#### 验收标准

1. WHEN Main_Agent 判断某个项目需要独立的上下文管理, THE Main_Agent SHALL 创建一个专属的 Sub_Agent 并初始化该项目的上下文
2. THE Sub_Agent SHALL 继承 Main_Agent 的核心能力（信息管理、任务追踪、提醒），但上下文限定在所属项目范围内
3. WHEN 用户与 Main_Agent 讨论某个已有 Sub_Agent 的项目, THE Main_Agent SHALL 将相关请求委派给对应的 Sub_Agent 处理
4. WHEN 项目被用户标记为已结束, THE Main_Agent SHALL 将 Sub_Agent 的关键信息归档到 Memory_System 后注销该 Sub_Agent
5. THE Main_Agent SHALL 向用户展示当前活跃的 Sub_Agent 列表及各项目状态概览
6. WHEN 创建 Sub_Agent 时, THE Main_Agent SHALL 告知用户并等待用户确认


### 需求 9：工具系统（可插拔能力模块）

**用户故事：** 作为用户，我希望 Agent 不仅能记录和提醒，还能在我授权后帮我执行一些操作（如发消息、创建日程），以便进一步减轻我的工作负担。

#### 验收标准

1. THE Tool_System SHALL 采用插件化架构，每个外部系统对接能力作为独立的 Tool 模块
2. THE Tool_System SHALL 至少预留以下 Tool 接口：飞书消息发送、飞书日程创建、邮件发送
3. WHEN 用户启用某个 Tool 模块, THE Tool_System SHALL 加载该模块并使其能力对 Main_Agent 可用
4. WHEN 用户未启用某个 Tool 模块, THE Main_Agent SHALL 在需要该能力时提示用户可以启用对应模块
5. WHEN Main_Agent 需要通过 Tool 执行操作（如发送消息、创建日程）, THE Main_Agent SHALL 先向用户展示操作内容并获得用户确认后再执行
6. IF Tool 执行操作失败, THEN THE Tool_System SHALL 向用户报告失败原因并建议手动操作方式

### 需求 10：技能系统（可扩展行为模式）

**用户故事：** 作为用户，我希望 Agent 具备一系列预设的办公技能（如生成日报、整理会议纪要、拆解任务），并且我可以自定义新技能来扩展 Agent 的能力，以便 Agent 能适应我的个性化工作流程。

#### 验收标准

1. THE Skill_System SHALL 支持三种技能来源：内置技能（bundled，系统预装）、用户自定义技能（用户创建的 SKILL.md 文件）、远程技能（通过 MCP 协议加载）
2. THE Skill_System SHALL 预装以下内置技能：每日工作汇报生成、会议纪要整理、大任务拆解、飞书文档状态同步、周报生成
3. WHEN 用户通过斜杠命令（如 /daily-report）或自然语言触发某个技能, THE Main_Agent SHALL 加载该 Skill_Item 的完整指令并按其定义执行
4. WHEN Main_Agent 判断当前场景适合使用某个技能（基于 Skill_Item 的 when_to_use 字段）, THE Main_Agent SHALL 主动建议或自动调用该技能
5. THE Skill_Item SHALL 使用 Markdown + YAML frontmatter 格式定义，frontmatter 包含：名称、描述、何时使用（when_to_use）、允许的工具列表（allowed_tools）、执行模式（inline 在当前上下文执行 / fork 创建独立子 Agent 执行）
6. THE Skill_System SHALL 支持用户在指定目录下创建自定义 Skill_Item，系统自动发现并加载
7. WHEN Skill_Item 的执行模式为 fork, THE Skill_System SHALL 创建独立的子 Agent 执行该技能，执行完成后将结果返回给 Main_Agent
8. THE Skill_System SHALL 支持技能的参数化调用（如 /task-breakdown "完成Q2产品规划"），通过 $ARGUMENTS 变量替换传入参数

### 需求 11：对话与交互

**用户故事：** 作为用户，我希望能通过自然语言与 Agent 交流，像和真人秘书对话一样自然，以便降低使用门槛。

#### 验收标准

1. THE Main_Agent SHALL 支持自然语言对话，理解用户的意图并做出相应响应
2. WHEN 用户的指令含义模糊, THE Main_Agent SHALL 主动询问澄清而非猜测执行
3. THE Main_Agent SHALL 维护对话上下文，在同一会话中理解指代和省略
4. WHEN 用户查询任务或信息, THE Main_Agent SHALL 以清晰、结构化的方式呈现结果
5. THE Main_Agent SHALL 支持用户通过斜杠命令（如 /tasks、/remind、/project）快速访问常用功能
6. THE Main_Agent SHALL 记录会话历史，支持用户回顾之前的对话内容

### 需求 12：系统配置与个性化

**用户故事：** 作为用户，我希望能根据自己的工作习惯配置 Agent 的行为，以便 Agent 的工作方式与我的节奏匹配。

#### 验收标准

1. THE Office_Agent SHALL 支持用户配置工作时间段（默认为工作日 9:00-18:00）
2. WHILE 当前时间在用户配置的非工作时间段内, THE Reminder_Engine SHALL 暂停发送非紧急提醒
3. THE Office_Agent SHALL 支持用户配置提醒的激进程度（低频/标准/高频）
4. THE Memory_System SHALL 根据用户的使用习惯自动学习并优化信息提取和提醒策略
5. THE Office_Agent SHALL 支持导出所有用户数据（任务、记忆、配置）为标准格式

### 需求 13：数据安全与隐私

**用户故事：** 作为用户，我希望我的工作信息得到安全保护，以便我可以放心地将敏感工作信息交给 Agent 管理。

#### 验收标准

1. THE Office_Agent SHALL 将所有用户数据存储在用户本地设备上，默认不上传到外部服务器
2. WHEN 调用 LLM API 处理用户信息, THE Office_Agent SHALL 仅发送必要的上下文信息，避免发送完整的用户数据库
3. THE Office_Agent SHALL 支持用户随时删除指定的记忆条目或全部数据
4. THE Office_Agent SHALL 对存储的敏感信息（如 API 密钥、认证令牌）进行加密存储
5. IF 用户请求删除数据, THEN THE Office_Agent SHALL 在确认后彻底删除相关数据且不可恢复

### 需求 14：信息序列化与反序列化

**用户故事：** 作为开发者，我希望系统的数据存储格式有明确的序列化/反序列化规范，以便数据的持久化和恢复是可靠的。

#### 验收标准

1. THE Memory_System SHALL 使用 Markdown + YAML frontmatter 格式存储记忆条目
2. THE Memory_System SHALL 使用 JSON 格式存储任务数据和系统配置
3. FOR ALL 有效的 Task_Item 对象, 序列化为 JSON 后再反序列化 SHALL 产生与原始对象等价的 Task_Item（往返一致性）
4. FOR ALL 有效的 Information_Entry 对象, 序列化后再反序列化 SHALL 产生与原始对象等价的 Information_Entry（往返一致性）
5. THE Document_Parser SHALL 为每种支持的文档格式提供解析器，将文档内容转换为统一的 Information_Entry 格式
6. THE Document_Parser SHALL 提供格式化输出器，将 Information_Entry 转换回可读的文本格式

### 需求 15：上下文窗口管理与自动压缩

**用户故事：** 作为一个经常和 Agent 长时间对话的用户，我希望 Agent 不会因为对话太长而"失忆"或变慢，以便我可以在一个会话中持续工作而不用担心上下文丢失。

#### 验收标准

1. THE Context_Manager SHALL 持续监控当前对话的 token 使用量，并在接近上下文窗口上限时触发自动压缩
2. WHEN 自动压缩触发, THE Context_Manager SHALL 将历史对话内容压缩为结构化摘要，保留关键信息（任务状态变更、重要决策、用户指令）同时释放 token 空间
3. THE Context_Manager SHALL 在压缩过程中将值得长期保留的信息自动提取到 Memory_System 持久化层，避免压缩导致信息永久丢失
4. THE Context_Manager SHALL 为不同类型的上下文内容分配 token 预算（系统提示、记忆注入、对话历史、工具结果），确保关键信息不被挤出
5. WHEN 压缩完成后, THE Main_Agent SHALL 能够继续正常对话，用户无需感知压缩过程

### 需求 16：离开摘要

**用户故事：** 作为一个有 ADHD 症状的用户，我经常会离开工位一段时间后忘记之前在做什么，我希望 Agent 能在我回来时告诉我"你不在的时候发生了什么"，以便我能快速恢复工作状态。

#### 验收标准

1. WHEN 用户离开超过 5 分钟后重新回到系统, THE Away_Summary_Engine SHALL 自动生成一份"你不在的时候"摘要
2. THE Away_Summary_Engine 生成的摘要 SHALL 包含：离开期间收到的飞书消息要点、任务状态变更、即将到期的任务提醒、以及离开前正在进行的工作上下文
3. THE Away_Summary_Engine SHALL 仅在用户确实离开（无交互）超过阈值时间后才触发，避免频繁打扰
4. THE Away_Summary_Engine SHALL 允许用户配置触发阈值时间（默认 5 分钟）
5. IF 离开期间没有任何新事件发生, THEN THE Away_Summary_Engine SHALL 不生成摘要，仅恢复离开前的工作上下文

### 需求 17：定时调度任务

**用户故事：** 作为用户，我希望能让 Agent 定时自动执行一些重复性工作（如每天早上拉取飞书更新、每周五生成周报），以便减少我的手动操作。

#### 验收标准

1. THE Cron_Scheduler SHALL 支持用户通过自然语言创建定时任务（如"每天早上9点帮我看看飞书有什么新消息"）
2. THE Cron_Scheduler SHALL 支持标准 cron 表达式定义执行时间，使用用户本地时区
3. THE Cron_Scheduler SHALL 支持两种任务类型：一次性任务（执行一次后自动删除）和循环任务（按 cron 表达式重复执行）
4. WHEN 定时任务触发时, THE Cron_Scheduler SHALL 将任务 prompt 注入 Main_Agent 的消息队列，由 Main_Agent 在空闲时执行
5. THE Cron_Scheduler SHALL 支持将定时任务持久化到磁盘（durable 模式），使任务在系统重启后自动恢复
6. THE Cron_Scheduler SHALL 支持用户查看、修改和删除已创建的定时任务
7. WHEN 系统在定时任务应触发时处于离线状态, THE Cron_Scheduler SHALL 在恢复后补执行错过的一次性任务

### 需求 18：后台任务执行

**用户故事：** 作为用户，我希望一些耗时的操作（如批量同步文档、生成大型报告）能在后台执行，不影响我和 Agent 的正常对话，以便我可以继续其他工作。

#### 验收标准

1. THE Main_Agent SHALL 支持将耗时任务（如批量文档同步、大型报告生成）派发为 Background_Task 在后台异步执行
2. WHILE Background_Task 正在执行, THE Main_Agent SHALL 允许用户继续正常对话，不阻塞主交互
3. THE Main_Agent SHALL 向用户展示当前正在执行的 Background_Task 列表及其状态（pending、running、completed、failed）
4. WHEN Background_Task 执行完成, THE Main_Agent SHALL 通知用户并展示执行结果摘要
5. THE Main_Agent SHALL 支持用户随时取消正在执行的 Background_Task
6. IF Background_Task 执行失败, THEN THE Main_Agent SHALL 向用户报告失败原因并建议重试或手动处理

### 需求 19：语音输入

**用户故事：** 作为一个有 ADHD 症状的用户，我有时候打字会觉得很费力，我希望能直接用语音告诉 Agent 我的需求，以便降低使用门槛。

#### 验收标准

1. THE Office_Agent SHALL 支持用户通过语音输入与 Main_Agent 交互
2. WHEN 用户发送语音输入, THE Office_Agent SHALL 将语音转换为文本后交给 Main_Agent 处理
3. THE Office_Agent SHALL 支持用户通过快捷键一键开启/关闭语音输入模式
4. THE Office_Agent SHALL 支持流式语音识别，用户说话时实时显示识别文本
5. IF 语音识别结果置信度较低, THEN THE Office_Agent SHALL 向用户展示识别结果并请求确认

### 需求 20：主动建议与下一步提示

**用户故事：** 作为用户，我希望 Agent 能在对话间隙主动建议我下一步可以做什么，以便我不会陷入"不知道该干什么"的状态。

#### 验收标准

1. WHEN 一轮对话结束且 Main_Agent 处于空闲状态, THE Main_Agent SHALL 基于当前上下文生成 1-3 条下一步行动建议
2. THE Main_Agent 生成的建议 SHALL 基于：当前进行中的任务、即将到期的任务、用户近期的工作模式、以及未处理的信息
3. THE Main_Agent SHALL 将建议以非侵入性的方式展示（如输入框下方的提示气泡），用户可以点击采纳或忽略
4. THE Main_Agent SHALL 避免重复建议用户已经忽略过的相同建议
5. WHEN 用户点击某条建议, THE Main_Agent SHALL 将该建议作为用户输入直接执行
