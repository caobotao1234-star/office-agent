/**
 * ConfigTool — View and modify user configuration via tool calls.
 *
 * Allows Agent to read and update config.json through natural language.
 * e.g. "把工作时间改到早上8点半" → Agent calls update with the right path.
 *
 * Requirements: 12.1-12.4
 */
import { z } from 'zod';
import type { Tool, PermissionResult } from '../../core/tool-system.js';
import type { ToolContext, ToolResult } from '../../types/index.js';
import type { UserConfigManager } from '../../core/user-config.js';

const GetConfigInput = z.object({
  action: z.literal('get'),
});

const UpdateConfigInput = z.object({
  action: z.literal('update'),
  path: z.string().min(1).describe('Dot-separated config path, e.g. "workingHours.start" or "timezone"'),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.number())]).describe('New value for the config field'),
});

const ConfigToolInput = z.discriminatedUnion('action', [
  GetConfigInput,
  UpdateConfigInput,
]);

export type ConfigToolInput = z.infer<typeof ConfigToolInput>;

export class ConfigTool implements Tool<ConfigToolInput, unknown> {
  readonly name = 'ConfigTool';
  readonly description =
    'View and modify user settings. ' +
    'get: show current config. ' +
    'update: change a setting by dot-path. ' +
    'Paths: workingHours.start, workingHours.end, workingHours.workDays, ' +
    'awaySummary.thresholdMinutes, timezone.';
  readonly inputSchema = ConfigToolInput;

  private configManager: UserConfigManager;
  private enabled = true;

  constructor(configManager: UserConfigManager) {
    this.configManager = configManager;
  }

  isEnabled(): boolean { return this.enabled; }
  setEnabled(v: boolean): void { this.enabled = v; }
  isReadOnly(input: ConfigToolInput): boolean { return input.action === 'get'; }
  checkPermissions(): PermissionResult { return { allowed: true }; }

  async call(input: ConfigToolInput, _context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case 'get':
          return { success: true, output: this.configManager.get() };
        case 'update':
          return this.updateByPath(input.path, input.value);
      }
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private updateByPath(dotPath: string, value: string | number | boolean | number[]): ToolResult<unknown> {
    const config = this.configManager.get() as Record<string, any>;
    const parts = dotPath.split('.');

    // Navigate to parent
    let current: any = config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]!] === undefined) {
        return { success: false, output: null, error: `配置路径不存在: ${dotPath}` };
      }
      current = current[parts[i]!];
    }

    const lastKey = parts[parts.length - 1]!;
    if (current[lastKey] === undefined) {
      return { success: false, output: null, error: `配置项不存在: ${dotPath}` };
    }

    const oldValue = current[lastKey];
    current[lastKey] = value;
    this.configManager.update(config as any);

    return {
      success: true,
      output: {
        path: dotPath,
        oldValue,
        newValue: value,
        message: `配置已更新: ${dotPath} = ${JSON.stringify(value)}`,
      },
    };
  }
}
