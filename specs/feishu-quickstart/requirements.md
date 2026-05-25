# 飞书 Quickstart 配置向导

## 目标

把“飞书消息用户 openId -> 本机 lark-cli profile”的配置从手动编辑 JSON，收敛成一个可验证、可重复运行的 CLI 命令，降低首次接入和新增用户成本。

## 用户故事

- 作为新用户，我可以运行 `oa setup feishu quickstart`，看到当前 profile、飞书消息用户和推荐绑定命令。
- 作为部署者，我可以运行带参数的 quickstart，自动创建或更新 `feishu-users.json`。
- 作为部署者，我可以把某个飞书 openId 绑定到指定 `lark-cli` profile，而不用手动改 JSON。
- 作为部署者，我可以在命令输出里看到下一步验证命令。

## 接受标准

- `oa setup feishu quickstart` 支持无参数诊断和带参数写入。
- 支持参数：`--app`、`--open-id`、`--profile`、`--label`、`--app-id`、`--secret-env`、`--config`、`--dry-run`。
- 当缺少必要参数时，不写文件，输出候选项和可复制命令。
- 写入时使用原子写入，不输出真实 appSecret。
- 已有用户绑定应更新 `cliProfile`/`label`，而不是重复追加。
- 如果配置文件不存在，可以在参数足够时创建。
- 更新 README 和测试。

## 非目标

- 不自动创建飞书开放平台应用。
- 不自动登录飞书用户，仍使用官方 `lark-cli auth login`。
- 不改官方 `~/.lark-cli/config.json`。
- 不实现复杂 TUI 交互。

## 测试要求

- 使用临时目录测试写入 `feishu-users.json`。
- 使用 fake lark-cli runner 测试 profile 读取。
- 不调用真实飞书网络。
