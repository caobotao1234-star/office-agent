/**
 * CronScheduler — Durable cron-based task scheduler.
 *
 * Task 11.1: create/update/delete/list cron tasks, start/stop scheduling loop,
 *            durable persistence to JSON, missed-task recovery.
 *
 * Requirements: 17.1-17.7
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import type { CronTask } from '../types/index.js';

export type CronFireCallback = (task: CronTask) => void;

export class CronScheduler {
  private tasks: Map<string, CronTask> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly dataFilePath: string;
  private readonly onFire: CronFireCallback;

  constructor(dataFilePath: string, onFire: CronFireCallback) {
    this.dataFilePath = dataFilePath;
    this.onFire = onFire;
    this.loadFromDisk();
  }

  // ----------------------------------------------------------
  // CRUD
  // ----------------------------------------------------------

  create(input: Omit<CronTask, 'id' | 'createdAt'>): CronTask {
    // Validate cron expression for recurring tasks
    if (input.type === 'recurring') {
      if (!input.cronExpression) {
        throw new Error('Recurring tasks require a cronExpression');
      }
      CronExpressionParser.parse(input.cronExpression, { tz: input.timezone });
    }

    // Validate one-time tasks have scheduledAt
    if (input.type === 'one_time' && !input.scheduledAt) {
      throw new Error('One-time tasks require a scheduledAt date');
    }

    const task: CronTask = {
      ...input,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.tasks.set(task.id, task);
    this.saveToDisk();
    return task;
  }

  update(id: string, updates: Partial<Omit<CronTask, 'id' | 'createdAt'>>): CronTask {
    const existing = this.tasks.get(id);
    if (!existing) throw new Error(`CronTask not found: ${id}`);

    // Validate new cron expression if provided
    if (updates.cronExpression) {
      const tz = updates.timezone ?? existing.timezone;
      CronExpressionParser.parse(updates.cronExpression, { tz });
    }

    const updated: CronTask = { ...existing, ...updates };
    this.tasks.set(id, updated);
    this.saveToDisk();
    return updated;
  }

  delete(id: string): void {
    if (!this.tasks.has(id)) throw new Error(`CronTask not found: ${id}`);
    this.tasks.delete(id);
    this.saveToDisk();
  }

  list(): CronTask[] {
    return [...this.tasks.values()];
  }

  // ----------------------------------------------------------
  // Scheduling loop
  // ----------------------------------------------------------

  start(): void {
    if (this.intervalId) return; // already running
    this.intervalId = setInterval(() => this.tick(), 60_000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Exposed for testing — run one scheduling cycle. */
  tick(now = new Date()): void {
    for (const task of this.tasks.values()) {
      if (this.shouldFire(task, now)) {
        this.fire(task, now);
      }
    }
  }

  // ----------------------------------------------------------
  // Missed-task recovery
  // ----------------------------------------------------------

  /**
   * Check for one-time tasks that should have fired while the system was offline.
   * Returns the list of tasks that were retroactively fired.
   */
  checkMissedTasks(now = new Date()): CronTask[] {
    const fired: CronTask[] = [];

    for (const task of this.tasks.values()) {
      if (task.type !== 'one_time') continue;
      if (task.lastRunAt) continue; // already executed
      if (!task.scheduledAt) continue;

      if (task.scheduledAt.getTime() <= now.getTime()) {
        fired.push({ ...task });
        this.fire(task, now);
      }
    }

    return fired;
  }

  // ----------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------

  private shouldFire(task: CronTask, now: Date): boolean {
    if (task.type === 'one_time') {
      if (task.lastRunAt) return false; // already fired
      if (!task.scheduledAt) return false;
      return task.scheduledAt.getTime() <= now.getTime();
    }

    // Recurring: check if current minute matches cron expression
    if (!task.cronExpression) return false;

    try {
      const expr = CronExpressionParser.parse(task.cronExpression, {
        tz: task.timezone,
        currentDate: now,
      });
      const prev = expr.prev();
      const prevTime = prev.getTime();

      // Fire if the previous matching time is within the last 60 seconds
      // and we haven't already fired for it
      const withinWindow = now.getTime() - prevTime < 60_000;
      const notYetFired = !task.lastRunAt || task.lastRunAt.getTime() < prevTime;

      return withinWindow && notYetFired;
    } catch {
      return false;
    }
  }

  private fire(task: CronTask, now: Date): void {
    // Update lastRunAt
    task.lastRunAt = now;

    // Invoke callback
    this.onFire(task);

    // Auto-delete one-time tasks after execution
    if (task.type === 'one_time') {
      this.tasks.delete(task.id);
    }

    this.saveToDisk();
  }

  // ----------------------------------------------------------
  // Persistence (durable mode)
  // ----------------------------------------------------------

  private saveToDisk(): void {
    const dir = dirname(this.dataFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data = [...this.tasks.values()].map((t) => ({
      ...t,
      scheduledAt: t.scheduledAt?.toISOString() ?? null,
      lastRunAt: t.lastRunAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }));

    writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private loadFromDisk(): void {
    if (!existsSync(this.dataFilePath)) return;

    try {
      const raw = readFileSync(this.dataFilePath, 'utf-8');
      const arr = JSON.parse(raw) as Array<Record<string, unknown>>;

      for (const item of arr) {
        const task: CronTask = {
          id: item.id as string,
          type: item.type as CronTask['type'],
          cronExpression: (item.cronExpression as string) ?? undefined,
          scheduledAt: item.scheduledAt ? new Date(item.scheduledAt as string) : undefined,
          prompt: item.prompt as string,
          description: item.description as string,
          timezone: item.timezone as string,
          durable: (item.durable as boolean) ?? true,
          lastRunAt: item.lastRunAt ? new Date(item.lastRunAt as string) : undefined,
          createdAt: new Date(item.createdAt as string),
        };
        this.tasks.set(task.id, task);
      }
    } catch {
      // Corrupted file — start fresh
      this.tasks.clear();
    }
  }
}
