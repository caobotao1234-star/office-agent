/**
 * Feishu Bot — 飞书机器人（WebSocket 长连接模式）
 *
 * 使用飞书官方 Node SDK 的 WSClient，通过 WebSocket 长连接接收消息。
 * 不需要公网 IP、域名、服务器，只要电脑能访问公网即可。
 *
 * 前置条件：
 *   1. 在飞书开放平台创建自建应用
 *   2. 获取 App ID 和 App Secret
 *   3. 在 .env 中配置 FEISHU_MULTI_USER_CONFIG，或配置 FEISHU_APP_ID/FEISHU_APP_SECRET/FEISHU_CLI_PROFILE
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
import { parseFeishuMessageEvent } from './feishu-message-parser.js';
import {
  loadFeishuMultiUserConfig,
  resolveFeishuUser,
  type FeishuAppConfig,
  type ResolvedFeishuUser,
} from './feishu-multi-user-config.js';

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

function getOrCreateAgent(user: ResolvedFeishuUser): OfficeAgent {
  const existing = userAgents.get(user.userKey);
  if (existing) return existing;

  // Per-user data directory for complete isolation
  const userDataDir = path.join(DATA_DIR, 'users', user.safeUserKey);
  const tokenTracker = new TokenTracker(path.join(userDataDir, 'token-usage.json'));
  const configured = createConfiguredLLM({ tokenTracker });
  const agent = createOfficeAgent({
    llm: configured.llm,
    baseDir: userDataDir,
    model: configured.model,
    runtimeContext: {
      feishuAppKey: user.appKey,
      feishuUserKey: user.userKey,
      ...(user.cliProfile ? { larkCliProfile: user.cliProfile } : {}),
    },
  });

  userAgents.set(user.userKey, agent);
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

  let feishuConfig;
  try {
    feishuConfig = loadFeishuMultiUserConfig(process.env, process.cwd());
  } catch (err) {
    log.error('飞书配置错误', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  if (feishuConfig.apps.length === 0) {
    log.error('飞书配置中没有启用的 app');
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

  const recipientStore = new FeishuRecipientStore(path.join(DATA_DIR, 'feishu-recipients.json'));
  const larkSdkLogger = createLarkSdkLogger();

  log.info('╔══════════════════════════════════════════╗');
  log.info('║   🤖 Office Agent — 飞书机器人           ║');
  log.info('╚══════════════════════════════════════════╝');
  log.info(`模型: ${llmConfig.provider}/${llmConfig.model}`);
  log.info('模式: WebSocket 长连接（无需公网 IP）');

  log.info('飞书 app 配置已加载', {
    source: feishuConfig.source,
    configPath: feishuConfig.configPath,
    appCount: feishuConfig.apps.length,
  });

  for (const app of feishuConfig.apps) {
    await startFeishuApp(app, recipientStore, larkSdkLogger);
  }

  log.info('✅ 飞书 WebSocket 长连接已启动，等待消息...', { appCount: feishuConfig.apps.length });
}

const activeWsClients: Lark.WSClient[] = [];

async function startFeishuApp(
  app: FeishuAppConfig,
  recipientStore: FeishuRecipientStore,
  larkSdkLogger: ReturnType<typeof createLarkSdkLogger>,
): Promise<void> {
  const baseConfig = { appId: app.appId, appSecret: app.appSecret };
  const larkClient = new Lark.Client({ ...baseConfig, logger: larkSdkLogger, loggerLevel: Lark.LoggerLevel.info });
  const wsClient = new Lark.WSClient({
    ...baseConfig,
    logger: larkSdkLogger,
    loggerLevel: Lark.LoggerLevel.info,
  });
  activeWsClients.push(wsClient);

  async function getFeishuTenantToken(): Promise<string> {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: app.appId, app_secret: app.appSecret }),
    });
    const data = await res.json() as { tenant_access_token?: string; msg?: string; code?: number };
    if (!res.ok || !data.tenant_access_token) {
      throw new Error(`获取飞书 tenant_access_token 失败: HTTP ${res.status} ${data.msg ?? data.code ?? ''}`);
    }
    return data.tenant_access_token;
  }

  async function ensureAgentStarted(user: ResolvedFeishuUser, chatId: string): Promise<void> {
    const existingChatId = startedAgentChats.get(user.userKey);
    if (existingChatId === chatId) return;

    const agent = getOrCreateAgent(user);
    const sessionChannel = `feishu-${user.safeUserKey}`;
    agent.queryEngine.setSessionChannel(sessionChannel);

    if (!existingChatId) {
      agent.configManager.load();
      await agent.skillSystem.loadSkills();
      agent.cronScheduler.start();
      agent.awaySummaryEngine.recordActivity();
      agent.queryEngine.restoreLastSession(sessionChannel);
    }

    const previousCallback = notificationCallbacks.get(user.userKey);
    if (previousCallback) {
      agent.notificationService.removeChannel(previousCallback);
    }

    const callback: NotifyCallback = async (message) => {
      try {
        await sendTextMessage(larkClient, chatId, `📢 ${message}`);
        log.info('主动推送成功', {
          appKey: app.key,
          userKey: user.userKey,
          chatId,
        });
      } catch (err) {
        log.error('推送提醒失败', {
          appKey: app.key,
          userKey: user.userKey,
          chatId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    agent.notificationService.addChannel(callback);
    notificationCallbacks.set(user.userKey, callback);

    if (!existingChatId) {
      agent.agendaScheduler.start();
      log.info('用户 Agent 已启动', {
        appKey: app.key,
        userKey: user.userKey,
        chatId,
        hasCliProfile: !!user.cliProfile,
      });
    } else {
      log.info('用户主动推送会话已更新', {
        appKey: app.key,
        userKey: user.userKey,
        previousChatId: existingChatId,
        chatId,
      });
    }

    startedAgentChats.set(user.userKey, chatId);
  }

  async function bootstrapKnownRecipients(): Promise<void> {
    const recipients = recipientStore.list(app.key);
    log.info('恢复飞书主动推送收件人', { appKey: app.key, count: recipients.length });

    for (const recipient of recipients) {
      try {
        const user = resolveFeishuUser(app, recipient.senderId);
        await ensureAgentStarted(user, recipient.chatId);
      } catch (err) {
        log.error('恢复飞书主动推送收件人失败', {
          appKey: app.key,
          senderId: recipient.senderId,
          chatId: recipient.chatId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async function handleFeishuMessage(
    user: ResolvedFeishuUser,
    chatId: string,
    cleanText: string,
    images?: string[],
  ): Promise<void> {
    try {
      recipientStore.upsert(user.openId, chatId, app.key);
      await ensureAgentStarted(user, chatId);
      const agent = getOrCreateAgent(user);

      let response = await processMessage(agent, cleanText, images);
      if (!user.configured && user.problem) {
        response = `${response}\n\n⚠️ ${user.problem}`;
      }

      log.info(`回复 to ${user.userKey}: ${response.slice(0, 80)}`);
      await sendTextMessage(larkClient, chatId, response);
    } catch (err) {
      log.error('处理消息失败', {
        appKey: app.key,
        userKey: user.userKey,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        await sendTextMessage(larkClient, chatId, `❌ 处理失败: ${err instanceof Error ? err.message : String(err)}`);
      } catch { /* ignore send failure */ }
    }
  }

  function enqueueFeishuMessage(
    user: ResolvedFeishuUser,
    chatId: string,
    cleanText: string,
    images?: string[],
  ): void {
    const queue = getOrCreateMessageQueue(user.userKey);
    const queuedBefore = queue.pendingCount();

    if (queuedBefore > 0) {
      void sendTextMessage(larkClient, chatId, `收到，前面还有 ${queuedBefore} 条消息/任务在处理。我会按顺序处理这条。`)
        .catch((err) => {
          log.warn('发送排队提示失败', {
            appKey: app.key,
            userKey: user.userKey,
            chatId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }

    const { promise } = queue.enqueue(() => handleFeishuMessage(user, chatId, cleanText, images));
    void promise.catch((err) => {
      log.error('队列消息处理失败', {
        appKey: app.key,
        userKey: user.userKey,
        chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({
      logger: larkSdkLogger,
      loggerLevel: Lark.LoggerLevel.info,
    }).register({
      'im.message.receive_v1': async (data: unknown) => {
        const parsed = parseFeishuMessageEvent(data);
        if (!parsed.success) {
          log.warn('飞书消息解析失败', { appKey: app.key, reason: parsed.reason });
          return;
        }

        const parsedMessage = parsed.message;
        const { messageId, chatId, senderId } = parsedMessage;
        const user = resolveFeishuUser(app, senderId);

        if (isDuplicate(`${app.key}:${messageId}`)) {
          log.debug('跳过重复消息', { appKey: app.key, messageId });
          return;
        }

        if (parsedMessage.kind === 'unsupported') {
          void sendTextMessage(larkClient, chatId, '目前支持文本、富文本、图片和语音消息，该类型暂不支持。');
          return;
        }

        if (parsedMessage.kind === 'image') {
          log.info(`收到图片消息 from ${user.userKey}`, { appKey: app.key, imageKey: parsedMessage.imageKey });
          void (async () => {
            const image = await downloadFeishuImage(parsedMessage.imageKey, messageId, getFeishuTenantToken);
            if (!image) {
              await sendTextMessage(larkClient, chatId, '❌ 图片下载失败，暂时无法识别这张图片。');
              return;
            }
            enqueueFeishuMessage(user, chatId, '请识别并描述用户发送的图片，并根据图片内容回应。', [image]);
          })().catch((err) => {
            log.error('图片处理失败', {
              appKey: app.key,
              userKey: user.userKey,
              chatId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          return;
        }

        if (parsedMessage.kind === 'audio') {
          log.info(`收到语音消息 from ${user.userKey}`, { appKey: app.key, fileKey: parsedMessage.fileKey });
          void (async () => {
            try {
              const audioBuffer = await downloadFeishuMessageResource(
                larkClient,
                messageId,
                parsedMessage.fileKey,
                'file',
                getFeishuTenantToken,
              );

              const apiKey = process.env['DASHSCOPE_API_KEY'] ?? '';
              if (!apiKey) {
                await sendTextMessage(larkClient, chatId, '❌ 语音识别需要配置 DASHSCOPE_API_KEY。当前 LLM 可以使用 DeepSeek，但语音转文字仍走 DashScope STT。');
                return;
              }
              const sttResult = await transcribeAudio(audioBuffer, apiKey, 'audio.ogg');

              if (!sttResult.success || !sttResult.text.trim()) {
                await sendTextMessage(larkClient, chatId, `❌ 语音识别失败: ${sttResult.error ?? '无法识别内容'}`);
                return;
              }

              log.info(`语音转文字: ${sttResult.text.slice(0, 80)}`, { appKey: app.key, userKey: user.userKey });
              enqueueFeishuMessage(user, chatId, sttResult.text);
            } catch (err) {
              log.error('语音处理失败', {
                appKey: app.key,
                userKey: user.userKey,
                error: err instanceof Error ? err.message : String(err),
              });
              try {
                await sendTextMessage(larkClient, chatId, `❌ 语音处理失败: ${err instanceof Error ? err.message : String(err)}`);
              } catch { /* ignore */ }
            }
          })();
          return;
        }

        const cleanText = parsedMessage.cleanText;
        const imageKeys = parsedMessage.kind === 'post' ? parsedMessage.imageKeys : [];

        log.info(`收到消息 from ${user.userKey}: ${cleanText.slice(0, 80)}`, {
          appKey: app.key,
          imageCount: imageKeys.length,
          hasCliProfile: !!user.cliProfile,
        });

        if (imageKeys.length > 0) {
          void (async () => {
            const images = (await Promise.all(
              imageKeys.map((key) => downloadFeishuImage(key, messageId, getFeishuTenantToken)),
            )).filter((image): image is string => image !== null);
            if (images.length === 0 && !cleanText) {
              await sendTextMessage(larkClient, chatId, '❌ 图片下载失败，暂时无法识别这条消息里的图片。');
              return;
            }
            enqueueFeishuMessage(user, chatId, cleanText || '请识别并描述用户发送的图片，并根据图片内容回应。', images);
          })().catch((err) => {
            log.error('富文本图片处理失败', {
              appKey: app.key,
              userKey: user.userKey,
              chatId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          return;
        }

        enqueueFeishuMessage(user, chatId, cleanText);
      },
    }),
  });

  log.info('飞书 app 长连接已启动', {
    appKey: app.key,
    configuredUsers: app.users.length,
    hasDefaultCliProfile: !!app.defaultCliProfile,
    allowUnmappedUsersWithDefaultProfile: app.allowUnmappedUsersWithDefaultProfile,
  });
  await bootstrapKnownRecipients();
}

async function sendTextMessage(lark: Lark.Client, chatId: string, text: string): Promise<void> {
  const chunks = splitMessage(text, 3500);
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
}

async function downloadFeishuMessageResource(
  lark: Lark.Client,
  messageId: string,
  fileKey: string,
  resourceType: 'file' | 'image',
  getTenantToken: () => Promise<string>,
): Promise<Buffer> {
  const resource = await lark.im.v1.messageResource.get({
    path: { message_id: messageId, file_key: fileKey },
    params: { type: resourceType },
  });

  const chunks: Buffer[] = [];
  const resData = resource as any;
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
    const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${resourceType}`;
    const httpRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!httpRes.ok) throw new Error(`HTTP ${httpRes.status}`);
    const arrayBuf = await httpRes.arrayBuffer();
    chunks.push(Buffer.from(arrayBuf));
  }

  return Buffer.concat(chunks);
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
