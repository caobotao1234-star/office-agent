/**
 * `oa feishu ...` — pass-through bridge to the official lark-cli.
 */
import { runLarkCliInteractive } from '../../services/lark-cli-runner.js';
import { logger } from '../../core/logger.js';

const HELP = `
Office Agent 飞书 CLI 桥接

用法:
  oa feishu setup                 查看首次配置流程
  oa feishu doctor                运行 lark-cli doctor
  oa feishu status                查看授权状态
  oa feishu login                 登录用户身份（权限由开放平台应用授权决定）
  oa feishu <lark-cli args...>    透传任意 lark-cli 命令

示例:
  oa feishu docs +fetch --url "https://..."
  oa feishu im +messages-send --chat-id oc_xxx --text "hello" --dry-run
  oa feishu schema im.messages.create

说明:
  这里的 feishu 和 lark 是同一个官方 CLI：lark-cli。
  真正的权限由飞书开放平台应用权限、应用可用范围、以及 user/bot 身份决定。
`.trim();

const SETUP = `
飞书 CLI 首次配置流程:

1. 初始化或绑定飞书开放平台应用:
   oa feishu config init

2. 登录用户身份:
   oa feishu login

3. 检查授权状态:
   oa feishu status

4. 运行健康检查:
   oa feishu doctor

5. 回到 Agent:
   oa chat

在 Agent 里直接说“读取这个飞书文档 ...”或“把这段内容写入飞书文档 ...”，Agent 会调用 LarkCli 工具执行。
`.trim();

export async function feishu(rawArgs: string[]): Promise<void> {
  logger.enableFileLogging();
  logger.setLevel((process.env['LOG_LEVEL'] as any) ?? 'info');

  const args = expandAlias(rawArgs);

  if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
    console.log(HELP);
    console.log('\n--- lark-cli 原生帮助 ---\n');
    const code = await runLarkCliInteractive(['--help']);
    if (code && code !== 0) process.exit(code);
    return;
  }

  if (args[0] === 'setup') {
    console.log(SETUP);
    return;
  }

  const code = await runLarkCliInteractive(args);
  if (code && code !== 0) process.exit(code);
}

function expandAlias(args: string[]): string[] {
  const [first, ...rest] = args;
  switch (first) {
    case 'doctor':
      return ['doctor', ...rest];
    case 'status':
      return ['auth', 'status', ...rest];
    case 'login':
      return ['auth', 'login', '--recommend', '--domain', 'all', ...rest];
    default:
      return args;
  }
}
