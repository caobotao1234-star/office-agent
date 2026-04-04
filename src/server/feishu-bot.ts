/**
 * Feishu Bot — 飞书机器人（WebSocket 长连接模式）
 *
 * 使用飞书官方 Node SDK 的 WSClient，通过 WebSocket 长连接接收消息。
 * 不需要公网 IP、域名、服务器，只要电脑能访问公网即可。
 *
 * 前置条件：
 *   1. 在飞书开放平台创建自建应用
 *   2. 获取 App ID 和 App Secret
 *   3. 在 .env 中配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET
 *   4. 在应用后台开启「机器人」能力
 *   5. 添加事件订阅：im.message.receive_v1
 *   6. 选择「使用长连接接收事件」
 *
 * 启动：npm run feishu
 */
import * as Lark from '@larksuiteoapi/node-sdk';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { createOfficeAgent, type OfficeAgent } from '../main.js';
import { createDashScopeLLM } from '../core/dashscope-llm.js';
import { TokenTracker } from '../core/token-tracker.js';
import { logger } from '../core/logger.js';

const log = logger.child('Feishu');

const DATA_DIR = path.join(os.homedir(), '.office-agent');

// ============================================================
// .env loader
// ============================================================

function loadEnv(): void {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = t.slice(eq + 1).trim();
  }
}

// ============================================================
// Session management — per-user conversation isolation
// ============================================================

/** Each Feishu user gets their own Agent instance for session isolation */
const userAgents = new Map<string, OfficeAgent>();
const startedAgents = new Set<string>();

function getOrCreateAgent(userId: string): OfficeAgent {
  const existing = userAgents.get(userId);
  if (existing) return existing;

  const apiKey = process.env['DASHSCOPE_API_KEY'] ?? '';
  const model = process.env['DASHSCOPE_MODEL'] ?? 'qwen-plus';
  const tokenTracker = new TokenTracker(path.join(DATA_DIR, 'token-usage.json'));
  const llm = createDashScopeLLM({ apiKey, model, tokenTracker });
  const agent = createOfficeAgent({ llm, baseDir: DATA_DIR, model });

  userAgents.set(userId, agent);
  return agent;
}

// ============================================================
// Message processing
// ============================================================

/** Collect all stream events into a single text response */
async function processMessage(agent: OfficeAgent, text: string): Promise<string> {
  const parts: string[] = [];
  let toolCount = 0;

  try {
    for await (const event of agent.handleMessage(text)) {
      switch (event.type) {
        case 'text':
          parts.push(event.content);
          break;
        case 'tool_use':
          toolCount++;
          break;
        case 'tool_result':
          // Don't include raw tool results in Feishu response
          break;
        case 'error':
          parts.push(`\n❌ ${event.error}`);
          break;
        case 'done':
          break;
      }
    }
  } catch (err) {
    parts.push(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  }

  let response = parts.join('');

  // Append tool call transparency
  if (toolCount > 0) {
    response += `\n\n[本轮调用了 ${toolCount} 个工具]`;
  }

  return response || '（无响应）';
}

// ============================================================
// Feishu message deduplication
// ============================================================

/** Simple dedup: track recent message IDs to avoid processing duplicates */
const recentMessageIds = new Set<string>();
const MAX_DEDUP_SIZE = 500;

function isDuplicate(messageId: string): boolean {
  if (recentMessageIds.has(messageId)) return true;
  recentMessageIds.add(messageId);
  // Prevent unbounded growth
  if (recentMessageIds.size > MAX_DEDUP_SIZE) {
    const first = recentMessageIds.values().next().value;
    if (first) recentMessageIds.delete(first);
  }
  return false;
}

// ============================================================
// Main entry
// ============================================================

async function main() {
  loadEnv();

  const appId = process.env['FEISHU_APP_ID'];
  const appSecret = process.env['FEISHU_APP_SECRET'];

  if (!appId || !appSecret) {
    console.error('❌ 缺少飞书配置，请在 .env 中添加：');
    console.error('   FEISHU_APP_ID=cli_xxx');
    console.error('   FEISHU_APP_SECRET=xxx');
    process.exit(1);
  }

  if (!process.env['DASHSCOPE_API_KEY']) {
    console.error('❌ 缺少 DASHSCOPE_API_KEY，请在 .env 中配置');
    process.exit(1);
  }

  const baseConfig = { appId, appSecret };

  // Lark Client for sending messages
  const larkClient = new Lark.Client(baseConfig);

  // WebSocket long connection client
  const wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  });

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   🤖 Office Agent — 飞书机器人           ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  模型: ${process.env['DASHSCOPE_MODEL'] ?? 'qwen-plus'}`);
  console.log('  模式: WebSocket 长连接（无需公网 IP）');
  console.log('  退出: Ctrl+C');
  console.log();

  // Background message handler — must NOT block the event callback
  // Feishu requires event handlers to return within 3 seconds,
  // otherwise it considers the client unresponsive and may stop pushing.
  async function handleFeishuMessage(
    lark: Lark.Client,
    chatId: string,
    senderId: string,
    cleanText: string,
  ): Promise<void> {
    try {
      const agent = getOrCreateAgent(senderId);

      if (!startedAgents.has(senderId)) {
        // Per-user session channel — isolates feishu sessions from CLI
        const sessionChannel = `feishu-${senderId}`;
        agent.queryEngine.setSessionChannel(sessionChannel);

        // Start agent services without restoring CLI session
        agent.configManager.load();
        await agent.skillSystem.loadSkills();
        agent.cronScheduler.start();
        agent.cronScheduler.checkMissedTasks();
        agent.awaySummaryEngine.recordActivity();

        // Restore this user's own feishu session (not CLI's)
        agent.queryEngine.restoreLastSession(sessionChannel);

        // Register Feishu as notification channel for proactive reminders
        agent.notificationService.addChannel(async (message) => {
          try {
            const chunks = splitMessage(message, 3500);
            for (const chunk of chunks) {
              await lark.im.v1.message.create({
                params: { receive_id_type: 'chat_id' },
                data: {
                  receive_id: chatId,
                  content: JSON.stringify({ text: `📢 ${chunk}` }),
                  msg_type: 'text',
                },
              });
            }
          } catch (err) {
            console.error('[Feishu] 推送提醒失败:', err instanceof Error ? err.message : err);
          }
        });

        agent.reminderLoop.start();
        startedAgents.add(senderId);
      }

      const response = await processMessage(agent, cleanText);

      console.log(`[Feishu] 回复 to ${senderId}: ${response.slice(0, 80)}...`);

      const chunks = splitMessage(response, 3500);
      for (const chunk of chunks) {
        await lark.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text: chunk }),
            msg_type: 'text',
          },
        });
      }
    } catch (err) {
      console.error('[Feishu] 处理消息失败:', err instanceof Error ? err.message : err);
      // Try to send error message back to user
      try {
        await lark.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text: `❌ 处理失败: ${err instanceof Error ? err.message : String(err)}` }),
            msg_type: 'text',
          },
        });
      } catch { /* ignore send failure */ }
    }
  }

  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        const message = data.message;
        const messageId = message.message_id;
        const chatId = message.chat_id;
        const senderId = data.sender?.sender_id?.open_id ?? 'unknown';
        const msgType = message.message_type;

        // Dedup
        if (isDuplicate(messageId)) {
          console.log(`[Feishu] 跳过重复消息: ${messageId}`);
          return;
        }

        // Only handle text messages for now
        if (msgType !== 'text') {
          // Fire-and-forget, don't block
          void larkClient.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
              receive_id: chatId,
              content: JSON.stringify({ text: '目前只支持文本消息，语音/图片/文件暂不支持。' }),
              msg_type: 'text',
            },
          });
          return;
        }

        // Parse text content
        let text: string;
        try {
          const content = JSON.parse(message.content);
          text = content.text ?? '';
        } catch {
          text = message.content ?? '';
        }

        if (!text.trim()) return;

        // Strip @bot mention prefix (Feishu adds @_user_1 etc.)
        const cleanText = text.replace(/@_user_\d+\s*/g, '').trim();
        if (!cleanText) return;

        console.log(`[Feishu] 收到消息 from ${senderId}: ${cleanText.slice(0, 80)}`);

        // CRITICAL: Return immediately, process in background
        // Feishu requires the event handler to complete within 3 seconds.
        // Our Agent processing (LLM API + tools) takes much longer.
        // If we block here, Feishu will stop pushing subsequent messages.
        void handleFeishuMessage(larkClient, chatId, senderId, cleanText);
      },
    }),
  });

  console.log('✅ 飞书 WebSocket 长连接已启动，等待消息...');
  console.log('   在飞书中找到你的机器人，发送消息即可开始对话');
  console.log();
}

/** Split long text into chunks for Feishu message limit */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at newline
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.5) splitIdx = maxLen; // No good newline, hard split
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx);
  }
  return chunks;
}

main().catch((err) => {
  console.error('❌ 飞书机器人启动失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
