/**
 * OpenAI Compatible API — 让 Open WebUI / Lobe Chat 等前端直接对接
 *
 * 实现 /v1/chat/completions 和 /v1/models 接口
 * 内部调用 Office Agent 的 QueryEngine 处理请求
 */
import express from 'express';
import cors from 'cors';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createOfficeAgent, type OfficeAgent } from '../main.js';
import { createDashScopeLLM } from '../core/dashscope-llm.js';
import { TokenTracker } from '../core/token-tracker.js';
import type { StreamEvent } from '../types/index.js';

const DATA_DIR = path.join(os.homedir(), '.office-agent');

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

let agent: OfficeAgent;
let tokenTracker: TokenTracker;

function getAgent(): OfficeAgent {
  if (agent) return agent;
  loadEnv();
  const apiKey = process.env['DASHSCOPE_API_KEY'] ?? '';
  const model = process.env['DASHSCOPE_MODEL'] ?? 'qwen-plus';
  tokenTracker = new TokenTracker(path.join(DATA_DIR, 'token-usage.json'));
  const llm = createDashScopeLLM({ apiKey, model, tokenTracker });
  agent = createOfficeAgent({ llm, baseDir: DATA_DIR, model });
  return agent;
}

export function createOpenAIServer(port = 3001) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // --- /v1/models ---
  app.get('/v1/models', (_req, res) => {
    res.json({
      object: 'list',
      data: [{
        id: 'office-agent',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'office-agent',
      }],
    });
  });

  // --- /v1/chat/completions ---
  app.post('/v1/chat/completions', async (req, res) => {
    const { messages, stream } = req.body as {
      messages: Array<{ role: string; content: string }>;
      stream?: boolean;
    };

    if (!messages || !messages.length) {
      res.status(400).json({ error: { message: 'messages required' } });
      return;
    }

    // 取最后一条 user 消息
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) {
      res.status(400).json({ error: { message: 'no user message found' } });
      return;
    }

    const a = getAgent();
    const completionId = 'chatcmpl-' + randomUUID();

    if (stream) {
      // SSE streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        for await (const event of a.handleMessage(lastUserMsg.content)) {
          if (event.type === 'text') {
            const chunk = {
              id: completionId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'office-agent',
              choices: [{
                index: 0,
                delta: { content: event.content },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          } else if (event.type === 'tool_use') {
            const chunk = {
              id: completionId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'office-agent',
              choices: [{
                index: 0,
                delta: { content: `\n🔧 调用工具: ${event.toolName}\n` },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          } else if (event.type === 'tool_result') {
            const r = event.result;
            const icon = r.success ? '✅' : '❌';
            const chunk = {
              id: completionId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'office-agent',
              choices: [{
                index: 0,
                delta: { content: `${icon} 工具结果: ${JSON.stringify(r.output).slice(0, 200)}\n` },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          } else if (event.type === 'error') {
            const chunk = {
              id: completionId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'office-agent',
              choices: [{
                index: 0,
                delta: { content: `\n❌ 错误: ${event.error}\n` },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.write(`data: ${JSON.stringify({
          id: completionId, object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000), model: 'office-agent',
          choices: [{ index: 0, delta: { content: `\n❌ ${msg}` }, finish_reason: null }],
        })}\n\n`);
      }

      // Send finish
      res.write(`data: ${JSON.stringify({
        id: completionId, object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000), model: 'office-agent',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();

    } else {
      // Non-streaming
      let fullContent = '';
      try {
        for await (const event of a.handleMessage(lastUserMsg.content)) {
          if (event.type === 'text') fullContent += event.content;
          else if (event.type === 'tool_use') fullContent += `\n🔧 ${event.toolName}\n`;
          else if (event.type === 'tool_result') {
            const r = event.result;
            fullContent += `${r.success ? '✅' : '❌'} ${JSON.stringify(r.output).slice(0, 200)}\n`;
          }
          else if (event.type === 'error') fullContent += `\n❌ ${event.error}`;
        }
      } catch (err) {
        fullContent += `\n❌ ${err instanceof Error ? err.message : String(err)}`;
      }

      res.json({
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'office-agent',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: fullContent },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
  });

  return {
    app,
    start: async () => {
      const a = getAgent();
      await a.start();
      app.listen(port, () => {
        console.log(`🤖 Office Agent OpenAI-Compatible API: http://localhost:${port}`);
        console.log(`   模型名: office-agent`);
        console.log(`   接口: /v1/chat/completions, /v1/models`);
        console.log('');
        console.log('   在 Open WebUI 中配置:');
        console.log(`   - 连接类型: OpenAI API`);
        console.log(`   - API Base URL: http://localhost:${port}/v1`);
        console.log(`   - API Key: 任意值 (如 sk-dummy)`);
        console.log(`   - 模型: office-agent`);
      });
    },
  };
}

const server = createOpenAIServer(3001);
server.start().catch(console.error);
