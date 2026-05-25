# Office Agent 能力矩阵

这份矩阵用于防止重构时丢能力。新增或修改 Agent 能力时，必须同步更新本文件，并尽量补单元测试或 replay eval。

## 输入通道

| 能力 | 用户输入示例 | 期望链路 | 降级行为 | 覆盖 |
| --- | --- | --- | --- | --- |
| CLI 文本对话 | `oa chat` 后输入“列出今天任务” | CLI -> OfficeAgent -> QueryEngine -> Tool | LLM/工具失败时输出错误 | unit + replay |
| CLI 单次提问 | `oa ask "总结项目状态"` | CLI -> OfficeAgent -> QueryEngine | 失败时非零退出 | unit |
| 飞书接入向导 | `oa setup feishu` | CLI -> lark-cli profile list -> 配置建议 | 读取 profile 失败时输出默认引导 | unit |
| 飞书 quickstart | `oa setup feishu quickstart` | profile list + recipients + feishu-users.json -> 自动绑定 openId/profile | 信息不唯一时只输出候选项和推荐命令；不打印 appSecret | unit |
| 本地 debug 面板 | `oa debug users` / `oa debug last --user app:openId` | CLI -> 本地数据目录/日志/OperationLedger | 不调用 LLM；配置错误时输出可排查信息且不显示 secret | unit |
| 任务中断恢复 | `/resume` 或“继续刚才的任务” | OperationLedger -> 恢复提示 -> QueryEngine | 无可恢复任务时直接说明；恢复时避免重复已成功的非幂等写操作 | unit |
| 飞书文本私聊/群聊 | “提醒我 10 分钟后开会” | Feishu WS -> per-user queue -> OfficeAgent -> AgendaTool | 前序任务未完成时排队提示 | unit + manual |
| 飞书富文本 | 富文本含文字和图片 | parser -> image download -> OfficeAgent(text, images) | 图片下载失败时继续处理文字或提示失败 | unit |
| 飞书图片 | 只发送一张图 | parser -> image download -> vision model | 纯文本模型提示不支持图片并忽略图片 | unit + replay |
| 飞书语音 | 发送语音消息 | Feishu resource -> DashScope STT -> OfficeAgent(text) | 无 DashScope key 或识别失败时直接提示 | manual |
| 多条连续飞书消息 | 快速发送多条指令 | per-user SerialMessageQueue 顺序处理 | 第二条起提示排队 | unit |
| 飞书多用户隔离 | 用户 1/2 分别和 bot 对话 | appKey + open_id -> 独立 Agent/dataDir/queue/session | 未绑定用户只允许普通对话，飞书 CLI 操作返回配置问题 | unit |

## 飞书执行能力

| 能力 | 用户输入示例 | 期望链路 | 降级行为 | 覆盖 |
| --- | --- | --- | --- | --- |
| 创建云文档 | “创建一份文档写功能说明” | LarkCli docs +create v2 | flags 错误时工具返回修正建议，不允许谎报成功 | replay |
| 读取云文档 | “读取这个文档” | LarkCli docs +fetch | 权限/登录失败时原样反馈 stderr/stdout 摘要 | replay |
| 写入云文档 | “把结论追加到文档” | LarkCli docs +update；长/多行正文走 `--content -` + stdin | 写前需要 help/dry-run 指导；坏 JSON 文档参数优先修复 | unit |
| 创建 Base | “做个多维表格” | LarkCli base +base-create -> table/field/record | `base +create`、`--title`、`--base` 等错误被拦截或修复 | unit + replay |
| 日历/会议/任务/联系人 | “查今天日程” | LarkCli 对应 shortcut 或 raw API | 不猜 flags，先 help/schema | manual |
| 飞书同步源 | “持续关注这个项目文档” | FeishuIngestTool addSource/syncAll | sync 失败记录 lastError | unit |
| 用户级 CLI 授权 | “写到我的云文档” | ToolContext.larkCliProfile -> lark-cli --profile PROFILE | 无 profile 时快速失败，不落到其他用户授权 | unit |
| 启动前强校验 | `npm run feishu` | feishu-users.json -> lark-cli profile list/auth status -> fail fast | 缺 profile、授权异常、appId 不匹配时拒绝启动；明文 secret 只 warn 且不打印 secret | unit |
| 写操作稳定重试 | 任意飞书 CLI 写入 | LarkCliTool -> retry policy -> lark-cli | 只重试安全的瞬时网络失败；可能已发出请求的失败不盲目重试，避免重复写 | unit + replay |
| CLI profile 诊断 | `oa doctor` | profile auth status + docs search read probe | 探测失败时 warn 并给出权限/授权建议 | unit |
| CLI 回放测试 | fake runner | LarkCliTool -> injected runner | 不依赖真实飞书，验证 help/dry-run、profile 注入和已知错误拦截 | unit + replay |

## 记忆与知识

| 能力 | 用户输入示例 | 期望链路 | 降级行为 | 覆盖 |
| --- | --- | --- | --- | --- |
| 松散记忆 | “服务器密码在 1Password” | MemoryTool store/search | 工具失败时如实反馈 | unit |
| 结构化上下文 | “张三负责 Apollo 前端” | OfficeContextTool upsert/search | 缺 title/summary 时工具拒绝 | unit |
| 批量知识捕获 | 长文本包含人、项目、承诺 | KnowledgeCaptureTool -> context/memory/agenda | 单项失败不影响其他项，输出计数 | unit + replay |
| 本地 Wiki | “生成/查询知识库” | WikiTool -> ContextWikiCompiler | 缺页返回空结果 | unit |
| 飞书主动同步 | 已登记文档变化 | FeishuSyncScheduler -> FeishuIngestTool -> OfficeContext | 变化抽取失败不影响同步记录 | unit |

## 日程与主动性

| 能力 | 用户输入示例 | 期望链路 | 降级行为 | 覆盖 |
| --- | --- | --- | --- | --- |
| 一次性提醒 | “1 分钟后提醒我测试” | AgendaTool create -> AgendaScheduler -> ReminderComposer -> NotificationService | 无通知通道时不标记 delivered，通道恢复后补发 | unit |
| 截止日期/承诺 | “周五前给客户方案” | AgendaTool commitment/deadline | 时间不明确时询问或不创建 | replay |
| 周期任务 | “每周五生成周报” | CronTool -> CronScheduler -> OfficeAgent | cron 解析失败时工具报错 | unit |
| 离开总结 | 用户离开后回来 | AwaySummaryEngine -> LLM summary | LLM 失败时静默跳过 | unit |

## 模型能力

| 能力 | DashScope qwen-plus | DashScope qwen-vl/omni | DeepSeek V4 |
| --- | --- | --- | --- |
| 文本对话 | 支持 | 支持 | 支持 |
| 工具调用 | 支持 | 支持 | 支持 |
| 流式文本 | 支持 | 支持 | 支持 |
| 图片输入 | 不支持 | 支持 | 不支持 |
| 图片降级 | 提示并忽略图片 | 正常识别 | 提示并忽略图片 |
| 内置联网搜索 | 支持 enable_search | 关闭 enable_search 避免 vision 冲突 | 不支持 |

运行时能力由 `LLMClient.capabilities` 声明，当前字段包括：

- `vision`：是否支持图片输入。
- `toolCalling`：是否支持原生工具调用。
- `streaming`：是否支持流式文本。
- `jsonMode`：是否支持 JSON 输出模式。
- `webSearchNative`：是否有模型/provider 原生搜索能力；为 true 时隐藏 `WebSearch` 工具。
- `supportsImageDataUrl`：是否支持把飞书图片转成 data URL 后直接传给模型。
- `maxContextTokens`：模型上下文上限，未知时不填。
- `reasoningContentReplay`：provider 是否需要在工具调用后回放 reasoning_content。

## 回归检查清单

每次重构至少运行：

```bash
npm test
npm run typecheck
npm run build
npm run eval:replay
```

涉及飞书入口时额外检查：

```bash
npm test -- src/server/feishu-message-parser.test.ts src/services/serial-message-queue.test.ts
npm test -- src/server/feishu-multi-user-config.test.ts src/services/feishu-recipient-store.test.ts
npm test -- src/services/feishu-startup-preflight.test.ts
```

涉及 CLI 指令时额外检查：

```bash
npm test -- src/tools/LarkCliTool/index.test.ts src/services/lark-cli-runner.test.ts
npm test -- src/cli/commands/debug.test.ts src/tools/LarkCliTool/index.replay.test.ts
```

涉及中断恢复时额外检查：

```bash
npm test -- src/core/operation-ledger.test.ts src/core/slash-command.test.ts
```
