import { z } from 'zod';
import { logger } from '../core/logger.js';
import { readJsonFile, writeJsonFileAtomic } from './json-store.js';

const log = logger.child('FeishuObservedChats');

export interface FeishuObservedChat {
  appKey: string;
  chatId: string;
  chatType: 'group';
  ownerOpenId: string;
  ownerUserKey: string;
  ownerSafeUserKey: string;
  syncSourceId?: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  lastObservedAt: Date;
  lastMessageId?: string;
}

export interface UpsertObservedChatInput {
  appKey: string;
  chatId: string;
  ownerOpenId: string;
  ownerUserKey: string;
  ownerSafeUserKey: string;
  syncSourceId?: string;
  title?: string;
  lastMessageId?: string;
}

const SerializedObservedChatSchema = z.object({
  appKey: z.string(),
  chatId: z.string(),
  chatType: z.literal('group').default('group'),
  ownerOpenId: z.string(),
  ownerUserKey: z.string(),
  ownerSafeUserKey: z.string(),
  syncSourceId: z.string().optional(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastObservedAt: z.string(),
  lastMessageId: z.string().optional(),
});

const ObservedChatFileSchema = z.object({
  chats: z.array(SerializedObservedChatSchema).default([]),
});

type SerializedObservedChat = z.infer<typeof SerializedObservedChatSchema>;

export class FeishuObservedChatStore {
  private chats: FeishuObservedChat[] = [];

  constructor(private filePath: string) {
    this.load();
  }

  get(appKey: string, chatId: string): FeishuObservedChat | undefined {
    const chat = this.chats.find((item) => item.appKey === appKey && item.chatId === chatId);
    return chat ? cloneObservedChat(chat) : undefined;
  }

  list(appKey?: string): FeishuObservedChat[] {
    return this.chats
      .filter((chat) => !appKey || chat.appKey === appKey)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(cloneObservedChat);
  }

  upsert(input: UpsertObservedChatInput, now = new Date()): FeishuObservedChat {
    const existing = this.chats.find((item) => item.appKey === input.appKey && item.chatId === input.chatId);
    const title = input.title?.trim() || `群聊 ${input.chatId}`;

    if (existing) {
      existing.ownerOpenId = input.ownerOpenId;
      existing.ownerUserKey = input.ownerUserKey;
      existing.ownerSafeUserKey = input.ownerSafeUserKey;
      if (input.syncSourceId !== undefined) existing.syncSourceId = input.syncSourceId;
      existing.title = title;
      existing.updatedAt = now;
      existing.lastObservedAt = now;
      if (input.lastMessageId) existing.lastMessageId = input.lastMessageId;
      this.save();
      log.debug('observed chat updated', { appKey: existing.appKey, chatId: existing.chatId, ownerUserKey: existing.ownerUserKey });
      return cloneObservedChat(existing);
    }

    const created: FeishuObservedChat = {
      appKey: input.appKey,
      chatId: input.chatId,
      chatType: 'group',
      ownerOpenId: input.ownerOpenId,
      ownerUserKey: input.ownerUserKey,
      ownerSafeUserKey: input.ownerSafeUserKey,
      ...(input.syncSourceId ? { syncSourceId: input.syncSourceId } : {}),
      title,
      createdAt: now,
      updatedAt: now,
      lastObservedAt: now,
      ...(input.lastMessageId ? { lastMessageId: input.lastMessageId } : {}),
    };
    this.chats.push(created);
    this.save();
    log.info('observed chat added', { appKey: created.appKey, chatId: created.chatId, ownerUserKey: created.ownerUserKey });
    return cloneObservedChat(created);
  }

  private save(): void {
    writeJsonFileAtomic(this.filePath, { chats: this.chats.map(serializeObservedChat) });
  }

  private load(): void {
    const parsed = readJsonFile(this.filePath, ObservedChatFileSchema, {
      fallback: { chats: [] },
      label: 'feishu-observed-chats',
    });
    this.chats = parsed.chats.map(deserializeObservedChat);
    if (this.chats.length > 0) {
      log.info('observed chats loaded', { count: this.chats.length, filePath: this.filePath });
    }
  }
}

function serializeObservedChat(chat: FeishuObservedChat): SerializedObservedChat {
  return {
    ...chat,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
    lastObservedAt: chat.lastObservedAt.toISOString(),
  };
}

function deserializeObservedChat(chat: SerializedObservedChat): FeishuObservedChat {
  return {
    ...chat,
    createdAt: parseDate(chat.createdAt) ?? new Date(0),
    updatedAt: parseDate(chat.updatedAt) ?? new Date(0),
    lastObservedAt: parseDate(chat.lastObservedAt) ?? new Date(0),
  };
}

function cloneObservedChat(chat: FeishuObservedChat): FeishuObservedChat {
  return {
    ...chat,
    createdAt: new Date(chat.createdAt),
    updatedAt: new Date(chat.updatedAt),
    lastObservedAt: new Date(chat.lastObservedAt),
  };
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
