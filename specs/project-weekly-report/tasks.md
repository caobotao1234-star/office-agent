# 项目自动周报任务

## T1 规格

- 状态：DONE
- 文件：`specs/project-weekly-report/*`
- 实现说明：定义项目周报的目标、非目标、架构、测试策略。
- 验证命令：人工检查。
- 完成标准：spec 文件齐全。

## T2 周报服务

- 状态：DONE
- 文件：`src/services/project-weekly-report-service.ts`、`src/services/project-weekly-report-service.test.ts`
- 实现说明：基于 `ProjectDashboardService` 生成结构化周报和 Markdown。
- 验证命令：`npm test -- src/services/project-weekly-report-service.test.ts`
- 完成标准：正常、默认周期、not found 测试通过。

## T3 工具与 Agent 接入

- 状态：DONE
- 文件：`src/tools/ProjectWeeklyReportTool/index.ts`、测试、`src/main.ts`
- 实现说明：注册 `ProjectWeeklyReportTool`，系统提示要求周报前调用。
- 验证命令：`npm test -- src/tools/ProjectWeeklyReportTool/index.test.ts src/main.test.ts`
- 完成标准：工具只读、not found 返回候选，Agent 工具列表包含新工具。

## T4 回放、文档和最终验证

- 状态：DONE
- 文件：`src/evals/replay.ts`、`README.md`、`docs/capabilities.md`
- 实现说明：增加 replay 用例并更新用户文档。
- 验证命令：`npm test && npm run typecheck && npm run build && npm run eval:replay && git diff --check`
- 完成标准：全量验证通过。
