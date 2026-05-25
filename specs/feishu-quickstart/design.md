# 设计

## 命令

在现有 `oa setup feishu` 下新增子命令：

```bash
oa setup feishu quickstart
oa setup feishu quickstart --app cbt-app --open-id ou_xxx --profile my-new-company --label 曹博弢
oa setup feishu quickstart --app cbt-app --open-id ou_xxx --profile my-new-company --dry-run
```

## 数据来源

- lark-cli profiles：通过现有 `runLarkCli(['profile', 'list'])` 获取。
- 飞书消息用户：读取 `~/.office-agent/feishu-recipients.json`。
- Agent 映射：读取 `FEISHU_MULTI_USER_CONFIG` 或默认 `./feishu-users.json`。
- appSecret：只写 `${ENV_NAME}` 引用，不读取或打印真实值。

## 写入策略

- `--dry-run` 只打印将写入的 JSON。
- 正式写入使用 `writeJsonFileAtomic`。
- 如果目标 app 已存在，更新或追加 users。
- 如果目标 app 不存在，要求有 `--app-id`，或能从选中的 profile 推断 `appId`。
- 如果已有 `openId=ou_xxx` 占位用户，优先替换该占位。

## 缺参数行为

缺少 `openId` 或 `profile` 时，输出：

- 当前候选 profile。
- 当前候选飞书消息用户。
- 推荐命令。

## 安全

- 不写真实 secret 到 JSON。
- 不修改 `~/.lark-cli/config.json`。
- 不执行 `profile remove`、`auth login` 等破坏或交互命令。

## 测试

- profile list 成功/失败。
- 新建配置文件。
- 更新已有 app 的占位用户。
- 更新已有真实用户绑定。
- dry-run 不落盘。
