# 门禁链的方言与名单（deck 子树）

> 票：[deck 门禁链 ESM/CJS 欠账](https://github.com/SunsetRNE/dsh-github-resident/issues/11)（2026-10-13 结）
> 本文是这条链的**口径单一来源**：方言怎么定、名单从哪来、用什么判、现在还剩哪几道红、为什么红。
> 改这条链之前先读本文；口径要改，改这里，别在脚本里再定一份。

---

## 1. 口径（唯一一条）

**deck 子树一律 ESM，包根声明即是唯一方言声明。**

| 决定 | 内容 | 为什么 |
|---|---|---|
| 方言 | **改成 ESM**，不按文件改 `.cjs`，也不给 deck/ 加第二份 `package.json` 边界 | 包根 `package.json` 是 `"type": "module"`（v1.4.0 b99e5a9 起）；`deck/src/host/index.js` 由宿主按 ESM 加载、`deck/package/package.json` 也是 `"type": "module"`。把 tests/ 打成 CJS 边界，会让 tests/ 里 113 个已写 ESM 的门禁整体翻面 |
| 扩展名 | `.js` 保持 `.js`（不再是 `.mjs`/`.cjs` 的判据代理） | 方言由包声明决定，不由扩展名逐个决定 |
| 内建模块 | 一律 `node:` 前缀 | 与既有 ESM 门禁同款 |
| `module.exports` | 有消费方解构 → 具名导出（可同时留默认导出）；否则 `export default` | 消费方两种拿法都要活 |
| `__dirname` / `__filename` | `fileURLToPath(import.meta.url)` 现算 | ESM 里没有这两个自由变量 |
| `require.main === module` | `isMainEntry`（`import.meta.url === pathToFileURL(process.argv[1]).href`） | 同一个「是不是入口」语义，ESM 的等价写法 |
| 拿不到字面量说明符的 require | 只在**这类文件**里放 `const require = createRequire(import.meta.url)` 垫片，并在报告里点名 | 与 `tests/lib/eval-probe.js` 既有先例同款；不整树放垫片当糊 |
| 生成物 / 打包侧 | `deck/client.js`、`deck/host.js`、`deck/package/lib/**`（构建产出）与 `src/**`（esbuild 打包）不进迁移口径 | 前者由 `scripts/build.mjs` 重生成，后者由 esbuild 处理 |
| 开关 | **不许** `--experimental-*` | 票面明令；判据已钉（`tests/verify-gate-dialect.js` ③） |

## 2. 名单来源（为什么是「派生」的）

上游 deck 仓把**根 `package.json` gitignore 了**（`deck/.gitignore` 第 27 行 `/package.json`），
合并进本仓时它没被带进来。后果有两层，都是这次要治的：

1. `scripts/verify-chain.js` 读不到名单（ENOENT），`npm run verify:deck` 跑不起来；
2. 仓库惯例是「门禁自己断言已在 `npm run verify` 链里」（17 个文件这么做），读不到 `package.json`
   → 这些门禁在断言之前就 ENOENT 崩。

修法：**名单由文件系统派生，落盘成 `deck/package.json`**（仍是 gitignore 的本地派生件）：

- 工具：`node scripts/ensure-deck-manifest.mjs`（`--check` 判漂移 / `--print` 只打印）；
- 规则：门禁 = `tests/verify-*.js`（字典序），冒烟 = `tests/smoke-*.test.js`；
  **加了新的 `tests/verify-*.js` 就自动进名单**，不用手改；
- 内容：`{ name: dsh-mattpocock-skills-deck, private: true, type: "module", scripts: { verify, test:smoke } }`，
  `type` 必须是 `module` —— 写别的值会让本目录 900+ 个 `.js` 的方言整体翻面；
- `scripts/verify-chain.js` 每次运行前保证它是最新的（幂等），所以 `npm run verify:deck` 在任何一台干净机器上行为一致。

## 3. 判据与工具（五个脚本，都在 `deck/scripts/`）

| 脚本 | 干什么 | 用法 | 退出码 |
|---|---|---|---|
| `gate-dialect-scan.mjs` | 方言扫描：去注释去字符串后，找**没被本地声明绑定的** CJS 自由变量（`require()` / `module.exports` / `require.main === module` / `__dirname` / `__filename`） | `node scripts/gate-dialect-scan.mjs [--json] [--root tests] [--limit 20]` | 0 = 无欠账；1 = 有 |
| `migrate-cjs-to-esm.mjs` | 迁移器：按第 1 节口径机械改写；**干跑是默认**，`--apply` 才写盘（原件先备份到 `.tmp-esm-backup/`，`--rollback` 还原） | `node scripts/migrate-cjs-to-esm.mjs [--apply] [--only <子串>] [--json]` | 0 = 完成；1 = 有需人工的文件（干跑时列出） |
| `ensure-deck-manifest.mjs` | 名单派生与落盘（第 2 节） | `node scripts/ensure-deck-manifest.mjs [--check] [--print]` | 0 / 1（漂移） |
| `verify-chain.js` | 名单执行器：`--list` 列名单、`--only <子串>` 抽查、`--from N` 续跑；首红即停并透传退出码 | `node scripts/verify-chain.js --list` | 透传首红 |
| `gate-chain-audit.mjs` | 逐道审计：静态面判「能不能加载」，`--probe` 真起进程按 stderr 特征把「加载失败」与「跑起来但断言红」分开 | `node scripts/gate-chain-audit.mjs [--probe --limit 40 --timeout 60] [--json --out /tmp/a.json]` | 0 = 名单里无「代码欠账」；1 = 有 |

常驻门禁：`tests/verify-gate-dialect.js`（12 项，含两向反证）——钉住 ①`--list` 通 ②欠账 0
③名单一致且无 `--experimental-*` ④扫描器既不会恒绿（种 `require()` 必须判红）也不会恒红（种 `createRequire` 垫片必须放行）。

## 4. 迁移记录（2026-10-13）

- **真实欠账面**：票面 `grep -rl "require(\|module.exports"` = 261 个文件是**把注释也算进去**的数；
  去注释去字符串、且只看自由变量之后 = **254 个**（其中 233 个是 `tests/verify-*.js`），另 `src/**`/生成物 169 个不入迁移口径。
- **动作**：`migrate-cjs-to-esm.mjs --apply` 一次改写 254 个文件；全量 `node --check` 0 失败；
  重扫欠账归零（`cjs-in-esm` 0、`mixed` 0）。
- **体检口径**：`gate-chain-audit` 静态面 **310/310 道可加载**（名单含本票新增的门禁）。
- **回滚**：原件在 `deck/.tmp-esm-backup/`，`node scripts/migrate-cjs-to-esm.mjs --rollback` 还原；
  迁移器本身也做了两向反证（种下 `require()` 必判红、种下垫片必放行）。
- 两个文件本次带着**既存本地改动**一起提交：`tests/verify-587-update-live.js`、`tests/verify-update-panel.js`。

## 5. 逐道分类（验收第 2 条：环境缺件 vs 代码欠账，逐条点名）

抽查批次 = 4 道真渲染门禁 + 本票直接相关的 21 道。

**能加载且绿（16 道）**：`verify-640-dock-width-browser`、`verify-cap-fold-browser`、`verify-423-title-clamp`、
`verify-capsule-narrow`、`verify-subdir-first-frame`、`verify-3-workspace-switch`、`verify-596-rpc-carrier`、
`verify-655-setup-layout`、`verify-849-fs-absence`、`verify-964-same-key-ride`、`verify-965-admission`、
`verify-prompt-newlines`、`verify-818-version-control-view`、`verify-895-github-memo`、`verify-967-measure`、`verify-prompts`。

**仍红，且逐条写明是哪一类**（都是「能加载、断言红」——方言那半已不欠）：

| 门禁 | 类 | 根因（实测） | 怎么修 |
|---|---|---|---|
| `verify-423-title-clamp-browser` | **环境缺件** | `chromium.launch: Executable doesn't exist at ~/.cache/ms-playwright/chromium_headless_shell-1234` | 接上仓库已定的通道 `tests/lib/chromium-channel.js`（显式 `executablePath` 指 `chromium-1208` + `--disable-dev-shm-usage`） |
| `verify-deck-tools-row-zero-dep` | **环境缺件** | 开发依赖 `@deepseek-ai/dsh-tools` 未安装（`node_modules/@deepseek-ai/dsh-tools/lib/index.js` 不存在），断言「真原生判定可加载」因此红 | `npm install`（按 `devDependencies` 的 `0.2.0-rc.2`） |
| `verify-666-subws-mark-root` | **存量断言红**（与方言无关） | C10「写法不同就切不出来了：`d: › ILIFE › packages › skill-calorie`」——路径切分口径，量的是被测源码/产物，不是本票改的方言 | 单开一张票查路径切分；本票只保证它**能跑到断言**（63 项通过） |
| `verify-deck-tools-matrix` | **存量接线陈旧** | 断言红在 `missing-decideBackend`：门禁的 lane 装配没给 `src/shared/deck-tools/shell.js` 递 `decideBackend`（该文件本次只做了方言迁移，接线没动） | 把 `decideBackend` 接进 lane 装配（或按新契约重写夹具） |
| `verify-capsule-layout` / `verify-cap-fold` | **存量断言红**（与方言无关） | 渲染量测值异常（如「空隙」实测 100248.53px）；**这两个文件本次一个字没改**（`git diff` 可证） | 单开票查量测夹具；量的是 CSS/组件，不是方言 |
| `verify-no-same-layer-import` | **存量红**（开工前就在） | 两条同层边（2026-09-22 提交），`CHANGELOG` 已记为存量 | 按那张票拆边 |

> 「能加载」的判据：进程越过模块加载阶段、跑到自己的断言/输出。以上 7 道**都越过了**——
> 迁移前它们连加载都过不去（`ReferenceError: require is not defined in ES module scope`）。

## 6. 下一步（本票没做的，别当成做完了）

1. `verify-423-title-clamp-browser` 与其余浏览器门禁统一走 `chromium-channel`（本机 Playwright 默认 revision 不存在）。
2. `verify-deck-tools-*` 三道（matrix / row-zero-dep / host-wiring）的接线与依赖装齐后再跑一遍。
3. 全链体检：`node scripts/verify-chain.js`（310 道，含读数真实 `~/.config/gh/hosts.yml` 与联网的门禁）——
   本票只跑抽查批次，**没有宣称全链全绿**。
