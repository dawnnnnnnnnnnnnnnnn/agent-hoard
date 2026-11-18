/** 验收：一键清理页的图表与平台交互 */
const PORT = process.argv[2] || '9411';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('5178'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300) };
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');
await ev(`goView('clean')`);
for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('#pstack .pstack-row')`)) break; await sleep(400); }
await sleep(700);

const snap = () => ev(`(() => ({
  donutSegs: document.querySelectorAll('#pdonut [data-plat]').length,
  legend: [...document.querySelectorAll('#plegend [data-plat]')].map(e=>e.textContent.trim()),
  stackRows: [...document.querySelectorAll('#pstack .pstack-row')].map(r => ({
    plat: r.querySelector('.pn').textContent.trim(),
    num: r.querySelector('.pstack-num').textContent.trim(),
    segs: r.querySelectorAll('.pstack-seg').length,
    on: r.classList.contains('on')
  })),
  tiers: [...document.querySelectorAll('#tiers .tier')].map(t => t.querySelector('.tv').textContent.trim() + ' / ' + t.querySelector('.tc2').textContent.trim()),
  planCount: document.querySelector('#plan-count').textContent,
  planRows: document.querySelectorAll('#t-plan tr').length,
  activeChips: [...document.querySelectorAll('#plan-filters .chip.on, #plan-filters .fchip')].map(c=>c.textContent.trim())
}))()`);

console.log('初始：', JSON.stringify(await snap(), null, 1));

// 1. 点 DSH 甜甜圈扇区
await ev(`document.querySelector('#pdonut [data-plat="dsh"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await sleep(500);
let s = await snap();
console.log('\n点 DSH 扇区 →', JSON.stringify({ tiers: s.tiers, planCount: s.planCount, active: s.activeChips, dshRowOn: s.stackRows.find(r=>r.plat==='DSH')?.on }));

// 2. 点 Codex 的"低风险"色块
await ev(`(() => { const seg = document.querySelector('#pstack .pstack-seg[data-plat="codex"][data-risk="low"]'); seg.dispatchEvent(new MouseEvent('click',{bubbles:true})); })()`);
await sleep(500);
s = await snap();
console.log('点 Codex·低风险 →', JSON.stringify({ tiers: s.tiers, planCount: s.planCount, active: s.activeChips }));

// 3. 明细表里是否都是 codex
const platCheck = await ev(`[...new Set([...document.querySelectorAll('#t-plan tr')].map(r => r.children[2]?.textContent.trim()))]`);
console.log('明细表平台列取值：', JSON.stringify(platCheck));

// 4. 点同一块取消
await ev(`(() => { const seg = document.querySelector('#pstack .pstack-seg[data-plat="codex"][data-risk="low"]'); seg.dispatchEvent(new MouseEvent('click',{bubbles:true})); })()`);
await sleep(500);
s = await snap();
console.log('再点同一块（取消）→', JSON.stringify({ tiers: s.tiers[1], planCount: s.planCount, active: s.activeChips }));

// 5. 点风险 chip 筛选
await ev(`document.querySelector('[data-pf="medium"]').click()`);
await sleep(500);
s = await snap();
console.log('点「需确认」chip →', JSON.stringify({ planCount: s.planCount, active: s.activeChips }));
const riskCheck = await ev(`[...new Set([...document.querySelectorAll('#t-plan tr')].map(r => r.children[3]?.textContent.trim()))]`);
console.log('明细表类型列取值：', JSON.stringify(riskCheck));

// 6. 清除筛选
await ev(`document.querySelector('#clear-filter').click()`);
await sleep(500);
s = await snap();
console.log('清除筛选 →', JSON.stringify({ planCount: s.planCount, active: s.activeChips }));

// 7. 平台作用域下的清理按钮文案（不真的点）
await ev(`document.querySelector('#pstack .pstack-row .pn[data-plat="claude"]').click()`);
await sleep(500);
const btnText = await ev(`[...document.querySelectorAll('#tiers .tier')].map(t=>({ v:t.querySelector('.tv').textContent.trim(), c:t.querySelector('.tc2').textContent.trim(), b:t.querySelector('button').textContent.trim() }))`);
console.log('只看 Claude →', JSON.stringify(btnText, null, 1));
await ev(`document.querySelector('#clear-filter').click()`);
await sleep(400);

// 布局检查
const layout = await ev(`(() => {
  const out = {};
  out.overflowX = document.querySelector('.main').scrollWidth - document.querySelector('.main').clientWidth;
  const stack = [...document.querySelectorAll('#pstack .pstack-row')];
  out.rowsSameWidth = new Set(stack.map(r => Math.round(r.getBoundingClientRect().width))).size;
  out.donutVisible = document.querySelector('#pdonut').getBoundingClientRect().width > 100;
  // 堆叠条总宽是否超出轨道
  out.segOverflow = [...document.querySelectorAll('.pstack-track')].map(t => t.scrollWidth - t.clientWidth);
  return out;
})()`);
console.log('\n布局：', JSON.stringify(layout));
console.log('JS 错误：', errs.length ? JSON.stringify(errs, null, 1) : '无');
ws.close();
