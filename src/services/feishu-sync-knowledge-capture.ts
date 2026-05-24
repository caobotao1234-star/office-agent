import { createHash } from 'node:crypto';
import type { FeishuSyncSource, FeishuSyncSourceType } from './feishu-sync-store.js';
import type { OfficeContextSource, OfficeContextStore, OfficeContextType } from './office-context-store.js';
import type { LarkCliRunResult } from './lark-cli-runner.js';
import { logger } from '../core/logger.js';

const log = logger.child('FeishuSyncKnowledgeCapture');

export interface FeishuSyncCaptureInput {
  source: FeishuSyncSource;
  result: LarkCliRunResult;
  content: string;
  contentHash: string;
}

export interface FeishuSyncCaptureResult {
  contexts: number;
  snippets: Array<{
    type: OfficeContextType;
    title: string;
    summary: string;
  }>;
}

export interface FeishuSyncAutoCapture {
  capture(input: FeishuSyncCaptureInput): Promise<FeishuSyncCaptureResult> | FeishuSyncCaptureResult;
}

export class FeishuSyncKnowledgeCapture implements FeishuSyncAutoCapture {
  constructor(private officeContextStore: OfficeContextStore) {}

  capture(input: FeishuSyncCaptureInput): FeishuSyncCaptureResult {
    const snippets = extractDurableSnippets(input.content);
    let contexts = 0;

    for (const [index, snippet] of snippets.entries()) {
      this.officeContextStore.upsert({
        type: snippet.type,
        key: `feishu-capture:${input.source.id}:${input.contentHash.slice(0, 12)}:${index}`,
        title: snippet.title,
        summary: snippet.summary,
        tags: ['feishu-sync', 'auto-capture', input.source.type, ...input.source.tags],
        projectId: input.source.projectId,
        source: mapOfficeSource(input.source.type),
        sourceRefs: [{
          type: mapOfficeSource(input.source.type),
          id: input.source.id,
          title: input.source.title,
          observedAt: input.source.lastSyncedAt ?? new Date(),
        }],
        metadata: {
          feishuSyncSourceId: input.source.id,
          sourceType: input.source.type,
          command: input.result.command,
          contentHash: input.contentHash,
          autoCaptured: true,
        },
        confidence: 0.55,
        lastSeenAt: input.source.lastSyncedAt ?? new Date(),
      });
      contexts++;
    }

    if (contexts > 0) {
      log.info('sync knowledge captured', { sourceId: input.source.id, count: contexts });
    }

    return { contexts, snippets };
  }
}

export function extractDurableSnippets(content: string, limit = 8): FeishuSyncCaptureResult['snippets'] {
  const lines = normalizeContentLines(content);
  const snippets: FeishuSyncCaptureResult['snippets'] = [];

  for (const line of lines) {
    const classified = classifyLine(line);
    if (!classified) continue;
    snippets.push(classified);
    if (snippets.length >= limit) break;
  }

  return dedupeSnippets(snippets);
}

function normalizeContentLines(content: string): string[] {
  return content
    .replace(/\\n/g, '\n')
    .split(/\n|。|；|;/)
    .map((line) => line.replace(/^(?:[-*#\s]+|\d+[.)、]\s*)+/, '').trim())
    .filter((line) => line.length >= 6 && line.length <= 240);
}

function classifyLine(line: string): FeishuSyncCaptureResult['snippets'][number] | null {
  if (/(决定|决策|结论|确认|定为|采用)/.test(line)) {
    return {
      type: 'knowledge',
      title: `决策：${trimTitle(line)}`,
      summary: line,
    };
  }

  if (/(风险|阻塞|问题|延期|依赖|缺口)/.test(line)) {
    return {
      type: 'knowledge',
      title: `风险：${trimTitle(line)}`,
      summary: line,
    };
  }

  if (/(负责|owner|Owner|负责人)/.test(line)) {
    return {
      type: 'relationship',
      title: `责任关系：${trimTitle(line)}`,
      summary: line,
    };
  }

  if (/(截止|DDL|deadline|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}月\d{1,2}日).*(完成|提交|交付|前|之前|截止)/i.test(line)) {
    return {
      type: 'task',
      title: `时间点：${trimTitle(line)}`,
      summary: line,
    };
  }

  return null;
}

function dedupeSnippets(snippets: FeishuSyncCaptureResult['snippets']): FeishuSyncCaptureResult['snippets'] {
  const seen = new Set<string>();
  const result: FeishuSyncCaptureResult['snippets'] = [];
  for (const snippet of snippets) {
    const key = hash(snippet.type + snippet.summary);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(snippet);
  }
  return result;
}

function trimTitle(line: string): string {
  return line.length > 32 ? `${line.slice(0, 32)}...` : line;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function mapOfficeSource(type: FeishuSyncSourceType): OfficeContextSource {
  switch (type) {
    case 'doc':
    case 'docs_search':
    case 'wiki_node':
      return 'feishu_doc';
    case 'chat_messages':
    case 'message_search':
      return 'feishu_message';
    case 'calendar_agenda':
      return 'feishu_calendar';
    case 'base_records':
      return 'feishu_base';
    case 'task_search':
    case 'contact_search':
    case 'raw':
      return 'tool';
  }
}
