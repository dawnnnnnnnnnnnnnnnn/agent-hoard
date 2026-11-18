#!/usr/bin/env node
/**
 * AgentHoard MCP Server（stdio 传输）
 * 让任何 MCP 客户端（Claude Code / Codex / Cursor / DSH…）直接调用清理能力。
 *
 * 启动：node mcp-server.mjs
 * 配置示例（Claude Code 等）：
 *   { "mcpServers": { "agent-hoard": { "command": "node",
 *     "args": ["/<项目路径>/mcp-server.mjs"] } } }
 *
 * 协议：JSON-RPC 2.0，按行分隔（MCP stdio transport）。
 */
import readline from 'node:readline';
import * as C from './lib/core.mjs';

const PROTOCOL = '2024-11-05';
const SERVER = { name: 'agent-hoard', version: '1.1.0' };

const b = () => ({ type: 'string' });

const TOOLS = [
  {
    name: 'space_scan',
    description: '扫描所有 AI agent 的数据目录，统计占用。约 1–2 分钟，结果缓存，后续工具复用。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'space_plan',
    description: '返回三级清理计划（无风险 / 低风险 / 需确认），含每个平台的拆分。只读。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'space_agents',
    description: '列出本机检测到的所有 AI agent（DSH、Codex、Claude Code、Cursor、Gemini、Aider…）及其占用。只读。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'space_clean',
    description: '清理一个风险档位的文件。默认移入回收站（可恢复），purge=true 才是永久删除。platform 可限定单个 agent。',
    inputSchema: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['safe', 'low', 'medium'], description: 'safe=无风险 low=低风险 medium=需确认' },
        platform: { type: 'string', description: '只清这个 agent，例如 dsh / codex / cursor；省略=全部' },
        purge: { type: 'boolean', description: 'true=永久删除并立即释放空间；false=进回收站（默认）' },
        confirm: { type: 'boolean', description: '必须为 true，防止误调用' },
      },
      required: ['tier', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'space_sessions',
    description: '会话与归档统计。返回每个平台的会话数、占用、已归档数量。只读。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'space_worktrees',
    description: '列出所有 git worktree 并给出判定：clean（干净且已合并，可安全移除）/ dirty（有未提交改动）/ unmerged（有未合并提交）/ broken（目录已丢失的注册残留）。只读。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'space_worktree_remove',
    description: '用 git worktree remove 安全移除一个 worktree（不是 rm -rf）。默认拒绝移除有未提交改动或未合并提交的。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '主仓库绝对路径' },
        name: { type: 'string', description: 'worktree 名称（.git/worktrees 下的目录名）' },
        force: { type: 'boolean', description: '强制移除，即使有未提交改动' },
      },
      required: ['repo', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'space_trash',
    description: '查看回收站批次。只读。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'space_trash_purge',
    description: '永久删除一个回收站批次（或 all 全部），真正释放磁盘空间。不可恢复。',
    inputSchema: {
      type: 'object',
      properties: {
        batch: { type: 'string', description: '批次名，或 all 清空全部' },
        confirm: { type: 'boolean', description: '必须为 true' },
      },
      required: ['batch', 'confirm'],
      additionalProperties: false,
    },
  },
];

const fmt = (b2) => {
  if (!b2) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = b2;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
};

const needScan = () => {
  const c = C.loadCache();
  if (!c) throw new Error('还没有扫描结果，先调用 space_scan');
  return c;
};

async function callTool(name, args = {}) {
  switch (name) {
    case 'space_scan': {
      const d = await C.scan(C.loadConfig());
      C.saveCache(d);
      const risk = d.riskTotal || {};
      return `扫描完成：${d.fileCount.toLocaleString()} 个文件，共 ${fmt(d.total)}，用时 ${(d.tookMs / 1000).toFixed(0)}s。\n可清理：无风险 ${fmt(risk.safe)} / 低风险 ${fmt(risk.low)} / 需确认 ${fmt(risk.medium)}`;
    }
    case 'space_plan': {
      const c = needScan();
      const p = C.buildPlan(c);
      const lines = [];
      for (const id of ['safe', 'low', 'medium']) {
        const t = p[id];
        const plat = Object.entries(t.byPlatform).map(([k, v]) => `${k} ${fmt(v.bytes)}/${v.count}项`).join('，') || '—';
        lines.push(`## ${t.label}  ${fmt(t.bytes)}  ${t.count} 项\n${t.hint}\n类型：${Object.entries(t.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${C.KIND[k]?.label || k} ${fmt(v)}`).join('、') || '无'}\n平台：${plat}\n前 5 项：\n${t.items.slice(0, 5).map((x) => `  - ${x.path}  ${fmt(x.bytes)}`).join('\n')}`);
      }
      return lines.join('\n\n');
    }
    case 'space_agents': {
      const cfg = C.loadConfig();
      const cache = C.loadCache();
      const sizes = {};
      for (const r of cache?.roots || []) sizes[r.platform] = (sizes[r.platform] || 0) + r.size;
      const agents = C.discoverAgents(cfg);
      const present = agents.filter((a) => a.present);
      const head = `支持 ${C.AGENT_SPECS.length} 种 agent，本机检测到 ${present.length} 种：\n`;
      const body = present.sort((a, b) => (sizes[b.id] || 0) - (sizes[a.id] || 0))
        .map((a) => `- ${a.name}（${a.id}）  ${fmt(sizes[a.id] || 0)}\n  ${a.paths.map((f) => f.path).join('\n  ')}`).join('\n');
      const absent = agents.filter((a) => !a.present).map((a) => a.id);
      return head + body + (absent.length ? `\n\n未安装：${absent.join('、')}` : '');
    }
    case 'space_clean': {
      if (!args.confirm) throw new Error('需要 confirm: true');
      const r = C.cleanTier(args.tier, { purge: !!args.purge, platform: args.platform });
      if (r.error) throw new Error(r.error);
      if (!r.okCount) return '没有可清理项。';
      return `已清理 ${r.okCount} 项，共 ${fmt(r.freed)}${args.purge ? '（已永久删除）' : `（在回收站：${r.batch}）`}` +
        (r.failedCount ? `\n${r.failedCount} 项被占用跳过：\n${r.failed.map((f) => `  - ${f.p} → ${f.why}`).join('\n')}` : '');
    }
    case 'space_sessions': {
      const list = C.allSessions();
      const bp = {};
      for (const s of list) {
        const x = bp[s.platform] = bp[s.platform] || { count: 0, size: 0, archived: 0, archivedSize: 0 };
        x.count++; x.size += s.size;
        if (s.archived) { x.archived++; x.archivedSize += s.size; }
      }
      const lines = Object.entries(bp).sort((a, b) => b[1].size - a[1].size)
        .map(([k, v]) => `- ${k}: ${v.count} 个会话，${fmt(v.size)}，其中已归档 ${v.archived} 个（${fmt(v.archivedSize)}）`);
      return `共 ${list.length} 个会话，${fmt(list.reduce((a, s) => a + s.size, 0))}\n${lines.join('\n')}\n\n注意：归档只是从侧栏隐藏，磁盘占用不变。想省空间只能删除。`;
    }
    case 'space_worktrees': {
      const list = C.listWorktrees(C.loadConfig());
      if (!list.length) return '没有检测到 git worktree（注册记录）。';
      const by = { clean: 0, dirty: 0, unmerged: 0, broken: 0 };
      for (const w of list) by[w.verdict] = (by[w.verdict] || 0) + 1;
      const reclaim = list.filter((w) => w.verdict === 'clean' || w.verdict === 'broken').reduce((a, w) => a + w.size, 0);
      const body = list.map((w) => `- [${w.verdict}] ${w.path || '(目录已丢失)'}  ${fmt(w.size)}\n  仓库 ${w.repo} · 分支 ${w.branch || '?'} · ${w.reason}`).join('\n');
      return `共 ${list.length} 个 worktree，可回收 ${fmt(reclaim)}\nclean ${by.clean} · dirty ${by.dirty} · unmerged ${by.unmerged} · broken ${by.broken}\n\n${body}`;
    }
    case 'space_worktree_remove': {
      const r = C.removeWorktree(args.repo, args.name, !!args.force);
      if (!r.ok) throw new Error(r.error || '移除失败');
      return `已移除 ${r.removed || args.name}，释放 ${fmt(r.freed || 0)}`;
    }
    case 'space_trash': {
      const list = C.listTrash();
      if (!list.length) return '回收站是空的。';
      const total = list.reduce((a, b) => a + b.size, 0);
      return `共 ${list.length} 个批次，${fmt(total)}\n` +
        list.map((b) => `- ${b.batch}  ${b.count} 项 ${fmt(b.size)}${b.label ? ' · ' + b.label : ''}`).join('\n') +
        '\n\n清空才真正释放空间。';
    }
    case 'space_trash_purge': {
      if (!args.confirm) throw new Error('需要 confirm: true');
      const r = C.purgeBatch(args.batch);
      if (r.error) throw new Error(r.error);
      return `已永久删除，释放 ${fmt(r.freed)}`;
    }
    default:
      throw new Error('未知工具：' + name);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

rl.on('line', async (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { return; }
  const { id, method, params } = msg;

  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER,
        });
      case 'notifications/initialized':
      case 'initialized':
        return;   // 通知，不回复
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments || {};
        const tool = TOOLS.find((x) => x.name === name);
        if (!tool) return replyError(id, -32602, '未知工具：' + name);
        try {
          const text = await callTool(name, args);
          return reply(id, { content: [{ type: 'text', text }] });
        } catch (e) {
          return reply(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true });
        }
      }
      case 'resources/list':
        return reply(id, { resources: [] });
      case 'prompts/list':
        return reply(id, { prompts: [] });
      default:
        if (id != null) return replyError(id, -32601, '不支持的方法：' + method);
        return;
    }
  } catch (e) {
    if (id != null) replyError(id, -32603, String(e.message || e));
  }
});

process.stderr.write('agent-hoard MCP server ready (stdio)\n');
