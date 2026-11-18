/** 品牌区最终验收：图标几何 + 副标题动态 + 不溢出 */
const PORT = process.argv[2] || '9471';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('5178'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 等首屏数据
for (let i = 0; i < 40; i++) { if (await ev(`document.querySelectorAll('#tp-agents .pill').length > 1`)) break; await sleep(400); }
await sleep(600);

const info = await ev(`(() => {
  const brand = document.querySelector('.brand');
  const mark = brand.querySelector('.mark');
  const b = brand.querySelector('b');
  const s = brand.querySelector('span');
  const circ = [...mark.querySelectorAll('circle')];
  const f = el => { const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); };
  return {
    markTag: mark.tagName,
    markSize: f(mark),
    circles: circ.map(c => ({ stroke: c.getAttribute('stroke'), dash: c.getAttribute('stroke-dasharray') })),
    title: b.textContent,
    subtitle: s.textContent,
    subtitleFits: s.scrollWidth <= s.clientWidth,
    titleFits: b.scrollWidth <= b.clientWidth,
    brandWidth: f(brand),
    hoverRule: getComputedStyle(mark).transitionProperty,
  };
})()`);
console.log(JSON.stringify(info, null, 1));

// 副标题应随扫描数据变化：检查是否包含 AGENTS 与总量
const ok = /^\d+ AGENTS · /.test(info.subtitle || '');
console.log('\n副标题是否动态:', ok ? '是 ✓' : '否 ✗');

const fs = await import('node:fs');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'data');
fs.mkdirSync(OUT, { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 430, height: 62, scale: 3 } });
fs.writeFileSync(path.join(OUT, 'brand.png'), Buffer.from(shot.result.data, 'base64'));
console.log('截图: data/brand.png');
console.log('JS 错误:', errs.length ? errs : '无');
ws.close();
