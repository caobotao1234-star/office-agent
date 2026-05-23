import { logger } from '../core/logger.js';

const log = logger.child('SerialMessageQueue');

export interface EnqueueResult<T> {
  queuedBefore: number;
  promise: Promise<T>;
}

export class SerialMessageQueue {
  private tail: Promise<void> = Promise.resolve();
  private active = false;
  private queued = 0;

  pendingCount(): number {
    return (this.active ? 1 : 0) + this.queued;
  }

  isBusy(): boolean {
    return this.pendingCount() > 0;
  }

  enqueue<T>(task: () => Promise<T>): EnqueueResult<T> {
    const queuedBefore = this.pendingCount();
    this.queued++;

    const run = async (): Promise<T> => {
      this.queued--;
      this.active = true;
      try {
        return await task();
      } finally {
        this.active = false;
      }
    };

    const promise = this.tail.then(run, run);
    this.tail = promise.then(
      () => undefined,
      (err) => {
        log.error('queued task failed', { error: err instanceof Error ? err.message : String(err) });
      },
    );

    return { queuedBefore, promise };
  }
}
