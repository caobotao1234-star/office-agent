import { describe, expect, it } from 'vitest';
import {
  buildObservedGroupSyncSource,
  buildObservedGroupSyncSourceId,
  buildP2PChatSyncSource,
  loadFeishuChatAutoSyncConfig,
  normalizeFeishuChatType,
  shouldTriggerAgentForGroupMessage,
} from './feishu-chat-auto-sync.js';

describe('feishu-chat-auto-sync', () => {
  it('loads conservative defaults from env', () => {
    const config = loadFeishuChatAutoSyncConfig({});
    expect(config).toEqual({
      groupAutoSyncEnabled: true,
      groupAgentTriggerMode: 'mention',
      groupAutoOwnSingleUser: true,
      groupSyncPageSize: 50,
    });
  });

  it('decides whether group messages should trigger the Agent', () => {
    expect(shouldTriggerAgentForGroupMessage(
      { chatType: 'group', cleanText: '普通讨论', hasMention: false },
      { groupAgentTriggerMode: 'mention' },
    )).toBe(false);
    expect(shouldTriggerAgentForGroupMessage(
      { chatType: 'group', cleanText: '帮我总结', hasMention: true },
      { groupAgentTriggerMode: 'mention' },
    )).toBe(true);
    expect(shouldTriggerAgentForGroupMessage(
      { chatType: 'group', cleanText: '/sync', hasMention: false },
      { groupAgentTriggerMode: 'mention' },
    )).toBe(true);
    expect(shouldTriggerAgentForGroupMessage(
      { chatType: 'group', cleanText: '普通讨论', hasMention: false },
      { groupAgentTriggerMode: 'all' },
    )).toBe(true);
    expect(shouldTriggerAgentForGroupMessage(
      { chatType: 'p2p', cleanText: '普通私聊', hasMention: false },
      { groupAgentTriggerMode: 'never' },
    )).toBe(true);
  });

  it('builds stable group and p2p sync sources', () => {
    expect(buildObservedGroupSyncSourceId('team', 'oc_x')).toBe('auto-group-chat:team:oc_x');
    expect(buildObservedGroupSyncSource({
      appKey: 'team',
      chatId: 'oc_x',
      title: 'Apollo 群',
      pageSize: 100,
    })).toEqual({
      id: 'auto-group-chat:team:oc_x',
      type: 'chat_messages',
      title: 'Apollo 群',
      args: [
        'im', '+chat-messages-list',
        '--chat-id', 'oc_x',
        '--page-size', '50',
        '--sort', 'desc',
        '--format', 'json',
        '--as', 'user',
      ],
      projectId: undefined,
      tags: ['auto-sync', 'group-chat', 'chat:oc_x'],
      syncEnabled: true,
    });

    expect(buildP2PChatSyncSource({ userId: 'ou_bob', title: '和 Bob 的私聊', pageSize: 20 }).args).toEqual([
      'im', '+chat-messages-list',
      '--user-id', 'ou_bob',
      '--page-size', '20',
      '--sort', 'desc',
      '--format', 'json',
      '--as', 'user',
    ]);
  });

  it('normalizes unknown chat types safely', () => {
    expect(normalizeFeishuChatType('GROUP')).toBe('group');
    expect(normalizeFeishuChatType('p2p')).toBe('p2p');
    expect(normalizeFeishuChatType(undefined)).toBe('unknown');
  });
});
