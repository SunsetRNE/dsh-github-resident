# 合并实施计划：Deck 并入 Resident（单包 `@local/dsh-github-resident-v2`）

> 历史材料：本文的独立回环端口与 `DSH_GH_API_PORT` 方案已退役。当前面板、脚本均走宿主 RPC `/api/dsws` 的 `ghr.*` 端点；此处保留旧测量与决定的原文供追溯，现行清单以 `gh_protocol.http` 为准。

| 项 | 值 |
|---|---|
| 规划日期 | 2026-10-11（UTC） |
| 合并分支 | `feat/merge-skills-deck`（从 `main` 的 `54a1a07` 分出，不覆盖任何既有分支） |
| 主体仓库 | `/root/dsh-github-resident/dsh-github-resident` |
| 参考源仓（只读） | `/root/dsh-github-resident/dsh-mattpocock-skills-deck`，HEAD `3b25cd3f` |
| 规划依据 | [`merge-deck-assessment-2026-10-11.md`](./merge-deck-assessment-2026-10-11.md)（用户接受的规划）＋ 三份证据底稿 |
| 本阶段性质 | **骨架 + 可执行分工**。宿主落地、客户端落地、构建与门禁**均未完成**，见第 4 节「仍是空壳的东西」 |
| 数字来源 | 本文所有数量、id、路径均取自本机源码实测；与评估文档不一致处以本文（源码实测）为准，逐条在第 1 节标注 |

---

## 1. 源码实测基线（不盲从文档）

### 1.1 已核对为真的事实

| 事实 | 实测结果 | 与评估文档的差异 |
|---|---|---|
| 工具面 | 运行清单里 `gh_*` **17** 个、`deck_*` **10** 个（9 业务 + `deck_probe`），交集为空，共 **27** | 与文档一致 |
| Resident 入口形态 | 根 `plugin.js` 是 **ESM 具名导出** `{ name, inject, apply }`，**没有 default export**；`client.js` 是手写 `window.__ModuleLoader__.load({ id, factory })` | 文档未点明「无 default export」——这一点决定了宿主装配层必须包装具名导出 |
| Deck 宿主入口形态 | `deck/src/host/index.js` 是 `export default { name, inject, apply }`；行模块 `deck/src/host/platform/deckToolsRow.js` 是具名导出 `{ name, inject, apply }` | 一致 |
| Deck 客户端产物 | `deck/scripts/build.mjs` 拼出 `deck/package/lib/client.js`（实测 2 128 355 字节），里面**恰好 1 次** `window.__ModuleLoader__.load(` | 一致 |
| Deck 构建的 4 个核心源码树 | 在**仓库根**（`label-color-core/`、`refresh-core/`、`version-control-core/`、`config-store-core/`），不在 `src/` 下；`build.mjs` 的 `ROOT` = `scripts/` 的上一级 | 文档提到核心目录但未点明「因此不能只搬 `src/`」 |
| Deck 构建的 2 个派生输入 | `deck/scripts/generated/logKernel.derived.js`（入库）、`updateClient.derived.js`（入库）、`updateEntryPanel.bundle.js`（**构建期从已安装的 `dsh-plugin-update` 现场生成，不入库**） | 文档未提第 3 个是构建期生成物 |
| Deck 技能发现路径 | `bootstrap.js` 与 `skillDoc.js` 的候选根**硬编码包名** `dsh-mattpocock-skills-deck` 共 7 处 | 一致（约 20 处运行标识的总数偏保守，实测已列出见 3.1） |
| 门禁规模 | `deck/package.json` 的 `verify` 链 **237** 条；`test:smoke` **6** 条；`tests/` 共 **330** 个 `.js` | 文档写「327」——实测口径不同（330 是文件数，237 是链条数），以本文为准 |
| 环境变量边界 | Resident 用 `DSH_GH_*`（14 个）；Deck 只用 `DSH_GH_PATH` 与 `GH_HOST` | 一致 |
| `deck/package.json` 与 `deck/package/package.json` | 都保留旧包名，且都被构建/门禁读取 | 文档未提「两个旧包名字面量都不是本包名」这个反直觉点 |

### 1.2 因实测而改掉的做法

1. **不改 `deck/package.json` 的包名。** 它是 `build.mjs` 的 `createRequire` 锚点、版本注入源与十余条门禁的读取对象；改名要连带改构建与门禁，收益为零。真正生效的身份是仓库根的 `package.json` + `cordis.patch.yml` + `tools/merge/merge-identity.ts` 三处。
2. **不给 `deck/` 加第二份根级 manifest。** 同目录下已存在 `deck/package.json`，再加 `deck/package.merged.json` 只会制造第三份可能漂移的身份来源。
3. **不把 Resident 的 `plugin.js` 搬进 `src/`。** 它是原样发布的 127 KB 文件，搬运会一次性打断 `verify-*` 里的路径断言；装配层包一层具名导出即可，见 [`tools/merge/host-assembly.ts`](../tools/merge/host-assembly.ts)。
4. **客户端不重做构建管线。** deck 的 2 MB 客户端由 12 个 kernel 片段 + 叶子 + 4 个生成物拼成，重做等于重写 deck 的构建。改为在**两个唯一锚点**上做最小改写，见 [`tools/merge/rewrite-deck-client.ts`](../tools/merge/rewrite-deck-client.ts)（已有正负例实测，见第 5 节）。

---

## 2. 已定死的接口（三个人都不许各自改）

### 2.1 身份：三处必须逐字相同

`@local/dsh-github-resident-v2`

| 位置 | 内容 |
|---|---|
| 根 `package.json` → `name` | `@local/dsh-github-resident-v2` |
| 根 `cordis.patch.yml` → 主行 `name` | `@local/dsh-github-resident-v2` |
| `dist/client.js` → `load({ id })` | `@local/dsh-github-resident-v2` |

真源常量：`MERGED_PACKAGE_NAME`（[`tools/merge/merge-identity.ts`](../tools/merge/merge-identity.ts)）。

**不跟着改的串**（改它们等于让用户既有布局/选择/偏好一起失效）：
dock 槽位 id `dsh-mattpocock-skills-deck`、右栏 tab 类型 id/kind
`dsh-mattpocock-skills-deck/deck:map` 与 `dsh-mattpocock-skills-deck:deck-map`、
`choices.json` 的 workspace 键、localStorage 的 8 个 `dsws.*` 键。

### 2.2 三层 inject（**不合并成一组**）

| 层 | 位置 | 值 |
|---|---|---|
| 包级 `dsh.client.inject`（包名依赖） | 根 `package.json` | `['@deepseek-ai/dsh-client-ui-settings-general']` |
| 客户端导出 `inject`（服务名依赖） | `dist/client.js` 内 `exports.inject` | `['connection','slots','locale','workspaces','sessions']` |
| 宿主插件 `inject` | `dist/host.js` 内导出的 `inject` | `['tools','connection','llm','sessionQuery']` |

真源常量：`MERGED_CLIENT_INJECT`、`MERGED_HOST_INJECT`。

### 2.3 包导出面（**新增即破坏，删除即破坏**）

```
".":                  ./dist/host.js                                    ← 宿主入口（构建产物）
"./client":           ./dist/client.js                                  ← 客户端（构建产物，全包唯一）
"./tools":            ./deck/package/lib/platform/deckToolsRow.js       ← 行模块（构建产物）
"./deck":             ./deck/src/host/index.js                          ← 回滚/兼容用的原始宿主半边
"./cordis.patch.yml": ./cordis.patch.yml
"./package.json":     ./package.json
"./locale/*.json":    ./locale/*.json
```

`dist/host.js` **只 re-export**，不复制实现：`plugin.js`（Resident）与
`deck/src/host/index.js`（Deck）仍是各自实现的唯一所在。

### 2.4 对外契约冻结（任何任务都不许动）

- 17 个 `gh_*` 名字/参数/返回、`{protocol, ok}` 信封、`gh_protocol` 的 id 与旧字段（`dsh-github-resident/6`）
- 9 个 `deck_*` 业务工具 + `deck_probe`（**探针不得降级为可选**）
- Host Service `githubResident`（10 方法）、回环 HTTP `127.0.0.1:31790` 的 13 条路由
- 登记库落盘 schema v2 与 `grants[]{root,depth,grantedAt,via,tool}`；授权闸门是写路径唯一入口
- `via` 值域（`tool:consent:true`、`ui:registry-panel`）不得扩展成模糊新值
- `revoke` / `purge{confirm}` / `uninstall_gh` / `remove_gh_config` 的显式开关语义
- 右栏 tab id/kind、dock id、`tool.view.cordis` key `'self'`、`SetupCard` 仍在 dock 模态座位
- 55 条 `wf.*` + `skill.readDoc`
- 27 个随包技能与 `skill.readDoc` 的发现路径

### 2.5 共享入口文件：**三个人都不写，集成人最后写**

下面这几个文件同时被两个以上任务需要，谁先写谁就把对方的分支冲突掉。它们由**集成人在三个任务全部交付后单独一次写入**，写之前先跑 `npm run check:entries`：

| 共享入口 | 会被谁需要 | 集成人写什么 |
|---|---|---|
| `deck/src/host/index.js` | 任务 H（改身份串与技能根） | 只改 `name` 与 7 处候选根；`apply` 结构不动 |
| `deck/src/client/panelAssembly.js` | 任务 C（删一条注册、保留一条） | 删 `settings.section#dsws-settings-section`，保留 `settings.plugins.tab#dsws-settings` |
| `deck/src/client/views/SettingsPage.js` | 任务 C | 4 个区块搬家；不再新增第二个更新入口 |
| `deck/scripts/build.mjs` | 任务 B（构建）＋任务 C（客户端 identity 注入点） | 只在 `buildClient` 里把客户端 `id` 与 `inject` 改为从 `tools/merge/merge-identity.ts` 取值 |

> 任务 C 的**主体**（`SettingsWorkspaces.js`、`DiagnosticsSection`、`AuthorLinks`、`UpdateEntryHost.js`、`kernel/config.js`）不与任何人共享，可独立完成；共享的四行改动交集成人。

---

## 3. 剩余工作的三个并行任务

三个人**同时开工**，写范围互不重叠；`deck/` 下的共享入口文件按 2.5 交给集成人。
每个任务都先在**本仓内本地构建**验证，不等依赖安装：`node deck/scripts/build.mjs` 与
`node tools/merge/build-merge-entries.ts` 都有明确失败信息，不需要 profile 环境即可跑。

### 任务 H —— 宿主落地 + 27 工具全注册

**目标**：在合并身份下，`gh_*` 17 + `deck_*` 9 + `deck_probe` 全部注册且各出现一次；27 个随包技能可发现；`/tools` 行默认保留。

**交付物（可判定的验收）**

1. `deck/src/host/index.js` 的 `name` 改为合并包名（**由集成人写**，任务 H 提供 patch 片段与核对清单）。
2. 技能发现候选根：`deck/src/host/bootstrap.js` 与 `deck/src/host/skillDoc.js` 的 7 处候选里，`node_modules/<包名>/bundled-skills` 一律改为合并包名；**保留**原包名候选**不加**（避免装回旧包）。
3. `deck/src/host/updateFromPackage.js` 的 `UPDATE_PLUGIN_ID` 指向合并包名；`DEFAULT_TARGET_PACKAGE` 随之变化。**并落实一条纪律**：private 本地包不得声称 npm 可更新——更新入口的行为文案与失败路径要如实说「本包为本地 private 包，更新走源码/重新安装」。
4. `deck/src/host/rpcChannel.js` 的 `MANIFEST_NAME` 改为合并包名。
5. `deck/src/host/platform/deckToolsRow.js` 的 `name` 改为 `@local/dsh-github-resident-v2/tools`（与 `cordis.patch.yml` 的行 `name` 逐字一致——注意是**子路径行**，不是裸名行）。
6. 工具不重名核对：断言 27 个名字两两不同、`gh_*` 与 `deck_*` 交集为空、每个名字只注册一次。
7. **不得**在这条路上给 `deckProbe` 加"可选/可删"分支。

**不重叠写范围**：`deck/src/host/**`（除 `index.js`、`skillDoc.js` 由集成人改的部分）

**依赖**：无（可立即开工）。**接口输入**：`MERGED_PACKAGE_NAME`、`MERGED_HOST_INJECT`。

---

### 任务 C —— 客户端落地 + 设置页合并

**目标**：一个客户端脚本、`settings.section` 两页（`github-resident` 60 / `github-repo-registry` 61）、dock 与右栏与 Run 卡保留、Deck 的 4 个区块搬进登记库页、作者页独立、GitHub 账号页不动。

**交付物（可判定的验收）**

1. `deck/src/client/panelAssembly.js`：删 `settings.section#dsws-settings-section`（order 18）；保留 `settings.plugins.tab#dsws-settings`（order 40）作为兼容入口；**保留** `conversation.input.dock`（id `dsh-mattpocock-skills-deck`, order 40）、`tool.view.cordis`（key `'self'`）、`sidebar.right.pane.tab` 两个 keyed 槽。**由集成人写**。
2. `deck/src/client/views/SettingsPage.js`：把 4 个区块搬进「仓库登记库」页的分区，且**不新增第二个更新入口**：`UpdateEntryHost` 仍只出现一次，版本号显示合并包身份。
3. 分区落点与命名（逐字，供任务 B 的门禁对照）：
   - ⑦ `工作区与插件` → `SettingsWorkspaces`（默认收起、纯只读、按钮叫「刷新工作区总览」）
   - ⑧ 更新入口行为说明（挂在 ① 的版本号旁，不是第二入口）
   - ⑨ `诊断与日志`：主开关 + 导出 / 打开位置 / 复制路径 / 清空（清空带行内二次确认）
   - ⑩ 作者其他插件（默认折叠 `<details>`，保留不删）—— **已作废**：1.8.2 决定整块删（用户要求），
     连同 4 条写死外链与 `more.*` 语言键一并移除；本行保留为当时的计划记录，实况见 `deck/CHANGELOG.md` 的 1.8.2 条目。
4. **两个「刷新」必须分别命名**：「刷新登记快照」会写库快照（`POST /registry/build?rescan=1&consent=1`），「刷新工作区总览」只读。文案不得互换。
5. busy 模型并存：Resident 是「每个动作一个 tag、只禁自己」，Deck 调试组是「一个 `dbgBusy` 禁全组」——两套并存时不得互相禁用。
6. 文案纪律：登记库页只说「登记库 / 建库许可」，不说「未授权/已授权」；GitHub 账号页继续只说账号凭据。
7. **不承诺 GitLab**：界面与文案维持「全力支持 GitHub issue；Markdown 为预览版；GitLab 暂不支持」的原话，不得升级承诺。
8. 3 个错名主题 token（`--dsw-alias-state-warning-primary`、`-interactive-bg-primary`、`-markdown-heading`，共 9 处）改用真实 token；真名以 `client/Theme.listTokens` 的一次查询为准，不猜。

**不重叠写范围**：`deck/src/client/views/**`（除 `SettingsPage.js`）、`deck/src/client/kernel/**`

**依赖**：无（可立即开工）。**接口输入**：`MERGED_PACKAGE_NAME`、`MERGED_CLIENT_INJECT`。
**注意**：`deck/src/client/kernel/config.js` 被本任务与面板本体共用——**只许本任务写**（它是 kernel 下的文件，别人不要动）。

---

### 任务 B —— 构建链、隔离测试设施与契约门禁

**目标**：`npm run build` 可复现；两套门禁能在**隔离环境**里跑；合并后的身份/契约有机器判据，不靠人眼。

**交付物（可判定的验收）**

1. 构建链固化：`npm run build` = `node tools/merge/build-merge-entries.ts --build-all`（先 deck 构建，再生成两个入口产物）。`npm run build:entries` 只重生成入口；`npm run check:entries` 是只读比对，产物与重算结果必须逐字一致（防手改产物）。
2. 契约测试目录 `tests/merge/`（**新建**，与 `deck/tests/` 不同目录），至少覆盖：
   - 身份三处逐字一致（根 `package.json` / 根 `cordis.patch.yml` / `dist/client.js` 的 `load({id})`）
   - `dist/host.js` 导入后导出形状为 `{ name, inject, apply }`，且 `inject` 等于 `MERGED_HOST_INJECT`（顺序也断言）
   - `dist/client.js` 导出的 `inject` 逐项等于 `MERGED_CLIENT_INJECT`（顺序也断言）
   - **`MERGED_CLIENT_INJECT` 的并集正确性**：断言 Resident 客户端只用到 `slots`（`client.js` 里 `ctx.*` 只出现 `ctx.slots`）。**为什么要这条**：deck 自己的 5 项 inject 与合并后的并集**当前逐字相同**，所以客户端改写里的 inject 那一步在今天是**恒等替换**——它不会挡住「Resident 半边将来新增了一个服务依赖却没并进常量」这类漂移。这条断言把那个洞补上：一旦 Resident 客户端开始用别的服务，`ctx.*` 集合变化，门禁就红
   - 客户端改写模块的正例 + 3 个负例（load 出现 2 次 / id 锚点缺失 / inject 锚点缺失 → 必须抛）
   - `/tools` 行模块**零框架引用**（不 import 任何 `@deepseek-ai/*`，也不 import 工具包）
   - 27 个技能目录数、`package/bundled-skills/VERSION` 与 `LICENSE` 存在
   - 登记库授权闸门：未授权 `build` 时磁盘 0 字节、只回 `{consentRequired:true, ask}`
3. `deck/tests/verify-496b-inject-guard.js` 与 `deck/tests/verify-646-native-tab.js` 的 id/槽位断言同步到合并身份（**只改断言，不改被测行为**）。
4. 隔离测试设施文档 + 可执行脚本 `tests/merge/README.md` 与 `tests/merge/isolated-env.sh`（只写不跑；P6-0 阶段执行）。
5. 依赖安装门禁：记录 `pnpm install` 会触发 `prepare` → `deck/scripts/build.mjs` 这一副作用，并要求安装前先确认 `esbuild` 可解析。

**不重叠写范围**：`tools/merge/build-merge-entries.ts`、`tests/merge/**`、`docs/merge-implementation-progress.md` 的「门禁」一节、`deck/tests/verify-496b-inject-guard.js`、`deck/tests/verify-646-native-tab.js`

**依赖**：无（可立即开工）。**接口输入**：`tools/merge/*.ts` 的全部导出。

---

### 3.4 集成人（Lead）在三个任务之后单独做的收尾

按 2.5 的顺序，**一次一个人写**，每次写完立刻 `npm run check:entries`：

1. `deck/src/host/index.js`（任务 H 的 patch 片段）
2. `deck/src/client/panelAssembly.js`（任务 C 的 patch 片段）
3. `deck/src/client/views/SettingsPage.js`（任务 C 的主体也可能在这里落地）
4. `deck/scripts/build.mjs`（把客户端 id/inject 改为从 `merge-identity.ts` 取值）
5. 跑 `npm run build` 并提交 `dist/` 变更；跑 `npm run check:entries` 与 `npm run verify:resident`
6. 更新 `docs/merge-implementation-progress.md` 的门禁表

---

## 4. 仍是空壳的东西（**不得当成已完成**）

| 项 | 现状 |
|---|---|
| `dist/host.js`、`dist/client.js` | **不存在**。文件已 gitignore；要跑 `npm run build`（先 `pnpm install`）才会出现 |
| 宿主落地（身份串、技能根、更新 id、行模块名） | **一处未改**。`deck/src/host/**` 仍是原样快照 |
| 客户端落地（删注册、合页、token 改名） | **一处未改** |
| `deck/package/lib/**` 等 deck 构建产物 | **不存在**（原仓也 gitignore） |
| 两套门禁 | **未在合并形态下跑过**。`verify:deck` 目前会在第 2 条失败（缺构建产物），不是回归 |
| `tests/merge/` 契约测试 | **不存在**，属任务 B |
| 隔离 profile 的互斥激活验证、真机渲染、深浅色、双语混排 | **完全未做**，属 P6-0/P6-1 |
| `pnpm-lock.yaml`（本仓自己的） | **不存在**。首次安装会生成；在此之前构建不可复现 |
| `deck/package.json` 的 `prepare` 与 `deck/scripts/build.mjs` | 原样保留：**安装依赖会自动触发 deck 构建**，这是刻意的，但必须在安装前知情 |

---

## 5. 本阶段已实测通过的骨架行为

| 检查 | 结果 |
|---|---|
| 合并分支创建不覆盖既有分支、保留 4 份文档 | `git checkout -b feat/merge-skills-deck`，`git status` 里 `docs/` 仍在未跟踪状态，未提交 |
| `node --check` 三个新 `.ts` 文件 | 全部通过（Node 24.19 原生擦类型执行，不需要 ts-node） |
| 客户端改写模块对**真实 deck 产物**运行 | `id` 与 `inject` 各替换 1 处，2 128 355 → 2 128 358 字节；合并 id 就位、dock 槽位 id 保留、旧模块 id 消失 |
| 客户端改写 3 个负例 | 全部按预期抛错（load 出现 2 次 / id 锚点缺失 / inject 锚点缺失） |
| 27 工具清单（当前运行态） | `gh_*` 17、`deck_*` 10、交集空 —— 这是**当前双插件**形态的读数，不是合并后的读数 |
| deck 门禁链可离线启动 | `node deck/scripts/verify-chain.js` 在无 `node_modules` 下跑到第 2 条才因缺构建产物而红；说明链本身不依赖 profile |

---

## 6. E. 安全的基线检查：可离线跑 / 会碰外部的命令

> 判据：**「只跑本仓文件、只写临时目录或 `./.tmp`」= 可离线跑**；
> **「读真实 HOME / gh / git 配置 / 绑真实端口 / 发网络」= 必须隔离**。
> 只跑前者，不跑后者。

### 6.1 可以在当前容器直接跑（不碰网络、不碰真实 HOME）

| 命令 | 说明 |
|---|---|
| `node --check <file>` | 语法检查 |
| `node deck/scripts/verify-chain.js` | deck 的 237 条门禁链执行器。实测不依赖 `node_modules` 即可启动（个别条目在构建产物缺失/依赖未装时才红） |
| `node deck/scripts/build.mjs` | deck 构建。**副作用**：写 `deck/client.js`、`deck/host.js`、`deck/package/{lib,shared,scripts}`、`deck/scripts/generated/updateEntryPanel.bundle.js`，全部在本仓内且已 gitignore。需要 `esbuild`（`updateEntryPanel.bundle.js` 那条分支） |
| `node tools/merge/build-merge-entries.ts [--check]` | 本仓入口产物生成/比对。写 `dist/`，已 gitignore |
| `node deck/tests/smoke-*.test.js` | jsdom 冒烟，读 `deck/package/lib/client.js`。需要 `jsdom`、`react`（`devDependencies`） |
| `node verify-ui.mjs`、`node verify-registry.mjs`、`node verify-logout.mjs`、`node verify-update-gc.mjs`、`node verify-gh-bootstrap.mjs` | **实测这五个自己就把夹具隔离好了**：`os.homedir()` monkey-patch + `os.mkdtemp(os.tmpdir())` + `GIT_CONFIG_GLOBAL` + `DSH_GH_REGISTRY_DIR`/`DSH_GH_DATA_DIR`/`DSH_GH_API_PORT` + 本地假 release 服务器。**例外见 6.2 的两条** |
| `bash verify-bundle.sh <BUNDLE_DIR> <PROFILE_DIR>` | **必须显式传两个参数**。不传就用 `$DSH_PROFILE_DIR`（真实 profile） |

> 上表「可以跑」的前提是**没有网络也能跑完**：实测 `verify-real-artifact.mjs` 是唯一真的要联网的那条，见 6.2。

### 6.2 会碰网络 / 真实凭据 / 真实全局数据的命令（**本阶段一律不跑**）

| 命令 | 为什么危险 |
|---|---|
| `npm run build` | 依赖 `pnpm install`；pnpm 的 `prepare` 会触发 deck 构建（预期内），但**首次安装要联网** |
| `pnpm install` / `npm install` | 联网取包；并触发上述 `prepare` |
| `bash verify-bundle.sh`（不传参） | 默认读真实 `$DSH_PROFILE_DIR`，并打真实 `127.0.0.1:31790`（实测它里面有 1 处硬编码 31790、0 处临时目录隔离——**这是本仓门禁里唯一会打到真实运行实例的一条**） |
| `bash tools/account-ui-check.sh` | 打真实 `127.0.0.1:31790` 与 GUI `127.0.0.1:3080`，读 `/root/dsh-web.log` |
| `node verify-real-artifact.mjs`（默认档） | **唯一真的联网下载**的一条（`api.github.com` 3 处 + 真实 release 资产）；`DSH_GH_STRICT=1` 时断网即失败。要跑必须 `DSH_GH_TAG=<固定 tag>` 并接受它会出网 |
| `node verify-gh-bootstrap.mjs` | 脚本自带本地假 release 服务器（`DSH_GH_RELEASE_API` 指向 127.0.0.1 临时端口），**默认档不出网**；但若环境里已有真 gh，它会走到真实落地路径，隔离环境里要确认 `PATH` 干净 |
| `npm run verify:resident` 整条 | 含上面几条，**只在隔离环境跑** |
| `deck` 的 `sync:matt`、`update:latest` | 联网抓上游技能 / 升级依赖 |
| `deck/scripts/wizard-*.sh`、`publish-*.ps1`、`create-release-issue.mjs`、`star-history.mjs` | 发 npm 包 / 建外部 issue / 写仓库 —— **不属于本仓任何 npm script** |
| `deck/tests/*-browser.js` 等 14 个 playwright 条目与 `verify-839-credential-exec.js`、`verify-847-stall-watch.js` | 起真浏览器 / 读真实 `hosts.yml`、`.git-credentials` |
| `node deck/scripts/verify-chain.js --only <含 browser 的条目>` | 同上，按子串过滤时必须避开这些名字 |

### 6.3 隔离测试环境的硬要求（P6-0 用，本阶段只写不做）

**已具备的部分**：Resident 的五个 `verify-*.mjs` 已经自己实现了第 1–5 条中的大部分
（monkey-patch `os.homedir()` + `os.mkdtemp` + `GIT_CONFIG_GLOBAL` + `DSH_GH_*` 环境变量）。
合并后要补的是**下面这些还没人做**的部分：

1. **独立子进程 + 独立 `HOME`**：`HOME=<tmp>`。Resident 与 Deck 都从 `os.homedir()` 推状态路径；
   `deck` 侧还直读 `process.env.HOME`/`USERPROFILE`，靠 profile 开关是替代不了的。
2. **独立端口**：`DSH_GH_API_PORT=<高位空闲端口>`（替代真实 31790）。Resident 的五个脚本已这样做；
   ``bash verify-bundle.sh`` 还没有，必须显式传参或改脚本。
3. **独立登记目录与数据目录**：`DSH_GH_REGISTRY_DIR`、`DSH_GH_DATA_DIR` 指向临时目录。
4. **断网或禁副作用**：`DSH_GH_NO_BOOTSTRAP=1`、`DSH_GH_NO_STATE_CHECK=1`、`DSH_GH_NO_UPDATE=1`
   （避免启动即落地 gh / 探测远端）。
5. **禁用真实全局 GitHub 凭据**：`GH_TOKEN`、`GITHUB_TOKEN`、`GH_CONFIG_DIR`、`GIT_CONFIG_GLOBAL`
   全部指向测试值或清空；**不得把真实凭据文件当夹具**（评估 §8 前置纪律）。
6. **不启动替代 Web 服务器**：当前 GUI 是 `127.0.0.1:3080`，隔离测试不得另起一个。
7. **`deck` 侧测试的端口**：实测 11 处 `listen(0)` 是临时端口，天然不冲突；但仍要套上第 1、5 条。
8. **`PATH` 要干净**：`verify-gh-bootstrap.mjs` 与任何走 gh 解析的路径，在环境里已存在真 gh 时
   会走真实落地分支——隔离环境要显式清 `PATH` 或提供假 gh。

---

## 7. 不变要求清单（复述，供验收对照）

17 个 `gh_*` + 9 个 `deck_*` + `deck_probe` 全保留 · 27 技能发现与 `readDoc` · 右栏 id/kind/布局、
Dock、RunPanel、SetupCard 保留 · Deck 设置区块并入 Resident 的 `github-repo-registry`，
GitHub 账号页独立 · 默认不搬用户存储、不清凭据 · `workspace.yaml` 与 Markdown `label-colors`
有真实生产路径，`settings.yaml` 适配器未接线（不得写成已接线）· GitLab 暂不支持不得升级承诺 ·
更新入口不能装回旧 Deck，private 本地包不能伪称 npm 可更新 · registry 授权 root/depth/via 不变 ·
旧组合和新包互斥激活。

---

## 8. 每个任务的完成判据（Definition of Done）

一个任务只有在下面四项同时成立时才算完成：

1. 交付物清单逐条勾掉，且**没有把空 stub 说成完成**（空壳必须写进 `merge-implementation-progress.md` 的「未完成项」）；
2. 该任务自己那部分门禁在其 writeScope 内全绿，并附**可复现的命令与原始输出**；
3. 未触碰别人的 writeScope，未修改第 2 节的任何冻结接口；
4. 需要共享入口文件的那部分，**以补丁片段 + 精确行号**交给集成人，而不是自己去写。
