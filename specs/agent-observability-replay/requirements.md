# Agent 可观测性与 CLI 回放测试

## 目标

让多用户飞书 Agent 更容易排查，并用 fake lark-cli 场景保护关键工具调用行为，减少真实飞书环境变化导致的回归。

## 用户故事

- 作为部署者，我可以用 `oa debug users` 查看本机有哪些飞书用户、对应 app/openId、最近 chat 和数据目录。
- 作为部署者，我可以用 `oa debug user <userKey>` 查看某个用户的数据目录、最近任务账本和主动推送收件人。
- 作为部署者，我可以用 `oa debug last --user <userKey>` 查看某个用户最近一轮工具执行摘要。
- 作为部署者，我可以用 `oa debug logs --tail 80` 查看最新日志尾部。
- 作为开发者，我可以在无飞书 key、无真实网络的情况下回放 LarkCliTool 的关键场景。

## 接受标准

- 新增 `oa debug` CLI 子命令，并支持 `users`、`user`、`last`、`feishu-profiles`、`logs`。
- debug 输出不得包含 app secret、API key、token。
- debug 能处理旧目录名和新 `appKey:openId` safe 目录名。
- LarkCliTool 支持注入 fake runner，单测覆盖 profile 注入、写操作指导、docs/base 参数防错。
- README 和能力矩阵更新。

## 非目标

- 不做 Web UI。
- 不直接修改用户数据。
- 不真实调用飞书 OpenAPI。
- 不实现长任务恢复，只为后续恢复能力补齐可观测基础。

## 测试要求

- `debug` 命令使用临时目录单测。
- fake lark-cli replay 不依赖真实 `@larksuite/cli`。
- 继续跑全量 `npm test`、`typecheck`、`build`、`eval:replay`。
