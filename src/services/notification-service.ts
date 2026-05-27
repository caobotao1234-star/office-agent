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
export type ChannelChangeCallback = () => void;

export interface NotificationResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export class NotificationService {
  private channels: NotifyCallback[] = [];
  private channelChangeCallbacks = new Set<ChannelChangeCallback>();

  /** Register a notification channel (CLI console, Feishu message, etc.) */
  addChannel(callback: NotifyCallback): void {
    this.channels.push(callback);
    log.info('channel added', { count: this.channels.length });
    this.emitChannelChange();
  }

  /** Remove a notification channel */
  removeChannel(callback: NotifyCallback): void {
    this.channels = this.channels.filter(c => c !== callback);
    log.info('channel removed', { count: this.channels.length });
    this.emitChannelChange();
  }

  /** Push a notification to all registered channels */
  async notify(message: string): Promise<NotificationResult> {
    log.info('notify start', { channelCount: this.channels.length, messageLength: message.length });
    const result: NotificationResult = {
      attempted: this.channels.length,
      succeeded: 0,
      failed: 0,
      errors: [],
    };
    for (const ch of this.channels) {
      try {
        await ch(message);
        result.succeeded++;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        result.failed++;
        result.errors.push(error);
        log.error('channel failed', { error });
        console.error('[Notification] 推送失败:', error);
      }
    }
    log.info('notify finish', { channelCount: this.channels.length, succeeded: result.succeeded, failed: result.failed });
    return result;
  }

  /** Check if any channels are registered */
  hasChannels(): boolean {
    return this.channels.length > 0;
  }

  onChannelChange(callback: ChannelChangeCallback): () => void {
    this.channelChangeCallbacks.add(callback);
    return () => {
      this.channelChangeCallbacks.delete(callback);
    };
  }

  private emitChannelChange(): void {
    for (const callback of this.channelChangeCallbacks) {
      try {
        callback();
      } catch (err) {
        log.error('channel change callback failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}
