/** 验收：Agents 页 + Worktree 页 + 平台 chip 动态化 */
const PORT = process.argv[2] || '9421';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('5178'));
if (!page) { console.log('no target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 240));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300) };
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');

for (let i = 0; i < 80; i++) { if (await ev(`!!document.querySelector('#agent-grid .acard')`)) break; await sleep(400); }
await sleep(1200);

// 1. Agents 页
await ev(`goView('agents')`);
await sleep(600);
const ag = await ev(`(() => ({
  note: document.querySelector('#agents-note').textContent.replace(/\\s+/g,' ').trim().slice(0,160),
  cards: [...document.querySelectorAll('.acard')].slice(0,8).map(c=>({
    name: c.querySelector('.ah').textContent.trim(),
    size: c.querySelector('.av').textContent.trim(),
    off: c.classList.contains('off')
  })),
  total: document.querySelectorAll('.acard').length,
  sideCount: document.querySelector('#c-agents').textContent
}))()`);
console.log('Agents 页：', JSON.stringify(ag, null, 1));

// 点 WorkBuddy 卡片 → 应跳目录页并筛选
const clicked = await ev(`(async () => {
  const c = [...document.querySelectorAll('.acard')].find(x=>x.querySelector('.ah').textContent.includes('WorkBuddy'));
  if(!c) return '未找到工作台卡片';
  c.click();
  await new Promise(r=>setTimeout(r,500));
  return {
    view: document.querySelector('.view.on')?.id,
    activeChip: [...document.querySelectorAll('#plt-chips .chip.on')].map(x=>x.textContent.trim()),
    rows: document.querySelectorAll('#t-dirs tr[data-i]').length,
    firstRows: [...document.querySelectorAll('#t-dirs tr[data-i]')].slice(0,2).map(r=>r.querySelector('.root')?.textContent.trim())
  };
})()`);
console.log('\n点 WorkBuddy 卡片 →', JSON.stringify(clicked));

// 2. 平台 chip 动态生成
const chips = await ev(`[...document.querySelectorAll('#plt-chips .chip')].map(c=>c.textContent.trim())`);
console.log('动态平台 chip：', JSON.stringify(chips));

// 3. Worktree 页
await ev(`goView('worktrees')`);
await sleep(1500);
const wt = await ev(`(() => ({
  note: document.querySelector('#wt-note').textContent.replace(/\\s+/g,' ').trim().slice(0,200),
  rows: document.querySelectorAll('#t-wt tr').length,
  sideCount: document.querySelector('#c-wt').textContent,
  filters: [...document.querySelectorAll('[data-wv]')].map(c=>c.textContent.trim())
}))()`);
console.log('\nWorktree 页：', JSON.stringify(wt, null, 1));

// 4. 一键清理页：平台图是否包含新 agent
await ev(`goView('clean')`);
await sleep(800);
const pl = await ev(`(() => ({
  donutSegs: document.querySelectorAll('#pdonut [data-plat]').length,
  legend: [...document.querySelectorAll('#plegend [data-plat]')].map(e=>e.textContent.trim()),
  stack: [...document.querySelectorAll('#pstack .pstack-row')].map(r=>r.querySelector('.pn').textContent.trim()),
  chips: [...document.querySelectorAll('#plan-filters .chip')].map(c=>c.textContent.trim())
}))()`);
console.log('\n一键清理页：', JSON.stringify(pl, null, 1));

// 5. 布局
const layout = await ev(`(() => {
  const m = document.querySelector('.main');
  return {
    overflowX: m.scrollWidth - m.clientWidth,
    agentCards: document.querySelectorAll('.acard').length,
    agridCols: getComputedStyle(document.querySelector('#agent-grid')).gridTemplateColumns.split(' ').length
  };
})()`);
console.log('\n布局：', JSON.stringify(layout));
console.log('JS 错误：', errs.length ? JSON.stringify(errs, null, 1) : '无');
ws.close();
