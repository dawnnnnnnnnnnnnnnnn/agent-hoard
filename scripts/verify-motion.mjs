/** 动效与视觉验收：动画是否真的跑、token 是否生效、减少动效是否退化、是否卡顿 */
const PORT = process.argv[2] || '9441';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('5178'));
if (!page) { console.log('no target'); process.exit(1); }
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
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300) };
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');
for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('#tiers .tier')`)) break; await sleep(400); }
await sleep(900);

// 1. token 是否真的存在
const tokens = await ev(`(() => {
  const cs = getComputedStyle(document.documentElement);
  const pick = ['--ease-out','--ease-spring','--t-base','--t-slow','--r-lg','--sh-2'];
  const o = {};
  for (const k of pick) o[k] = cs.getPropertyValue(k).trim();
  return o;
})()`);
console.log('设计 token：', JSON.stringify(tokens));

// 2. 甜甜圈弧线动画（#donut 在总览页，必须先切过去）
await ev(`goView('overview')`);
await sleep(120);
const donutEarly = await ev(`(() => {
  const p = document.querySelector('#donut path');
  if (!p) return null;
  const a = p.getAnimations().map(x=>({name:x.animationName,state:x.playState,dur:x.effect?.getTiming().duration}));
  return { dashoffset: getComputedStyle(p).strokeDashoffset, anims: a, pathLength: p.getAttribute('pathLength') };
})()`);
await sleep(1400);
const donutLate = await ev(`(() => {
  const p = document.querySelector('#donut path');
  return p ? { dashoffset: getComputedStyle(p).strokeDashoffset, anims: p.getAnimations().length } : null;
})()`);
console.log('甜甜圈 早期:', JSON.stringify(donutEarly), '→ 结束:', JSON.stringify(donutLate));
await ev(`goView('clean')`);
await sleep(400);

// 3. 三档卡片入场 + 数字滚动
const tierAnim = await ev(`(() => {
  const t = document.querySelector('#tiers .tier');
  const tv = t.querySelector('.tv');
  const cs = getComputedStyle(t);
  return {
    classes: t.className,
    delay: cs.animationDelay,
    duration: cs.animationDuration,
    numText: tv.textContent,
    numData: tv.dataset.num,
    hasAnim: t.getAnimations().length > 0,
    barBefore: getComputedStyle(t, '::before').animationName
  };
})()`);
console.log('三档卡片：', JSON.stringify(tierAnim));

// 数字是否滚到目标值
await sleep(900);
const numFinal = await ev(`(() => {
  const tv = document.querySelector('#tiers .tier .tv');
  return { text: tv.textContent, target: tv.dataset.num, match: tv.textContent === fmt(Number(tv.dataset.num)) };
})()`);
console.log('数字滚动结果：', JSON.stringify(numFinal));

// 4. KPI 数字滚动
const kpi = await ev(`(() => ({
  text: document.querySelector('#k-total').textContent,
  target: document.querySelector('#k-total').dataset.num
}))()`);
console.log('KPI：', JSON.stringify(kpi));

// 5. 条形图用 scaleX 而不是 width
const bar = await ev(`(() => {
  const f = document.querySelector('#bars .fill');
  if (!f) return null;
  const cs = getComputedStyle(f);
  return { animationName: cs.animationName, width: cs.width, varW: f.style.getPropertyValue('--w'), i: f.style.getPropertyValue('--i') };
})()`);
console.log('条形图：', JSON.stringify(bar));

// 6. 行入场（只前 22 行）
const rows = await ev(`(() => {
  goView('dirs');
  return null;
})()`);
await sleep(700);
const rowAnim = await ev(`(() => {
  const trs = [...document.querySelectorAll('#t-dirs tr[data-i]')];
  const withAnim = trs.filter(t => t.classList.contains('rowin')).length;
  return { total: trs.length, withAnim, firstDelay: getComputedStyle(trs[0]).animationDelay };
})()`);
console.log('表格行入场：', JSON.stringify(rowAnim));

// 7. selbar 滑入
await ev(`(() => { const r = document.querySelector('#t-dirs tr[data-i]'); r.click(); })()`);
await sleep(400);
const barAnim = await ev(`(() => {
  const b = document.querySelector('#selbar');
  const cs = getComputedStyle(b);
  return { on: b.classList.contains('on'), transform: cs.transform, opacity: cs.opacity,
           transition: cs.transitionProperty, pointer: cs.pointerEvents };
})()`);
console.log('选择条：', JSON.stringify(barAnim));
await ev(`document.querySelector('#sel-clear').click()`);

// 8. 减少动效模式退化
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await ev(`location.reload()`);
await sleep(3500);
for (let i = 0; i < 40; i++) { if (await ev(`!!document.querySelector('#tiers .tier')`)) break; await sleep(400); }
await sleep(600);
const reduced = await ev(`(() => {
  const t = document.querySelector('#tiers .tier');
  const p = document.querySelector('#donut path');
  const f = document.querySelector('#bars .fill');
  return {
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    tierOpacity: getComputedStyle(t).opacity,
    tierTransform: getComputedStyle(t).transform,
    tierAnimDur: getComputedStyle(t).animationDuration,
    donutDash: p ? getComputedStyle(p).strokeDashoffset : null,
    barTransform: f ? getComputedStyle(f).transform : null,
    // 关键：内容必须可见，不能因为动画被跳过而空白
    tiersVisible: document.querySelectorAll('#tiers .tier').length,
    donutPaths: document.querySelectorAll('#donut path').length
  };
})()`);
console.log('\n减少动效模式：', JSON.stringify(reduced, null, 1));

console.log('\nJS 错误：', errs.length ? JSON.stringify(errs, null, 1) : '无');
ws.close();
