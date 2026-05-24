# 任务清单

- [x] 1. 新增 `oa debug` 命令
  - 文件：`src/cli/commands/debug.ts`, `src/cli/index.ts`
  - 验证：`npm test -- src/cli/commands/debug.test.ts`（通过，6 tests）
  - 完成标准：支持 users/user/last/feishu-profiles/logs。

- [x] 2. LarkCliTool 支持 fake runner 并补 replay 单测
  - 文件：`src/tools/LarkCliTool/index.ts`, `src/tools/LarkCliTool/index.replay.test.ts`
  - 验证：`npm test -- src/tools/LarkCliTool/index.replay.test.ts`（通过，3 tests）
  - 完成标准：无需真实 CLI 即可验证关键调用链路。

- [x] 3. 更新文档与能力矩阵
  - 文件：`README.md`, `docs/capabilities.md`
  - 验证：人工检查 + `npm run typecheck`（通过）
  - 完成标准：用户能从 README 找到 debug 用法。

- [x] 4. 全量验证并提交
  - 验证：`npm test`（35 files / 178 tests 通过）、`npm run typecheck`（通过）、`npm run build`（通过）、`npm run eval:replay`（5/5 通过）、`git diff --check`（通过）、`npx tsx src/cli/index.ts debug users`（通过）
  - 完成标准：全部通过并提交。
