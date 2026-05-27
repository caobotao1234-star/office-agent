import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FeishuObservedChatStore } from './feishu-observed-chat-store.js';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-observed-chats-'));
  return path.join(dir, 'observed.json');
}

describe('FeishuObservedChatStore', () => {
  it('upserts, persists, and lists observed group ownership', () => {
    const file = tmpFile();
    const store = new FeishuObservedChatStore(file);

    const created = store.upsert({
      appKey: 'team',
      chatId: 'oc_group',
      ownerOpenId: 'ou_alice',
      ownerUserKey: 'team:ou_alice',
      ownerSafeUserKey: 'team_3Aou_alice',
      syncSourceId: 'auto-group-chat:team:oc_group',
      lastMessageId: 'om_1',
    }, new Date('2026-05-27T01:00:00.000Z'));

    expect(created.title).toBe('群聊 oc_group');
    expect(created.lastMessageId).toBe('om_1');

    const restored = new FeishuObservedChatStore(file);
    const loaded = restored.get('team', 'oc_group');
    expect(loaded?.ownerUserKey).toBe('team:ou_alice');
    expect(loaded?.createdAt.toISOString()).toBe('2026-05-27T01:00:00.000Z');
    expect(restored.list('team')).toHaveLength(1);
  });

  it('updates existing ownership and last observed message', () => {
    const store = new FeishuObservedChatStore(tmpFile());
    store.upsert({
      appKey: 'team',
      chatId: 'oc_group',
      ownerOpenId: 'ou_alice',
      ownerUserKey: 'team:ou_alice',
      ownerSafeUserKey: 'team_3Aou_alice',
    }, new Date('2026-05-27T01:00:00.000Z'));

    const updated = store.upsert({
      appKey: 'team',
      chatId: 'oc_group',
      ownerOpenId: 'ou_alice',
      ownerUserKey: 'team:ou_alice',
      ownerSafeUserKey: 'team_3Aou_alice',
      syncSourceId: 'auto-group-chat:team:oc_group',
      title: 'Apollo 项目群',
      lastMessageId: 'om_2',
    }, new Date('2026-05-27T02:00:00.000Z'));

    expect(updated.title).toBe('Apollo 项目群');
    expect(updated.syncSourceId).toBe('auto-group-chat:team:oc_group');
    expect(updated.lastObservedAt.toISOString()).toBe('2026-05-27T02:00:00.000Z');
    expect(store.list()).toHaveLength(1);
  });
});
