# Office Agent - Agent 开发协作约定

本文件适用于整个仓库。未来在本项目中工作的 coding agent，需要优先遵守这里的项目级约束，再结合用户当轮需求执行。

## 项目定位

Office Agent 是一个秘书型办公 Agent：

- 通过 CLI 和飞书机器人接收用户消息。
- 用 LLM 负责理解、规划、工具选择和自然语言回复。
- 用本地工具和官方 `lark-cli` 执行确定性操作。
- 维护任务、日程、长期上下文、飞书同步源、Wiki、操作账本和会话状态。

核心目标不是做一个固定 workflow 系统，而是提供稳定、可审计、可恢复的工具层，让 LLM 主动调用工具完成办公任务。

## 技术栈和常用命令

项目是 Node.js/TypeScript ESM：

```bash
npm test
npm run typecheck
npm run build
npm run eval:replay
npm run feishu
npm run lark -- profile list
npx tsx src/cli/index.ts doctor
npx tsx src/cli/index.ts debug users
```

注意：`npm run feishu` 会启动长连接服务，不适合作为普通自动化测试命令直接跑到结束。需要验证启动前配置时，优先测对应 service/CLI 单元，或用短脚本调用 preflight。

## 关键目录

- `src/main.ts`：Agent 组装、系统提示词、工具注册、消息入口。
- `src/core/query-engine.ts`：LLM 工具调用循环、会话恢复、工具参数修复、轮次控制。
- `src/core/*-llm.ts`：模型 provider 适配层。
- `src/core/schema-utils.ts`：Zod schema 到 provider-compatible tool schema 的转换。
- `src/server/feishu-bot.ts`：飞书 WebSocket bot、多用户 Agent 隔离和消息队列。
- `src/server/feishu-multi-user-config.ts`：`feishu-users.json` 配置解析。
- `src/tools/LarkCliTool/index.ts`：官方飞书 CLI 工具封装。
- `src/services/lark-cli-runner.ts`：安全启动 `lark-cli` 子进程。
- `src/services/feishu-startup-preflight.ts`：飞书启动前强校验。
- `src/core/operation-ledger.ts`：工具调用账本和 `/resume` 恢复。
- `docs/capabilities.md`：能力矩阵，防止重构丢能力。
- `specs/*`：复杂功能的需求、设计和任务清单。

## 变更流程

中等以上复杂度任务必须先建或更新 spec：

- `specs/<feature>/requirements.md`
- `specs/<feature>/design.md`
- `specs/<feature>/tasks.md`

实现时保持小步修改。新增或改变 Agent 能力时，必须同步更新 `docs/capabilities.md`，并尽量增加单元测试或 replay eval。

修复 bug 时先定位真实失败点：读日志、读 ledger、读测试，再改代码。不要只改 prompt 来掩盖 harness 问题。

## 飞书 CLI 约束

飞书执行层使用官方 `lark-cli`。不要重新引入旧的手写飞书 SDK 工具作为主路径。

多用户隔离是硬约束：

- 稳定映射是 `appKey + open_id -> userKey/safeUserKey -> per-user Agent/baseDir/session/queue/cliProfile`。
- 有飞书用户上下文时，`LarkCliTool` 必须使用该用户绑定的 `cliProfile`。
- 缺少 `cliProfile` 时必须明确失败，不能 fallback 到默认 profile 或其他用户授权。
- 生成的飞书文档、Base、日历等应落在当前 `cliProfile` 对应用户的飞书账号权限下。

写操作规则：

- 写操作前必须先看同一命令 `--help`，或成功跑同一命令 `--dry-run`。
- 不要猜 `lark-cli` 参数。先用 `--help`、`schema` 或已缓存的 help。
- 真实写操作只对请求未到达服务端的低风险网络错误重试，避免重复创建文档、重复发消息、重复写 Base。
- 长/多行云文档正文使用 `--content -` 或 `--markdown -`，正文通过 `stdin` 传入。
- Base 常见参数：创建 Base 用 `base +base-create --name`，创建表用 `base +table-create --base-token`，不要用 `base +create`、`--title`、`--base`、随意加 `--format`。

## LLM Provider 约束

当前支持 DashScope 和 DeepSeek。切换 provider 时不能假设两边兼容：

- DeepSeek 对 tool schema 和历史 `tool_calls` 更严格。
- `tool_calls` 发给 OpenAI-compatible provider 前必须包含 `type: "function"`。
- 历史会话恢复不能从 `tool` 消息半截开始，必须从有效 user 边界恢复，并保持 assistant tool_call 与 tool result 配对。
- Zod schema 不能原样发给所有 provider。`schema-utils.ts` 负责把 `oneOf/const/default/{}` 等转换成保守工具 schema。
- runtime 仍用 Zod schema 严格校验工具入参。provider schema 只用于指导模型生成参数，不是安全边界。
- 图片输入只在当前模型声明 `vision=true` 时传给 LLM。纯文本模型应提示不支持图片并继续处理文字。

涉及 OpenAI-compatible API、DeepSeek、DashScope、工具调用 schema、reasoning replay 时，必须增加 mock 测试；必要时可做最小真实 smoke，但不要把真实 key、token、URL 查询参数写进代码或测试输出。

## Agent Harness 质量要求

LLM 会犯错，harness 必须兜底：

- 工具参数必须 schema 校验。
- 常见坏 JSON 可做窄口径 repair，但不要写宽泛的“猜测式修复”。
- 工具失败必须如实反馈，不能让 Agent 谎报成功。
- 重复相同工具调用要有限制，防止无限循环和重复副作用。
- 长任务失败后应能通过 `OperationLedger` 和 `/resume` 继续。
- 外部 CLI/API 调用必须有超时、日志、输出截断和错误摘要。
- 生产写操作不可在测试中真实执行，除非用户明确要求并且使用 dry-run 或隔离资源。

## 配置和密钥

不要提交 `.env`、真实 API key、飞书 appSecret、用户 token、私有 openId 映射或真实业务数据。

推荐配置：

- `.env` 只放本地密钥和 `FEISHU_MULTI_USER_CONFIG=./feishu-users.json`。
- `feishu-users.json` 可以本地使用，但示例文件必须使用占位符或 `${ENV_VAR}` 引用。
- 明文 `appSecret` 只能作为本地临时配置，启动 preflight 会 warn。
- 官方 `lark-cli` profile 存在 `~/.lark-cli/config.json`，Office Agent 不直接编辑这个文件。

## 日志和排查

日志默认在 `logs/agent-YYYY-MM-DD.log`，也会输出到终端。排查优先看：

```bash
npx tsx src/cli/index.ts debug users
npx tsx src/cli/index.ts debug last --user appKey:openId
npx tsx src/cli/index.ts debug logs --tail 120
npm run lark -- --profile <profile> auth status
```

排查飞书 bot 问题时先区分：

- WebSocket 收不到消息：看飞书事件订阅和 bot 配置。
- Agent 能回复但飞书读写失败：看 `cliProfile`、`auth status`、OpenAPI scopes。
- 工具调用没发生：看 LLM provider、tool schema、QueryEngine 日志。
- 工具调用发生但失败：看 `LarkCliTool` 输出、`lark-cli --help`、dry-run 和权限。

## 测试策略

修改后至少运行最小相关测试。常用组合：

```bash
npm test -- src/core/query-engine.test.ts
npm test -- src/core/deepseek-llm.test.ts src/core/schema-utils.test.ts
npm test -- src/tools/LarkCliTool/index.test.ts src/tools/LarkCliTool/index.replay.test.ts
npm test -- src/server/feishu-multi-user-config.test.ts src/services/feishu-startup-preflight.test.ts
npm test -- src/server/feishu-message-parser.test.ts src/services/serial-message-queue.test.ts
npm run typecheck
```

提交或较大改动前运行：

```bash
npm test
npm run typecheck
npm run build
npm run eval:replay
git diff --check
```

如果无法运行某项测试，必须说明具体原因和替代验证。不要声称“已验证”但没有实际命令结果。

## 文档维护

- 新能力或行为变化：更新 `docs/capabilities.md`。
- 新配置项：更新 `README.md`、`.env.example` 或相关 example JSON。
- 复杂功能：更新对应 `specs/<feature>/tasks.md` 状态。
- 用户配置流程变化：优先保持 quickstart 简单，不要把新手路径拆成太多手工步骤。

## 提交习惯

只有用户要求提交，或当前任务明确包含“做完提交/单步提交”时才提交。

提交信息用中文，说明改动目的，例如：

```bash
git commit -m "修复 DeepSeek 工具 schema 兼容"
```

提交前确认 `git status --short`，不要把 `.env`、真实配置、日志、用户数据误提交。
