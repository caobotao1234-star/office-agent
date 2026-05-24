# 设计

## 模块划分

- `src/cli/commands/setup.ts`：新增 `oa setup feishu` 入口，负责输出确定性向导，不做真实写入。
- `src/cli/commands/feishu.ts`：`oa feishu setup` 调用同一套向导。
- `src/server/feishu-multi-user-config.ts`：解析 app secret 的 env 引用，并生成未知用户绑定提示。
- `src/server/feishu-bot.ts`：未绑定用户回复附带可复制 JSON 片段。
- `src/cli/commands/doctor.ts`：抽样 profile 做 `auth status` 和只读 capability probe。

## 数据结构

`appSecret` 支持三种形式：

- `"plain-secret"`：兼容旧配置。
- `"${FEISHU_APP_SECRET_MY_COMPANY}"`：推荐。
- `"$FEISHU_APP_SECRET_MY_COMPANY"`：简写。

解析后的 `FeishuAppConfig.appSecret` 始终是真实 secret；日志和 doctor 不输出 secret。

未知用户提示片段：

```json
{
  "openId": "ou_xxx",
  "cliProfile": "填写该用户本机 lark-cli profile",
  "label": "填写用户名字"
}
```

## 错误处理

- env 引用缺失：抛出明确错误，包含缺失的环境变量名，不包含 secret 值。
- profile 探测失败：doctor 返回 warn，不阻塞其他检查。
- CLI 探测命令不存在或权限不足：doctor 返回 warn，并保留简短 stdout/stderr 摘要。

## 测试策略

- 配置解析单测：`${ENV}` / `$ENV` / 缺失 env。
- 未绑定提示单测：输出包含 openId、appKey、JSON 片段。
- setup 命令单测：不调用真实网络，使用 fake runner。
- doctor 单测：profile auth + probe 抽样、失败降级。

## 安全

- 示例和日志不包含真实 secret。
- `feishu-users.json` 加入 `.gitignore` 已有，继续保持。
- doctor 输出 profile 名称和 openId mask，但不输出用户名、scope 长列表或 secret。
