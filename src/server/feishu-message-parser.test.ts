import { describe, expect, it } from 'vitest';
import {
  extractImageKeysFromPost,
  extractTextFromPost,
  parseFeishuMessageEvent,
  stripBotMention,
} from './feishu-message-parser.js';

describe('feishu-message-parser', () => {
  it('parses text messages and strips bot mention', () => {
    const result = parseFeishuMessageEvent({
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        message_id: 'om_1',
        chat_id: 'oc_1',
        message_type: 'text',
        content: JSON.stringify({ text: '@_user_123 帮我列任务' }),
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.message).toMatchObject({
      kind: 'text',
      messageId: 'om_1',
      chatId: 'oc_1',
      senderId: 'ou_1',
      cleanText: '帮我列任务',
    });
  });

  it('parses post text and image keys', () => {
    const content = {
      zh_cn: {
        title: '项目更新',
        content: [
          [
            { tag: 'text', text: 'Apollo 进展' },
            { tag: 'a', text: '文档', href: 'https://example.com' },
            { tag: 'img', image_key: 'img_1' },
          ],
          [
            { tag: 'at', user_name: '张三' },
            { tag: 'img', image_key: 'img_2' },
          ],
        ],
      },
    };

    expect(extractTextFromPost(content)).toBe('项目更新 Apollo 进展 文档 (https://example.com) @张三');
    expect(extractImageKeysFromPost(content)).toEqual(['img_1', 'img_2']);

    const result = parseFeishuMessageEvent({
      sender: { sender_id: { open_id: 'ou_2' } },
      message: {
        message_id: 'om_2',
        chat_id: 'oc_2',
        message_type: 'post',
        content: JSON.stringify(content),
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.message.kind).toBe('post');
    if (result.message.kind === 'post') {
      expect(result.message.cleanText).toContain('Apollo 进展');
      expect(result.message.imageKeys).toEqual(['img_1', 'img_2']);
    }
  });

  it('parses image and audio messages', () => {
    const image = parseFeishuMessageEvent({
      message: {
        message_id: 'om_img',
        chat_id: 'oc_1',
        message_type: 'image',
        content: JSON.stringify({ image_key: 'img_key' }),
      },
    });
    expect(image.success && image.message.kind === 'image' && image.message.imageKey).toBe('img_key');

    const audio = parseFeishuMessageEvent({
      message: {
        message_id: 'om_audio',
        chat_id: 'oc_1',
        message_type: 'audio',
        content: JSON.stringify({ file_key: 'file_key' }),
      },
    });
    expect(audio.success && audio.message.kind === 'audio' && audio.message.fileKey).toBe('file_key');
  });

  it('returns unsupported or parse failures explicitly', () => {
    const unsupported = parseFeishuMessageEvent({
      message: {
        message_id: 'om_file',
        chat_id: 'oc_1',
        message_type: 'file',
        content: '{}',
      },
    });
    expect(unsupported.success).toBe(true);
    if (unsupported.success) expect(unsupported.message.kind).toBe('unsupported');

    const malformed = parseFeishuMessageEvent({ message: { chat_id: 'oc_1' } });
    expect(malformed.success).toBe(false);
  });

  it('strips Feishu bot mention patterns', () => {
    expect(stripBotMention('@_user_123  ping')).toBe('ping');
  });
});
