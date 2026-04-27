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
import { transcribeAudio } from '../services/speech-to-text.js';

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

  // Main LLM — configured entirely via env vars
  const apiKey = process.env['LLM_API_KEY'] ?? '';
  const model = process.env['LLM_MODEL'] ?? 'qwen-plus';
  const baseUrl = process.env['LLM_BASE_URL'];

  const userDataDir = path.join(DATA_DIR, 'users', userId);
  const tokenTracker = new TokenTracker(path.join(userDataDir, 'token-usage.json'));
  const llm = createDashScopeLLM({ apiKey, model, tokenTracker, baseUrl });

  // Side query LLM — optional, falls back to main LLM if not configured
  let sideLlm: ReturnType<typeof createDashScopeLLM> | undefined;
  const sideApiKey = process.env['SIDE_LLM_API_KEY'];
  const sideModel = process.env['SIDE_LLM_MODEL'];
  if (sideApiKey && sideModel) {
    sideLlm = createDashScopeLLM({
      apiKey: sideApiKey,
      model: sideModel,
      baseUrl: process.env['SIDE_LLM_BASE_URL'],
      maxTokens: 2048,
      temperature: 0.3,
    });
  }

  const agent = createOfficeAgent({ llm, sideLlm, baseDir: userDataDir, model });
  userAgents.set(userId, agent);
  return agent;
}

// ============================================================
// Per-user message queue — serialize processing per user
// ============================================================

/** Each user gets a serial queue so messages don't interleave */
const userQueues = new Map<string, Promise<void>>();

interface QueuedMessageContext {
  lark: Lark.Client;
  chatId: string;
  senderId: string;
  cleanText: string;
  images?: string[];
}

/**
 * Enqueue a message for serial processing.
 * If the user already has a message being processed, send a "please wait" hint
 * and queue this one behind it.
 */
function enqueueMessage(ctx: QueuedMessageContext, handler: (ctx: QueuedMessageContext) => Promise<void>): void {
  const { senderId, lark, chatId } = ctx;
  const prev = userQueues.get(senderId) ?? Promise.resolve();

  // Check if there's already a pending task — if so, notify user
  const isQueueBusy = userQueues.has(senderId);

  const next = prev.then(async () => {
    if (isQueueBusy) {
      // The previous message was still processing when this one arrived,
      // so we sent a "please wait" earlier. Now it's our turn.
      log.debug(`队列: 开始处理排队消息 from ${senderId}`);
    }
    await handler(ctx);
  }).catch((err) => {
    log.error('队列处理异常', { error: err instanceof Error ? err.message : String(err) });
  });

  userQueues.set(senderId, next);

  // Send "please wait" if there's already something in flight
  if (isQueueBusy) {
    log.debug(`队列: 消息排队中 from ${senderId}`);
    void lark.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ text: '⏳ 上一条消息还在处理中，稍等一下，马上轮到你这条。' }),
        msg_type: 'text',
      },
    }).catch(() => { /* ignore send failure */ });
  }

  // Clean up the map entry when the queue drains
  next.then(() => {
    // Only clean up if this is still the latest promise in the chain
    if (userQueues.get(senderId) === next) {
      userQueues.delete(senderId);
    }
  }).catch(() => {});
}

// ============================================================
// Message processing
// ============================================================

/** Collect all stream events into a single text response */
async function processMessage(agent: OfficeAgent, text: string, images?: string[]): Promise<string> {
  const parts: string[] = [];
  let toolCount = 0;

  try {
    for await (const event of agent.handleMessage(text, images)) {
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

// ============================================================
// Main entry
// ============================================================

async function main() {
  loadEnv();

  // Enable file logging
  logger.enableFileLogging();
  logger.setLevel((process.env['LOG_LEVEL'] as any) ?? 'info');

  const appId = process.env['FEISHU_APP_ID'];
  const appSecret = process.env['FEISHU_APP_SECRET'];

  if (!appId || !appSecret) {
    log.error('缺少飞书配置，请在 .env 中添加 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
    process.exit(1);
  }

  if (!process.env['LLM_API_KEY']) {
    log.error('缺少 LLM_API_KEY，请在 .env 中配置');
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

  log.info('╔══════════════════════════════════════════╗');
  log.info('║   🤖 Office Agent — 飞书机器人           ║');
  log.info('╚══════════════════════════════════════════╝');
  const activeModel = process.env['LLM_MODEL'] ?? 'qwen-plus';
  const sideModel = process.env['SIDE_LLM_MODEL'];
  log.info(`主模型: ${activeModel}`);
  if (sideModel) log.info(`轻量模型: ${sideModel}`);
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
    if (startedAgents.has(senderId)) return;

    const sessionChannel = `feishu-${senderId}`;
    agent.queryEngine.setSessionChannel(sessionChannel);
    agent.configManager.load();
    await agent.skillSystem.loadSkills();
    agent.cronScheduler.start();
    agent.cronScheduler.checkMissedTasks();
    agent.awaySummaryEngine.recordActivity();
    agent.queryEngine.restoreLastSession(sessionChannel);

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
        log.error('推送提醒失败', { error: err instanceof Error ? err.message : String(err) });
      }
    });

    agent.reminderLoop.start();
    startedAgents.add(senderId);
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

  // Voice message handler — extracted for queue integration
  async function handleFeishuVoice(
    lark: Lark.Client,
    chatId: string,
    senderId: string,
    msgId: string,
    fileKey: string,
    getTenantToken: () => Promise<string>,
  ): Promise<void> {
    try {
      const audioRes = await lark.im.v1.messageResource.get({
        path: { message_id: msgId, file_key: fileKey },
        params: { type: 'file' },
      });

      const chunks: Buffer[] = [];
      const resData = audioRes as any;

      if (Buffer.isBuffer(resData)) {
        chunks.push(resData);
      } else if (Buffer.isBuffer(resData?.data)) {
        chunks.push(resData.data);
      } else if (resData?.data && typeof resData.data[Symbol.asyncIterator] === 'function') {
        for await (const chunk of resData.data) {
          chunks.push(Buffer.from(chunk));
        }
      } else if (resData?.data && typeof resData.data.pipe === 'function') {
        await new Promise<void>((resolve, reject) => {
          resData.data.on('data', (chunk: Buffer) => chunks.push(chunk));
          resData.data.on('end', resolve);
          resData.data.on('error', reject);
        });
      } else {
        const token = await getTenantToken();
        const url = `https://open.feishu.cn/open-apis/im/v1/messages/${msgId}/resources/${fileKey}?type=file`;
        const httpRes = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!httpRes.ok) throw new Error(`HTTP ${httpRes.status}`);
        const arrayBuf = await httpRes.arrayBuffer();
        chunks.push(Buffer.from(arrayBuf));
      }

      const audioBuffer = Buffer.concat(chunks);
      const apiKey = process.env['DASHSCOPE_API_KEY'] ?? '';
      const sttResult = await transcribeAudio(audioBuffer, apiKey, 'audio.ogg');

      if (!sttResult.success || !sttResult.text.trim()) {
        await lark.im.v1.message.create({
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

      const agent = getOrCreateAgent(senderId);
      await ensureAgentStarted(agent, senderId, lark, chatId);
      const response = await processMessage(agent, sttResult.text);
      log.info(`回复 to ${senderId}: ${response.slice(0, 80)}`);
      const respChunks = splitMessage(response, 3500);
      for (const chunk of respChunks) {
        await lark.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, content: JSON.stringify({ text: chunk }), msg_type: 'text' },
        });
      }
    } catch (err) {
      log.error('语音处理失败', { error: err instanceof Error ? err.message : String(err) });
      try {
        await lark.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text: `❌ 语音处理失败: ${err instanceof Error ? err.message : String(err)}` }),
            msg_type: 'text',
          },
        });
      } catch { /* ignore */ }
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
          log.debug('跳过重复消息', { messageId });
          return;
        }

        // Only handle text, audio, and post (rich text) messages
        // For image-only or file messages, reply with a friendly note
        if (msgType !== 'text' && msgType !== 'audio' && msgType !== 'post' && msgType !== 'image') {
          void larkClient.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
              receive_id: chatId,
              content: JSON.stringify({ text: '目前支持文本、语音和富文本消息，该类型暂不支持。' }),
              msg_type: 'text',
            },
          });
          return;
        }

        // Image-only messages — download and process with multimodal
        if (msgType === 'image') {
          let imageKey: string;
          try {
            const content = JSON.parse(message.content);
            imageKey = content.image_key;
          } catch { return; }
          if (!imageKey) return;

          log.info(`收到图片消息 from ${senderId}`, { imageKey });

          enqueueMessage(
            { lark: larkClient, chatId, senderId, cleanText: '用户发送了一张图片，请描述图片内容并回应。' },
            async (ctx) => {
              const dataUrl = await downloadFeishuImage(imageKey, messageId, getFeishuTenantToken);
              const images = dataUrl ? [dataUrl] : undefined;
              await handleFeishuMessage(ctx.lark, ctx.chatId, ctx.senderId, ctx.cleanText, images);
            },
          );
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

          // Enqueue voice processing through the same serial queue
          enqueueMessage(
            { lark: larkClient, chatId, senderId, cleanText: '' },
            async () => {
              await handleFeishuVoice(larkClient, chatId, senderId, messageId, fileKey, getFeishuTenantToken);
            },
          );
          return;
        }

        // Text and post (rich text) message handling
        let text: string;
        let imageKeys: string[] = [];
        try {
          const content = JSON.parse(message.content);
          if (msgType === 'post') {
            text = extractTextFromPost(content);
            imageKeys = extractImageKeysFromPost(content);
            log.debug('Post message parsed', { text: text.slice(0, 80), imageKeyCount: imageKeys.length, imageKeys });
          } else {
            text = content.text ?? '';
          }
        } catch {
          text = message.content ?? '';
        }

        if (!text.trim() && imageKeys.length === 0) return;

        // Strip @bot mention prefix
        cleanText = (text || '').replace(/@_user_\d+\s*/g, '').trim();
        if (!cleanText && imageKeys.length === 0) return;

        log.info(`收到消息 from ${senderId}: ${cleanText.slice(0, 80)}`, { imageCount: imageKeys.length });

        // CRITICAL: Return immediately, process in background
        enqueueMessage(
          { lark: larkClient, chatId, senderId, cleanText: cleanText || '用户发送了图片，请描述并回应。' },
          async (ctx) => {
            // Download images in parallel if any
            let images: string[] | undefined;
            if (imageKeys.length > 0) {
              log.info('Downloading images from post', { count: imageKeys.length });
              const results = await Promise.all(
                imageKeys.map(key => downloadFeishuImage(key, messageId, getFeishuTenantToken)),
              );
              const valid = results.filter((r): r is string => r !== null);
              log.info('Images downloaded', { total: imageKeys.length, success: valid.length });
              if (valid.length > 0) images = valid;
            }
            await handleFeishuMessage(ctx.lark, ctx.chatId, ctx.senderId, ctx.cleanText, images);
          },
        );
      },
    }),
  });

  log.info('✅ 飞书 WebSocket 长连接已启动，等待消息...');
}

/**
 * Extract plain text from a Feishu post (rich text) message content.
 * Ignores images and other non-text elements.
 *
 * Post content structure:
 * { "zh_cn": { "title": "...", "content": [[{ tag: "text", text: "..." }, { tag: "img", ... }]] } }
 */
/** Download a Feishu image by image_key and return as base64 data URL */
async function downloadFeishuImage(
  imageKey: string,
  messageId: string,
  getTenantToken: () => Promise<string>,
): Promise<string | null> {
  try {
    const token = await getTenantToken();
    const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`;
    log.debug('Downloading image', { imageKey, messageId });
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
      log.warn('Image download failed', { status: res.status, imageKey });
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? 'image/png';
    log.info('Image downloaded', { imageKey, size: buffer.length, contentType });
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    log.error('Image download error', { imageKey, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Extract image_keys from a Feishu post (rich text) message */
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

  // Post content can be under zh_cn, en_us, or ja_jp — try all
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
        // Hyperlinks — keep the text, append URL
        const href = element.href ? ` (${element.href})` : '';
        parts.push(element.text + href);
      } else if (element?.tag === 'at' && element.user_name) {
        parts.push(`@${element.user_name}`);
      }
      // img, media, emotion etc. — silently ignored
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
