# 任务清单

- [x] 1. QueryEngine 坏 JSON 参数 repair
  - 文件：`src/core/query-engine.ts`, `src/core/query-engine.test.ts`
  - 验证：`npm test -- src/core/query-engine.test.ts`

- [x] 2. LarkCliTool 长文档内容 stdin 归一化
  - 文件：`src/tools/LarkCliTool/index.ts`, `src/tools/LarkCliTool/index.test.ts`, `src/tools/LarkCliTool/index.replay.test.ts`
  - 验证：`npm test -- src/tools/LarkCliTool/index.test.ts src/tools/LarkCliTool/index.replay.test.ts`

- [x] 3. Prompt 和文档更新
  - 文件：`src/main.ts`, `README.md`, `docs/capabilities.md`
  - 验证：`printf '<title>Dry Run</title>\n# Body with "quotes"' | npm run lark -- docs +create --api-version v2 --doc-format markdown --content - --as user --dry-run`

- [x] 4. 全量验证
  - 验证：`npm test`, `npm run typecheck`, `npm run build`, `npm run eval:replay`, `git diff --check`
