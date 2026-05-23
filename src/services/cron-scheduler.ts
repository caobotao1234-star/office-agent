/**
 * CronScheduler — Durable recurring cron-based task scheduler.
 *
 * Creates, deletes, lists, and runs recurring cron tasks.
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
    CronExpressionParser.parse(input.cronExpression, { tz: input.timezone });

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
  // Internal helpers
  // ----------------------------------------------------------

  private shouldFire(task: CronTask, now: Date): boolean {
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

    this.saveToDisk();
  }

  // ----------------------------------------------------------
  // Persistence
  // ----------------------------------------------------------

  private saveToDisk(): void {
    const dir = dirname(this.dataFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data = [...this.tasks.values()].map((t) => ({
      ...t,
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
        if (typeof item.cronExpression !== 'string' || !item.cronExpression) continue;
        const task: CronTask = {
          id: item.id as string,
          cronExpression: item.cronExpression as string,
          prompt: item.prompt as string,
          description: item.description as string,
          timezone: item.timezone as string,
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
