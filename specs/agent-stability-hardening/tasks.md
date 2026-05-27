# 任务清单

- [x] 1. 启动前 preflight
  - 文件：`src/services/feishu-startup-preflight.ts`, `src/services/feishu-startup-preflight.test.ts`, `src/server/feishu-bot.ts`
  - 验证：`npm test -- src/services/feishu-startup-preflight.test.ts`（通过，4 tests）
  - 完成标准：缺 profile/auth/appId mismatch 会 fail，明文 secret warn。

- [x] 2. 飞书 CLI 稳定重试
  - 文件：`src/tools/LarkCliTool/index.ts`, `src/tools/LarkCliTool/index.replay.test.ts`
  - 验证：`npm test -- src/tools/LarkCliTool/index.replay.test.ts`（通过，6 tests）
  - 完成标准：读/安全写瞬时错误会重试，不安全写不会盲目重试。

- [x] 3. 任务中断恢复
  - 文件：`src/core/operation-ledger.ts`, `src/core/operation-ledger.test.ts`, `src/core/slash-command.ts`, `src/main.ts`
  - 验证：`npm test -- src/core/operation-ledger.test.ts src/core/slash-command.test.ts`（通过，17 tests）
  - 完成标准：`/resume` 和“继续刚才的任务”能生成恢复请求。

- [x] 4. 文档和全量验证
  - 文件：`README.md`, `docs/capabilities.md`
  - 验证：`npm test`（191 tests）, `npm run typecheck`, `npm run build`, `npm run eval:replay`（5/5）, `git diff --check`（通过）
  - 完成标准：全部通过并提交。

- [x] 5. 新增 `oa smoke`
  - 文件：`src/cli/commands/smoke.ts`, `src/cli/index.ts`, `src/cli/commands/smoke.test.ts`
  - 验证：`npm test -- src/cli/commands/smoke.test.ts`（通过，2 tests）
  - 完成标准：默认无真实写入、无真实 LLM 调用，可检查 doctor、工具 schema 和飞书 CLI dry-run。

- [x] 6. 扩展 replay eval 覆盖近期失败
  - 文件：`src/evals/replay.ts`
  - 验证：`npm run eval:replay`（通过，8/8）
  - 完成标准：新增用例覆盖 docs stdin、Base 正确参数和坏 JSON 修复/降级。

- [x] 7. Lark CLI recipe 指导
  - 文件：`src/services/lark-cli-recipes.ts`, `src/tools/LarkCliTool/index.ts`, 相关测试
  - 验证：`npm test -- src/services/lark-cli-recipes.test.ts src/tools/LarkCliTool/index.test.ts`（通过，15 tests）
  - 完成标准：未看 help/dry-run 或常见参数错误时，ToolResult 带可读 recipe。

- [x] 8. 写操作副作用账本
  - 文件：`src/services/operation-idempotency-ledger.ts`, `src/core/query-engine.ts`, `src/main.ts`
  - 验证：`npm test -- src/services/operation-idempotency-ledger.test.ts src/core/query-engine.test.ts`（通过，22 tests）
  - 完成标准：非 read-only 工具执行前后持久化写操作状态，供恢复和排查使用。

- [x] 9. Session 按模型隔离
  - 文件：`src/core/query-engine.ts`, `src/core/query-engine.test.ts`
  - 验证：`npm test -- src/core/query-engine.test.ts`（通过，20 tests）
  - 完成标准：同 channel 不同 model 不恢复旧历史。

- [x] 10. 主动提醒投递可靠性
  - 文件：`src/services/notification-service.ts`, `src/services/agenda-scheduler.ts`, 相关测试
  - 验证：`npm test -- src/services/notification-service.test.ts src/services/agenda-scheduler.test.ts`（通过，11 tests）
  - 完成标准：通知全失败不标记 delivered，保持 pending 等待下次补发。

- [x] 11. 文档和最终验证
  - 文件：`README.md`, `docs/capabilities.md`
  - 验证：`npm test`（213 tests）, `npm run typecheck`, `npm run build`, `npm run eval:replay`（8/8）, `OFFICE_AGENT_DOCTOR_SKIP_FEISHU_PROBES=1 npx tsx src/cli/index.ts smoke --skip-feishu`（0 fail, 4 warn, 8 ok）, `git diff --check`
  - 完成标准：文档同步，关键测试通过。
