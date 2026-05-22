import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FeishuRecipientStore } from './feishu-recipient-store.js';

describe('FeishuRecipientStore', () => {
  it('persists and updates Feishu recipients', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-recipients-'));
    const store = new FeishuRecipientStore(path.join(dir, 'recipients.json'));

    store.upsert('ou_1', 'oc_1');
    store.upsert('ou_1', 'oc_2');

    const recipients = store.list();
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.senderId).toBe('ou_1');
    expect(recipients[0]?.chatId).toBe('oc_2');
    expect(recipients[0]?.updatedAt).toBeTruthy();
  });
});
