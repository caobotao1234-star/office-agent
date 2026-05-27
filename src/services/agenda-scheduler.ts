import type { AgendaItem } from '../types/index.js';
import type { AgendaStore } from './agenda-store.js';
import type { NotificationService } from './notification-service.js';
import type { ReminderComposer } from './reminder-composer.js';
import { logger } from '../core/logger.js';

const log = logger.child('AgendaScheduler');

const DEFAULT_SCAN_INTERVAL_MS = 60_000;
const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000;

export class AgendaScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private nextDueTimerId: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeAgendaChanges: (() => void) | null = null;
  private unsubscribeChannelChanges: (() => void) | null = null;
  private tickInFlight = false;
  private tickAgain = false;

  constructor(
    private agendaStore: AgendaStore,
    private notificationService: NotificationService,
    private composer: ReminderComposer,
    private scanIntervalMs = DEFAULT_SCAN_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.intervalId) return;

    this.unsubscribeAgendaChanges = this.agendaStore.onChange(() => {
      this.scheduleNextDueTick();
    });
    this.unsubscribeChannelChanges = this.notificationService.onChannelChange(() => {
      if (this.notificationService.hasChannels()) {
        void this.tick();
      } else {
        this.clearNextDueTimer();
      }
    });

    this.intervalId = setInterval(() => { void this.tick(); }, this.scanIntervalMs);
    this.scheduleNextDueTick();
    void this.tick();
    log.info('started', { scanIntervalMs: this.scanIntervalMs });
  }

  stop(): void {
    if (!this.intervalId) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.clearNextDueTimer();
    this.unsubscribeAgendaChanges?.();
    this.unsubscribeAgendaChanges = null;
    this.unsubscribeChannelChanges?.();
    this.unsubscribeChannelChanges = null;
    log.info('stopped');
  }

  async tick(now = new Date()): Promise<void> {
    if (this.tickInFlight) {
      this.tickAgain = true;
      return;
    }
    this.tickInFlight = true;

    try {
      if (!this.notificationService.hasChannels()) {
        log.debug('skip tick: no notification channels');
        return;
      }

      const dueItems = this.agendaStore.due(now);
      if (dueItems.length === 0) return;
      log.info('due agenda found', { count: dueItems.length, now: now.toISOString() });

      for (const item of dueItems) {
        try {
          await this.deliver(item, now);
        } catch (err) {
          log.error('agenda delivery failed', {
            id: item.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      this.tickInFlight = false;
      this.scheduleNextDueTick();
      if (this.tickAgain) {
        this.tickAgain = false;
        void this.tick();
      }
    }
  }

  private async deliver(item: AgendaItem, now: Date): Promise<void> {
    const message = await this.composer.compose(item, now);
    const result = await this.notificationService.notify(message);
    if (result.succeeded <= 0) {
      log.warn('agenda delivery not acknowledged; keeping pending', {
        id: item.id,
        attempted: result.attempted,
        failed: result.failed,
      });
      return;
    }
    this.agendaStore.markDelivered(item.id, now);
    const overdueMs = Math.max(0, now.getTime() - item.triggerAt.getTime());
    log.info('agenda delivered', { id: item.id, type: item.type, priority: item.priority, overdueMs });
  }

  private scheduleNextDueTick(): void {
    this.clearNextDueTimer();
    if (!this.intervalId || !this.notificationService.hasChannels()) return;

    const next = this.agendaStore.nextPendingTime();
    if (!next) return;

    const delayMs = Math.max(0, next.getTime() - Date.now());
    const timerDelay = Math.min(delayMs, MAX_TIMER_DELAY_MS);
    this.nextDueTimerId = setTimeout(() => {
      this.nextDueTimerId = null;
      void this.tick();
    }, timerDelay);
    this.nextDueTimerId.unref?.();
    log.info('scheduled next agenda tick', { scheduledAt: next.toISOString(), delayMs: timerDelay });
  }

  private clearNextDueTimer(): void {
    if (!this.nextDueTimerId) return;
    clearTimeout(this.nextDueTimerId);
    this.nextDueTimerId = null;
  }
}
