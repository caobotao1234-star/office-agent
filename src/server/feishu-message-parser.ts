import { z } from 'zod';

const SenderSchema = z.object({
  sender_id: z.object({
    open_id: z.string().optional(),
  }).optional(),
}).optional();

const MessageSchema = z.object({
  message_id: z.string(),
  chat_id: z.string(),
  chat_type: z.string().optional(),
  message_type: z.string(),
  content: z.string().optional().default(''),
});

const EventSchema = z.object({
  sender: SenderSchema,
  message: MessageSchema,
});

export type ParsedFeishuMessage =
  | {
      kind: 'text';
      messageId: string;
      chatId: string;
      chatType?: string;
      senderId: string;
      text: string;
      cleanText: string;
      hasMention: boolean;
    }
  | {
      kind: 'post';
      messageId: string;
      chatId: string;
      chatType?: string;
      senderId: string;
      text: string;
      cleanText: string;
      hasMention: boolean;
      imageKeys: string[];
    }
  | {
      kind: 'image';
      messageId: string;
      chatId: string;
      chatType?: string;
      senderId: string;
      imageKey: string;
    }
  | {
      kind: 'audio';
      messageId: string;
      chatId: string;
      chatType?: string;
      senderId: string;
      fileKey: string;
    }
  | {
      kind: 'unsupported';
      messageId: string;
      chatId: string;
      chatType?: string;
      senderId: string;
      messageType: string;
    };

export interface FeishuMessageParseFailure {
  success: false;
  reason: string;
}

export interface FeishuMessageParseSuccess {
  success: true;
  message: ParsedFeishuMessage;
}

export type FeishuMessageParseResult = FeishuMessageParseSuccess | FeishuMessageParseFailure;

export function parseFeishuMessageEvent(data: unknown): FeishuMessageParseResult {
  const parsed = EventSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, reason: parsed.error.message };
  }

  const message = parsed.data.message;
  const senderId = parsed.data.sender?.sender_id?.open_id ?? 'unknown';
  const base = {
    messageId: message.message_id,
    chatId: message.chat_id,
    chatType: message.chat_type,
    senderId,
  };

  switch (message.message_type) {
    case 'text': {
      const content = parseJsonObject(message.content);
      const text = typeof content.text === 'string' ? content.text : message.content;
      const cleanText = stripBotMention(text);
      const hasMention = hasFeishuMention(text);
      if (!cleanText) return { success: false, reason: 'empty text message' };
      return { success: true, message: { kind: 'text', ...base, text, cleanText, hasMention } };
    }
    case 'post': {
      const content = parseJsonObject(message.content);
      const text = extractTextFromPost(content);
      const cleanText = stripBotMention(text);
      const hasMention = hasPostMention(content) || hasFeishuMention(text);
      const imageKeys = extractImageKeysFromPost(content);
      if (!cleanText && imageKeys.length === 0) return { success: false, reason: 'empty post message' };
      return { success: true, message: { kind: 'post', ...base, text, cleanText, hasMention, imageKeys } };
    }
    case 'image': {
      const content = parseJsonObject(message.content);
      const imageKey = typeof content.image_key === 'string' ? content.image_key : '';
      if (!imageKey) return { success: false, reason: 'image message missing image_key' };
      return { success: true, message: { kind: 'image', ...base, imageKey } };
    }
    case 'audio': {
      const content = parseJsonObject(message.content);
      const fileKey = typeof content.file_key === 'string' ? content.file_key : '';
      if (!fileKey) return { success: false, reason: 'audio message missing file_key' };
      return { success: true, message: { kind: 'audio', ...base, fileKey } };
    }
    default:
      return { success: true, message: { kind: 'unsupported', ...base, messageType: message.message_type } };
  }
}

export function stripBotMention(text: string): string {
  return text.replace(/@_user_\d+\s*/g, '').trim();
}

export function hasFeishuMention(text: string): boolean {
  return /@_user_\d+/.test(text);
}

export function extractImageKeysFromPost(content: unknown): string[] {
  const keys: string[] = [];
  const root = content && typeof content === 'object' ? content as Record<string, unknown> : {};
  const locales = selectPostLocale(root);
  const paragraphs = Array.isArray(locales.content) ? locales.content : [];
  for (const paragraph of paragraphs) {
    if (!Array.isArray(paragraph)) continue;
    for (const element of paragraph) {
      if (isRecord(element) && element.tag === 'img' && typeof element.image_key === 'string') {
        keys.push(element.image_key);
      }
    }
  }
  return keys;
}

export function extractTextFromPost(content: unknown): string {
  const parts: string[] = [];
  const root = content && typeof content === 'object' ? content as Record<string, unknown> : {};
  const locales = selectPostLocale(root);
  if (typeof locales.title === 'string' && locales.title) parts.push(locales.title);

  const paragraphs = Array.isArray(locales.content) ? locales.content : [];
  for (const paragraph of paragraphs) {
    if (!Array.isArray(paragraph)) continue;
    for (const element of paragraph) {
      if (!isRecord(element)) continue;
      if (element.tag === 'text' && typeof element.text === 'string') {
        parts.push(element.text);
      } else if (element.tag === 'a' && typeof element.text === 'string') {
        const href = typeof element.href === 'string' && element.href ? ` (${element.href})` : '';
        parts.push(element.text + href);
      } else if (element.tag === 'at' && typeof element.user_name === 'string') {
        parts.push(`@${element.user_name}`);
      }
    }
  }

  return parts.join(' ').trim();
}

export function hasPostMention(content: unknown): boolean {
  const root = content && typeof content === 'object' ? content as Record<string, unknown> : {};
  const locales = selectPostLocale(root);
  const paragraphs = Array.isArray(locales.content) ? locales.content : [];
  for (const paragraph of paragraphs) {
    if (!Array.isArray(paragraph)) continue;
    for (const element of paragraph) {
      if (isRecord(element) && element.tag === 'at') return true;
    }
  }
  return false;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function selectPostLocale(root: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['zh_cn', 'en_us', 'ja_jp']) {
    const value = root[key];
    if (isRecord(value)) return value;
  }
  return root;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
