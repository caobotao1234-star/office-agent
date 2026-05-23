import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FeishuSyncStore } from './feishu-sync-store.js';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-sync-store-'));
  return path.join(dir, 'sources.json');
}

describe('FeishuSyncStore', () => {
  it('upserts, persists, and lists sources', () => {
    const file = tmpFile();
    const store = new FeishuSyncStore(file);
    const created = store.upsert({
      type: 'doc',
      title: 'Apollo 方案',
      args: ['docs', '+fetch', '--api-version', 'v2', '--doc', 'docx_123', '--doc-format', 'markdown', '--format', 'json', '--as', 'user'],
      tags: ['Apollo', '方案', 'Apollo'],
      projectId: 'project:apollo',
    }, new Date('2026-05-23T01:00:00.000Z'));

    expect(created.id).toBeTruthy();
    expect(created.syncEnabled).toBe(true);
    expect(created.tags).toEqual(['Apollo', '方案']);

    const restored = new FeishuSyncStore(file);
    const loaded = restored.get(created.id);
    expect(loaded?.title).toBe('Apollo 方案');
    expect(loaded?.createdAt.toISOString()).toBe('2026-05-23T01:00:00.000Z');
    expect(restored.list({ type: 'doc' })).toHaveLength(1);
  });

  it('updates sources and filters enabled sources', () => {
    const store = new FeishuSyncStore(tmpFile());
    const source = store.upsert({
      type: 'chat_messages',
      title: '项目群',
      args: ['im', '+chat-messages-list', '--chat-id', 'oc_x', '--format', 'json', '--as', 'user'],
    });

    const updated = store.upsert({
      id: source.id,
      type: 'chat_messages',
      title: 'Apollo 项目群',
      args: ['im', '+chat-messages-list', '--chat-id', 'oc_x', '--page-size', '20', '--format', 'json', '--as', 'user'],
      tags: ['Apollo'],
      syncEnabled: false,
    });

    expect(updated.id).toBe(source.id);
    expect(updated.title).toBe('Apollo 项目群');
    expect(updated.syncEnabled).toBe(false);
    expect(store.list({ syncEnabled: true })).toHaveLength(0);
    expect(store.list({ syncEnabled: false })).toHaveLength(1);
  });

  it('marks sync success and failure', () => {
    const store = new FeishuSyncStore(tmpFile());
    const source = store.upsert({
      type: 'calendar_agenda',
      title: '今天日程',
      args: ['calendar', '+agenda', '--format', 'json', '--as', 'user'],
    });

    const synced = store.markSynced({
      id: source.id,
      contentHash: 'hash-1',
      command: 'lark-cli calendar +agenda --format json --as user',
      changed: true,
      syncedAt: new Date('2026-05-23T02:00:00.000Z'),
    });
    expect(synced.lastHash).toBe('hash-1');
    expect(synced.lastChangedAt?.toISOString()).toBe('2026-05-23T02:00:00.000Z');
    expect(synced.lastError).toBeUndefined();

    const failed = store.markFailed({
      id: source.id,
      error: 'boom',
      syncedAt: new Date('2026-05-23T03:00:00.000Z'),
    });
    expect(failed.lastError).toBe('boom');
    expect(failed.lastHash).toBe('hash-1');
  });

  it('deletes sources and handles invalid files', () => {
    const file = tmpFile();
    const store = new FeishuSyncStore(file);
    const source = store.upsert({
      type: 'raw',
      title: 'Raw',
      args: ['docs', '+search', '--query', 'Apollo'],
    });

    expect(store.delete(source.id)).toBe(true);
    expect(store.delete(source.id)).toBe(false);

    fs.writeFileSync(file, '{bad json', 'utf-8');
    const broken = new FeishuSyncStore(file);
    expect(broken.list()).toEqual([]);
  });
});
