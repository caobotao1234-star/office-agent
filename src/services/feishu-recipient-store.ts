import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../core/logger.js';

const log = logger.child('FeishuRecipients');

export interface FeishuRecipient {
  senderId: string;
  chatId: string;
  updatedAt: string;
}

interface RecipientFile {
  recipients?: FeishuRecipient[];
}

export class FeishuRecipientStore {
  constructor(private filePath: string) {}

  list(): FeishuRecipient[] {
    if (!fs.existsSync(this.filePath)) return [];

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as RecipientFile;
      return Array.isArray(parsed.recipients) ? parsed.recipients : [];
    } catch (err) {
      log.error('failed to read recipients', { filePath: this.filePath, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
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
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({ recipients }, null, 2));
  }
}
