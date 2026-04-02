/**
 * BackgroundTaskManager — Async background task execution.
 *
 * Task 16.1: spawn/cancel/getStatus/list background tasks,
 *            onComplete callback, failure reporting.
 *
 * Requirements: 18.1-18.6
 */

import { randomUUID } from 'node:crypto';
import type {
  BackgroundTaskState,
  BackgroundTaskStatus,
  BackgroundTaskType,
} from '../types/index.js';

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTaskState>();
  private abortControllers = new Map<string, AbortController>();
  private completeCallbacks = new Map<string, Array<(result: BackgroundTaskState) => void>>();

  // ----------------------------------------------------------
  // Spawn
  // ----------------------------------------------------------

  /**
   * Dispatch a long-running task to execute asynchronously in the background.
   * Returns the task id immediately without blocking.
   */
  async spawn(
    type: BackgroundTaskType,
    description: string,
    execute: (signal: AbortSignal) => Promise<string>,
  ): Promise<string> {
    const id = randomUUID();
    const ac = new AbortController();

    const state: BackgroundTaskState = {
      id,
      type,
      status: 'pending',
      description,
      startTime: Date.now(),
    };

    this.tasks.set(id, state);
    this.abortControllers.set(id, ac);

    // Run in background — intentionally not awaited
    this.run(id, execute, ac.signal);

    return id;
  }

  // ----------------------------------------------------------
  // Cancel
  // ----------------------------------------------------------

  async cancel(taskId: string): Promise<void> {
    const state = this.tasks.get(taskId);
    if (!state) throw new Error(`Background task not found: ${taskId}`);

    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      return; // already terminal
    }

    const ac = this.abortControllers.get(taskId);
    if (ac) ac.abort();

    state.status = 'cancelled';
    state.endTime = Date.now();
    this.cleanup(taskId);
    this.notifyComplete(taskId);
  }

  // ----------------------------------------------------------
  // Query
  // ----------------------------------------------------------

  getStatus(taskId: string): BackgroundTaskState | undefined {
    return this.tasks.get(taskId);
  }

  list(): BackgroundTaskState[] {
    return [...this.tasks.values()];
  }

  // ----------------------------------------------------------
  // Completion callback
  // ----------------------------------------------------------

  onComplete(taskId: string, callback: (result: BackgroundTaskState) => void): void {
    const existing = this.completeCallbacks.get(taskId) ?? [];
    existing.push(callback);
    this.completeCallbacks.set(taskId, existing);

    // If already in terminal state, fire immediately
    const state = this.tasks.get(taskId);
    if (state && isTerminal(state.status)) {
      callback(state);
    }
  }

  // ----------------------------------------------------------
  // Internal
  // ----------------------------------------------------------

  private async run(
    taskId: string,
    execute: (signal: AbortSignal) => Promise<string>,
    signal: AbortSignal,
  ): Promise<void> {
    const state = this.tasks.get(taskId);
    if (!state) return;

    state.status = 'running';

    try {
      const result = await execute(signal);

      // Task may have been cancelled while execute() was running
      if (isTerminal(state.status)) return;

      state.status = 'completed';
      state.result = result;
      state.endTime = Date.now();
    } catch (err: unknown) {
      if (isTerminal(state.status)) return;

      state.status = 'failed';
      state.error = err instanceof Error ? err.message : String(err);
      state.endTime = Date.now();
    } finally {
      this.cleanup(taskId);
      this.notifyComplete(taskId);
    }
  }

  private notifyComplete(taskId: string): void {
    const state = this.tasks.get(taskId);
    const callbacks = this.completeCallbacks.get(taskId);
    if (!state || !callbacks) return;

    for (const cb of callbacks) {
      try { cb(state); } catch { /* swallow callback errors */ }
    }
    this.completeCallbacks.delete(taskId);
  }

  private cleanup(taskId: string): void {
    this.abortControllers.delete(taskId);
  }
}

function isTerminal(status: BackgroundTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
