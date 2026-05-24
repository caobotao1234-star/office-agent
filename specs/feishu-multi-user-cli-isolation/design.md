# 设计

## 架构

飞书入口拆成三层：

1. 配置层读取 `.env` 和可选 JSON 配置，得到多个 `FeishuAppConfig`。
2. 运行层为每个 app 启动独立的 Lark Client 和 WSClient。
3. 用户层按 `appKey + openId` 解析 `FeishuUserRuntime`，创建独立 Agent，并把 `larkCliProfile` 注入 ToolContext。

LarkCliTool 不关心飞书 SDK，只消费 ToolContext：

```ts
{
  feishuAppKey?: string;
  feishuUserKey?: string;
  larkCliProfile?: string;
}
```

这样 CLI 隔离不会污染普通 CLI chat，也不会要求其他工具理解飞书配置。

## 配置格式

推荐 `.env`：

```env
FEISHU_MULTI_USER_CONFIG=./feishu-users.json
```

推荐 JSON：

```json
{
  "apps": [
    {
      "key": "alice-app",
      "appId": "cli_xxx",
      "appSecret": "secret",
      "users": [
        { "openId": "ou_xxx", "cliProfile": "alice", "label": "Alice" }
      ]
    }
  ]
}
```

`defaultCliProfile` 只在显式设置 `allowUnmappedUsersWithDefaultProfile: true` 时用于未列出的用户。默认不允许未映射用户落到默认 profile，避免用户 2 写到用户 1 的账户。

旧配置兼容：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_CLI_PROFILE=alice
```

旧配置会生成一个 `key=default` 的 app，并允许未映射用户使用默认 profile，保持单人部署可用；多用户场景应切换到 JSON 显式绑定。

## 数据隔离

- Agent 数据目录：`~/.office-agent/users/<safeUserKey>`
- 会话 channel：`feishu-<safeUserKey>`
- 消息队列：按 `userKey` 串行
- 主动提醒收件人：记录 `appKey`、`senderId`、`chatId`
- 日程、记忆、上下文、wiki、token usage：都落在用户自己的数据目录

## 错误处理

- 配置文件缺失、JSON 不合法、app key 重复、用户绑定重复：启动失败并写日志。
- 用户未绑定 CLI profile：普通对话仍可处理，但 LarkCliTool 调用会失败并返回配置指导。
- `lark-cli` 权限不足或未登录：保留 CLI stdout/stderr，Agent 应向用户报告真实权限/授权错误。

## 测试策略

- 配置解析单测：JSON、多 app、重复项、旧配置兼容、用户解析。
- LarkCliTool 单测：profile 注入、已有 profile 不重复注入、飞书用户无 profile 快速失败。
- 收件人存储单测：保存并按 appKey 过滤。
- 最后运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run eval:replay`。

## 安全与性能

- App Secret 不写入日志。
- CLI profile 名称不视为 secret，但日志只记录 profile 是否存在和必要标识。
- 100+ 用户只影响 Map 查找和本地 JSON 配置解析，运行时按消息触发创建 Agent，不预先加载所有用户 Agent。
