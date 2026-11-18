/** MCP 协议验收：起子进程，走 stdio JSON-RPC */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const child = spawn(process.execPath, [path.join(ROOT, 'mcp-server.mjs')], {
  cwd: ROOT,
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.on('exit', (c) => { if (c !== 0 && c !== null) console.log('!! 子进程退出码', c); });

let buf = '';
const waiters = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { console.log('非 JSON 输出:', line.slice(0, 200)); continue; }
    const w = waiters.get(msg.id);
    if (w) { w(msg); waiters.delete(msg.id); }
  }
});
const errs = [];
child.stderr.on('data', (d) => errs.push(d.toString()));

let id = 0;
function rpc(method, params) {
  const myId = ++id;
  return new Promise((res, rej) => {
    waiters.set(myId, res);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
    setTimeout(() => { if (waiters.delete(myId)) rej(new Error('超时: ' + method)); }, 120000);
  });
}

const main = async () => {
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify', version: '1' } });
  console.log('initialize →', JSON.stringify(init.result?.serverInfo), 'protocol', init.result?.protocolVersion);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = await rpc('tools/list', {});
  console.log('tools/list →', tools.result.tools.length, '个工具:');
  for (const t of tools.result.tools) console.log('   ', t.name, '—', t.description.slice(0, 46) + '…');

  const call = async (name, args = {}, show = 260) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const txt = r.result?.content?.[0]?.text || JSON.stringify(r.result);
    console.log(`\n▶ ${name}${r.result?.isError ? ' [isError]' : ''}\n` + txt.slice(0, show).split('\n').map((l) => '   ' + l).join('\n'));
    return txt;
  };

  await call('space_agents', {}, 420);
  await call('space_worktrees', {}, 420);
  await call('space_sessions', {}, 320);
  await call('space_plan', {}, 360);

  // 安全断言：不带 confirm 必须报错
  const noConfirm = await rpc('tools/call', { name: 'space_clean', arguments: { tier: 'safe' } });
  console.log('\n▶ space_clean 不带 confirm →', noConfirm.result?.isError ? '已拒绝 ✓' : '!! 竟然执行了');

  // 未知工具
  const bad = await rpc('tools/call', { name: 'nope', arguments: {} });
  console.log('▶ 未知工具 →', bad.error ? '正确返回错误 ✓' : '!! 未报错');

  // 未知方法
  const badM = await rpc('resources/read', { uri: 'x' });
  console.log('▶ 未知方法 →', badM.error?.code === -32601 ? '正确返回 -32601 ✓' : JSON.stringify(badM));

  console.log('\nstderr:', errs.join('').trim() || '无');
  child.kill();
};

main().catch((e) => { console.error('FAIL:', e.message); child.kill(); process.exit(1); });
