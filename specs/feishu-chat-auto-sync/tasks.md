# 飞书聊天自动同步任务

## T1 规格与边界

- 状态：DONE
- 文件：`specs/feishu-chat-auto-sync/*`
- 实现说明：定义群聊轻量入库、私聊注册同步、多用户隔离和非目标。
- 验证命令：文档审阅。
- 完成标准：需求、设计、任务清单齐全。

## T2 消息解析和群聊触发策略

- 状态：DONE
- 文件：`src/server/feishu-message-parser.ts`、`src/services/feishu-chat-auto-sync.ts`、测试。
- 实现说明：解析 `chat_type`/mention；默认群聊 mention 才触发 Agent。
- 验证命令：`npm test -- src/services/feishu-chat-auto-sync.test.ts src/server/feishu-message-parser.test.ts`
- 完成标准：群聊普通消息不触发，mention/all/never 模式可测。

## T3 群聊归属和自动同步源

- 状态：DONE
- 文件：`src/services/feishu-observed-chat-store.ts`、`src/server/feishu-bot.ts`、测试。
- 实现说明：记录 `appKey + chatId -> owner`，自动为 owner 的 Agent 登记群聊 `chat_messages` 同步源。
- 验证命令：`npm test -- src/services/feishu-observed-chat-store.test.ts`
- 完成标准：归属可持久化，单用户自动归属，多用户不乱绑。

## T4 私聊注册同步指引

- 状态：DONE
- 文件：`src/main.ts`、`src/tools/FeishuIngestTool/index.test.ts`、文档。
- 实现说明：提示 Agent 对“同步我和某人的私聊”先查联系人再登记 `chat_messages --user-id`。
- 验证命令：`npm test -- src/tools/FeishuIngestTool/index.test.ts`
- 完成标准：私聊同步源参数稳定，文档说明清楚。

## T5 全量验证和提交

- 状态：DONE
- 文件：相关测试、README、能力矩阵。
- 实现说明：跑相关测试、typecheck/build/diff check 后提交。
- 验证命令：`npm test && npm run typecheck && npm run build && git diff --check`
- 完成标准：测试通过，中文提交信息完整。
