# Agent 体验与稳定性加固任务

## T0 总体规格

- 状态：DONE
- 文件：`specs/agent-experience-hardening/*`
- 实现说明：定义需求、设计、任务边界。
- 验证命令：`git status --short`
- 完成标准：spec 文件落地并独立提交。

## T1 能力矩阵与回放测试

- 状态：TODO
- 文件：`docs/capabilities.md`、`src/evals/replay.ts`、相关测试/脚本。
- 实现说明：把关键能力映射到输入、期望链路、降级行为和测试覆盖；补回放用例。
- 验证命令：`npm run eval:replay && npm test -- src/core/query-engine.test.ts`
- 完成标准：回放能发现核心能力回归。

## T2 模型能力声明扩展

- 状态：TODO
- 文件：`src/core/llm-client.ts`、provider、测试、README。
- 实现说明：扩展 vision/toolCalling/streaming/jsonMode/webSearchNative/maxContextTokens/supportsImageDataUrl。
- 验证命令：`npm test -- src/core/llm-provider.test.ts src/core/deepseek-llm.test.ts && npm run typecheck`
- 完成标准：入口层可按能力降级。

## T3 飞书消息入口强类型化

- 状态：TODO
- 文件：`src/server/feishu-message-parser.ts`、`src/server/feishu-bot.ts`、测试。
- 实现说明：抽离文本、富文本、图片、语音、不支持类型解析，减少 bot 主文件手写 any。
- 验证命令：`npm test -- src/server/feishu-message-parser.test.ts && npm run typecheck`
- 完成标准：fake 飞书事件可被稳定解析。

## T4 Lark CLI 知识缓存

- 状态：TODO
- 文件：`src/services/lark-cli-knowledge-base.ts`、`src/tools/LarkCliTool/index.ts`、测试。
- 实现说明：缓存 help 输出，阻止写命令时返回可复用指导信息。
- 验证命令：`npm test -- src/services/lark-cli-knowledge-base.test.ts src/tools/LarkCliTool/index.test.ts`
- 完成标准：写命令指导不只依赖 prompt。

## T5 Operation Ledger 与 debug 摘要

- 状态：TODO
- 文件：`src/core/operation-ledger.ts`、`src/core/query-engine.ts`、slash command、测试。
- 实现说明：记录一轮任务的工具调用、结果、最终状态；支持 `/debug last`。
- 验证命令：`npm test -- src/core/query-engine.test.ts src/core/operation-ledger.test.ts src/core/slash-command.test.ts`
- 完成标准：长任务失败/部分完成可追踪。

## T6 Feishu sync 自动知识抽取

- 状态：TODO
- 文件：`src/services/feishu-sync-scheduler.ts` 或新增服务、`src/tools/FeishuIngestTool/index.ts`、测试。
- 实现说明：内容变化后自动触发受控知识抽取并更新上下文/记忆/日程。
- 验证命令：`npm test -- src/tools/FeishuIngestTool/index.test.ts src/services/feishu-sync-scheduler.test.ts`
- 完成标准：changed source 可产出 capture hint 或实际 capture 结果。

## T7 JsonStore 原子写与坏文件备份

- 状态：TODO
- 文件：`src/services/json-store.ts`、各 store、测试。
- 实现说明：统一原子写、坏文件备份、schema fallback。
- 验证命令：`npm test -- src/services/*store*.test.ts`
- 完成标准：关键 JSON store 写入可靠，坏文件可备份。

## T8 Trace 日志与最近一轮调试

- 状态：TODO
- 文件：logger、query-engine、feishu-bot、debug 命令、测试。
- 实现说明：turnId 贯穿一轮消息，日志和 debug 摘要可定位问题。
- 验证命令：`npm test -- src/core/query-engine.test.ts src/main.test.ts`
- 完成标准：用户能查看最近一轮执行摘要。

## T9 Doctor 自检命令

- 状态：TODO
- 文件：`src/cli/commands/doctor.ts`、`src/cli/index.ts`、测试、README。
- 实现说明：检查 env、模型能力、lark-cli、auth、飞书 bot 配置、日志/数据目录。
- 验证命令：`npm test -- src/cli/commands/doctor.test.ts && npm run build && node dist/cli/index.js doctor`
- 完成标准：无真实 API key 时也能给出本地自检报告。

## T10 清理残留与最终验证

- 状态：TODO
- 文件：空目录、README、能力矩阵。
- 实现说明：清理本地空目录和残留概念；跑全量验证。
- 验证命令：`npm test && npm run typecheck && npm run build && npm run eval:replay`
- 完成标准：工作区 clean，全量测试通过。
