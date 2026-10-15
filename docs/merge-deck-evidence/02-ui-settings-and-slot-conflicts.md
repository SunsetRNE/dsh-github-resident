# 证据文档 02：客户端 UI、设置页归属与槽位冲突

> 历史材料：本文的独立回环端口与 `DSH_GH_API_PORT` 方案已退役。当前面板、脚本均走宿主 RPC `/api/dsws` 的 `ghr.*` 端点；此处保留旧测量与决定的原文供追溯，现行清单以 `gh_protocol.http` 为准。

- 评估主题：把 `dsh-mattpocock-skills-deck` 合并进 `dsh-github-resident`、以一个插件运行，并「把 Deck 设置页合并进 Resident 设置页的仓库登记页」。
- 本文只覆盖**客户端/UI 层**：设置页两类注册、可落地的合并方案、合并后页面的文字线框、逐控件交互状态、槽位与注册冲突、单 `client.js` 在 `exports`/`inject`/`immediately`/主题/i18n 上的改动点。
- 本文**不实现、不安装、不启停、不改代码**。所有会写产物的验证都只写进第 9 节「未来验收方案」。
- 配套文档：[01 功能矩阵与单插件形态](01-feature-matrix-and-form.md)（功能矩阵、工具/服务冲突、单插件形态 A/B/C 比较）、[03 迁移与权限计划](03-migration-permission-plan.md)。本文不重复其内容，只在需要时交叉引用。

### 修订记录（v2，2026-10-11）

依据主代理验收反馈做有限修订；本文写范围仅本文件，不改任何代码/manifest/profile/数据/凭据。已解矛盾如下：

| # | 被修正的旧表述 | 修订后的表述 |
|---|---|---|
| 1 | 「Deck 设置页今天**已经没有任何真正的配置项**」 | 旧模板编辑、外观、面板默认高度、打开位置等入口**已移除或迁走**；当前页面**仍有**诊断日志主开关与「导出/打开位置/复制路径/清空」四个管理操作，以及只读工作区总览与更新入口 |
| 2 | 「要求里提到的**追问/配置项**」 | 用户书面要求只有「以 Resident 为主体合并、把 Deck 设置页并入 Resident 仓库登记页」，未点名追问或配置项；删除该虚构要求 |
| 3 | 「**没有任何** Client 插槽占用/主题 token 的实时快照」「本次未能取得任何『页面渲染结果』证据」 | 是**本次执笔子代理**两次 Client 查询超时、未取得运行态占用快照；主代理另取得了 Client Slots 全树（**仅拓扑/契约**，非占用），本文以它作契约旁证。实时占用与页面视觉仍未验证 |
| 4 | 右栏 `id/kind` 改名后「用户已保存的右栏 tab 会找不到类型……旧布局丢失可接受」 | 默认**保留** `id/kind` 与用户布局；包名变化**不要求** tab 身份跟着改；只有确有 id/kind 冲突时才给 alias/迁移，不得把布局丢失当成可接受代价 |
| 5 | `settings.plugins.tab` 的处置「必须单独拍板」 | 给出明确默认推荐：Deck 左栏入口并入 `github-repo-registry`；插件管理兼容入口指向同一内容/说明，**不维持第二套设置状态**（见 §3.4） |
| 6 | 故障测试「手工删掉库内一个仓库目录」造成漂移 | 一律使用**隔离 profile + 临时仓库/日志样本**，不得删除用户真实仓库或清真实日志来造漂移（见 §9 前言） |

**保留并确认的结论**（与 01/03 旧底稿的推测相左处，以本文为准）：单 `client.js` 必须只有一个 `__ModuleLoader__.load`、内部调用两半 `apply`（见 §7.1）；包级 `dsh.client.inject` 与纤维级 `inject` 是两层、各自取并集（见 §7.2）。§7.1/§7.2 已就地标出它们纠正了哪几处旧推测。

---

## 1. 范围、方法与来源纪律

### 1.1 基线

| 对象 | 位置 | 版本 | HEAD | 工作区状态 |
|---|---|---|---|---|
| Resident（本地源码） | `/root/dsh-github-resident/dsh-github-resident` | 1.6.4 | `54a1a07d233e23037b847d3ac407b33851fe7284`（Sat Oct 10 05:59:53 2026 +0000） | `git status` 干净，`main...origin/main`；本次新增的 `docs/` 为未跟踪文件 |
| Deck（本地源码） | `/root/dsh-github-resident/dsh-mattpocock-skills-deck` | 1.8.0-rc.7 | `3b25cd3f1dceec56c6327f18bb893e2426c619ab`（Sun Oct 11 21:54:07 2026 +0800） | `git status` 干净，`main...origin/main` |
| Resident 已安装副本 | `/root/.dsh/plugin-src/@local/dsh-github-resident-v2` | 1.6.4 | —— | `client.js` 与本地源码 `diff` 一致（0 差异） |
| Deck 已安装副本 | `/root/.dsh/plugin-src/dsh-mattpocock-skills-deck` | **1.7.51**（注意：低于本地源码 1.8.0-rc.7） | —— | 含构建产物 `lib/client.js`；本地工作区 `package/` 下**没有** `lib/` |
| 生效 profile | `/root/.dsh/profiles/web` | DSH 0.2.0-rc.2 | —— | `dsh.profile.bundles` 同时含两个插件；主题 `preference: dark`、`fontSize: 12` |

来源：`git -C <repo> log -1`、`git -C <repo> status -sb`、`ls`/`cat` 只读读取上述路径。

### 1.2 三种事实的标注约定（全文遵守）

| 标记 | 含义 | 取得手段 |
|---|---|---|
| `【本地源码·R】` | Resident 仓工作区文件（HEAD `54a1a07`） | `read` / `grep` / `git show` |
| `【本地源码·D】` | Deck 仓工作区文件（HEAD `3b25cd3`） | `read` / `grep` |
| `【宿主框架源码·H】` | 本机 DSH 安装内的宿主框架源码 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/...`（0.2.0-rc.2）。它是宿主事实的权威依据，但**既不是两个评估对象的源码，也不是实机验证** | `read` / `grep` |
| `【已安装运行态·P】` | `/root/.dsh/...` 下已安装的产物/配置。**只是文件层面事实**，不等于「用户在页面上看到了什么」 | `ls` / `cat` / `grep` |
| `【上游远端】` | 远端仓库事实 | `git ls-remote`（只读） |
| `推断（未验证）` | 由源码/契约推得、但本次没有运行态或实机证据的判断 | 明确标注 |

**本文没有任何一条结论写成实机验证。** 本文未取得「页面渲染结果」证据（原因见第 8 节）；主代理取得的 Client Slots 全树只是**拓扑/契约**旁证，既不含实时占用，也不含视觉渲染。

另外，本文 §1.2 的标记之外，全文的源码引用统一采用「**分类标记 + 可点击链接**」：`【本地源码·R】` 指向 [Resident 仓库](../../)（`../../` 起），`【本地源码·D】` 指向 [Deck 仓库](../../../dsh-mattpocock-skills-deck/)，链接带 `#L…-L…` 行号锚点；表格与正文里未逐条给链接的次要引用，均可用同一基址按 `文件:行号` 拼出。

### 1.3 本次用到的只读手段与限制

- 已做：`read`/`grep` 源码；`git log -1`/`status`/`ls-remote`（只读）；`diff -q` 比对已安装副本；读 `/root/.dsh/profiles/web/{package.json,cordis.patch.yml}`；读宿主框架 `lib/*.js`。
- 已试、失败（**本次执笔子代理**）：`cordis_inspect_list` 成功，但 `cordis_inspect_query` 的 Client 查询（`Slots.listSubTree`、`Theme.listTokens`）两次均 10s 超时（「Open or reconnect the Harness page, then retry」）；按纪律不重复重试。因此**本文作者未取得运行态占用/主题 token 快照**。这不等于整场没有任何拓扑证据：主代理另取得了一份 Client Slots 全树（见下一条），它只能作契约旁证。本文所有槽位结论来自源码与宿主契约。
- 主代理旁证文件（只读核对过一次）：`Slots.listSubTree` 全树 `/tmp/dsh-spill-wu6U81/session-5fd6d5f03a9f/4c50c4ef765c-cordis_inspect_query.txt`（会话 spill 路径，易失）。本次核对其字段：`settings.section`、`settings.plugins.tab`、`conversation.input.dock` 是 `kind:"list"`，`sidebar.right.pane.tab`、`tool.view.cordis` 是 `kind:"keyed"`；每个节点只带 `registration` **契约**（字段名/类型/是否必填）与 `purpose`，**没有当前占用者的实例列表**。所以它能印证槽位契约，**不能**证明谁在页面上占用了 slot，也不能证明页面可见性。
- 网络：`git ls-remote origin HEAD` 对 Resident 成功，返回 `54a1a07…`＝本地 HEAD，`【上游远端】`一致；对 Deck **本次失败**（`gnutls_handshake() failed: The TLS connection was non-properly terminated`），Deck 的远端一致性本文**未核对**（限制，见第 8 节）。
- 未做：不装/停/重载插件、不迁移、不建改 issue、不 commit/push、不改任何非本文文件、不点按、不截图、不读 secret。

---

## 2. 两插件现有客户端注册全景（槽位对照表）

### 2.1 槽位注册对照表

| # | slot name | 归属插件 | id / key | order | label | 组件 | 证据 |
|---|---|---|---|---|---|---|---|
| 1 | `settings.section` | Resident | `id: 'github-resident'` | `60` | 字符串 `'GitHub'`（硬编码） | `Panel`（GitHub 常驻身份页） | 【R】[client.js:419-424](../../client.js#L419-L424) |
| 2 | `settings.section` | Resident | `id: 'github-repo-registry'` | `61` | 字符串 `'仓库登记库'`（硬编码） | `RegistryPanel` | 【R】[client.js:427-432](../../client.js#L427-L432) |
| 3 | `settings.section` | Deck | `id: 'dsws-settings-section'` | `18` | thunk `() => tr('panel.title')` → `'MattSkills'` | `SettingsPage`（与 4 同一个组件） | 【D】[panelAssembly.js:91-93](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L91-L93)；locale 键 `locale-panel.js:16`（zh）、`:171`（en） |
| 4 | `settings.plugins.tab` | Deck | `id: 'dsws-settings'` | `40` | thunk `() => tr('panel.title')` | `SettingsPage` | 【D】[panelAssembly.js:86-88](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L86-L88) |
| 5 | `conversation.input.dock` | Deck | `id: 'dsh-mattpocock-skills-deck'` | `40` | 无（不声明 label） | `StatusBar`（状态栏胶囊 + 模态座位） | 【D】[panelAssembly.js:79-81](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L79-L81) |
| 6 | `tool.view.cordis` | Deck | `key: 'self'`（keyed 槽，非 id） | 无 order | 无 | `RunPanel`（Run 卡控制面板） | 【D】[panelAssembly.js:82-84](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L82-L84) |
| 7 | `sidebar.right.pane.tab` | Deck | `key: DECK_NATIVE_TYPE_ID`＝`'dsh-mattpocock-skills-deck/deck:map'` | 无 order | 无（标题在 8） | `DeckSidebarTab`（面板本体，两跳 rAF 后挂 `DetailsDock`） | 【D】[panelAssembly.js:123-125](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L123-L125)；`router.js:31`、`router.js:41-56` |
| 8 | `sidebar.right.pane.tab.title` | Deck | `key: DECK_NATIVE_TYPE_ID`（同上） | 无 order | 组件输出 `tr('panel.title')`＝`'MattSkills'` | `DeckNativeTabTitle` | 【D】[panelAssembly.js:126-128](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L126-L128)；`router.js:57` |
| 9 | *（非 slot）* 服务 `sidebarRightTabs.register` | Deck | `id: DECK_NATIVE_TYPE_ID`，`kind: DECK_NATIVE_TAB_KIND`＝`'dsh-mattpocock-skills-deck:deck-map'`，`priority: 'builtin'`，`guide:[{order:60,title:tr('panel.title')}]` | guide order 60 | thunk title | 右栏类型登记（不是 slots） | 【D】[panelAssembly.js:104-120](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L104-L120)；`router.js:30-31` |

宿主内置占用（供 order 对照）：

| slot name | 占用者 | id | order | 证据 |
|---|---|---|---|---|
| `settings.section` | DSH 设置·通用 | `general` | `0` | 【宿主框架源码·H】`dsh-client-ui-settings-general/lib/client.js:1173` |
| `settings.section` | DSH 设置·插件 | `plugins` | `15` | 【宿主框架源码·H】`dsh-client-ui-settings-plugins/lib/client.js:203` |
| `settings.plugins.tab` | DSH 插件清单页签 | `all` | `10` | 【宿主框架源码·H】`dsh-client-ui-settings-plugin-inventory/lib/client.js:794` |

### 2.2 宿主插槽契约（决定「能不能并存」的一半事实）

- **`settings.section` 是 `kind: "list"`、`scope: "root"`**：允许多个占用者，每个必须有 `id`，按 `order` 升序排，label 支持字符串或 thunk。【宿主框架源码·H】`:1136`（声明）；`:1023-1028`（映射 + `resolveSlotLabel` + `sort((a,b)=>a.order-b.order)`）。
- **内容渲染按「当前选中项」**：`renderSlot("settings.section", { close: onClose }, { only: active })`，即一次只渲染一个 section 组件，并带上 `close`。【宿主框架源码·H】`:337`。
- **label 求值在读取时**：`resolveSlotLabel(label)`＝`typeof label === "function" ? label() : label`，locale 版本变化会触发重算。【宿主框架源码·H】`dsh-client-ui-slots/lib/index.js:27`；`dsh-client-ui-settings-general/lib/client.js:1027`（label）、`:1032-1034`（同时订阅槽位与 locale 变化）。
- **`settings.plugins.tab` 也是 `kind: "list"`、`scope: "root"`**，但它作为 `settings.section#plugins` 的 children 存在：先在「插件」section 里出现页签，点页签才渲染该占用者的组件。【宿主框架源码·H】`dsh-client-ui-settings-plugins/lib/client.js:208-210`（声明）、`:180-190`（映射 + order 排序）。
- **`sidebar.right.pane.tab` / `.title` 是 `kind: "keyed"`、`scope: "session"`**：按 key 分派，key 就是右栏类型 id；两者都在 `rightbar.session` 的 children 里声明。【宿主框架源码·H】`dsh-client-ui-sidebar-right/lib/client.js:9154-9161`。
- **右栏类型登记是服务而不是槽**：`ctx.reflect.provide("sidebarRightTabs", tabs)`，`register(definition)` 会拒绝重复 `id`、拒绝同 band 内重复 `kind`（`builtin` 可被 `extension` 顶掉，直到 extension 注销）。【宿主框架源码·H】`dsh-client-ui-sidebar-right/lib/client.js:8690-8730`（`register` 及其约束）、`:9080`（provide）。
- **`conversation.input.dock` 是 `kind: "list"`、`scope: "session"`**。【宿主框架源码·H】`dsh-client-ui-conversation/lib/client.js:18191`。
- **`tool.view.cordis` 是 `kind: "keyed"`、`scope: "session"`**，声明在 `tool.call.toolview#cordis_run` 之下。【宿主框架源码·H】`dsh-client-ui-cordis/lib/client.js:1456`。

### 2.3 冲突判定（逐槽位）

| 槽位 | 判定 | 依据 |
|---|---|---|
| `settings.section` | **同槽并存，id 三不撞（`github-resident` / `github-repo-registry` / `dsws-settings-section`）；唯一的「冲突」是排序与信息架构**：18（Deck）夹在 15（宿主插件页）与 20（AgentPresets，Deck 注释自述）之间，60/61（Resident）排在其后 | 2.1 第 1-3 行 + 2.2 排序契约；Deck 自述 `panelAssembly.js:89-90` |
| `settings.plugins.tab` | 不撞：只有一个占用者（`all` order 10 / `dsws-settings` order 40）；合并后若保留 Deck 这条，它仍排在 `all` 之后 | 2.1 第 4 行 + 内置 `all` |
| `conversation.input.dock` | Resident 未占用，无冲突 | 2.1 第 5 行；Resident 全文只有 2 个 `ctx.slots.register` |
| `tool.view.cordis` | 不撞：key `'self'`；Resident 未占用 | 2.1 第 6 行 |
| `sidebar.right.pane.tab(.title)` | 不撞：key 是一个几乎不可能重复的长字符串；Resident 未占用 | 2.1 第 7-8 行 |
| `sidebarRightTabs` 服务 id/kind | 不撞：id/kind 均以 Deck 包名作前缀 | 2.1 第 9 行 |
| CSS 类名 | 不撞：Resident 只有 `ghr-*`/`ghreg-*` 前缀；Deck 只有 `dsws-*` 前缀。交叉搜索结果 0 | 【本地源码·R】`client.js:71`、`:81`（`cssFor('ghr'…)`/`cssFor('ghreg'…)`）；【本地源码·D】`kernel/styles.js:11` 起（全部 `.dsws-`）；双向 `grep` 计数均为 0 |

**结论：单插件形态下，除了「设置页归属」这一条是产品决策外，其余槽位在 UI 层没有硬冲突，可以原样保留。**

---

## 3. Deck 设置页的两类注册到底是什么，以及合并方案

### 3.1 两类注册的界面位置

| 注册 | 出现在哪 | 交互形态 | 证据 |
|---|---|---|---|
| `settings.plugins.tab`（`id=dsws-settings`, order 40） | 设置 →「插件」section（order 15）内的一个页签，与内置「全部」页签（order 10）并列 | 点左侧「插件」，再点顶部「MattSkills」页签 | 【本地源码·D】`panelAssembly.js:86-88`；【宿主框架源码·H】`settings-plugins/lib/client.js:180-210`、`settings-plugin-inventory/lib/client.js:794` |
| `settings.section`（`id=dsws-settings-section`, order 18） | 设置左栏一个独立条目「MattSkills」，位置在「插件」（15）之后 | 点左栏条目直达 | 【本地源码·D】`panelAssembly.js:89-93` |

**两者渲染的是同一个组件 `SettingsPage`**（`panelAssembly.js:87` 与 `:92` 都指向 `SettingsPage`），所以「Deck 设置页」的内容只有一份，只是有**两个入口**。Deck 自己的注释也写明这是「与插件页 tab 双入口，复用同一 SettingsPage」（`panelAssembly.js:89`）。

### 3.2 Deck 设置页现在到底有哪些内容（逐区块 + 行号）

合并方案必须先知道要搬什么。按 `SettingsPage.js` 渲染顺序：

| 区块 | 内容 | 关键控件与状态 | 证据 |
|---|---|---|---|
| A. 页内 toast | 顶部提示条（成功/警告/信息），显示 store 的 `notice` | 无交互 | 【D】[SettingsPage.js:132-137](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L132-L137) |
| B. 标题行 | 指南针图标 + `tr('panel.title')`＝`MattSkills`；状态小字 `tr('cfg.status')`＝`配置`；构建注入的版本号（可点跳仓库） | 版本链接 | 【D】[SettingsPage.js:139-146](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L139-L146)；locale [locale-flow.js:139](../../../dsh-mattpocock-skills-deck/src/client/kernel/locale-flow.js#L139)（zh `cfg.status`） |
| C. 更新入口 | `UpdateEntryHost`：由 `__DshUpdateEntry` 捆绑件挂「检查更新」按钮与更新 dialog | 见第 6.2 节状态表 | 【D】[SettingsPage.js:147-148](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L147-L148)；[UpdateEntryHost.js:22-45](../../../dsh-mattpocock-skills-deck/src/client/views/UpdateEntryHost.js#L22-L45)；捆绑脚本 [bundle-update-entry.mjs:28](../../../dsh-mattpocock-skills-deck/scripts/bundle-update-entry.mjs#L28)（全局名 `__DshUpdateEntry`）、[:70-71](../../../dsh-mattpocock-skills-deck/scripts/bundle-update-entry.mjs#L70-L71) |
| D. 星标 / 反馈 | 两个 emoji 链接（🌟 仓库首页、💬 新建 issue），带 `HoverTip` | 纯跳转 | 【D】[SettingsPage.js:149-152](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L149-L152) |
| E. 副标题 | `tr('cfg.sub')`：说明本页只有只读工作区总览 + 底部作者其他插件 | 无 | 【D】[SettingsPage.js:155](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L155)；locale [locale-flow.js:140](../../../dsh-mattpocock-skills-deck/src/client/kernel/locale-flow.js#L140) |
| F. 工作区后端总览 | `renderWsOverview`：一个默认收起的 `<details>`，摘要行显示「工作区 N 个 / 已绑定 M 个」+ 刷新按钮；展开后每行 = 目录 basename + 后端色点/名称 + 来源标签（显式/自动/未设置），可 hover 看全路径；被并入工作区根的行走 `cfg.wsMergedInto` 标注 | 刷新按钮、每行跳转 `gotoWorkspace`（`ws.open/openWorkspace/reveal/focus` 兜底复制路径） | 【D】[SettingsPage.js:130](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L130)、[:161](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L161)；[SettingsWorkspaces.js:8-65](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsWorkspaces.js#L8-L65)（数据）、[:66-141](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsWorkspaces.js#L66-L141)（渲染），摘要与刷新 [:113-114](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsWorkspaces.js#L113-L114)，行 [:131-135](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsWorkspaces.js#L131-L135)，加载/错误 [:116-117](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsWorkspaces.js#L116-L117)，空态 [:95](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsWorkspaces.js#L95) |
| G. 调试 / 诊断日志 | 主开关（调试日志开/关）+ 四个按钮：导出今日日志、打开位置、复制路径、清空今日日志；清空有行内二次确认块 | 开关 `disabled = dbgPending ‖ dbgBusy`；四按钮 `disabled = !!dbgBusy` | 【D】[SettingsPage.js:164-188](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L164-L188)，开关 [:168-172](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L168-L172)，按钮 [:173-178](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L173-L178)，确认块 [:180-187](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L180-L187)；host 电话 `wf.logSetSwitch` / `wf.logExport` / `wf.openFolder` / `wf.logClear` 见 [SettingsPage.js:44](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L44)、[:59](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L59)、[:89](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L89)、[:115](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L115) |
| H. 作者其他插件 | 4 行固定清单（含 Deck 自己），每行点开跳仓库首页 | 纯跳转 | 【D】[SettingsPage.js:5-10](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L5-L10)、[:190-198](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L190-L198) |

**关键事实（会影响合并预期）：Deck 设置页的可配置入口已陆续移除，但并非「没有任何配置项」。** 文档头注释里提到的模板编辑器、外观、面板默认高度、打开位置选择等入口，要么已迁走要么整项删除：

- 「打开位置（DSH 右栏 / BetterSidebar 二选一）」整项删除。【D】[SettingsPage.js:125-127](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L125-L127)、[kernel/config.js:10-14](../../../dsh-mattpocock-skills-deck/src/client/kernel/config.js#L10-L14)
- 配置页模板编辑入口删除（#519）。【D】[kernel/config.js:29-31](../../../dsh-mattpocock-skills-deck/src/client/kernel/config.js#L29-L31)
- 剩余的 `cfg` 存档只有一个 `withWayfinder`，本页不读也不写。【D】[kernel/config.js:15-24](../../../dsh-mattpocock-skills-deck/src/client/kernel/config.js#L15-L24)
- 页内浮窗（`shell.overlay`）整份退役，面板只有右栏一个落点。【D】[panelAssembly.js:76-78](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L76-L78)

**当前页面仍然存在的可操作项**（合并时不能当成「空页」处理）：

- **诊断日志主开关**：一个真正的开关——读本地状态、写经宿主电话 `wf.logSetSwitch`，不是只读展示。【D】[SettingsPage.js:168-172](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L168-L172)
- **四个日志管理操作**：导出今日日志、打开位置、复制路径、清空今日日志（表内行内二次确认）。【D】[SettingsPage.js:173-187](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L173-L187)
- **只读工作区总览**（可展开/收起 + 刷新）与**更新入口**。【D】[SettingsWorkspaces.js:66-141](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsWorkspaces.js#L66-L141)、[SettingsPage.js:147-148](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L147-L148)

用户就本次合并给出的要求只有「以 Resident 为主体、把 Deck 设置页并入 Resident 的仓库登记页」这一条，**没有**点名「追问」或「配置项」。会追问用户的「域文档布局小卡」不在设置页，而是挂在会话输入区 dock 的模态座位上。【D】[SetupCard.js:23-53](../../../dsh-mattpocock-skills-deck/src/client/views/SetupCard.js#L23-L53)（卡本体）、[SetupCard.js:1-20](../../../dsh-mattpocock-skills-deck/src/client/views/SetupCard.js#L1-L20)（为什么挂在 dock）、[prompts-setup.js:17-47](../../../dsh-mattpocock-skills-deck/src/client/kernel/prompts-setup.js#L17-L47)（何时开卡）。

### 3.3 Resident 两页（现状）

| 页 | 内容 | 证据 |
|---|---|---|
| 「GitHub」（id `github-resident`, order 60） | 授权步骤三步、一次性码框 + 复制码、生成一次性码 / 打开授权页 / 立即刷新、状态区（徽标、gh 版本、快照时间、凭据助手、gh 凭据路径、gh 来源、版本更新）、会话指令表 6 条 | 【R】[client.js:284-414](../../client.js#L284-L414) |
| 「仓库登记库」（id `github-repo-registry`, order 61） | 状态区 + 许可追问框 + 6 个动作按钮 + 仓库列表（计数/筛选/每行字段）+ 会话指令表 5 条 | 【R】[client.js:114-278](../../client.js#L114-L278) |

用词纪律（必须在合并后继续成立）：该页**只说「登记库」「建库许可」，不说「未授权/已授权」**，因为那两个词在「GitHub」页指账号凭据。【R】[client.js:174-175](../../client.js#L174-L175)、[:425-426](../../client.js#L425-L426) 注释；正文体现为 [:176-181](../../client.js#L176-L181)（徽标文案）、[:216](../../client.js#L216)（`未许可 · 建库时会先问`）。

另外两条与合并直接相关的事实：

1. `RegistryPanel` 里**没有 `forget` 按钮**。`forget` 只作为工具/HTTP 动作存在（【本地源码·R】`plugin.js:695-699`），页面上只有 build / plan / rescan / verify / revoke / purge(二次确认)。因此「把 forget 按钮加进页面」属于**本次合并之外的新增**，不是保留项。
2. 会话指令表的「用法」按钮**既不复制也不真的丢进会话**：`onClick` 只调 `flash('丢进会话：' + row[0])`，`flash` 仅把一行字塞进 `last` 状态（`client.js:161`、`:276`）。对比「GitHub」页的「复制」按钮会写剪贴板（`client.js:330-334`、`:412`）。合并时应顺手统一，但这属于行为变更，必须单列。

### 3.4 「Deck 设置页合并进仓库登记页」的可落地方案

用户原话是「把 Deck 设置页合并进 Resident 设置页的仓库登记页」。本节的**默认推荐**是「方案 A + 插件管理兼容入口」，即下面 A 的注册行改动加上「兼容入口仍指同一内容/说明」；方案 B 只在产品明确要求按域拆分时才启用：

#### 方案 A（默认推荐）：整体作为「仓库登记页」内的子区块

- 做法：保留 `settings.section#github-repo-registry`（order 61）作为**唯一宿主页**；在该页组件内部，把 Deck 的 `SettingsPage` 内容作为**页内分区**渲染（标题降级、去掉自己的标题行与 toast 容器）。
- 注册行改动：
  - **删除**`settings.section#dsws-settings-section`（【D】[panelAssembly.js:91-93](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L91-L93)）——否则左栏会同时出现「MattSkills（18）」和「仓库登记库（61）」两个入口指向同一份内容，重复。
  - `settings.plugins.tab#dsws-settings` **默认保留为兼容入口**（见本节末「默认处置」）。
  - Resident 侧不动注册行（【R】[client.js:427-432](../../client.js#L427-L432)）。
- 保留／丢失：
  - 保留：A–H 全部区块（只要内容搬进页内）；右栏 tab、Dock、Run 卡完全不受影响。
  - 丢失：设置左栏「MattSkills」直达入口（18）；`SettingsPage` 自带的标题行 B（图标 + `MattSkills` + 版本号）与页内 toast A 的定位语义（它原来是相对 `.dsws-cfg` 绝对定位，`SettingsPage.js:133`）；星标/反馈只是搬家，不丢。
  - 需要新写：分区标题与折叠容器（Resident 侧目前只有 `Section`/`RegSection` 两个原子，`client.js:100`）。
- 主要风险：**信息架构语义变化**——「仓库登记库」这一页现在同时讲两件不相干的事（Git 登记库许可 vs Deck 工作区/诊断日志）。Resident 的用词纪律要求「许可」只指建库许可，所以 Deck 侧任何带「授权/许可」字样的文案都不能出现在这一页（好在 Deck 该页没有这类文案，已逐区块核对 3.2）。

#### 方案 B：拆成若干分区，分别并入

- 做法：不整体搬 `SettingsPage`，而是把 F（工作区总览）、G（诊断日志）、C（更新入口）拆开，分别并入「仓库登记库」页或按性质分散：
  - F 工作区总览 → 并入登记页（与「有哪些仓库」同域）。
  - G 诊断日志 → 并入登记页底部，或收进「GitHub」页（那是宿主/插件健康信息）。
  - C 更新入口 → 并入登记页标题行右侧（与 Resident 页无冲突）。
  - H 作者其他插件 → 可保留在 `settings.plugins.tab` 那一份，或整块删（它只是外链清单）。
- 注册行改动：与方案 A 相同的删除项（`panelAssembly.js:91-93`），外加**必须改造 `SettingsPage.js` 的内部结构**（把 `:139-154` 标题行、`:161` 总览、`:164-188` 调试组、`:190-198` 外链拆成可独立渲染的函数），改动面比 A 大。
- 保留／丢失：保留项与 A 相同；额外丢失「同一页里 Deck 内容的整体感」，多出跨页面的认知成本。
- 何时选 B：只有当产品明确要求「工作区总览属于仓库域、诊断日志属于系统域」时才值得，否则 A 的改动面与回滚成本都更小。

#### `settings.plugins.tab` 的默认处置（不再列为「必须单独拍板」）

**默认推荐：保留这一条注册作为「插件管理」兼容入口，内容指向同一份 Deck 内容（或一段说明），不维持第二套设置状态。**

- 理由：宿主给插件的标准落点是「设置 → 插件」页签（【宿主框架源码·H】`settings-plugins/lib/client.js:203-210`）。删掉它，用户在插件页里找不到任何入口；而 [panelAssembly.js:86-93](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L86-L93) 显示**两个入口本来就渲染同一个 `SettingsPage`**、共用同一个 store，并不是两套设置。合并后默认沿用「同一组件、两个入口」结构，只把左栏那一条（18）并入登记页。
- 兼容入口的形态（按代价从小到大）：
  1. **原样渲染同一个 Deck 设置分区组件**（与登记页内嵌版本同源、同 store；不新增状态）。← **默认**
  2. 换成「说明 + 跳转」入口（文案如「本页设置已并入 设置 → 仓库登记库」）。这需要**新写一个「打开某个 settings.section」的跳转调用**，Deck 现有代码没有对应 API 调用，属新增；默认不采用，除非产品明确要求。
- **默认不采用「删除」**：改动虽只有 [panelAssembly.js:86-88](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L86-L88) 一行，但会让插件页无入口，并可能踩到 Deck 现有 verify 门禁（如 `tests/verify-496b-inject-guard.js` 一类检查注入点存在性的脚本）。若确要删，须同步改门禁与 Resident `verify-ui.mjs`，属实现阶段工作。
- 无论哪种形态，**同一时刻只有一份设置状态**：存档仍是 Deck 的本地 key 与 Resident 的登记库文件，两处入口读写同一份，不新建第二套配置存储。

---

## 4. 合并后「仓库登记页」文字线框（方案 A）

> 说明：线框里每一项后面都用 `【来源】路径:行号` 标注。`[ ]`＝按钮，`▸`＝可展开行，`●/○`＝状态点，`<…>`＝由数据决定的动态文案。

### 4.1 左栏（settings.section 排序结果）

```text
设置（Settings 面板）
└─ 左栏条目（按 order 升序；同 order 保持注册先后）
   ├─ 通用                     order 0    【宿主框架源码·H】settings-general:1173
   ├─ 插件                     order 15   【宿主框架源码·H】settings-plugins:203
   ├─ （宿主其它内置：模型 / 账号 / 子代理 / 联网搜索 / AgentPresets 等，本次未逐个核对 order）
   ├─ MattSkills               order 18   【本地源码·D】panelAssembly.js:91-93
   │                                       ↑ 默认方案 A 下这一条退役（删除该注册，内容并入下方登记页）
   ├─ GitHub                   order 60   【本地源码·R】client.js:419-424   ← 不动
   └─ 仓库登记库               order 61   【本地源码·R】client.js:427-432   ← 合并后的宿主页
                                            ↑ Deck 内容并入此页（A 方案）
```

### 4.2 合并后的「仓库登记库」页完整布局树

```text
┌─ 仓库登记库（settings.section#github-repo-registry，order 61）────────────────────────────┐
│                                                                                          │
│ ① 页面标题区                                                                             │
│   h2 「仓库登记文件库」                                        【本地源码·R】client.js:196│
│   p  lead：一仓一文件 registry/repos/*.json ＋ index.json；                                │
│           建库要经你同意；本页许可只管建库落盘，和账号登录是两件事                            │
│                                                              【本地源码·R】client.js:197-200│
│   ┌（可选）Deck 版本号 + 更新入口挂到这一行右侧 ────────────────────────────────┐        │
│   │  ← 若采用方案 A 的「标题行保留」变体；Deck 原位置                                │        │
│   │    【本地源码·D】SettingsPage.js:139-148 / UpdateEntryHost.js:22-45          │        │
│   └──────────────────────────────────────────────────────────────────────────────┘        │
│                                                                                          │
│ ② 状态摘要区（RegSection「状态」）                            【本地源码·R】client.js:202 │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ● <标签>                        <登记库目录 d.dir>                                    │ │
│ │   标签取值：读取中… / 插件接口未就绪 / 宿主未重启（/registry 404） /                     │ │
│ │             登记库已建立 · N 个仓库 / 已有建库许可 · 库还没建 / 登记库未建立 · 等你同意    │ │
│ │                                   【本地源码·R】client.js:176-181（文案）、:204-205    │ │
│ │ GitHub 账号      <读取中… | 已登录 · <account> | 检查中… | 未登录 · 去「GitHub」页取码>  │ │
│ │                                   【本地源码·R】client.js:206-211                     │ │
│ │ 登记库许可       <root（深度 d）· via  | 未许可 · 建库时会先问>                          │ │
│ │                                   【本地源码·R】client.js:212-216                     │ │
│ │ 条目             <N 个 · 远端 x / 无远端 y  | 未建>   【本地源码·R】client.js:217-219   │ │
│ │ 快照             <最近 updatedAt 截断 19 字符 | —>    【本地源码·R】client.js:220-224   │ │
│ │ （宿主未重启时追加一行说明）                            【本地源码·R】client.js:225-227│ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│ ③ 建库许可区（仅「未给许可」时出现）                          【本地源码·R】client.js:229 │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 问题：<d.ask.question 原文>                                                           │ │
│ │   ← 宿主生成的问题原文，含范围 root、深度 depth、落盘位置、只记录什么                       │ │
│ │      【本地源码·R】plugin.js:405-413（问题构造）、:668（status 里带 ask 的条件）           │ │
│ │ 同意 → 点「建立登记库」；不同意 → 不落盘。        【本地源码·R】client.js:232            │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│ ④ 登记库操作区（按钮行 + 结果行）                            【本地源码·R】client.js:235 │
│   [建立登记库 | 重建登记库] [看计划] [刷新] [对账] [撤销许可] [清空… | 确认清空]           │
│     可用条件见第 6.1 节；清空会先变成「确认清空」再执行    【本地源码·R】client.js:236-244│
│   <lastText 一行结果：失败：… / 对账：一致|有漂移 / 已登记 N（远端 x / 无远端 y） / …>      │
│                                                  【本地源码·R】client.js:183-192, :245  │
│   <闸门原话：…>（仅当上一次 POST 被闸门拦下）      【本地源码·R】client.js:246-248        │
│                                                                                          │
│ ⑤ 仓库列表区                                                 【本地源码·R】client.js:250 │
│   RegSection 标题：「仓库（<shown> / <total>）」              【本地源码·R】client.js:250  │
│   [全部] [只看无远端]（仅在有条目时出现，选中态用 ghost 反相）  【本地源码·R】client.js:252-255│
│   ▸ <name>  ●<绑定 host/owner/repo | 无远端>  <n 处未提交>                              │
│                                          【本地源码·R】client.js:257-264                │
│     <path>                                                                              │
│                                          【本地源码·R】client.js:265                    │
│     <branch> · <head>  <upstream ↑a↓b | 无 upstream>  <updatedAt(MM-DD HH:mm)>           │
│                                          【本地源码·R】client.js:266-269                │
│   空态：库里还没条目：点「建立登记库」。 / 没有匹配的仓库。                                 │
│                                          【本地源码·R】client.js:270-271                │
│                                                                                          │
│ ⑥ 会话指令提示区（5 条）                                     【本地源码·R】client.js:273 │
│   gh_repo_registry {action:"plan"}  只读计划                     [用法]                   │
│   gh_repo_registry {action:"build", consent:true}  同意后建库    [用法]                   │
│   gh_repo_registry {action:"rescan"}  刷新快照                   [用法]                   │
│   gh_repo_registry {action:"verify"}  与磁盘对账                 [用法]                   │
│   gh_repo_registry_list  只读文件库                              [用法]                   │
│      文案表【本地源码·R】client.js:36-42；渲染【本地源码·R】client.js:273-276            │
│                                                                                          │
│ ⑦ ── Deck 并入：工作区与插件 ──────────────────────────────（方案 A 新增分区）             │
│   来源：Deck SettingsPage.js:161 → SettingsWorkspaces.js:66-141                          │
│   ▸ 工作区 3 个  已绑定 2 个   [刷新]  [展开/收起提示]                                     │
│        【本地源码·D】SettingsWorkspaces.js:113-114（摘要、计数、刷新、toggle 提示）         │
│     ├ <basename>          ●<后端名>   [显式|自动|未设置]                                   │
│     │     【本地源码·D】SettingsWorkspaces.js:131-135（行、色点、来源 chip、hover 全路径）  │
│     ├ <basename> 已并入 <工作区根>   ○未绑定  [未设置]                                     │
│     │     【本地源码·D】SettingsWorkspaces.js:128-132（被并入根的归属标注）                │
│     └ 加载中… / <错误行> / 还没有工作区                                                     │
│           【本地源码·D】SettingsWorkspaces.js:116-117（loading/err）、:95（空态）          │
│   注：整组默认收起（<details>），因为它原来就是「只读总览」                                │
│                                                                                          │
│ ⑧ ── Deck 并入：插件更新 ──────────────────────────────────（方案 A 新增分区）             │
│   来源：Deck SettingsPage.js:147-148 → UpdateEntryHost.js:22-45                           │
│   [检查更新]  → dialog：发现新版本 {v} / 已是最新版本 {v} / 检查更新失败，请重试            │
│        文案【本地源码·D】locale-panel.js:149（cfg.updateDialogTitle）等；                 │
│        更完整的更新条目文案由捆绑件 `__DshUpdateEntry` 提供                                 │
│        【本地源码·D】scripts/bundle-update-entry.mjs:28、:70-71                           │
│   装完提示：更新 {v} 装好了，重启一次才生效        【本地源码·D】locale-word.js:137          │
│   待重启横幅：装完要重启一次才生效，重启前界面还会跑旧版本                                   │
│                                                  【本地源码·D】locale-word.js:135          │
│                                                                                          │
│ ⑨ ── Deck 并入：诊断与日志 ────────────────────────────────（方案 A 新增分区）             │
│   来源：Deck SettingsPage.js:164-188                                                      │
│   [开关] 调试日志：开 / 关            【本地源码·D】SettingsPage.js:168-172                │
│   [导出今日日志] [打开位置] [复制路径] [清空今日日志]                                        │
│                                       【本地源码·D】SettingsPage.js:173-178               │
│   清空二次确认块（标题 + 说明 + [取消] [确认清空]）                                          │
│                                       【本地源码·D】SettingsPage.js:180-187               │
│                                                                                          │
│ ⑩ ── Deck 并入：作者其他插件 ──────────────────────────────（低优先，可整块删）             │
│   来源：Deck SettingsPage.js:5-10、:190-198                                               │
│   dsh-mattpocock-skills-deck  …  ↗                                                        │
│   dsh-opencode-palette / dsh-prompt / dsh-im-companion  …  ↗                              │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 合并**不**涉及的落点（原样保留）

| 落点 | 合并后如何保留 | 证据 |
|---|---|---|
| 右侧栏面板（唯一落点） | 原样：服务登记 `id/kind/priority:'builtin'/guide`，内容体注册在 `sidebar.right.pane.tab(.title)`，key 不变 | 【D】[panelAssembly.js:104-130](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L104-L130)；`router.js:30-31, 82-95` |
| 会话输入区停靠条（状态栏胶囊 + 模态座位） | 原样：`conversation.input.dock` id `dsh-mattpocock-skills-deck` order 40 | 【D】[panelAssembly.js:79-81](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L79-L81) |
| Run 卡控制面板 | 原样：`tool.view.cordis` key `'self'` | 【D】[panelAssembly.js:82-84](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L82-L84)；`views/RunPanel.js:7-24` |
| 布局追问小卡（会盖住整个应用的那张） | 原样：挂在 dock 的模态座位上，与设置页在不在、是否合并无关 | 【D】[SetupCard.js:1-20](../../../dsh-mattpocock-skills-deck/src/client/views/SetupCard.js#L1-L20)、[:50](../../../dsh-mattpocock-skills-deck/src/client/views/SetupCard.js#L50)；[prompts-setup.js:17-47](../../../dsh-mattpocock-skills-deck/src/client/kernel/prompts-setup.js#L17-L47) |

**右栏 `id/kind` 与用户布局：默认保留，不随包名改。** `DECK_NATIVE_TYPE_ID` / `DECK_NATIVE_TAB_KIND` 含 `dsh-mattpocock-skills-deck` 前缀，但右栏 tab 的类型 id/kind 是**会话级右栏状态的身份**（【宿主框架源码·H】`sidebar-right/lib/client.js:9154-9161` 按 key 分派、`:8690-8730` 按 id/kind 登记）。因此：

- **默认（推荐）**：合并后**继续使用现有 `id/kind` 字符串**，与合并后的插件包名是否变化无关——包名变化**不要求** tab 身份跟着改。用户已保存的右栏布局（哪一格、在哪个位置、是否展开）继续按同一身份恢复。
- **仅当确有冲突时才改名**：例如新包名与旧包名在同一会话里同时注册同一 `id/kind`（宿主对重复 `id` 与同 band 重复 `kind` 会拒绝）。到那一步应给 **alias / 迁移**，而不是直接换名：在右栏类型登记里把新类型 id 作为别名指向旧 id，或读旧会话状态做一次性迁移。**不能**把「用户布局丢失」说成可接受的代价。
- **未验证**：宿主是否提供「旧 id → 新 id」的别名机制、旧会话状态在改名后的实际表现，均需真机/运行态验证（见 §8 第 8 项）。源码只支持「身份是 id/kind」这一步。

---

## 5. 注册行改动清单（路径:行号）

| # | 文件:行号 | 现状 | 默认（方案 A）改动 | 方案 B 改动 |
|---|---|---|---|---|
| 1 | 【R】[client.js:419-424](../../client.js#L419-L424) | `settings.section` id `github-resident` order 60 label `'GitHub'` | 不动 | 不动 |
| 2 | 【R】[client.js:427-432](../../client.js#L427-L432) | `settings.section` id `github-repo-registry` order 61 label `'仓库登记库'` | 作为宿主页，页内新增 Deck 分区 | 同左，但分区来自拆分后的组件 |
| 3 | 【D】[panelAssembly.js:91-93](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L91-L93) | `settings.section` id `dsws-settings-section` order 18 | **删除这一条注册**（内容并入登记页） | 同左 |
| 4 | 【D】[panelAssembly.js:86-88](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L86-L88) | `settings.plugins.tab` id `dsws-settings` order 40 | **默认保留为兼容入口**（同一内容/同 store，或一段说明），不维持第二套状态；删除仅在同步改造 verify 门禁后才考虑 | 同左 |
| 5 | 【D】[SettingsPage.js:133-201](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L133-L201) | 单组件含标题/总览/调试/外链 | 若保留 Deck 标题行需拆分容器；否则整组件作为子区块被包进登记页 | 必须拆成可独立渲染的函数 |
| 6 | 【R】[client.js:114-278](../../client.js#L114-L278)（`RegistryPanel`） | 登记库页 | 在末尾追加 Deck 分区（`h(DeckSettingsBlock)` 形式） | 按拆分结果逐区插入 |

---

## 6. 交互状态表（逐控件）

> 单元格约定：「按钮可用性」只列**该控件自己**的 `disabled` 条件（源码就是这么写的）。**是否阻塞其他控件**一列说明该状态会不会连带禁用别的控件 —— Resident 的按钮是按「自己的 busy 标签」禁用的，**同一时刻只禁自己**，所以理论上可以并发点两个按钮。

### 6.1 Resident「仓库登记库」页现有控件

| 控件（来源） | 状态 | 触发条件 | 界面文案（来源） | 按钮可用性 | 是否阻塞其他控件 |
|---|---|---|---|---|---|
| 状态徽标 ⓐ【R】`client.js:204` | 初始 | 组件刚挂载，`reg.phase==='idle'` | `读取中…`【R】`:176` | 非控件 | 否 |
| | 加载中 | 三个只读请求未回（`/registry`、`/registry/list`、`/state?cached=1`）【R】`:128-137` | 同上 | —— | 否 |
| | 空库（未建） | `/registry` 回 `libraryExists:false` 且已给许可 | `已有建库许可 · 库还没建`【R】`:180` | —— | 否 |
| | 空库（未许可） | `libraryExists:false` 且 `consent.recorded` 假 | `登记库未建立 · 等你同意`【R】`:181` | —— | 否 |
| | 正常 | `libraryExists:true` | `登记库已建立 · N 个仓库`（N＝清单条数）【R】`:179` | —— | 否 |
| | 插件接口未就绪 | `fetch` 抛错（`reg.phase==='down'`） | `插件接口未就绪`【R】`:177` | —— | 否（按钮**不禁用**） |
| | 宿主未重启 | `/registry` 或 `/registry/list` 回 HTTP 404 | `宿主未重启（/registry 404）`【R】`:178`；另有说明行「重启后刷新本页」【R】`:225-226` | —— | 否 |
| | 色调 | 由 `reg.phase`/`granted`/`hasLib` 决定 4 档 state token | 错误/成功/空闲/警告【R】`:170-173` | —— | 否 |
| GitHub 账号行【R】`client.js:206-211` | 读取中 | `acct===null` | `读取中…`【R】`:208 | 非控件 | 否 |
| | 已登录 | `/state?cached=1` 回 `authenticated:true` | `已登录 · <account>`【R】`:209` | —— | 否 |
| | 检查中 | `authenticated===null` | `检查中…`【R】`:210` | —— | 否（页面每 1.5s 重拉，最多 20 次）【R】`:140-151` |
| | 未登录 | `authenticated` 假 | `未登录 · 去「GitHub」页取码`【R】`:211` | —— | 否 |
| | 请求失败 | `/state` 非 ok 或抛错 → `acct=null` | 回落到 `读取中…`【R】`:131-133` | —— | 否 |
| 登记库许可行【R】`client.js:212-216` | 已许可 | `consent.recorded===true` | `<root>（深度 d）· <via>`，多条用 ` \| ` 连接；深度不是整数时显示 `未知→需重新确认`【R】`:215` | 非控件 | 否 |
| | 未许可 | 同上为假 | `未许可 · 建库时会先问`【R】`:216` | —— | 否 |
| 条目行 / 快照行【R】`client.js:217-224` | 有库 | `hasLib` | `N 个 · 远端 x / 无远端 y`；快照取 `updatedAt` 最大值的 `YYYY-MM-DD HH:MM:SS`【R】`:219、:222-223` | 非控件 | 否 |
| | 无库 | `hasLib` 假 | `未建` / `—`【R】`:219、:224` | —— | 否 |
| 许可追问框 ⓑ【R】`client.js:229-233` | 许可待确认（consentRequired + ask） | `!granted` 且 `/registry` 回了 `d.ask`；宿主侧只有 `consent.granted` 为假时才带 `ask`【R】`plugin.js:668` | 渲染 `问题：<ask.question>`；问题原文由宿主拼装：【R】`plugin.js:407-409`（含 root/depth/落盘位置/记录内容），同意提示「点建立登记库；不同意 → 不落盘」【R】`:232` | 框本身非交互 | 否；按钮**不因此禁用**（未许可时只有「刷新/对账/撤销许可」按各自条件禁用） |
| | 无 ask | 已许可，或旧宿主未带 ask | 整框不渲染【R】`:229` | —— | 否 |
| 「建立登记库 / 重建登记库」按钮【R】`client.js:236-237` | 正常 | —— | 文案随 `granted` 变：未许可 `建立登记库`，已许可 `重建登记库`【R】`:237` | `disabled = busy==='build'` | 否（只禁自己） |
| | 加载中 | 点击后 `busy='build'` | `建立中…`【R】`:237` | 自身禁用 | 否 |
| | 权限被拒（来源闸门） | `POST /registry/build?consent=1` 缺 Origin/Referer 头 | 结果行显示 `失败：E_REGISTRY_CONSENT_ORIGIN：consent=1 只接受来自设置页的请求（缺 Origin/Referer）`；宿主回 `consentRequired`＋`ask` 与 `hint`【R】`client.js:186`、`plugin.js:2534-2545` | 恢复可用 | 否；同时出现「闸门原话：…」行【R】`:246-248` |
| | 宿主未重启 | POST 回 404 | `失败：宿主未重启：这条路由还没上线（HTTP 404）`【R】`:156` | 恢复可用 | 否 |
| 「看计划」按钮【R】`client.js:238` | 正常 | —— | `看计划` | `disabled = busy==='plan'` | 否 |
| | 计划态 | 点击后结果回 `last.action==='plan'` | `计划：待登记 N / 库内 M`【R】`:191` | 恢复可用 | 否 |
| 「刷新」按钮【R】`client.js:239` | 正常（已许可） | `granted` 真 | `刷新` | `disabled = busy==='rescan' \|\| !granted` | 否 |
| | 未许可 | `granted` 假 | 同上 | **禁用**（唯一因权限而禁用的按钮之一） | 否 |
| 「对账」按钮【R】`client.js:240` | 正常（有库） | `hasLib` 真 | `对账` | `disabled = busy==='verify' \|\| !hasLib` | 否 |
| | 漂移（drift） | 对账结果 `inSync===false` | `对账：有漂移`【R】`:187`；**只给布尔，不给漂移明细**（宿主 `verify` 返回里带 `drift`，页面未渲染）【R】`plugin.js:690-692` | 恢复可用 | 否 |
| | 一致 | `inSync===true` | `对账：一致`【R】`:187` | 恢复可用 | 否 |
| | 空库 | `hasLib` 假 | 同上 | 禁用 | 否 |
| 「撤销许可」按钮【R】`client.js:241` | 正常（已许可） | `granted` 真 | `撤销许可` | `disabled = busy==='revoke' \|\| !granted` | 否 |
| | 未许可 | `granted` 假 | —— | 禁用 | 否 |
| | 成功后 | 宿主回 `action:'revoke'` | `许可已撤销（库保留可读）`【R】`:189` | 恢复 | 否 |
| 「清空… / 确认清空」两态按钮【R】`client.js:242-244` | 正常 | `hasLib` 真且未武装 | `清空…` | `disabled = !hasLib` | 否 |
| | 待确认（armed） | 点「清空…」置 `armPurge=true` | 变成红色样式按钮 `确认清空`【R】`:243` | `disabled = busy==='purge'` | 否（不会自动超时取消；点别处或点「撤销许可」会 `setArmPurge(false)`【R】`:241） |
| | 成功后 | `POST /registry/purge?confirm=1` | `库已清空`【R】`:190` | 恢复 | 否 |
| | 权限被拒 | `confirm=1` 缺浏览器来源头 | 宿主回 `ok:false, confirmRequired:true, dryRun:true, error:'E_REGISTRY_ORIGIN…'`【R】`plugin.js:2517-2523`；页面按 `last.error` 显示 `失败：…`【R】`:186` | 恢复 | 否 |
| 结果行 `lastText`【R】`client.js:183-192, :245` | 各态 | 由 `last` 字段决定优先级：`flash` > `consentRequired` > `error` > `verify` > `registered` 数 > `revoke` > `purge` > `plan` > 兜底 | 文案见【R】`:184-192` | 非控件 | 否 |
| 筛选按钮「全部 / 只看无远端」【R】`client.js:252-255` | 正常 | `rows.length>0` 才渲染 | 选中项用 `ghost` 反相表示【R】`:253-254` | 始终可用 | 否 |
| | 空库 | 无条目 | 整行不渲染；空态文案 `库里还没条目：点「建立登记库」。`【R】`:270-271` | —— | 否 |
| 仓库行【R】`client.js:257-269` | 正常 | 每条 `slug` 为 key | 名称 + 绑定徽标（`绑定 host/owner/repo` 或 `无远端`）+ 脏文件数 + 路径 + 分支/HEAD + upstream ↑↓ + 时间【R】`:257-269`；`无远端` 文案【R】`:108` | 行本身不可点 | 否 |
| 指令表「用法」按钮【R】`client.js:276` | 任意 | 点击 | 只把 `丢进会话：<cmd>` 写进结果行（`flash`）【R】`:161`；**不复制、不注入** | 始终可用 | 否 |

**该页没有专设的「权限被拒」状态**：Resident 客户端的权限表达只有两条 —— ① 宿主接口不可达/404（`插件接口未就绪` / `宿主未重启`），② POST 被来源闸门拦下（结果行 `失败：E_REGISTRY_*`）。任何「Android/系统权限被拒」不在这个页面的语义里（该插件用本机回环 HTTP，不走设备权限）。这一点必须如实写进主报告，不能把「权限被拒」写成实机现象。

### 6.2 Deck 并入区块的控件

| 控件（来源） | 状态 | 触发条件 | 界面文案（来源） | 按钮可用性 | 是否阻塞其他控件 |
|---|---|---|---|---|---|
| 页内 toast【D】`SettingsPage.js:132-137` | 任意 | `sharedSt.notice` 非空 | `notice.text`；图标/颜色按 `notice.kind` 取 `NOTICE_COLOR`【D】`:135` | 非控件 | 否 |
| 更新入口【D】`SettingsPage.js:148` + `UpdateEntryHost.js:22-45` | 初始 | 入口件挂载完成前 | 空容器（`<span>` 无内容）【D】`UpdateEntryHost.js:45` | 无按钮 | 否 |
| | 更新可用 | 更新包探测到新版本 | `发现新版本 {v}`（dialog 标题）【D】`locale-panel.js:149`；版本对比行 `当前 {running}，最新 {latest}`【D】`locale-word.js:135` | 可点安装 | 否 |
| | 已是最新 | 探测不到新版本 | `已是最新版本 {v}`（捆绑件文案；本次**只在已安装产物里 grep 到**，未定位源行） | 按钮可用 | 否 |
| | 探测失败 | 网络/host 电话失败 | `检查更新失败，请重试`（同上，已安装产物 grep） | 可重试 | 否 |
| | 重启待生效 | 安装完成、尚未重启 | `更新 {v} 装好了，重启一次才生效`（toast）【D】`locale-word.js:137`；横幅 `装完要重启一次才生效，重启前界面还会跑旧版本`【D】`locale-word.js:135` | 未重启前界面仍跑旧版本 | 否 |
| | 捆绑件缺失 | 产物里没有 `__DshUpdateEntry` | 直接什么都不渲染（入口件返回空 span）【D】`UpdateEntryHost.js:25-26` | 无按钮 | 否 |
| 工作区总览「刷新」【D】`SettingsWorkspaces.js:114` | 初始/加载中 | `wsOverview.loading` | 摘要可点、内容显示 `加载中…`（`cfg.wsLoading`）【D】`:116 | 刷新按钮可用 | 否 |
| | 正常 | 加载完成且有工作区 | `工作区 N 个` / `已绑定 M 个`（`cfg.wsTotal`/`cfg.wsBound`）【D】`:114 | 可用 | 否 |
| | 空态 | 一个来源都没有（连 `sharedSt.cwd` 也没有） | `cfg.wsEmpty`【D】`:95 | 可用 | 否 |
| | 错误 | `wsOverview.err` 非空 | 直接显示错误行（红色）【D】`:117 | 可用 | 否 |
| | 刷新反馈 | 点刷新后 | `cfg.wsRefreshed` / `cfg.wsRefreshFail` toast【D】`:114 | 可用 | 否 |
| 工作区行【D】`SettingsWorkspaces.js:131-135` | 正常（已绑定） | `sel.backendId` 有值 | 目录 basename + 后端色点与名称 + 来源 chip（显式/自动/未设置）【D】`:119-134` | 行可点跳转 | 否 |
| | 未绑定 | 无 `backendId` | `cfg.wsUnbound`【D】`:121 | 行可点（跳转失败则复制路径）【D】`:45-63` | 否 |
| | 被并入根 | `rootOf(cwd)` 命中且不是自己 | `<basename> 已并入 <root>`（`cfg.wsMergedInto`）【D】`:130-132` | 同上 | 否 |
| | 跳转失败 | `workspaces` 服务缺失或方法都不可用 | `cfg.wsNoService` / 复制路径 + `cfg.wsPathCopied` + `cfg.wsSwitchManually`【D】`:49-61` | 同上 | 否 |
| 调试日志开关【D】`SettingsPage.js:168-172` | 初始 | 读本地/模块级 `logSwitch`，读不到再读本地存档 | label `调试日志：开 / 关`（`cfg.dbgSwitchOn/Off`）【D】`:170` | `disabled = dbgPending ‖ dbgBusy` | **是**：`dbgBusy` 非空时同时禁用下面四个日志按钮【D】`:174-177` |
| | 落定中 | `dbgPending=true` | 关闭态行内闪光（成功绿/失败琥珀，约 0.6s）【D】`:22-23, 47-48` | 自身禁用 | 是（同上） |
| | 失败 | `setLogSwitch` 抛错或宿主不可用 | `cfg.dbgSwitchFail` 或 `err.hostUnavailable` toast【D】`:35, 50-51` | 恢复 | 解除 |
| 导出今日日志【D】`SettingsPage.js:174` | 正常 | 宿主可用 | `导出今日日志` | `disabled = !!dbgBusy` | 是（开关在 `dbgBusy` 时也禁用） |
| | 进行中 | `dbgBusy='export'` | 同上 | 禁用 | 是 |
| | 成功/回退 | 宿主回 `ok:true`，`fallback===true` 时追加一句 | `cfg.dbgExportOk` (+ `cfg.dbgExportFallback`)【D】`:77-79` | 恢复 | 解除 |
| | 失败 | 宿主不可用或 `ok!==true` | `cfg.dbgExportFail` toast【D】`:75, 80-81` | 恢复 | 解除 |
| 打开位置【D】`SettingsPage.js:175` | 正常 | 先静默解析日志目录，再调 `wf.openFolder` | `cfg.dbgOpenedDir` / `cfg.dbgOpenDirFail`【D】`:92` | `disabled = !!dbgBusy` | 是 |
| 复制路径【D】`SettingsPage.js:176` | 正常 | 解析目录成功 | `cfg.dbgCopied`（`copyText`）/ 失败 `toast.copyFailed`【D】`:103` | `disabled = !!dbgBusy` | 是 |
| 清空今日日志（两态）【D】`SettingsPage.js:177, 180-187` | 正常 | 未武装 | `cfg.dbgClear` | `disabled = !!dbgBusy` | 是 |
| | 待确认 | 点击后 `clearAsked=true` | 行内确认块：`cfg.dbgClearTitle` + `cfg.dbgClearDesc` + [取消][`cfg.dbgConfirmClear`]【D】`:180-187 | 取消始终可点；确认 `disabled = !!dbgBusy` | 是 |
| | 结果 | 宿主回 `ok`，按 `removed` 数 | `cfg.dbgClearOk` / `cfg.dbgClearEmpty` / `cfg.dbgClearFail`【D】`:118` | 恢复 | 解除 |
| 作者其他插件行【D】`SettingsPage.js:192-198` | 任意 | —— | 4 行固定 slug + 说明（`more.desc.*`）【D】`:5-10`、locale `locale-word.js:139` | 始终可点（外链） | 否 |

**Deck 并入区块没有「权限被拒」状态**：它的所有失败都归到 `err.hostUnavailable` / `cfg.*Fail` toast（【D】`SettingsPage.js:35, 50, 117-120`）。合并文档里不要给这一块编造权限语义。

### 6.3 合并后两套状态轴并存时的注意点

| 注意点 | 事实 | 依据 |
|---|---|---|
| 两套「刷新」语义不同 | Resident 的「刷新」= `POST /registry/build?rescan=1&consent=1`（写库快照）；Deck 工作区总览的「刷新」= 只读重拉 `wf.bindings` / `workspaces.list` / `wf.selection`（不写盘） | 【R】`client.js:239`；【D】`SettingsWorkspaces.js:24-40, 114` |
| 两套「许可」语义不同 | Resident 的许可只关建库落盘（宿主用 Origin/Referer 头判定「人自己点的」）；Deck 侧没有许可概念 | 【R】`plugin.js:2527-2546`；【D】全页无 consent 字样 |
| 两套 toast 位置不同 | Resident 把结果写在页内的结果行（不是浮层）；Deck 是 `position:absolute` 的页内 toast 条 | 【R】`client.js:245`；【D】`SettingsPage.js:133-134` |
| 两套 busy 模型不同 | Resident 是「每个动作一个 tag，只禁自己」；Deck 调试组是「一个 `dbgBusy` 禁全组」 | 【R】`client.js:121, 236-244`；【D】`SettingsPage.js:20, 169-177` |

---

## 7. 单 `client.js` 合并在 `exports`/`inject`/`immediately`/主题/i18n 上的具体改动点

### 7.1 `exports` 与模块装载形态

> **本节的结论纠正 01/03 旧底稿的推测，后续主报告以本节为准。** [01](01-feature-matrix-and-form.md) 的「§5.1 形态 A（单包多行）」写的是「两个 `__ModuleLoader__.load` 各自注册」（隐含两份脚本可分别加载并存）；「§5.3 形态 C」与「§8 未验证事项」又把「`dsh.client` 是否支持多入口」列为未验证前提。本次从宿主源码确认：宿主按包名建客户端图行，注册 id 必须命中图行、重复注册直接抛错（【宿主框架源码·H】`dsh-client-modules/lib/client.js:569-575, 625`），所以可行的只有**一个 `load`、内部顺序调用两半 `apply`** 这一种形态，**不依赖任何「多入口」能力**。旧的「两个 `load` 各自注册并存」推测被证伪。（跨文档只按小节名引用，不写行号锚点——01 正被并行修订，行号会漂移。）

| 项 | Resident 现状 | Deck 现状 | 合并要求与改动点 |
|---|---|---|---|
| `package.json` 的 `exports` | `".": "./plugin.js"`、`"./client": "./client.js"`、`"./package.json"`、`"./locale/*.json"`【R】`package.json:8-13` | `".": "./lib/index.js"`、`"./client": "./lib/client.js"`、`"./tools"`、`"./cordis.patch.yml"`、`"./package.json"`【D·已安装/构建产物】`package/package.json:18-24` | 合并后必须同时具备：① 宿主半入口；② `./client`（否则 `dsh.client` 声明会被判为「exports no ./client bundle」）；③ `./tools`（Deck 的 agent 工具行模块，patch 第二行靠它）。【宿主框架源码·H】`dsh-client-modules/lib/index.js:720` 会因缺 `./client` 直接抛错 |
| 客户端模块 id | `window.__ModuleLoader__.load({ id: '@local/dsh-github-resident-v2', … })`【R】`client.js:9-11` | `window.__ModuleLoader__.load({ id: 'dsh-mattpocock-skills-deck', … })`【本地源码·D】`src/client/index.js:51-54`＋构建生成壳；【已安装运行态·P】`/root/.dsh/plugin-src/dsh-mattpocock-skills-deck/lib/client.js:52-53` | **必须只注册合并后的包名这一个 id**。宿主按包名建图行，并用「loaded without registering "<id>"」判定失败；`register()` 还拒绝重复 id。【宿主框架源码·H】`dsh-client-modules/lib/client.js:569-575`（重复 id 抛错）、`:625`（未注册即失败）。**把两个 `load` 简单拼在一个文件里不行**：Deck 那半会注册旧 id，而图里没有对应行，它的槽位不会被实例化 |
| 可落地做法 | —— | —— | 合并后的 `./client` 由**构建一步生成**：一个 `__ModuleLoader__.load({id: 合并包名})`，内部顺序执行两半的 `apply(ctx)`；即 `{ inject: 并集, apply(ctx){ residentApply(ctx); deckApply(ctx) } }`。Deck 那半仍走它自己的 `scripts/build.mjs`（一源两物拼装 + 方言 shim），Resident 那半是手写单文件。**不存在「一份手写 client.js 同时装两个 `load` 还都生效」的形态** |
| Deck 的自由变量 shim | 无（Resident 只 `require('react')`＋自建 `<style>`） | 构建期在 factory 内自建 `React/host/styles/timer` shim：【已安装运行态·P】`lib/client.js:60-63`（`host = {call: … __rpcCall}`）、`:3281` 附近（`styles.insert`）、`:4052` 附近（`timer`）；源码方言说明【本地源码·D】`src/client/index.js:50` | 合并后**保留 Deck 的 shim**，不要把它改写成 Resident 的 `fetch(127.0.0.1:31790)` 或 `h('style')` 写法；两半的数据通道（`host.call('wf.*')` vs 回环 HTTP）各自保留 |

### 7.2 `inject` 与 `immediately`

> **本节的结论纠正 01/03 旧底稿的推测，后续主报告以本节为准。** [01](01-feature-matrix-and-form.md) 的「§4.7 client 侧注入差异」与 [03](03-migration-permission-plan.md) 的「Phase 4 P4-1」把「`dsh.client.inject` 并集的实际语义」列为需实机验证的前提，并留了「若注入无法合并就退回多行形态」的后路。本次从宿主源码确认存在**两层不同的 inject**：包级 `dsh.client.inject` 是**图依赖**（决定包的注册先后，取并集即可，【宿主框架源码·H】`dsh-client-modules/lib/client.js:656`）、纤维级 `inject`（客户端半导出）是**客户端服务依赖**（合并后 5 项）。两层各自取并集都成立，「注入合并不了」不构成形态门槛，P4-1 里「退回多行形态」的条件不再需要。

| 项 | Resident | Deck | 合并后 |
|---|---|---|---|
| 包级 `dsh.client.immediately` | `true`【R】`package.json:44` | `true`【D·构建产物】`package/package.json:57` | **`true`（不变）**。语义是「首屏预载」，两边都要，无冲突 |
| 包级 `dsh.client.platform` | `web`【R】`package.json:43` | `web`【D·产物】`package/package.json:56` | `web`（不变） |
| 包级 `dsh.client.inject`（图依赖） | `['@deepseek-ai/dsh-client-ui-settings-general']`【R】`package.json:45-47` | `[]`【D·产物】`package/package.json:58` | **取并集＝保留 Resident 那一项**（Deck 不声明）。它保证 `settings.section` 槽的声明方先就位；宿主按 `row.inject` 先注册被依赖包再注册消费者【宿主框架源码·H】`dsh-client-modules/lib/client.js:656`；缺 `./client` 或字段非法会在解析期抛错【H】`dsh-client-modules/lib/index.js:62-78` |
| 纤维级 `inject`（客户端半导出） | `inject: ['slots']`【R】`client.js:417` | `exports.inject = ['connection','slots','locale','workspaces','sessions']`【已安装运行态·P】`lib/client.js:27914`（源码侧由构建注入，见【D】`panelAssembly.js` 头部注释） | **并集＝`['connection','slots','locale','workspaces','sessions']`**（含 `slots`）。这是「客户端插件依赖的客户端服务」，与包级 `dsh.client.inject` 是两回事，别混为一谈 |
| 运行期实际取的服务 | `ctx.slots`【R】`client.js:419`（`apply(ctx)` 参数） | `ctx.get('locale'/'sessions'/'sidebarRight'/'sidebarRightTabs'/'slots'/'timer'/'workspaces'…)` | 无冲突；合并后 Deck 半继续用 `ctx.get(...)`，Resident 半继续用 `ctx.slots` |

### 7.3 主题 token 与深浅色

| 项 | 事实 | 依据 |
|---|---|---|
| Resident | 只用 11 个主题 token，**全部存在于宿主主题**（本次逐个核对，无未定义名）：`--dsw-alias-{label-primary,label-secondary,brand-primary,bg-layer-1,bg-layer-2,border-l1,border-l2,state-success-primary,state-warn-primary,state-error-primary,state-idle-primary}` | 【R】[client.js:46-70](../../client.js#L46-L70)、[client.js:71-91](../../client.js#L71-L91)（两套样式表）；对照【宿主框架源码·H】`dsh-client-ui-theme/lib/client.js:1148`（浅色 `body{…}` 与深色 `body[data-ds-dark-theme]{…}` 两份 token 表） |
| Deck | 使用 19 个 token，其中 **3 个名字在宿主主题里不存在**（共 9 处） | 见下表 |
| 深浅色机制 | 主题靠 `body` / `body[data-ds-dark-theme]` 两组 CSS 变量切换；本机 profile 固定 `preference: dark`、`fontSize: 12` | 【宿主框架源码·H】`dsh-client-ui-theme/lib/client.js:1148`；【已安装运行态·P】`/root/.dsh/profiles/web/cordis.patch.yml:25-28` |
| 合并结论 | 主题层**不需要统一机制**（两边都不改主题，只读变量），但必须修 Deck 的 3 个错名，否则那些位置永远走硬编码兜底色、不跟随深/浅色 | 下表 |

Deck 里名字对不上的 token（本次用「提取源码中所有 `var(--dsw-*)` → 与主题包 token 定义集合求差」得到）：

| 错误名 | 出现处 | 宿主里的正确名 | 后果（源码推断） |
|---|---|---|---|
| `--dsw-alias-state-warning-primary` | 【D】[panel/Dock.js:254](../../../dsh-mattpocock-skills-deck/src/client/panel/Dock.js#L254)、[views/ChecksTab.js:207](../../../dsh-mattpocock-skills-deck/src/client/views/ChecksTab.js#L207) | `--dsw-alias-state-warn-primary`（宿主题确有，`:1320`） | 这两处**永远**取 `#f59e0b`/`#fbbf24` 兜底，深色下可用但浅色下不再跟随主题 |
| `--dsw-alias-interactive-bg-primary` | 【D】[kernel/modal-fields.js:39-40](../../../dsh-mattpocock-skills-deck/src/client/kernel/modal-fields.js#L39-L40)（共 6 处） | 无同名 token；主题里相近的是 `--dsw-alias-interactive-bg-active` / `-hover` / `-hover-solid` | 全部走兜底值 |
| `--dsw-alias-markdown-heading` | 【D】[views/shared/md.js:246](../../../dsh-mattpocock-skills-deck/src/client/views/shared/md.js#L246) | 无同名 token（主题只有 `--dsw-font-markdown-h2` 等） | 走兜底值 |

> 校验方法（只读）：读 `dsh-client-ui-theme/lib/client.js` 里的 token 定义集合，与两插件源码里所有 `var(--dsw-…)` 求差。Resident 侧差集为空。
>
> 附带事实：Deck 源码里还有大量**不带 `var()` 的硬编码十六进制色**（`#8b8b95` 120 处、`#2a2d35` 93 处、`#a1a1aa` 81 处…）。它们多数是 `var(--token,#hex)` 的兜底值，属于「跟随主题但保底」的写法；合并时**不要求**统一，但要知道合并后这一页的深浅色表现由「Deck 的兜底值 + 主题变量」共同决定，与 Resident 那半「纯变量」的观感可能不一致。

### 7.4 i18n：两套机制如何并存

| 项 | Resident | Deck | 合并后的处理 |
|---|---|---|---|
| 机制 | 包级 `locale/zh.json`、`locale/en.json`，内容**只有 `meta.title` / `meta.description`**；客户端代码里**没有任何 locale 注册**（全文无 `ctx.get('locale')`、无 `tr()`），所有界面文案是硬编码中文 | 运行时命名空间：`ctx.locale.register('dsws', L)` + `const tr = localeSvc.bind('dsws')`；`L` 由 9 个片段合并（zh/en 双份） | **可以并存，key 不撞**：Resident 的 JSON key 是插件元数据，Deck 用 `dsws` 命名空间。合并后建议：① `locale/{zh,en}.json` 的 `meta.title/description` 改成合并后的插件名与描述（含 Deck 的能力），因为它们决定「设置 → 插件」页里那一行的显示；② 保留 `dsws` 命名空间不动 |
| `locale/*.json` 到底被谁用 | 宿主在 `readPluginMeta` 里读 `<pkg>/locale/en.json` 作为语言基准，再扫同目录所有 `*.json` 组成字典（文件名必须是语言 id），取 `meta.title` / `meta.description`（以及 `package.json.icon`） | 同左（Deck 的显示元数据来自 `package/package.json` 的 `description`/`homepage`，未见 `locale/` 目录） | 这解释了「Resident 有 locale 文件、界面却仍是硬编码中文」的现状：**JSON 只喂插件清单的显示元数据，不喂设置页组件** |
| 证据 | 【R】[locale/zh.json:1-6](../../locale/zh.json#L1-L6)、[locale/en.json:1-6](../../locale/en.json#L1-L6)、[client.js](../../client.js)（全文无 locale 使用）；【宿主框架源码·H】`dsh-app-boot/lib/index.js:1969`（`readPluginMeta`）与紧随其后的 `dictionariesOf`（扫同目录语言文件、只取 `meta.title`/`meta.description`） | 【D】[src/client/index.js:102-115](../../../dsh-mattpocock-skills-deck/src/client/index.js#L102-L115)；[kernel/locale.js:10-13](../../../dsh-mattpocock-skills-deck/src/client/kernel/locale.js#L10-L13)；locale 片段 [locale-panel.js:16](../../../dsh-mattpocock-skills-deck/src/client/kernel/locale-panel.js#L16)/[:171](../../../dsh-mattpocock-skills-deck/src/client/kernel/locale-panel.js#L171)（`panel.title`）等 | —— |
| 合并残留风险 | 合并后若把 Deck 的分区嵌进 Resident 页，**同一页会出现「Deck 文案跟随语言、Resident 文案永远中文」的双语混排**（在英文界面下最明显：分区标题是英文，页标题与登记库字段是中文）。要么接受，要么把 Resident 那半也迁到某个 locale 命名空间（新增工作，不在本次范围） | —— | —— |
| 求值时机 | —— | label 是 thunk、页面文案是 `tr()` 调用；宿主 locale 变更会触发设置左栏与插件页签刷新 | 【宿主框架源码·H】`settings-general/lib/client.js:1032-1034`（locale revision 参与缓存）；【本地源码·D】`panelAssembly.js:87, 92`（label 写成函数） |
| 合并后 label 写法 | Resident 现在是**字符串**（`'GitHub'` / `'仓库登记库'`），能正常显示，但**不随语言变化**；Deck 是**函数**，随语言变化 | 若要让整页双语一致，Resident 两条 label 应改成 thunk 并接一个 locale 命名空间（`resolveSlotLabel` 明确支持函数，【宿主框架源码·H】`dsh-client-ui-slots/lib/index.js:27`） | —— |

### 7.5 UI 与工具的分工：同一业务动作共享宿主实现（架构规则）

**现状（Resident，已核实）**：同一个登记库业务动作在宿主侧只有一份实现 `registryAction(opts)`（【R】[plugin.js:639](../../plugin.js#L639)），三个入口都调它：

- 工具入口：`gh_repo_registry` 的 `execute` 就是 `registryAction(args)`（【R】[plugin.js:1033](../../plugin.js#L1033)）。
- 设置页 UI 的 HTTP 入口：`/registry/status|plan|verify|revoke|purge|build` 全部 `await registryAction({...})`（【R】[plugin.js:2484-2550](../../plugin.js#L2484-L2550)）。
- 宿主 Service API：`registry: async (opts) => registryAction(opts)`（【R】[plugin.js:2044](../../plugin.js#L2044)）。

**用户授权动作仍是 user-only（现状，已核实）**：`?consent=1` 只在请求带浏览器 `Origin/Referer` 时被接受，也就是只有设置页按钮点出来的请求（【R】[plugin.js:2527-2546](../../plugin.js#L2527-L2546)）；没有来源头的机器/工具调用一律回 `consentRequired` + `ask`，由模型把问题转述给用户（【R】[plugin.js:2543](../../plugin.js#L2543)）。来源还落进 grant：UI 走 `via:'ui:registry-panel'`、工具走 `via:'tool:consent:true'`（来源定义见【R】[plugin.js:2010](../../plugin.js#L2010)；落盘在 [plugin.js:395](../../plugin.js#L395)）。

**合并后的默认规则（建议，不新增能力）**：

1. 同一业务动作仍只有一份宿主实现；UI 与工具是它的两个入口，本次合并只搬 UI 落点，不改宿主实现、不改授权判定。
2. **用户授权动作继续 user-only**：设置页按钮「是人自己点的」这一层不能因为 UI 搬家而放宽；工具路径继续先回 `ask`。
3. **单纯切 tab、展开/收起分区、页内滚动不新增工具**——它们是纯客户端视图状态，不产生新的业务动作。
4. **保持现有操作，不新增「所有设置编辑」的工具面**：默认不把 Deck 设置页的每个控件都做成 agent 工具，也不把只读工作区总览/日志管理改造成新工具。若未来确要暴露某个动作给模型，须单独立项并复用同一宿主实现。
5. Deck 侧的动作是否满足「UI 与工具共享一份宿主实现」，本文**未逐条核对**（Deck 的 `deck_*` 工具与 `wf.*` 宿主电话的对应关系需另查）；合并时应按第 1-2 条同一规则核对一遍。

---

## 8. 本次未能验证的 UI 事项（明确列出）

| # | 未验证事项 | 原因 | 对结论的影响 |
|---|---|---|---|
| 1 | **实时槽位占用快照**（谁在 `settings.section` 上、当前 order/label、右栏 tab 是否已注册） | **本文执笔子代理**的 Client 查询两次 10s 超时（`Slots.listSubTree`、`Theme.listTokens`），按纪律不重复重试；主代理另行取得的 Client Slots 全树只是**槽位契约**（见 §1.3），不含占用实例 | 第 2 节的槽位表来自源码 + 契约；「当前实际生效的占用集合」与页面可见性均未经运行态确认 |
| 2 | 实时主题 token 列表 | 同上（`Theme.listTokens` 超时）。本文改用宿主主题包源码的 token 定义集合做校验 | 第 7.3 节的错名判定基于主题包源码，**不是**运行时 token 表 |
| 3 | 合并后页面在真机的渲染（左栏条目数、版面高度、深浅色观感、双语混排） | 需要安装/启停插件 + 浏览器操控，本文禁止副作用 | 第 4 节线框是**设计线框**，不是截图还原 |
| 4 | Deck 已安装版本（1.7.51）与本地源码（1.8.0-rc.7）的 UI 差异 | 需要逐文件比对已安装 `lib/` 与本地 `src/`；本次只读了已安装产物里的少量字符串/行号 | 以本地源码写的合并方案在真机上可能与现状有差；**验收前必须先对齐版本** |
| 5 | Deck 远端是否有更新提交 | 本次 `git ls-remote` 对 Deck 失败（TLS handshake），Resident 成功且一致 | Deck 侧「本地源码即最新」**未核实**；文档 01 曾成功核对过，本次未能复现 |
| 6 | 更新入口（`__DshUpdateEntry`）的完整 UI（按钮态、dialog 结构、重启横幅样式） | 该组件是构建期从 `dsh-plugin-update` 捆绑进产品的；工作区无其源码，本文只能读已安装产物里的文案字符串 | 第 6.2 节里标「已安装产物 grep」的文案**没有源行号**；「重启待生效」的完整交互未核 |
| 7 | `settings.section` 章节内嵌时「一个 section 组件能否渲染另一个 section 的内容」 | 合并形态 A 是「页内分区」（同一个组件内渲染），不涉及嵌套 section；但若有人想「在登记页里嵌 Deck 的 section 组件」，那属于新写法，未验证 | 方案 A/B 都避免了这种嵌套 |
| 8 | 右栏 tab 的类型 `id/kind` 若被迫改名，用户已有会话布局的表现 | 需要真机 + 会话状态；本文只给出「身份是 id/kind」的源码依据 | 默认方案是**保留原 `id/kind`**，因此不触发这一项；只有确有 id/kind 冲突、必须改名并给 alias/迁移时才需实测 |
| 9 | 主题 `preference: dark` 之外的浅色表现 | 本机 profile 固定深色；浅色只能靠主题包源码里的 `body{…}` 分支推断 | 深浅色结论是源码级，不是实机 |
| 10 | Deck 页内浮层（`.dsws-modal`，`zIndex:10000`；日志菜单 `zIndex:2147483000`）与宿主设置面板的层级关系 | 需要浏览器；本文只从源码读到 z-index 值 | 合并后「清空二次确认」「布局小卡」这些浮层是否会被设置面板遮住，**未验证**；源码依据：【D】`views/SetupCard.js:50`、`statusbar/StatusLogMenu.js:317-322` |

**综上：本文所有 UI 结论的强度是「本地源码 + 宿主契约」级；没有任何一条来自实机或实时渲染。**

---

## 9. 未来验收方案（只写方案，本次一律不执行）

> 以下每一步都**未执行**。执行前提：得到安装/启停授权，且有浏览器操控能力。每条都写清「做什么、看什么、判定标准」。
>
> **故障注入纪律（硬要求）**：本节所有会「制造坏状态」的步骤（删除目录、清空日志、切断路由、模拟旧宿主等）一律在**隔离 profile + 临时仓库/日志样本**上做：
> - 使用独立的测试 profile 与独立的登记库目录，**不要动** `/root/.dsh/profiles/web` 这类生效 profile；
> - 「漂移」用**临时目录里的 git 仓库副本**制造，**不得删除用户真实仓库**或真实登记库条目；
> - 「清空日志」只对**临时日志文件**样本执行，不得清用户真实日志；
> - 需要「旧宿主 / 路由缺失」时，用**隔离端口 + 桩服务**模拟，不改用户生效 profile 或宿主版本。
> - 用**单独的测试容器/环境**或**明确注入的临时存储**、**测试 gh 配置/凭据**、**独立回环端口**与**独立登记目录**；不得落到真实用户全局 Git/gh 配置、家目录文件或现有 `31790` 服务；**即使只 dry-run 也不以真实凭据文件作测试夹具**。
> 任何步骤若只有破坏用户真实数据才能观察到，判定为「不做」，改由桩服务或单元测试覆盖。

### 9.1 版本与形态对齐

1. 把 Deck 已安装副本升级/对齐到与本地源码同一个版本（目标 `1.8.0-rc.7`），记录 `package.json` 版本与 `lib/client.js` 的构建标记，避免「按本地源码写的方案对不上真机」。
2. 安装合并后的候选包到测试 profile，读 `install_bundle` 返回的 `application` 与 `warnings` 字段判定是否真生效（不以日志或进程为准）。

### 9.2 槽位与注册

3. `cordis_inspect_query(platform:"client", provider:"Slots", method:"listSubTree", input:{root:"settings.section"})`：核对占用集合正好是「内置 general/plugins + 合并插件的新条目」，**不再有 `dsws-settings-section`**，并记录每条 order/label。
4. 同法查 `settings.plugins.tab`、`conversation.input.dock`、`tool.view.cordis`、`sidebar.right.pane.tab`（key 版）、`sidebar.right.pane.tab.title`：确认旧 id/key 仍在、且没有重复注册报错（宿主对重复 id 会抛 `duplicate factory registration` / `tab type id is already registered`）。
5. 查 `sidebarRightTabs` 服务的类型登记是否仍为一条 `builtin`，以及引导页里**只出现一枚**「MattSkills」入口（历史问题：曾出现两枚同名入口）。

### 9.3 页面渲染（人工或脚本点按）

6. 打开 设置 → 仓库登记库：核对线框第 4.2 节 ①–⑩ 全部区块存在、顺序正确、无重复标题；截图存档深/浅两套。
7. 许可流程：在未许可状态点「建立登记库」→ 观察是否出现许可追问框与问题原文；确认后（`consent=1`）观察按钮文案变「重建登记库」、状态徽标变「登记库已建立 · N 个仓库」。
8. 闸门（隔离 profile）：在隔离 profile 下，用不带 Origin/Referer 的方式直接 POST `/registry/build?consent=1`，确认页面显示 `失败：E_REGISTRY_CONSENT_ORIGIN…`，并对比**该隔离 profile 自己的登记库目录** mtime 证明没有任何写入；不碰用户真实登记库。
9. 漂移态（临时样本）：在隔离 profile 的临时目录里准备一个 git 仓库副本并登记，只删**该临时副本**后点「对账」，确认结果行出现「有漂移」；**不得删除用户真实仓库或真实库条目**来造漂移。
10. 空库/未重启（桩服务）：用隔离 profile + 桩服务模拟无 `/registry` 路由的旧宿主，确认页面对 404 的表现是说明文字而非白屏；不改用户生效 profile 或宿主版本。
11. Deck 区块：工作区总览展开/收起、刷新、跳转与「已并入根」标注；调试开关与四个日志按钮的禁用联动；清空二次确认（**用临时日志样本**，见本节前言）；更新入口「检查更新」在「有更新/无更新/失败」三种状态下的文案，以及安装后「重启一次才生效」提示。
12. 层级：在设置面板打开时触发 Deck 的二次确认与布局小卡，确认浮层不会被设置面板遮住（本文未验证的 z-index 问题）。

### 9.4 主题与 i18n

13. 深/浅两套主题各截一次图，重点看第 7.3 节列的 3 个错名 token 所在位置（Dock 头部更新时间、ChecksTab 告警条、模态字段、markdown 标题）是否跟随主题。
14. 把界面语言切到英文：记录「Deck 分区英文 + Resident 中文」的混排实际观感，作为「是否要把 Resident 文案也迁到 locale 命名空间」的决策输入。

### 9.5 回归

15. 跑 Deck 自带的与注册/注入相关的 verify 脚本（例如 `tests/verify-496b-inject-guard.js`、`verify-646-native-tab.js`、`verify-665-*`、`verify-t1-locale.js` 一类），确认删除 `settings.section#dsws-settings-section` 不会踩到它们的期望。
16. 复核 Resident 的 `verify-ui.mjs`（它当前校验 `client.js` 的 UI 结构与两页注册），删除/新增注册行后必须同步更新期望——**这一步属于实现阶段，本次不动**。

---

## 10. 关键结论摘要

1. **Deck 的「设置页」是同一个组件（`SettingsPage`）挂在两个入口上**：`settings.plugins.tab#dsws-settings`（order 40，出现在「设置 → 插件」内）与 `settings.section#dsws-settings-section`（order 18，设置左栏直达）。【D】[panelAssembly.js:86-93](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L86-L93)。合并进「仓库登记页」时，**要删的是 `settings.section` 那一条**（`:91-93`）；`settings.plugins.tab` 那一条**默认保留为兼容入口**（同一内容、同一 store，或一段指向说明），**不维持第二套设置状态**（见 §3.4 默认处置）。
2. **Deck 设置页的旧配置入口已移除，但页面不是空的**：模板编辑、外观、面板默认高度、打开位置选择等入口已删除或迁走（【D】[kernel/config.js:10-31](../../../dsh-mattpocock-skills-deck/src/client/kernel/config.js#L10-L31)）；当前仍有**诊断日志主开关**、导出/打开位置/复制/清空四个管理操作、只读工作区总览与更新入口（【D】[SettingsPage.js:132-198](../../../dsh-mattpocock-skills-deck/src/client/views/SettingsPage.js#L132-L198)）。用户要求中**没有**「追问/配置项」这一条；会追问用户的「域文档布局小卡」挂在会话输入区 dock（`views/SetupCard.js:1-20`）。合并工作量是**搬 4 个区块 + 处理双入口**，并**明确保留现存操作**，而不是新增一套设置编辑工具面（见 §7.5）。
3. **UI 层没有硬冲突**：`settings.section` 是 list 槽（允许三方并存，id 三不撞），`dsws-`/`ghr-`/`ghreg-` CSS 前缀零交叉，右侧栏 tab / dock / Run 卡 / 布局小卡 Resident 全未占用。唯一真正要处理的冲突是**信息架构与排序**（18 vs 60/61）；右栏 `id/kind` 与用户布局**默认保留**（见 §4.3）。【R】[client.js:419-432](../../client.js#L419-L432)；【D】[panelAssembly.js:79-130](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L79-L130)；【宿主框架源码·H】`settings-general/lib/client.js:1136, 1023-1028`。
4. **单 `client.js` 不是「把两份源码拼起来」那么简单**：宿主按包名建客户端图行，未注册该 id 即判加载失败、重复 id 直接抛错，所以合并后只能有一个 `__ModuleLoader__.load({id: 合并包名})`，Deck 那半必须作为内部函数被同一个 factory 调用（做法：构建期合成，保留 Deck 自建的 `host/styles/timer` shim）。同时包级 `dsh.client.inject`（图依赖）与纤维级 `inject`（客户端服务依赖，并集 5 项）是**两层、各自取并集**，`immediately` 两边都是 `true` 无需改。【宿主框架源码·H】`dsh-client-modules/lib/client.js:569-575, 625, 656`；【R】`package.json:43-47`、`client.js:9-11, 417`；【P】`lib/client.js:52-53, 27914`。**这条与 §7.1/§7.2 一起，纠正 01 §5.1/§5.3 与 03 P4-1 的旧推测，后续主报告以此为准。**
5. **主题与 i18n 各有一个必须先修的具体点**：① Deck 用了 3 个宿主里不存在的 token 名（`--dsw-alias-state-warning-primary`、`--dsw-alias-interactive-bg-primary`、`--dsw-alias-markdown-heading`，共 9 处），这些位置永远走硬编码兜底色；Resident 侧 11 个 token 全部有效。【D】`panel/Dock.js:254`、`views/ChecksTab.js:207`、`kernel/modal-fields.js:39-40`、`views/shared/md.js:246`；【宿主框架源码·H】`dsh-client-ui-theme/lib/client.js:1148, 1320`。② Resident 的 `locale/{zh,en}.json` **只喂插件清单的显示元数据**（`meta.title`/`description`），不喂设置页组件，而 Resident 的 section label 是硬编码字符串、Deck 是 `tr()` thunk——合并后在英文界面下会出现「Deck 分区英文、Resident 文案中文」的混排。【宿主框架源码·H】`dsh-app-boot/lib/index.js:1969` 及其后 `dictionariesOf`；【R】`client.js:423, 431`；【D】`panelAssembly.js:87, 92`。
6. **UI 与工具的分工保持现状**：同一业务动作在宿主侧只有一份实现（Resident 登记库动作为 `registryAction`，UI 路由、`gh_repo_registry` 工具、Service API 三处同调）；**用户授权动作仍 user-only**（`?consent=1` 只接受设置页来源头，工具路径先回 `ask`）；单纯切 tab/折叠不新增工具，本次合并也**不为每个设置控件新增工具**（见 §7.5）。
