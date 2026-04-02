/**
 * TaskManager Tool — Task CRUD, status tracking, overdue detection,
 * task decomposition, and filtered queries.
 *
 * Persists data to ~/.office-agent/tasks.json
 * Implements the Tool interface from core/tool-system.ts
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult, TaskItem, TaskStatus, TaskPriority, TaskSource } from '../../types/index.js';

// ============================================================
// Input Schema
// ============================================================

const CreateTaskInput = z.object({
  action: z.literal('create'),
  description: z.string().min(1),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).default('medium'),
  projectId: z.string().optional(),
  parentTaskId: z.string().optional(),
  dueDate: z.coerce.date().optional(),
  source: z.enum(['user_input', 'feishu_message', 'feishu_doc', 'auto_detect']).default('user_input'),
  reminderAdvance: z.number().optional(),
});

const UpdateTaskInput = z.object({
  action: z.literal('update'),
  id: z.string(),
  description: z.string().optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  projectId: z.string().optional(),
  dueDate: z.coerce.date().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'overdue', 'cancelled']).optional(),
  reminderAdvance: z.number().optional(),
});

const DeleteTaskInput = z.object({
  action: z.literal('delete'),
  id: z.string(),
});

const GetTaskInput = z.object({
  action: z.literal('get'),
  id: z.string(),
});

const ListTasksInput = z.object({
  action: z.literal('list'),
  projectId: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'overdue', 'cancelled']).optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  dueBefore: z.coerce.date().optional(),
  dueAfter: z.coerce.date().optional(),
});

const DecomposeTaskInput = z.object({
  action: z.literal('decompose'),
  id: z.string(),
  subtasks: z.array(z.object({
    description: z.string().min(1),
    priority: z.enum(['urgent', 'high', 'medium', 'low']).default('medium'),
    dueDate: z.coerce.date().optional(),
  })),
});

const CheckOverdueInput = z.object({
  action: z.literal('check_overdue'),
});

const TaskManagerInput = z.discriminatedUnion('action', [
  CreateTaskInput,
  UpdateTaskInput,
  DeleteTaskInput,
  GetTaskInput,
  ListTasksInput,
  DecomposeTaskInput,
  CheckOverdueInput,
]);

export type TaskManagerInput = z.infer<typeof TaskManagerInput>;

// ============================================================
// Persistence helpers
// ============================================================

const DATA_DIR = path.join(os.homedir(), '.office-agent');
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');

/** Serialise dates to ISO strings for JSON storage */
function serialiseTasks(tasks: TaskItem[]): string {
  return JSON.stringify(tasks, null, 2);
}

/** Deserialise JSON back to TaskItem[], coercing date strings */
function deserialiseTasks(raw: string): TaskItem[] {
  const arr = JSON.parse(raw) as Array<Record<string, unknown>>;
  return arr.map((t) => ({
    ...t,
    dueDate: t.dueDate ? new Date(t.dueDate as string) : undefined,
    createdAt: new Date(t.createdAt as string),
    updatedAt: new Date(t.updatedAt as string),
    completedAt: t.completedAt ? new Date(t.completedAt as string) : undefined,
    subtaskIds: (t.subtaskIds as string[]) ?? [],
  })) as TaskItem[];
}

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadTasks(): TaskItem[] {
  ensureDir();
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return deserialiseTasks(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTasks(tasks: TaskItem[]): void {
  ensureDir();
  fs.writeFileSync(DATA_FILE, serialiseTasks(tasks), 'utf-8');
}

// ============================================================
// Valid status transitions
// ============================================================

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'cancelled', 'overdue'],
  in_progress: ['completed', 'cancelled', 'overdue'],
  completed: [],           // terminal
  overdue: ['in_progress', 'completed', 'cancelled'],
  cancelled: [],           // terminal
};

function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================
// Core operations (exported for testing)
// ============================================================

export function createTask(
  input: z.infer<typeof CreateTaskInput>,
  tasks: TaskItem[],
): TaskItem {
  const now = new Date();
  const task: TaskItem = {
    id: randomUUID(),
    description: input.description,
    status: 'pending',
    priority: input.priority,
    projectId: input.projectId,
    parentTaskId: input.parentTaskId,
    subtaskIds: [],
    dueDate: input.dueDate,
    source: input.source,
    reminderAdvance: input.reminderAdvance,
    createdAt: now,
    updatedAt: now,
  };

  // If this is a subtask, register it in the parent
  if (input.parentTaskId) {
    const parent = tasks.find((t) => t.id === input.parentTaskId);
    if (parent) {
      parent.subtaskIds.push(task.id);
      parent.updatedAt = now;
    }
  }

  tasks.push(task);
  return task;
}

export function updateTask(
  input: z.infer<typeof UpdateTaskInput>,
  tasks: TaskItem[],
): TaskItem {
  const task = tasks.find((t) => t.id === input.id);
  if (!task) throw new Error(`Task "${input.id}" not found`);

  const now = new Date();

  if (input.status && input.status !== task.status) {
    if (!isValidTransition(task.status, input.status)) {
      throw new Error(`Invalid status transition: ${task.status} → ${input.status}`);
    }
    task.status = input.status;
    if (input.status === 'completed') {
      task.completedAt = now;
    }
  }

  if (input.description !== undefined) task.description = input.description;
  if (input.priority !== undefined) task.priority = input.priority;
  if (input.projectId !== undefined) task.projectId = input.projectId;
  if (input.dueDate !== undefined) task.dueDate = input.dueDate;
  if (input.reminderAdvance !== undefined) task.reminderAdvance = input.reminderAdvance;
  task.updatedAt = now;

  return task;
}

export function deleteTask(id: string, tasks: TaskItem[]): TaskItem[] {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`Task "${id}" not found`);

  const task = tasks[idx];

  // Remove from parent's subtaskIds
  if (task.parentTaskId) {
    const parent = tasks.find((t) => t.id === task.parentTaskId);
    if (parent) {
      parent.subtaskIds = parent.subtaskIds.filter((sid) => sid !== id);
      parent.updatedAt = new Date();
    }
  }

  // Remove the task
  tasks.splice(idx, 1);
  return tasks;
}

export function decomposeTasks(
  input: z.infer<typeof DecomposeTaskInput>,
  tasks: TaskItem[],
): TaskItem[] {
  const parent = tasks.find((t) => t.id === input.id);
  if (!parent) throw new Error(`Task "${input.id}" not found`);

  const created: TaskItem[] = [];
  for (const sub of input.subtasks) {
    const child = createTask(
      {
        action: 'create',
        description: sub.description,
        priority: sub.priority,
        dueDate: sub.dueDate,
        parentTaskId: parent.id,
        projectId: parent.projectId,
        source: parent.source,
      },
      tasks,
    );
    created.push(child);
  }
  return created;
}

export function checkOverdue(tasks: TaskItem[]): TaskItem[] {
  const now = new Date();
  const updated: TaskItem[] = [];
  for (const task of tasks) {
    if (
      task.dueDate &&
      task.dueDate.getTime() < now.getTime() &&
      (task.status === 'pending' || task.status === 'in_progress')
    ) {
      task.status = 'overdue';
      task.updatedAt = now;
      updated.push(task);
    }
  }
  return updated;
}

export function filterTasks(
  input: z.infer<typeof ListTasksInput>,
  tasks: TaskItem[],
): TaskItem[] {
  let result = tasks;

  if (input.projectId) {
    result = result.filter((t) => t.projectId === input.projectId);
  }
  if (input.status) {
    result = result.filter((t) => t.status === input.status);
  }
  if (input.priority) {
    result = result.filter((t) => t.priority === input.priority);
  }
  if (input.dueBefore) {
    const before = input.dueBefore.getTime();
    result = result.filter((t) => t.dueDate && t.dueDate.getTime() <= before);
  }
  if (input.dueAfter) {
    const after = input.dueAfter.getTime();
    result = result.filter((t) => t.dueDate && t.dueDate.getTime() >= after);
  }

  return result;
}

// ============================================================
// TaskManager Tool implementation
// ============================================================

export class TaskManagerTool implements Tool<TaskManagerInput, unknown> {
  name = 'TaskManager';
  description = 'Manage tasks: create, update, delete, query, decompose, and detect overdue tasks.';
  inputSchema = TaskManagerInput;
  parametersJsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete', 'get', 'list', 'decompose', 'check_overdue'], description: 'The operation to perform' },
      description: { type: 'string', description: 'Task description (for create)' },
      id: { type: 'string', description: 'Task ID (for update/delete/get)' },
      priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'], description: 'Task priority' },
      projectId: { type: 'string', description: 'Project ID to associate with' },
      dueDate: { type: 'string', description: 'Due date in ISO format' },
      source: { type: 'string', enum: ['user_input', 'feishu_message', 'feishu_doc', 'auto_detect'] },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'overdue', 'cancelled'] },
    },
    required: ['action'],
  };

  private enabled = true;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isReadOnly(input: TaskManagerInput): boolean {
    return input.action === 'get' || input.action === 'list' || input.action === 'check_overdue';
  }

  checkPermissions(_input: TaskManagerInput): PermissionResult {
    return { allowed: true };
  }

  requiresUserConfirmation(input: TaskManagerInput): boolean {
    // Write operations require confirmation; reads do not
    return !this.isReadOnly(input);
  }

  async call(input: TaskManagerInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      const tasks = loadTasks();
      let output: unknown;

      switch (input.action) {
        case 'create': {
          const task = createTask(input, tasks);
          saveTasks(tasks);
          output = task;
          break;
        }
        case 'update': {
          const task = updateTask(input, tasks);
          saveTasks(tasks);
          output = task;
          break;
        }
        case 'delete': {
          deleteTask(input.id, tasks);
          saveTasks(tasks);
          output = { deleted: input.id };
          break;
        }
        case 'get': {
          const task = tasks.find((t) => t.id === input.id);
          if (!task) return { success: false, output: null, error: `Task "${input.id}" not found` };
          output = task;
          break;
        }
        case 'list': {
          output = filterTasks(input, tasks);
          break;
        }
        case 'decompose': {
          const created = decomposeTasks(input, tasks);
          saveTasks(tasks);
          output = created;
          break;
        }
        case 'check_overdue': {
          const updated = checkOverdue(tasks);
          if (updated.length > 0) saveTasks(tasks);
          output = updated;
          break;
        }
      }

      return { success: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: null, error: message };
    }
  }
}
