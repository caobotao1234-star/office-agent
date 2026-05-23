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
import { TokenTracker } from '../core/token-tracker.js';
import { logger } from '../core/logger.js';
import { transcribeAudio } from '../services/speech-to-text.js';
import { FeishuRecipientStore } from '../services/feishu-recipient-store.js';
import type { NotifyCallback } from '../services/notification-service.js';
import { SerialMessageQueue } from '../services/serial-message-queue.js';
import { createConfiguredLLM, resolveLLMProvider } from '../core/llm-provider.js';

const log = logger.child('Feishu');
const sdkLog = logger.child('FeishuSDK');

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
const startedAgentChats = new Map<string, string>();
const notificationCallbacks = new Map<string, NotifyCallback>();
const userMessageQueues = new Map<string, SerialMessageQueue>();

function getOrCreateAgent(userId: string): OfficeAgent {
  const existing = userAgents.get(userId);
  if (existing) return existing;

  // Per-user data directory for complete isolation
  const userDataDir = path.join(DATA_DIR, 'users', userId);
  const tokenTracker = new TokenTracker(path.join(userDataDir, 'token-usage.json'));
  const configured = createConfiguredLLM({ tokenTracker });
  const agent = createOfficeAgent({ llm: configured.llm, baseDir: userDataDir, model: configured.model });

  userAgents.set(userId, agent);
  return agent;
}

function getOrCreateMessageQueue(userId: string): SerialMessageQueue {
  let queue = userMessageQueues.get(userId);
  if (!queue) {
    queue = new SerialMessageQueue();
    userMessageQueues.set(userId, queue);
  }
  return queue;
}

// ============================================================
// Message processing
// ============================================================

/** Collect all stream events into a single text response */
async function processMessage(agent: OfficeAgent, text: string, images?: string[]): Promise<string> {
  const safeImages = images?.filter(Boolean) ?? [];
  if (safeImages.length > 0 && !agent.queryEngine.supportsVision()) {
    const note = `我收到了 ${safeImages.length} 张图片，但当前模型不支持图片识别，已忽略图片。`;
    if (!text.trim()) {
      return `${note}\n\n请切换到支持视觉的模型后再发图，例如 DashScope 的 qwen-vl 系列模型。`;
    }
    const textResponse = await processMessage(agent, text);
    return `${note}\n\n${textResponse}`;
  }

  const parts: string[] = [];
  let toolCount = 0;
  const finalText = text.trim() || (safeImages.length > 0 ? '请识别并描述用户发送的图片，并根据图片内容回应。' : text);

  try {
    for await (const event of agent.handleMessage(finalText, safeImages.length > 0 ? safeImages : undefined)) {
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

  let response = parts.join('').trim();

  // If tools were called but model produced no text, add a fallback acknowledgment
  if (!response && toolCount > 0) {
    response = '好的，已处理完成。';
  }

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

function createLarkSdkLogger() {
  return {
    error: (...msg: unknown[]) => sdkLog.error('sdk error', { message: formatSdkLog(msg) }),
    warn: (...msg: unknown[]) => sdkLog.warn('sdk warn', { message: formatSdkLog(msg) }),
    info: (...msg: unknown[]) => sdkLog.info('sdk info', { message: formatSdkLog(msg) }),
    debug: (...msg: unknown[]) => sdkLog.debug('sdk debug', { message: formatSdkLog(msg) }),
    trace: (...msg: unknown[]) => sdkLog.debug('sdk trace', { message: formatSdkLog(msg) }),
  };
}

function formatSdkLog(msg: unknown[]): string {
  return msg.map((item) => {
    if (item instanceof Error) return item.stack ?? item.message;
    if (typeof item === 'string') return item;
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  }).join(' ');
}

// ============================================================
// Main entry
// ============================================================

async function main() {
  loadEnv();

  // Enable file logging
  logger.enableFileLogging();
  logger.setLevel((process.env['LOG_LEVEL'] as any) ?? 'info');
  log.info('日志已启用', { logDir: process.env['OFFICE_AGENT_LOG_DIR'] ?? path.join(process.cwd(), 'logs') });

  const appId = process.env['FEISHU_APP_ID'];
  const appSecret = process.env['FEISHU_APP_SECRET'];

  if (!appId || !appSecret) {
    log.error('缺少飞书配置，请在 .env 中添加 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
    process.exit(1);
  }

  let llmConfig;
  try {
    llmConfig = resolveLLMProvider();
  } catch (err) {
    log.error('LLM provider 配置错误', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  if (llmConfig.provider === 'dashscope' && !process.env['DASHSCOPE_API_KEY']) {
    log.error('缺少 DASHSCOPE_API_KEY，请在 .env 中配置，或设置 OFFICE_AGENT_LLM_PROVIDER=deepseek');
    process.exit(1);
  }

  if (llmConfig.provider === 'deepseek' && !process.env['DEEPSEEK_API_KEY']) {
    log.error('缺少 DEEPSEEK_API_KEY，请在 .env 中配置，或设置 OFFICE_AGENT_LLM_PROVIDER=dashscope');
    process.exit(1);
  }

  const baseConfig = { appId, appSecret };
  const recipientStore = new FeishuRecipientStore(path.join(DATA_DIR, 'feishu-recipients.json'));
  const larkSdkLogger = createLarkSdkLogger();

  // Lark Client for sending messages
  const larkClient = new Lark.Client({ ...baseConfig, logger: larkSdkLogger, loggerLevel: Lark.LoggerLevel.info });

  // WebSocket long connection client
  const wsClient = new Lark.WSClient({
    ...baseConfig,
    logger: larkSdkLogger,
    loggerLevel: Lark.LoggerLevel.info,
  });

  log.info('╔══════════════════════════════════════════╗');
  log.info('║   🤖 Office Agent — 飞书机器人           ║');
  log.info('╚══════════════════════════════════════════╝');
  log.info(`模型: ${llmConfig.provider}/${llmConfig.model}`);
  log.info('模式: WebSocket 长连接（无需公网 IP）');

  // Helper: get tenant token for direct API calls
  async function getFeishuTenantToken(): Promise<string> {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = await res.json() as any;
    return data.tenant_access_token;
  }

  // Shared agent startup logic
  async function ensureAgentStarted(
    agent: OfficeAgent,
    senderId: string,
    lark: Lark.Client,
    chatId: string,
  ): Promise<void> {
    const existingChatId = startedAgentChats.get(senderId);
    if (existingChatId === chatId) return;

    const sessionChannel = `feishu-${senderId}`;
    agent.queryEngine.setSessionChannel(sessionChannel);

    if (!existingChatId) {
      agent.configManager.load();
      await agent.skillSystem.loadSkills();
      agent.cronScheduler.start();
      agent.awaySummaryEngine.recordActivity();
      agent.queryEngine.restoreLastSession(sessionChannel);
    }

    const previousCallback = notificationCallbacks.get(senderId);
    if (previousCallback) {
      agent.notificationService.removeChannel(previousCallback);
    }

    const callback: NotifyCallback = async (message) => {
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
        log.info('主动推送成功', { senderId, chatId, chunkCount: chunks.length });
      } catch (err) {
        log.error('推送提醒失败', { senderId, chatId, error: err instanceof Error ? err.message : String(err) });
      }
    };

    agent.notificationService.addChannel(callback);
    notificationCallbacks.set(senderId, callback);

    if (!existingChatId) {
      agent.agendaScheduler.start();
      log.info('用户 Agent 已启动', { senderId, chatId });
    } else {
      log.info('用户主动推送会话已更新', { senderId, previousChatId: existingChatId, chatId });
    }

    startedAgentChats.set(senderId, chatId);
  }

  async function bootstrapKnownRecipients(): Promise<void> {
    const recipients = recipientStore.list();
    log.info('恢复飞书主动推送收件人', { count: recipients.length });

    for (const recipient of recipients) {
      try {
        const agent = getOrCreateAgent(recipient.senderId);
        await ensureAgentStarted(agent, recipient.senderId, larkClient, recipient.chatId);
      } catch (err) {
        log.error('恢复飞书主动推送收件人失败', {
          senderId: recipient.senderId,
          chatId: recipient.chatId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Background message handler
  // Feishu requires event handlers to return within 3 seconds,
  // otherwise it considers the client unresponsive and may stop pushing.
  async function handleFeishuMessage(
    lark: Lark.Client,
    chatId: string,
    senderId: string,
    cleanText: string,
    images?: string[],
  ): Promise<void> {
    try {
      recipientStore.upsert(senderId, chatId);
      const agent = getOrCreateAgent(senderId);
      await ensureAgentStarted(agent, senderId, lark, chatId);

      const response = await processMessage(agent, cleanText, images);

      log.info(`回复 to ${senderId}: ${response.slice(0, 80)}`);

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
      log.error('处理消息失败', { error: err instanceof Error ? err.message : String(err) });
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

  function enqueueFeishuMessage(
    lark: Lark.Client,
    chatId: string,
    senderId: string,
    cleanText: string,
    images?: string[],
  ): void {
    const queue = getOrCreateMessageQueue(senderId);
    const queuedBefore = queue.pendingCount();

    if (queuedBefore > 0) {
      void lark.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ text: `收到，前面还有 ${queuedBefore} 条消息/任务在处理。我会按顺序处理这条。` }),
          msg_type: 'text',
        },
      }).catch((err) => {
        log.warn('发送排队提示失败', { senderId, chatId, error: err instanceof Error ? err.message : String(err) });
      });
    }

    const { promise } = queue.enqueue(() => handleFeishuMessage(lark, chatId, senderId, cleanText, images));
    void promise.catch((err) => {
      log.error('队列消息处理失败', { senderId, chatId, error: err instanceof Error ? err.message : String(err) });
    });
  }

  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({
      logger: larkSdkLogger,
      loggerLevel: Lark.LoggerLevel.info,
    }).register({
      'im.message.receive_v1': async (data: any) => {
        const message = data.message;
        const messageId = message.message_id;
        const chatId = message.chat_id;
        const senderId = data.sender?.sender_id?.open_id ?? 'unknown';
        const msgType = message.message_type;

        // Dedup
        if (isDuplicate(messageId)) {
          log.debug('跳过重复消息', { messageId });
          return;
        }

        // Only handle text, post, image, and audio messages
        if (msgType !== 'text' && msgType !== 'post' && msgType !== 'image' && msgType !== 'audio') {
          void larkClient.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
              receive_id: chatId,
              content: JSON.stringify({ text: '目前支持文本、富文本、图片和语音消息，该类型暂不支持。' }),
              msg_type: 'text',
            },
          });
          return;
        }

        if (msgType === 'image') {
          let imageKey = '';
          try {
            const content = JSON.parse(message.content);
            imageKey = content.image_key ?? '';
          } catch {
            return;
          }
          if (!imageKey) return;

          log.info(`收到图片消息 from ${senderId}`, { imageKey });
          void (async () => {
            const image = await downloadFeishuImage(imageKey, messageId, getFeishuTenantToken);
            if (!image) {
              await larkClient.im.v1.message.create({
                params: { receive_id_type: 'chat_id' },
                data: {
                  receive_id: chatId,
                  content: JSON.stringify({ text: '❌ 图片下载失败，暂时无法识别这张图片。' }),
                  msg_type: 'text',
                },
              });
              return;
            }
            enqueueFeishuMessage(larkClient, chatId, senderId, '请识别并描述用户发送的图片，并根据图片内容回应。', [image]);
          })().catch((err) => {
            log.error('图片处理失败', { senderId, chatId, error: err instanceof Error ? err.message : String(err) });
          });
          return;
        }

        let cleanText: string;

        if (msgType === 'audio') {
          // Handle voice message: download audio → STT → text
          const messageId = message.message_id;
          let fileKey: string;
          try {
            const content = JSON.parse(message.content);
            fileKey = content.file_key;
          } catch {
            return;
          }
          if (!fileKey) return;

          log.info(`收到语音消息 from ${senderId}`, { fileKey });

          // Download audio file from Feishu
          void (async () => {
            try {
              const audioRes = await larkClient.im.v1.messageResource.get({
                path: { message_id: messageId, file_key: fileKey },
                params: { type: 'file' },
              });

              // SDK may return data as Buffer, ReadableStream, or nested in response
              const chunks: Buffer[] = [];
              const resData = audioRes as any;

              // Try different response formats
              if (Buffer.isBuffer(resData)) {
                chunks.push(resData);
              } else if (Buffer.isBuffer(resData?.data)) {
                chunks.push(resData.data);
              } else if (resData?.data && typeof resData.data[Symbol.asyncIterator] === 'function') {
                for await (const chunk of resData.data) {
                  chunks.push(Buffer.from(chunk));
                }
              } else if (resData?.data && typeof resData.data.pipe === 'function') {
                // Node.js Readable stream
                await new Promise<void>((resolve, reject) => {
                  resData.data.on('data', (chunk: Buffer) => chunks.push(chunk));
                  resData.data.on('end', resolve);
                  resData.data.on('error', reject);
                });
              } else if (resData?.writeFile) {
                // SDK v1.60+ returns a helper with writeFile method
                // Fallback: use direct HTTP download
                const token = await getFeishuTenantToken();
                const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`;
                const httpRes = await fetch(url, {
                  headers: { 'Authorization': `Bearer ${token}` },
                });
                if (!httpRes.ok) throw new Error(`HTTP ${httpRes.status}`);
                const arrayBuf = await httpRes.arrayBuffer();
                chunks.push(Buffer.from(arrayBuf));
              } else {
                // Last resort: direct HTTP download
                const token = await getFeishuTenantToken();
                const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`;
                const httpRes = await fetch(url, {
                  headers: { 'Authorization': `Bearer ${token}` },
                });
                if (!httpRes.ok) throw new Error(`HTTP ${httpRes.status}`);
                const arrayBuf = await httpRes.arrayBuffer();
                chunks.push(Buffer.from(arrayBuf));
              }

              const audioBuffer = Buffer.concat(chunks);
              const apiKey = process.env['DASHSCOPE_API_KEY'] ?? '';
              if (!apiKey) {
                await larkClient.im.v1.message.create({
                  params: { receive_id_type: 'chat_id' },
                  data: {
                    receive_id: chatId,
                    content: JSON.stringify({ text: '❌ 语音识别需要配置 DASHSCOPE_API_KEY。当前 LLM 可以使用 DeepSeek，但语音转文字仍走 DashScope STT。' }),
                    msg_type: 'text',
                  },
                });
                return;
              }
              const sttResult = await transcribeAudio(audioBuffer, apiKey, 'audio.ogg');

              if (!sttResult.success || !sttResult.text.trim()) {
                await larkClient.im.v1.message.create({
                  params: { receive_id_type: 'chat_id' },
                  data: {
                    receive_id: chatId,
                    content: JSON.stringify({ text: `❌ 语音识别失败: ${sttResult.error ?? '无法识别内容'}` }),
                    msg_type: 'text',
                  },
                });
                return;
              }

              log.info(`语音转文字: ${sttResult.text.slice(0, 80)}`);

              // Process transcribed text through the same per-user queue as text messages.
              enqueueFeishuMessage(larkClient, chatId, senderId, sttResult.text);
            } catch (err) {
              log.error('语音处理失败', { error: err instanceof Error ? err.message : String(err) });
              try {
                await larkClient.im.v1.message.create({
                  params: { receive_id_type: 'chat_id' },
                  data: {
                    receive_id: chatId,
                    content: JSON.stringify({ text: `❌ 语音处理失败: ${err instanceof Error ? err.message : String(err)}` }),
                    msg_type: 'text',
                  },
                });
              } catch { /* ignore */ }
            }
          })();
          return;
        }

        // Text and post message handling
        let text: string;
        let imageKeys: string[] = [];
        try {
          const content = JSON.parse(message.content);
          if (msgType === 'post') {
            text = extractTextFromPost(content);
            imageKeys = extractImageKeysFromPost(content);
          } else {
            text = content.text ?? '';
          }
        } catch {
          text = message.content ?? '';
        }

        if (!text.trim() && imageKeys.length === 0) return;

        // Strip @bot mention prefix
        cleanText = text.replace(/@_user_\d+\s*/g, '').trim();
        if (!cleanText && imageKeys.length === 0) return;

        log.info(`收到消息 from ${senderId}: ${cleanText.slice(0, 80)}`, { imageCount: imageKeys.length });

        // CRITICAL: Return immediately, process in background
        // Feishu requires the event handler to complete within 3 seconds.
        // Our Agent processing (LLM API + tools) takes much longer.
        // If we block here, Feishu will stop pushing subsequent messages.
        if (imageKeys.length > 0) {
          void (async () => {
            const images = (await Promise.all(
              imageKeys.map((key) => downloadFeishuImage(key, messageId, getFeishuTenantToken)),
            )).filter((image): image is string => image !== null);
            if (images.length === 0 && !cleanText) {
              await larkClient.im.v1.message.create({
                params: { receive_id_type: 'chat_id' },
                data: {
                  receive_id: chatId,
                  content: JSON.stringify({ text: '❌ 图片下载失败，暂时无法识别这条消息里的图片。' }),
                  msg_type: 'text',
                },
              });
              return;
            }
            enqueueFeishuMessage(larkClient, chatId, senderId, cleanText || '请识别并描述用户发送的图片，并根据图片内容回应。', images);
          })().catch((err) => {
            log.error('富文本图片处理失败', { senderId, chatId, error: err instanceof Error ? err.message : String(err) });
          });
          return;
        }

        enqueueFeishuMessage(larkClient, chatId, senderId, cleanText);
      },
    }),
  });

  log.info('✅ 飞书 WebSocket 长连接已启动，等待消息...');
  await bootstrapKnownRecipients();
}

/** Download a Feishu image by image_key and return a base64 data URL. */
async function downloadFeishuImage(
  imageKey: string,
  messageId: string,
  getTenantToken: () => Promise<string>,
): Promise<string | null> {
  try {
    const token = await getTenantToken();
    const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`;
    log.info('下载飞书图片', { imageKey, messageId });
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      log.warn('飞书图片下载失败', { imageKey, status: res.status });
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? 'image/png';
    log.info('飞书图片下载完成', { imageKey, bytes: buffer.length, contentType });
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    log.error('飞书图片下载异常', { imageKey, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function extractImageKeysFromPost(content: any): string[] {
  const keys: string[] = [];
  const locales = content.zh_cn ?? content.en_us ?? content.ja_jp ?? content;
  const paragraphs: any[][] = locales?.content ?? [];
  for (const paragraph of paragraphs) {
    if (!Array.isArray(paragraph)) continue;
    for (const element of paragraph) {
      if (element?.tag === 'img' && element.image_key) {
        keys.push(element.image_key);
      }
    }
  }
  return keys;
}

function extractTextFromPost(content: any): string {
  const parts: string[] = [];
  const locales = content.zh_cn ?? content.en_us ?? content.ja_jp ?? content;
  const title = locales?.title;
  if (title) parts.push(title);

  const paragraphs: any[][] = locales?.content ?? [];
  for (const paragraph of paragraphs) {
    if (!Array.isArray(paragraph)) continue;
    for (const element of paragraph) {
      if (element?.tag === 'text' && element.text) {
        parts.push(element.text);
      } else if (element?.tag === 'a' && element.text) {
        const href = element.href ? ` (${element.href})` : '';
        parts.push(element.text + href);
      } else if (element?.tag === 'at' && element.user_name) {
        parts.push(`@${element.user_name}`);
      }
    }
  }

  return parts.join(' ').trim();
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
  log.error('飞书机器人启动失败', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
