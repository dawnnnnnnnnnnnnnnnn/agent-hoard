/**
 * 一键自检：npm test
 *
 * 不需要预先启动任何东西 —— 自己起服务、跑 API 与 MCP 检查，有 Edge 时再跑界面验收。
 * 全部使用 demo 数据与临时端口，不碰真实配置、真实回收站。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NODE = process.execPath;

const PORT = 5399;
const CDP = 9599;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-test-'));
const results = [];
const t0 = Date.now();

const pass = (m) => { results.push(['PASS', m]); console.log('  \x1b[32m✓\x1b[0m ' + m); };
const fail = (m) => { results.push(['FAIL', m]); console.log('  \x1b[31m✗\x1b[0m ' + m); };
const skip = (m) => { results.push(['SKIP', m]); console.log('  \x1b[90m–\x1b[0m ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => res({ code, out }));
  });
}

// ── 准备演示数据 ──
console.log('\n\x1b[1mSpace Manager 自检\x1b[0m\n');
console.log('准备演示数据…');
const demo = await run(NODE, ['scripts/make-demo.mjs']);
if (demo.code !== 0) { console.log(demo.out); process.exit(1); }
pass('演示数据生成');

// ── 起服务（demo 数据 + 临时端口）──
const srv = spawn(NODE, ['server.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    SM_DATA_DIR: path.join(ROOT, 'demo', 'data'),
    SM_TRASH_DIR: path.join(tmp, 'trash'),
    SM_CONFIG: path.join(tmp, 'config.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', (d) => (srvOut += d));
srv.stderr.on('data', (d) => (srvOut += d));

let up = false;
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/api/volumes`); if (r.ok) { up = true; break; } } catch { }
  await sleep(250);
}
up ? pass(`服务启动（端口 ${PORT}）`) : fail('服务启动失败\n' + srvOut);
if (!up) { srv.kill(); process.exit(1); }

// ── API ──
console.log('\nAPI 与安全护栏：');
const api = await run(NODE, ['scripts/verify-api.mjs', `http://127.0.0.1:${PORT}`]);
console.log(api.out.split('\n').filter((l) => l.trim()).map((l) => '  ' + l).join('\n'));
api.code === 0 ? pass('API 自检') : fail('API 自检');

// ── MCP ──
console.log('\nMCP 协议：');
const mcp = await run(NODE, ['scripts/verify-mcp.mjs'], { env: { ...process.env, SM_MCP_PORT: String(PORT) } });
const mcpOk = /已拒绝/.test(mcp.out) && /正确返回 -32601/.test(mcp.out) && /tools\/list → 9/.test(mcp.out);
console.log(mcpOk ? '  ✓ initialize / tools/list / 安全拒绝 / 未知方法' : mcp.out.slice(0, 600).split('\n').map((l) => '  ' + l).join('\n'));
mcpOk ? pass('MCP 协议') : fail('MCP 协议');

// ── CLI ──
console.log('\nCLI：');
const cliHelp = await run(NODE, ['cli.mjs']);
/scan/.test(cliHelp.out) && /worktrees/.test(cliHelp.out) ? pass('CLI 帮助') : fail('CLI 帮助');

// ── 界面（有 Edge 才跑）──
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));

if (!edge) {
  skip('界面验收（未找到 Edge，跳过）');
} else {
  console.log('\n界面验收（headless Edge）：');
  const prof = path.join(tmp, 'edge');
  const br = spawn(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${prof}`,
    '--window-size=1600,1000', `http://127.0.0.1:${PORT}/#clean`], { stdio: 'ignore' });
  await sleep(6000);

  const suites = [
    ['动效与减少动效', 'verify-motion.mjs'],
    ['布局与溢出', 'verify-layout.mjs'],
    ['平台图表交互', 'verify-platform.mjs'],
    ['顶栏', 'verify-topbar.mjs'],
    ['Agents / Worktree 页', 'verify-agents.mjs'],
  ];
  for (const [name, file] of suites) {
    const r = await run(NODE, [path.join('scripts', file), String(CDP)]);
    const bad = /JS 错误： (?!无)/.test(r.out) || /"__err"/.test(r.out);
    bad ? fail(name + '\n' + r.out.slice(0, 700)) : pass(name);
  }
  br.kill();
  await sleep(600);
}

// ── 收尾 ──
srv.kill();
await sleep(400);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }

const P = results.filter((r) => r[0] === 'PASS').length;
const F = results.filter((r) => r[0] === 'FAIL').length;
const S = results.filter((r) => r[0] === 'SKIP').length;
const secs = ((Date.now() - t0) / 1000).toFixed(0);

console.log(`\n${F ? '\x1b[31m' : '\x1b[32m'}${P} 通过 · ${F} 失败 · ${S} 跳过\x1b[0m  (${secs}s)\n`);
process.exit(F ? 1 : 0);
