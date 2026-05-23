import { describe, expect, it } from 'vitest';
import { SerialMessageQueue } from './serial-message-queue.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SerialMessageQueue', () => {
  it('runs enqueued tasks sequentially', async () => {
    const queue = new SerialMessageQueue();
    const events: string[] = [];

    const first = queue.enqueue(async () => {
      events.push('first:start');
      await wait(20);
      events.push('first:end');
      return 'first';
    });

    const second = queue.enqueue(async () => {
      events.push('second:start');
      await wait(1);
      events.push('second:end');
      return 'second';
    });

    expect(first.queuedBefore).toBe(0);
    expect(second.queuedBefore).toBe(1);
    expect(queue.pendingCount()).toBe(2);

    await expect(first.promise).resolves.toBe('first');
    await expect(second.promise).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    expect(queue.pendingCount()).toBe(0);
  });

  it('continues after a task fails', async () => {
    const queue = new SerialMessageQueue();
    const events: string[] = [];

    const first = queue.enqueue(async () => {
      events.push('first');
      throw new Error('boom');
    });
    const second = queue.enqueue(async () => {
      events.push('second');
      return 'ok';
    });

    await expect(first.promise).rejects.toThrow('boom');
    await expect(second.promise).resolves.toBe('ok');
    expect(events).toEqual(['first', 'second']);
    expect(queue.isBusy()).toBe(false);
  });
});
