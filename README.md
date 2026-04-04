# Office Agent

AI 办公助理，专为容易遗忘工作事项的用户设计。通过对话管理任务、项目、记忆，主动提醒，参考 Claude Code 架构。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key（阿里云百炼平台）
echo "DASHSCOPE_API_KEY=sk-你的key" > .env

# 2b.（可选）配置飞书机器人
# 在 .env 中追加：
# FEISHU_APP_ID=cli_xxx
# FEISHU_APP_SECRET=xxx

# 3. 启动
npm start
```

## 前置条件

- Node.js >= 18
- 阿里云百炼平台 API Key（https://bailian.console.aliyun.com/）
- （可选）飞书自建应用 App ID + App Secret（用于飞书机器人 + 日历 + 云文档）

## 全局安装

```bash
npm run build
npm install -g .
oa chat              # 交互式对话
oa ask "今天有什么任务"
```

## 使用方式

### CLI 交互模式（默认）

```bash
npm start
```

进入后直接用自然语言对话，Agent 会通过工具调用来执行操作。

### 单次提问

```bash
npx tsx src/cli/index.ts ask "帮我列出今天的待办"
```

### 其他命令

```bash
npx tsx src/cli/index.ts tasks     # 查看任务列表
npx tsx src/cli/index.ts config    # 查看配置
npx tsx src/cli/index.ts usage     # 查看 token 用量
npx tsx src/cli/index.ts -h        # 帮助
```

## 对话中的斜杠命令

所有命令在 CLI 和飞书中行为一致：

| 命令 | 说明 |
|------|------|
| `/tasks` | 查看任务列表 |
| `/remind <内容>` | 创建提醒 |
| `/daily-report` | 生成每日工作汇报 |
| `/weekly-report` | 生成周报 |
| `/meeting-notes` | 整理会议纪要 |
| `/task-breakdown` | 拆解大任务 |
| `/feishu-sync` | 同步飞书状态 |
| `/project` | 查看项目列表 |
| `/memory <关键词>` | 搜索记忆 |
| `/cron` | 查看定时任务 |
| `/usage` | 查看 token 用量 |
| `/usage detail` | 查看详细用量（按模型/环节） |
| `/db tasks` | 直接查数据库任务（不经过 LLM） |
| `/db projects` | 直接查数据库项目 |
| `/db memories` | 直接查数据库记忆 |
| `/reset [子命令]` | 清空数据（tasks/memories/projects/sessions/usage/config/cron/trash） |
| `/undo` | 从回收站恢复记忆 |
| `/help` | 显示帮助 |

每次 Agent 回复后会显示 `[本轮调用了 N 个工具]` 或 `[本轮未调用工具]`，帮你判断回答是否基于真实数据。

## 11 个内置工具

Agent 通过原生 Function Calling 调用这些工具：

| 工具 | 功能 | 状态 |
|------|------|------|
| TaskManager | 任务 CRUD、状态追踪、逾期检测、任务拆解 | ✅ 完整 |
| SubAgentTool | 项目管理（创建/归档/委派） | ✅ 完整 |
| MemoryTool | 长期记忆存储/搜索/删除 | ✅ 完整 |
| ReminderTool | 提醒管理 | ✅ 完整 |
| CronTool | 定时任务（cron 表达式） | ✅ 完整 |
| ConfigTool | 通过对话修改配置（提醒时间、工作时间等） | ✅ 完整 |
| FeishuConnector | 飞书云文档读取、文件夹浏览、消息发送 | ✅ 真实 API |
| CalendarTool | 飞书日历日程创建/查询/删除 | ✅ 真实 API |
| EmailTool | 邮件发送 | 🔲 stub |
| DocumentParser | 文档解析（飞书/Excel/Word/网页） | 🔲 stub |
| BackgroundTaskTool | 后台任务管理 | ✅ 完整 |

## 主动提醒系统

Agent 会在后台自动检查并推送提醒，不需要用户主动询问：

- 每日待办清单（默认工作日 9:00）
- 每周工作总结（默认周五 17:00）
- 截止日期紧急提醒（< 24h）和预警（< 3 天）
- 智能提醒：延迟性表述检测、承诺追踪、项目停滞、遗忘任务
- 用户创建的定时提醒

CLI 中提醒直接打印到终端，飞书中通过消息 API 主动推送。

通过对话修改提醒配置：告诉 Agent "把每日提醒改到早上8点" 即可。

## 飞书机器人（WebSocket 长连接）

通过飞书机器人与 Office Agent 对话，不需要公网 IP、域名或服务器。

### 配置步骤

1. 登录 [飞书开放平台](https://open.feishu.cn/)，创建「企业自建应用」
2. 开启「机器人」能力
3. 事件订阅 → 选择「长连接」→ 添加 `im.message.receive_v1`
4. 权限管理中申请（按需）：

| 权限 | 用途 |
|------|------|
| `im:message` | 收发消息（必需） |
| `docx:document:readonly` | 读取新版云文档 |
| `drive:drive:readonly` | 浏览云空间文件夹 |
| `calendar:calendar` | 读写日历日程 |
| `task:task` | 读写飞书任务 |
| `contact:user.base:readonly` | 读取用户基本信息 |

5. 在 `.env` 中添加 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`
6. `npm run feishu` 启动

### 功能特性

- 群聊中 @机器人 触发对话
- 单聊直接发消息（需开通单聊权限）
- 支持语音消息（自动转文字，使用 DashScope Paraformer STT）
- 每个飞书用户独立会话和数据目录，重启后自动恢复
- 主动推送提醒（截止日期、每日待办等）
- 读取飞书云文档内容，自动提取项目信息存入记忆

## 5 个内置技能

通过斜杠命令触发，定义在 `src/skills/bundled/` 下：

| 技能 | 模式 | 说明 |
|------|------|------|
| `/daily-report` | inline | 每日工作汇报 |
| `/meeting-notes` | inline | 会议纪要整理 |
| `/task-breakdown` | fork | 大任务拆解 |
| `/feishu-sync` | inline | 飞书状态同步 |
| `/weekly-report` | fork | 周报生成 |

自定义技能：在 `~/.office-agent/skills/` 下创建 SKILL.md 文件即可。

## 数据存储

所有数据存在本地 `~/.office-agent/`，不上传任何外部服务器：

```
~/.office-agent/
├── tasks.json              # 任务数据
├── token-usage.json        # Token 用量统计
├── config.json             # 用户配置（可通过对话修改）
├── cron-tasks.json         # 定时任务
├── last-session.txt        # CLI 最近会话 ID
├── last-session-feishu-*.txt  # 飞书用户会话 ID（按用户隔离）
├── memdir/                 # 记忆系统
│   ├── MEMORY.md           # 记忆索引（自动维护）
│   ├── auto/               # 自动提取的记忆
│   ├── decisions/          # 决策类记忆
│   ├── preferences/        # 偏好类记忆
│   ├── colleagues/         # 同事信息
│   └── projects/           # 项目上下文记忆
├── agents/                 # 项目（Sub-Agent）
├── sessions/               # 会话历史
├── skills/                 # 用户自定义技能
├── logs/                   # 日志文件（JSON lines 格式）
└── trash/                  # 回收站（/undo 可恢复）
```

## 项目源码结构

```
src/
├── cli/                        # CLI 入口
│   ├── index.ts                # 主入口（参数解析、子命令路由）
│   ├── agent-factory.ts        # Agent 工厂（创建 DashScope LLM + Agent）
│   ├── env.ts                  # .env 加载器
│   └── commands/
│       ├── chat.ts             # 交互式对话
│       ├── ask.ts              # 单次提问
│       ├── tasks.ts            # 任务列表
│       ├── config.ts           # 配置查看
│       └── usage.ts            # Token 用量
│
├── core/                       # 核心引擎
│   ├── query-engine.ts         # 主循环（LLM 调用 + 工具执行 + 记忆注入）
│   ├── context-manager.ts      # 上下文压缩（auto-compact）
│   ├── memory-system.ts        # 三层记忆（索引 + side query + grep）
│   ├── tool-system.ts          # 可插拔工具框架（Tool 接口 + Registry）
│   ├── skill-system.ts         # 技能系统（SKILL.md 加载 + 执行）
│   ├── sub-agent-manager.ts    # 动态子 Agent（项目级隔离）
│   ├── dashscope-llm.ts        # 百炼 LLM 客户端（流式 + Function Calling）
│   ├── llm-client.ts           # LLM 接口定义
│   ├── schema-utils.ts         # Zod v4 → JSON Schema 转换
│   ├── token-tracker.ts        # Token 用量统计（按模型/环节/天）
│   ├── session-store.ts        # 会话持久化（支持多通道隔离）
│   ├── security.ts             # AES-256-GCM 加密
│   ├── user-config.ts          # 用户配置管理
│   ├── slash-command.ts        # 斜杠命令解析（统一路由）
│   ├── logger.ts               # 结构化日志（级别 + 文件输出）
│   └── errors.ts               # 统一错误类型（AppError + Errors 工厂）
│
├── services/                   # 服务层
│   ├── reminder-engine.ts      # 提醒引擎（定时/截止日期/智能判断）
│   ├── reminder-loop.ts        # 提醒后台循环（30s 检查 + 推送）
│   ├── notification-service.ts # 统一通知通道（CLI/飞书注册回调）
│   ├── cron-scheduler.ts       # 定时调度器（cron 表达式 + 持久化）
│   ├── background-task-manager.ts  # 后台任务
│   ├── away-summary-engine.ts  # 离开摘要
│   ├── prompt-suggestion.ts    # 主动建议
│   └── speech-to-text.ts       # 语音转文字（DashScope Paraformer）
│
├── tools/                      # 11 个工具模块
│   ├── TaskManager/            # 任务管理
│   ├── SubAgentTool/           # 项目管理
│   ├── MemoryTool/             # 记忆操作
│   ├── ReminderTool/           # 提醒操作
│   ├── CronTool/               # 定时任务
│   ├── ConfigTool/             # 配置修改（通过对话）
│   ├── FeishuConnector/        # 飞书连接器（真实 API）
│   ├── CalendarTool/           # 飞书日历（真实 API）
│   ├── EmailTool/              # 邮件
│   ├── DocumentParser/         # 文档解析
│   └── BackgroundTaskTool/     # 后台任务
│
├── skills/bundled/             # 5 个内置技能
├── types/index.ts              # 核心类型定义
├── main.ts                     # 组件装配 + 消息处理流程
│
└── server/                     # 飞书机器人
    └── feishu-bot.ts           # 飞书机器人（WebSocket 长连接）
```

## 支持的模型

通过 `.env` 中的 `DASHSCOPE_MODEL` 配置：

| 模型 | 说明 |
|------|------|
| `qwen-plus` | 默认，性价比高 |
| `qwen-max` | 更强 |
| `qwen-turbo` | 更快更便宜 |

运行时指定：`npx tsx src/cli/index.ts chat -m qwen-max`

## 开发

```bash
npm test          # 运行测试（84 个）
npm run typecheck # 类型检查
npm run build     # 编译 TypeScript
```

## 架构参考

参考 Claude Code 的架构模式：
- QueryEngine 主循环（async generator + 多轮工具调用）
- 原生 Function Calling（非 prompt-based）
- 三层记忆系统（MEMORY.md 索引 + LLM side query + 工具搜索）
- 可插拔 Tool 系统（11 个工具，Zod schema 自动转 JSON Schema）
- SKILL.md 技能定义（inline/fork 两种执行模式）
- 上下文自动压缩
- 会话持久化（多通道隔离：CLI / 飞书各用户独立）
- 统一通知架构（NotificationService + ReminderLoop）
- 统一命令路由（slash-command.ts，CLI/飞书/Web 行为一致）
- 结构化日志 + 统一错误处理
