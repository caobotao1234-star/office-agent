# 飞书 CLI 集成任务

## T1 依赖与文档

- 状态：DONE
- 文件：`package.json`、`package-lock.json`、`.env.example`、`README.md`
- 实现说明：加入 `@larksuite/cli`，补充本地飞书 CLI 配置与运行说明。
- 验证命令：`./node_modules/.bin/lark-cli --help`
- 完成标准：本地 CLI 可显示帮助。

## T2 Runner 封装

- 状态：DONE
- 文件：`src/services/lark-cli-runner.ts`
- 实现说明：封装本地 `lark-cli` 调用、超时、AbortSignal、输出截断。
- 验证命令：`npm test -- src/services/lark-cli-runner.test.ts`
- 完成标准：runner 能调用 `lark-cli --help`，并能处理失败命令。

## T3 Agent 工具

- 状态：DONE
- 文件：`src/tools/LarkCliTool/index.ts`
- 实现说明：新增通用 `LarkCli` 工具，要求 argv 数组并拦截未确认写操作。
- 验证命令：`npm test -- src/tools/LarkCliTool/index.test.ts`
- 完成标准：读命令可执行，写命令未确认会被阻止。

## T4 CLI 透传

- 状态：DONE
- 文件：`src/cli/index.ts`、`src/cli/commands/feishu.ts`
- 实现说明：支持 `oa feishu ...` / `oa lark ...`，并提供 `setup/status/doctor` 入口。
- 验证命令：`npm run build && node dist/cli/index.js feishu --help`
- 完成标准：构建后的 CLI 能展示 `lark-cli` 帮助。

## T5 主 Agent 接入

- 状态：DONE
- 文件：`src/main.ts`、`src/main.test.ts`
- 实现说明：注册 `LarkCli`，系统提示词说明飞书默认走官方 CLI，默认禁用旧 SDK 飞书工具。
- 验证命令：`npm test -- src/main.test.ts`
- 完成标准：工具列表包含 `LarkCli`，测试通过。

## T6 全量验证与提交

- 状态：DONE
- 文件：全部变更
- 实现说明：运行 typecheck、build、unit tests、CLI smoke，确认 git diff 后提交。
- 验证命令：`npm run typecheck && npm run build && npm test`
- 完成标准：所有可离线验证通过并完成 git commit。

## T7 修复通用 CLI 参数误猜与失败误报

- 状态：DONE
- 文件：`src/tools/LarkCliTool/index.ts`、`src/main.ts`、`src/core/query-engine.ts`
- 实现说明：继续保持泛化 `LarkCli`，补充最新 CLI 使用规则，并把工具失败的 `error` 完整回传给模型，避免 `output=null` 时幻觉成功。
- 验证命令：`npm test -- src/tools/LarkCliTool/index.test.ts src/core/query-engine.test.ts && npm run typecheck && npm test`
- 完成标准：Agent 必须先通过 `--help`/`schema` 确认不熟悉的参数；工具失败时模型能看到 error、stdout、stderr。
