/**
 * MemoryTool — Tool interface wrapper for MemorySystem.
 *
 * Operations: store, search, delete, export
 * Delegates to MemorySystem for actual logic.
 *
 * Requirements: 3.6, 13.3
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import type { MemorySystem } from '../../core/memory-system.js';

// ============================================================
// Input Schema
// ============================================================

const StoreMemoryInput = z.object({
  action: z.literal('store'),
  title: z.string().min(1),
  content: z.string().min(1),
  type: z.enum(['preference', 'task', 'project_context', 'colleague', 'conversation_summary', 'decision', 'commitment']),
  tags: z.array(z.string()).default([]),
  source: z.enum(['user_input', 'feishu_doc', 'feishu_message', 'auto_extract', 'document_upload']).default('user_input'),
  projectId: z.string().optional(),
});

const SearchMemoryInput = z.object({
  action: z.literal('search'),
  keyword: z.string().optional(),
  type: z.enum(['preference', 'task', 'project_context', 'colleague', 'conversation_summary', 'decision', 'commitment']).optional(),
  tags: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  limit: z.number().positive().optional(),
  sortBy: z.enum(['relevance', 'recency', 'frequency']).optional(),
});

const DeleteMemoryInput = z.object({
  action: z.literal('delete'),
  id: z.string().min(1),
});

const DeleteAllMemoryInput = z.object({
  action: z.literal('deleteAll'),
});

const ExportMemoryInput = z.object({
  action: z.literal('export'),
  format: z.enum(['json', 'markdown']).default('json'),
});

const MemoryToolInput = z.discriminatedUnion('action', [
  StoreMemoryInput,
  SearchMemoryInput,
  DeleteMemoryInput,
  DeleteAllMemoryInput,
  ExportMemoryInput,
]);

export type MemoryToolInput = z.infer<typeof MemoryToolInput>;

// ============================================================
// MemoryTool
// ============================================================

export class MemoryTool implements Tool<MemoryToolInput, unknown> {
  readonly name = 'MemoryTool';
  readonly description = 'Manage long-term memory: store, search, delete entries, and export all data.';
  readonly inputSchema = MemoryToolInput;

  private memorySystem: MemorySystem;
  private enabled = true;

  constructor(memorySystem: MemorySystem) {
    this.memorySystem = memorySystem;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isReadOnly(input: MemoryToolInput): boolean {
    return input.action === 'search' || input.action === 'export';
  }

  checkPermissions(_input: MemoryToolInput): PermissionResult {
    return { allowed: true };
  }

  async call(input: MemoryToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'store': {
          const entry = await this.memorySystem.store({
            title: input.title,
            content: input.content,
            type: input.type,
            tags: input.tags,
            source: input.source,
            projectId: input.projectId,
            updatedAt: new Date(),
          });
          return { success: true, output: entry };
        }
        case 'search': {
          const results = await this.memorySystem.search({
            keyword: input.keyword,
            type: input.type,
            tags: input.tags,
            projectId: input.projectId,
            limit: input.limit,
            sortBy: input.sortBy,
          });
          return { success: true, output: results };
        }
        case 'delete': {
          await this.memorySystem.delete(input.id);
          return { success: true, output: { deleted: true, id: input.id } };
        }
        case 'deleteAll': {
          await this.memorySystem.deleteAll();
          return { success: true, output: { deletedAll: true } };
        }
        case 'export': {
          const data = await this.memorySystem.exportAll(input.format);
          return { success: true, output: { format: input.format, data } };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: null, error: message };
    }
  }
}
