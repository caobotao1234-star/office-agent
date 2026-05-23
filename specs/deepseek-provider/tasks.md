# DeepSeek V4 Provider 任务

## T1 官方能力确认与 Spec

- 状态：DONE
- 文件：`specs/deepseek-provider/*`
- 实现说明：查阅官方文档，确认 DeepSeek V4 文本/工具调用 API 可用，官方 Chat API 未公开图片输入。
- 验证命令：人工核对官方文档。
- 完成标准：需求、设计、任务齐全。

## T2 DeepSeek LLM Client

- 状态：DONE
- 文件：`src/core/deepseek-llm.ts`、`src/core/deepseek-llm.test.ts`
- 实现说明：实现 query、queryStream、queryWithTools。
- 验证命令：`npm test -- src/core/deepseek-llm.test.ts`
- 完成标准：mock API 测试通过。

## T3 Provider 选择与运行入口

- 状态：DONE
- 文件：`src/core/llm-provider.ts`、`src/core/llm-provider.test.ts`、`src/cli/agent-factory.ts`、`src/cli/commands/chat.ts`、`src/server/feishu-bot.ts`
- 实现说明：CLI 和飞书共用 provider resolver，支持 DeepSeek 环境变量和 `-m deepseek-v4-pro`。
- 验证命令：`npm test -- src/core/llm-provider.test.ts src/main.test.ts`
- 完成标准：provider 选择测试通过，现有 DashScope 默认不变。

## T4 文档与配置示例

- 状态：DONE
- 文件：`README.md`、`.env.example`
- 实现说明：说明 DeepSeek 配置、多模态现状、图片消息边界。
- 验证命令：人工检查。
- 完成标准：用户可以按 README 配置 DeepSeek V4。

## T5 全量验证与提交

- 状态：DONE
- 文件：全部变更
- 实现说明：跑测试、typecheck、build、CLI help、ReplayEval 后提交。
- 验证命令：`npm test && npm run typecheck && npm run build && node dist/cli/index.js --help && npm run eval:replay`
- 完成标准：验证通过并提交。
