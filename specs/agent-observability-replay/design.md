# 设计

## CLI Debug

新增 `src/cli/commands/debug.ts`：

- `buildDebugReport(args, options)`：纯函数式入口，便于测试。
- 默认数据目录：`~/.office-agent`。
- 读取：
  - `feishu-recipients.json`
  - `users/*`
  - `operation-ledger.json`
  - 最新 `logs/agent-*.log`
- 输出纯文本报告，避免引入交互 UI。

用户定位规则：

1. 如果参数等于 `appKey:openId`，优先用 `safeFeishuUserKey` 找目录；如果不存在，再兼容早期 `users/<openId>` 目录。
2. 如果参数等于 users 目录名，直接使用。
3. 如果匹配 recipient 的 `senderId` 或 `appKey:senderId`，映射到 userKey，并同样兼容早期 openId 目录。
4. 找不到时输出候选用户。

## LarkCli Fake Replay

调整 `LarkCliTool` 构造函数支持 runner 注入：

```ts
constructor(
  private knowledgeBase = new LarkCliKnowledgeBase(),
  private runner = runLarkCli,
) {}
```

新增 fake runner 测试，模拟：

- 写命令未查看 help 前被拦截。
- help 后同命令可执行。
- 当前飞书用户有 profile 时自动加 `--profile`。
- Base/docs 已知错误在 runner 前被拦截。

## 安全

- debug 输出只展示 profile 名称、appKey、openId、chatId、文件名、账本摘要。
- 不打印 appSecret。
- 日志 tail 是用户显式调用 debug 时输出，本身可能包含用户业务内容；命令名体现调试用途。

## 性能

- 用户目录只扫一层。
- 日志只读取最新文件尾部，默认 80 行。
