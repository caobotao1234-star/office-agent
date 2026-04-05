# Contributing to Office Agent

感谢你对 Office Agent 的关注！

## 开发环境

```bash
git clone https://github.com/你的用户名/office-agent.git
cd office-agent
npm install
cp .env.example .env
# 编辑 .env 填入 DASHSCOPE_API_KEY
npm test           # 确认环境正常
npm start          # 启动 CLI
```

## 代码规范

- TypeScript strict mode
- ESM modules（`"type": "module"`）
- Zod v4 做 schema 验证，`zodToJsonSchema()` 自动转换
- 工具用 Tool 接口，技能用 SKILL.md 格式

## 添加新工具

1. 在 `src/tools/YourTool/index.ts` 创建工具类
2. 实现 `Tool` 接口（name, description, inputSchema, call）
3. 在 `src/main.ts` 的 `createOfficeAgent` 中注册
4. 更新测试中的工具数量

## 添加新技能

1. 在 `src/skills/bundled/your-skill.md` 创建 SKILL.md 文件
2. YAML frontmatter 包含 name, description, when_to_use, allowed_tools, execution_mode
3. 在 `src/core/slash-command.ts` 的 `COMMAND_MAP` 中注册斜杠命令

## 提交规范

使用 conventional commits：
- `feat:` 新功能
- `fix:` 修复
- `refactor:` 重构
- `docs:` 文档
- `test:` 测试
- `chore:` 杂项

## 测试

```bash
npm test           # 运行所有测试
npm run typecheck  # 类型检查
```
