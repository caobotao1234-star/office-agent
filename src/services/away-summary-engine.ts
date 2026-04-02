/**
 * AwaySummaryEngine — Detects user absence and generates "while you were away" summaries.
 *
 * Task 18.1: checkUserActivity, generateSummary, configurable threshold,
 *            skip summary when no new events, LLM-based summary generation.
 *
 * Requirements: 16.1-16.5
 */

import type { LLMClient } from '../core/llm-client.js';
import type { Message } from '../types/index.js';

export interface UserActivityStatus {
  isAway: boolean;
  awayDurationMinutes: number;
  lastActivityAt: Date;
}

export class AwaySummaryEngine {
  private readonly llm: LLMClient;
  private thresholdMinutes: number;
  private lastActivityAt: Date;

  constructor(llm: LLMClient, thresholdMinutes = 5) {
    this.llm = llm;
    this.thresholdMinutes = thresholdMinutes;
    this.lastActivityAt = new Date();
  }

  // ----------------------------------------------------------
  // Activity tracking
  // ----------------------------------------------------------

  /** Record that the user just interacted. */
  recordActivity(): void {
    this.lastActivityAt = new Date();
  }

  /**
   * Check whether the user is considered "away" based on the
   * elapsed time since the last recorded interaction.
   */
  checkUserActivity(now = new Date()): UserActivityStatus {
    const elapsed = now.getTime() - this.lastActivityAt.getTime();
    const awayMinutes = elapsed / (1000 * 60);

    return {
      isAway: awayMinutes >= this.thresholdMinutes,
      awayDurationMinutes: Math.floor(awayMinutes),
      lastActivityAt: this.lastActivityAt,
    };
  }

  // ----------------------------------------------------------
  // Summary generation
  // ----------------------------------------------------------

  /**
   * Generate a "while you were away" summary.
   *
   * Returns `null` when there are no new messages since the user left
   * (requirement 16.5: no summary when nothing happened).
   *
   * Uses the last 30 messages as context to keep the LLM prompt lightweight.
   */
  async generateSummary(
    messages: Message[],
    signal: AbortSignal,
  ): Promise<string | null> {
    // Filter messages that arrived after the user left
    const newMessages = messages.filter(
      (m) => m.timestamp.getTime() > this.lastActivityAt.getTime(),
    );

    if (newMessages.length === 0) {
      return null; // nothing happened — skip summary
    }

    const recent = newMessages.slice(-30);
    const formatted = recent
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

    const activity = this.checkUserActivity();

    const system = [
      '你是一个办公助理。用户离开了一段时间刚刚回来。',
      '请根据以下离开期间的消息，生成一份简洁的"你不在的时候"摘要。',
      '摘要应包含：重要消息要点、任务状态变更、即将到期的任务提醒。',
      '如果没有重要事项，简短说明即可。使用中文回复。',
    ].join('\n');

    const user = [
      `用户离开时长：${activity.awayDurationMinutes} 分钟`,
      '',
      '离开期间的消息：',
      formatted,
    ].join('\n');

    const summary = await this.llm.query(system, user, signal);
    return summary;
  }

  // ----------------------------------------------------------
  // Threshold configuration
  // ----------------------------------------------------------

  setThreshold(minutes: number): void {
    if (minutes <= 0) throw new Error('Threshold must be positive');
    this.thresholdMinutes = minutes;
  }

  getThreshold(): number {
    return this.thresholdMinutes;
  }
}
