/**
 * NotificationService — Unified push notification channel.
 *
 * Both CLI and Feishu register their output callbacks here.
 * The reminder delivery loop and other proactive systems use this
 * to push messages to the user without waiting for user input.
 *
 * Requirements: 5, 6, 7 (proactive reminders)
 */

export type NotifyCallback = (message: string) => void | Promise<void>;

export class NotificationService {
  private channels: NotifyCallback[] = [];

  /** Register a notification channel (CLI console, Feishu message, etc.) */
  addChannel(callback: NotifyCallback): void {
    this.channels.push(callback);
  }

  /** Remove a notification channel */
  removeChannel(callback: NotifyCallback): void {
    this.channels = this.channels.filter(c => c !== callback);
  }

  /** Push a notification to all registered channels */
  async notify(message: string): Promise<void> {
    for (const ch of this.channels) {
      try {
        await ch(message);
      } catch (err) {
        console.error('[Notification] 推送失败:', err instanceof Error ? err.message : err);
      }
    }
  }

  /** Check if any channels are registered */
  hasChannels(): boolean {
    return this.channels.length > 0;
  }
}
