import type { UpsertFeishuSyncSourceInput } from './feishu-sync-store.js';

export type FeishuGroupAgentTriggerMode = 'mention' | 'all' | 'never';

export interface FeishuChatAutoSyncConfig {
  groupAutoSyncEnabled: boolean;
  groupAgentTriggerMode: FeishuGroupAgentTriggerMode;
  groupAutoOwnSingleUser: boolean;
  groupSyncPageSize: number;
}

export interface GroupTriggerInput {
  chatType?: string;
  cleanText?: string;
  hasMention?: boolean;
}

export interface GroupSyncSourceInput {
  appKey: string;
  chatId: string;
  title?: string;
  pageSize?: number;
  projectId?: string;
}

export interface P2PSyncSourceInput {
  userId: string;
  title?: string;
  pageSize?: number;
  projectId?: string;
  tags?: string[];
}

export function loadFeishuChatAutoSyncConfig(env: NodeJS.ProcessEnv = process.env): FeishuChatAutoSyncConfig {
  return {
    groupAutoSyncEnabled: parseBoolean(env['FEISHU_GROUP_AUTO_SYNC'], true),
    groupAgentTriggerMode: parseTriggerMode(env['FEISHU_GROUP_AGENT_TRIGGER_MODE']),
    groupAutoOwnSingleUser: parseBoolean(env['FEISHU_GROUP_AUTO_OWN_SINGLE_USER'], true),
    groupSyncPageSize: parsePageSize(env['FEISHU_GROUP_SYNC_PAGE_SIZE']),
  };
}

export function normalizeFeishuChatType(chatType: string | undefined): 'p2p' | 'group' | 'unknown' {
  const normalized = chatType?.trim().toLowerCase();
  if (normalized === 'p2p' || normalized === 'group') return normalized;
  return 'unknown';
}

export function shouldTriggerAgentForGroupMessage(
  input: GroupTriggerInput,
  config: Pick<FeishuChatAutoSyncConfig, 'groupAgentTriggerMode'>,
): boolean {
  if (normalizeFeishuChatType(input.chatType) !== 'group') return true;
  if (config.groupAgentTriggerMode === 'all') return true;
  if (config.groupAgentTriggerMode === 'never') return false;

  const cleanText = input.cleanText?.trim() ?? '';
  return input.hasMention === true || cleanText.startsWith('/') || /^oa\b/i.test(cleanText);
}

export function buildObservedGroupSyncSource(input: GroupSyncSourceInput): UpsertFeishuSyncSourceInput {
  const sourceId = buildObservedGroupSyncSourceId(input.appKey, input.chatId);
  return {
    id: sourceId,
    type: 'chat_messages',
    title: input.title?.trim() || `群聊 ${input.chatId}`,
    args: [
      'im', '+chat-messages-list',
      '--chat-id', input.chatId,
      '--page-size', String(clampPageSize(input.pageSize)),
      '--sort', 'desc',
      '--format', 'json',
      '--as', 'user',
    ],
    projectId: input.projectId,
    tags: ['auto-sync', 'group-chat', `chat:${input.chatId}`],
    syncEnabled: true,
  };
}

export function buildP2PChatSyncSource(input: P2PSyncSourceInput): UpsertFeishuSyncSourceInput {
  return {
    type: 'chat_messages',
    title: input.title?.trim() || `私聊 ${input.userId}`,
    args: [
      'im', '+chat-messages-list',
      '--user-id', input.userId,
      '--page-size', String(clampPageSize(input.pageSize)),
      '--sort', 'desc',
      '--format', 'json',
      '--as', 'user',
    ],
    projectId: input.projectId,
    tags: ['p2p-chat', ...(input.tags ?? [])],
    syncEnabled: true,
  };
}

export function buildObservedGroupSyncSourceId(appKey: string, chatId: string): string {
  return `auto-group-chat:${appKey}:${chatId}`;
}

function parseTriggerMode(value: string | undefined): FeishuGroupAgentTriggerMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'all' || normalized === 'never' || normalized === 'mention') return normalized;
  return 'mention';
}

function parsePageSize(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return clampPageSize(n);
}

function clampPageSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(50, Math.max(1, Math.floor(value ?? 50)));
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}
