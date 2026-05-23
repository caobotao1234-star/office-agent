import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import type { ContextWikiCompiler } from '../../services/context-wiki-compiler.js';

const CompileInput = z.object({
  action: z.literal('compile'),
});

const ListInput = z.object({
  action: z.literal('list'),
});

const ReadInput = z.object({
  action: z.literal('read'),
  path: z.string().min(1),
});

const SearchInput = z.object({
  action: z.literal('search'),
  keyword: z.string().min(1),
  limit: z.number().int().positive().max(50).default(10),
});

const WikiToolInput = z.discriminatedUnion('action', [
  CompileInput,
  ListInput,
  ReadInput,
  SearchInput,
]);

export type WikiToolInput = z.infer<typeof WikiToolInput>;

export class WikiTool implements Tool<WikiToolInput, unknown> {
  readonly name = 'WikiTool';
  readonly description = [
    'Compile and read the local markdown wiki generated from OfficeContextTool records.',
    'Use compile after meaningful office context changes or Feishu sync changes.',
    'Use search/read when the user asks for durable project, people, process, document, or decision knowledge in a human-readable wiki form.',
    'This tool does not call an LLM; it deterministically compiles source context into Markdown pages with sources.',
  ].join(' ');
  readonly inputSchema = WikiToolInput;

  constructor(private compiler: ContextWikiCompiler) {}

  isEnabled(): boolean { return true; }

  isReadOnly(input: WikiToolInput): boolean {
    return input.action !== 'compile';
  }

  checkPermissions(_input: WikiToolInput): PermissionResult {
    return { allowed: true };
  }

  async call(input: WikiToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'compile':
          return { success: true, output: this.compiler.compile() };
        case 'list':
          return { success: true, output: this.compiler.listPages() };
        case 'read': {
          const page = this.compiler.readPage(input.path);
          if (!page) return { success: false, output: null, error: `Wiki page not found: ${input.path}` };
          return { success: true, output: { path: input.path, content: page } };
        }
        case 'search':
          return { success: true, output: this.compiler.search(input.keyword, input.limit) };
      }
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
