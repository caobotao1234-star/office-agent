# 任务清单

- [x] 1. 新增 quickstart 命令实现
  - 文件：`src/cli/commands/setup.ts`
  - 验证：`npm test -- src/cli/commands/setup.test.ts`（通过，6 tests）
  - 完成标准：可诊断、可 dry-run、可写入/更新 `feishu-users.json`。

- [x] 2. 补充 README
  - 文件：`README.md`, `docs/capabilities.md`
  - 验证：人工检查 + `npm run typecheck`（通过）
  - 完成标准：说明 quickstart、profile 存储位置、删除 profile 命令。

- [x] 3. 全量验证并提交
  - 验证：`npm test`（35 files / 182 tests 通过）、`npm run typecheck`（通过）、`npm run build`（通过）、`npm run eval:replay`（5/5 通过）、`git diff --check`（通过）、`npx tsx src/cli/index.ts setup feishu quickstart --dry-run`（通过）、`npx tsx src/cli/index.ts debug logs --tail 1`（通过）
  - 完成标准：全部通过并提交。
