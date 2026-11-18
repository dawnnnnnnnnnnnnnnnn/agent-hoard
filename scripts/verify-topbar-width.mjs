/** 不同窗口宽度下顶栏是否溢出 */
const PORT = process.argv[2] || '9462';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('5178'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');
await sleep(2000);

const probe = () => ev(`(() => {
  const wrap = document.querySelector('#tp-agents');
  const pills = [...wrap.querySelectorAll('.pill')];
  const top = document.querySelector('.top');
  const last = pills[pills.length - 1];
  return {
    width: window.innerWidth,
    pillCount: pills.length,
    shownAgents: pills.filter(p => !p.classList.contains('more')).length,
    hasMore: !!wrap.querySelector('.pill.more'),
    clipped: wrap.scrollWidth > wrap.clientWidth + 1,
    topOverflow: top.scrollWidth - top.clientWidth,
    lastVisible: last ? last.getBoundingClientRect().right <= wrap.getBoundingClientRect().right + 1 : true
  };
})()`);

for (const w of [1680, 1440, 1280, 1100, 980]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(450);
  console.log(JSON.stringify(await probe()));
}
await send('Emulation.clearDeviceMetricsOverride');
ws.close();
