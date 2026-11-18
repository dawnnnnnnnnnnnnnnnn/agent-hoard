#!/usr/bin/env node
/**
 * Space Manager CLI —— 不依赖 Web UI 的终端入口
 *
 *   node cli.mjs scan              扫描
 *   node cli.mjs plan              看三级计划
 *   node cli.mjs agents            本机检测到的 agent
 *   node cli.mjs sessions          会话与归档统计
 *   node cli.mjs worktrees         列出 git worktree
 *   node cli.mjs clean safe        清理（默认进回收站）
 *   node cli.mjs clean low --purge 永久删除
 *   node cli.mjs trash             回收站
 */
import * as C from './lib/core.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
const pos = argv.filter((a) => !a.startsWith('--'));

const fmt = (b) => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
};
const line = (n = 60) => '─'.repeat(n);
const dt = (ms) => ms ? new Date(ms).toLocaleString('zh-CN') : '—';

const need = () => {
  const c = C.loadCache();
  if (!c) { console.error('还没有扫描结果，先运行：node cli.mjs scan'); process.exit(1); }
  return c;
};

switch (cmd) {
  case 'scan': {
    console.log('扫描中…（约 1–2 分钟）');
    const d = C.scan(C.loadConfig());
    C.saveCache(d);
    console.log(`${line()}\n${d.fileCount.toLocaleString()} 个文件 · ${fmt(d.total)} · ${(d.tookMs / 1000).toFixed(0)}s\n`);
    const r = d.riskTotal || {};
    console.log('可清理：');
    console.log(`  无风险   ${fmt(r.safe).padStart(10)}`);
    console.log(`  低风险   ${fmt(r.low).padStart(10)}`);
    console.log(`  需确认   ${fmt(r.medium).padStart(10)}`);
    break;
  }

  case 'plan': {
    const c = need();
    const p = C.buildPlan(c);
    for (const id of ['safe', 'low', 'medium']) {
      const t = p[id];
      console.log(`\n${line()}\n${t.label}  ${fmt(t.bytes)}  ${t.count} 项`);
      console.log(`  ${t.hint}`);
      const kinds = Object.entries(t.kinds).sort((a, b) => b[1] - a[1]);
      if (kinds.length) console.log('  ' + kinds.map(([k, v]) => `${C.KIND[k]?.label || k} ${fmt(v)}`).join(' · '));
      for (const it of t.items.slice(0, 12)) {
        console.log(`    ${fmt(it.bytes).padStart(9)}  ${it.path}`);
      }
      if (t.count > 12) console.log(`    … 另有 ${t.count - 12} 项`);
    }
    break;
  }

  case 'agents': {
    const cfg = C.loadConfig();
    const cache = C.loadCache();
    const sizes = {};
    for (const r of cache?.roots || []) sizes[r.platform] = (sizes[r.platform] || 0) + r.size;
    const agents = C.discoverAgents(cfg);
    const present = agents.filter((a) => a.present).sort((a, b) => (sizes[b.id] || 0) - (sizes[a.id] || 0));
    console.log(`支持 ${C.AGENT_SPECS.length} 种 agent，本机检测到 ${present.length} 种\n${line()}`);
    for (const a of present) {
      console.log(`${a.name.padEnd(22)} ${fmt(sizes[a.id] || 0).padStart(10)}`);
      for (const f of a.paths) console.log(`  ${f.path}`);
    }
    const absent = agents.filter((a) => !a.present).map((a) => a.id);
    if (absent.length) console.log(`\n未安装：${absent.join('、')}`);
    if (!cache) console.log('\n（未扫描，占用列为 0；先运行 node cli.mjs scan）');
    break;
  }

  case 'sessions': {
    const list = C.allSessions();
    const bp = {};
    for (const s of list) {
      const x = bp[s.platform] = bp[s.platform] || { count: 0, size: 0, archived: 0, archivedSize: 0 };
      x.count++; x.size += s.size;
      if (s.archived) { x.archived++; x.archivedSize += s.size; }
    }
    console.log(`${line()}`);
    for (const [k, v] of Object.entries(bp).sort((a, b) => b[1].size - a[1].size)) {
      console.log(`${k.padEnd(12)} ${String(v.count).padStart(5)} 个  ${fmt(v.size).padStart(10)}  已归档 ${v.archived}（${fmt(v.archivedSize)}）`);
    }
    console.log(`\n归档 ≠ 省空间：只是从侧栏隐藏，磁盘占用不变。`);
    break;
  }

  case 'worktrees': {
    const list = C.listWorktrees(C.loadConfig());
    if (!list.length) { console.log('没有检测到 git worktree。'); break; }
    const by = {}; let reclaim = 0;
    for (const w of list) { by[w.verdict] = (by[w.verdict] || 0) + 1; if (w.verdict === 'clean' || w.verdict === 'broken') reclaim += w.size; }
    console.log(`共 ${list.length} 个，可回收 ${fmt(reclaim)}  |  clean ${by.clean || 0} · dirty ${by.dirty || 0} · unmerged ${by.unmerged || 0} · broken ${by.broken || 0}\n${line()}`);
    for (const w of list) {
      console.log(`[${w.verdict.padEnd(8)}] ${fmt(w.size).padStart(9)}  ${w.path || '(目录已丢失)'}`);
      console.log(`           仓库 ${w.repo} · 分支 ${w.branch || '?'} · ${w.reason}`);
    }
    break;
  }

  case 'clean': {
    const tier = pos[1];
    if (!['safe', 'low', 'medium'].includes(tier)) { console.error('用法：node cli.mjs clean safe|low|medium [--purge] [--platform=dsh]'); process.exit(1); }
    const platform = argv.find((a) => a.startsWith('--platform='))?.split('=')[1];
    const purge = flags.has('purge');
    const c = need();
    const p = C.buildPlan(c);
    const t = p[tier];
    let count = t.count, bytes = t.bytes;
    if (platform) { count = t.byPlatform[platform]?.count || 0; bytes = t.byPlatform[platform]?.bytes || 0; }
    if (!count) { console.log('没有可清理项。'); break; }
    console.log(`${purge ? '永久删除' : '移入回收站'}：${t.label}${platform ? ' · ' + platform : ''} ${count} 项 ${fmt(bytes)}`);
    if (!purge) console.log('（加 --purge 才真正释放磁盘空间）');
    const r = C.cleanTier(tier, { purge, platform });
    if (r.error) { console.error(r.error); process.exit(1); }
    console.log(`完成：${r.okCount} 项，${fmt(r.freed)}${r.failedCount ? ` · ${r.failedCount} 项被占用跳过` : ''}`);
    if (!purge) console.log(`批次：${r.batch}`);
    break;
  }

  case 'worktree-remove': {
    const repo = pos[1];
    const name = pos[2];
    if (!repo || !name) { console.error('用法：node cli.mjs worktree-remove <仓库路径> <worktree名> [--force]'); process.exit(1); }
    const r = C.removeWorktree(repo, name, flags.has('force'));
    if (!r.ok) { console.error('拒绝：' + (r.error || '未知原因')); process.exit(1); }
    console.log(`已移除 ${r.removed || name}，释放 ${fmt(r.freed || 0)}`);
    break;
  }

  case 'trash': {
    const list = C.listTrash();
    if (!list.length) { console.log('回收站是空的。'); break; }
    const total = list.reduce((a, b) => a + b.size, 0);
    console.log(`共 ${list.length} 个批次，${fmt(total)}\n${line()}`);
    for (const b of list) console.log(`${fmt(b.size).padStart(10)}  ${String(b.count).padStart(4)} 项  ${b.label || '—'}  ${b.batch}`);
    console.log('\n清空：node cli.mjs trash-purge <batch|all>');
    break;
  }

  case 'trash-purge': {
    const batch = pos[1];
    if (!batch) { console.error('用法：node cli.mjs trash-purge <batch|all>'); process.exit(1); }
    const r = C.purgeBatch(batch);
    if (r.error) { console.error(r.error); process.exit(1); }
    console.log(`已永久删除，释放 ${fmt(r.freed)}`);
    break;
  }

  default:
    console.log(`Space Manager CLI

  node cli.mjs scan                    扫描所有 agent 的数据目录
  node cli.mjs plan                    看三级清理计划
  node cli.mjs agents                  本机检测到的 agent 与占用
  node cli.mjs sessions                会话与归档统计
  node cli.mjs worktrees               列出 git worktree 及判定
  node cli.mjs worktree-remove <仓库> <名> [--force]  安全移除一个 worktree
  node cli.mjs clean safe              清理（进回收站）
  node cli.mjs clean low --purge       永久删除
  node cli.mjs clean low --platform=dsh  只清某个 agent
  node cli.mjs trash                   看回收站
  node cli.mjs trash-purge all         清空回收站

环境变量：
  SPACE_ROOT   数据目录所在盘（默认 D:\\）
  PORT         HTTP 服务端口（默认 5178）
`);
}
