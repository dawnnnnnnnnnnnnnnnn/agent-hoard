/** 用演示实例（脱敏数据）截取 README 图 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const DEMO_PORT = process.argv[2] || '5180';
const CDP_PORT = process.argv[3] || '9491';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = path.join(ROOT, 'demo', 'edge-profile');
fs.rmSync(prof, { recursive: true, force: true });

const br = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${prof}`,
  '--window-size=1600,1000', `http://127.0.0.1:${DEMO_PORT}/#clean`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(7000);

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes(String(DEMO_PORT)));
if (!page) { console.log('没找到页面'); br.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
};
const send = (m, p = {}) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
await sleep(1500);

const shots = [
  ['clean', 'clean'],
  ['agents', 'agents'],
  ['temp', 'temp'],
];

for (const [view, file] of shots) {
  await ev(`goView('${view}')`);
  await sleep(1300);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, file + '.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  ✓', file + '.png');
}

const dims = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).map((f) => {
  const b = fs.readFileSync(path.join(OUT, f));
  return `${f}: ${b.readUInt32BE(16)}x${b.readUInt32BE(20)} ${(b.length / 1024).toFixed(0)}KB`;
});
console.log('\n输出：\n  ' + dims.join('\n  '));
console.log('JS 错误：', errs.length ? errs : '无');
ws.close();
br.kill();
await sleep(800);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch { }
