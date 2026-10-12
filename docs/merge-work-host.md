# 合并实施进度 · 宿主半边（任务 H）

- 负责人：DeepSeek 集成人（宿主半边）
- 日期：2026-10-11（UTC）
- 分支：`feat/merge-skills-deck`（基线 `main@54a1a07`）
- 本文件是**任务 H 独占的进度与交接文档**；合并总进度、客户端（任务 C）与构建/门禁（任务 B）的进度各写在自己的文件里，本文件不复制评估与总计划。
- 参考文档：[合并实施计划](./merge-implementation-plan.md)（§2 冻结接口、§3 任务 H）、[功能栏契约](./merge-toolbar-contract.md)。代码与监督修正优先于文档；本文与计划不一致处，以**本文记录的实测**为准并已注明原因。

---

## 0. 一句话结论

任务 H 的四件事（宿主落地 / 27 工具全注册 / 27 技能发现 / 更新指向合并包）都已**实做并在隔离夹具下真调用验证**：新增 6 个测试文件共 **174 项断言全绿**。同时抓出并修掉一个**真 bug**（更新查新版仍打旧 Deck 包名），另有 **4 条需集成人处理**的跨 writeScope 项（见 §5）。`plugin.js` **一个字没改**（§2.6 说明为什么不需要改）。

---

## 1. 实际改动清单（全部在本任务 writeScope 内）

| 文件 | 改了什么 | 为什么 |
|---|---|---|
| `tools/merge/host-assembly.ts` | 重写装配层：两半改为**运行期按包名找根**后动态导入；导出收成单一形态（`name` / `inject` / `apply` + 测试钩子 `__applyHalves`），**删掉 default 导出**；`Boolean(apply())` 判据删除，改为「两半都调用 + 第一个异常原样抛出 + Promise 交回 + 函数返回值登记进 `ctx.effect`」 | 原实现有三处会静默出错：①`'../../plugin.js'` / `'./merge-identity.ts'` 是相对**作者态**位置写的，`bundle:false` 转译到 `dist/` 后解析成仓库上一级与 `dist/merge-identity.ts`（不存在）→ 产物一装载就死；②具名 + default 混导出让加载器与其它入口可能拿到两个不同的插件对象（`registry.resolve` 用 `plugin.apply` 的函数身份当键）；③`Boolean(apply())` 把半边真失败吞成「工具不见了」 |
| `deck/src/host/index.js` | `name` → 合并包名；文件头注释与 30s 警告前缀一并指向合并包（`host boot deferred` 日志现在写 `[@local/dsh-github-resident-v2]`） | 宿主身份归户；行数保持 349（≤350 门禁上限，原文件已顶格） |
| `deck/src/host/bootstrap.js` | 技能根候选重做：**按本模块自身位置逐级向上**找 `<层>/bundled-skills` 与 `<层>/package/bundled-skills`，再加两种 `node_modules/<合并包名>/…` 形状；cwd 组与家目录 profile 组保留但旧包名换成合并包名；**旧包名候选全部删除** | 旧实现只按 `process.cwd()` 与写死的旧包名找，合并后 cwd 与技能根再无关系 |
| `deck/src/host/skillDoc.js` | 同一套候选（readDoc 的定位与 bootstrap 同源） | 详情页读原文必须与发现同一口径 |
| `deck/src/host/updateFromPackage.js` | `MERGED_PACKAGE_NAME` / `UPDATE_PLUGIN_ID`（去 scope 的合法标识）/ `LEGACY_DECK_PACKAGE_NAME`（仅守卫对照）/ `UPDATE_LOCAL_PRIVATE` + 如实文案；`resolveUpdateConfig` **显式传 `targetPackageName`**；`createHostUpdate` 也显式传；`__syncInstalledManifest` 改为按包名向上找根 + 横幅候选 `dist/client.js`→`lib/client.js`→`client.js`；新增 `__findInstalledRoot` / `__updateTargetsLegacyDeck` | 见 §2.4（含实测抓到的 bug） |
| `deck/src/host/rpcChannel.js` | `MANIFEST_NAME` → 合并包名；版本读取从「固定两层相对路径」改成**按包名向上找 package.json**；effect 标签改用 `MANIFEST_NAME` | 旧路径在合并布局里会读到旧 Deck 的 `package.json`（名字对不上）→ 自监控电话永远回 `unknown` |
| `deck/src/host/platform/deckToolsRow.js` | `name` → `@local/dsh-github-resident-v2/tools`（与 `cordis.patch.yml` 子路径行逐字一致）；行数 346（≤350） | 行模块身份归户；子路径行不产生第二个客户端脚本 |
| `tests/merge/host/**`（6 个文件 + 1 个共用件） | 见 §3 | 任务 H 交付物 4 |
| `docs/merge-work-host.md` | 本文件 | 任务 H 交付物 5 |

未触碰：`package.json`、`cordis.patch.yml`、任何构建脚本、`deck/src/client/**`、`deck/tests/**`、`deck/src/shared/**`、`plugin.js`、`deck/scripts/**`。

---

## 2. 接口与行为（改动后的对外形状）

### 2.1 `dist/host.js`（宿主入口）

- 导出：`name`（= 实测的根 `package.json.name`）、`inject`（`['tools','connection','llm','sessionQuery']`，与 `MERGED_HOST_INJECT` 逐项同序）、`apply(ctx, config)`、`__applyHalves`（测试钩子）。**没有 default**。
- 加载器契约（`@deepseek-ai/cordis-plugin-loader` 的 `unwrapExports`：`exports = exports.default ?? exports; if (!exports.__esModule) return exports; …`）：无 default 时返回具名命名空间，命名空间有 `apply`/`inject`/`name` → 可装载。测试里复刻了这三行逐条断言（含「具名 apply 与装载器拿到的 apply 是同一个函数」）。
- 路径解析：从 `import.meta.url` 向上找 `name === '@local/dsh-github-resident-v2'` 的 `package.json`（不猜层数），再动态导入 `<包根>/plugin.js` 与 `<包根>/deck/src/host/index.js`。开发检出（`tools/merge/`）、产物（`dist/`）、打包解压（`<pkg>/dist/`）同一套规则；找不到就抛，错误里写明「files 白名单必须包含哪个相对路径」。
- `apply` 返回值语义：`undefined`（两半都同步，今天的事实）或 `Promise`（任一半返回 thenable 时 `Promise.all` 交回让 fiber 等）。**返回值不是成功判据**；半边返回函数则登记进 `ctx.effect`（上下文没有 `effect` 就抛，拒绝静默丢弃）；半边抛错时**两半都先调用**，第一个错误原样抛出（不包装、不吞）。

### 2.2 27 工具面（实测）

| 作用域 | 入口 | 注册 |
|---|---|---|
| 宿主半边 | `plugin.js` 的 `apply` | 17 个 `gh_*`（+ `ctx.provide('githubResident')`、1 条 `ctx.effect`） |
| agent 行 | `deckToolsRow.js` 的 `apply` | 9 个 `deck_*` 业务工具 + `deck_probe` |

合起来 **27 个名字两两不同、`gh_*` 与 `deck_*` 交集为空**。探针可实际调用（回 JSON 文本，只报键名与有无，不报路径/令牌值）；业务工具在三条通道都不通时回 `{status:'unsupported', reason:'not-wired', text:…}` 的诚实占位，坏参数 `bad-args`、已中止 `aborted`，都不抛。`ctx.tools` 缺失时行模块**抛错并指名 tools**（不静默少注册）。

### 2.3 27 技能发现与 `readDoc`

候选按「层」穷举（不是写死一个根、也不再假设包根就是 `bundled-skills`）：
每层向上问 `<层>/bundled-skills`、`<层>/package/bundled-skills`、`<层>/node_modules/<合并包名>/bundled-skills`、`<层>/node_modules/<合并包名>/deck/package/bundled-skills`，另保留 cwd 组与（改名后的）家目录 profile 组。**旧包名候选已全部删除**。

实测分辨：开发检出与「构建形态」解析到 `deck/package/bundled-skills`（入库快照，`files` 有它）；只有包根 `bundled-skills/`（构建负责人声明的**发布位置**，`BUNDLED_SKILLS_OUT`）时也能解析到。三种布局（`<tmp>/deck/src/host`、`<tmp>/deck/package/lib`、`<tmp>/bundled-skills`）各跑一遍，都是 27 个技能、27 个 `readDoc` 全成功；路径穿越 / `..` / 空参 / 超长名 / 不存在的技能一律 `{ok:false, missing:true}`，不抛。

### 2.4 更新目标 / 身份证 / private 状态

- `UPDATE_PLUGIN_ID = 'dsh-github-resident-v2'`。**不能**直接用合并包名当 pluginId：更新包的 `assertPluginId` 拒绝含 `/` 的值，用完整包名会在**模块加载期**抛错（已用真包建一次处理器验证不抛）。`pluginId` 只是本地状态命名空间。
- `DEFAULT_TARGET_PACKAGE = '@local/dsh-github-resident-v2'`，并**显式**传给 `resolveUpdateConfig` **和** `createHostUpdate`。`LEGACY_DECK_PACKAGE_NAME` 只作为漂移守卫（`__updateTargetsLegacyDeck`）的对照值，源码里就 1 处。
- 实测抓到的真 bug：只改 `DEFAULT_TARGET_PACKAGE` 不够 —— `createHostUpdate` 的 config 里不带 `targetPackageName` 时会落到更新包自带的旧 Deck 默认值，拦截到的请求是 `https://registry.npmjs.org/dsh-mattpocock-skills-deck/latest`，即「点一次更新装回旧 Deck」。修完实测请求变成 `https://registry.npmjs.org/%40local%2Fdsh-github-resident-v2/latest`，**零请求**打到旧名。
- 本地 private 事实：`UPDATE_LOCAL_PRIVATE = true` 与 `UPDATE_LOCAL_PRIVATE_HINT`（「本包为本地 private 包…更新走源码重新安装，不通过 npm 安装」）已导出，供面板文案使用（客户端文案归任务 C，见 §5 第 2 项）。
- 身份证验明正身（`__syncInstalledManifest`）：根按包名向上找（不再取上一层），横幅按 `dist/client.js` → `lib/client.js` → `client.js` 顺序找（合并包的客户端在 `dist/`）。实测档位：`synced` / `skip:already` / `skip:not-older` / `skip:banner-mismatch` / `skip:not-installed-copy` / `skip:no-target`；**旧 Deck 副本 → `skip:no-manifest`（一个字节都不动）**。写盘只改 `version` 一个字段。

### 2.5 `rpcChannel` 的服务版本

`versionOfServingCopy()` 现在按包名向上找 `package.json`：开发检出与打包形态都能读到合并包版本（`v1.6.4`），旧 Deck 的 `package.json` 因名字不符被跳过；全读不到才回 `unknown`（不编版本号）。`DSW_RPC_CHANNEL` / `DSW_RPC_ROUTE` / 端点名规则 / `host.dispatch.error|empty` 的埋点形状**一字未改**。

### 2.6 为什么 `plugin.js` 一个字没改

- 它的 `apply` **已经**是正确形态：注册 17 个工具后把回环 HTTP 服务与启动检查登记进 `ctx.effect(() => …)`，函数体 `return undefined`。**没有**「用返回值当销毁器」的旧写法，所以装配层的返回语义修正对它是行为保持。
- 它的 `inject = ['tools']` 是半边自己的依赖声明；合并后的并集在装配层显式声明（`inject` 必须在 `apply` 之前被加载器读到，不能运行期补）。
- 结论：需要修的「生命周期/返回值」问题全在**装配层**（已修）。不留纸面改动。

---

## 3. 测试与结果（可复现命令 + 结果）

全部在隔离夹具下：不碰真实 HOME、不联网、不绑端口、不起浏览器、只写 `os.tmpdir()`。共用件 `tests/merge/host/_check.mjs` 提供 `check/summary/readText/importRel/tmpDir` 等。

```
node tests/merge/host/identity-parity.test.mjs        # 32 项 全绿
node tests/merge/host/tool-surface.test.mjs           # 32 项 全绿
node tests/merge/host/skill-discovery.test.mjs        # 27 项 全绿
node tests/merge/host/assembly-lifecycle.test.mjs     # 29 项 全绿
node tests/merge/host/update-target.test.mjs          # 31 项 全绿
node tests/merge/host/packaging-resolvable.test.mjs   # 23 项 全绿
# 合计 174 项，退出码全 0
```

覆盖到的东西（不是断言字符串）：

| 文件 | 真正跑起来的东西 |
|---|---|
| `identity-parity` | 真源常量 ↔ 根 `package.json` ↔ `cordis.patch.yml` ↔ deck 源里的 `name`/`MANIFEST_NAME`/行模块名；**存在 `dist/` 时**导入 `dist/host.js` 并复刻加载器 `unwrapExports` 后断言形状与 inject；`dist/client.js` 的 `__ModuleLoader__.load(` 恰好 1 次、模块 id、dock 槽位 id/order 40 |
| `tool-surface` | **真调用** `plugin.js` 与 `deckToolsRow.js` 的 `apply`（fake ctx 的 effect 只记录不执行 → 不占 31790），数出 17+10；真调用 `deck_probe`（覆盖 probe）；真调用 `deck_context` 的四条输入路径；`ctx.tools` 缺失时抛错可见；等 200ms 断言无未处理拒绝 |
| `skill-discovery` | provider 工厂装配 + `list()` 27 + `get()` 正文；**三种布局**（含临时目录里按模块相对解析的打包/构建/包根形态）各 27；27 个 `skillDoc.readDoc` 全成功；越界与坏输入 |
| `assembly-lifecycle` | 导出形态与加载器语义；合成半边把「顺序 / 两边都试 / 异常原样抛 / Promise 被等 / 函数销毁器登记并可跑 / 无 effect 时抛」逐条钉死；**真两半**在依赖未就绪与就绪两种档位下装配（就绪时实测注册了 bundled provider 与 `/api/dsws` 路由） |
| `update-target` | 真 `dsh-plugin-update`：建处理器（证明 pluginId 合法）；**拦截 fetch** 断言请求只打合并包名、零打旧名；临时 `node_modules` 下 8 个 `__syncInstalledManifest` 档位；旧 Deck 副本不被认领且文件不变 |
| `packaging-resolvable` | 从 `./tools` 落点走一遍**静态 import 闭包**，逐文件断言被根 `files` 白名单覆盖、零框架引用；dist/host.js 两个半边路径常量在 files 里；`exports` 每个落点都在 files 里 |

顺带跑的只读 deck 门禁（改我文件后仍绿）：`verify-no-same-layer-import`、`verify-596-rpc-carrier`、`verify-733-unknown-endpoint`、`verify-log-selfmon`、`verify-bundled-discovery`、`verify-bundled-trio-matrix`、`verify-bundled-skills`、`verify-968-skill-ondemand`、`verify-963-log-order`、`verify-matt-skills-sync`、`smoke-host.test`、`smoke-host-dispatch.test`、`smoke-comment-passthrough.test`、`smoke-naming-persistence.test`、`verify-496b-inject-guard`、`verify-646-native-tab`、`verify-deck-exec-phone`、`verify-deck-tools-host-wiring`、`verify-deck-render-detail`。

### 3.1 构建链侧的两条硬证据

```
$ node tools/merge/build-merge-entries.ts --check
      客户端装配：Deck 5 项 + Resident 1 项 inject；合并 5 项；2289085 → 2287455 字节
      随包技能副本与源逐字一致（27 个 / 109 个文件）
build-merge-entries --check: 全部一致          # 2026-10-11 17:48 UTC
```

1. **宿主产物通过构建负责人新加的装载安全门**（`build-merge-entries.ts` 的 `assertHostImportSafety`）：`dist/host.js` 的导入说明符全是 `node:` 内建、导出恰好是 `name`/`inject`/`apply`、无 default、`const inject = [...]` 字面与真源逐项同序。这三条正是本次 §1 第 1 行改的内容 —— 说明修法与构建侧的门禁同向。
2. **根 `bundled-skills/` 与 `deck/package/bundled-skills/` 逐字一致（27 个技能 / 109 个文件）** → §2.3 的两套候选根在合并形态下**等价**，先命中哪一个都拿到同一批技能；不会因为构建时序产生「两份漂移」。

### 3.2 不顺带跑的 deck 门禁里，哪些红、为什么红（实测归因，不是推测）

| 门禁 | 结果（2026-10-11 17:48–17:50 UTC 复测） | 归因（证据） |
|---|---|---|
| `verify-file-granularity` | 2 红 | 都在**客户端**：`src/client/kernel/locale-flow.js` 357→358、`src/client/statusbar/StatusBar.js` 359→360。我改的 6 个文件全部 ≤350（265 / 113 / 349 / 192 / 242 / 346） |
| `verify-strict-module-syntax` | 1 红 | `src/client/panelAssembly.js` 顶层 return（客户端在途改动） |
| `verify-log-fields` | 1 红 | `choiceStore.hint.reject`。**实测在只读参考源仓 HEAD `3b25cd3f` 上同样红**（两边都没有这个字面量），属合并前既有红 |
| `verify-deck-tools` / `verify-deck-tools-matrix` | 5 + 6 红 | 这两个门禁只 import `src/shared/refresh/**`、`src/host/refresh/**`、`src/host/tracker/**`，**不 import 我改的任何文件**；红的是共享判定层（`判定出口这次没装上`），属他人 writeScope 的在途改动 |
| `verify-update-panel` | 5 红 | §5.1(a) 1 条（客户端 pluginId）+ §5.1(b) 3 条（夹具目标包名）+ 1 条 `SettingsPage` 挂载（客户端在途） |
| `verify-update-migration` | 抛错退出 | `ENOENT … deck/AGENTS.md`（合并快照里叫 `AGENTS.upstream.md`）→ §5.1(c) |
| 其余 20 条（`verify-no-same-layer-import`、`verify-596-rpc-carrier`、`verify-733-unknown-endpoint`、`verify-log-selfmon`、`verify-log-coverage`、`verify-bundled-*`、`verify-968`、`verify-963`、`verify-matt-skills-sync`、`smoke-host*`、`verify-496b`、`verify-646`、`verify-deck-exec-phone`、`verify-deck-tools-host-wiring`、`verify-deck-render-detail`、`verify-deck-tools-agent-register`、`verify-deck-tools-row-zero-dep`） | 全绿 | 我改的宿主文件与它们同向 |


---

## 4. 未做 / 未跑（不得当成已完成）

| 项 | 状态 | 谁做 |
|---|---|---|
| `npm run build`（公共 dist/ 与 `deck/package/lib`） | 构建侧已在 2026-10-11 17:44 跑过；我改的 deck 源与 `package/lib` 已同步（`verify-deck-tools-row-zero-dep` 同字节断言转绿），`tools/merge/build-merge-entries.ts --check` 报「全部一致」 | 构建负责人（已完成，后续再有 src 改动需重跑） |
| `npm run verify` 全链 / deck 237 条门禁全量 | 未跑（最终公共构建与全量测试由集成人在三人结束后统一跑）；我只跑了与我文件相关的 27 条 + 6 个新测试 | 集成人 |
| 隔离 profile 的安装/互斥激活、真机渲染、深浅色、双语混排（N8/N9） | 未做（不启替代服务、不安装启停插件；本阶段只写不跑） | 集成人 / P6 |
| 工具描述文案（9 个 `deck_*` 工具 description 仍写旧包名） | **故意未改**：那是模型可见的对外文本，属「工具 schema/输出保留」范围；是否改由集成人定 | 集成人 |

---

## 5. 需集成人处理（跨 writeScope，含精确 diff 建议）

### 5.1 更新入口门禁：两处必须跟着合并身份走的断言（实测红，含精确 diff）

`deck/node_modules` 已由构建侧装好，原先「包路径假设」导致的假红（`verify-log-coverage`、`verify-deck-tools-agent-register`、`verify-deck-tools-row-zero-dep`）**现在全绿**，无需再处理。剩下的更新入口红项全部有明确归属：

**(a) 客户端 pluginId（我的 §5.2，重要）** —— `verify-update-panel.js` 的「挂载点传插件标识与电话名前缀（与宿主侧一致）」红。修法见 §5.2。

**(b) 门禁夹具里的目标包名（3 条红）** —— `verify-update-panel.js` 的红：
`查新版带回远端 9.9.9`、`单例：查状态能看到刚查到的远端版本`、`无新版：远端等于运行版，不能装`。

归因（不是推测）：更新包的版本读取会用目标包名校验回包：
`node_modules/dsh-plugin-update/dist/service.js:206` 是
`if (value.name !== targetName || !isVersionAllowedInChannel(...)) throw updateError("invalid-release")`，
`:219` 还会校验 tarball 路径必须是 `/<targetName>/-/<targetName>-<version>.tgz`。
夹具 `deck/tests/verify-update-panel.js` 第 7 段喂的假回包仍写旧包名，于是 `invalid-release`，三条随之红。

```diff
--- a/deck/tests/verify-update-panel.js
+++ b/deck/tests/verify-update-panel.js
@@
-  const releaseBody = (version) => JSON.stringify({
-    name: 'dsh-mattpocock-skills-deck',
-    version,
-    engines: {},
-    dist: { tarball: `https://registry.npmjs.org/dsh-mattpocock-skills-deck/-/dsh-mattpocock-skills-deck-${version}.tgz`, integrity: INTEGRITY },
-  })
+  const MERGED = '@local/dsh-github-resident-v2'
+  const releaseBody = (version) => JSON.stringify({
+    name: MERGED,
+    version,
+    engines: {},
+    dist: { tarball: `https://registry.npmjs.org/${MERGED}/-/${MERGED}-${version}.tgz`, integrity: INTEGRITY },
+  })
```

> 注意这条不会让「本地 private 包」变成可更新：真机上 npm 上根本没有这个包名，`check` 会如实失败（`invalid-release` / 404），面板拿到的是失败而不是「有新版」。这正是「不伪称 npm 可更新」。

**(c) `verify-update-migration.js` 抛错退出** —— `门禁异常：ENOENT … deck/AGENTS.md`：合并快照里该文件叫 `AGENTS.upstream.md`，门禁仍读 `deck/AGENTS.md`。属任务 B 的「门禁路径同步」（改读取路径或把该断言改为「文件存在时再查」）。

**(d) `verify-log-fields.js` 1 条红** —— `choiceStore.hint.reject`。**实测在只读参考源仓 HEAD `3b25cd3f` 上同样红**（该字面量在两边都不存在），属合并前既有红，与本次改动无关，交由集成人决定补埋点还是改判据。

### 5.2 客户端更新入口的 pluginId 必须与宿主一致（重要）

宿主 `UPDATE_PLUGIN_ID` 现在是 `'dsh-github-resident-v2'`（旧值 `'dsh-mattpocock-skills-deck'`）。更新包面板按 pluginId 判「这条队列是不是自己的」：`node_modules/dsh-plugin-update/dist/panel.js:1018` 是 `aboutSelf = named === pluginId`。客户端不一致时，用户自己那次安装会被面板当成「别人的任务」；`verify-update-panel.js` 也已经因此红了一条（§5.1(a)）。

需要一起改的两处（都在我 writeScope 外）：

```diff
--- a/deck/src/client/views/UpdateEntryHost.js
+++ b/deck/src/client/views/UpdateEntryHost.js
@@
-        pluginId: 'dsh-mattpocock-skills-deck',
+        pluginId: 'dsh-github-resident-v2',
```
```diff
--- a/deck/tests/verify-update-panel.js
+++ b/deck/tests/verify-update-panel.js
@@
-  check(leafSrc.includes("pluginId: 'dsh-mattpocock-skills-deck'") && leafSrc.includes("prefix: 'wf'"), '挂载点传插件标识与电话名前缀（与宿主侧一致）')
+  check(leafSrc.includes("pluginId: 'dsh-github-resident-v2'") && leafSrc.includes("prefix: 'wf'"), '挂载点传插件标识与电话名前缀（与宿主侧一致）')
```

（若集成人更愿意保留旧 pluginId 以免动客户端，则必须把 `deck/src/host/updateFromPackage.js` 的 `UPDATE_PLUGIN_ID` 改回旧串，并接受「读得到旧状态目录里针对旧 Deck 的遗留任务」——那与「不安装回旧 Deck」冲突，故不推荐。宿主侧已由 `tests/merge/host/update-target.test.mjs` 锁死 target 包名，即使有遗留任务也只会去 npm 找合并包名，不会装回旧 Deck。）

### 5.3 面板文案落实「本地 private」

`UPDATE_LOCAL_PRIVATE` / `UPDATE_LOCAL_PRIVATE_HINT` 已从 `deck/src/host/updateFromPackage.js` 导出，但更新面板由更新包自带的入口件渲染，宿主没有注入文案的口子。建议集成人在「仓库登记库」页的更新区块（任务 C 的分区⑧）把这句话作为固定说明显示，不做假的「可更新」承诺。**不要**给 status 快照加字段：快照六字段形状被 `verify-update-panel.js` 第 7 段逐字断言。

### 5.4 可选：9 条工具描述里的旧包名

`deck/src/host/tools/deckContext.js` 等 9 个文件的中文 description 里写着「dsh-mattpocock-skills-deck 插件」。属模型可见文本，我按「工具 schema/输出保留」未动。若集成人要改，是 9 处纯文案替换；**改前先确认**没有门禁断言这些描述字符串。

---

## 6. 给集成人的最小核对清单（跑命令即可）

```bash
# 1) 我这一半的 6 个测试（不需要额外依赖；update-target 需要根 node_modules）
for t in identity-parity tool-surface skill-discovery assembly-lifecycle update-target packaging-resolvable; do
  node tests/merge/host/$t.test.mjs || echo "RED: $t"
done

# 2) 重新构建后确认产物与源一致（构建负责人）
npm run build && npm run check:entries

# 3) 我改过的 deck 源文件相关的只读门禁
cd deck && node tests/verify-file-granularity.js && node tests/verify-no-same-layer-import.js \
  && node tests/verify-bundled-discovery.js && node tests/verify-bundled-trio-matrix.js \
  && node tests/verify-596-rpc-carrier.js && node tests/verify-log-selfmon.js
```

宿主侧的风险优先级：**§5.2（客户端 pluginId）> §5.1（门禁路径，影响的是门禁可信度不是运行时）> §5.3 > §5.4**。
