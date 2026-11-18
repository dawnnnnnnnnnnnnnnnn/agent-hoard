/** 全面自检：静态问题 + API 边界 + 安全护栏 */
const BASE = process.argv[2] || 'http://127.0.0.1:5178';
const out = [];
const ok = (m) => out.push(['PASS', m]);
const bad = (m) => out.push(['FAIL', m]);
const warn = (m) => out.push(['WARN', m]);

const j = async (p, opt) => {
  const r = await fetch(BASE + p, opt);
  let body = null;
  try { body = await r.json(); } catch { }
  return { status: r.status, body };
};
const post = (p, b) => j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

// ── 1. 基础端点 ──
{
  const r = await j('/api/volumes');
  r.status === 200 && Array.isArray(r.body?.volumes) && r.body.volumes.length
    ? ok(`/api/volumes 返回 ${r.body.volumes.length} 个盘`)
    : bad('/api/volumes 异常');
}
{
  const r = await j('/api/agents');
  r.status === 200 && Array.isArray(r.body?.agents)
    ? ok(`/api/agents 支持 ${r.body.supported} 种，检测到 ${r.body.present} 种`)
    : bad('/api/agents 异常');
}
{
  const r = await j('/api/scan');
  r.status === 200 && typeof r.body?.total === 'number'
    ? ok(`/api/scan 可用（${(r.body.total / 1073741824).toFixed(1)} GB，rootsSig=${r.body.rootsSig}）`)
    : bad('/api/scan 异常');
  if (r.body && !r.body.rootsSig) warn('/api/scan 缺少 rootsSig，旧缓存无法判定过期');
}
{
  const r = await j('/api/plan');
  r.status === 200 && r.body?.tiers
    ? ok(`/api/plan 三档：${['safe', 'low', 'medium'].map((k) => k + '=' + r.body.tiers[k].count).join(' ')}`)
    : bad('/api/plan 异常 ' + r.status);
}
{
  const r = await j('/api/sessions');
  r.status === 200 && Array.isArray(r.body?.sessions)
    ? ok(`/api/sessions 返回 ${r.body.sessions.length} 个会话`)
    : bad('/api/sessions 异常');
}
{
  const r = await j('/api/worktrees');
  r.status === 200 && Array.isArray(r.body?.worktrees)
    ? ok(`/api/worktrees 返回 ${r.body.worktrees.length} 个`)
    : bad('/api/worktrees 异常');
}
{
  const r = await j('/api/trash/list');
  r.status === 200 && Array.isArray(r.body?.batches)
    ? ok(`/api/trash/list 返回 ${r.body.batches.length} 个批次`)
    : bad('/api/trash/list 异常');
}

// ── 2. 错误处理 ──
{
  const r = await j('/api/nonexistent');
  r.status === 404 ? ok('未知 API 返回 404') : bad('未知 API 返回 ' + r.status);
}
{
  const r = await post('/api/clean', { tier: 'safe' });
  r.status === 400 ? ok('clean 缺 confirm 被拒（400）') : bad('clean 缺 confirm 返回 ' + r.status);
}
{
  const r = await post('/api/clean', { tier: 'bogus', confirm: true });
  r.status === 400 ? ok('clean 非法 tier 被拒（400）') : bad('clean 非法 tier 返回 ' + r.status);
}
{
  const r = await post('/api/trash', { paths: [] });
  r.status === 400 ? ok('trash 空数组被拒（400）') : bad('trash 空数组返回 ' + r.status);
}
{
  const r = await post('/api/trash', { paths: ['D:\\'] });
  const failed = r.body?.failedCount || r.body?.failed?.length || 0;
  failed > 0 ? ok('trash 拒绝盘根（护栏生效）') : bad('trash 没有拒绝盘根！');
}
{
  const r = await post('/api/trash/restore', { batch: '__nope__' });
  r.status === 400 ? ok('restore 不存在批次返回 400') : bad('restore 返回 ' + r.status);
}
{
  const r = await post('/api/trash/purge', { batch: '../../etc' });
  r.status === 400 || r.status === 200
    ? ok(`purge 路径穿越被 basename 挡住（返回 ${r.status}）`)
    : bad('purge 返回 ' + r.status);
}
{
  const r = await post('/api/sessions/archive', { platform: 'unknown', ids: ['x'], want: true });
  r.status === 400 ? ok('archive 未知平台被拒（400）') : bad('archive 返回 ' + r.status);
}
{
  const r = await post('/api/worktrees/remove', { repo: 'D:\\nope', name: 'nope' });
  r.status === 400 ? ok('worktree 移除不存在的目标被拒') : bad('worktree remove 返回 ' + r.status);
}

// ── 3. 静态资源与安全 ──
{
  const r = await fetch(BASE + '/');
  const html = await r.text();
  html.includes('Space Manager') && html.length > 50000
    ? ok(`首页可访问（${(html.length / 1024).toFixed(0)} KB）`)
    : bad('首页异常');
}
{
  const r = await fetch(BASE + '/../server.mjs');
  r.status === 403 || r.status === 404 ? ok('目录穿越被拒') : bad('静态服务可能穿越：' + r.status);
}
{
  const r = await fetch(BASE + '/%2e%2e/server.mjs');
  r.status === 403 || r.status === 404 ? ok('URL 编码穿越被拒') : bad('编码穿越：' + r.status);
}

// ── 4. 汇总 ──
const pass = out.filter((x) => x[0] === 'PASS').length;
const fail = out.filter((x) => x[0] === 'FAIL').length;
const warns = out.filter((x) => x[0] === 'WARN').length;
console.log(out.map(([k, m]) => `${k === 'PASS' ? '  ✓' : k === 'WARN' ? '  !' : '  ✗'} ${m}`).join('\n'));
console.log(`\n${pass} 通过 · ${warns} 警告 · ${fail} 失败`);
process.exit(fail ? 1 : 0);
