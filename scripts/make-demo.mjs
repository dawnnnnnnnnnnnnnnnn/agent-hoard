/**
 * 生成一套脱敏的演示扫描结果，用于截图与文档。
 * 输出到 demo/data/scan.json，启动时用 SM_DATA_DIR 指向它即可。
 *
 *   node scripts/make-demo.mjs
 *   SM_DATA_DIR=demo/data node server.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'demo', 'data');
fs.mkdirSync(OUT, { recursive: true });

const GB = 1024 ** 3, MB = 1024 ** 2;
const now = Date.now();
const day = 864e5;

// 一套假但合理的目录结构：路径全部脱敏
const ROOTS = [
  { id: 'dsh:home', label: 'DeepSeek Harness', path: 'C:\\Users\\demo\\.dsh', platform: 'dsh' },
  { id: 'dsh:data', label: 'DeepSeek Harness', path: 'D:\\ai-data\\dsh-data', platform: 'dsh' },
  { id: 'dsh:plugins', label: 'DeepSeek Harness', path: 'D:\\ai-data\\DSH-Plugins', platform: 'dsh' },
  { id: 'dsh:work', label: 'DeepSeek Harness', path: 'D:\\work', platform: 'dsh' },
  { id: 'codex:home', label: 'Codex CLI', path: 'C:\\Users\\demo\\.codex', platform: 'codex' },
  { id: 'claude:home', label: 'Claude Code', path: 'C:\\Users\\demo\\.claude', platform: 'claude' },
  { id: 'cursor:home', label: 'Cursor', path: 'C:\\Users\\demo\\AppData\\Roaming\\Cursor', platform: 'cursor' },
  { id: 'wb:home', label: 'WorkBuddy', path: 'D:\\workbuddy', platform: 'workbuddy' },
  { id: 'system:temp', label: '系统临时文件', path: 'C:\\Users\\demo\\AppData\\Local\\Temp', platform: 'system' },
];

const AGENTS = [
  { id: 'dsh', name: 'DeepSeek Harness', short: 'DSH', color: '#FF5A36' },
  { id: 'codex', name: 'Codex CLI', short: 'Codex', color: '#5B8DEF' },
  { id: 'claude', name: 'Claude Code', short: 'Claude', color: '#B08BC9' },
  { id: 'cursor', name: 'Cursor', short: 'Cursor', color: '#3FA98A' },
  { id: 'workbuddy', name: 'WorkBuddy', short: 'WorkBuddy', color: '#D9A05B' },
  { id: 'system', name: '系统临时文件', short: '系统临时', color: '#8B94A4' },
];

// dirs: [rootId, 相对路径, 大小, 文件数, 天数前, kind, risk, 深度]
const DIRS = [
  ['dsh:plugins', '', 8.4 * GB, 12043, 3, null, null, 0],
  ['dsh:plugins', 'ComfyUI/models', 6.1 * GB, 42, 5, null, null, 2],
  ['dsh:plugins', 'ComfyUI/models/diffusion_models', 4.2 * GB, 6, 5, null, null, 3],
  ['dsh:plugins', 'ComfyUI/python_embeded', 1.9 * GB, 9871, 8, null, null, 2],
  ['dsh:data', '', 2.7 * GB, 8412, 1, null, null, 0],
  ['dsh:data', 'attachments', 1.2 * GB, 3021, 2, null, null, 1],
  ['dsh:data', 'sessions', 780 * MB, 412, 1, null, null, 1],
  ['dsh:home', '', 1.9 * GB, 15220, 1, null, null, 0],
  ['dsh:home', 'profiles', 540 * MB, 4210, 1, null, null, 1],
  ['dsh:home', 'cache', 210 * MB, 940, 4, 'cache', 'low', 1],
  ['dsh:home', 'tmp', 96 * MB, 33, 12, 'tmp', 'low', 1],
  ['dsh:work', '', 3.4 * GB, 51200, 1, null, null, 0],
  ['dsh:work', 'project-a/node_modules', 820 * MB, 18240, 6, 'cache', 'low', 2],
  ['dsh:work', 'project-b/node_modules', 410 * MB, 9210, 20, 'cache', 'low', 2],
  ['dsh:work', 'project-b/__pycache__', 34 * MB, 210, 30, 'cache', 'low', 2],
  ['dsh:work', 'scratch', 128 * MB, 61, 9, 'tmp', 'low', 1],
  ['codex:home', '', 486 * MB, 3120, 1, null, null, 0],
  ['codex:home', 'sessions', 240 * MB, 1204, 2, null, null, 1],
  ['codex:home', '.tmp', 88 * MB, 640, 7, 'tmp', 'low', 1],
  ['claude:home', '', 214 * MB, 980, 1, null, null, 0],
  ['claude:home', 'projects', 168 * MB, 620, 3, null, null, 1],
  ['cursor:home', '', 940 * MB, 7420, 1, null, null, 0],
  ['cursor:home', 'Cache', 320 * MB, 4210, 2, 'cache', 'low', 1],
  ['cursor:home', 'CachedData', 240 * MB, 1820, 5, 'cache', 'low', 1],
  ['wb:home', '', 1.6 * GB, 22400, 1, null, null, 0],
  ['wb:home', 'node_modules', 720 * MB, 15800, 12, 'cache', 'low', 1],
  ['system:temp', '', 1.3 * GB, 2840, 1, null, null, 0],
  ['system:temp', 'vscode-stable-user-x64', 260 * MB, 820, 3, 'tmp', 'low', 1],
  ['system:temp', 'de.fabmax.physx-jni', 210 * MB, 44, 9, 'tmp', 'low', 1],
];

// bigFiles: [rootId, 相对路径, 大小, 天数前, kind, risk]
const FILES = [
  ['dsh:plugins', 'ComfyUI/models/diffusion_models/qwen_image_2.1_int8.safetensors', 3.8 * GB, 5, null, null],
  ['dsh:plugins', 'ComfyUI/models/text_encoders/qwen3vl_8b.safetensors', 2.9 * GB, 5, null, null],
  ['dsh:plugins', 'ComfyUI/models/diffusion_models/anima-base-v1.0.safetensors', 1.9 * GB, 12, null, null],
  ['dsh:plugins', 'ComfyUI_windows_portable.7z', 1.2 * GB, 14, 'installer', 'medium'],
  ['dsh:work', 'project-a/dist/bundle.map', 84 * MB, 22, 'installer', 'medium'],
  ['dsh:work', 'logs/build.log', 46 * MB, 31, 'log', 'safe'],
  ['dsh:work', 'backup-before-refactor.bak', 38 * MB, 40, 'backup', 'medium'],
  ['codex:home', 'logs_2.sqlite', 22 * MB, 1, null, null],
  ['claude:home', 'history.jsonl', 14 * MB, 2, null, null],
  ['system:temp', 'setup-2026.tmp', 96 * MB, 6, 'tmp-file', 'safe'],
  ['system:temp', 'crashes/app.dmp', 52 * MB, 11, 'log', 'safe'],
  ['cursor:home', 'logs/cursor.log', 28 * MB, 4, 'log', 'safe'],
];

const SCRATCH = [
  ['dsh:work', 'scratch/convert.py', 14 * 1024, 3],
  ['dsh:work', 'scratch/analyze.py', 9 * 1024, 5],
  ['dsh:work', 'scratch/notes.md', 6 * 1024, 8],
  ['dsh:work', 'tmp_report.md', 22 * 1024, 12],
  ['codex:home', 'tmp/patch.ps1', 3 * 1024, 2],
];

const catOf = (n) => {
  const e = path.extname(n).toLowerCase();
  if (['.safetensors', '.pt', '.bin'].includes(e)) return 'model';
  if (['.7z', '.zip', '.whl', '.map'].includes(e)) return 'installer';
  if (['.log', '.dmp'].includes(e)) return 'log';
  if (['.jsonl', '.zstd'].includes(e)) return 'session';
  if (['.sqlite', '.db', '.json'].includes(e)) return 'data';
  if (['.py', '.md', '.ps1'].includes(e)) return 'code';
  return 'other';
};

const rootById = Object.fromEntries(ROOTS.map((r) => [r.id, r]));
const dirs = DIRS.map(([rid, rel, s, f, days, kind, risk, depth]) => ({
  p: rel, s: Math.round(s), f, t: now - days * day,
  c: null, plt: rootById[rid].platform, root: rid, d: depth,
  j: kind, r: risk, link: null,
}));

const bigFiles = FILES.map(([rid, rel, s, days, kind, risk]) => ({
  p: path.join(rootById[rid].path, rel), rel, s: Math.round(s), t: now - days * day,
  cat: catOf(rel), plt: rootById[rid].platform, root: rid, junk: kind, risk,
}));

const scratch = SCRATCH.map(([rid, rel, s, days]) => ({
  p: path.join(rootById[rid].path, rel), rel, s, t: now - days * day,
  plt: rootById[rid].platform, root: rid,
}));

// 汇总
const catTotal = {}, platTotal = {}, rootTotal = {};
for (const d of dirs) {
  platTotal[d.plt] = (platTotal[d.plt] || 0) + d.s;
  rootTotal[d.root] = (rootTotal[d.root] || 0) + d.s;
}
for (const f of bigFiles) {
  platTotal[f.plt] = (platTotal[f.plt] || 0) + f.s;
  rootTotal[f.root] = (rootTotal[f.root] || 0) + f.s;
  catTotal[f.cat] = (catTotal[f.cat] || 0) + f.s;
}
// 目录按平台/类型分摊，让总览的环形图有内容
for (const d of dirs) {
  const k = d.p.includes('models') ? 'model'
    : d.p.includes('node_modules') || d.p.includes('Cache') || d.p.includes('__pycache__') ? 'cache'
    : d.p.includes('sessions') ? 'session'
    : d.p.includes('attachments') ? 'media'
    : 'other';
  catTotal[k] = (catTotal[k] || 0) + d.s;
}

const total = Object.values(rootTotal).reduce((a, b) => a + b, 0);
const fileCount = dirs.reduce((a, d) => a + d.f, 0);

const data = {
  scannedAt: now,
  tookMs: 74200,
  rootsSig: 'demo',
  total, fileCount,
  roots: ROOTS.map((r) => ({ ...r, size: rootTotal[r.id] || 0 })),
  agents: AGENTS.map((a) => ({
    ...a, present: true,
    paths: ROOTS.filter((r) => r.platform === a.id).map((r) => r.path),
    size: platTotal[a.id] || 0,
    rootCount: ROOTS.filter((r) => r.platform === a.id).length,
  })),
  catTotal, platTotal, junkTotal: {}, riskTotal: {},
  cats: {},
  kinds: {},
  risks: {},
  topExt: Object.entries({ '.safetensors': 8.6 * GB, '.7z': 1.2 * GB, '.log': 74 * MB })
    .map(([e, s]) => ({ e, s: Math.round(s) })),
  dirs, bigFiles, scratch,
};

// 风险汇总（用和线上一致的压缩逻辑估算）
const riskTotal = { safe: 0, low: 0, medium: 0 };
const junkTotal = {};
for (const d of dirs) if (d.r) { riskTotal[d.r] += d.s; junkTotal[d.j] = (junkTotal[d.j] || 0) + d.s; }
for (const f of bigFiles) if (f.risk) { riskTotal[f.risk] += f.s; junkTotal[f.junk] = (junkTotal[f.junk] || 0) + f.s; }
data.riskTotal = riskTotal;
data.junkTotal = junkTotal;

fs.writeFileSync(path.join(OUT, 'scan.json'), JSON.stringify(data), 'utf8');
console.log(`演示数据已写入 ${path.join(OUT, 'scan.json')}`);
console.log(`  ${(total / GB).toFixed(1)} GB · ${fileCount.toLocaleString()} 文件 · ${dirs.length} 目录 · ${bigFiles.length} 大文件`);
console.log(`  风险：安全 ${(riskTotal.safe / MB).toFixed(0)} MB / 低 ${(riskTotal.low / MB).toFixed(0)} MB / 中 ${(riskTotal.medium / MB).toFixed(0)} MB`);
