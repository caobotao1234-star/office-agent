# 🤖 Office Agent — AI 办公助理

专为有 ADHD 症状或容易遗忘工作事项的用户设计的办公 AI Agent。帮你管理任务、记忆工作信息、主动提醒，像一个真人秘书一样工作。

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) >= 18（推荐 20+）
- 阿里云百炼平台 API Key（[申请地址](https://bailian.console.aliyun.com/)）

### 安装

```bash
# 1. 克隆项目
git clone <你的仓库地址>
cd office-agent

# 2. 安装依赖
npm install

# 3. 配置 API Key
#    在项目根目录创建 .env 文件：
echo "DASHSCOPE_API_KEY=sk-你的key" > .env
echo "DASHSCOPE_MODEL=qwen-plus" >> .env
```

### 运行

```bash
# 交互式对话（推荐）
npm start

# 单次提问
npx tsx src/cli/index.ts ask "帮我列出今天的待办"

# 查看任务列表
npx tsx src/cli/index.ts tasks

# 查看配置
npx tsx src/cli/index.ts config

# 帮助
npx tsx src/cli/index.ts --help
```

### 验证安装

```bash
# 跑测试，确认一切正常
npm test

# 检查 API 连通性
npx tsx src/api-test.ts
```

## 可用命令

交互模式下输入 `/help` 查看所有命令：

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

## 项目结构

```
src/
├── cli/                    # CLI 入口和子命令
│   ├── index.ts            # 主入口（解析参数、路由子命令）
│   └── commands/           # chat / ask / tasks / config
├── core/                   # 核心引擎
│   ├── query-engine.ts     # 主循环（LLM 调用 + 工具执行）
│   ├── context-manager.ts  # 上下文窗口管理 + 自动压缩
│   ├── memory-system.ts    # 分层记忆系统
│   ├── tool-system.ts      # 可插拔工具框架
│   ├── skill-system.ts     # 技能系统（SKILL.md）
│   ├── sub-agent-manager.ts # 动态子 Agent
│   ├── dashscope-llm.ts    # 百炼平台 LLM 客户端
│   ├── security.ts         # AES-256-GCM 加密
│   └── user-config.ts      # 用户配置管理
├── services/               # 服务层
│   ├── reminder-engine.ts  # 提醒引擎（定时/截止日期/智能）
│   ├── cron-scheduler.ts   # 定时调度器
│   ├── background-task-manager.ts
│   ├── away-summary-engine.ts  # 离开摘要
│   ├── voice-service.ts    # 语音输入（接口层）
│   └── prompt-suggestion.ts # 主动建议
├── tools/                  # 工具模块（每个独立目录）
│   ├── TaskManager/        # 任务管理
│   ├── FeishuConnector/    # 飞书连接器
│   ├── DocumentParser/     # 文档解析
│   ├── EmailTool/          # 邮件
│   ├── CalendarTool/       # 日程
│   ├── MemoryTool/         # 记忆操作
│   ├── ReminderTool/       # 提醒操作
│   ├── CronTool/           # 定时任务操作
│   ├── BackgroundTaskTool/ # 后台任务操作
│   └── SubAgentTool/       # 子 Agent 操作
├── skills/bundled/         # 内置技能
│   ├── daily-report.md
│   ├── weekly-report.md
│   ├── meeting-notes.md
│   ├── task-breakdown.md
│   └── feishu-sync.md
├── types/index.ts          # 核心类型定义
└── main.ts                 # 组件装配 + 消息处理流程
```

## 数据存储

所有数据存储在本地 `~/.office-agent/` 目录下，不上传到任何外部服务器：

```
~/.office-agent/
├── config.json         # 用户配置
├── tasks.json          # 任务数据
├── cron-tasks.json     # 定时任务
├── memdir/             # 记忆系统（Markdown 文件）
├── agents/             # 子 Agent 数据
└── skills/             # 用户自定义技能
```

## 支持的模型

通过 `.env` 中的 `DASHSCOPE_MODEL` 配置，支持百炼平台所有模型：

- `qwen-plus`（默认，性价比高）
- `qwen-max`（更强）
- `qwen-turbo`（更快更便宜）

也可以在运行时指定：`npx tsx src/cli/index.ts chat -m qwen-max`

## 开发

```bash
npm test          # 运行测试
npm run typecheck # 类型检查
npm run build     # 编译 TypeScript
```
