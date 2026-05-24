# 飞书接入体验与诊断加固

## 目标

把飞书多用户接入从“能配置”推进到“容易配置、容易诊断、不会误用密钥或授权”。

## 用户故事

- 作为部署者，我可以运行一个本地向导，看到当前 CLI profile、下一步命令、`feishu-users.json` 示例和开放平台待办项。
- 作为部署者，我可以在 `feishu-users.json` 中使用环境变量引用 app secret，避免把真实 secret 写进可提交文件。
- 作为未绑定的飞书用户，我给 bot 发消息时会收到可复制的绑定片段，而不是只看到泛泛的错误。
- 作为部署者，我可以通过 `oa doctor` 看到更具体的飞书 CLI/profile/权限探测结果。

## 接受标准

- 新增 `oa setup feishu` 命令，输出当前 profile 列表、推荐配置流程、可复制的 `feishu-users.json` 片段和开放平台检查清单。
- `oa feishu setup` 复用同一套向导文案，避免两份流程不一致。
- `feishu-users.json` 支持 `${ENV_NAME}` 和 `$ENV_NAME` 引用，解析时必须从环境变量取真实值；缺失时启动/doctor 明确报错。
- 未绑定飞书用户收到回复时，包含 appKey、openId 和 JSON 绑定片段。
- `oa doctor` 除 auth 外，抽样检查已配置 profile 的至少一个只读 CLI 探测命令，并给出权限/登录失败建议。
- 所有新增逻辑有单元测试，无真实飞书 API/key 依赖。

## 非目标

- 不自动点击或替代飞书开放平台后台配置。
- 不把真实 app secret 写入 README、示例文件或测试 fixture。
- 不实现 Web UI。
- 不对生产飞书 API 做真实写入测试。

## 环境与兼容性

- 保持现有 `oa feishu <args...>` 透传行为。
- 兼容旧单用户 `.env` 写法。
- 多用户配置继续支持 100+ 用户，doctor 只抽样检测 profile，避免启动慢。
