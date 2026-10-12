# 合并工程「构建 / 发布形态」工作记录（构建负责人）

| 项 | 值 |
|---|---|
| 分支 | `feat/merge-skills-deck`（基线 `main` = `54a1a07`） |
| 主体仓库 | `/root/dsh-github-resident/dsh-github-resident` |
| 参考源仓（只读） | `/root/dsh-github-resident/dsh-mattpocock-skills-deck`，HEAD `3b25cd3f` |
| 本文件作者范围 | 根 `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `.gitignore` / `cordis.patch.yml` / `tools/merge/build-merge-entries.ts` / `tools/merge/merge-identity.ts` / `deck/scripts/**` / `deck/tests/**` / 根 `verify-*.mjs`、`verify-bundle.sh` / `tests/merge/build/**` / `tests/merge/run.mjs` |
| 最后一次全绿时间 | 2026-10-11 17:46–17:54 UTC（Node v24.19.0；`dist/client.js` 在 17:46 有他人在同仓重建过，见「待集成人项」第 4 条） |

> 说明：评估文档与实施计划是参考；本文件记录的是**实际跑出来的**命令、退出码与产物指纹。
> 本文只写构建/发布形态，不重复计划书内容。

## 0. 产物指纹（17:54 UTC 取样）

| 产物 | 大小 | sha256 前 16 位 |
|---|---|---|
| `dist/host.js` | 4 015 B | `154b66d4f786deb4` |
| `dist/client.js` | 2 287 422 B | `bdb6a8727db8a95b` |
| `npm pack` tarball | 2 776 777 B | `033b586dd5429c8d` |
| `bundled-skills/`（包根，27 技能） | 824 KB（109 个文件） | 与 `deck/package/bundled-skills/` 逐字一致 |

`dist/` 与包根 `bundled-skills/` 都是 `.gitignore` 里的构建产物（一源两物，不入库）；
`npm pack` 的 `files` 白名单会**覆盖根 `.gitignore`**（实测 `dist/` 被收进 tarball），
但**不会覆盖嵌套 `.gitignore`**（见第 2 节 B 项）。所以「入库」与「入包」是两件事，两份都按这里的结论对齐。

## 1. 环境限制（先读，否则构建必红）

**PRoot 下的原生 TypeScript（tsgo）**：本机是 Android + PRoot（`PROOT_L2S_DIR=/…/linux/ubuntu/.l2s`）。
PRoot 的 link2symlink 把硬链接文件在执行时替换成 `/.l2s/…-exec…` 桩，进程的 `/proc/self/exe`
因此指向 `/.l2s/…`。`typescript@7.0.2` 的原生 `tsc` 按自己可执行文件位置找 `lib.d.ts`，直接 panic：

```
panic: bundled: /.l2s/lib.d.ts does not exist; this executable may be misplaced
```

- 证据：`/tmp/merge-build-logs/02-deck-build.log`（红）；把同一份包 `cp -rL` 成真文件后执行正常（`Version 7.0.2`）。
- 处置：`pnpm-workspace.yaml` 里加 `packageImportMethod: copy`（真拷贝而不是硬链接）。
  只影响安装方式，不影响产物与行为；普通 Linux 主机上同样可用（想换回硬链接可删该项）。
- 佐证：`/tmp/merge-build-logs/03-pnpm-install-copy.log`（重装）→ `/tmp/merge-build-logs/04-deck-build.log`（deck 构建绿）。

**浏览器类门禁**：`deck/tests/*-browser.js` 要真 Chromium；`playwright` 以 `--ignore-scripts` 安装（没下浏览器内核）。
本容器不跑这些条目，也不自作截图；屏障后有浏览器的环境再跑（实施计划 §6.2 已列）。

## 2. 五项优先修正：落地与证据

### A. `dist/host.js` 的相对路径 / `merge-identity.ts` 泄漏

- 作者态已改为**运行期路径解析**（`tools/merge/host-assembly.ts` 从 `import.meta.url` 向上按
  `package.json.name` 找包根，再 `pathToFileURL` 动态导入两半），所以产物里不该再有任何相对说明符。
- 构建侧固化这条不变量：`build-merge-entries.ts` 的 `assertHostImportSafety()` 断言
  **每个导入说明符都必须是 `node:` 内建**，并核对导出形态（具名 `name`/`inject`/`apply`、
  无 `default`、`inject` 与 `MERGED_HOST_INJECT` 逐项含顺序一致）。相对路径一旦被重新写回产物，
  构建当场红，而不是装机后「工具全没了」。
- `bundle: false` 保留（不打包两半实现）；`merge-identity.ts` 不再出现在产物里（host 侧已不 import 它）。
- 证据：`/tmp/merge-build-logs/05-build-entries.log`（红：esbuild 的尾部 `export {}` 形态没被识别）
  → `/tmp/merge-build-logs/06-build-entries.log`（绿）→ `/tmp/merge-build-logs/07-check-entries.log`（`--check` 绿）。

### B. `files` 白名单与 exports 随包完整

- 根 `files` 补 `plugin.js`（`dist/host.js` 运行期按包根读它，漏了它等于 17 个 `gh_*` 全没）与
  `bundled-skills/`（见下）。
- **实测坑（重要）**：`deck/.gitignore` 的 `/package/lib/` 会让 `npm pack` **跳过**
  `deck/package/lib/**`，即使根 `files` 白名单写了它（嵌套 `.gitignore` 对 npm 一样生效；
  根 `.gitignore` 才会被 `files` 覆盖）。后果是 `exports["./tools"]` 指向一个不进包的文件。
  处置：`exports["./tools"]` 改指**源行模块** `./deck/src/host/platform/deckToolsRow.js`
  （`deck/src/` 本来就在包内；`deck/package/lib/` 是它的逐字拷贝，构建会校验两侧同 sha）。
  `cordis.patch.yml` 的行名 `@local/dsh-github-resident-v2/tools` 走 exports 解析，路径变化对它透明。
- **技能必须落在包根**：宿主按 `<包名>/bundled-skills` 找随包技能（`deck/src/host/bootstrap.js` /
  `skillDoc.js` 的候选根），而快照里的技能在 `deck/package/bundled-skills/`。构建把后者逐字复制到
  包根 `bundled-skills/`（27 个技能 + VERSION/LICENSE + README，109 个文件），`--check` 逐文件比对。
- 真包验证：`npm pack` → 解包 → 装成临时 fixture 的 `node_modules` 布局 → 真 `import`。
  证据：`/tmp/merge-build-logs/10-pack-contract.log`（首次红：探针在无 DOM 环境调客户端 factory）
  → `/tmp/merge-build-logs/11-pack-contract.log`（绿，66 项）。

### C. 统一客户端：两份真实输入

- 构建现在把 `deck/package/lib/client.js` 与根 `client.js` **两份**都传给
  `rewriteDeckClient(deckSource, residentSource)`（`tools/merge/client-factory.ts` 负责装进同一个
  `load`；少任何一半都会抛错）。
- 我改了构建的调用点与 `merge-identity.ts` 的输入常量（`DECK_CLIENT_SRC` / `RESIDENT_CLIENT_SRC`），
  **没有**改 `rewrite-deck-client.ts` / `client-factory.ts`（客户端作者的写范围）。
- 组合测试 `tests/merge/build/client-union.test.mjs`（jsdom + 记账式 `slots` stub）断言：
  一个装载点、id = 合并身份、`exports.inject` = 并集（含顺序）、apply 后 7 条注册全部到齐
  （Resident 的 `settings.section` 60/61；Deck 的 dock id/order 40、`settings.plugins.tab` 40、
  `tool.view.cordis` key `self`（RunPanel）、右栏 tab + title）、并且 `settings.section#dsws-settings-section`（order 18）**已不再注册**。
- 证据：`node tests/merge/build/client-union.test.mjs` 31 项全绿（`verify:merge` 内跑）。

### D. 根清单：依赖按真实使用收敛

| 处置 | 依据 |
|---|---|
| `yaml`、`dsh-plugin-update` 留在 `dependencies` | `deck/src/host/configStore.js`、`deck/src/shared/config-store/*.js` import `yaml`；`deck/src/host/updateFromPackage.js` import `dsh-plugin-update`（都在随包源码里，运行期要解析得到） |
| `dsh-log` 降到 `devDependencies` | 运行期用的是派生副本 `deck/src/host/logPkg/**`（随包）；`dsh-log` 只在构建（`derive-log-from-package.mjs`）与门禁里读 |
| 删掉 `ws` | 全仓随包源码零引用（`ws` 只在一处负例夹具字符串里出现）；`WebSocket` 用的是宿主全局 |
| `@deepseek-ai/dsh-tools` `0.1.7-rc.2` → `0.2.0-rc.2` | 它是 deck 门禁/devDependency；已装 DSH（`/usr/local/lib/.../dsh`）自带的是 `0.2.0-rc.2`，旧的 SDK 版本是合并清单里抄错的 |
| `engines.node: ">=22.18.0"` | 构建脚本走 Node 原生 TS 擦除（`node tools/merge/build-merge-entries.ts`），默认开启擦除需要 ≥22.18 |
| `engines.dsh: ">=0.2.0-rc.2"` | 与已装 DSH 版本一致；参照参考 Deck 的 `engines.dsh` 惯例 |
| 依赖集合按**扫描随包源码**求出（含动态 `import('…')` 字面量），不靠人工 grep 删 | `tests/merge/build/manifest-contract.test.mjs` 第 3 节：用到的第三方包 ⊆ dependencies，且 dependencies 里没有没人用的包 |

证据：`/tmp/merge-build-logs/09-manifest.log`（46 项，全绿 + 1 条 WARN）。

### E. 生命周期：不假装 nested `prepare`

- 事实：根 `package.json` **没有** `prepare`；`deck/` 也**没有**被当成 workspace 包
  （`pnpm-workspace.yaml` 的 `packages` 为空）。所以根 `pnpm install` **不会**触发 deck 的 `prepare`。
  deck 自己的 `deck/package.json` 有 `"prepare": "node scripts/build.mjs"`，那是快照原样保留的；
  一旦有人把 `deck` 加进 workspace，安装就会顺手构建——所以这条要在配置里挡住并且写清楚。
- 实际安装动作（**都是显式命令，不改全局配置、不改 profile 的 allowedBuilds**）：
  1. `pnpm install --ignore-scripts`（仓库根）→ 根 `node_modules` + **固化 `pnpm-lock.yaml`**（7 个直接依赖，71 个包）；
  2. `cd deck && pnpm install --ignore-scripts --config.package-import-method=copy` → `deck/node_modules`
     （deck 的 17 条门禁要读 `node_modules/dsh-log`、`node_modules/@deepseek-ai/dsh-tools` 等；
     `deck/pnpm-lock.yaml` 保持与参考源仓逐字一致，未被我改动）；
  3. `npm run build`（= `--build-all`：先 `deck/scripts/build.mjs`，再生成两个入口产物与技能副本）。
- 证据：`/tmp/merge-build-logs/01-pnpm-install.log`（EXIT 0）、`03-pnpm-install-copy.log`（EXIT 0）、
  `19-deck-install.log`（EXIT 0）、`22-build-all.log`（EXIT 0）。

## 3. 门禁与运行器

| 命令 | 结果 | 日志 |
|---|---|---|
| `npm run build` | EXIT 0 | `/tmp/merge-build-logs/22-build-all.log` |
| `node tools/merge/build-merge-entries.ts --check` | EXIT 0（产物与重算逐字一致 + 技能副本 109 文件一致） | `30-final-check.log` |
| `npm run verify:merge`（`node tests/merge/run.mjs`） | EXIT 0：13 个测试文件全绿（build 3 + host + client） | `31-final-runner.log` |
| `bash verify-bundle.sh`（默认档） | EXIT 0：8 PASS；**未读真实 profile、未打 31790** | `32-final-bundle.log` |
| `npm run verify:deck:smoke` | EXIT 1：**仅** `smoke-comment-passthrough` 5 项红，已有证据证明是快照既有问题（见下） | `33-final-smoke.log` |
| `node deck/scripts/verify-chain.js --only verify-build-artifacts` | EXIT 0 | `18-chain-verify-build-artifacts.log` |
| `node deck/scripts/verify-chain.js --only verify-deck-tools-row-zero-dep` | EXIT 0 | `21-chain-row.log` |
| `node deck/scripts/verify-chain.js --only verify-bundled-skills` | EXIT 0 | `16-chain-verify-bundled-skills.log` |
| `node verify-registry.mjs` / `node verify-logout.mjs` / `node verify-update-gc.mjs` | EXIT 0 | `38-*.log` / `40-*.log` |
| `node verify-ui.mjs` | EXIT 0（41 项；文案预算按合并后的正文调整，见第 4 节） | `39-verify-ui.log` |
| `node verify-gh-bootstrap.mjs` | EXIT 1：2 项红，**环境事实**——本容器没有系统 `gh`（`/usr/bin/gh` 不存在、`dpkg -l gh` 无记录），而这两条断言验的是「真 gh 仍在 PATH 之外未受影响 / 系统 gh 未被 dpkg 动过」。插件自带 gh 在 `~/.dsh/gh-cli/bin/gh`，不受影响 | `40-verify-gh-bootstrap.mjs.log` |
| `node verify-real-artifact.mjs` | **未跑**（唯一真联网的一条，实施计划 §6.2 已列） | — |

`verify-bundle.sh` 改造要点：默认用**临时 fixture profile**（`dependencies` 里放本包名 +
`node_modules/@local/<name>` 软链到本包），第 5 段回环接口默认 **SKIP**，只有显式
`--live-api`（或 `LIVE_API=1`）才按 `DSH_GH_API_PORT` 打真实端口；身份检查改看 `dist/client.js`。

`npm run verify` 现在是 `check:entries && verify:merge && verify:resident && verify:deck`——
新链插在两条既有链**前面**（既有两条一字未删）：这样新的合并契约先红先报，不会被
`verify:deck` 里与本合并无关的条目（浏览器/真实凭据类）挡住。只想跑新链用 `npm run verify:merge`。

`tests/merge/run.mjs` 隔离手段：每个测试子进程一份临时 `HOME`/`TMPDIR`/`XDG_*`，清
`GH_TOKEN`/`GITHUB_TOKEN`，`GH_CONFIG_DIR`/`GIT_CONFIG_GLOBAL` 指到临时文件，
`DSH_GH_REGISTRY_DIR`/`DSH_GH_DATA_DIR` 指临时目录并关掉启动即落地 gh / 探测远端 / 自动更新，
同时清掉 `DSH_PROFILE`/`DSH_PROFILE_DIR`（防止顺着环境变量摸到正在跑的 profile）。
退出码语义：0 全绿；1 有真红；2 有「被别的任务阻塞」；3 一个测试都没发现。

## 4. 已改的既有门禁（只改断言/取源，不改被测行为）

| 文件 | 改动 |
|---|---|
| `deck/tests/smoke-render.test.js` | 取源从 `package/lib/client.js` 改为合并产物 `../dist/client.js`；id 断言改合并身份；插槽断言 6 → 7（Deck 5 + Resident 2），并逐条核对 `settings.section` 的两个 id |
| `package.json` 的 `verify:deck:smoke` | 原来从仓库根直接 `node deck/tests/…`，这些测试按 `deck/` 为 cwd 读路径，必然 ENOENT；改成 `cd deck && …` |
| `verify-ui.mjs` 的登记库页文案预算 | 400 → 480（实测 432）。理由：按实施计划 ⑦⑧⑨⑩ 并入了 Deck 的 4 个区块，正文是**合并本身**带来的，不是这页自己长胖；留 ~11% 余量，仍能拦「继续堆文案」。数值与理由写在 `verify-ui.mjs` 的注释里 |
| `verify-bundle.sh` | 隔离化改造（见上）；`node --check` 目标改为 `plugin.js` / `dist/host.js` / `dist/client.js` |

## 5. 待集成人处理（不在我的写范围内或需要跨任务决定）

1. **`deck/package.json` 会被 git 漏掉**：`deck/.gitignore` 第 27 行 `/package.json` 把
   `deck/package.json`（deck 构建/237 条门禁的读取对象）排除在外，而它现在还没被 track。
   根 `.gitignore` **无法**反向覆盖嵌套规则。请在提交 `deck/` 前 `git add -f deck/package.json`，
   或删掉 `deck/.gitignore` 第 27 行。`tests/merge/build/manifest-contract.test.mjs` 第 7 节会持续 WARN 提醒。
2. **`npm run verify:deck` 全链（237 条）我没跑**：其中含读真实 `~/.config/gh/hosts.yml`、
   `.git-credentials` 的条目与 14 个 Playwright 浏览器条目（实施计划 §6.2）。屏障后请在隔离环境跑，
   并把浏览器条目按有/无 Chromium 分别记录。
3. **`smoke-comment-passthrough` 的红是快照既有问题，不是合并回归**：
   我把只读参考源仓整份复制到 `/tmp/pristine-deck`（symlink 本仓 node_modules）、按原样构建后跑同一条测试，
   得到**完全相同**的 5 项失败（`/tmp/merge-build-logs/29-pristine-comment.log`）。
   实际回包是「工作区还没就绪」而不是测试期望的 `error.kind`——该冒烟没有提供 cwd/工作区服务，
   与被合并的两半无关。要不要修、怎么修（补 stub 还是改断言）请 H/主代理定，我不改被测行为、也不把它标成预期。
4. **`dist/client.js` 在 17:46 有他人重建**（`deck/package/lib/client.js` 从 1.88 MB 变 2.26 MB）：
   与「只有构建负责人生成公共产物」的分工不一致。我随后跑了 `--check`（EXIT 0，产物与**当前**输入一致）
   与全部门禁（绿），但**最终 public 构建仍建议由我一个人在 barrier 后重跑一次**，避免两人各写一次产物。
5. **`deck/package.json` 的 `type` 未声明** → 运行期 `deck/src/host/index.js` 会被 Node 重新按 ESM 解析并打
   `MODULE_TYPELESS_PACKAGE_JSON` 警告（仅性能提示，功能正常）。**不要**给 `deck/package.json` 加
   `"type": "module"`：`deck/scripts/verify-chain.js` 用 `require()`，加了会直接把链打断。
6. **`files` 里保留 `deck/package/lib/` 等**：它们在 tarball 里会被嵌套 `.gitignore` 剔掉（见 B 项）。
   我没有删这些条目（删除也改变不了打包结果，且 deck 子包自己的发布仍需要这棵树），
   但要知道「写了不等于进包」——真正的判据是 `tests/merge/build/pack-contract.test.mjs`。

## 6. 不变量核对（构建视角）

| 不变量 | 现状 |
|---|---|
| 单根安装包 `@local/dsh-github-resident-v2`、private | `package.json` name/private ✓；`engines.dsh`/`node` ✓ |
| 27 技能 + `readDoc` 的文件面 | 包根 `bundled-skills/` 27 目录、每个含 `SKILL.md`（frontmatter `name` 与目录同名）、`VERSION`/`LICENSE`；`deck/package/bundled-skills/` 也在包内 |
| `plugin.js`（Resident 宿主实现）随包 | `files` 白名单含 `plugin.js`；pack 后实测 127.8 KB ✓ |
| `exports["."]`/`./client`/`./tools`/`./deck`/locale/patch 全可解析 | 在临时 fixture 的 node_modules 布局里逐个 `require.resolve` + 真 `import` ✓ |
| clock/Registry 授权、凭据、GitLab 等行为 | 构建侧未触碰（本文件不涉及）；相关门禁仍由 `verify:resident` / `verify:deck` 覆盖 |
| 两条既有检查链保留 | `scripts.verify:resident` 原样保留（6 个脚本 + `verify-bundle.sh`）；`scripts.verify:deck` 原样保留；新增 `verify:merge` 不替代它们 |
| 不 commit / 不 push | 本工作未执行任何 git 写操作；`pnpm install` 只写 `node_modules` 与 `pnpm-lock.yaml` |

## 7. 复现命令（从零到绿）

```bash
cd /root/dsh-github-resident/dsh-github-resident
pnpm install --ignore-scripts                    # 根依赖 + pnpm-lock.yaml
(cd deck && pnpm install --ignore-scripts --config.package-import-method=copy)   # deck 门禁要读的 node_modules
npm run build                                    # deck 构建 + 入口产物 + 技能副本
node tools/merge/build-merge-entries.ts --check  # 产物与重算逐字一致
npm run verify:merge                             # tests/merge 全量（隔离运行器）
bash verify-bundle.sh                            # 默认隔离 fixture，不碰真实 profile/端口
npm run verify:deck:smoke                        # 已知：comment-passthrough 5 项红（快照既有）
```
