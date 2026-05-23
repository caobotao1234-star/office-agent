/**
 * Core data models and types for Office Agent
 */
import { z } from 'zod';

// ============================================================
// Task Management
// ============================================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type TaskSource = 'user_input' | 'feishu_message' | 'feishu_doc' | 'auto_detect';

export const TaskItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'overdue', 'cancelled']),
  priority: z.enum(['urgent', 'high', 'medium', 'low']),
  projectId: z.string().optional(),
  parentTaskId: z.string().optional(),
  subtaskIds: z.array(z.string()),
  dueDate: z.coerce.date().optional(),
  source: z.enum(['user_input', 'feishu_message', 'feishu_doc', 'auto_detect']),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
});

export type TaskItem = z.infer<typeof TaskItemSchema>;

// ============================================================
// Memory System
// ============================================================

export type MemoryType = 'preference' | 'task' | 'project_context' | 'colleague' | 'conversation_summary' | 'decision' | 'commitment';
export type MemorySource = 'user_input' | 'feishu_doc' | 'feishu_message' | 'auto_extract' | 'document_upload';

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  type: MemoryType;
  tags: string[];
  source: MemorySource;
  projectId?: string;
  createdAt: Date;
  updatedAt: Date;
  accessCount: number;
  lastAccessedAt: Date;
}

export interface MemoryQuery {
  projectId?: string;
  type?: MemoryType;
  tags?: string[];
  timeRange?: { start: Date; end: Date };
  keyword?: string;
  limit?: number;
  sortBy?: 'relevance' | 'recency' | 'frequency';
}

// ============================================================
// User Configuration
// ============================================================

export interface FeishuWatchConfig {
  chatGroups: string[];
  documentSpaces: string[];
  folders: string[];
}

export interface UserConfig {
  workingHours: {
    start: string;
    end: string;
    workDays: number[];
  };
  awaySummary: {
    thresholdMinutes: number;
  };
  feishu: {
    enabled: boolean;
    appId?: string;
    appSecret?: string;
    watchConfig?: FeishuWatchConfig;
  };
  timezone: string;
}

// ============================================================
// Messages & Streaming
// ============================================================

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: Date;
}

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolName: string; input: unknown }
  | { type: 'tool_result'; toolName: string; result: ToolResult }
  | { type: 'error'; error: string }
  | { type: 'done' };

export interface ToolResult<T = unknown> {
  success: boolean;
  output: T;
  error?: string;
}

export interface ToolContext {
  abortSignal: AbortSignal;
  memorySystem?: unknown; // Typed in memory-system module
  userConfig: UserConfig;
}

// ============================================================
// Scheduling & Reminders
// ============================================================

export interface CronTask {
  id: string;
  cronExpression: string;
  prompt: string;
  description: string;
  timezone: string;
  lastRunAt?: Date;
  createdAt: Date;
}

export type AgendaItemType = 'reminder' | 'deadline' | 'commitment' | 'follow_up';
export type AgendaItemStatus = 'pending' | 'delivered' | 'cancelled';
export type AgendaItemPriority = 'low' | 'medium' | 'high' | 'urgent';
export type AgendaItemSource = 'llm' | 'user' | 'tool' | 'migration';

export interface AgendaItem {
  id: string;
  type: AgendaItemType;
  title: string;
  description?: string;
  triggerAt: Date;
  deadlineAt?: Date;
  timezone: string;
  priority: AgendaItemPriority;
  status: AgendaItemStatus;
  source: AgendaItemSource;
  sourceMessage?: string;
  context?: string;
  composePrompt?: string;
  createdAt: Date;
  updatedAt: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
}
