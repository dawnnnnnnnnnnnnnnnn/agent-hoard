# Changelog

All notable changes to this project are documented here.

## [1.1.0] — 2026-11-18

这一版主要回应外部测试反馈：**第一次打开时的三秒**，以及扫描期间"像卡死"的体验。

### Added
- **首屏引导**：没有扫描缓存时显示引导卡（「还没有扫描过 / 开始扫描」），不再自动跑一次 90 秒的静默扫描让人面对空页面。配置变更导致缓存失效时，引导卡会说明原因并要求重新扫描。
- **扫描进度**：新增 `GET /api/scan/progress`。进度条显示百分比、已扫文件数、已扫体积、当前 agent。有上次扫描结果时按目录大小加权，进度按字节平滑推进而非按 root 数跳格（实测 `0→12→18→24→29→47→53→76→82→94`）。
- **CLI 进度**：`node cli.mjs scan` 输出实时进度行。
- **CLI 按 agent 分组**：`scan` 默认输出各 agent 占用，`--by-agent` 额外给出「每个 agent 各有多少可清理」。
- `CHANGELOG.md`（本文件）。

### Changed
- **`scan()` 改为异步**：用时间预算（12ms）让出事件循环，而不是固定"每 N 项 yield"。此前同步扫描会占满 Node 单线程，导致扫描期间所有 HTTP 请求无响应，进度条无从谈起。
- **跨平台常量**：临时目录改用 `os.tmpdir()`，默认盘符改用 `path.parse(os.homedir()).root`，`$SPACE_ROOT` 支持多候选盘（`C:\`、`D:\`、`E:\`），不再写死 `%TEMP%` 与 `D:\`。
- README 扫描耗时改为区间（约 35–90 秒，随文件数变化），不再用单一机器上的数字当基准。
- README 量化了「低风险」的重建代价（500 MB `node_modules` 约 2–5 分钟）。

### Fixed
- **`purge` 对不存在的批次返回 200**：现在路径穿越、非法批次名、不存在的批次都返回 400，不再让人误以为清空成功。
- 缓存与配置脱节：新增 `rootsSig` 指纹，配置变了之后 `/api/plan` 与 `/api/clean` 都返回 409，不会照着过期清单删文件。

### Known limitations
- 仍是 **Windows 优先**，macOS / Linux 未实机测试。
- 22 种 agent 探测是逐个同步 `stat`；若候选路径位于已断开的网络盘，探测可能变慢。
- 扫描为全量同步 `stat`，没有增量扫描。

## [1.0.0] — 2026-11-18

首个版本。

### Added
- 22 种 AI 编码 agent 自动探测（DSH / Codex / Claude Code / Cursor / Gemini / Aider / OpenCode / Windsurf / Continue / Cline / Roo Code / Copilot CLI / Ollama / LM Studio / WorkBuddy / Qoder / Trae / Zed / Amp / Kilo / OpenHands / 系统临时）
- 三级风险清理（无风险 / 低风险 / 需确认），硬保护名单与可恢复回收站
- 会话与归档管理，并说明「归档不释放空间」
- git worktree 检测与安全移除（`git worktree remove`，dirty / unmerged 默认拒绝）
- 平台 × 风险双向联动图表
- 全选做父子压缩与 junction 去重
- Web UI + MCP server（9 工具）+ CLI
- `npm test`：自带服务与演示数据，10 套验收
