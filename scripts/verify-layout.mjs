/** DOM 布局验收：溢出、遮挡、可见性、字号 */
const PORT = process.argv[2] || '9403';
const BASE = `http://127.0.0.1:${PORT}`;
const list = await (await fetch(BASE + '/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('5178'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');
await sleep(2500);

const check = await ev(`(() => {
  const out = {};
  const vis = el => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  // 横向溢出
  out.bodyOverflowX = document.body.scrollWidth - document.body.clientWidth;
  out.mainOverflowX = (() => { const m = document.querySelector('.main'); return m.scrollWidth - m.clientWidth; })();
  // 三档卡片是否横排
  const tiers = [...document.querySelectorAll('#tiers .tier')];
  out.tierCount = tiers.length;
  out.tierTops = tiers.map(t => Math.round(t.getBoundingClientRect().top));
  out.tierSameRow = new Set(out.tierTops).size === 1;
  // 文字是否被裁
  const clipped = [];
  for (const el of document.querySelectorAll('.h1,.sub,.tier .th,.tier .tv,.tier .tc2,.tier .thint,.nav,.kpi .v,.card h3')) {
    if (!vis(el)) continue;
    if (el.scrollWidth > el.clientWidth + 2) clipped.push(el.className + ':' + el.textContent.trim().slice(0,30));
  }
  out.clipped = clipped.slice(0, 10);
  // 底部操作条不该挡住内容
  out.selbarVisible = vis(document.querySelector('#selbar'));
  out.mainPadBottom = getComputedStyle(document.querySelector('.main')).paddingBottom;
  // 字号抽查
  const fs = sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).fontSize : null; };
  out.fonts = { h1: fs('.h1'), sub: fs('.sub'), tierValue: fs('.tier .tv'), nav: fs('.nav'), td: fs('#t-plan td .pth'), btn: fs('.tier button') };
  // 表格行高
  const tr = document.querySelector('#t-plan tr');
  out.planRowH = tr ? Math.round(tr.getBoundingClientRect().height) : null;
  out.planRows = document.querySelectorAll('#t-plan tr').length;
  // 侧栏计数
  out.sideCounts = { dirs: document.querySelector('#c-dirs').textContent, files: document.querySelector('#c-files').textContent, temp: document.querySelector('#c-temp').textContent, sess: document.querySelector('#c-sess').textContent, trash: document.querySelector('#c-trash').textContent };
  // 页面纵向是否可滚
  const m = document.querySelector('.main');
  out.mainScrollable = m.scrollHeight > m.clientHeight;
  out.mainScrollH = m.scrollHeight;
  return out;
})()`);
console.log(JSON.stringify(check, null, 1));

// 各页面都切一遍，确认无报错
for (const v of ['temp','trash','overview','dirs','files','sessions','scratch','clean']) {
  await ev(`goView('${v}')`);
  await sleep(350);
  const ok = await ev(`(() => {
    const sec = document.querySelector('#v-${v}');
    const r = sec.getBoundingClientRect();
    const m = document.querySelector('.main');
    return { visible: r.height > 50, overflowX: m.scrollWidth - m.clientWidth, h: Math.round(r.height) };
  })()`);
  console.log(v.padEnd(9), JSON.stringify(ok));
}
console.log('JS 错误：', errs.length ? errs : '无');
ws.close();
