/**
 * SessionStore — 持久化对话历史到磁盘
 * 每次会话的消息存储在 ~/.office-agent/sessions/{sessionId}.json
 * 最近一次会话 ID 记录在 ~/.office-agent/last-session.txt
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message } from '../types/index.js';

export class SessionStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.join(baseDir, 'sessions');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /** 保存会话消息 */
  save(sessionId: string, messages: readonly Message[]): void {
    this.ensureDir();
    const data = messages.map(m => ({
      ...m,
      timestamp: m.timestamp.toISOString(),
    }));
    fs.writeFileSync(
      path.join(this.baseDir, `${sessionId}.json`),
      JSON.stringify(data, null, 2),
      'utf-8',
    );
    // 记录最近会话 ID
    fs.writeFileSync(
      path.join(this.baseDir, '..', 'last-session.txt'),
      sessionId,
      'utf-8',
    );
  }

  /** 加载会话消息 */
  load(sessionId: string): Message[] {
    const filePath = path.join(this.baseDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Array<Record<string, unknown>>;
      return raw.map(m => ({
        role: m.role as Message['role'],
        content: m.content as string,
        toolCallId: m.toolCallId as string | undefined,
        toolName: m.toolName as string | undefined,
        timestamp: new Date(m.timestamp as string),
      }));
    } catch {
      return [];
    }
  }

  /** 获取最近一次会话 ID */
  getLastSessionId(): string | null {
    const filePath = path.join(this.baseDir, '..', 'last-session.txt');
    if (!fs.existsSync(filePath)) return null;
    try {
      return fs.readFileSync(filePath, 'utf-8').trim() || null;
    } catch {
      return null;
    }
  }

  /** 列出所有会话 */
  listSessions(): string[] {
    this.ensureDir();
    return fs.readdirSync(this.baseDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .sort();
  }
}
