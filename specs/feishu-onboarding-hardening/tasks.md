# 任务清单

- [x] 1. 配置解析支持 appSecret 环境变量引用
  - 文件：`src/server/feishu-multi-user-config.ts`
  - 验证：`npm test -- src/server/feishu-multi-user-config.test.ts`
  - 完成标准：支持 `${ENV}` / `$ENV`，缺失 env 报错清晰。

- [x] 2. 未绑定用户回复可复制绑定片段
  - 文件：`src/server/feishu-multi-user-config.ts`, `src/server/feishu-bot.ts`
  - 验证：相关单测和 typecheck
  - 完成标准：未绑定用户不会用默认授权，回复里包含 openId 和 JSON 片段。

- [x] 3. 新增 `oa setup feishu` 向导
  - 文件：`src/cli/index.ts`, `src/cli/commands/setup.ts`, `src/cli/commands/feishu.ts`
  - 验证：新增 CLI 单测和 help smoke
  - 完成标准：输出 profile 列表、推荐命令、JSON 示例、开放平台清单。

- [x] 4. 增强 `oa doctor` 飞书深度自检
  - 文件：`src/cli/commands/doctor.ts`
  - 验证：`npm test -- src/cli/commands/doctor.test.ts`
  - 完成标准：抽样 profile 做 auth 和只读 probe，失败给出具体建议。

- [x] 5. 更新 README / 示例 / 能力矩阵
  - 文件：`README.md`, `.env.example`, `feishu-users.example.json`, `docs/capabilities.md`
  - 验证：人工检查 + 全量测试
  - 完成标准：文档流程和实际命令一致。

- [x] 6. 全量验证并提交
  - 验证：`npm test`, `npm run typecheck`, `npm run build`, `npm run eval:replay`
  - 完成标准：全部通过并生成中文提交。
