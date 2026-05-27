# Office Agent

AI 办公助理，专为容易遗忘工作事项的用户设计。通过对话管理任务、项目、记忆，主动提醒，参考 Claude Code 架构。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key（默认阿里云百炼平台）
echo "DASHSCOPE_API_KEY=sk-你的key" > .env

# 也可以切到 DeepSeek V4
# OFFICE_AGENT_LLM_PROVIDER=deepseek
# DEEPSEEK_API_KEY=sk-你的deepseek-key
# DEEPSEEK_MODEL=deepseek-v4-pro

# 2b. 查看飞书接入向导（CLI profile、bot、多用户配置）
npx tsx src/cli/index.ts setup feishu

# 2c. 配置官方飞书 CLI（用于 Agent 操作飞书）
npm run lark -- config init --name alice --new --brand feishu
npm run lark -- --profile alice auth login --recommend --domain all
npm run lark -- --profile alice auth status

# 2d.（可选）配置飞书机器人 WebSocket 对话入口
# 单用户旧写法：
# FEISHU_APP_ID=cli_xxx
# FEISHU_APP_SECRET=xxx
# FEISHU_CLI_PROFILE=alice
#
# 多用户推荐写法：
# FEISHU_MULTI_USER_CONFIG=./feishu-users.json

# WSL 下如果 lark-cli 走代理报 EOF/502，可在 .env 追加：
# LARK_CLI_NO_PROXY=1

# 2e. 快速验收本地配置、工具 schema 和飞书 CLI dry-run
npx tsx src/cli/index.ts smoke

# 3. 启动
npm start
```

## 前置条件

- Node.js >= 18
- 阿里云百炼平台 API Key（默认 LLM provider，https://bailian.console.aliyun.com/）
- 或 DeepSeek API Key（可选 LLM provider，https://api-docs.deepseek.com/）
- 官方飞书 CLI 授权（用于 Agent 操作飞书文档、消息、日历、表格等；飞书 bot 场景推荐每个用户一个 `--profile`）
- （可选）飞书自建应用 App ID + App Secret（仅用于飞书机器人 WebSocket 接收消息）

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
npx tsx src/cli/index.ts doctor    # 自检本地配置、模型能力和飞书 CLI
npx tsx src/cli/index.ts smoke     # 快速验收本地配置、工具 schema 和飞书 CLI dry-run
npx tsx src/cli/index.ts setup feishu # 飞书接入向导
npx tsx src/cli/index.ts debug users  # 本地排查用户隔离目录、日志和最近工具账本
npx tsx src/cli/index.ts feishu    # 官方 lark-cli 桥接
npx tsx src/cli/index.ts -h        # 帮助
```

### 飞书 CLI 桥接

项目内置官方 `@larksuite/cli`，`npm install` 后即可通过 `oa feishu` 或 `npm run lark -- ...` 使用。Agent 默认通过 `LarkCli` 工具调用它，不再优先使用项目内手写的飞书 SDK/stub 工具。

```bash
# 查看配置流程
npx tsx src/cli/index.ts setup feishu
npx tsx src/cli/index.ts feishu setup

# 首次绑定或新增用户：优先使用 quickstart
npx tsx src/cli/index.ts setup feishu quickstart --dry-run
npx tsx src/cli/index.ts setup feishu quickstart

# 初始化或绑定飞书开放平台应用。新 profile 需要先创建/绑定，再 auth login。
npm run lark -- config init --name alice --new --brand feishu
# 或使用已有 App ID/Secret：
# read -s FEISHU_APP_SECRET
# printf '%s' "$FEISHU_APP_SECRET" | npm run lark -- profile add --name alice --app-id cli_xxx --app-secret-stdin --brand feishu
# unset FEISHU_APP_SECRET

# 用户身份授权；需要秘书式能力时，按计划使用范围开通对应读写权限
npm run lark -- --profile alice auth login --recommend --domain all

# 多用户时直接使用官方 CLI profile
npm run lark -- --profile alice auth login --recommend --domain all
npm run lark -- --profile bob auth login --recommend --domain all

# 检查状态
npm run lark -- profile list
npm run lark -- --profile alice auth status
npx tsx src/cli/index.ts feishu status
npx tsx src/cli/index.ts feishu doctor

# 直接透传 lark-cli 命令
npx tsx src/cli/index.ts feishu docs +fetch --url "https://..."
npx tsx src/cli/index.ts feishu schema im.messages.create
```

配置完成后进入 `oa chat`，直接用自然语言说“读取这个飞书文档”“把周报写入飞书文档”“查今天日程”等，Agent 会通过 `LarkCli` 工具执行。需要访问个人日历、私有文档、私聊、通讯录、任务、多维表格等个人可见资源时，优先使用 user 授权；机器人群发或机器人身份操作可用 bot 身份。

当前 Agent 采用高信任模式：在本地飞书 CLI 已登录、开放平台应用已授权的范围内，Agent 不再为每个写操作单独询问权限。真实边界由飞书应用权限、应用可用范围、user/bot 身份、以及官方 CLI 当前登录态共同决定。`LarkCli` 仍会要求写操作先查看对应命令 `--help` 或完成 `--dry-run`，这是为了防止模型猜错参数，不是二次授权。

Agent 内置了高频 `lark-cli` recipe：当模型猜错 `docs`/`base` 等常用命令参数，或写操作还没看 `--help`/`--dry-run` 时，工具结果会返回正确参数形状和常见坑，帮助下一轮自动修正。真实执行前仍以官方 CLI 的 `--help` 和 `--dry-run` 为准。

飞书 bot 多用户模式下，Agent 会按消息发送者的 `open_id` 查找对应 `cliProfile`，然后自动执行 `lark-cli --profile <cliProfile> ...`。没有绑定 profile 的用户可以继续普通对话，但读写飞书内容时会收到“未配置 CLI profile / 权限不足”的明确错误，系统不会默认落到其他用户的 CLI 授权上。

首次配置可以让用户先给 bot 发 `ping`，然后运行 quickstart。它会读取本机 `lark-cli profile list`、最近飞书消息用户、已有 `feishu-users.json`，自动生成或更新 `openId -> cliProfile` 绑定；信息不够时会输出可复制的完整命令。

```bash
# 先预览，不写文件
npx tsx src/cli/index.ts setup feishu quickstart --dry-run

# 信息能唯一推断时，直接写入 feishu-users.json，并补 FEISHU_MULTI_USER_CONFIG 指针
npx tsx src/cli/index.ts setup feishu quickstart

# 信息不能唯一推断时，显式指定
npx tsx src/cli/index.ts setup feishu quickstart \
  --app cbt-app \
  --open-id ou_1d0cd3ed7f6151aec6fa6cba877ca491 \
  --profile my-new-company \
  --label 曹博弢
```

官方 `lark-cli` 的 profile 保存在本机用户目录的 `~/.lark-cli/config.json`，日志在 `~/.lark-cli/logs/`。这是官方 CLI 自己管理的配置；Office Agent 不直接改这个文件，只通过 `lark-cli profile list/add/remove/use` 读写。删除无用 profile：

```bash
npm run lark -- profile use my-new-company
npm run lark -- profile remove old-profile-name
```

多维表格 Base 常用命令：

```bash
lark-cli base +base-create --name "Office Agent 能力全景表" --as user
lark-cli base +table-create --base-token BASE --name "能力清单" --fields '[...]' --as user
lark-cli base +field-create --base-token BASE --table-id TABLE --json '{"name":"类别","type":"text"}' --as user
lark-cli base +record-batch-create --base-token BASE --table-id TABLE --json '{"fields":["能力","怎么用"],"rows":[["任务管理","直接说待办"]]}' --as user
```

Base 命令通常不支持 `--format json`，创建 Base 用 `--name`，不是 `--title`；创建表用 `--base-token`，不是 `--base`。

云文档长正文建议走 stdin，避免大段 Markdown 表格或引号把工具调用 JSON 搞坏：

```bash
printf '<title>Office Agent 能力概览</title>\n# 正文' \
  | lark-cli docs +create --api-version v2 --doc-format markdown --content - --as user
```

Agent 内部也会把长/多行 `--content` 自动改成 `--content -` + stdin，并会尝试修复常见的文档内容参数坏 JSON。

`LARK_CLI_NO_PROXY=1` 只影响官方 `lark-cli` 子进程：它会让 CLI 不使用本机代理配置，适合 WSL 中代理导致飞书接口 EOF/502 的情况。它不是密钥；如果你的网络必须通过代理访问飞书，可以删掉这一行。

日志默认写入当前工程目录 `logs/agent-YYYY-MM-DD.log`，也会同时打印到终端。可以通过 `.env` 设置 `LOG_LEVEL=debug` 和 `OFFICE_AGENT_LOG_DIR=./logs` 调整。

`npm run feishu` 启动前会做强校验：读取 `feishu-users.json`、检查每个 `cliProfile` 是否存在、profile 是否属于对应 App ID、`auth status` 是否可用。检查失败会直接退出，避免 bot 在线但真正读写飞书时才失败。临时排障可以设置 `OFFICE_AGENT_FEISHU_PREFLIGHT_SKIP_AUTH=1` 跳过 auth 探测，但不建议长期使用。

`oa smoke` 是更完整的快速验收：复用 `doctor`，额外检查工具 schema 是否兼容 DeepSeek/OpenAI-compatible function calling，并对已配置的 CLI profile 抽样跑 docs/base 的 `--dry-run`。默认不调用真实 LLM、不创建真实飞书资源；需要真实模型连通性时运行 `oa smoke --real-llm`。

`LarkCli` 对瞬时网络错误有有限重试：读取、`--help`、`--dry-run` 会重试；真实写操作只在 DNS/连接拒绝这类请求未到达服务端的低风险错误上重试。像 EOF/timeout 这类可能已经产生副作用的写失败不会盲目重试，Agent 会提示先检查目标状态。

所有非 read-only 工具调用会记录到 `write-ledger.json`：包含工具名、命令 key、输入签名、执行状态和资源引用摘要。它不会自动阻止合法重复写入，但能在 `/resume`、`oa debug` 和日志排查时判断上一轮是否已经尝试过写操作。

本地排查可以直接用 `oa debug`，它只读取本机文件，不调用 LLM，也不会显示飞书 appSecret：

```bash
npx tsx src/cli/index.ts debug users
npx tsx src/cli/index.ts debug user my-app:ou_xxx
npx tsx src/cli/index.ts debug last --user my-app:ou_xxx
npx tsx src/cli/index.ts debug feishu-profiles
npx tsx src/cli/index.ts debug logs --tail 120
```

工具调用默认最多 30 轮，避免复杂办公任务因为旧的 10 轮预算过早中断；如果确实需要更长任务，可以设置 `OFFICE_AGENT_MAX_TOOL_ROUNDS=50`。系统会阻止重复调用完全相同工具和参数，达到上限时会明确告诉你任务未完成，而不是假装成功。

长任务中断后，可以输入：

```text
/resume
```

或者直接说：

```text
继续刚才的任务
```

Agent 会读取最近一次失败/部分完成/运行中的 `operation-ledger.json`，基于上一轮请求和工具结果继续，并避免重复已成功的非幂等写操作。

会话历史按 channel + model 隔离。比如同一个飞书用户从 Qwen 切到 DeepSeek 后，不会把旧模型留下的工具调用历史直接恢复给新 provider，避免因历史协议不兼容导致 API 400。

## 对话中的斜杠命令

所有命令在 CLI 和飞书中行为一致：

| 命令 | 说明 |
|------|------|
| `/tasks` | 查看任务列表 |
| `/remind <内容>` | 创建提醒 |
| `/agenda` | 查看/管理主动提醒日程 |
| `/daily-report` | 生成每日工作汇报 |
| `/weekly-report` | 生成周报 |
| `/meeting-notes` | 整理会议纪要 |
| `/task-breakdown` | 拆解大任务 |
| `/feishu-sync` | 同步飞书状态 |
| `/sync` | 同步已登记的飞书关注源；`/sync list` 查看来源，`/sync force` 强制刷新 |
| `/wiki` | 查看本地知识 Wiki；`/wiki compile` 编译，`/wiki search <关键词>` 搜索 |
| `/project` | 查看项目列表 |
| `/memory <关键词>` | 搜索记忆 |
| `/cron` | 查看定时任务 |
| `/usage` | 查看 token 用量 |
| `/usage detail` | 查看详细用量（按模型/环节） |
| `/debug last` | 查看最近一轮任务账本和工具调用摘要 |
| `/resume` | 继续上一轮中断、失败或部分完成的任务 |
| `/db tasks` | 直接查数据库任务（不经过 LLM） |
| `/db projects` | 直接查数据库项目 |
| `/db memories` | 直接查数据库记忆 |
| `/reset [子命令]` | 清空数据（tasks/memories/projects/sessions/usage/config/cron/trash） |
| `/undo` | 从回收站恢复记忆 |
| `/help` | 显示帮助 |

每次 Agent 回复后会显示 `[本轮调用了 N 个工具]` 或 `[本轮未调用工具]`，帮你判断回答是否基于真实数据。

核心能力和回归检查维护在 `docs/capabilities.md`。改动飞书入口、工具调用、记忆、日程、模型能力时，应同步更新能力矩阵并补对应测试或 replay eval。

## 主要内置工具

Agent 通过原生 Function Calling 调用这些工具：

| 工具 | 功能 | 状态 |
|------|------|------|
| TaskManager | 任务 CRUD、状态追踪、逾期检测、任务拆解 | ✅ 完整 |
| SubAgentTool | 项目管理（创建/归档/委派） | ✅ 完整 |
| MemoryTool | 长期记忆存储/搜索/删除 | ✅ 完整 |
| OfficeContextTool | 办公上下文图谱：人、项目、文档、会议、流程、关系、知识 | ✅ 推荐 |
| KnowledgeCaptureTool | 从对话/文档/会议等来源批量提取上下文、记忆和提醒 | ✅ 推荐 |
| FeishuIngestTool | 登记、读取、同步飞书文档/群聊/日历/Base/任务/通讯录到上下文库 | ✅ 推荐 |
| WikiTool | 把办公上下文图谱编译成本地 Markdown Wiki，并支持列表、搜索、读取 | ✅ 推荐 |
| AgendaTool | 主动提醒日程：提醒、截止日期、承诺、跟进事项 | ✅ 推荐 |
| CronTool | 定时任务（cron 表达式） | ✅ 完整 |
| ConfigTool | 通过对话修改配置（提醒时间、工作时间等） | ✅ 完整 |
| LarkCli | 官方飞书 CLI：消息、云文档、表格、多维表格、知识库、日历、任务、会议、通讯录、OpenAPI 等 | ✅ 推荐 |
| SkillCreator | 创建自定义技能 | ✅ 完整 |
| WebSearch | 联网搜索（qwen 模型默认关闭，优先使用模型内置搜索） | 可选 |

已移除的旧/占位工具：`EmailTool`、`DocumentParser`、`FeishuConnector`、`CalendarTool`、`BackgroundTaskTool`、`ReminderTool` 不再注册给 LLM。一次性提醒、截止日期和承诺跟进统一写入 `AgendaTool`。

## 办公上下文与飞书同步

Agent 现在有一层本地办公上下文库，用来长期维护人、项目、文档、会议、任务、业务流程、关系和知识：

- `OfficeContextTool`：结构化保存和检索办公实体与关系，数据写入 `office-context.json`
- `KnowledgeCaptureTool`：当对话、文档、会议或群聊里出现多条稳定信息时，批量写入上下文、记忆和提醒
- `FeishuIngestTool`：登记并同步飞书来源，例如云文档、知识库节点、群聊消息、日历、Base、任务和通讯录搜索
- `WikiTool`：把上下文库编译成本地 Markdown Wiki，便于人工审阅、搜索和排查 Agent 到底记住了什么

典型用法：

- “把这个飞书文档登记成 Apollo 项目的长期关注源”
- “同步所有关注的飞书来源”
- “编译一下你的本地知识 Wiki”
- “看看 Apollo 项目群和项目文档最近有什么变化”
- “读取这个 Base，并把项目状态更新到你的上下文里”

同步源记录在 `feishu-sync-sources.json`。每次同步会计算内容 hash；内容没变化时不会重复更新上下文。同步工具只负责拉取和变更检测，深度提取由 Agent 视情况调用 `KnowledgeCaptureTool` 完成。

默认不会后台轮询飞书。需要定时刷新时，在 `.env` 或 `~/.office-agent/config.json` 中设置 `FEISHU_SYNC_INTERVAL_MINUTES=15` 一类的大于 0 的分钟数；`FEISHU_SYNC_ON_START=true` 可在启动时先同步一次。

## 主动提醒系统

Agent 会在后台自动检查并推送提醒，不需要用户主动询问：

- Agenda 智能日程：LLM 在对话中自主创建提醒、截止日期、承诺跟进，到点后再由 LLM 生成提醒文案
- 周期自动化：用 `CronTool` 处理日报、周报等周期任务

CLI 中提醒直接打印到终端，飞书中通过消息 API 主动推送。飞书主动推送需要用户先给机器人发过至少一条消息，Agent 会记录最近的 `chat_id` 并在重启后自动恢复推送通道。

Agenda 不会每分钟调用 LLM。Agent 只在对话中认为有明确时间点/跟进点时调用 `AgendaTool` 建日程；后台调度器用最近到期 timer 和本地低频扫描检测，到点后才调用 Reminder Composer 生成提醒内容。

一次性提醒时间由 `AgendaTool` 的 `triggerAt` 决定；周期任务由 `CronTool` 的 cron 表达式决定。

提醒只有在至少一个通知通道成功推送后才会标记为 delivered。如果飞书发送失败、没有可用通道或本地终端通道断开，Agenda 会保持 pending，下一次 tick 或通道恢复后继续补发。

## 飞书机器人（WebSocket 长连接）

通过飞书机器人与 Office Agent 对话，不需要公网 IP、域名或服务器。

注意：这是“让飞书里的用户给本地 Agent 发消息”的入口，和 `LarkCli` 执行飞书操作是两层能力。只在需要机器人收消息、语音消息、主动推送到飞书时启动它。

### 配置步骤

1. 登录 [飞书开放平台](https://open.feishu.cn/)，创建「企业自建应用」
2. 开启「机器人」能力
3. 事件订阅 → 选择「长连接」→ 添加 `im.message.receive_v1`
4. 权限管理中按计划使用范围申请对应读写权限：

| 权限 | 用途 |
|------|------|
| `im:message` | 收发消息（必需） |
| `docx:document:readonly` | 读取新版云文档 |
| 云文档/云空间写入权限 | 创建、更新云文档和云空间文件 |
| `drive:drive:readonly` | 浏览云空间文件夹 |
| `calendar:calendar` | 读写日历日程 |
| `task:task` | 读写飞书任务 |
| 多维表格/Base 读写权限 | 读取和维护业务表格、项目库、知识库索引 |
| `contact:user.base:readonly` | 读取用户基本信息 |

5. 查看本地向导：

```bash
npx tsx src/cli/index.ts setup feishu
```

6. 为每个用户准备官方 CLI profile，并完成授权：

```bash
npm run lark -- config init --name alice --new --brand feishu
npm run lark -- --profile alice auth login --recommend --domain all
npm run lark -- --profile bob auth login --recommend --domain all
```

如果已经有开放平台应用，先添加 profile：

```bash
read -s FEISHU_APP_SECRET
printf '%s' "$FEISHU_APP_SECRET" | npm run lark -- profile add --name alice --app-id cli_xxx --app-secret-stdin --brand feishu
unset FEISHU_APP_SECRET
```

7. 推荐使用 quickstart 绑定飞书消息用户和 CLI profile：

```bash
# 让用户先给 bot 发 ping，然后运行：
npx tsx src/cli/index.ts setup feishu quickstart --dry-run
npx tsx src/cli/index.ts setup feishu quickstart
```

如果 quickstart 提示信息不够，按它输出的推荐命令补充 `--app`、`--open-id`、`--profile`、`--app-id` 或 `--secret-env`。

8. 多用户推荐在 `.env` 中只保留配置文件指针和 secret：

```env
FEISHU_MULTI_USER_CONFIG=./feishu-users.json
FEISHU_APP_SECRET_MY_COMPANY=xxx
```

`feishu-users.json` 由 quickstart 自动创建或更新，也可以手动复制示例配置后填写真实信息：

```bash
cp feishu-users.example.json feishu-users.json
```

`feishu-users.json` 示例：

```json
{
  "apps": [
    {
      "key": "alice-app",
      "appId": "cli_xxx",
      "appSecret": "${FEISHU_APP_SECRET_MY_COMPANY}",
      "users": [
        { "openId": "ou_xxx", "cliProfile": "alice", "label": "Alice" }
      ]
    }
  ]
}
```

`key` 是本地隔离用的稳定名称；`openId` 是飞书消息事件里的发送者 open_id；`cliProfile` 是本机 `lark-cli --profile` 名称。默认不会让未写入 `users` 的人使用 `defaultCliProfile`，避免别人和这个 bot 对话时误用你的 CLI 授权。

`appSecret` 推荐写成 `${ENV_NAME}`，真实 secret 放在 `.env` 或系统环境变量里，避免把密钥写进 JSON。缺少对应环境变量时，`npm run feishu` 和 `oa doctor` 会直接报出缺哪个变量。

旧的单用户兼容写法仍可用，但新配置不推荐：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_CLI_PROFILE=alice
```

如果你刚换了飞书企业，需要给新企业重新做 CLI 授权：

```bash
npm run lark -- --profile alice auth login --recommend --domain all
npm run lark -- --profile alice auth status
```

登录页里选择新的飞书企业；`auth status` 里 user 身份可用后，再把新企业消息事件中的 `open_id` 写进 `feishu-users.json`。

9. `npm run feishu` 启动；启动前可运行 `npx tsx src/cli/index.ts doctor` 或全局安装后运行 `oa doctor` 检查配置。`oa doctor` 会抽样 profile 做一次飞书文档只读搜索探测；如只想检查本地配置，可临时设置 `OFFICE_AGENT_DOCTOR_SKIP_FEISHU_PROBES=1`。

10. 完整快速验收可运行 `npx tsx src/cli/index.ts smoke`。它默认只做本地、schema 和飞书 CLI dry-run 检查，不创建真实资源。

### 功能特性

- 群聊中 @机器人 触发对话
- 单聊直接发消息（需开通单聊权限）
- 支持语音消息（自动转文字，使用 DashScope Paraformer STT）
- 每个飞书用户独立会话、数据目录、消息队列和 CLI profile，重启后自动恢复
- 主动推送提醒（Agenda 到期、任务截止日期等），服务重启后会恢复最近联系过的飞书收件人
- 读取飞书云文档内容，自动提取项目信息存入记忆

## 内置技能

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
├── feishu-recipients.json  # 飞书主动推送收件人（最近 chat_id）
├── users/
│   └── <safeUserKey>/      # 飞书用户隔离目录（由 appKey:openId 编码得到）
│       ├── tasks.json
│       ├── token-usage.json
│       ├── config.json
│       ├── agenda.json
│       ├── operation-ledger.json
│       ├── write-ledger.json
│       ├── office-context.json
│       ├── feishu-sync-sources.json
│       ├── cron-tasks.json
│       ├── memdir/
│       ├── agents/
│       ├── wikidir/
│       └── sessions/
├── tasks.json              # CLI 本地用户任务数据
├── memdir/                 # CLI 本地用户记忆系统
├── agents/                 # CLI 本地用户项目（Sub-Agent）
├── wikidir/                # CLI 本地 Markdown Wiki
├── sessions/               # CLI 本地会话历史
├── skills/                 # 用户自定义技能
└── trash/                  # 回收站（/undo 可恢复）
```

运行日志不放在 `~/.office-agent/`，默认放在工程目录 `./logs/agent-YYYY-MM-DD.log`，便于出问题时直接从项目里排查。

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
│       ├── usage.ts            # Token 用量
│       ├── doctor.ts           # 本地环境与飞书 CLI 自检
│       ├── smoke.ts            # 快速验收：doctor + schema + CLI dry-run
│       ├── setup.ts            # 接入向导
│       ├── debug.ts            # 本地状态/日志/账本排查
│       └── feishu.ts           # 官方 lark-cli 透传
│
├── core/                       # 核心引擎
│   ├── query-engine.ts         # 主循环（LLM 调用 + 工具执行 + 记忆注入）
│   ├── context-manager.ts      # 上下文压缩（auto-compact）
│   ├── memory-system.ts        # 三层记忆（索引 + side query + grep）
│   ├── tool-system.ts          # 可插拔工具框架（Tool 接口 + Registry）
│   ├── skill-system.ts         # 技能系统（SKILL.md 加载 + 执行）
│   ├── sub-agent-manager.ts    # 动态子 Agent（项目级隔离）
│   ├── dashscope-llm.ts        # 百炼 LLM 客户端（流式 + Function Calling）
│   ├── deepseek-llm.ts         # DeepSeek OpenAI-compatible LLM 客户端
│   ├── llm-provider.ts         # LLM provider 选择（DashScope / DeepSeek）
│   ├── llm-client.ts           # LLM 接口定义
│   ├── schema-utils.ts         # Zod v4 → JSON Schema 转换
│   ├── token-tracker.ts        # Token 用量统计（按模型/环节/天）
│   ├── operation-ledger.ts     # 最近任务与工具调用账本
│   ├── session-store.ts        # 会话持久化（支持多通道和模型隔离）
│   ├── security.ts             # AES-256-GCM 加密
│   ├── user-config.ts          # 用户配置管理
│   ├── slash-command.ts        # 斜杠命令解析（统一路由）
│   ├── logger.ts               # 结构化日志（级别 + 文件输出）
│   └── errors.ts               # 统一错误类型（AppError + Errors 工厂）
│
├── services/                   # 服务层
│   ├── agenda-store.ts         # Agenda 持久化
│   ├── agenda-scheduler.ts     # Agenda 到期调度
│   ├── reminder-composer.ts    # 到期提醒 LLM 文案生成
│   ├── notification-service.ts # 统一通知通道（CLI/飞书注册回调）
│   ├── lark-cli-runner.ts      # 官方 lark-cli 进程封装
│   ├── lark-cli-recipes.ts     # 高频 lark-cli 命令指导
│   ├── operation-idempotency-ledger.ts # 写操作副作用账本
│   ├── office-context-store.ts # 办公上下文图谱持久化
│   ├── feishu-sync-store.ts    # 飞书同步关注源状态
│   ├── feishu-sync-scheduler.ts # 可选飞书后台同步调度
│   ├── context-wiki-compiler.ts # 上下文图谱 → 本地 Markdown Wiki
│   ├── serial-message-queue.ts # 飞书用户消息串行队列
│   ├── cron-scheduler.ts       # 定时调度器（cron 表达式 + 持久化）
│   ├── away-summary-engine.ts  # 离开摘要
│   └── speech-to-text.ts       # 语音转文字（DashScope Paraformer）
│
├── tools/                      # 工具模块
│   ├── TaskManager/            # 任务管理
│   ├── SubAgentTool/           # 项目管理
│   ├── MemoryTool/             # 记忆操作
│   ├── OfficeContextTool/      # 办公上下文图谱
│   ├── KnowledgeCaptureTool/   # 批量知识提取
│   ├── FeishuIngestTool/       # 飞书来源登记与同步
│   ├── WikiTool/               # 本地知识 Wiki 编译/搜索/读取
│   ├── AgendaTool/             # 主动提醒日程
│   ├── CronTool/               # 定时任务
│   ├── ConfigTool/             # 配置修改（通过对话）
│   ├── LarkCliTool/            # 官方 lark-cli Agent 工具（推荐）
│   ├── SkillCreatorTool/       # 自定义技能创建
│   └── WebSearchTool/          # 可选联网搜索
│
├── skills/bundled/             # 内置技能
├── evals/                      # 离线回放评测
│   └── replay.ts               # 工具调用/失败处理/最终回复回放
├── types/index.ts              # 核心类型定义
├── main.ts                     # 组件装配 + 消息处理流程
│
└── server/                     # 飞书机器人
    └── feishu-bot.ts           # 飞书机器人（WebSocket 长连接）
```

## 支持的模型

通过 `.env` 中的 `OFFICE_AGENT_LLM_PROVIDER` 选择 provider。

### DashScope / Qwen

| 模型 | 说明 |
|------|------|
| `qwen-plus` | 默认，性价比高 |
| `qwen-max` | 更强 |
| `qwen-turbo` | 更快更便宜 |
| `qwen-vl-plus` / `qwen-vl-max` | 支持图片输入的视觉模型 |

运行时指定：`npx tsx src/cli/index.ts chat -m qwen-max`

### DeepSeek V4

官方 DeepSeek API 当前公开的 V4 文本模型：

| 模型 | 说明 |
|------|------|
| `deepseek-v4-pro` | 默认 DeepSeek 模型，能力更强 |
| `deepseek-v4-flash` | 更快更便宜 |

配置示例：

```bash
OFFICE_AGENT_LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-你的deepseek-key
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_THINKING=enabled
DEEPSEEK_REASONING_EFFORT=high
```

也可以临时指定：

```bash
npx tsx src/cli/index.ts chat -m deepseek-v4-pro
```

DeepSeek 官方 Chat API 当前消息 `content` 是文本 string，能力表列出 JSON Output、Tool Calls、Prefix/FIM 等，没有公开图片输入/vision API。因此本项目目前只适配 DeepSeek 文本和工具调用；用 DeepSeek 时飞书图片会被明确提示“不支持图片识别”并忽略。

## 多模态现状

当前 Agent 已恢复飞书图片输入，但是否真的能识别图片取决于当前 LLM provider/model：

- 飞书文本消息：直接进入 LLM。
- 飞书语音消息：先用 DashScope STT 转文字，再进入 LLM。
- 飞书图片消息：下载为 base64 data URL；视觉模型会同时接收图片和文字。
- 飞书富文本消息：会提取文字和其中的图片一起处理。
- 纯文本模型收到图片：回复“当前模型不支持图片识别，已忽略图片”；如果同条消息里有文字，会继续处理文字。

当前视觉能力判断规则：DashScope 模型名包含 `vl` 或 `omni` 时视为支持图片；DeepSeek V4 视为纯文本模型。如果未来 DeepSeek 官方开放图片输入，再把 DeepSeek provider 标记为 vision-capable。

## 开发

```bash
npm test          # 运行测试
npm run typecheck # 类型检查
npm run build     # 编译 TypeScript
npm run eval:replay # 离线回放评测，不依赖真实 LLM/飞书
npx tsx src/cli/index.ts smoke --skip-feishu # 本地快速验收
```

## 架构参考

参考 Claude Code 的架构模式：
- QueryEngine 主循环（async generator + 多轮工具调用）
- 原生 Function Calling（非 prompt-based）
- 三层记忆系统（MEMORY.md 索引 + LLM side query + 工具搜索）
- 办公上下文图谱（OfficeContextStore + FeishuIngestTool + KnowledgeCaptureTool）
- 本地知识 Wiki（ContextWikiCompiler + WikiTool）
- 可选飞书后台同步（FeishuSyncScheduler，默认关闭）
- 同一飞书用户消息串行处理（SerialMessageQueue，避免上一个任务未完成时并发改同一会话）
- 可插拔 Tool 系统（当前只注册真实可用工具，Zod schema 自动转 JSON Schema）
- SKILL.md 技能定义（inline/fork 两种执行模式）
- 上下文自动压缩
- 离线回放评测（ReplayEval，覆盖工具调用和失败回传）
- 会话持久化（多通道 + 模型隔离：CLI / 飞书各用户独立）
- 统一通知架构（NotificationService + AgendaScheduler，投递成功才标记提醒已送达）
- 写操作副作用账本（write-ledger，辅助恢复和排查重复写风险）
- 统一命令路由（slash-command.ts，CLI/飞书/Web 行为一致）
- 结构化日志 + 统一错误处理
