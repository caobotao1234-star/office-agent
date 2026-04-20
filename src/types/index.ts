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
  reminderAdvance: z.number().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
});

export type TaskItem = z.infer<typeof TaskItemSchema>;

// ============================================================
// Information Management
// ============================================================

export type InformationType = 'meeting_note' | 'decision' | 'action_item' | 'reference' | 'contact' | 'general';
export type InformationSource = 'user_input' | 'feishu_doc' | 'feishu_message' | 'excel' | 'word' | 'webpage';

export interface ExtractedEntity {
  type: 'person' | 'date' | 'task' | 'deadline' | 'commitment';
  value: string;
  confidence: number;
}

export const ExtractedEntitySchema = z.object({
  type: z.enum(['person', 'date', 'task', 'deadline', 'commitment']),
  value: z.string(),
  confidence: z.number().min(0).max(1),
});

export const InformationEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  type: z.enum(['meeting_note', 'decision', 'action_item', 'reference', 'contact', 'general']),
  source: z.enum(['user_input', 'feishu_doc', 'feishu_message', 'excel', 'word', 'webpage']),
  tags: z.array(z.string()),
  extractedEntities: z.array(ExtractedEntitySchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type InformationEntry = z.infer<typeof InformationEntrySchema>;

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
  reminder: {
    dailyBriefingTime: string;
    weeklySummaryDay: number;
    weeklySummaryTime: string;
    intensity: 'low' | 'standard' | 'high';
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
  enabledTools: string[];
  smartReminder: {
    staleProjectDays: number;
  };
  timezone: string;
}

// ============================================================
// Messages & Streaming
// ============================================================

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  images?: string[];  // base64 data URLs for multimodal messages
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
// Scheduling & Background Tasks
// ============================================================

export interface CronTask {
  id: string;
  type: 'one_time' | 'recurring';
  cronExpression?: string;
  scheduledAt?: Date;
  prompt: string;
  description: string;
  timezone: string;
  durable: boolean;
  lastRunAt?: Date;
  createdAt: Date;
}

export type BackgroundTaskType = 'document_sync' | 'report_generation' | 'feishu_batch_sync' | 'data_export' | 'sub_agent';
export type BackgroundTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundTaskState {
  id: string;
  type: BackgroundTaskType;
  status: BackgroundTaskStatus;
  description: string;
  startTime: number;
  endTime?: number;
  result?: string;
  error?: string;
}

// ============================================================
// Reminders & Suggestions
// ============================================================

export interface Reminder {
  id: string;
  type: 'daily_briefing' | 'weekly_summary' | 'deadline_urgent' | 'deadline_warning' | 'smart_followup' | 'smart_commitment' | 'smart_stale_project';
  taskId?: string;
  message: string;
  reason: string;
  scheduledAt: Date;
  delivered: boolean;
}

export interface Suggestion {
  id: string;
  text: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}
