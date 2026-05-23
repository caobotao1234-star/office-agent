/**
 * WebSearchTool — 联网搜索工具
 *
 * 使用 DuckDuckGo 搜索，无需 API Key。
 * Agent 自主决定何时搜索、搜什么关键词。
 *
 * 两个 action:
 *   search — 搜索关键词，返回摘要结果
 *   fetch  — 抓取指定 URL 的网页内容
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';

const SearchInput = z.object({
  action: z.literal('search'),
  query: z.string().min(1).describe('Search query keywords'),
  maxResults: z.number().min(1).max(10).default(5),
});

const FetchInput = z.object({
  action: z.literal('fetch'),
  url: z.string().url().describe('URL to fetch content from'),
});

const WebSearchInput = z.discriminatedUnion('action', [
  SearchInput,
  FetchInput,
]);

export type WebSearchInput = z.infer<typeof WebSearchInput>;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchTool implements Tool<WebSearchInput, unknown> {
  readonly name = 'WebSearch';
  readonly description =
    'Search the internet and fetch web pages. ' +
    'search: search keywords, returns titles + snippets + URLs. ' +
    'fetch: get the text content of a specific URL. ' +
    'Use when you need current information, latest prices, technical specs, or anything beyond your training data.';
  readonly inputSchema = WebSearchInput;

  private enabled = true;

  isEnabled(): boolean { return this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }
  isReadOnly(): boolean { return true; }
  checkPermissions(): PermissionResult { return { allowed: true }; }

  async call(input: WebSearchInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'search': return await this.search(input.query, input.maxResults);
        case 'fetch': return await this.fetchUrl(input.url);
      }
    } catch (err) {
      return { success: false, output: null, error: `搜索失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async search(query: string, maxResults: number): Promise<ToolResult<unknown>> {
    // DuckDuckGo HTML search (no API key needed)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return { success: false, output: null, error: `DuckDuckGo returned ${response.status}` };
    }

    const html = await response.text();
    const results = this.parseSearchResults(html, maxResults);

    return {
      success: true,
      output: {
        query,
        resultCount: results.length,
        results,
      },
    };
  }

  private parseSearchResults(html: string, max: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Parse DuckDuckGo HTML results
    // Each result is in a <div class="result"> with <a class="result__a"> and <a class="result__snippet">
    const resultBlocks = html.split('class="result__body"');

    for (let i = 1; i < resultBlocks.length && results.length < max; i++) {
      const block = resultBlocks[i]!;

      // Extract title and URL
      const titleMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
      // Extract snippet
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      if (titleMatch) {
        let url = titleMatch[1] ?? '';
        // DuckDuckGo wraps URLs in a redirect, extract the actual URL
        const uddgMatch = url.match(/uddg=([^&]*)/);
        if (uddgMatch) url = decodeURIComponent(uddgMatch[1]!);

        const title = this.stripHtml(titleMatch[2] ?? '');
        const snippet = snippetMatch ? this.stripHtml(snippetMatch[1] ?? '') : '';

        if (title && url) {
          results.push({ title, url, snippet });
        }
      }
    }

    return results;
  }

  private async fetchUrl(url: string): Promise<ToolResult<unknown>> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return { success: false, output: null, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { success: false, output: null, error: `不支持的内容类型: ${contentType}` };
    }

    const html = await response.text();
    const text = this.extractMainContent(html);

    // Truncate to avoid blowing up context
    const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n\n[内容已截断，共 ' + text.length + ' 字符]' : text;

    return {
      success: true,
      output: { url, contentLength: text.length, content: truncated },
    };
  }

  /** Extract readable text from HTML, stripping tags and scripts */
  private extractMainContent(html: string): string {
    // Remove scripts, styles, and HTML tags
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
  }
}
