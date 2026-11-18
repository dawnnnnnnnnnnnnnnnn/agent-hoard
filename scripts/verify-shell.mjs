/** 外壳视觉一致性审计：圆角/颜色/字号是否走 token，有没有漏改的硬编码 */
const PORT = process.argv[2] || '9445';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('5178'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
await new Promise((r) => setTimeout(r, 1800));

const audit = await ev(`(() => {
  const cs = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
  const out = {};
  // 外壳
  out.shell = {
    brandBg: cs('.brand','backgroundColor'),
    sideBorder: cs('.side','borderRightColor'),
    navActiveRadius: cs('.nav.on','borderRadius'),
    navActiveBg: cs('.nav.on','backgroundColor'),
    pillRadius: cs('.pill','borderRadius'),
  };
  // 组件圆角一致性
  const radii = {};
  for (const sel of ['.card','.tier','.acard','.kpi','.note','.junkcard','.drawer']) {
    const v = cs(sel,'borderRadius'); if (v) radii[sel] = v;
  }
  out.radii = radii;
  // 字号阶梯
  out.type = {
    h1: cs('.h1','fontSize'), sub: cs('.sub','fontSize'), cardTitle: cs('.card h3','fontSize'),
    body: cs('tbody td','fontSize'), num: cs('td.num','fontSize'), mono: cs('.kpi .v','fontFamily'),
  };
  // 是否有元素溢出视口
  const m = document.querySelector('.main');
  out.overflowX = m.scrollWidth - m.clientWidth;
  // 顶栏控件是否都可见
  out.topBar = ['.pill','.zoomctl','#btn-rescan'].map(s => {
    const e = document.querySelector(s); if (!e) return s + ':MISSING';
    const r = e.getBoundingClientRect();
    return s + ':' + (r.width > 20 ? 'ok' : 'zero');
  });
  // 侧栏
  out.side = (() => { const e = document.querySelector('.side'); return { w: Math.round(e.getBoundingClientRect().width), scrollH: e.scrollHeight, clientH: e.clientHeight }; })();
  // 主区左边距是否与侧栏对齐
  out.mainLeft = Math.round(document.querySelector('.main').getBoundingClientRect().left);
  out.selbarLeft = getComputedStyle(document.querySelector('#selbar')).left;
  out.drawerWidth = Math.round(document.querySelector('#drawer').getBoundingClientRect().width);
  return out;
})()`);
console.log(JSON.stringify(audit, null, 1));
ws.close();
