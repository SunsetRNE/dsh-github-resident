# 合并进度 · 客户端半边（DeepSeek 实施者）

> 只写我自己实际改的、实际跑过的、以及需要别人接手的具体事项。每个里程碑更新一次。

## 写入范围（本轮）

`deck/src/client/**`（含 `panelAssembly.js`、`views/SettingsPage.js`、`views/SettingsWorkspaces.js`、
`views/UpdateEntryHost.js`、`kernel/locale-flow.js`、`kernel/modal-fields.js`、`kernel/styles.js`、
`panel/Dock.js`、`views/ChecksTab.js`、`views/shared/md.js`）· 根 `client.js` ·
`tools/merge/rewrite-deck-client.ts` · `tools/merge/client-factory.ts`（新）·
`tests/merge/client/**`（新）· 本文件。

**没有**碰：`tools/merge/build-merge-entries.ts`、`tools/merge/merge-identity.ts`、`package.json`、
`cordis.patch.yml`、`deck/scripts/build.mjs`、`deck/tests/**`、Host（`plugin.js`、`deck/src/host/**`）、
参考源仓、DSH 安装、当前 profile。

---

## M1 —— 单 factory 装配两半（核心修复）

### 问题

旧 `rewrite-deck-client.ts` 只把 deck 产物的模块 id / inject 改成合并包的值，
**Resident 半边（两个设置页）根本没进产物**——那不是合并。同时宿主对一个包只建一个客户端图行，
两个 `load` 并存会被判重复注册，所以必须装进同一个 factory。

### 交付

| 文件 | 做了什么 |
|---|---|
| `tools/merge/client-factory.ts`（新） | 求值两半源码、捕获各自 factory 原文；渲染出**一个** `window.__ModuleLoader__.load({ id: 合并包名, factory })`；两半各在自己的函数里（`__dshDeck` / `__dshResident`），顶层 `React`/`h`/`API` 等同名声明互不可见；`exports.inject` 取两半并集（顺序 = `MERGED_CLIENT_INJECT`，声明了清单外服务直接抛）；`apply` 先 Deck 后 Resident，把 Deck 的返回值当第二参数交给 Resident |
| `tools/merge/rewrite-deck-client.ts`（改） | 公开接口改为 **`rewriteDeckClient(deckSource: string, residentSource: string): ComposedRewriteResult`**；`ComposedRewriteResult = RewriteResult & ComposedClient`，原字段 `text/idReplaced/injectReplaced/bytesBefore/bytesAfter` 一个不少（新增 `moduleId/inject/deckInject/residentInject`）；任一输入缺失/为空即抛，不静默省半边 |

两半之间只有两条通道：`require` 与 apply 的返回值。没有共享全局、没有 eval 产物（构建期只用
`new Function('window', src)` 捕获 factory 原文并读声明，不执行浏览器代码）。

### 给构建负责人的精确接口（不在我 writeScope）

`tools/merge/build-merge-entries.ts` 目前是 `rewriteDeckClient(readFileSync(DECK_CLIENT_SRC))`，
**必须改成同时传根 `client.js`**，否则新接口会（按设计）直接抛错：

```ts
const RESIDENT_CLIENT_SRC = join(REPO_ROOT, 'client.js')
// 缺任一半都不许产出
if (!existsSync(RESIDENT_CLIENT_SRC)) fail('找不到 Resident 客户端：' + RESIDENT_CLIENT_SRC)
else clientSource = rewriteClient(
  readFileSync(DECK_CLIENT_SRC, 'utf8'),
  readFileSync(RESIDENT_CLIENT_SRC, 'utf8'),
)
```

`--check` 现有的 mustContain 三项（`__ModuleLoader__.load(`、合并 id 的 load 声明、dock 槽位串）
在新产物里仍然成立，不需要改判据。

### 验证（可复现）

```
node tests/merge/client/run.mjs        # 28 项全绿（见 M3）
node --check tools/merge/client-factory.ts
node --check tools/merge/rewrite-deck-client.ts
node --check client.js
```

---

## M2 —— 设置页合并 + 功能栏保留 + 主题 token

| 文件 | 改动 |
|---|---|
| 根 `client.js` | `apply(ctx, embed)` 接住 Deck 交出的组件；登记库页状态区加「插件版本 + 唯一更新入口 + 更新行为说明（本地 private 包，走源码重装，不从 npm 更新，也不会装回旧 Deck）」；新增「插件设置（Deck 并入）」分区渲染 Deck 交出的区块；写库按钮改名「刷新登记快照」 |
| `deck/src/client/panelAssembly.js` | **删除** `settings.section#dsws-settings-section`（order 18）；保留 `conversation.input.dock`(id/order 40)、`tool.view.cordis('self')`、`settings.plugins.tab`、右栏 2 格；在 apply 末尾返回 `{ mergeEmbed: { SettingsSections, UpdateEntry, version, repoUrl } }`（两组件都用 `withCx` 包过，Resident 页面直接挂就能拿到 Deck 的 cx） |
| `deck/src/client/views/SettingsPage.js` | 拆出 **`DeckWorkspacesSection` / `DeckDiagnosticsSection` / `DeckAuthorPluginsSection`**（同一份状态与宿主电话；`plugins.tab` 页与登记库页共用，不第二套持久化）；作者链接改默认折叠 `<details>`；本页不再挂第二个 `UpdateEntryHost`，改为一句去向说明（locale 键 `cfg.updateInRegistry`） |
| `deck/src/client/views/UpdateEntryHost.js` | `pluginId` 从旧 Deck 包名改为 `@local/dsh-github-resident-v2`（与 `MERGED_PACKAGE_NAME`、Host 侧 `UPDATE_PLUGIN_ID` 必须逐字一致） |
| `deck/src/client/kernel/locale-flow.js` | 新增 `cfg.updateInRegistry`（中英各一）；`cfg.wsRefresh` 改「刷新工作区总览 / Refresh workspace overview」；文件行数 357 = 零增长基线冻结值，**不许再加行** |
| 主题 token（3 处错名，实测 7 个出现点） | `--dsw-alias-state-warning-primary`→`--dsw-alias-state-warn-primary`（`panel/Dock.js`、`views/ChecksTab.js`）；`--dsw-alias-interactive-bg-primary`→`--dsw-alias-brand-primary`（`kernel/modal-fields.js` ×5）；`.dsws-vc-link` 用 `--dsw-alias-link`（`kernel/styles.js`）；`--dsw-alias-markdown-heading`（不存在）去掉外层，落回 `--dsw-alias-label-primary`（`views/shared/md.js`） |

真名来自 DSH 安装包源码里的 token 定义（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-*/lib/*.js`）；
`cordis_inspect_query(Theme.listTokens)` 本轮超时（10s），按纪律没有反复重试，改用上述可核对的离线来源。

### 两个产品决策（写清楚，便于复核）

1. **唯一更新入口的落点**：只在「设置 → 仓库登记库」页的状态区挂一次（`mergeEmbed.UpdateEntry`）。
   `plugins.tab` 兼容页复用同一批分区组件与同一份 store，但不再挂第二个按钮——否则同一动作会有两个入口。
   证据底稿 §3.4/§4 的默认推荐（同组件、同 store、不新增状态）由此落实；若产品要恢复插件页按钮，
   把 `h(UpdateEntryHost, null)` 从 panelAssembly 移到共享分区即可（一处）。
2. **apply 顺序 Deck → Resident，且不吞异常**：Resident 需要 Deck 的返回值，所以 Deck 必须在前。
   与 `tools/merge/host-assembly.ts` 的纪律一致（半边失败的症状不同，吞掉就只剩「页面空白」）。

### Host 侧耦合（交宿主任务/集成人）

`deck/src/host/updateFromPackage.js` 的 `UPDATE_PLUGIN_ID` / `DEFAULT_TARGET_PACKAGE` 必须改成
`@local/dsh-github-resident-v2`，否则客户端传的 pluginId 与宿主对不上，更新入口会失效。
（Host 不在我 writeScope，我没有改。）

---

## M3 —— 自有测试（受控夹具，非真机）

`tests/merge/client/`（4 个文件 + `run.mjs`）：

```
node tests/merge/client/run.mjs
# ℹ tests 28 · pass 28 · fail 0
```

覆盖：单 load / 合并 id / dock 串保留；apply 后**注册集合**（dock 40、plugins.tab、settings.section
只有 `github-resident`60 与 `github-repo-registry`61、**没有** `dsws-settings-section`）；
inject 并集逐项等于 `MERGED_CLIENT_INJECT`；Deck 交出的两个组件被登记库页以**同一函数对象**渲染
（mergeEmbed 交接）；Resident 半边单独跑（无 embed）不崩；两半同名顶层声明不冲突；
9 条失败路径（缺输入/空串/重复 load/id 不符/缺 apply/未知 inject/常量漂移/dock 缺失/锚点漂移）；
静态契约（撤除、保留、唯一入口、locale 中英各一、错名 token 清零、busy 两套并存）；
以及按 `build.mjs` 标记拼出 Deck apply 体后**能编译**（重复声明/括号/return 错层都会红）。

**限制（如实说）**：桩 React + 桩宿主，不装 jsdom/真 React、不渲染真 DOM、不碰真实端口与 HOME，
所以是单元/集成测试；**真机视觉、真实宿主渲染、深浅色与双语混排都没有验证**。
真实 `deck/package/lib/client.js` + `dist/client.js` 的装配与全量门禁属于集成人那一步（本仓此刻无 node_modules）。

---

## M4 —— 真实产物核对（构建负责人已装依赖并产出 dist 之后）

构建负责人已在本仓跑通安装与 `npm run build`（`deck/package/lib/client.js` 2 258 666 B、`dist/client.js`
2 287 430 B）。据此补了两条**真产物**核对（都只读，不写任何生成物）：

1. `node tools/merge/build-merge-entries.ts --check` → `build-merge-entries --check: 全部一致`。
   也就是：真 `deck/package/lib/client.js` + 真根 `client.js` 经我这套装配**逐字复现**已发布
   `dist/client.js`（日志：「Deck 5 项 + Resident 1 项 inject；合并 5 项；2289060 → 2287430 字节」）。
2. 真 `dist/client.js` + 真 React + jsdom，跑一次合并后的单 factory（一次性脚本 `/tmp/real-artifact-check.mjs`，
   **不入库**）：单 load、合并 id、inject 并集顺序正确；`apply` 后**恰好 7 条注册**——
   `conversation.input.dock#dsh-mattpocock-skills-deck`、`tool.view.cordis#self`、
   `settings.plugins.tab#dsws-settings`、右栏 2 格，加 Resident 的
   `settings.section#github-resident@60` 与 `settings.section#github-repo-registry@61`；
   没有 `dsws-settings-section`。**两半在真产物里都真的注册了**。

另外用构建负责人写的隔离 runner 跑了一遍：`node tests/merge/run.mjs` 里 client 四个套件全过
（`通过 4 · 失败 1`，唯一的失败在 `tests/merge/host/identity-parity.test.mjs` 的
`exports["./tools"]` 断言，属宿主/构建范围，与本轮客户端改动无关）。

---

## 需要别人接手的精确清单

| 谁 | 事项 |
|---|---|
| 构建负责人 | 已在 `build-merge-entries.ts` 接上 `RESIDENT_CLIENT_SRC` 并传两个输入（与本模块签名一致），无需再改；`npm run build` + `check:entries` 已绿 |
| 集成人 | 全量门禁；以及对下列 deck 门禁做**只改断言**的同步（`deck/tests/**` 不在我 writeScope）。已实测确认的失败面： |
| 集成人 | `deck/tests/smoke-render.test.js:96-101` 两条 FAIL：「捕获 6 个插槽（实际 5）」「settings.section 插槽已注册」→ 改成 5 并删掉 settings.section 断言（其余 render 项全 PASS） |
| 集成人 | `deck/tests/verify-slot-idempotency.js:15` 三条 FAIL（src / client.js / package/lib/client.js）：槽位清单去掉 `'settings.section'`（6 → 5） |
| 集成人 | `deck/tests/verify-update-panel.js:75`：该断言（`pluginId: 'dsh-mattpocock-skills-deck'`）要改成合并包名。注意在本仓根安装形态下这条脚本会**提前退出**（读 `deck/node_modules/dsh-plugin-update/package.json` 报 ENOENT，依赖是提升到根 node_modules 的），只有 deck 独立装依赖时才会走到该断言 |
| 宿主任务 | `deck/src/host/updateFromPackage.js` 的 `UPDATE_PLUGIN_ID` / `DEFAULT_TARGET_PACKAGE` 改合并包名（见 M2） |


## 未完成 / 未验证

- ~~真实 deck 产物参与装配~~ 已在 M4 补上（逐字一致 + 真 jsdom 跑出 7 条注册）；
- 仍未做：jsdom 真挂载 `conversation.input.dock` 占用者并断言胶囊/横幅 DOM（deck 侧 `smoke-render` 的合并版）、N9 宿主占用快照、
  真浏览器宽度扫描、深浅色与双语混排、收起/展开与会话切换的真机旅程——这些属于集成人的全量门禁；
- `plugins.tab` 页不再挂更新按钮是决策而非缺陷，若产品否决按 M2 决策 1 的开关改回。
