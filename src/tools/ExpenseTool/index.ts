/**
 * ExpenseTool — 报销记账工具
 *
 * 记录因公采购，追踪发票状态和报销状态。
 * 用户随手发几个字就能记下来，报销时一目了然。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';

// ============================================================
// Data Model
// ============================================================

interface ExpenseRecord {
  id: string;
  description: string;
  amount?: number;
  platform?: string;        // 淘宝、京东、1688、线下等
  purchaseDate: string;      // ISO date string
  invoiceStatus: 'pending' | 'received';
  reimbursementStatus: 'unreimbursed' | 'reimbursed';
  reimbursedAt?: string;
  category?: string;         // 办公用品、样品、设备等
  note?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Persistence
// ============================================================

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadExpenses(filePath: string): ExpenseRecord[] {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveExpenses(filePath: string, records: ExpenseRecord[]): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
}

// ============================================================
// Input Schema
// ============================================================

const CreateExpenseInput = z.object({
  action: z.literal('create'),
  description: z.string().min(1).describe('购买物品描述'),
  amount: z.number().optional().describe('金额（元），用户没说就不填'),
  platform: z.string().optional().describe('购买平台：淘宝、京东、1688、拼多多、线下等'),
  purchaseDate: z.string().optional().describe('购买日期 YYYY-MM-DD，用户没说就用今天'),
  invoiceStatus: z.enum(['pending', 'received']).optional().describe('发票状态，默认 pending（未到），用户明确说有发票才填 received'),
  category: z.string().optional().describe('分类：办公用品、样品、设备、耗材、差旅等'),
  note: z.string().optional().describe('备注'),
});

const UpdateExpenseInput = z.object({
  action: z.literal('update'),
  id: z.string().optional().describe('记录 ID，如果不知道可以用 description 模糊匹配'),
  description: z.string().optional().describe('用描述模糊匹配记录'),
  invoiceStatus: z.enum(['pending', 'received']).optional(),
  reimbursementStatus: z.enum(['unreimbursed', 'reimbursed']).optional(),
  amount: z.number().optional(),
  note: z.string().optional(),
});

const ListExpenseInput = z.object({
  action: z.literal('list'),
  filter: z.enum(['all', 'unreimbursed', 'reimbursed', 'no_invoice']).optional().describe('筛选条件，默认 unreimbursed'),
});

const DeleteExpenseInput = z.object({
  action: z.literal('delete'),
  id: z.string().optional(),
  description: z.string().optional().describe('用描述模糊匹配'),
});

const SummaryExpenseInput = z.object({
  action: z.literal('summary'),
});

const ExpenseToolInput = z.discriminatedUnion('action', [
  CreateExpenseInput,
  UpdateExpenseInput,
  ListExpenseInput,
  DeleteExpenseInput,
  SummaryExpenseInput,
]);

export type ExpenseToolInput = z.infer<typeof ExpenseToolInput>;

// ============================================================
// ExpenseTool
// ============================================================

export class ExpenseTool implements Tool<ExpenseToolInput, unknown> {
  readonly name = 'ExpenseTool';
  readonly description = [
    '报销记账工具：记录因公采购、追踪发票和报销状态。',
    'Actions: create(记录新采购), update(更新发票/报销状态), list(查看记录), delete(删除), summary(汇总统计)。',
    '默认发票状态为 pending（未到），除非用户明确说有发票。',
    '默认报销状态为 unreimbursed（未报销）。',
  ].join(' ');
  readonly inputSchema = ExpenseToolInput;

  private enabled = true;
  private dataFile: string;

  constructor(baseDir?: string) {
    const dir = baseDir ?? path.join(process.env['HOME'] ?? '', '.office-agent');
    this.dataFile = path.join(dir, 'expenses.json');
  }

  isEnabled(): boolean { return this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }

  isReadOnly(input: ExpenseToolInput): boolean {
    return input.action === 'list' || input.action === 'summary';
  }

  checkPermissions(_input: ExpenseToolInput): PermissionResult {
    return { allowed: true };
  }

  requiresUserConfirmation(_input: ExpenseToolInput): boolean {
    return false; // 记账操作不需要确认，要快
  }

  async call(input: ExpenseToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      const records = loadExpenses(this.dataFile);

      switch (input.action) {
        case 'create': {
          const now = new Date().toISOString();
          const record: ExpenseRecord = {
            id: crypto.randomUUID().slice(0, 8),
            description: input.description,
            amount: input.amount,
            platform: input.platform,
            purchaseDate: input.purchaseDate ?? new Date().toISOString().slice(0, 10),
            invoiceStatus: input.invoiceStatus ?? 'pending',
            reimbursementStatus: 'unreimbursed',
            category: input.category,
            note: input.note,
            createdAt: now,
            updatedAt: now,
          };
          records.push(record);
          saveExpenses(this.dataFile, records);
          return { success: true, output: record };
        }

        case 'update': {
          const target = this.findRecord(records, input.id, input.description);
          if (!target) {
            return { success: false, output: null, error: '找不到匹配的记录' };
          }
          if (input.invoiceStatus) target.invoiceStatus = input.invoiceStatus;
          if (input.reimbursementStatus) {
            target.reimbursementStatus = input.reimbursementStatus;
            if (input.reimbursementStatus === 'reimbursed') {
              target.reimbursedAt = new Date().toISOString();
            }
          }
          if (input.amount !== undefined) target.amount = input.amount;
          if (input.note) target.note = input.note;
          target.updatedAt = new Date().toISOString();
          saveExpenses(this.dataFile, records);
          return { success: true, output: target };
        }

        case 'list': {
          const filter = input.filter ?? 'unreimbursed';
          let filtered: ExpenseRecord[];
          switch (filter) {
            case 'all': filtered = records; break;
            case 'unreimbursed': filtered = records.filter(r => r.reimbursementStatus === 'unreimbursed'); break;
            case 'reimbursed': filtered = records.filter(r => r.reimbursementStatus === 'reimbursed'); break;
            case 'no_invoice': filtered = records.filter(r => r.invoiceStatus === 'pending'); break;
          }
          return {
            success: true,
            output: {
              count: filtered.length,
              totalAmount: filtered.reduce((sum, r) => sum + (r.amount ?? 0), 0),
              records: filtered,
            },
          };
        }

        case 'delete': {
          const target = this.findRecord(records, input.id, input.description);
          if (!target) {
            return { success: false, output: null, error: '找不到匹配的记录' };
          }
          const idx = records.indexOf(target);
          records.splice(idx, 1);
          saveExpenses(this.dataFile, records);
          return { success: true, output: { deleted: target.id, description: target.description } };
        }

        case 'summary': {
          const unreimbursed = records.filter(r => r.reimbursementStatus === 'unreimbursed');
          const noInvoice = records.filter(r => r.invoiceStatus === 'pending');
          const reimbursed = records.filter(r => r.reimbursementStatus === 'reimbursed');
          return {
            success: true,
            output: {
              total: records.length,
              unreimbursedCount: unreimbursed.length,
              unreimbursedAmount: unreimbursed.reduce((s, r) => s + (r.amount ?? 0), 0),
              noInvoiceCount: noInvoice.length,
              reimbursedCount: reimbursed.length,
              reimbursedAmount: reimbursed.reduce((s, r) => s + (r.amount ?? 0), 0),
            },
          };
        }
      }
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private findRecord(records: ExpenseRecord[], id?: string, description?: string): ExpenseRecord | undefined {
    if (id) return records.find(r => r.id === id);
    if (description) {
      const lower = description.toLowerCase();
      return records.find(r => r.description.toLowerCase().includes(lower));
    }
    return undefined;
  }
}
