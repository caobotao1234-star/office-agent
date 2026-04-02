/**
 * EmailTool — Email sending capability.
 *
 * Operations: send
 * Email sending is a stub for future SMTP/API integration.
 * Write operations require user confirmation.
 *
 * Requirements: 9.2, 9.5, 9.6
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';

// ============================================================
// Input Schema
// ============================================================

const SendEmailInput = z.object({
  action: z.literal('send'),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).default([]),
  subject: z.string().min(1),
  body: z.string().min(1),
  isHtml: z.boolean().default(false),
});

const EmailToolInput = z.discriminatedUnion('action', [
  SendEmailInput,
]);

export type EmailToolInput = z.infer<typeof EmailToolInput>;

// ============================================================
// EmailTool
// ============================================================

export class EmailTool implements Tool<EmailToolInput, unknown> {
  readonly name = 'EmailTool';
  readonly description = 'Send emails. Requires user confirmation before sending.';
  readonly inputSchema = EmailToolInput;
  readonly parametersJsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['send'] },
      to: { type: 'array', items: { type: 'string' } },
      cc: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' }, body: { type: 'string' },
      isHtml: { type: 'boolean' },
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

  isReadOnly(_input: EmailToolInput): boolean {
    return false; // All email operations are writes
  }

  checkPermissions(_input: EmailToolInput): PermissionResult {
    return { allowed: true };
  }

  requiresUserConfirmation(_input: EmailToolInput): boolean {
    return true; // Always require confirmation for sending emails
  }

  async call(input: EmailToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'send':
          return await this.sendEmail(input);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: null,
        error: `邮件发送失败: ${message}。建议手动通过邮件客户端发送。`,
      };
    }
  }

  /** TODO: Integrate SMTP or email API for actual sending */
  private async sendEmail(input: z.infer<typeof SendEmailInput>): Promise<ToolResult<unknown>> {
    // TODO: Use nodemailer or email API to send
    return {
      success: true,
      output: {
        sent: true,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        message: '[stub] 邮件发送成功',
      },
    };
  }
}
