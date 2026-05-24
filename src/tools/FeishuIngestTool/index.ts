import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import { runLarkCli, type LarkCliRunOptions, type LarkCliRunResult } from '../../services/lark-cli-runner.js';
import { applyLarkCliProfile, requiresCliProfile } from '../LarkCliTool/index.js';
import {
  FeishuSyncSourceTypeSchema,
  type FeishuSyncSource,
  type FeishuSyncSourceType,
  type FeishuSyncStore,
} from '../../services/feishu-sync-store.js';
import type { FeishuSyncAutoCapture, FeishuSyncCaptureResult } from '../../services/feishu-sync-knowledge-capture.js';
import type { OfficeContextSource, OfficeContextStore, OfficeContextType } from '../../services/office-context-store.js';

export type FeishuIngestRunner = (args: string[], options?: LarkCliRunOptions) => Promise<LarkCliRunResult>;

type FeishuIngestRunOptions = LarkCliRunOptions & {
  force?: boolean;
  larkCliProfile?: string;
  feishuUserKey?: string;
};

const IdentitySchema = z.enum(['user', 'bot']).default('user');

const SourceSpecSchema = z.object({
  type: FeishuSyncSourceTypeSchema,
  title: z.string().min(1),
  projectId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  syncEnabled: z.boolean().default(true),
  identity: IdentitySchema,
  doc: z.string().optional(),
  query: z.string().optional(),
  filter: z.string().optional(),
  token: z.string().optional(),
  objType: z.string().optional(),
  spaceId: z.string().optional(),
  chatId: z.string().optional(),
  userId: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  sort: z.enum(['asc', 'desc']).optional(),
  pageSize: z.number().int().positive().max(200).optional(),
  pageAll: z.boolean().default(false),
  pageLimit: z.number().int().positive().max(40).optional(),
  calendarId: z.string().optional(),
  baseToken: z.string().optional(),
  tableId: z.string().optional(),
  viewId: z.string().optional(),
  fieldIds: z.array(z.string()).default([]),
  limit: z.number().int().positive().max(200).optional(),
  completed: z.boolean().optional(),
  due: z.string().optional(),
  queries: z.string().optional(),
  userIds: z.string().optional(),
  hasChatted: z.boolean().default(false),
  rawArgs: z.array(z.string()).default([]),
});

const AddSourceInput = z.object({
  action: z.literal('addSource'),
  source: SourceSpecSchema,
});

const ListSourcesInput = z.object({
  action: z.literal('listSources'),
  type: FeishuSyncSourceTypeSchema.optional(),
  syncEnabled: z.boolean().optional(),
});

const RemoveSourceInput = z.object({
  action: z.literal('removeSource'),
  id: z.string().min(1),
});

const SyncSourceInput = z.object({
  action: z.literal('syncSource'),
  id: z.string().min(1),
  force: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(300_000).default(60_000),
  maxOutputBytes: z.number().int().positive().max(1024 * 1024).default(256 * 1024),
});

const SyncAllInput = z.object({
  action: z.literal('syncAll'),
  includeDisabled: z.boolean().default(false),
  force: z.boolean().default(false),
  limit: z.number().int().positive().max(100).default(20),
  timeoutMs: z.number().int().positive().max(300_000).default(60_000),
  maxOutputBytes: z.number().int().positive().max(1024 * 1024).default(256 * 1024),
});

const FetchOnceInput = z.object({
  action: z.literal('fetchOnce'),
  source: SourceSpecSchema,
  storeAsContext: z.boolean().default(true),
  timeoutMs: z.number().int().positive().max(300_000).default(60_000),
  maxOutputBytes: z.number().int().positive().max(1024 * 1024).default(256 * 1024),
});

const FeishuIngestToolInput = z.discriminatedUnion('action', [
  AddSourceInput,
  ListSourcesInput,
  RemoveSourceInput,
  SyncSourceInput,
  SyncAllInput,
  FetchOnceInput,
]);

export type FeishuIngestToolInput = z.infer<typeof FeishuIngestToolInput>;

export class FeishuIngestTool implements Tool<FeishuIngestToolInput, unknown> {
  readonly name = 'FeishuIngestTool';
  readonly description = [
    'Register, fetch, and synchronize Feishu/Lark sources so the agent can update its own office context without waiting for the user to paste content.',
    'Uses official read-only lark-cli commands for docs, docs search, wiki nodes, chat messages, message search, calendar agenda, Base records, tasks, contacts, and raw read commands.',
    'Use addSource to watch a source, syncSource/syncAll to refresh watched sources, and fetchOnce for one-off reads.',
    'When fetched content changes, this tool updates OfficeContextTool storage with source refs, content hash, and a searchable content preview.',
    'After sync returns changed content, call KnowledgeCaptureTool when deeper extraction of people, projects, deadlines, decisions, or relationships is useful.',
  ].join(' ');
  readonly inputSchema = FeishuIngestToolInput;

  constructor(
    private syncStore: FeishuSyncStore,
    private officeContextStore: OfficeContextStore,
    private runner: FeishuIngestRunner = runLarkCli,
    private autoCapture?: FeishuSyncAutoCapture,
  ) {}

  isEnabled(): boolean { return true; }

  isReadOnly(input: FeishuIngestToolInput): boolean {
    return input.action === 'listSources' || (input.action === 'fetchOnce' && !input.storeAsContext);
  }

  checkPermissions(_input: FeishuIngestToolInput): PermissionResult {
    return { allowed: true };
  }

  async call(input: FeishuIngestToolInput, context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'addSource': {
          const args = buildFeishuIngestArgs(input.source);
          const source = this.syncStore.upsert({
            type: input.source.type,
            title: input.source.title,
            args,
            projectId: input.source.projectId,
            tags: input.source.tags,
            syncEnabled: input.source.syncEnabled,
          });
          return { success: true, output: { source, args } };
        }
        case 'listSources': {
          return { success: true, output: this.syncStore.list({ type: input.type, syncEnabled: input.syncEnabled }) };
        }
        case 'removeSource': {
          const deleted = this.syncStore.delete(input.id);
          if (!deleted) return { success: false, output: null, error: `Feishu sync source not found: ${input.id}` };
          return { success: true, output: { deleted: true, id: input.id } };
        }
        case 'syncSource': {
          const source = this.syncStore.get(input.id);
          if (!source) return { success: false, output: null, error: `Feishu sync source not found: ${input.id}` };
          const output = await this.syncOne(source, {
            force: input.force,
            timeoutMs: input.timeoutMs,
            maxOutputBytes: input.maxOutputBytes,
            abortSignal: context.abortSignal,
            larkCliProfile: context.larkCliProfile,
            feishuUserKey: context.feishuUserKey,
          });
          return { success: output.success, output, error: output.success ? undefined : output.error };
        }
        case 'syncAll': {
          const sources = this.syncStore
            .list(input.includeDisabled ? {} : { syncEnabled: true })
            .slice(0, input.limit);
          const results = [];
          for (const source of sources) {
            results.push(await this.syncOne(source, {
              force: input.force,
              timeoutMs: input.timeoutMs,
              maxOutputBytes: input.maxOutputBytes,
              abortSignal: context.abortSignal,
              larkCliProfile: context.larkCliProfile,
              feishuUserKey: context.feishuUserKey,
            }));
          }
          return {
            success: results.every((result) => result.success),
            output: {
              count: results.length,
              changed: results.filter((result) => result.changed).length,
              failed: results.filter((result) => !result.success).length,
              results,
            },
          };
        }
        case 'fetchOnce': {
          const args = buildFeishuIngestArgs(input.source);
          const profileError = getMissingProfileError(args, context);
          if (profileError) return { success: false, output: { args, missingCliProfile: true }, error: profileError };
          const runArgs = applyLarkCliProfile(args, context.larkCliProfile);
          const result = await this.runner(runArgs, {
            timeoutMs: input.timeoutMs,
            maxOutputBytes: input.maxOutputBytes,
            abortSignal: context.abortSignal,
          });
          const content = normalizeFetchedContent(result.stdout);
          const contentHash = hashContent(content);
          let contextRecord = null;
          let autoCapture: FeishuSyncCaptureResult | undefined;
          if (result.exitCode === 0 && !result.timedOut && !result.aborted && input.storeAsContext) {
            contextRecord = this.upsertContext({
              source: {
                id: `fetch:${input.source.type}:${contentHash.slice(0, 12)}`,
                type: input.source.type,
                title: input.source.title,
                args,
                projectId: input.source.projectId,
                tags: input.source.tags,
                syncEnabled: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              result,
              content,
              contentHash,
              changed: true,
            });
            autoCapture = await this.autoCapture?.capture({
              source: {
                id: `fetch:${input.source.type}:${contentHash.slice(0, 12)}`,
                type: input.source.type,
                title: input.source.title,
                args,
                projectId: input.source.projectId,
                tags: input.source.tags,
                syncEnabled: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              result,
              content,
              contentHash,
            });
          }
          const success = result.exitCode === 0 && !result.timedOut && !result.aborted;
          return {
            success,
            output: {
              command: result.command,
              args,
              contentHash,
              stdout: result.stdout,
              stderr: result.stderr,
              truncated: result.truncated,
              contextRecord,
              autoCapture,
              captureHint: success && !autoCapture ? 'If this content contains durable facts, call KnowledgeCaptureTool next.' : undefined,
            },
            error: success ? undefined : `lark-cli 退出码 ${result.exitCode ?? 'unknown'}`,
          };
        }
      }
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async syncOne(source: FeishuSyncSource, options: FeishuIngestRunOptions): Promise<{
    success: boolean;
    sourceId: string;
    title: string;
    type: FeishuSyncSourceType;
    command?: string;
    contentHash?: string;
    changed: boolean;
    contextRecord?: unknown;
    autoCapture?: FeishuSyncCaptureResult;
    stdoutPreview?: string;
    stderr?: string;
    error?: string;
  }> {
    const profileError = getMissingProfileError(source.args, {
      larkCliProfile: options.larkCliProfile,
      feishuUserKey: options.feishuUserKey,
    });
    if (profileError) {
      this.syncStore.markFailed({ id: source.id, error: profileError, command: `lark-cli ${source.args.join(' ')}` });
      return {
        success: false,
        sourceId: source.id,
        title: source.title,
        type: source.type,
        changed: false,
        error: profileError,
      };
    }

    const runArgs = applyLarkCliProfile(source.args, options.larkCliProfile);
    const result = await this.runner(runArgs, {
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      abortSignal: options.abortSignal,
    });
    const success = result.exitCode === 0 && !result.timedOut && !result.aborted;
    if (!success) {
      const error = result.timedOut
        ? 'lark-cli 调用超时'
        : result.aborted
          ? 'lark-cli 调用已中断'
          : `lark-cli 退出码 ${result.exitCode ?? 'unknown'}`;
      this.syncStore.markFailed({ id: source.id, error, command: result.command });
      return {
        success: false,
        sourceId: source.id,
        title: source.title,
        type: source.type,
        command: result.command,
        changed: false,
        stderr: result.stderr,
        error,
      };
    }

    const content = normalizeFetchedContent(result.stdout);
    const contentHash = hashContent(content);
    const changed = options.force === true || source.lastHash !== contentHash;
    const updated = this.syncStore.markSynced({
      id: source.id,
      contentHash,
      command: result.command,
      changed,
    });

    let contextRecord: unknown;
    let autoCapture: FeishuSyncCaptureResult | undefined;
    if (changed) {
      contextRecord = this.upsertContext({ source: updated, result, content, contentHash, changed });
      autoCapture = await this.autoCapture?.capture({ source: updated, result, content, contentHash });
    }

    return {
      success: true,
      sourceId: source.id,
      title: source.title,
      type: source.type,
      command: result.command,
      contentHash,
      changed,
      contextRecord,
      autoCapture,
      stdoutPreview: truncate(content, 2_000),
      captureHint: changed && !autoCapture ? 'Changed content may contain durable facts; call KnowledgeCaptureTool if deeper extraction is needed.' : undefined,
    } as {
      success: boolean;
      sourceId: string;
      title: string;
      type: FeishuSyncSourceType;
      command?: string;
      contentHash?: string;
      changed: boolean;
      contextRecord?: unknown;
      autoCapture?: FeishuSyncCaptureResult;
      stdoutPreview?: string;
      stderr?: string;
      error?: string;
    };
  }

  private upsertContext(input: {
    source: FeishuSyncSource;
    result: LarkCliRunResult;
    content: string;
    contentHash: string;
    changed: boolean;
  }) {
    const officeSource = mapOfficeSource(input.source.type);
    const contextType = mapContextType(input.source.type);
    const summary = [
      `飞书同步来源：${input.source.title}`,
      `类型：${input.source.type}`,
      `内容 hash：${input.contentHash}`,
      '',
      truncate(input.content, 12_000),
    ].join('\n');

    return this.officeContextStore.upsert({
      type: contextType,
      key: `feishu:${input.source.id}`,
      title: input.source.title,
      summary,
      status: 'synced',
      tags: ['feishu-sync', input.source.type, ...input.source.tags],
      projectId: input.source.projectId,
      source: officeSource,
      sourceRefs: [{
        type: officeSource,
        id: input.source.id,
        title: input.source.title,
        observedAt: input.source.lastSyncedAt ?? new Date(),
      }],
      metadata: {
        feishuSyncSourceId: input.source.id,
        sourceType: input.source.type,
        args: input.source.args,
        command: input.result.command,
        contentHash: input.contentHash,
        changed: input.changed,
        exitCode: input.result.exitCode,
        truncated: input.result.truncated,
        stderr: truncate(input.result.stderr, 2_000),
      },
      confidence: 0.8,
      lastSeenAt: input.source.lastSyncedAt ?? new Date(),
    });
  }
}

function getMissingProfileError(
  args: string[],
  context: Pick<ToolContext, 'feishuUserKey' | 'larkCliProfile'>,
): string | null {
  if (!context.feishuUserKey || context.larkCliProfile || !requiresCliProfile(args)) return null;
  return [
    '当前飞书用户没有绑定 lark-cli profile，不能同步或读取飞书内容。',
    '请在 FEISHU_MULTI_USER_CONFIG 指向的 JSON 中配置该用户的 cliProfile，',
    '并运行 lark-cli --profile <profile> auth login 完成授权。',
  ].join('');
}

export function buildFeishuIngestArgs(source: z.infer<typeof SourceSpecSchema>): string[] {
  switch (source.type) {
    case 'doc': {
      requireField(source.doc, 'doc');
      return [
        'docs', '+fetch',
        '--api-version', 'v2',
        '--doc', source.doc!,
        '--doc-format', 'markdown',
        '--format', 'json',
        '--as', source.identity,
      ];
    }
    case 'docs_search': {
      requireField(source.query, 'query');
      return compact([
        'docs', '+search',
        '--query', source.query!,
        '--page-size', String(source.pageSize ?? 15),
        '--format', 'json',
        '--as', 'user',
        source.filter ? '--filter' : undefined,
        source.filter,
      ]);
    }
    case 'wiki_node': {
      requireField(source.token, 'token');
      return compact([
        'wiki', '+node-get',
        '--token', source.token!,
        '--format', 'json',
        '--as', source.identity,
        source.objType ? '--obj-type' : undefined,
        source.objType,
        source.spaceId ? '--space-id' : undefined,
        source.spaceId,
      ]);
    }
    case 'chat_messages': {
      if (!source.chatId && !source.userId) throw new Error('chat_messages requires chatId or userId');
      return compact([
        'im', '+chat-messages-list',
        source.chatId ? '--chat-id' : '--user-id',
        source.chatId ?? source.userId!,
        '--page-size', String(source.pageSize ?? 50),
        '--sort', source.sort ?? 'desc',
        '--format', 'json',
        '--as', source.identity,
        source.start ? '--start' : undefined,
        source.start,
        source.end ? '--end' : undefined,
        source.end,
      ]);
    }
    case 'message_search': {
      return compact([
        'im', '+messages-search',
        '--format', 'json',
        '--as', 'user',
        source.query ? '--query' : undefined,
        source.query,
        source.chatId ? '--chat-id' : undefined,
        source.chatId,
        source.start ? '--start' : undefined,
        source.start,
        source.end ? '--end' : undefined,
        source.end,
        source.pageSize ? '--page-size' : undefined,
        source.pageSize ? String(source.pageSize) : undefined,
        source.pageAll ? '--page-all' : undefined,
        source.pageLimit ? '--page-limit' : undefined,
        source.pageLimit ? String(source.pageLimit) : undefined,
      ]);
    }
    case 'calendar_agenda': {
      return compact([
        'calendar', '+agenda',
        '--calendar-id', source.calendarId ?? 'primary',
        '--format', 'json',
        '--as', source.identity,
        source.start ? '--start' : undefined,
        source.start,
        source.end ? '--end' : undefined,
        source.end,
      ]);
    }
    case 'base_records': {
      requireField(source.baseToken, 'baseToken');
      requireField(source.tableId, 'tableId');
      return compact([
        'base', '+record-list',
        '--base-token', source.baseToken!,
        '--table-id', source.tableId!,
        '--limit', String(source.limit ?? 100),
        '--format', 'json',
        '--as', source.identity,
        source.viewId ? '--view-id' : undefined,
        source.viewId,
        ...source.fieldIds.flatMap((fieldId) => ['--field-id', fieldId]),
      ]);
    }
    case 'task_search': {
      return compact([
        source.query ? 'task' : 'task',
        source.query ? '+search' : '+get-my-tasks',
        '--format', 'json',
        '--as', 'user',
        source.query ? '--query' : undefined,
        source.query,
        source.completed === undefined ? undefined : source.query ? '--completed' : source.completed ? '--complete' : undefined,
        source.due ? '--due' : undefined,
        source.due,
        source.pageAll ? '--page-all' : undefined,
        source.pageLimit ? '--page-limit' : undefined,
        source.pageLimit ? String(source.pageLimit) : undefined,
      ]);
    }
    case 'contact_search': {
      if (!source.query && !source.queries && !source.userIds && !source.hasChatted) {
        throw new Error('contact_search requires query, queries, userIds, or hasChatted');
      }
      return compact([
        'contact', '+search-user',
        '--format', 'json',
        '--as', 'user',
        source.query ? '--query' : undefined,
        source.query,
        source.queries ? '--queries' : undefined,
        source.queries,
        source.userIds ? '--user-ids' : undefined,
        source.userIds,
        source.hasChatted ? '--has-chatted' : undefined,
        source.pageSize ? '--page-size' : undefined,
        source.pageSize ? String(source.pageSize) : undefined,
      ]);
    }
    case 'raw': {
      if (source.rawArgs.length === 0) throw new Error('raw source requires rawArgs');
      if (!isAllowedReadRaw(source.rawArgs)) {
        throw new Error('raw Feishu ingest only allows known read/help commands. Use LarkCli directly for other commands.');
      }
      return source.rawArgs;
    }
  }
}

function mapOfficeSource(type: FeishuSyncSourceType): OfficeContextSource {
  switch (type) {
    case 'doc':
    case 'docs_search':
    case 'wiki_node':
      return 'feishu_doc';
    case 'chat_messages':
    case 'message_search':
      return 'feishu_message';
    case 'calendar_agenda':
      return 'feishu_calendar';
    case 'base_records':
      return 'feishu_base';
    case 'task_search':
    case 'contact_search':
    case 'raw':
      return 'tool';
  }
}

function mapContextType(type: FeishuSyncSourceType): OfficeContextType {
  switch (type) {
    case 'doc':
    case 'wiki_node':
      return 'document';
    case 'calendar_agenda':
      return 'meeting';
    case 'task_search':
      return 'task';
    case 'contact_search':
      return 'person';
    case 'docs_search':
    case 'chat_messages':
    case 'message_search':
    case 'base_records':
    case 'raw':
      return 'knowledge';
  }
}

function normalizeFetchedContent(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function requireField(value: string | undefined, name: string): void {
  if (!value?.trim()) throw new Error(`${name} is required`);
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => value !== undefined && value !== '');
}

function isAllowedReadRaw(args: string[]): boolean {
  if (args.includes('--help') || args.includes('-h')) return true;
  const joined = args.slice(0, 2).join(' ');
  const readShortcuts = new Set([
    'docs +fetch',
    'docs +search',
    'wiki +node-get',
    'wiki +node-list',
    'im +chat-messages-list',
    'im +messages-search',
    'im +messages-mget',
    'calendar +agenda',
    'base +record-list',
    'base +record-get',
    'base +record-search',
    'task +get-my-tasks',
    'task +search',
    'contact +search-user',
  ]);
  if (readShortcuts.has(joined)) return true;
  if (args[0] === 'schema' || args[0] === 'doctor') return true;
  if (args[0] === 'auth' && args[1] === 'status') return true;
  if (args[0] === 'api' && args[1] === 'GET') return true;
  return false;
}
