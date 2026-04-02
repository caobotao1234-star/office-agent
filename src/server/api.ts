/**
 * Office Agent — REST API Server
 * 为 Web GUI 提供后端接口
 */
import express from 'express';
import cors from 'cors';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createOfficeAgent, type OfficeAgent } from '../main.js';
import { createDashScopeLLM } from '../core/dashscope-llm.js';
import { TokenTracker } from '../core/token-tracker.js';
import type { StreamEvent } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(os.homedir(), '.office-agent');
const STATIC_DIR = path.join(__dirname, '..', '..', 'web', 'dist');

// Load .env
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

export function createServer(port = 3000) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Serve static frontend
  if (fs.existsSync(STATIC_DIR)) {
    app.use(express.static(STATIC_DIR));
  }

  // --- Chat (SSE streaming) ---
  app.post('/api/chat', async (req, res) => {
    const { message } = req.body as { message: string };
    if (!message) { res.status(400).json({ error: 'message required' }); return; }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const a = getAgent();
      for await (const event of a.handleMessage(message)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  // --- Projects ---
  app.get('/api/projects', (_req, res) => {
    const a = getAgent();
    const agents = a.subAgentManager.list();
    res.json(agents.map(ag => ({
      id: ag.id, projectId: ag.projectId, projectName: ag.projectName,
      status: ag.status, createdAt: ag.createdAt.toISOString(),
    })));
  });

  app.post('/api/projects', async (req, res) => {
    const { name, context } = req.body as { name: string; context?: string };
    const a = getAgent();
    const result = await a.subAgentManager.create(name, context ?? '');
    res.json({ agent: { ...result.agent, createdAt: result.agent.createdAt.toISOString() } });
  });

  app.delete('/api/projects/:id', async (req, res) => {
    const a = getAgent();
    await a.subAgentManager.archive(req.params.id, a.memorySystem);
    res.json({ ok: true });
  });

  // --- Tasks ---
  app.get('/api/tasks', async (_req, res) => {
    const a = getAgent();
    const result = await a.toolRegistry.execute('TaskManager', { action: 'list' },
      { abortSignal: new AbortController().signal, userConfig: a.getConfig() });
    res.json(result.output ?? []);
  });

  app.post('/api/tasks', async (req, res) => {
    const a = getAgent();
    const result = await a.toolRegistry.execute('TaskManager', { action: 'create', ...req.body },
      { abortSignal: new AbortController().signal, userConfig: a.getConfig() });
    res.json(result);
  });

  app.patch('/api/tasks/:id', async (req, res) => {
    const a = getAgent();
    const result = await a.toolRegistry.execute('TaskManager', { action: 'update', id: req.params.id, ...req.body },
      { abortSignal: new AbortController().signal, userConfig: a.getConfig() });
    res.json(result);
  });

  // --- Memory ---
  app.get('/api/memories', async (req, res) => {
    const a = getAgent();
    const keyword = req.query.keyword as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const results = await a.memorySystem.search({ keyword, projectId, limit: 50 });
    res.json(results.map(m => ({ ...m, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString(), lastAccessedAt: m.lastAccessedAt.toISOString() })));
  });

  app.post('/api/memories', async (req, res) => {
    const a = getAgent();
    const entry = await a.memorySystem.store({ ...req.body, updatedAt: new Date() });
    res.json(entry);
  });

  app.delete('/api/memories/:id', async (req, res) => {
    const a = getAgent();
    await a.memorySystem.delete(req.params.id);
    res.json({ ok: true });
  });

  // --- Token Usage ---
  app.get('/api/usage', (_req, res) => {
    if (!tokenTracker) { getAgent(); }
    res.json({ report: tokenTracker.formatReport(), detail: tokenTracker.formatDetailReport() });
  });

  // --- Config ---
  app.get('/api/config', (_req, res) => {
    const a = getAgent();
    res.json(a.getConfig());
  });

  app.patch('/api/config', (req, res) => {
    const a = getAgent();
    a.configManager.update(req.body);
    res.json(a.getConfig());
  });

  // --- Skills ---
  app.get('/api/skills', (_req, res) => {
    const a = getAgent();
    res.json(a.skillSystem.getSkills());
  });

  // --- Start ---
  app.get('/api/status', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  // SPA fallback
  app.get('*', (_req, res) => {
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: 'Frontend not built. Run: cd web && npm run build' });
    }
  });

  return { app, start: async () => {
    const a = getAgent();
    await a.start();
    app.listen(port, () => {
      console.log(`🤖 Office Agent Web UI: http://localhost:${port}`);
    });
  }};
}

// Direct run
const server = createServer(3000);
server.start().catch(console.error);
