/**
 * Tool System - Pluggable capability modules for Office Agent
 * Reference: Claude Code's Tool interface pattern
 */
import type { ZodSchema } from 'zod';
import type { ToolContext, ToolResult } from '../types/index.js';

// ============================================================
// Permission Types
// ============================================================

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

// ============================================================
// Tool Interface
// ============================================================

export interface Tool<Input = unknown, Output = unknown> {
  /** Unique tool name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Zod schema for input validation */
  inputSchema: ZodSchema<Input>;
  /** Optional: pre-built JSON Schema for the API (avoids Zod→JSON conversion issues) */
  parametersJsonSchema?: Record<string, unknown>;

  /** Whether this tool is currently enabled */
  isEnabled(): boolean;
  /** Whether the given input represents a read-only operation */
  isReadOnly(input: Input): boolean;
  /** Check if the operation is permitted */
  checkPermissions(input: Input): PermissionResult;
  /** Execute the tool */
  call(input: Input, context: ToolContext): Promise<ToolResult<Output>>;
  /** Whether this operation requires user confirmation before execution */
  requiresUserConfirmation(input: Input): boolean;
}

// ============================================================
// ToolRegistry
// ============================================================

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** Register a tool. Throws if a tool with the same name already exists. */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Unregister a tool by name. Returns true if removed, false if not found. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Get a tool by name, or undefined if not found. */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** List all registered tools. */
  listAll(): Tool[] {
    return [...this.tools.values()];
  }

  /** List only enabled tools. */
  listEnabled(): Tool[] {
    return [...this.tools.values()].filter((t) => t.isEnabled());
  }

  /** Check if a tool requires user confirmation for the given input. */
  needsConfirmation(name: string, input: unknown): boolean {
    const tool = this.tools.get(name);
    if (!tool) return true; // unknown tool → require confirmation as safety default
    return tool.requiresUserConfirmation(input);
  }

  /** Validate input, check permissions, and execute a tool. */
  async execute(
    name: string,
    rawInput: unknown,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: null, error: `Tool "${name}" not found` };
    }

    if (!tool.isEnabled()) {
      return { success: false, output: null, error: `Tool "${name}" is not enabled` };
    }

    // Validate input against schema
    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, output: null, error: `Invalid input: ${parsed.error.message}` };
    }

    // Check permissions
    const perm = tool.checkPermissions(parsed.data);
    if (!perm.allowed) {
      return { success: false, output: null, error: perm.reason ?? 'Permission denied' };
    }

    // Execute
    try {
      return await tool.call(parsed.data, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: null, error: message };
    }
  }
}
