import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FeishuRecipientStore } from './feishu-recipient-store.js';

describe('FeishuRecipientStore', () => {
  it('persists and updates Feishu recipients', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-recipients-'));
    const store = new FeishuRecipientStore(path.join(dir, 'recipients.json'));

    store.upsert('ou_1', 'oc_1', 'app-a');
    store.upsert('ou_1', 'oc_2', 'app-a');

    const recipients = store.list();
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.appKey).toBe('app-a');
    expect(recipients[0]?.senderId).toBe('ou_1');
    expect(recipients[0]?.chatId).toBe('oc_2');
    expect(recipients[0]?.updatedAt).toBeTruthy();
  });

  it('keeps recipients from different apps isolated', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-recipients-'));
    const store = new FeishuRecipientStore(path.join(dir, 'recipients.json'));

    store.upsert('ou_same', 'oc_a', 'app-a');
    store.upsert('ou_same', 'oc_b', 'app-b');

    expect(store.list()).toHaveLength(2);
    expect(store.list('app-a')).toEqual([
      expect.objectContaining({ appKey: 'app-a', senderId: 'ou_same', chatId: 'oc_a' }),
    ]);
    expect(store.list('app-b')).toEqual([
      expect.objectContaining({ appKey: 'app-b', senderId: 'ou_same', chatId: 'oc_b' }),
    ]);
  });
});
