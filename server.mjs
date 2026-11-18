#!/usr/bin/env node
/**
 * AgentHoard — 本地 HTTP 服务（Web UI 后端）
 * 核心逻辑在 lib/core.mjs，HTTP / MCP / CLI 三个入口共用。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './lib/core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 16e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(PUBLIC, decodeURIComponent(rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  try {
    if (!p.startsWith('/api/')) return serveStatic(res, p);

    // ── 基础 ──
    if (p === '/api/volumes') return send(res, 200, { volumes: C.volumeInfo() });

    if (p === '/api/config') {
      if (req.method === 'POST') {
        const b = await readBody(req);
        C.saveConfig({ ...C.loadConfig(), ...b });
        return send(res, 200, { ok: true, config: C.loadConfig() });
      }
      return send(res, 200, { config: C.loadConfig(), agents: C.discoverAgents(C.loadConfig()).map((a) => ({ id: a.id, name: a.name, short: a.short, color: a.color, present: a.present, paths: a.paths.map((f) => f.path) })) });
    }

    if (p === '/api/agents') {
      const cfg = C.loadConfig();
      const cache = C.loadCache();
      const sizes = {};
      for (const r of cache?.roots || []) sizes[r.platform] = (sizes[r.platform] || 0) + r.size;
      const agents = C.discoverAgents(cfg).map((a) => ({
        id: a.id, name: a.name, short: a.short, color: a.color, present: a.present,
        paths: a.paths.map((f) => f.path), size: sizes[a.id] || 0,
      }));
      return send(res, 200, { agents, supported: C.AGENT_SPECS.length, present: agents.filter((a) => a.present).length });
    }

    // ── 扫描 / 计划 / 清理 ──
    if (p === '/api/scan') {
      const cfg = C.loadConfig();
      const st = C.cacheStatus(cfg);
      if (req.method === 'GET' && st.exists && st.fresh && !u.searchParams.get('fresh')) {
        return send(res, 200, { cached: true, ...C.loadCache() });
      }
      const data = C.scan(cfg);
      C.saveCache(data);
      return send(res, 200, { cached: false, ...data });
    }

    if (p === '/api/plan') {
      const st = C.cacheStatus(C.loadConfig());
      if (!st.exists) return send(res, 409, { error: '还没有扫描结果，先跑一次扫描' });
      if (!st.fresh) return send(res, 409, { error: '配置已变更，缓存已过期，请重新扫描', stale: true });
      const cached = C.loadCache();
      const plan = C.buildPlan(cached);
      const tiers = {};
      for (const id of ['safe', 'low', 'medium']) {
        const { _all, _byPlatformPaths, ...rest } = plan[id];
        tiers[id] = rest;
      }
      return send(res, 200, { scannedAt: cached.scannedAt, tiers, platforms: plan._platforms });
    }

    if (p === '/api/clean' && req.method === 'POST') {
      const { tier, confirm, purge, platform } = await readBody(req);
      if (!confirm) return send(res, 400, { error: '需要 confirm: true' });
      const r = C.cleanTier(tier, { purge, platform });
      const code = r.error ? (/过期/.test(r.error) ? 409 : 400) : 200;
      return send(res, code, r);
    }

    // ── 会话 ──
    if (p === '/api/sessions') {
      const list = C.allSessions();
      const byPlatform = {};
      for (const s of list) {
        const b = byPlatform[s.platform] = byPlatform[s.platform] || { count: 0, size: 0, archived: 0, archivedSize: 0 };
        b.count++; b.size += s.size;
        if (s.archived) { b.archived++; b.archivedSize += s.size; }
      }
      return send(res, 200, { sessions: list, byPlatform });
    }

    if (p === '/api/sessions/archive' && req.method === 'POST') {
      const { platform, ids = [], want = true } = await readBody(req);
      try { return send(res, 200, { ok: true, ...C.archiveSessions(platform, ids, want) }); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
    }

    // ── Git worktree ──
    if (p === '/api/worktrees') {
      const list = C.listWorktrees(C.loadConfig());
      const summary = { total: list.length, clean: 0, dirty: 0, unmerged: 0, broken: 0, bytes: 0, reclaimable: 0 };
      for (const w of list) {
        summary[w.verdict] = (summary[w.verdict] || 0) + 1;
        summary.bytes += w.size;
        if (w.verdict === 'clean' || w.verdict === 'broken') summary.reclaimable += w.size;
      }
      return send(res, 200, { worktrees: list, summary });
    }

    if (p === '/api/worktrees/remove' && req.method === 'POST') {
      const { repo, name, force } = await readBody(req);
      const r = C.removeWorktree(repo, name, !!force);
      return send(res, r.ok ? 200 : 400, r);
    }

    // ── 回收站 ──
    if (p === '/api/trash' && req.method === 'POST') {
      const { paths = [], label = '' } = await readBody(req);
      if (!Array.isArray(paths) || !paths.length) return send(res, 400, { error: 'no paths' });
      if (paths.length > 5000) return send(res, 400, { error: '一次最多 5000 项' });
      const r = C.moveToTrash(paths, label);
      return send(res, 200, { ok: true, okCount: r.ok, freed: r.freed, batch: r.batch, failed: r.failed.slice(0, 20), failedCount: r.failed.length });
    }

    if (p === '/api/trash/list') return send(res, 200, { batches: C.listTrash() });

    if (p === '/api/trash/restore' && req.method === 'POST') {
      const { batch } = await readBody(req);
      const r = C.restoreBatch(batch);
      return send(res, r.error ? 400 : 200, r);
    }

    if (p === '/api/trash/purge' && req.method === 'POST') {
      const { batch } = await readBody(req);
      const r = C.purgeBatch(batch);
      return send(res, r.error ? 400 : 200, r);
    }

    return send(res, 404, { error: 'unknown api' });
  } catch (e) {
    send(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, HOST, () => console.log(`AgentHoard → http://${HOST}:${PORT}`));
