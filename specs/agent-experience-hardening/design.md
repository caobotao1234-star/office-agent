# Agent 体验与稳定性加固设计

## 架构概览

本次加固保持当前核心架构不变：

- `OfficeAgent` 仍由 `createOfficeAgent()` 组装。
- LLM 工具调用仍由 `QueryEngine` 驱动。
- 飞书外部执行仍统一走官方 `LarkCliTool`。
- 主动提醒仍统一走 `AgendaTool/AgendaScheduler/ReminderComposer`。

新增的是外围工程护栏：

- 能力矩阵和回放 eval，防止能力回归。
- 飞书事件解析/下载/回复拆分，降低 bot 主文件复杂度。
- Lark CLI 帮助缓存，降低参数猜测。
- Operation ledger，记录一轮任务的执行状态。
- Sync 后自动知识抽取，增强主动获取信息能力。
- JsonStore 原子写，提升状态文件可靠性。
- Trace/debug 摘要，提升排障体验。
- `oa doctor`，提升配置自检体验。

## 模块边界

### 能力矩阵

- 新增 `docs/capabilities.md` 或 `src/evals/capability-matrix.ts`。
- 记录能力名称、输入示例、期望链路、降级行为、测试覆盖。
- `npm run eval:replay` 使用能力矩阵中的核心用例做回放。

### 飞书输入适配

- `src/server/feishu-message-parser.ts`
  - 负责把飞书 SDK event 解析成内部 `ParsedFeishuMessage`。
  - 输出类型包括 `text`、`post`、`image`、`audio`、`unsupported`。
  - 使用 zod 校验关键字段。

- `src/server/feishu-resource-downloader.ts`
  - 负责图片/音频资源下载。
  - 返回 data URL 或 Buffer。
  - 日志脱敏。

- `src/server/feishu-reply-sender.ts`
  - 负责长文本拆分、普通回复、主动提醒推送。

主 bot 文件只保留 WebSocket 注册、队列和 Agent 生命周期。

### Lark CLI 知识缓存

- `src/services/lark-cli-knowledge-base.ts`
  - 缓存 `lark-cli --help` 和子命令 `--help` 输出。
  - 以命令 key、CLI 版本、时间戳作为缓存元数据。
  - 提供 `getCachedHelp()`、`recordHelp()`、`listKnownCommands()`。

`LarkCliTool` 在 help/dry-run 成功时记录缓存；阻止写命令时优先返回缓存摘要。

### Operation Ledger

- `src/core/operation-ledger.ts`
  - 记录 `turnId`、用户输入摘要、工具调用、工具结果、最终回复、是否达到工具上限。
  - QueryEngine 在每轮开始创建 ledger，并在工具调用/结果/结束时更新。
  - Debug 命令读取最近一轮。

### Feishu Sync 自动抽取

- `FeishuIngestTool` 的 `syncSource/syncAll/fetchOnce` 输出变化内容摘要和 source refs。
- 新增受控抽取服务，检测 changed 后使用 `KnowledgeCaptureTool` 或 LLM JSON 提取管线生成上下文/记忆/日程。
- 默认限制每次抽取内容长度和 source 数量，避免 token 爆炸。

### JsonStore

- `src/services/json-store.ts`
  - `readJsonFile`
  - `writeJsonFileAtomic`
  - `backupCorruptJson`
  - schema parse fallback

逐步替换 AgendaStore、OfficeContextStore、FeishuSyncStore、FeishuRecipientStore 等重复读写逻辑。

### Trace 与 Debug

- 每轮消息分配 `turnId`。
- 日志字段包含 `turnId`、模块、模型、工具名、耗时、成功/失败。
- 新增 `/debug last` 和/或 `oa debug last` 展示最近一轮摘要。

### Doctor

- 新增 CLI 命令 `oa doctor`。
- 检查 `.env`、LLM provider/model、模型能力、lark-cli 可执行、auth status、飞书 bot 配置、日志目录、数据目录。
- 不要求真实联网成功；联网/认证失败要给明确建议。

## 数据结构

### CapabilityCase

```ts
interface CapabilityCase {
  id: string;
  area: string;
  title: string;
  input: string;
  expectedPath: string[];
  degradation?: string;
  coverage: 'unit' | 'replay' | 'manual' | 'missing';
}
```

### OperationLedgerEntry

```ts
interface OperationLedgerEntry {
  turnId: string;
  startedAt: Date;
  finishedAt?: Date;
  userMessagePreview: string;
  imageCount: number;
  model: string;
  tools: Array<{ name: string; inputPreview: string; success?: boolean; error?: string; durationMs?: number }>;
  finalTextPreview?: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
}
```

## 错误处理

- 飞书事件无法解析：记录 warn，回复可理解的“不支持/解析失败”。
- 图片/音频下载失败：不进入 LLM，直接告诉用户下载失败。
- CLI help 缓存损坏：忽略缓存并重新生成。
- JSON store 损坏：备份原文件，使用空态，日志标记 error。
- 自动抽取失败：不影响 sync 主流程，记录错误并在 sync 输出中暴露。

## 测试策略

- 单测覆盖 parser、downloader URL 构造、reply sender 分片、knowledge cache、operation ledger、json-store、doctor。
- QueryEngine 测试覆盖 ledger 和长任务部分失败提示。
- Replay eval 覆盖关键用户路径。
- 全量验证：`npm test && npm run typecheck && npm run build && npm run eval:replay`。

## 性能考虑

- CLI help 缓存按命令 key 命中，避免重复调用。
- Feishu sync 自动抽取默认限制内容长度和数量。
- Operation ledger 只保存摘要，不保存完整图片/base64。
- JsonStore 原子写只影响本地小 JSON 文件。

## 迁移说明

- 旧 JSON 文件格式保持兼容。
- 新增 store 或 metadata 字段时默认可缺省。
- 空目录清理不会影响 git tracked 文件。
