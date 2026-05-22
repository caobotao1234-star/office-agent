/**
 * NotificationService — Unified push notification channel.
 *
 * Both CLI and Feishu register their output callbacks here.
 * The reminder delivery loop and other proactive systems use this
 * to push messages to the user without waiting for user input.
 *
 * Requirements: 5, 6, 7 (proactive reminders)
 */

import { logger } from '../core/logger.js';

const log = logger.child('Notification');

export type NotifyCallback = (message: string) => void | Promise<void>;

export class NotificationService {
  private channels: NotifyCallback[] = [];

  /** Register a notification channel (CLI console, Feishu message, etc.) */
  addChannel(callback: NotifyCallback): void {
    this.channels.push(callback);
    log.info('channel added', { count: this.channels.length });
  }

  /** Remove a notification channel */
  removeChannel(callback: NotifyCallback): void {
    this.channels = this.channels.filter(c => c !== callback);
    log.info('channel removed', { count: this.channels.length });
  }

  /** Push a notification to all registered channels */
  async notify(message: string): Promise<void> {
    log.info('notify start', { channelCount: this.channels.length, messageLength: message.length });
    for (const ch of this.channels) {
      try {
        await ch(message);
      } catch (err) {
        log.error('channel failed', { error: err instanceof Error ? err.message : String(err) });
        console.error('[Notification] 推送失败:', err instanceof Error ? err.message : err);
      }
    }
    log.info('notify finish', { channelCount: this.channels.length });
  }

  /** Check if any channels are registered */
  hasChannels(): boolean {
    return this.channels.length > 0;
  }
}
