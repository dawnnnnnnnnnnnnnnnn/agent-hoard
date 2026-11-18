/**
 * Space Manager 核心逻辑 —— HTTP / MCP / CLI 三个入口共用
 * 零依赖，只用 Node 内置模块。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const HOME = os.homedir();
export const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
// 允许把运行数据放到别处：截图演示、隔离测试都用得上
export const DATA_DIR = process.env.SM_DATA_DIR ? path.resolve(process.env.SM_DATA_DIR) : path.join(ROOT, 'data');
export const TRASH_DIR = process.env.SM_TRASH_DIR ? path.resolve(process.env.SM_TRASH_DIR) : path.join(ROOT, '_trash');
export const CONFIG_PATH = process.env.SM_CONFIG ? path.resolve(process.env.SM_CONFIG) : path.join(ROOT, 'config.json');

// ─────────────────────────────────────────── 风险模型 ──

export const RISK = {
  safe: { id: 'safe', label: '无风险', color: '#3FA98A', hint: '锁文件、日志、空目录、.tmp 残留。删了不影响任何功能。', order: 1 },
  low: { id: 'low', label: '低风险', color: '#5B8DEF', hint: '缓存与临时目录。删了下次自动重建，只是第一次慢一点。', order: 2 },
  medium: { id: 'medium', label: '需确认', color: '#E0A03A', hint: '安装包、旧回滚快照、构建产物。可能要重新下载或重建。', order: 3 },
};

export const KIND = {
  'office-lock': { label: 'Office 锁文件', risk: 'safe', what: 'Word/PPT 打开时留下的 ~$ 临时文件，0 字节' },
  'tmp-file': { label: '临时文件', risk: 'safe', what: '.tmp / .crdownload / .part 下载与处理残留' },
  log: { label: '日志', risk: 'safe', what: '运行日志、崩溃转储' },
  'empty-dir': { label: '空目录', risk: 'safe', what: '没有任何文件的目录' },
  cache: { label: '缓存', risk: 'low', what: 'node_modules / pip / uv / 各类 .cache，可重建' },
  tmp: { label: '临时目录', risk: 'low', what: 'tmp / temp / scratch / _tmp' },
  installer: { label: '安装包', risk: 'medium', what: '.7z/.zip/.whl/.msi/.iso，装完即冗余' },
  snapshot: { label: '旧回滚快照', risk: 'medium', what: '改配置前的整目录备份，一周以上的' },
  backup: { label: '备份副本', risk: 'medium', what: '.bak / _backup-* 手工副本' },
};

/** 永不当成垃圾的路径片段 */
const PROTECT = [
  '\\attachments\\', '\\sessions\\', '\\models\\', '\\archived_sessions\\',
  'whale-diary', '\\memory\\', 'xwechat_files', '\\微信\\',
  'steamapps', '\\program files', '\\marvis', '\\storages\\',
  '\\_trash', '\\node_modules\\dsh',
  '\\.dsh\\media\\', '\\onebot\\',
  // 各 agent 自身的构建产物与凭据：删了工具直接坏
  '\\.dsh\\profiles\\', '\\dsh-shadow\\', '\\dsh-runtime\\',
  '\\.credentials', '\\.codex\\auth', '\\.claude\\.credentials',
  // 项目虚拟环境
  '\\.venv\\', '\\venv\\', '\\site-packages\\',
];

export const CAT_META = {
  model: { label: '模型权重', color: '#E8452C' },
  installer: { label: '安装包/归档', color: '#C9861A' },
  session: { label: '会话记录', color: '#5B8DEF' },
  cache: { label: '缓存/临时', color: '#7A8699' },
  log: { label: '日志', color: '#9AA5B8' },
  code: { label: '代码', color: '#3FA98A' },
  doc: { label: '文档产物', color: '#B08BC9' },
  data: { label: '数据/索引', color: '#6E7B8B' },
  media: { label: '图片/音视频', color: '#D96A9B' },
  binary: { label: '二进制/镜像', color: '#59616E' },
  other: { label: '其他', color: '#454B57' },
};

// ─────────────────────────────────────── Agent 发现 ──

const ENV = (s) => String(s)
  .replace(/%([^%]+)%/g, (_, k) => process.env[k] || process.env[k.toUpperCase()] || '')
  .replace(/^~(?=$|[\\/])/, HOME);

/** 已知 agent 的候选路径；存在的才会被纳入扫描 */
export const AGENT_SPECS = [
  {
    id: 'dsh', name: 'DeepSeek Harness', color: '#FF5A36', short: 'DSH',
    paths: ['~/.dsh', '$SPACE_ROOT/dsh-data', '$SPACE_ROOT/Deepseek', '$SPACE_ROOT/DSH-Plugins',
      '$SPACE_ROOT/dsh-recovery', '$SPACE_ROOT/dsh-shadow', '$SPACE_ROOT/dsh-runtime',
      '$SPACE_ROOT/dsh-attachments-archive', '$SPACE_ROOT/dsh-browser'],
  },
  { id: 'codex', name: 'Codex CLI', color: '#5B8DEF', short: 'Codex', paths: ['~/.codex'] },
  { id: 'claude', name: 'Claude Code', color: '#B08BC9', short: 'Claude', paths: ['~/.claude'] },
  {
    id: 'cursor', name: 'Cursor', color: '#3FA98A', short: 'Cursor',
    paths: ['~/.cursor', '~/AppData/Roaming/Cursor', '~/AppData/Local/Cursor',
      '~/AppData/Local/Cursor/CachedData', '~/AppData/Local/Cursor/Cache'],
  },
  { id: 'gemini', name: 'Gemini CLI', color: '#E0A03A', short: 'Gemini', paths: ['~/.gemini'] },
  {
    id: 'aider', name: 'Aider', color: '#D96A9B', short: 'Aider',
    paths: ['~/.aider.tags.cache.v3', '~/.aider.tags.cache.v4', '~/.aider.chat.history.md',
      '~/.aider.input.history', '~/.aider'],
  },
  {
    id: 'opencode', name: 'OpenCode', color: '#6E7B8B', short: 'OpenCode',
    paths: ['~/.opencode', '~/.local/share/opencode', '~/AppData/Local/opencode'],
  },
  {
    id: 'windsurf', name: 'Windsurf', color: '#2BA89B', short: 'Windsurf',
    paths: ['~/.windsurf', '~/.codeium/windsurf', '~/AppData/Roaming/Windsurf', '~/.codeium'],
  },
  { id: 'continue', name: 'Continue', color: '#C084C0', short: 'Continue', paths: ['~/.continue'] },
  {
    id: 'cline', name: 'Cline', color: '#4E8FEF', short: 'Cline',
    paths: ['~/.cline', '~/AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev'],
  },
  {
    id: 'roocode', name: 'Roo Code', color: '#7FA85A', short: 'Roo',
    paths: ['~/.roo', '~/AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline'],
  },
  { id: 'copilot', name: 'GitHub Copilot CLI', color: '#8B94A4', short: 'Copilot', paths: ['~/.copilot'] },
  { id: 'ollama', name: 'Ollama', color: '#59616E', short: 'Ollama', paths: ['~/.ollama'] },
  {
    id: 'lmstudio', name: 'LM Studio', color: '#B08BC9', short: 'LM Studio',
    paths: ['~/.lmstudio', '~/.cache/lm-studio'],
  },
  {
    id: 'workbuddy', name: 'WorkBuddy', color: '#D9A05B', short: 'WorkBuddy',
    paths: ['~/.workbuddy', '$SPACE_ROOT/workbuddy'],
  },
  { id: 'qoder', name: 'Qoder', color: '#7A8699', short: 'Qoder', paths: ['~/.qoder'] },
  {
    id: 'trae', name: 'Trae', color: '#E06A9B', short: 'Trae',
    paths: ['~/.trae', '~/AppData/Roaming/Trae'],
  },
  { id: 'zed', name: 'Zed', color: '#8FA5C4', short: 'Zed', paths: ['~/AppData/Local/Zed'] },
  { id: 'amp', name: 'Amp', color: '#C9861A', short: 'Amp', paths: ['~/.amp', '~/.config/amp'] },
  { id: 'kilo', name: 'Kilo Code', color: '#5FB0A0', short: 'Kilo', paths: ['~/.kilocode'] },
  { id: 'openhands', name: 'OpenHands', color: '#9B7BC4', short: 'OpenHands', paths: ['~/.openhands'] },
  { id: 'system', name: '系统临时文件', color: '#8B94A4', short: '系统临时', paths: ['~/AppData/Local/Temp'] },
];

/** 解析 agent 候选路径，返回实际存在的 */
export function discoverAgents(cfg) {
  const spaceRoot = process.env.SPACE_ROOT || 'D:\\';
  const out = [];
  const normKey = (p) => { try { return path.resolve(p).toLowerCase(); } catch { return String(p).toLowerCase(); } };

  for (const spec of AGENT_SPECS) {
    const found = [];
    const seen = new Set();
    const addPath = (p, isFile) => {
      const k = normKey(p);
      if (seen.has(k)) return;
      seen.add(k);
      found.push({ path: path.resolve(p), isFile });
    };
    for (const raw of spec.paths) {
      const p = ENV(raw.replace(/\$SPACE_ROOT/g, spaceRoot.replace(/\\$/, '')));
      if (!p) continue;
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (!st.isDirectory() && !st.isFile()) continue;
      addPath(p, st.isFile());
    }
    // 用户自定义的 roots 里，id 前缀或 platform 匹配也归到这个 agent
    for (const r of cfg.roots || []) {
      if (r.platform === spec.id || r.id.startsWith(spec.id + '-') || r.id === spec.id) {
        try { if (fs.statSync(r.path).isDirectory()) addPath(r.path, false); } catch { }
      }
    }
    out.push({ id: spec.id, name: spec.name, short: spec.short, color: spec.color, paths: found, present: found.length > 0 });
  }
  return out;
}

// ─────────────────────────────────────────── 配置 ──

export function defaultConfig() {
  const D = process.env.SPACE_ROOT || 'D:\\';
  const p = (...s) => path.join(D, ...s);
  return {
    // 自动发现开启时，roots 只作为额外补充
    autoDiscover: true,
    roots: [
      { id: 'dsh-plugins', label: 'DSH · 插件与生图模型', path: p('DSH-Plugins'), platform: 'dsh' },
      { id: 'dsh-home', label: 'DSH · 主配置目录', path: path.join(HOME, '.dsh'), platform: 'dsh' },
      { id: 'dsh-data', label: 'DSH · 会话与附件', path: p('dsh-data'), platform: 'dsh' },
      { id: 'dsh-workspace', label: 'DSH · 工作区', path: p('Deepseek'), platform: 'dsh' },
      { id: 'dsh-recovery', label: 'DSH · 回滚快照', path: p('dsh-recovery'), platform: 'dsh' },
      { id: 'codex-home', label: 'Codex · 主目录', path: path.join(HOME, '.codex'), platform: 'codex' },
      { id: 'claude-home', label: 'Claude Code · 主目录', path: path.join(HOME, '.claude'), platform: 'claude' },
      { id: 'user-temp', label: '系统临时文件', path: path.join(HOME, 'AppData', 'Local', 'Temp'), platform: 'system' },
    ],
    // 找 git 仓库（worktree 检测）的起点
    repoRoots: [path.join(D, 'Deepseek'), path.join(HOME, 'code'), path.join(HOME, 'src'), path.join(HOME, 'projects')],
    trashRetentionDays: 30,
  };
}

export function loadConfig() {
  try { return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return defaultConfig(); }
}
export function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

/** 把 config + 自动发现合成扫描要用的一串 root */
export function effectiveRoots(cfg) {
  const list = [];
  const seen = new Set();
  const key = (p) => { try { return path.resolve(p).toLowerCase(); } catch { return String(p).toLowerCase(); } };
  const add = (r) => {
    const k = key(r.path);
    if (seen.has(k)) return;
    seen.add(k);
    list.push({ ...r, path: path.resolve(r.path) });
  };
  if (cfg.autoDiscover !== false) {
    for (const a of discoverAgents(cfg)) {
      for (const f of a.paths) {
        if (f.isFile) continue;   // 单文件的（比如 aider 的 history）不当作 root
        add({ id: `${a.id}:${f.path}`, label: a.name, path: f.path, platform: a.id });
      }
    }
  }
  for (const r of cfg.roots || []) add(r);
  return list.filter((r) => { try { return fs.statSync(r.path).isDirectory(); } catch { return false; } });
}

// ─────────────────────────────────────────── 分类 ──

const EXT_CAT = new Map(Object.entries({
  '.safetensors': 'model', '.pt': 'model', '.pth': 'model', '.onnx': 'model', '.ckpt': 'model',
  '.gguf': 'model', '.sft': 'model', '.engine': 'model', '.bin': 'model', '.h5': 'model',
  '.whl': 'installer', '.7z': 'installer', '.zip': 'installer', '.tgz': 'installer', '.msi': 'installer',
  '.exe': 'installer', '.dmg': 'installer', '.pkg': 'installer', '.iso': 'installer', '.gz': 'installer',
  '.log': 'log', '.out': 'log',
  '.png': 'media', '.jpg': 'media', '.jpeg': 'media', '.webp': 'media', '.gif': 'media', '.bmp': 'media',
  '.mp4': 'media', '.mov': 'media', '.webm': 'media', '.mkv': 'media', '.avi': 'media',
  '.mp3': 'media', '.wav': 'media', '.flac': 'media', '.m4a': 'media', '.ogg': 'media',
  '.py': 'code', '.js': 'code', '.mjs': 'code', '.cjs': 'code', '.ts': 'code', '.tsx': 'code',
  '.jsx': 'code', '.java': 'code', '.c': 'code', '.cpp': 'code', '.h': 'code', '.cs': 'code',
  '.go': 'code', '.rs': 'code', '.ps1': 'code', '.sh': 'code', '.html': 'code',
  '.md': 'doc', '.docx': 'doc', '.doc': 'doc', '.pptx': 'doc', '.ppt': 'doc', '.xlsx': 'doc',
  '.xls': 'doc', '.pdf': 'doc', '.txt': 'doc', '.csv': 'doc', '.rtf': 'doc', '.odt': 'doc',
  '.json': 'data', '.jsonl': 'data', '.yaml': 'data', '.yml': 'data', '.toml': 'data',
  '.db': 'data', '.sqlite': 'data', '.sqlite3': 'data', '.zstd': 'data', '.parquet': 'data',
  '.dll': 'binary', '.so': 'binary', '.dylib': 'binary', '.node': 'binary', '.pyd': 'binary',
  '.vhd': 'binary', '.vhdx': 'binary', '.vmdk': 'binary', '.img': 'binary',
}));

export function classify(rel, name) {
  const lower = rel.toLowerCase().replace(/\\/g, '/');
  const nm = name.toLowerCase();
  if (/session\.v\d+\.jsonl\.zstd$/.test(nm) || /^rollout-.*\.jsonl$/.test(nm)) return 'session';
  if (/\.jsonl$/.test(nm) && (lower.includes('/sessions/') || lower.includes('/archived_sessions/') ||
      lower.includes('/projects/') || lower.includes('/history') || lower.includes('/chats/'))) return 'session';
  if (lower.includes('node_modules/')) return 'cache';
  return EXT_CAT.get(path.extname(nm)) || 'other';
}

/** 受保护的快照：一周内的、以及浏览器/CDP 活数据 */
function isProtectedSnapshot(l) {
  if (!l.includes('/dsh-recovery/')) return false;
  if (/\/(browser-|cdp-|chrome|crashpad)/.test(l)) return true;
  const m = l.match(/\/dsh-recovery\/(\d{8})/);
  return !!(m && m[1] >= recentStamp());
}
function recentStamp() {
  const d = new Date(Date.now() - 7 * 864e5);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export function junkOf(abs, name, isDir, isEmpty) {
  const l = abs.toLowerCase().replace(/\\/g, '/');
  if (l.includes('/_recycle.bin') || l.includes('/$recycle.bin')) return null;
  if (PROTECT.some((p) => l.includes(p.replace(/\\/g, '/').toLowerCase() || '@@none'))) return null;
  if (/(^|\/)_npx(\/|$)/.test(l)) return null;
  if (isProtectedSnapshot(l)) return null;
  // git 目录本身不碰（worktree 走专门逻辑）
  if (/(^|\/)\.git(\/|$)/.test(l)) return null;

  if (!isDir) {
    if (name.startsWith('~$')) return { kind: 'office-lock', risk: 'safe' };
    if (/\.(tmp|temp|crdownload|part)$/.test(l)) return { kind: 'tmp-file', risk: 'safe' };
    if (/\.(log|dmp|etl)$/.test(l)) return { kind: 'log', risk: 'safe' };
    if (/\.(bak|old|orig)$/.test(l)) return { kind: 'backup', risk: 'medium' };
    if (/\.(7z|zip|whl|msi|iso|tgz|tar|gz|rar)$/.test(l)) return { kind: 'installer', risk: 'medium' };
  }
  if (isDir) {
    if (isEmpty) return { kind: 'empty-dir', risk: 'safe' };
    if (/(^|\/)(node_modules|__pycache__|\.pytest_cache|\.pnpm-store|\.uv-cache|_cacache|\.gradle-home|\.mypy_cache|\.ruff_cache|\.parcel-cache|\.turbo|\.next\/cache|\.nuxt)(\/|$)/.test(l)) {
      return { kind: 'cache', risk: 'low' };
    }
    if (/(^|\/)(tmp|temp|\.tmp|scratch|_tmp|_tmp_[a-z0-9]+|tmp_[a-z0-9]+)(\/|$)/.test(l)) return { kind: 'tmp', risk: 'low' };
    if (/(^|\/)(\.cache|cache|Cache|CachedData|GPUCache|Code Cache|Service Worker)(\/|$)/.test(l) && l.includes('/appdata/')) {
      return { kind: 'cache', risk: 'low' };
    }
    if (/(^|\/)\.cache(\/|$)/.test(l)) return { kind: 'cache', risk: 'low' };
    if (l.includes('/dsh-recovery/')) return { kind: 'snapshot', risk: 'medium' };
    if (/(^|\/)_backup[-_]/.test(l)) return { kind: 'backup', risk: 'medium' };
  }
  return null;
}

// ─────────────────────────────────────────── 扫描 ──

const isReparse = (st) => !!(st.isSymbolicLink && st.isSymbolicLink());
export const realDir = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };

export function scan(cfg) {
  const started = Date.now();
  const roots = effectiveRoots(cfg);
  const rootReal = roots.map((r) => ({ id: r.id, real: (realDir(r.path) || r.path).toLowerCase() }));
  const owned = new Map();

  const dirs = [], bigFiles = [], scratch = [];
  const catTotal = {}, platTotal = {}, rootTotal = {}, extTotal = {};

  for (const r of roots) {
    const rReal = (realDir(r.path) || r.path).toLowerCase();
    if (owned.has(rReal)) { rootTotal[r.id] = 0; continue; }
    owned.set(rReal, r.id);
    const rt = { p: r.id, s: 0, f: 0, t: 0, cat: null, plt: r.platform, root: r.id, depth: 0, junk: null, risk: null, link: null };
    walk(r.path, r.path, rt, 1);
    rootTotal[r.id] = rt.s;
    if (rt.s > 8 * 1024 * 1024) dirs.push(rt);
  }

  function walk(absDir, rootPath, node, depth) {
    if (absDir === TRASH_DIR || absDir === DATA_DIR || absDir.startsWith(TRASH_DIR + path.sep) || absDir.startsWith(DATA_DIR + path.sep)) return;
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }

    for (const ent of entries) {
      const full = path.join(absDir, ent.name);
      const rel = path.relative(rootPath, full) || ent.name;
      let st;
      try { st = fs.lstatSync(full); } catch { continue; }

      if (isReparse(st)) {
        const target = realDir(full);
        if (!target) continue;
        const tl = target.toLowerCase();
        if (owned.has(tl) && owned.get(tl) !== node.root) continue;
        const host = rootReal.find((x) => tl === x.real || tl.startsWith(x.real + path.sep));
        if (host && host.id !== node.root) continue;
        owned.set(tl, node.root);
        if (target === rootPath || !target.startsWith(rootPath)) {
          node.link = node.link || [];
          node.link.push({ p: rel.replace(/\\/g, '/'), to: target });
          continue;
        }
      }

      if (st.isDirectory()) {
        const j = junkOf(full, ent.name, true, false) || (node.junk ? { kind: node.junk, risk: node.risk } : null);
        const child = {
          p: rel.replace(/\\/g, '/'), s: 0, f: 0, t: 0, cat: null, plt: node.plt, root: node.root,
          depth, junk: j ? j.kind : null, risk: j ? j.risk : null, link: null,
        };
        walk(full, rootPath, child, depth + 1);
        if (child.f === 0 && child.s === 0 && !child.junk) {
          const e = junkOf(full, ent.name, true, true);
          if (e) { child.junk = e.kind; child.risk = e.risk; }
        }
        node.s += child.s;
        node.f += child.f;
        if (child.t > node.t) node.t = child.t;
        if (!node.cat && child.cat) node.cat = child.cat;
        if (child.s > 8 * 1024 * 1024 || child.junk) dirs.push(child);
        continue;
      }

      if (!st.isFile()) continue;
      const size = st.size;
      node.s += size;
      node.f += 1;
      if (st.mtimeMs > node.t) node.t = st.mtimeMs;

      const cat = classify(rel, ent.name);
      const jr = junkOf(full, ent.name, false, false);
      catTotal[cat] = (catTotal[cat] || 0) + size;
      platTotal[node.plt] = (platTotal[node.plt] || 0) + size;
      const ext = path.extname(ent.name).toLowerCase() || '(none)';
      extTotal[ext] = (extTotal[ext] || 0) + size;
      if (!node.cat || size > 1024 * 1024) node.cat = cat;

      if (size > 5 * 1024 * 1024) {
        bigFiles.push({ p: full, rel: rel.replace(/\\/g, '/'), s: size, t: st.mtimeMs, cat, plt: node.plt, root: node.root, junk: jr ? jr.kind : null, risk: jr ? jr.risk : null });
      }
      if (size > 512 && /\.(py|md|ps1|bat|js|mjs)$/i.test(ent.name)) {
        scratch.push({ p: full, rel: rel.replace(/\\/g, '/'), s: size, t: st.mtimeMs, plt: node.plt, root: node.root });
      }
    }
  }

  dirs.sort((a, b) => b.s - a.s);
  bigFiles.sort((a, b) => b.s - a.s);
  scratch.sort((a, b) => b.t - a.t);

  let fileCount = 0, total = 0;
  for (const v of Object.values(rootTotal)) total += v;
  for (const d of dirs) fileCount += d.f;

  const data = {
    scannedAt: Date.now(),
    tookMs: Date.now() - started,
    rootsSig: rootsSignature(cfg),
    total, fileCount,
    roots: roots.map((r) => ({ id: r.id, label: r.label, path: r.path, platform: r.platform, size: rootTotal[r.id] || 0 })),
    agents: discoverAgents(cfg).map((a) => ({
      id: a.id, name: a.name, short: a.short, color: a.color, present: a.present,
      paths: a.paths.map((f) => f.path),
      size: roots.filter((r) => r.platform === a.id).reduce((s, r) => s + (rootTotal[r.id] || 0), 0),
      rootCount: roots.filter((r) => r.platform === a.id).length,
    })),
    catTotal, platTotal, junkTotal: {}, riskTotal: {},
    cats: CAT_META, kinds: KIND, risks: RISK,
    topExt: Object.entries(extTotal).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([e, s]) => ({ e, s })),
    dirs: dirs.slice(0, 6000).map((d) => ({
      p: d.p, s: d.s, f: d.f, t: d.t, c: d.cat, plt: d.plt, root: d.root, d: d.depth,
      j: d.junk, r: d.risk, link: d.link || null,
    })),
    bigFiles: bigFiles.slice(0, 1000),
    scratch: scratch.slice(0, 3000),
  };

  const plan = buildPlan(data);
  for (const id of ['safe', 'low', 'medium']) {
    data.riskTotal[id] = plan[id].bytes;
    for (const [k, v] of Object.entries(plan[id].kinds)) data.junkTotal[k] = (data.junkTotal[k] || 0) + v;
  }
  return data;
}

export function loadCache() { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'scan.json'), 'utf8')); } catch { return null; } }
export function saveCache(d) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, 'scan.json'), JSON.stringify(d), 'utf8'); }

/** 扫描根集合的指纹：配置变了，旧缓存就不该再被信任 */
export function rootsSignature(cfg) {
  const sig = effectiveRoots(cfg)
    .map((r) => path.resolve(r.path).toLowerCase())
    .sort()
    .join('|');
  return crypto.createHash('sha1').update(sig).digest('hex').slice(0, 12);
}

/** 缓存是否仍然对应当前配置 */
export function cacheStatus(cfg) {
  const c = loadCache();
  if (!c) return { exists: false, fresh: false, cachedSig: null, currentSig: rootsSignature(cfg) };
  const currentSig = rootsSignature(cfg);
  // "demo" 是演示数据集的显式标记，不受配置指纹约束
  const fresh = c.rootsSig === 'demo' || (!!c.rootsSig && c.rootsSig === currentSig);
  return { exists: true, fresh, cachedSig: c.rootsSig || null, currentSig, scannedAt: c.scannedAt };
}

// ─────────────────────────────────────── 清理计划 ──

function absOf(scanData, rootId, rel) {
  const r = (scanData.roots || []).find((x) => x.id === rootId);
  if (!r) return null;
  return rel ? r.path.replace(/\\$/, '') + '\\' + rel.replace(/\//g, '\\') : r.path;
}

export function buildPlan(scanData) {
  const items = [];
  // 演示数据集的路径是虚构的，跳过存在性校验
  const isDemo = scanData.rootsSig === 'demo';
  const push = (abs, bytes, kind, risk, root, rel, t, plt) => {
    if (!abs) return;
    items.push({ path: abs, bytes, kind, risk, root, rel, t, plt: plt || 'dsh' });
  };
  for (const d of scanData.dirs || []) {
    if (!d.j) continue;
    push(absOf(scanData, d.root, d.p), d.s, d.j, d.r, d.root, d.p, d.t, d.plt);
  }
  for (const f of scanData.bigFiles || []) {
    if (!f.junk) continue;
    push(f.p, f.s, f.junk, f.risk, f.root, f.rel, f.t, f.plt);
  }
  const norm = (p) => p.toLowerCase().replace(/\\+$/, '') + '\\';
  items.sort((a, b) => a.path.length - b.path.length);
  const kept = [];
  for (const it of items) {
    const n = norm(it.path);
    if (kept.some((k) => n.startsWith(norm(k.path)))) continue;
    // 演示数据的路径是虚构的，跳过存在性校验
    if (!isDemo) { try { fs.lstatSync(it.path); } catch { continue; } }
    kept.push(it);
  }
  const tiers = { safe: [], low: [], medium: [] };
  for (const it of kept) if (tiers[it.risk]) tiers[it.risk].push(it);

  const out = {};
  const grand = {};
  for (const id of ['safe', 'low', 'medium']) {
    const list = tiers[id].sort((a, b) => b.bytes - a.bytes);
    const byPlatform = {};
    for (const it of list) {
      const b = byPlatform[it.plt] = byPlatform[it.plt] || { bytes: 0, count: 0 };
      b.bytes += it.bytes; b.count++;
      const g = grand[it.plt] = grand[it.plt] || { total: 0, safe: 0, low: 0, medium: 0, count: 0 };
      g.total += it.bytes; g[id] += it.bytes; g.count++;
    }
    out[id] = {
      id, ...RISK[id],
      count: list.length,
      bytes: list.reduce((a, x) => a + x.bytes, 0),
      items: list.slice(0, 2500).map(({ path: p, bytes, kind, risk, plt, t }) => ({ path: p, bytes, kind, risk, plt, t })),
      kinds: list.reduce((a, x) => { a[x.kind] = (a[x.kind] || 0) + x.bytes; return a; }, {}),
      byPlatform,
      _all: list.map((x) => x.path),
      _byPlatformPaths: list.reduce((a, x) => { (a[x.plt] = a[x.plt] || []).push(x.path); return a; }, {}),
    };
  }
  out._platforms = grand;
  return out;
}

// ─────────────────────────────────────────── 回收站 ──

export function dirSize(p) {
  let st; try { st = fs.lstatSync(p); } catch { return 0; }
  if (st.isFile()) return st.size;
  if (isReparse(st)) return 0;
  let sum = 0;
  const stack = [p];
  while (stack.length) {
    const d = stack.pop();
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      let s2; try { s2 = fs.lstatSync(f); } catch { continue; }
      if (isReparse(s2)) continue;
      if (s2.isDirectory()) stack.push(f); else sum += s2.size;
    }
  }
  return sum;
}

export function compactPaths(paths) {
  const list = [...new Set(paths.map((p) => path.resolve(String(p)).replace(/\\+$/, '')))];
  const norm = list.map((p) => p.toLowerCase() + '\\');
  return list.filter((p, i) => !norm.some((q, j) => j !== i && norm[i].startsWith(q)));
}

export function moveToTrash(targets, label) {
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + (label ? '-' + label : '');
  const batch = path.join(TRASH_DIR, stamp);
  fs.mkdirSync(batch, { recursive: true });
  const manifest = [];
  let freed = 0, ok = 0;
  const failed = [];

  for (const raw of compactPaths(targets)) {
    const t = path.resolve(raw);
    if (!t || t.length < 6 || /^[A-Za-z]:\\?$/.test(t)) { failed.push({ p: raw, why: '拒绝对盘根操作' }); continue; }
    if (t.startsWith(TRASH_DIR)) { failed.push({ p: raw, why: '已在回收站内' }); continue; }
    let st;
    try { st = fs.lstatSync(t); } catch { failed.push({ p: raw, why: '不存在' }); continue; }
    const size = dirSize(t);
    const dest = path.join(batch, `${String(manifest.length + 1).padStart(4, '0')}_${path.basename(t)}`);
    try {
      fs.renameSync(t, dest);
    } catch {
      try {
        fs.cpSync(t, dest, { recursive: true, force: true });
        fs.rmSync(t, { recursive: true, force: true });
      } catch (e2) {
        failed.push({ p: raw, why: String(e2.message || e2).slice(0, 140) });
        continue;
      }
    }
    freed += size; ok++;
    manifest.push({ from: t, to: dest, size, at: Date.now() });
  }
  fs.writeFileSync(path.join(batch, 'manifest.json'), JSON.stringify({ batch: stamp, label: label || '', items: manifest }, null, 2), 'utf8');
  return { ok, freed, batch, failed };
}

export function listTrash() {
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  let batches = [];
  try { batches = fs.readdirSync(TRASH_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { }
  return batches.map((b) => {
    const p = path.join(TRASH_DIR, b.name);
    let man = null;
    try { man = JSON.parse(fs.readFileSync(path.join(p, 'manifest.json'), 'utf8')); } catch { }
    const items = (man && man.items) || [];
    return {
      batch: b.name, label: (man && man.label) || '', count: items.length,
      size: items.reduce((a, x) => a + (x.size || 0), 0), items, mtime: fs.statSync(p).mtimeMs,
    };
  }).sort((a, b) => b.mtime - a.mtime);
}

export function restoreBatch(batch) {
  const dir = path.join(TRASH_DIR, path.basename(String(batch || '')));
  let man = null;
  try { man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return { error: '批次不存在' }; }
  let ok = 0; const failed = [];
  for (const it of man.items || []) {
    try {
      fs.mkdirSync(path.dirname(it.from), { recursive: true });
      if (fs.existsSync(it.from)) throw new Error('原路径已被占用');
      fs.renameSync(it.to, it.from);
      ok++;
    } catch (e) { failed.push({ from: it.from, why: String(e.message || e).slice(0, 120) }); }
  }
  if (ok && !failed.length) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } }
  return { ok, failed };
}

export function purgeBatch(batch) {
  if (batch !== 'all' && !/^[\w.\-]+$/.test(String(batch || ''))) return { error: '批次名非法' };
  const target = batch === 'all' ? TRASH_DIR : path.join(TRASH_DIR, path.basename(String(batch || '')));
  if (!target.startsWith(TRASH_DIR)) return { error: 'bad batch' };
  if (!fs.existsSync(target)) return { error: '批次不存在' };
  const freed = dirSize(target);
  try { fs.rmSync(target, { recursive: true, force: true }); } catch (e) { return { error: String(e.message) }; }
  return { ok: true, freed };
}

// ─────────────────────────────────────────── 会话 ──

export function dshDataRoot() {
  const cfg = loadConfig();
  const r = (cfg.roots || []).find((x) => x.id === 'dsh-data');
  if (r && r.path) return r.path;
  return path.join(process.env.SPACE_ROOT || 'D:\\', 'dsh-data');
}

const readJsonSafe = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function decodeSlug(slug) {
  let s = slug.replace(/^--|--$/g, '');
  s = s.replace(/~([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return s.replace(/-/g, '\\');
}

export function listDshSessions() {
  const out = [];
  const dataRoot = dshDataRoot();
  const reg = readJsonSafe(path.join(dataRoot, 'storages', 'workspace.json')) || {};
  const g = reg.global || {};
  const archived = new Set(g.archivedSessionIds || []);
  const pinned = new Set(g.pinnedSessionIds || []);
  const wsBySession = new Map();
  for (const w of Object.values((reg.tables && reg.tables.workspaces) || {})) {
    for (const sid of w.sessionIds || []) wsBySession.set(sid, w);
  }
  const sessRoot = path.join(dataRoot, 'sessions');
  let slugs = [];
  try { slugs = fs.readdirSync(sessRoot, { withFileTypes: true }).filter((x) => x.isDirectory()); } catch { return out; }
  for (const slug of slugs) {
    let items = [];
    try { items = fs.readdirSync(path.join(sessRoot, slug.name), { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      if (!it.isDirectory()) continue;
      const dir = path.join(sessRoot, slug.name, it.name);
      let size = 0, mtime = 0, files = 0;
      try {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!f.isFile()) continue;
          const st = fs.statSync(path.join(dir, f.name));
          size += st.size; files++;
          if (st.mtimeMs > mtime) mtime = st.mtimeMs;
        }
      } catch { continue; }
      const w = wsBySession.get(it.name);
      out.push({
        platform: 'dsh', id: it.name, dir, size, mtime, files,
        workspace: w ? w.path : decodeSlug(slug.name), title: w ? w.title : null,
        archived: archived.has(it.name), pinned: pinned.has(it.name),
      });
    }
  }
  return out;
}

function walkFiles(root, filter, out, depth = 0) {
  if (depth > 8) return;
  let ents = [];
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) { walkFiles(full, filter, out, depth + 1); continue; }
    if (!filter(e.name)) continue;
    let st; try { st = fs.statSync(full); } catch { continue; }
    out.push({ full, st, root });
  }
}

/** Codex / Gemini / Cursor 等：把会话文件统一抽象成同一种形状 */
export function listFlatSessions(base, platform, opts = {}) {
  const out = [];
  const files = [];
  walkFiles(base, (n) => /\.(jsonl|json|db|sqlite|vscdb)$/i.test(n), files);
  for (const f of files) {
    if (opts.skip && opts.skip(f.full)) continue;
    out.push({
      platform, id: path.basename(f.full).replace(/\.[^.]+$/, ''), dir: f.full,
      size: f.st.size, mtime: f.st.mtimeMs, files: 1,
      workspace: path.relative(base, path.dirname(f.full)).replace(/\\/g, '/') || '.',
      title: null, archived: !!opts.archived, pinned: false,
    });
  }
  return out;
}

export function listCodexSessions() {
  const base = path.join(HOME, '.codex');
  const out = [];
  for (const [sub, isArchived] of [['sessions', false], ['archived_sessions', true]]) {
    const root = path.join(base, sub);
    if (!fs.existsSync(root)) continue;
    const files = [];
    walkFiles(root, (n) => n.endsWith('.jsonl'), files);
    for (const f of files) {
      out.push({
        platform: 'codex', id: path.basename(f.full).replace(/\.jsonl$/, ''), dir: f.full,
        size: f.st.size, mtime: f.st.mtimeMs, files: 1,
        workspace: path.relative(root, path.dirname(f.full)).replace(/\\/g, '/'),
        title: null, archived: isArchived, pinned: false,
      });
    }
  }
  return out;
}

export function listClaudeSessions() {
  const root = path.join(HOME, '.claude', 'projects');
  const out = [];
  let projs = [];
  try { projs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const p of projs) {
    const dir = path.join(root, p.name);
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (!e.name.endsWith('.jsonl')) continue;
      const full = path.join(dir, e.name);
      let st; try { st = fs.statSync(full); } catch { continue; }
      out.push({
        platform: 'claude', id: e.name.replace(/\.jsonl$/, ''), dir: full, size: st.size, mtime: st.mtimeMs,
        files: 1, workspace: p.name.replace(/^([A-Za-z])--/, '$1:\\').replace(/-/g, '\\'), title: null,
        archived: false, pinned: false,
      });
    }
  }
  return out;
}

export function allSessions() {
  let list = [...listDshSessions(), ...listCodexSessions(), ...listClaudeSessions()];
  // 其它 agent 的会话文件（Gemini / Cursor / Continue ...）
  const extra = [
    ['gemini', path.join(HOME, '.gemini')],
    ['cursor', path.join(HOME, '.cursor')],
    ['continue', path.join(HOME, '.continue')],
    ['opencode', path.join(HOME, '.local', 'share', 'opencode')],
    ['copilot', path.join(HOME, '.copilot')],
    ['cline', path.join(HOME, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev')],
  ];
  for (const [id, base] of extra) {
    if (!fs.existsSync(base)) continue;
    try { list = list.concat(listFlatSessions(base, id)); } catch { }
  }
  return list.sort((a, b) => b.size - a.size);
}

export function archiveSessions(platform, ids, want) {
  if (platform === 'dsh') {
    const p = path.join(dshDataRoot(), 'storages', 'workspace.json');
    const reg = readJsonSafe(p);
    if (!reg || !reg.global) throw new Error('workspace.json 读取失败');
    const set = new Set(reg.global.archivedSessionIds || []);
    for (const id of ids) { if (want) set.add(id); else set.delete(id); }
    reg.global.archivedSessionIds = [...set];
    fs.copyFileSync(p, p + '.bak-space-manager');
    fs.writeFileSync(p, JSON.stringify(reg, null, 2), 'utf8');
    return { archivedCount: reg.global.archivedSessionIds.length };
  }
  if (platform === 'codex') {
    const base = path.join(HOME, '.codex');
    let moved = 0;
    for (const s of listCodexSessions()) {
      if (!ids.includes(s.id) || s.archived === want) continue;
      const destDir = want ? path.join(base, 'archived_sessions') : path.join(base, 'sessions', s.workspace);
      try { fs.mkdirSync(destDir, { recursive: true }); fs.renameSync(s.dir, path.join(destDir, path.basename(s.dir))); moved++; } catch { }
    }
    return { moved };
  }
  throw new Error(`${platform} 的归档不由本工具管理`);
}

// ─────────────────────────────────────── Git worktree ──

let GIT = null;
function gitBin() {
  if (GIT !== null) return GIT;
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 5000 });
    GIT = 'git';
  } catch { GIT = false; }
  return GIT;
}

function gitRun(cwd, args) {
  const bin = gitBin();
  if (!bin) return { ok: false, err: 'git 不可用' };
  try {
    const out = execFileSync(bin, args, { cwd, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, err: String((e.stderr || e.message || e)).trim().slice(0, 300) };
  }
}

/** 在一个目录下找 git 仓库（含 .git 目录或 .git 文件），最大深度 4 */
export function discoverRepos(root, maxDepth = 4) {
  const repos = [];
  const seen = new Set();
  (function walk(dir, depth) {
    if (depth > maxDepth) return;
    const key = dir.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (/^(node_modules|\.git|\.venv|venv|__pycache__|dist|build|\.next)$/i.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.name === '.git') continue;
      if (fs.existsSync(path.join(full, '.git'))) { repos.push(full); continue; }
      walk(full, depth + 1);
    }
  })(root, 0);
  return repos;
}

/**
 * 列出所有 git worktree 并给判定。
 * verdict: clean（可安全移除）/ dirty（有未提交改动）/ unmerged（有未合并提交）/ broken（注册残留）
 */
export function listWorktrees(cfg) {
  const repos = new Set();
  for (const r of cfg.repoRoots || []) {
    if (!fs.existsSync(r)) continue;
    for (const p of discoverRepos(r)) repos.add(p);
  }
  // agent 工作区本身也可能是仓库
  for (const r of effectiveRoots(cfg)) {
    if (fs.existsSync(path.join(r.path, '.git'))) repos.add(r.path);
  }
  // 每次扫描都发现的新仓库：从缓存里已有的目录里补
  const cache = loadCache();
  for (const d of cache?.dirs || []) {
    if (d.p === '.git' || d.p.endsWith('/.git')) {
      const root = (cache.roots || []).find((x) => x.id === d.root);
      if (root) {
        const abs = path.join(root.path, path.dirname(d.p.split('/').slice(0, -1).join('/')));
        if (fs.existsSync(path.join(abs, '.git'))) repos.add(abs);
      }
    }
  }

  const out = [];
  for (const repo of repos) {
    const gitDir = path.join(repo, '.git');
    let st;
    try { st = fs.statSync(gitDir); } catch { continue; }
    if (!st.isDirectory()) continue;
    const wtDir = path.join(gitDir, 'worktrees');
    let names = [];
    try { names = fs.readdirSync(wtDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }

    for (const name of names) {
      const meta = path.join(wtDir, name);
      let gitdirFile = '';
      try { gitdirFile = fs.readFileSync(path.join(meta, 'gitdir'), 'utf8').trim(); } catch { }
      let wtPath = gitdirFile ? path.dirname(gitdirFile) : null;
      const exists = wtPath ? fs.existsSync(wtPath) : false;

      const item = {
        repo, repoName: path.basename(repo), name, path: wtPath,
        exists, size: 0, mtime: 0,
        head: null, branch: null, dirty: 0, unmerged: 0,
        verdict: 'broken', reason: '',
      };

      if (!exists) {
        item.reason = '目录已不存在，只剩注册记录';
        item.verdict = 'broken';
        out.push(item);
        continue;
      }

      item.size = dirSize(wtPath);
      try { item.mtime = fs.statSync(wtPath).mtimeMs; } catch { }

      const head = gitRun(wtPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
      item.branch = head.ok ? head.out : null;
      const sha = gitRun(wtPath, ['rev-parse', 'HEAD']);
      item.head = sha.ok ? sha.out.slice(0, 10) : null;

      const stt = gitRun(wtPath, ['status', '--porcelain']);
      item.dirty = stt.ok ? stt.out.split('\n').filter(Boolean).length : -1;

      // 有没有「不在任何其它 ref 上」的提交
      const un = gitRun(wtPath, ['rev-list', '--count', 'HEAD', '--not', '--all']);
      item.unmerged = un.ok ? Number(un.out || 0) : -1;

      if (item.dirty > 0) { item.verdict = 'dirty'; item.reason = `${item.dirty} 个文件未提交`; }
      else if (item.unmerged > 0) { item.verdict = 'unmerged'; item.reason = `${item.unmerged} 个提交未合并`; }
      else if (item.dirty === 0 && item.unmerged === 0) { item.verdict = 'clean'; item.reason = '干净且已合并，可安全移除'; }
      else { item.verdict = 'dirty'; item.reason = '无法判定（git 命令失败）'; }

      out.push(item);
    }
  }
  return out.sort((a, b) => b.size - a.size);
}

/** 安全移除 worktree：走 git worktree remove，不用 rm -rf */
export function removeWorktree(repoOrWt, wtName, force = false) {
  if (!gitBin()) return { ok: false, error: 'git 不可用' };
  const all = listWorktrees(loadConfig());
  const item = all.find((w) => w.repo === repoOrWt && w.name === wtName) || all.find((w) => w.path === repoOrWt);
  if (!item) return { ok: false, error: '找不到该 worktree' };
  if (item.verdict === 'dirty' && !force) return { ok: false, error: '有未提交改动，拒绝移除（要强制请传 force）' };
  if (item.verdict === 'unmerged' && !force) return { ok: false, error: '有未合并提交，拒绝移除（要强制请传 force）' };
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(item.path);
  const r = gitRun(item.repo, args);
  if (!r.ok) {
    // 目录已丢失的残留，用 prune 清注册
    const p = gitRun(item.repo, ['worktree', 'prune']);
    return { ok: p.ok, pruned: true, error: r.err };
  }
  return { ok: true, removed: item.path, freed: item.size };
}

// ─────────────────────────────────────────── 磁盘 ──

export function volumeInfo(drives = ['C', 'D', 'E', 'F']) {
  const out = [];
  for (const d of drives) {
    try {
      const s = fs.statfsSync(d + ':\\');
      out.push({ drive: d + ':', total: s.blocks * s.bsize, free: s.bfree * s.bsize, used: (s.blocks - s.bfree) * s.bsize });
    } catch { }
  }
  return out;
}

// ─────────────────────────────────────── 编排动作 ──

export function cleanTier(tier, opts = {}) {
  if (!['safe', 'low', 'medium'].includes(tier)) return { error: 'tier 只能是 safe / low / medium' };
  const st = cacheStatus(loadConfig());
  if (!st.exists) return { error: '还没有扫描结果' };
  // 配置变了之后，旧缓存里的路径可能已经不属于当前扫描范围，不能照着删
  if (!st.fresh) return { error: '配置已变更，缓存已过期，请先重新扫描再清理' };
  const cached = loadCache();
  const plan = buildPlan(cached);
  let paths = plan[tier]._all;
  if (opts.platform) {
    paths = plan[tier]._byPlatformPaths[opts.platform] || [];
  }
  if (!paths.length) return { ok: true, okCount: 0, freed: 0, msg: '该类没有可清理项' };
  const r = moveToTrash(paths, `clean-${tier}${opts.platform ? '-' + opts.platform : ''}`);
  let purged = 0;
  if (opts.purge) { try { purged = dirSize(r.batch); fs.rmSync(r.batch, { recursive: true, force: true }); } catch { } }
  return { ok: true, tier, platform: opts.platform || 'all', okCount: r.ok, freed: r.freed, purged, batch: r.batch, failed: r.failed.slice(0, 20), failedCount: r.failed.length };
}
