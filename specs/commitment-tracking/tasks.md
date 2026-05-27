# 任务清单

- [x] 1. 实现承诺追踪服务
  - 文件：`src/services/commitment-tracker-service.ts`, `src/services/commitment-tracker-service.test.ts`
  - 验证：`npm test -- src/services/commitment-tracker-service.test.ts`（通过，3 tests）
  - 完成标准：能按人/项目过滤，输出逾期、临近到期、未来和方向。

- [x] 2. 暴露 `CommitmentTrackerTool`
  - 文件：`src/tools/CommitmentTrackerTool/index.ts`, `src/tools/CommitmentTrackerTool/index.test.ts`
  - 验证：`npm test -- src/tools/CommitmentTrackerTool/index.test.ts`（通过，2 tests）
  - 完成标准：支持 `list/summary`，只读，不修改 Agenda。

- [x] 3. 接入 Agent 和回放评测
  - 文件：`src/main.ts`, `src/evals/replay.ts`, `README.md`, `docs/capabilities.md`
  - 验证：`npm test -- src/services/commitment-tracker-service.test.ts src/tools/CommitmentTrackerTool/index.test.ts src/main.test.ts && npm run eval:replay`（通过，19 tests；replay 10/10）
  - 完成标准：系统提示要求承诺/催办类问题优先调用追踪工具。

- [x] 4. 最终验证与提交
  - 验证：`npm test`（224 tests）, `npm run typecheck`, `npm run build`, `npm run eval:replay`（10/10）, `git diff --check`
  - 完成标准：全部通过，提交中文 commit。
