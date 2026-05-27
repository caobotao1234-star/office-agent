# 任务清单

- [x] 1. 实现项目驾驶舱聚合服务
  - 文件：`src/services/project-dashboard-service.ts`, `src/services/project-dashboard-service.test.ts`
  - 验证：`npm test -- src/services/project-dashboard-service.test.ts`（通过，3 tests）
  - 完成标准：能聚合项目、任务、Agenda、上下文和飞书同步源；找不到项目时给候选。

- [x] 2. 暴露 `ProjectDashboardTool`
  - 文件：`src/tools/ProjectDashboardTool/index.ts`, `src/tools/ProjectDashboardTool/index.test.ts`
  - 验证：`npm test -- src/tools/ProjectDashboardTool/index.test.ts`（通过，3 tests）
  - 完成标准：支持 `list/get`，只读，失败不编造。

- [x] 3. 接入 Agent 和回放评测
  - 文件：`src/main.ts`, `src/evals/replay.ts`, `docs/capabilities.md`, `README.md`
  - 验证：`npm test -- src/services/project-dashboard-service.test.ts src/tools/ProjectDashboardTool/index.test.ts && npm run eval:replay`（通过，6 tests；replay 9/9）
  - 完成标准：系统提示要求回答项目状态前使用驾驶舱，replay 覆盖项目状态查询。

- [x] 4. 最终验证与提交
  - 验证：`npm test`（219 tests）, `npm run typecheck`, `npm run build`, `npm run eval:replay`（9/9）, `git diff --check`
  - 完成标准：全部通过，提交中文 commit。
