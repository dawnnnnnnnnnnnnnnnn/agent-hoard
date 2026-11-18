/** 顶栏 agent 条验收 */
const PORT = process.argv[2] || '9461';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('5178'));
if (!page) { console.log('no target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300) };
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');
for (let i = 0; i < 60; i++) { if (await ev(`document.querySelectorAll('#tp-agents .pill').length > 1`)) break; await sleep(400); }
await sleep(800);

const snap = async () => ev(`(() => {
  const pills = [...document.querySelectorAll('#tp-agents .pill')];
  const wrap = document.querySelector('#tp-agents');
  return {
    count: pills.length,
    pills: pills.map(p => ({ text: p.textContent.trim().replace(/\\s+/g,' '), isMore: p.classList.contains('more'), on: p.classList.contains('on'), title: (p.title||'').split('\\n')[0] })),
    wrapTitle: (wrap.title || '').split('\\n')[0],
    overflow: wrap.scrollWidth - wrap.clientWidth,
    topBarOverflow: (() => { const t = document.querySelector('.top'); return t.scrollWidth - t.clientWidth; })()
  };
})()`);

console.log('初始：', JSON.stringify(await snap(), null, 1));

// 点 WorkBuddy 药丸
const clickWB = await ev(`(async () => {
  const p = [...document.querySelectorAll('#tp-agents .pill')].find(x => x.textContent.includes('WorkBuddy'));
  if (!p) return '顶栏没有 WorkBuddy';
  p.click();
  await new Promise(r => setTimeout(r, 600));
  return { view: document.querySelector('.view.on')?.id, chip: [...document.querySelectorAll('#plt-chips .chip.on')].map(x=>x.textContent.trim()), rows: document.querySelectorAll('#t-dirs tr[data-i]').length };
})()`);
console.log('\n点 WorkBuddy 药丸 →', JSON.stringify(clickWB));
console.log('点后顶栏：', JSON.stringify(await snap(), null, 1));

// 再点一次取消
const clickAgain = await ev(`(async () => {
  const p = [...document.querySelectorAll('#tp-agents .pill')].find(x => x.textContent.includes('WorkBuddy'));
  p.click();
  await new Promise(r => setTimeout(r, 500));
  return { view: document.querySelector('.view.on')?.id, chip: [...document.querySelectorAll('#plt-chips .chip.on')].map(x=>x.textContent.trim()) };
})()`);
console.log('\n再点一次 →', JSON.stringify(clickAgain));

// +N 是否可点
const more = await ev(`(async () => {
  const m = document.querySelector('#tp-agents .pill.more');
  if (!m) return '没有 +N（说明全显示了）';
  m.click();
  await new Promise(r => setTimeout(r, 500));
  return { view: document.querySelector('.view.on')?.id, cards: document.querySelectorAll('.acard').length };
})()`);
console.log('\n点 +N →', JSON.stringify(more));

console.log('\nJS 错误：', errs.length ? JSON.stringify(errs) : '无');
ws.close();
