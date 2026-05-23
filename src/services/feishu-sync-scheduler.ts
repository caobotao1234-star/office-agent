import type { NotificationService } from './notification-service.js';
import { logger } from '../core/logger.js';

const log = logger.child('FeishuSyncScheduler');

export interface FeishuSyncTickSummary {
  count: number;
  changed: number;
  failed: number;
}

export type FeishuSyncTickCallback = (signal: AbortSignal) => Promise<FeishuSyncTickSummary>;

export class FeishuSyncScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tickInFlight = false;
  private tickAgain = false;
  private abortController: AbortController | null = null;

  constructor(
    private onTick: FeishuSyncTickCallback,
    private notificationService: NotificationService,
    private intervalMs: number,
    private notifyOnChange = true,
  ) {}

  isEnabled(): boolean {
    return this.intervalMs > 0;
  }

  start(): void {
    if (this.intervalId || !this.isEnabled()) return;
    this.intervalId = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.intervalId.unref?.();
    log.info('started', { intervalMs: this.intervalMs, notifyOnChange: this.notifyOnChange });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    log.info('stopped');
  }

  async tick(): Promise<FeishuSyncTickSummary | null> {
    if (!this.isEnabled()) return null;
    if (this.tickInFlight) {
      this.tickAgain = true;
      return null;
    }

    this.tickInFlight = true;
    this.abortController = new AbortController();

    try {
      const summary = await this.onTick(this.abortController.signal);
      log.info('tick finished', { ...summary });

      if (this.notifyOnChange && (summary.changed > 0 || summary.failed > 0) && this.notificationService.hasChannels()) {
        await this.notificationService.notify(formatSyncSummary(summary));
      }

      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('tick failed', { error: message });
      if (this.notificationService.hasChannels()) {
        await this.notificationService.notify(`飞书自动同步失败：${message}`);
      }
      return { count: 0, changed: 0, failed: 1 };
    } finally {
      this.tickInFlight = false;
      this.abortController = null;
      if (this.tickAgain) {
        this.tickAgain = false;
        void this.tick();
      }
    }
  }
}

function formatSyncSummary(summary: FeishuSyncTickSummary): string {
  const parts = [`飞书自动同步完成：${summary.count} 个来源`];
  if (summary.changed > 0) parts.push(`${summary.changed} 个有变化`);
  if (summary.failed > 0) parts.push(`${summary.failed} 个失败`);
  parts.push('可对我说“总结飞书同步变化”让我继续提取和整理。');
  return parts.join('，');
}
