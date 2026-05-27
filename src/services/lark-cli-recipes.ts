export interface LarkCliRecipe {
  commandKey: string;
  summary: string;
  examples: string[];
  pitfalls: string[];
}

const RECIPES: Record<string, LarkCliRecipe> = {
  'docs +create': {
    commandKey: 'docs +create',
    summary: '创建飞书云文档。v2 Markdown 内容必须放在 --content，标题写进 <title>...</title>。',
    examples: [
      'docs +create --api-version v2 --doc-format markdown --content - --as user',
      'stdin: <title>标题</title>\\n# 正文',
    ],
    pitfalls: [
      '不要使用 --title、--markdown、--format。',
      '长正文或多行正文必须用 --content - + stdin，避免工具 JSON 被换行/引号破坏。',
      'markdown 正文缺少 <title>...</title> 时，容易创建 untitled 或空文档。',
    ],
  },
  'docs +update': {
    commandKey: 'docs +update',
    summary: '更新飞书云文档。指定 --doc、--command append|overwrite、--doc-format 和 --content。',
    examples: [
      'docs +update --api-version v2 --doc DOC_TOKEN --command append --doc-format markdown --content - --as user',
    ],
    pitfalls: [
      '长正文使用 --content - + stdin。',
      'append/overwrite 语义不同，覆盖前确认用户意图。',
    ],
  },
  'docs +fetch': {
    commandKey: 'docs +fetch',
    summary: '读取飞书云文档内容。',
    examples: [
      'docs +fetch --api-version v2 --doc DOC_TOKEN --doc-format markdown --as user',
    ],
    pitfalls: [
      '读取失败通常是 doc token、权限或 profile 授权问题。',
      '不要把读取动作误写成 docs +create。',
    ],
  },
  'base +base-create': {
    commandKey: 'base +base-create',
    summary: '创建飞书多维表格 Base。',
    examples: [
      'base +base-create --name "Office Agent 能力全景表" --as user',
      'base +base-create --name "Office Agent 能力全景表" --as user --dry-run',
    ],
    pitfalls: [
      '不要使用 base +create。',
      '不要使用 --title，Base 名称参数是 --name。',
      '通常不要加 --format json；如果需要过滤输出，优先看 --help 是否支持 -q。',
    ],
  },
  'base +table-create': {
    commandKey: 'base +table-create',
    summary: '在已有 Base 里创建表。',
    examples: [
      'base +table-create --base-token BASE_TOKEN --name "能力清单" --as user',
      'base +table-create --base-token BASE_TOKEN --name "能力清单" --fields \'[{"field_name":"能力","type":1}]\' --as user',
    ],
    pitfalls: [
      '不要使用 --base，正确参数是 --base-token。',
      '字段 JSON 必须作为一个完整字符串放进 args 数组，不能把 JSON 拆成多个参数。',
    ],
  },
  'base +field-create': {
    commandKey: 'base +field-create',
    summary: '在 Base 表里创建字段。',
    examples: [
      'base +field-create --base-token BASE_TOKEN --table-id TABLE_ID --json \'{"name":"类别","type":"text"}\' --as user',
    ],
    pitfalls: [
      '必须同时提供 --base-token、--table-id、--json。',
      '不要用 --field、--base 或 --format。',
    ],
  },
  'base +record-batch-create': {
    commandKey: 'base +record-batch-create',
    summary: '批量写入 Base 记录。',
    examples: [
      'base +record-batch-create --base-token BASE_TOKEN --table-id TABLE_ID --json \'{"fields":["能力","怎么用"],"rows":[["任务管理","直接说待办"]]}\' --as user',
    ],
    pitfalls: [
      '必须提供 --json，不要用 --records、--fields 或 --format。',
      '内层 JSON 必须作为字符串正确转义，保持整个 function.arguments 是严格 JSON。',
    ],
  },
  'im +messages-send': {
    commandKey: 'im +messages-send',
    summary: '向飞书会话发消息。',
    examples: [
      'im +messages-send --chat-id CHAT_ID --text "消息内容" --as user',
    ],
    pitfalls: [
      '发送消息是非幂等写操作，失败后先确认是否已发送，再重试。',
    ],
  },
  'calendar +agenda': {
    commandKey: 'calendar +agenda',
    summary: '读取日程议程。',
    examples: [
      'calendar +agenda --start-time 2026-05-26T00:00:00+08:00 --end-time 2026-05-27T00:00:00+08:00 --as user',
    ],
    pitfalls: [
      '时间必须带时区，避免跨日错误。',
    ],
  },
};

export function getLarkCliRecipe(commandKey: string | null | undefined): LarkCliRecipe | undefined {
  if (!commandKey) return undefined;
  return RECIPES[commandKey];
}

export function formatLarkCliRecipe(commandKey: string | null | undefined): string | undefined {
  const recipe = getLarkCliRecipe(commandKey);
  if (!recipe) return undefined;
  return [
    `${recipe.commandKey}: ${recipe.summary}`,
    'Examples:',
    ...recipe.examples.map((example) => `- ${example}`),
    'Pitfalls:',
    ...recipe.pitfalls.map((pitfall) => `- ${pitfall}`),
  ].join('\n');
}

export function listLarkCliRecipes(): LarkCliRecipe[] {
  return Object.values(RECIPES).sort((a, b) => a.commandKey.localeCompare(b.commandKey));
}
