# 飞书聊天自动同步设计

## 架构概览

新增一层轻量的聊天自动同步控制：

```text
Feishu WS event
  -> feishu-message-parser 解析 chat_type / mention
  -> 群聊:
       1. 解析群归属 owner
       2. 自动登记 chat_messages 同步源
       3. 未唤醒则停止，不进入 LLM
       4. 唤醒才排队进入 OfficeAgent
  -> 私聊 bot 会话:
       直接进入 OfficeAgent

用户要求同步 P2P 私聊
  -> Agent 使用 FeishuIngestTool addSource
  -> source: chat_messages + userId
  -> FeishuSyncScheduler 周期性拉取
```

## 模块划分

- `src/server/feishu-message-parser.ts`
  - 增加 `chatType`、`hasMention` 字段。
  - 保持原有 text/post/image/audio 解析兼容。

- `src/services/feishu-observed-chat-store.ts`
  - 持久化 `appKey + chatId -> ownerOpenId/userKey/syncSourceId`。
  - 只保存归属和同步元信息，不保存聊天原文。

- `src/services/feishu-chat-auto-sync.ts`
  - 解析环境配置。
  - 判断群聊是否应触发 Agent。
  - 构造群聊/私聊同步源。

- `src/server/feishu-bot.ts`
  - 群聊消息先走自动同步登记。
  - 默认只有 mention 或命令触发对话 Agent。
  - 群聊归属到已配置用户后，后续群消息用归属用户的 Agent/CLI profile。

- `src/main.ts`
  - 更新系统提示词，明确私聊同步注册路径。

## 数据结构

`feishu-observed-chats.json`：

```json
{
  "chats": [
    {
      "appKey": "team",
      "chatId": "oc_xxx",
      "chatType": "group",
      "ownerOpenId": "ou_xxx",
      "ownerUserKey": "team:ou_xxx",
      "ownerSafeUserKey": "team_3Aou_xxx",
      "syncSourceId": "auto-group-chat:team:oc_xxx",
      "title": "群聊 oc_xxx",
      "createdAt": "...",
      "updatedAt": "...",
      "lastObservedAt": "...",
      "lastMessageId": "om_xxx"
    }
  ]
}
```

同步源继续写入每个用户自己的 `feishu-sync-sources.json`：

```json
{
  "type": "chat_messages",
  "args": [
    "im", "+chat-messages-list",
    "--chat-id", "oc_xxx",
    "--page-size", "50",
    "--sort", "desc",
    "--format", "json",
    "--as", "user"
  ]
}
```

P2P 私聊同步源使用：

```text
im +chat-messages-list --user-id <open_id> --page-size 50 --sort desc --format json --as user
```

## 配置

- `FEISHU_GROUP_AUTO_SYNC`：默认 `true`。群聊是否自动登记为同步源。
- `FEISHU_GROUP_AGENT_TRIGGER_MODE`：默认 `mention`。可选 `mention | all | never`。
- `FEISHU_GROUP_AUTO_OWN_SINGLE_USER`：默认 `true`。单用户 app 的群聊自动归属到唯一配置用户。
- `FEISHU_GROUP_SYNC_PAGE_SIZE`：默认 `50`。

后台实际轮询仍由已有配置控制：

- `FEISHU_SYNC_INTERVAL_MINUTES`
- `FEISHU_SYNC_ON_START`

## 错误处理

- 无法确定群归属：只记录日志，不触发 Agent，不登记同步源。
- 群归属用户缺 `cliProfile`：不登记同步源，并在明确唤醒时回复配置问题。
- `lark-cli` 同步失败：复用 `FeishuIngestTool` 的 `lastError` 和日志。

## 性能考虑

- 群聊事件处理不调用 LLM。
- 同步源只记录一个 `chat_messages` 源，不按消息逐条写上下文。
- 定时同步批量拉取，变更 hash 相同则跳过后续处理。

## 安全考虑

- 不跨用户 fallback CLI profile。
- 不把群聊归属自动分配给多用户 app 中的任意用户。
- 不保存原始事件里的 appSecret/token。

## 测试策略

- `feishu-message-parser.test.ts`：验证 `chat_type`、mention、cleanText。
- `feishu-observed-chat-store.test.ts`：验证归属持久化、更新、过滤。
- `feishu-chat-auto-sync.test.ts`：验证触发策略和同步源构造。
- 相关 FeishuIngestTool 测试验证 `userId` 私聊参数。
