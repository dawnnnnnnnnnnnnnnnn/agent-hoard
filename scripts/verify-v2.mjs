/** CDP 验收：多选 / 一键清理 / 临时文件 */
const PORT = process.argv[2] || '9401';
const BASE = `http://127.0.0.1:${PORT}`;
const list = await (await fetch(BASE + '/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('5178'));
if (!page) { console.log('no target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300) };
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');
await send('Page.enable');

for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('#tiers .tier')`)) break; await sleep(400); }
await sleep(600);

const out = {};
out.tiers = await ev(`[...document.querySelectorAll('#tiers .tier')].map(t => ({
  label: t.querySelector('.th').textContent.trim(),
  size: t.querySelector('.tv').textContent.trim(),
  count: t.querySelector('.tc2').textContent.trim(),
  btn: t.querySelector('button')?.textContent.trim(),
  disabled: t.querySelector('button')?.disabled
}))`);
out.planRows = await ev(`document.querySelectorAll('#t-plan tr').length`);
out.planCount = await ev(`document.querySelector('#plan-count').textContent`);
console.log('三档：', JSON.stringify(out.tiers, null, 0));
console.log('明细：', out.planCount, '行数', out.planRows);

// ── 临时文件页
await ev(`goView('temp')`);
await sleep(700);
out.tempNote = await ev(`document.querySelector('#temp-note').textContent.replace(/\\s+/g,' ').slice(0,180)`);
out.tempRows = await ev(`document.querySelectorAll('#t-temp tr[data-i]').length`);
console.log('临时文件：', out.tempRows, '行 |', out.tempNote);

// 点第 1 行、Shift 点第 8 行
await ev(`(() => {
  const rows = [...document.querySelectorAll('#t-temp tr[data-i]')];
  rows[0].click();
  rows[7].dispatchEvent(new MouseEvent('click', {bubbles:true, shiftKey:true}));
})()`);
await sleep(400);
out.tempSel = await ev(`({ bar: document.querySelector('#selbar').className, text: document.querySelector('#sel-text').textContent.trim(), selClass: document.querySelectorAll('#t-temp tr.sel').length })`);
console.log('临时文件多选：', JSON.stringify(out.tempSel));

// 清空再测「全选」
await ev(`document.querySelector('#temp-clear').click()`);
await sleep(200);
await ev(`document.querySelector('#temp-all').click()`);
await sleep(300);
out.tempAll = await ev(`({ text: document.querySelector('#sel-text').textContent.trim(), selClass: document.querySelectorAll('#t-temp tr.sel').length })`);
console.log('临时文件全选：', JSON.stringify(out.tempAll));
await ev(`document.querySelector('#temp-clear').click()`);
await sleep(200);

// ── 目录页多选（快速路径）
await ev(`goView('dirs')`);
await sleep(600);
out.dirRows = await ev(`document.querySelectorAll('#t-dirs tr[data-i]').length`);
await ev(`(() => { const r=[...document.querySelectorAll('#t-dirs tr[data-i]')]; r[2].click(); r[9].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true})); })()`);
await sleep(400);
out.dirSel = await ev(`({ text: document.querySelector('#sel-text').textContent.trim(), selClass: document.querySelectorAll('#t-dirs tr.sel').length, head: document.querySelector('#all-dirs').indeterminate })`);
console.log('目录 Shift 连选：', out.dirRows, '行 →', JSON.stringify(out.dirSel));

// 表头全选
await ev(`document.querySelector('#all-dirs').click()`);
await sleep(500);
out.dirAll = await ev(`({ text: document.querySelector('#sel-text').textContent.trim(), head: document.querySelector('#all-dirs').checked, selClass: document.querySelectorAll('#t-dirs tr.sel').length })`);
console.log('目录表头全选：', JSON.stringify(out.dirAll));
await ev(`document.querySelector('#all-dirs').click()`);
await sleep(400);
out.dirNone = await ev(`({ text: document.querySelector('#sel-text').textContent.trim(), head: document.querySelector('#all-dirs').checked, selClass: document.querySelectorAll('#t-dirs tr.sel').length })`);
console.log('再点取消：', JSON.stringify(out.dirNone));

// 快选按钮
await ev(`document.querySelector('[data-bulk="big1"]').click()`);
await sleep(400);
out.bulk1 = await ev(`document.querySelector('#sel-text').textContent.trim()`);
console.log('选 >1GB：', out.bulk1);
await ev(`document.querySelector('#sel-clear').click()`);
await sleep(300);

// ── 会话页
await ev(`goView('sessions')`);
await sleep(700);
await ev(`(() => { const r=[...document.querySelectorAll('#t-sessions tr[data-i]')]; r[0].click(); r[3].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true})); })()`);
await sleep(400);
out.sessSel = await ev(`({ text: document.querySelector('#sel-text').textContent.trim(), selClass: document.querySelectorAll('#t-sessions tr.sel').length, arch: document.querySelector('#sel-arch').style.display })`);
console.log('会话多选：', JSON.stringify(out.sessSel));

// 截图
await ev(`goView('clean')`);
await sleep(800);
let shot = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('node:fs');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'ui-clean2.png'), Buffer.from(shot.result.data, 'base64'));
await ev(`goView('temp')`);
await sleep(600);
shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(OUT, 'ui-temp.png'), Buffer.from(shot.result.data, 'base64'));

console.log('页面错误：', errs.length ? JSON.stringify(errs, null, 1) : '无');
ws.close();
