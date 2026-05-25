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
