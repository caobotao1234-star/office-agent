import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemorySystem } from '../../core/memory-system.js';
import { AgendaStore } from '../../services/agenda-store.js';
import { OfficeContextStore } from '../../services/office-context-store.js';
import { KnowledgeCaptureTool } from './index.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-capture-tool-'));
}

function createTool(dir = tmpDir()): {
  tool: KnowledgeCaptureTool;
  officeContextStore: OfficeContextStore;
  memorySystem: MemorySystem;
  agendaStore: AgendaStore;
} {
  const officeContextStore = new OfficeContextStore(path.join(dir, 'office-context.json'));
  const memorySystem = new MemorySystem(path.join(dir, 'memdir'));
  const agendaStore = new AgendaStore(path.join(dir, 'agenda.json'));
  return {
    tool: new KnowledgeCaptureTool(officeContextStore, memorySystem, agendaStore),
    officeContextStore,
    memorySystem,
    agendaStore,
  };
}

const ctx = { abortSignal: new AbortController().signal, userConfig: {} as never };

async function callTool(tool: KnowledgeCaptureTool, input: unknown) {
  return tool.call(tool.inputSchema.parse(input), ctx);
}

describe('KnowledgeCaptureTool', () => {
  it('captures contexts, memories, and agenda items in one batch', async () => {
    const { tool, officeContextStore, memorySystem, agendaStore } = createTool();

    const result = await callTool(tool, {
      action: 'capture',
      sourceType: 'conversation',
      sourceId: 'msg-1',
      sourceTitle: '用户口述 Apollo 状态',
      observedAt: '2026-05-23T02:00:00.000Z',
      note: '用户说明项目责任人和提交承诺。',
      contexts: [
        {
          type: 'project',
          key: 'project:apollo',
          title: 'Apollo 项目',
          summary: '增长项目，张三负责前端，本周需要提交方案。',
          status: 'active',
          tags: ['growth'],
          relations: [{ type: 'owned_by', targetKey: 'person:zhang-san', targetTitle: '张三' }],
          confidence: 0.9,
        },
      ],
      memories: [
        {
          title: 'Apollo 方案提交承诺',
          content: '用户承诺本周五给客户提交 Apollo 方案。',
          type: 'commitment',
          tags: ['Apollo', '客户'],
          projectId: 'project:apollo',
        },
      ],
      agendaItems: [
        {
          type: 'commitment',
          title: '给客户提交 Apollo 方案',
          triggerAt: '2026-05-29T09:00:00.000Z',
          deadlineAt: '2026-05-29T18:00:00.000Z',
          priority: 'high',
          context: 'Apollo 项目客户方案',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect((result.output as any).counts).toEqual({ contexts: 1, memories: 1, agendaItems: 1 });

    const context = officeContextStore.get('project:apollo');
    expect(context?.sourceRefs[0]?.id).toBe('msg-1');
    expect(context?.relations[0]?.targetKey).toBe('person:zhang-san');

    const memories = await memorySystem.search({ keyword: 'Apollo', type: 'commitment' });
    expect(memories).toHaveLength(1);
    expect(memories[0]?.projectId).toBe('project:apollo');

    const agendaItems = agendaStore.list({ type: 'commitment' });
    expect(agendaItems).toHaveLength(1);
    expect(agendaItems[0]?.deadlineAt?.toISOString()).toBe('2026-05-29T18:00:00.000Z');
  });

  it('maps Feishu document sources to context refs and memory sources', async () => {
    const { tool, officeContextStore, memorySystem } = createTool();

    await callTool(tool, {
      action: 'capture',
      sourceType: 'feishu_doc',
      sourceId: 'docx_123',
      sourceUrl: 'https://example.feishu.cn/docx/docx_123',
      sourceTitle: 'Apollo 周报',
      contexts: [
        {
          type: 'document',
          key: 'doc:docx_123',
          title: 'Apollo 周报',
          summary: 'Apollo 项目的周报文档。',
          tags: ['weekly'],
        },
      ],
      memories: [
        {
          title: 'Apollo 周报格式',
          content: '周报需要包含进展、风险、下周计划。',
          type: 'project_context',
          tags: ['weekly'],
        },
      ],
    });

    expect(officeContextStore.get('doc:docx_123')?.source).toBe('feishu_doc');
    expect(officeContextStore.get('doc:docx_123')?.sourceRefs[0]?.url).toContain('feishu');

    const memories = await memorySystem.search({ keyword: '周报格式' });
    expect(memories[0]?.source).toBe('feishu_doc');
  });

  it('does nothing successfully for an empty capture batch', async () => {
    const { tool } = createTool();

    const result = await callTool(tool, {
      action: 'capture',
      sourceType: 'conversation',
      note: 'No durable context.',
    });

    expect(result.success).toBe(true);
    expect((result.output as any).counts).toEqual({ contexts: 0, memories: 0, agendaItems: 0 });
  });
});
