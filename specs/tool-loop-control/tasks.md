# 工具循环控制与飞书 Base 命令修复任务

## T1 日志复盘与规格落地

- 状态：DONE
- 文件：`logs/agent-2026-05-23.log`、`specs/tool-loop-control/*`
- 实现说明：确认多维表格失败原因是 Base 命令多轮试错叠加工具轮次上限耗尽，且上限耗尽后缺少用户可见错误。
- 验证命令：`rg -n "Office Agent 能力全景表|base \\+base-create|table-create|本轮调用" logs -g 'agent-*.log'`
- 完成标准：需求、设计、任务文件齐全。

## T2 QueryEngine 工具预算与循环保护

- 状态：DONE
- 文件：`src/core/query-engine.ts`、`src/core/query-engine.test.ts`、`src/main.ts`
- 实现说明：提高默认工具轮次预算，支持环境变量覆盖，增加重复工具调用保护和上限耗尽错误。
- 验证命令：`npm test -- src/core/query-engine.test.ts src/main.test.ts`
- 完成标准：长任务不会在 10 次静默停止，循环保护测试通过。

## T3 LarkCli Base 命令校验与提示词

- 状态：DONE
- 文件：`src/tools/LarkCliTool/index.ts`、`src/tools/LarkCliTool/index.test.ts`、`src/main.ts`、`README.md`
- 实现说明：对 Base 常用命令已知错参做本地校验，并在系统提示词/README 记录正确用法。
- 验证命令：`npm test -- src/tools/LarkCliTool/index.test.ts`
- 完成标准：错误 Base 命令不再启动 CLI 子进程试错。

## T4 全量验证与提交

- 状态：DONE
- 文件：全部变更
- 实现说明：运行全量测试、类型检查、构建、CLI smoke、ReplayEval，并提交。
- 验证命令：`npm test && npm run typecheck && npm run build && node dist/cli/index.js --help && npm run eval:replay`
- 完成标准：验证通过并完成提交。
