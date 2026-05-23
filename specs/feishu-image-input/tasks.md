# 飞书图片输入恢复任务

## T1 历史确认与 Spec

- 状态：DONE
- 文件：`specs/feishu-image-input/*`
- 实现说明：确认历史提交里有图片输入实现，当前 HEAD 已丢失运行时代码；记录恢复设计。
- 验证命令：`git log --all --oneline --grep='image\\|图片\\|vision\\|multimodal\\|多模态'`
- 完成标准：spec 文件齐全。

## T2 LLM 多模态类型与 QueryEngine

- 状态：DONE
- 文件：`src/core/llm-client.ts`、`src/core/query-engine.ts`、`src/core/query-engine.test.ts`
- 实现说明：支持临时图片输入和视觉能力判断，不持久化 base64 图片。
- 验证命令：`npm test -- src/core/query-engine.test.ts`
- 完成标准：多模态 content 构造测试通过。

## T3 Provider 视觉能力

- 状态：DONE
- 文件：`src/core/dashscope-llm.ts`、`src/core/deepseek-llm.ts`、`src/core/llm-provider.ts`、`src/core/llm-provider.test.ts`
- 实现说明：DeepSeek 标记为非视觉，DashScope qwen-vl/qwen-omni 模型标记为视觉。
- 验证命令：`npm test -- src/core/llm-provider.test.ts`
- 完成标准：provider 能力测试通过。

## T4 飞书图片与富文本图片处理

- 状态：DONE
- 文件：`src/server/feishu-bot.ts`
- 实现说明：恢复 `image`/`post` 处理，非视觉模型降级为提示并继续处理文字。
- 验证命令：`npm run typecheck`
- 完成标准：类型检查通过，日志能看到图片下载/降级路径。

## T5 文档、验证与提交

- 状态：DONE
- 文件：`README.md`、`.env.example`、全部变更
- 实现说明：更新多模态说明，跑全量验证并提交。
- 验证命令：`npm test && npm run typecheck && npm run build && node dist/cli/index.js --help && npm run eval:replay`
- 完成标准：验证通过并提交。
