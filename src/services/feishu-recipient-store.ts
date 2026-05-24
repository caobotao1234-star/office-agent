import { z } from 'zod';
import { logger } from '../core/logger.js';
import { readJsonFile, writeJsonFileAtomic } from './json-store.js';

const log = logger.child('FeishuRecipients');

export interface FeishuRecipient {
  senderId: string;
  chatId: string;
  updatedAt: string;
}

interface RecipientFile {
  recipients?: FeishuRecipient[];
}

const RecipientFileSchema = z.object({
  recipients: z.array(z.object({
    senderId: z.string(),
    chatId: z.string(),
    updatedAt: z.string(),
  })).default([]),
});

export class FeishuRecipientStore {
  constructor(private filePath: string) {}

  list(): FeishuRecipient[] {
    const parsed = readJsonFile<Required<RecipientFile>>(this.filePath, RecipientFileSchema, {
      fallback: { recipients: [] },
      label: 'feishu-recipients',
    });
    return parsed.recipients;
  }

  upsert(senderId: string, chatId: string): FeishuRecipient {
    const recipients = this.list();
    const now = new Date().toISOString();
    const existing = recipients.find((item) => item.senderId === senderId);

    if (existing) {
      existing.chatId = chatId;
      existing.updatedAt = now;
      this.save(recipients);
      log.info('recipient updated', { senderId, chatId });
      return existing;
    }

    const created: FeishuRecipient = { senderId, chatId, updatedAt: now };
    recipients.push(created);
    this.save(recipients);
    log.info('recipient added', { senderId, chatId });
    return created;
  }

  private save(recipients: FeishuRecipient[]): void {
    writeJsonFileAtomic(this.filePath, { recipients });
  }
}
