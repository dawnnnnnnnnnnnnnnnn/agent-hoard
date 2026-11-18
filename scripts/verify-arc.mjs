/** 切页瞬间抓甜甜圈动画，确认它真的从 0 画出来 */
const PORT = process.argv[2] || '9444';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('5178'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const probe = await ev(`(async () => {
  goView('clean');
  await new Promise(r => setTimeout(r, 400));
  goView('overview');
  // 切页后立刻采样
  const samples = [];
  const p = document.querySelector('#donut path');
  for (let i = 0; i < 5; i++) {
    samples.push({
      t: i * 80,
      dash: getComputedStyle(p).strokeDashoffset,
      state: p.getAnimations().map(a => a.playState).join(',') || 'none',
    });
    await new Promise(r => setTimeout(r, 80));
  }
  return samples;
})()`);
console.log('切到总览后的弧线采样（应看到 dashoffset 从 1 递减到 0）：');
for (const s of probe) console.log(`  +${String(s.t).padStart(3)}ms  dashoffset=${s.dash.padEnd(8)} state=${s.state}`);
ws.close();
