/** 首屏引导 + 扫描进度 UI 验收 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.argv[2] || '5178';
const CDP = process.argv[3] || '9501';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = path.join(os.tmpdir(), 'edge-gate');
fs.rmSync(prof, { recursive: true, force: true });

const br = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${prof}`, '--window-size=1600,1000', `http://127.0.0.1:${PORT}/#clean`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(5000);

const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes(String(PORT)));
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
await sleep(1500);

const gateState = () => ev(`(() => {
  const g = document.querySelector('#gate');
  return {
    hidden: g.hidden,
    title: document.querySelector('#gate-title').textContent.trim(),
    desc: document.querySelector('#gate-desc').textContent.trim().slice(0, 50),
    btnText: document.querySelector('#gate-btn').textContent.trim(),
    btnVisible: !document.querySelector('#gate-actions').hidden,
    progVisible: !document.querySelector('#gate-prog').hidden,
    pct: document.querySelector('#gate-pct').textContent.trim(),
    cur: document.querySelector('#gate-cur').textContent.trim(),
  };
})()`);

console.log('① 首屏（无缓存）：', JSON.stringify(await gateState()));

// 点开始扫描
await ev(`document.querySelector('#gate-btn').click()`);
await sleep(1800);
console.log('② 点击后 1.8s：', JSON.stringify(await gateState()));

const samples = [];
for (let i = 0; i < 8; i++) {
  await sleep(2500);
  const s = await gateState();
  samples.push({ pct: s.pct, progVisible: s.progVisible, cur: s.cur.slice(0, 40) });
  if (s.hidden) break;
}
console.log('③ 进度采样：');
for (const s of samples) console.log('   ', JSON.stringify(s));

const final = await gateState();
console.log('④ 结束状态：', JSON.stringify({ hidden: final.hidden, title: final.title }));

// 数据是否已渲染
const data = await ev(`(() => ({
  topPills: document.querySelectorAll('#tp-agents .pill').length,
  brandSub: document.querySelector('.brand span').textContent,
  tiers: [...document.querySelectorAll('#tiers .tier .tv')].map(e => e.textContent),
  planRows: document.querySelectorAll('#t-plan tr').length,
  scanMeta: document.querySelector('#scan-meta').textContent,
}))()`);
console.log('⑤ 渲染结果：', JSON.stringify(data));
console.log('JS 错误：', errs.length ? errs : '无');

ws.close();
br.kill();
await sleep(500);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch { }
