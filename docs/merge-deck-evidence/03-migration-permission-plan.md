# 证据文档 03：数据迁移归属、权限同意与并存风险 · 分阶段实施方案

> 本文件是《merge-deck-assessment-2026-10-11.md》的支撑证据之一，对应任务「迁移/权限/风险与实施证据」。
> 全程只读调研，**未执行任何迁移、未安装/启停插件、未创建或修改 issue、未做任何 git 写操作**。

### 修订记录（v3，2026-10-11）

- **改动（定点收口，只改本文件）**：① 右栏 tab 一行按证据 02 §4.3 归位——默认保留 `DECK_NATIVE_TYPE_ID`/`DECK_NATIVE_TAB_KIND` 与用户布局，npm 包身份变化**不要求** tab id 变；删除「改名即 id 变、布局丢失可接受」的相反建议，仅在确有 `id/kind` 冲突时规划 alias / 显式无损迁移。② 左栏产品名「MattSkillsDeck」更正为真实 label「MattSkills」（`locale-panel.js:16`/`:171`），不动工具名与包名。③ 测试条数（原 330/约 300）删除，改为「沿用 Deck 既有检查链，实际清单以脚本为准」，避免与证据 01 的历史计数互相作事实保证。本文件其余结论未变，仍为只读评估，v3 未重新采集运行态。

### 修订记录（v2，2026-10-11）

- **改动**：按主报告验收反馈修订——① 删除「合并/迁移/卸载前必须先拆凭据」的步骤；凭据销毁改为用户另行明确要求的独立动作，常规合并/回滚/卸载默认保留账号、OAuth/PAT、helper、gh 缓存与用户配置。② 补「原插件与含同名能力的新插件必须互斥激活」，并给出隔离 profile 预演、切换与失败恢复的分期。③ 把 `plugin.js` 的「绝不写进仓库」归位为 `PROTOCOL.registry` 的操作契约，不再当成全插件无写承诺，也不降低既有承诺。④ 拆分包级 `dsh.client.inject`（包名）与纤维级 `inject`（客户端服务名）两组事实。⑤ 删除「插件包更新链 + gh 自更新链 = 两套凭据入口」的错误论证。⑥ 逐项给出 `settings.yaml`/`workspace.yaml`/`label-colors.yaml` 的实际调用链，未接线项标「待验证」；第一阶段保留 localStorage，持久化统一列为后续可选。⑦ 修正「默认目录未见＝从未建库」「查询超时＝没有已连接页面」两处推断。⑧ 工作量改为主观区间估算，不再把历史工作量/人日当实测依据。⑨ 补仓库身份关联原则与登记清理边界。⑩ 明确保留 10 个 `deck_*` 工具（含 `deck_probe`）与用户既有权限及 root/depth grant；持久授权覆盖时无须再次确认。⑪ 未来验证限定在隔离 profile、临时测试仓库与测试凭据。
- **已解矛盾**：
  1. 原 §1.5/§2.6/§6 把 `plugin.js` 的「绝不写进任何仓库」当成整个插件的全局无写承诺，据此要求「合并后重写承诺」；核实后该句只出现在 `PROTOCOL.registry.invariants`（[plugin.js:2013-2018](../../plugin.js#L2013-L2018)）与 `guarantees.registryWritesOnlyItsOwnDir`（[plugin.js:2026](../../plugin.js#L2026)），管的是登记操作。它与 Deck 写 `<workspace>/docs/agents/` 不冲突，既有承诺**不需要降低或重写**。
  2. 原 §2.5 用「Deck 的插件更新链 + Resident 的 gh 自更新链」论证「会出现两套凭据入口」；这两条链的目标分别是插件包与 gh 二进制，都不碰凭据，该论证删除（更新目标差异保留在 R4）。
  3. 原 §1.4 与 R6 把包级 `dsh.client.inject`（包名列表）与纤维级 `inject`（客户端服务名列表）并成一组「并集」；现拆成两行，依据证据 02 §7.2。
  4. 原 §1.3 认为 `workspace.yaml` 的老 `.json` 是「写成功后才删」；实际生产迁移**保留老文件备查**（[workspaceCwd.js:203](../../../dsh-mattpocock-skills-deck/src/host/workspaceCwd.js#L203)），只有 label-colors 生产路径与未接线的 configStore 会删老文件。
  5. 原 §0.2 由 `Slots.listSubTree` 超时推断「当前没有已连接的 Harness 页面」；超时只说明该次查询未返回，删去该推断（详见修订后的 §0.2）。

## 0. 元信息与来源纪律

| 项 | 值 |
|---|---|
| 采集时刻 | 2026-10-11 15:20–15:35（UTC），即北京时间同日深夜；v2/v3 于同日晚修订，**未重新采集运行态** |
| 调研对象 | `/root/dsh-github-resident/dsh-github-resident`（Resident，本地 `1.6.4`，commit `54a1a07`）、`/root/dsh-github-resident/dsh-mattpocock-skills-deck`（Deck，本地 `1.8.0-rc.7`，commit `3b25cd3f`） |
| 上游远端 | Resident `origin=https://github.com/SunsetRNE/dsh-github-resident.git`（本地 HEAD `54a1a07` 与 `origin/main` 相同）；Deck `origin=https://github.com/FeatherHunter/dsh-mattpocock-skills-deck.git`（本次只读 `git ls-remote` 看到远端 `main=21f3ca1`，**与本地 HEAD `3b25cd3f` 不同**）。因此本文件的源码链接统一用工作区相对链接，不用远端 blob 链接 |
| 已安装运行态 | DSH profile `web` 同时装了 Resident（`@local/dsh-github-resident-v2`，`1.6.4`，`link:` 指向 `/root/.dsh/plugin-src/@local/dsh-github-resident-v2`）与 Deck（`dsh-mattpocock-skills-deck`，**`1.7.51`**，`link:` 指向 `/root/.dsh/plugin-src/dsh-mattpocock-skills-deck`）。见 `/root/.dsh/profiles/web/package.json:13-14` |
| 本次唯一写入范围 | `/root/dsh-github-resident/dsh-github-resident/docs/merge-deck-evidence/03-migration-permission-plan.md` |

### 0.1 三类事实的标注约定

沿用证据 01 的口径，本文件每条关键事实标注来源类别：

- **`本地源码`**：读的是上面两个 checkout 里的文件，可给出行号。
- **`上游远端`**：只读网络查询（本次对两仓只做了 `git ls-remote`；两仓本地 HEAD 与远端是否一致已在 §0 元信息表记录，未做 fetch/差异比对）。
- **`已安装运行态`**：`cordis_inspect_query`（Host 侧 `Config`）或对 `/root/.dsh`、`/root` 下既有文件做 `ls/stat` 只读观察所得；**不含**任何安装、启停、迁移动作。

**源码链接约定**：重要来源写成可点击的相对链接并带行号，与证据 02 同一写法（Resident 形如 `[plugin.js:2013-2018](../../plugin.js#L2013-L2018)`；Deck 形如 `[panelAssembly.js:91-93](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L91-L93)`）。行号以本地 checkout 为准（Resident `54a1a07`、Deck `3b25cd3f`）。

凭据只写「存在性 / 路径 / 权限位 / 读写者 / 脱敏形态」，**不打印任何内容**（`.git-credentials`、`hosts.yml`、`install.json` 的字段值、`github-resident.json` 的 token 一律只报键名或计数）。

### 0.2 本次未能验证的限制（提前声明，详见 §5.2）

1. **Deck 客户端槽位在本次调研期内未能枚举**：`client/Slots.listSubTree(root="settings.section")` 在该时段连续超时（`Client inspect query Slots.listSubTree timed out after 10000ms`）。**超时只能说明这一次查询没有返回，不能推断「当前没有已连接的 Harness 页面」**。后续证据 02 已取得 Client Slots 全树（拓扑），本文件据此只声明「拓扑已知、页面可见性与实际占用仍待实机确认」。
2. **未做任何副作用验证**：所有迁移、写入、安装、启停、浏览器渲染，一律只写进 §4.4 的「未来验收方案」。
3. 本文件不复制证据 01/02 的功能矩阵，只引用其结论。

---

## 1. 配置与数据字段迁移归属表

### 1.1 列定义与权限位判定口径

- **权限位来源**：标 `源码` 的是代码显式设置（可复核行号）；标 `运行态` 的是本次 `stat` 观察到的实际值；标 `不可判定` 的是写入经过调用方传入的文件服务（io），代码内不设 mode。
- **「生命周期」**：谁创建、谁刷新、谁清理。
- **「合并后归属」**取值四种：`沿用 Resident` / `沿用 Deck` / `合并为新位置` / `需一次性迁移`。**第一阶段默认「保持现状」**：设置入口合并本身不改任何存储位置，也不要求任何存储改名或搬家；任何持久化统一都属后续可选工作（见 §1.3 的 localStorage 行）。
- **幂等性**：重复执行该迁移动作是否安全（是否可重入、是否会产生副本或覆盖用户手写内容）。

### 1.2 表 A —— Resident 的落盘数据（本地源码，除注明外）

| 数据/配置项 | 现存放位置 · 格式 · 权限位 | 读写源码（路径:行号） | 生命周期 | 合并后归属 | 迁移风险与幂等性 |
|---|---|---|---|---|---|
| Resident 身份状态 | `~/.dsh/github-resident.json`，JSON：`{token, login, reposRoot?, updatedAt}` | 定义 [plugin.js:21-25](../../plugin.js#L21-L25)；读 [readState 49-55](../../plugin.js#L49-L55)；写 [writeState 57-63](../../plugin.js#L57-L63)（`writeFile mode 0600` + `chmod 0600`）；取值 [tokenOf 65-67](../../plugin.js#L65-L67)；使用者 `registryDefaultRoot 588-591`、`syncRepos 772-773`、`teardown 1626` | 由 `gh_resident_login` 类动作创建；`gh_cli_logout{reset_state:true}` 删除（`1662-1665`）；**本次在固定路径未 stat 到**（该路径无环境变量改写口） | **沿用 Resident**（单一身份源，勿新建第二份） | 幂等：整文件读-改-写，重复登录只覆盖同名字段。风险：合并后若 Deck 侧也写身份，会出现第二个 token 落点 → 与 Resident `LESSONS.md:100` 记的「5 份副本」收敛方向相反 |
| git 明文凭据 | `~/.git-credentials`，每行 `https://user:token@host`；**权限位 0600**（源码 `230-231`） | 路径 `plugin.js:24`；只按 host 覆写 [writeCredentialLine 220-233](../../plugin.js#L220-L233)（保留其它 host 行）；登录时写 `950`；状态只报 `exists/hasGithubHost/lines`（`896-899`，不回内容）；清理 `1666-1670` | 由 `gh_resident_login` 创建；`gh_cli_logout{purge_git:true}` 删除；**本次未 stat 到** | **沿用 Resident** | 幂等：按 host 过滤后重写，可重入。风险：这是全仓唯一的明文 token 落盘点，合并时若把 `writeCredentialLine` 换成整文件覆写，会冲掉用户其它 host 凭据（`LESSONS.md:242` L6 记录的已修缺陷） |
| git 全局凭据助手 | `git config --global credential.helper = store` | 写 `plugin.js:951-954`（已有非 `store` 的 helper 时**不覆盖**）；`gh_cli_setup_git` 走另一条路 `1892-1912`；拆除 `helperKeys` `1631-1635` + `1671-1675` | 由 `gh_resident_login` 或 `gh_cli_setup_git` 创建；`gh_cli_logout{purge_git:true}` unset；**本次 `--get-all` 无输出（未设置）** | **沿用 Resident**，但需在合并契约里声明「唯一写入者」 | 幂等：`git config` 重复写同值安全。风险：两条写入路径（store 与 gh helper）语义不同，合并后若 Deck 也写 `git config`，会出现第三个写者；`DSH_GH_PATH`（Deck，[src/host/index.js:35](../../../dsh-mattpocock-skills-deck/src/host/index.js#L35)）与 `DSH_GH_*`（Resident）前缀相邻，需显式划界（证据 `01` §4.4 已提） |
| 仓库登记文件库 · 授权 | `~/.dsh/github-resident/registry/consent.json`，JSON：`{schema, schemaVersion, granted, updatedAt, grants[]:{root, depth, grantedAt, via, tool}}` | 路径 [plugin.js:164-168](../../plugin.js#L164-L168)；schema `161`；读 [readConsent 361-368](../../plugin.js#L361-L368)、`consentGrants 371-376`、[consentCovers 383-390](../../plugin.js#L383-L390)；写 [mergeConsent 393-403](../../plugin.js#L393-L403)（`via` 记 `395`）；只有本次真拿到同意才写 [734-739](../../plugin.js#L734-L739) | `gh_repo_registry{action:"build",consent:true}` 创建；`action:"revoke"` 删除（`710-718`）；`purge{confirm:true}` 连目录删（`720-731`） | **沿用 Resident**（登记库许可与 Deck 的功能开关必须分属不同文件） | 幂等：同 root 覆盖、depth 取大者（`393-394`）。风险：`via` 曾被 rescan 改写成 `recorded-consent` 而断掉审计链（`LESSONS.md:267-268`，已修为只在本次同意时写）。**位置说明**：`REGISTRY_BASE` 可被 `DSH_GH_REGISTRY_DIR` 整体改写（[plugin.js:164](../../plugin.js#L164)），因此**默认路径本次未见，不能推断「从未建库/从未授权」**（见 §5.2） |
| 仓库登记文件库 · 条目与索引 | `registry/repos/<basename>-<sha1(abs)[:12]>.json`（一仓一文件）与 `registry/index.json`；**文件 0600 / 目录 0700**（源码 [writeJsonAtomic 240-249](../../plugin.js#L240-L249)） | 路径 [plugin.js:164-168](../../plugin.js#L164-L168)；slug `173-176`；URL 脱敏 `179-190`、`215-218`；读 `readRegistry 330-351`；写 [registryWrite 484-508](../../plugin.js#L484-L508)；单条删除 `695-707` | `build`/`rescan` 写；`forget` 删单条；`prune:true` 剪失效条目；`purge` 删整棵 | **沿用 Resident**（写范围由 `PROTOCOL.registry` 的操作契约界定，见 [plugin.js:2013-2018](../../plugin.js#L2013-L2018)） | 幂等：同路径重扫覆写同 slug 文件、`registeredAt` 保留、`notes/tags` 保留（`299-321`）。风险：`index.json` 是派生视图，迁移时必须允许「删了可由 repos/*.json 重建」，否则会把派生数据当事实来源。同样受 `DSH_GH_REGISTRY_DIR` 位置影响 |
| 自带 gh 落地与留痕 | `~/.dsh/gh-cli/bin/gh`（**运行态 0755**，39 MB）、`install.json`（**运行态 0600**，键 `arch/installedAt/source/tag/version`）、`gc.json`（**运行态 0600**，键 `at/freedBytes/removedCount`） | 目录常量 `plugin.js:1136-1138`；三层解析（L1 系统 → L2 插件缓存 → L3 自动落地）`1128-1132`、`resolveGh 1398`；版本自更新 `versionStatus 2171`、`autoUpdate 2208`；GC `gcCache 2253`、`gcCacheOnce 2262`；拆除 `1691-1697`（默认清缓存） | 加载期或显式 `gh_cli_install` 落地；`autoUpdate` 换版本；`gh_cache_gc` 剪旧版本；`gh_cli_logout{remove_gh_cache:true}`（该工具默认开）删整目录 | **沿用 Resident**（常规卸载/合并**不调用** `gh_cli_logout`，缓存默认保留） | 幂等：`install.json` 记来源与 tag，重复落地写同路径。风险：`LESSONS.md:168-173`「加载期预置与手动落地撞车、GC 删掉正在用的包」是已发生过的坑，迁移脚本不得额外写这个目录 |
| 系统 gh 包 | `/usr/bin/gh`（dpkg 包 `gh`） | `probeGh 1170-1183`；`whichCmd 1157-1161`；拆除 `1684-1689`（`dpkg -r gh`） | 宿主包管理器管理；`gh_cli_logout{uninstall_gh:true}` 才动 | **沿用 Resident，且默认只报告不改动** | **本次 `ls` 与 `command -v` 都没看到 gh**。风险：合并后若把「清理系统 gh」放进常规卸载，等于替用户删系统包，必须保持「显式开关 + 只报告」 |
| 全局 git 身份 | `git config --global user.name` / `user.email` | 可选写 `plugin.js:956-962`、`1907-1911`；读 `892-893`、`1856` | 由 `gh_resident_login`（显式传参）或 `gh_cli_setup_git{set_identity:true}` 写 | **默认不动**（用户既有环境配置，不是插件数据） | 迁移脚本**不读不写**；**本次两项均未设置**（`--get-all` 无输出） |
| 账号快照与版本探测缓存 | 进程内 `probeCache`（`plugin.js:1164`）、`lastServerError`；**无落盘** | `probeGh 1170-1183`、`versionStatus 2171` | 进程生命周期 | **沿用 Resident** | 无迁移动作；TTL 由 `DSH_GH_*_TTL_MS` 控制（`README.md:210-213`） |
| 回环 HTTP 端点 | `127.0.0.1:31790`（`DSH_GH_API_PORT` 可改），端点见 `PROTOCOL.http` | 端口 `plugin.js:2082-2083`；端点清单 `1941-1957`；来源闸门 `pageOriginOf 2088`、`originAllowed 2093`、`2104/2122-2123` | 插件加载/卸载随 effect 起停（`2636-2643`） | **沿用 Resident**（Deck 无 HTTP 服务，证据 `01` §4.3） | 幂等：端口被占会在 `/state.serverError` 显示。风险：合并后 `PROTOCOL.http.endpoints` 若漏登记 Deck 新增路由，`gh_protocol` 会漏报（证据 `01` §4.3 建议） |

### 1.3 表 B —— Deck 的落盘数据（本地源码，除注明外）

| 数据/配置项 | 现存放位置 · 格式 · 权限位 | 读写源码（路径:行号）与**实际调用链** | 生命周期 | 合并后归属 | 迁移风险与幂等性 |
|---|---|---|---|---|---|
| 宿主侧「用户选的后端/布局」记忆 | `~/.dsh/mattskillsdeck/choices.json`；`{version:1, workspaces:{<sha256(key)[:24]>:{backendId,rev,pickedAt,source:'user'}}, layouts:{...:{layout,pickedAt}}}`；**文件 0600 / 目录 0700**（源码 `178-193`，`mode:0o600, flag:'wx'`）；**运行态：存在，443 B，0600**（`version:1`，`workspaces` 2 条、`layouts` 1 条） | 常量 [choiceStore.js:20-31](../../../dsh-mattpocock-skills-deck/src/host/choiceStore.js#L20-L31)、路径 `38-46`；读 [readFromDisk 152-175](../../../dsh-mattpocock-skills-deck/src/host/choiceStore.js#L152-L175)；写 [writeToDisk 178-193](../../../dsh-mattpocock-skills-deck/src/host/choiceStore.js#L178-L193)；读单条 `252-273`；写 [rememberWorkspace 280-308](../../../dsh-mattpocock-skills-deck/src/host/choiceStore.js#L280-L308)、`rememberLayout 311-330`；宿主构造口 `createChoiceStoreForHost 347-351` | 用户在人面板里亲手选后端时写；无自动删；超上限按 `pickedAt` 丢最旧（`195-240`，默认 200 条/512 KB） | **沿用 Deck**（文件家目录是 `<home>/.dsh/mattskillsdeck/`，与 Resident 的 `~/.dsh/github-resident*` 不重叠） | 幂等：写是临时文件+rename（`184-186`）；读带逐条校验与「读不到就不写」降档（`150-175`、`289-291`）。**硬约束**：[choiceStore.js:7-8](../../../dsh-mattpocock-skills-deck/src/host/choiceStore.js#L7-L8) 明写「不许改用 `repoKeys.js` 的 `getCacheDir()`」，因为那是跟着进程启动目录跑的，合并时若图省事统一到工作区缓存目录，等于把一半记忆留在原地 |
| 本机全局设置 | `~/.dsh/mattskillsdeck/settings.yaml`（版本 1）；键 `version/ui{stateFilter,sortKey,sortDir,labelClicks}/workspaces/debug/templates` | 相对路径常量 `config-store-core/src/settings.ts:15-16`、运行时副本 `src/shared/config-store/settings.js:3`；路径拼接 [src/host/configStore.js:30-32](../../../dsh-mattpocock-skills-deck/src/host/configStore.js#L30-L32)；读 [262-277](../../../dsh-mattpocock-skills-deck/src/host/configStore.js#L262-L277)；写 [279-301](../../../dsh-mattpocock-skills-deck/src/host/configStore.js#L279-L301)（整份覆盖 + 写完读回比对）。**实际调用链：断的**——`settings.js` 生产侧只被 `configStore.js:19` import，而 `configStore.js` 在 `src/` 内没有任何生产调用方（命中只在 `tests/verify-config-store-*.js`） | 设计上「第一次保存时自动建」（[configStore.js:270](../../../dsh-mattpocock-skills-deck/src/host/configStore.js#L270) 回执文案），但该路径当前不可达 | **沿用 Deck**；第一阶段**不改文件位置也不接这条链**，设置入口合并只改 UI 落点；把 UI 偏好统一持久化到 `settings.yaml` 是**后续可选工作**（标：待接线、待验证） | 现状风险：`settings.yaml` 这条路径**已实现但未接线**，当前 UI 偏好仍存浏览器 localStorage（见本表末行）。合并时若把它当「既有事实来源」写迁移脚本，会迁一份空文件。**幂等性（若未来接线）**：写是整份覆盖，重复执行安全但会替换用户手写注释（`settings.ts:20` 注释已明说） |
| 工作区后端配置（随仓库走） | `<workspace>/docs/agents/workspace.yaml`（版本 2）；老路径 `docs/agents/workspace.json`（版本 1，**只做兼容读**） | 常量 `config-store-core/src/workspace.ts:20-21`、`src/shared/config-store/workspace.js:3-5`；垫片 [src/shared/deck-tools/workspace-file.js:14-60](../../../dsh-mattpocock-skills-deck/src/shared/deck-tools/workspace-file.js#L14-L60)、`parseWorkspaceFile 35-52`；**生产读路径** [backendDecision.js:100-127](../../../dsh-mattpocock-skills-deck/src/host/tracker/detection/backendDecision.js#L100-L127)、`explicitDetector.js:44-50`、`workspaceCwd.js:174-183`；**生产写路径（首绑与迁移）** [workspaceCwd.js:185-193](../../../dsh-mattpocock-skills-deck/src/host/workspaceCwd.js#L185-L193)（写 YAML）、`208-243`（老用户把 `choices.json` 记忆搬进文件）。**注意**：`src/host/configStore.js:234-260` 的 `readWorkspaceConfig`/`writeWorkspaceConfig` 在 `src/` 内**无生产调用方**（只在 tests 里），不能拿它当「已接线」的证据 | 用户选后端时写；**生产路径保留老 `.json` 备查，不删**（[workspaceCwd.js:203](../../../dsh-mattpocock-skills-deck/src/host/workspaceCwd.js#L203) 注释） | **沿用 Deck**（这是 Deck 的仓库内契约；Resident 的登记操作不写仓库内部，两者不冲突，见 §2.6） | 幂等：新老并存以新为准（`readFileLayer` 先读 YAML 再退回老 JSON），写新不删老；`tests/verify-config-store-migration.js` 的 M1–M4 钉住核的四种结局（核已接线，适配器层 `configStore.js` 未接线，两者要分开看）。风险：合并改名时不要动这份仓库内契约 |
| 标签配色（随仓库走） | `<workspace>/docs/agents/label-colors.yaml`（版本 1）；老路径 `docs/agents/label-colors.json`（兼容读） | 常量 `src/shared/config-store/labels.js:5-7`；**生产读写** [label-colors.js:234-300](../../../dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/label-colors.js#L234-L300)（`ensureLabelColors`/`publishLabelColors`，写新删老 `removeLegacyLabelsFile`）与 [label-colors-ops.js:11-216](../../../dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/label-colors-ops.js#L11-L216)；文本/形状核由 markdown 的 `label-colors-codec.js:14` import `src/shared/config-store/labels.js`。**注意**：`src/host/configStore.js:305-330` 的同名 `readLabelColors`/`writeLabelColors` 在 `src/` 内**无生产调用方**（标：未接线） | 打开改色弹窗/写标签色时写；写新删老 | **沿用 Deck** | 幂等：同 workspace 文件的新老切换。风险：生产侧只有 markdown 后端一套读写（带串行化与原子发布）；合并时不要新增第三个写者 |
| 工作区磁盘缓存（快照） | `<DSH 进程 cwd>/.dsh-mattskillsdeck-cache/<owner>__<name>.json`，`cacheFormat:3`；**本次 stat：`/root/.dsh-mattskillsdeck-cache/` 存在（0700）** | [repoKeys.js:251-261](../../../dsh-mattpocock-skills-deck/src/host/repoKeys.js#L251-L261)（`getCacheDir`，注释说明「`~/.dsh` 在沙箱外被拒 → 改用 `process.cwd()`」）；读 `265-279`；写 `280-291`；文件名 `262-264` | 探测/刷新时写；过期按 `cacheFormat` 与 `generatedMs` 判；无自动清理 | **沿用 Deck** | 幂等：整份覆写。**风险**：位置依赖 `process.cwd()`，同一个插件在「DSH 进程从别的目录启动」时会各自留一份缓存 —— 合并进 Resident（用 `os.homedir()`）后要不要统一，需要显式决策并写进文档，**不要静默改** |
| 本地诊断日志 | `<cwd>/.dsh-mattskillsdeck-cache/logs/YYYY-MM-DD.log` 与开关 `log-switch.json`；**本次 stat：`logs/` 下两文件（0600），`log-switch.json` 0600** | 常量 `logStore.js:6-11`（`LOG_DIR_NAME='logs'`、`LOG_SWITCH_FILE`）；防抖与分桶 `LOG_DEBOUNCE_MS 6`、`formatLogFileName 19-22`；开关持久化在 `logPhones.js`（`logStore.js:2` 注明） | 宿主按天分桶、只分桶不自动清理；开关由用户在面板里改 | **沿用 Deck**；合并后建议改名为与合并包同前缀，但**必须保留旧目录读取或明说丢弃** | 幂等：单写者、防抖 1000 ms。风险 `AGENTS.md` 的日志纪律要求「可重放的凭证原文永不落盘」；合并时必须确认 Resident 的 token 不会经 Deck 日志出口落盘（Resident 现有 `mask()` [plugin.js:69-73](../../plugin.js#L69-L73) 只在工具回执里脱敏，**没有**接入 Deck 日志） |
| 命名守护状态 | `<cwd>/.dsh-mattskillsdeck-cache/naming-guardian.json` | `namingGuardian.js:15`（`NAMING_STATE_FILE`）；`loadNamingState 19-38`、`persistNamingState 39+` | 建号成功时脏写，定时批量落盘 | **沿用 Deck** | 幂等：全文覆写。迁移风险低（丢一份可从远端重建的编号映射） |
| 批量建图续跑游标 | `<cwd>/.dsh-mattskillsdeck-cache/deck-plans/deck-plan-<wsHash>-<planId>.json` | 目录 `src/host/tools/deckMapPlanCreate.js:86`；文件名 `src/shared/deck-tools/plan-store.js:46`；装配 `deckMapPlanCreate.js:127-130`；`src/host/refresh/wiring.js:305` 注明该装配路**没注入** `planStore`（那条路退回内存） | 每次建票/建边记一笔 | **沿用 Deck** | 幂等：游标只是加速，去重权威是幂等锚（`deckMapPlanCreate.js:130-132` 注释）。迁移风险低 |
| 会话-票链读数缓存 | `<cwd>/.dsh-mattskillsdeck-cache/session-tickets.json`；**本次 stat：存在，562 B，0600** | 字段来源 `src/host/refresh/sessionChainReadout.js`；客户端读 `src/client/statusbar/SessionChainCapsule.js:5,61`；缓存目录同上 | 刷新时写 | **沿用 Deck** | 幂等：可重建。迁移时不迁也不影响功能 |
| 随包技能（bundled-skills）发现路径 | 候选根（按序）：`<cwd>/package/bundled-skills`、上级 `../`/`../../package/bundled-skills`、`<cwd>/bundled-skills`、向上 4 层的 `package/bundled-skills` 与 `node_modules/dsh-mattpocock-skills-deck/bundled-skills`、`~/.dsh/profiles/{web,desktop}/node_modules/dsh-mattpocock-skills-deck/bundled-skills`、`~/.dsh/profiles/*/node_modules/dsh-mattpocock-skills-deck/bundled-skills` | [src/host/bootstrap.js:15-50](../../../dsh-mattpocock-skills-deck/src/host/bootstrap.js#L15-L50)；同样的候选表在 `src/host/skillDoc.js:27-42`；注册优先级 `rank 350`（`bootstrap.js:7`） | 宿主加载期注册；随包消失而消失 | **需一次性迁移**：合并包要么保留目录名 `dsh-mattpocock-skills-deck/bundled-skills`，要么把全部候选根改成合并包名 | 幂等：候选表按「第一个存在的」取。**风险**：候选根里硬编码了包名 `dsh-mattpocock-skills-deck`，合并改名后这条路径立即失效，表现为「27 个随包技能全部消失」；`scripts/build.mjs:770-772` 有「27 项」断言，能挡住一部分 |
| 用户/项目技能标准根（探测） | `~/.agents/skills/<name>` > `~/.dsh/skills/<name>` > `<项目根>/.dsh/skills/<name>` > `<项目根>/.agents/skills/<name>` | `src/shared/skill-probe-channels.js:151-165`；缓存（纯内存）`src/host/skillProbeCache.js:10-15`（TTL 10 s，**不读盘不联网**） | 用户自己放；插件只读 | **默认不动**（用户既有 skills 根） | 迁移脚本**不得**往这些目录写任何东西；`skillProbeCache` 纯内存，无迁移面 |
| 更新任务状态 | `<home>/updates/<pluginId>/<sha256(profileDir)[:24]>/{state.json, install.lock, before.json, skipped.json}`；`state.json` 显式 `mode: 384`（= **0o600**） | 包内 `node_modules/dsh-plugin-update/dist/store.js:28-41`（`pathsForUpdate` / `legacyPathsForUpdate`）、`dist/config.js:8-9`（`STATE_FILE`/`LOCK_FILE`/`BACKUP_FILE`/`SKIPPED_FILE`）；接线 [src/host/updateFromPackage.js:26-34](../../../dsh-mattpocock-skills-deck/src/host/updateFromPackage.js#L26-L34)（`UPDATE_PLUGIN_ID`/`prefix 'wf'`/通道 `prerelease`） | 用户点「更新」时建；`before.json` 备份、`install.lock` 串行 | **需一次性迁移**：目录名含 `<pluginId>`，合并后 pluginId 若改，旧状态留在 `updates/dsh-mattpocock-skills-deck/` | 幂等：同请求编号重复提交返回旧结果（`docs/research/534-plugin-update-scheme.md` 第 3 节）。**本次 stat：`~/updates` 未见**（该路径由 `dsh-plugin-update` 决定，未做环境变量覆盖核对）。风险：合并后若插件自报 id 与 `UPDATE_PLUGIN_ID` 不一致，会出现「面板查更新永远说不认得这个插件」 |
| Deck 客户端 UI 偏好 | 浏览器 `localStorage`：`dsws.cfg`、`dsws.templates`、`dsws.listPrefs`、`dsws.labelClicks`、`dsws.selectionByCwd`、`dsws.bannerFold`、`dsws.setupLayoutByCwd`、`dsws.debug` | `src/client/kernel/config.js:9,27`、`store-prefs.js:13,24,155,191,242`、`log.js:14` | 浏览器写入，按访问地址隔离 | **沿用 Deck（第一阶段不改存储）**：设置入口合并**不要求** localStorage 改名或迁移；把偏好统一到 `settings.yaml` 是**后续可选工作**，且须先接通 §1.3「本机全局设置」那条链 | 幂等：`config.js:43-51` 已有一次老键迁移（`dsws.startCfg`→新键 + `removeItem`）可作范式。风险：localStorage 按访问地址隔离（`choiceStore.js:4` 已把这个现象写清），迁移时不能假设能读到旧值；因此更不该在第一阶段押注它 |

### 1.4 表 C —— 两插件都会碰、但必须显式划界的对象

| 对象 | Resident 的用法 | Deck 的用法 | 合并后的唯一归属 | 迁移风险 |
|---|---|---|---|---|
| 宿主 profile 的 Loader 行 | `cordis.patch.yml:1-4`：1 行 `github-resident-v2` → `@local/dsh-github-resident-v2` | `package/cordis.patch.yml`：2 行 `dsh-mattpocock-skills-deck` + `dsh-mattpocock-skills-deck/tools` | **合并为一份 patch**（形态见证据 01 §5） | 行 id 与顺序冲突要一次定死；证据 `01` §4.8 已列 |
| `settings.section` 槽位 | 2 条：`github-resident`(order 60)、`github-repo-registry`(order 61)，[client.js:419-432](../../client.js#L419-L432) | 1 条：`dsws-settings-section`(order 18)，[panelAssembly.js:91-93](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L91-L93) | 按用户要求合并成同一页（resident 页 1 + 登记页内分段） | 左栏条目数变化会连带改动 Resident `verify-ui.mjs` 与 Deck 侧槽位门禁；逐槽位判定见证据 02 §2.3 |
| 右侧栏 tab 类型 | 无 | `sidebarRightTabs.register({id: DECK_NATIVE_TYPE_ID = 'dsh-mattpocock-skills-deck/deck:map', kind: DECK_NATIVE_TAB_KIND = 'dsh-mattpocock-skills-deck:deck-map', priority:'builtin'})`，[router.js:30-31](../../../dsh-mattpocock-skills-deck/src/client/kernel/router.js#L30-L31)、[panelAssembly.js:104-128](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L104-L128) | **沿用 Deck 的 `id/kind` 与用户布局** | **默认保留现有 `DECK_NATIVE_TYPE_ID` / `DECK_NATIVE_TAB_KIND` 字符串**，与合并后的 **npm 包身份是否变化无关**——包名变化**不要求** tab 身份跟着改；用户已保存的右栏布局（哪一格、位置、是否展开）继续按同一身份恢复。**仅当确有 `id/kind` 冲突**（同一会话内新旧包同时注册同一 `id/kind`，宿主会拒绝重复）才规划 **alias / 显式无损迁移**：把新类型 id 作别名指向旧 id，或读旧会话状态做一次性迁移。**不能**把「用户布局丢失」当成可接受的代价（详见证据 02 §4.3） |
| **包级** `dsh.client.inject`（客户端图依赖，值是**包名**） | `['@deepseek-ai/dsh-client-ui-settings-general']`（[package.json:43-47](../../package.json#L43-L47)） | `[]`（`package/package.json:56-58`） | **取并集＝保留 Resident 那一项**（Deck 不声明） | 两个包名列表没有交集，并集无歧义；未在运行态验证的只是「宿主要求并集」的语义（证据 01 §8） |
| **纤维级** `inject`（客户端插件依赖的**服务名**） | `inject: ['slots']`（[client.js:417](../../client.js#L417)） | `['connection','slots','locale','workspaces','sessions']`（证据 02 §7.2，来自已安装产物 `lib/client.js:27914`；源码侧由构建注入） | **取并集＝5 项**（含 `slots`） | 与上一行**不是一回事**，别混成一组；证据 02 §7.2 已把两组分表 |
| 回环 HTTP 端口 | `31790`（`DSH_GH_API_PORT`） | 无 | **沿用 Resident** | Deck 客户端只走 `host.call('wf.*')`，无端口面 |
| 环境变量前缀 | `DSH_GH_DATA_DIR`/`DSH_GH_REGISTRY_DIR`/`DSH_GH_API_PORT`/`DSH_GH_NO_*`/`DSH_GH_*_TTL_MS`（`README.md:203-217`） | `DSH_GH_PATH`（[src/host/index.js:35](../../../dsh-mattpocock-skills-deck/src/host/index.js#L35)） | **沿用各前缀现状** | 前缀相邻易混，需在合并契约里写「`DSH_GH_*` 归 Resident，Deck 不得新增同前缀」 |

### 1.5 表 D —— 默认不动 / 不属于本插件的对象

| 对象 | 现状（运行态） | 为什么默认不动 |
|---|---|---|
| `git config --global user.name` / `user.email` | 均未设置 | 用户既有环境配置；Resident 只在显式传参时写（`plugin.js:956-962`、`1907-1911`） |
| `~/.dsh/.credentials.yaml`、`~/.dsh/.bridge_token`、`~/.dsh/.bridge_headers` | 存在（0600） | 这是 Harness 自身的桥接凭据，与两插件无关，**不在本评估范围内** |
| `~/.agents/skills/`、`~/.dsh/skills/` | 用户技能根 | 用户既有数据，插件只读探测 |
| `~/.config/gh/hosts.yml` | 存在（**0600**，含 2 条 `oauth_token` 行；内容不读） | gh CLI 自己写的账号凭据；常规合并/卸载不动它，只有用户明确要求销毁时才经 `gh_cli_logout` 的显式开关处理 |
| 用户其它 host 的 `~/.git-credentials` 行 | 文件本次不存在 | Resident 承诺按 host 只替换 `github.com` 一行（`220-233`、`LESSONS.md:242`） |
| `<workspace>/docs/agents/issue-tracker.md` 等 Deck 声明文件 | 属工作区内容 | 用户的仓库文件，迁移脚本只读不写 |

### 1.6 字段级「必须指定单一写者 / 默认不动」清单

**必须指定单一写者（合并后单一写者）**

1. `~/.dsh/github-resident.json` 的 `token`/`login`：合并后唯一写者是合并包的身份入口；Deck 侧不得新增 token 落点。
2. `git config --global credential.helper`：唯一写者保留 Resident 的两条既有路径（`store` 与 gh helper），但要在契约里写明「谁在什么条件下写」。
3. `~/.dsh/mattskillsdeck/settings.yaml`：**现状未接线**（见 §1.3）。第一阶段不改其归属、不接这条链；若日后统一持久化，写实现归 Deck 的 config-store 核（先接线 `configStore.js` 适配器），并避免第二份 schema 校验（标：待验证）。
4. 随包技能目录名：要么保留 `dsh-mattpocock-skills-deck/bundled-skills`，要么全量替换 `bootstrap.js:15-50` 与 `skillDoc.js:27-42` 的硬编码包名。
5. 更新状态目录的 `<pluginId>`：与 [updateFromPackage.js:26](../../../dsh-mattpocock-skills-deck/src/host/updateFromPackage.js#L26) 的 `UPDATE_PLUGIN_ID` 必须逐字一致，否则更新面板失灵。
6. 登记库清理动作（`gh_repo_registry` 的 `forget`/`prune`/`purge`）：唯一作用域是 `REGISTRY_DIR` 内；**不得**连带删除 `choices.json` 的后端选择、issue 数据或任何仓库文件（见 §2.7 红线 6 与 R8）。

**默认不动（需用户另行明确要求才可能触及）**

1. `git config --global user.name/user.email`。
2. `~/.agents/skills/`、`~/.dsh/skills/`、`<项目根>/.agents/skills/`。
3. `~/.config/gh/hosts.yml` 的 token 行（除用户显式 `gh_cli_logout`）。
4. `~/.git-credentials` 里非 `github.com` 的行。
5. 任何仓库内 `.git/`、以及非 `docs/agents/` 的仓库文件。
6. Harness 自身的 `~/.dsh/.credentials.yaml` 等桥接凭据。

### 1.7 幂等性总结

- **天然幂等（可重跑）**：`github-resident.json` 读改写、`git-credentials` 按 host 重写、登记库 `repos/*.json` 覆写、`choices.json` 临时文件+rename、更新 `state.json` 请求编号去重。
- **条件幂等（需判存在）**：`consent.json` 只在本次拿到同意时写（[plugin.js:734-739](../../plugin.js#L734-L739)）；`workspace.yaml` 新老并存以新为准、**老文件保留备查**（[workspaceCwd.js:203](../../../dsh-mattpocock-skills-deck/src/host/workspaceCwd.js#L203)）；`label-colors.yaml` 迁移成功后才删老文件（[label-colors.js:246-256](../../../dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/label-colors.js#L246-L256)）。
- **一次性、且必须留旧读路径**：随包技能目录名变更、`updates/<pluginId>` 目录名变更。
- **后续可选（第一阶段不做）**：把 localStorage 的 UI 偏好统一到 `settings.yaml`（须先接线 `configStore.js`）。
- **不属于常规路线的破坏性动作（只有用户另行明确要求时才执行）**：`gh_cli_logout` 的 `revoke`（对 GitHub 真实撤销，`plugin.js:1596-1612`）、`purge{confirm:true}`（删整棵登记库，`729`）。

---

## 2. 权限、同意与凭据

### 2.1 分层模型

本文件把「授权」拆成三层，合并方案不得把三层混用同一个词（`plugin.js` 的 `LESSONS.md:247-254` 正是因为混用「授权」才出现用户困惑）：

| 层 | 谁授予 | 载体 | 能否被插件自行改写 |
|---|---|---|---|
| **L1 Harness 授权** | 用户在 DSH 侧设置里开 | profile 的插件启用状态、插件 Config、宿主策略开关 | **不能**；插件无权替用户打开 |
| **L2 插件内同意** | 用户在会话里回答，或亲手在设置页点按钮 | `consent.json` 的 `grants[]`（Resident）；Deck 侧「用户亲手选的后端」写 `choices.json` | 只能把「本次调用带 `consent:true`」落成一条 grant；不能凭空造同意；**既有 grant 覆盖时不再重复确认** |
| **L3 系统凭据** | 用户走 gh 设备码登录，或直接给 PAT | `~/.config/gh/hosts.yml`、`~/.git-credentials`、`~/.dsh/github-resident.json`、`git config --global credential.helper` | 插件能写能删，但**销毁只在用户另行明确要求时执行** |

### 2.2 L1 Harness 授权层（(a) 需要用户在 Harness 侧开启的授权）

| 事项 | 现状（`已安装运行态` / `本地源码`） | 合并后的要求 |
|---|---|---|
| 两个插件在 profile 里各自启用 | 运行态：`/root/.dsh/profiles/web/package.json:13-14` 同时有两行依赖；Host `Config.listConfigs` 对 `dsh-mattpocock-skills-deck` 与 `@local/dsh-github-resident-v2` 各回 1 条 entry、`status: "absent"`（都无 Config schema） | 合并后 profile 里只保留一行（形态见证据 01 §5）；启用与停用由用户/宿主管理，插件不得自启自停。**新旧插件含同名能力时不得同时激活**（见 §3.1） |
| Deck 的 GitHub issue 追踪同意 | Deck 靠「人手选后端」+ 后端声明文件决定是否接管（[backendDecision.js:100-127](../../../dsh-mattpocock-skills-deck/src/host/tracker/detection/backendDecision.js#L100-L127)；`choices.json.source` 只认 `'user'`，[choiceStore.js:72](../../../dsh-mattpocock-skills-deck/src/host/choiceStore.js#L72)） | 合并后保留同一判据；不得把 `detected`/`autodetect` 结论升格为「用户已同意」 |
| Resident 建库 `consent:true` 与 UI `via` 记录 | 工具路径：`consent:true`（`plugin.js:1024, 739`）→ `via: 'tool:consent:true'`；UI 路径：`POST /registry/build?consent=1` 且必须带 `Origin`/`Referer`（`2534-2544`）→ `via: 'ui:registry-panel'`（`2550`） | 合并后两条路都保留；`via` 值域不得扩展成含义模糊的新值（审计链断点见 `LESSONS.md:267-268`）；**用户原有的权限与 `root/depth` grant 原样保留，合并不得重置、收窄或要求重新确认** |
| 宿主文件沙箱 | 当前会话 file policy = `danger-full-access`（本会话运行事实，**不是插件可依赖的长期前提**） | 合并方案的验收不能建立在「沙箱永远宽松」上；`repoKeys.js:251-252` 与 `choiceStore.js:12-14` 的注释记录了沙箱曾经把 `~/.dsh` 写入拒掉的真实事故 |

### 2.3 L2 插件内同意层（(b) 凭据形态与同意边界）

**(b1) gh OAuth 设备码登录**

- 入口：`gh_cli_auth_web`（`plugin.js:1815-1830` 一带），设备码页 `https://github.com/login/device`（`1134`）；落地走 `gh auth login --web`（`1469`）。
- 返回：`{ok, user_code, verification_uri, opened}`；`openUrl` 的 `via` 取值 `device-bridge`/`xdg-open`/`none`（`1452-1456`）。
- **凭据由 gh 自己写**到 `~/.config/gh/hosts.yml`（0600）。Resident 不落盘 token，只在拆除时读取用于撤销与掩码（[hostsToken 1573-1585](../../plugin.js#L1573-L1585)，注释明说「返回值不出日志」）。

**(b2) PAT 登录**

- 入口：`gh_resident_login`（`plugin.js:928-977`），必填 `token` + `user_login`。
- 落盘三处：`github-resident.json`（0600，`943-948`）、`~/.git-credentials`（0600，`950`）、`git config --global credential.helper=store`（`951-954`，已有非 `store` helper 时不覆盖）。
- 回执只回 `mask(token)`（`973`、`69-73`）。

**(b3) token 脱敏形态**

- `mask()`：长度 ≤ 8 回 `(len=N)`，否则回 `前4位…后4位 (len=N)`（[plugin.js:69-73](../../plugin.js#L69-L73)）。
- `gh_cli_status` 对 `hosts.yml` 只回掩码形态（`1848`、`tools` 描述）；`gh_cli_logout` 的 `tokenMasked` 同样（`1719`）。
- 登记库落盘前剥 userinfo（`179-190`）并有门禁「token 永不进入登记库」（[invariants 2016](../../plugin.js#L2016)）。

**(b4) 同意的可追溯性**

- `consent.json` 每条 grant 记 `{root, depth, grantedAt, via, tool}`（[plugin.js:395](../../plugin.js#L395)）；`consentCovers` 只在 `root` 命中且 `depth` 不被悄悄放大时成立（[383-390](../../plugin.js#L383-L390)）；缺 `depth` 的旧 grant 一律不覆盖（`381-382`）。
- **持久授权覆盖时无须再次确认**：请求的 `root` 已被某条 grant 命中、且请求 `depth` ≤ 该 grant 的 `depth`，即直接放行（`consentCovers`）；只有首次建库或扩大 `root/depth` 才重新问用户。
- `revoke` 只删授权文件、保留库（`710-718`）；`purge` 需 `confirm:true`（`720-731`）。

### 2.4 L3 系统凭据层（(c) 清理边界）

`gh_cli_logout`（[plugin.js:1623-1737](../../plugin.js#L1623-L1737)）是全仓唯一的凭据销毁入口。**它不属于常规合并/回滚/卸载路线**：常规卸载只做「停插件 + 移除依赖」，账号、OAuth/PAT、`credential.helper`、gh 缓存与用户 git 配置默认都保留；只有用户**另行明确要求销毁**时才调用本工具（不给 `confirm` 时只勘察、不动任何东西）。以下边界是现状记录，不是迁移步骤：

| 开关 | 目标 | 默认 | 备注 |
|---|---|---|---|
| `confirm` | 总闸；不给只做勘察（`1625`、`1652-1657`） | 必填才动手 | 勘察回 `found`：各文件路径/存在性/权限位、token 来源类别与掩码（`1640-1650`） |
| `revoke` | GitHub 侧撤销（`1596-1612`） | 否 | 只对 `gho_`/`ghu_` OAuth 有效；`ghp_`/`github_pat_` 只能用户去网页手删（`1587-1594`，回执带 `manual` 链接） |
| `purge_git` | 删 `~/.git-credentials` + unset 3 个 helper 键 | 否 | `1666-1676`；helper 键含 host 作用域与全局（`1631-1635`） |
| `reset_state` | 删 `~/.dsh/github-resident.json` | 否 | `1662-1665` |
| `uninstall_gh` | `gh auth logout` + `dpkg -r gh` | 否 | `1677-1690`；系统没装 gh 时如实跳过 |
| `remove_gh_config` | 删整个 `~/.config/gh` | 否 | `1698-1701`；**会连带删掉用户其它 host 的 gh 配置**，是各开关里范围最大的一项 |
| `remove_gh_cache` | 删 `~/.dsh/gh-cli` | **是**（该工具默认开） | `1691-1697`；理由：它是插件私有副本（`1733` 描述）。因为常规路线不调用本工具，缓存默认仍在 |
| 收尾核对 | `verify` + `leftover` | —— | `1703-1719`；`leftover` 空数组才算干净（`LESSONS.md:113`） |

### 2.5 合并后：谁持有、谁销毁凭据

| 问题 | 结论（建议） | 依据 |
|---|---|---|
| 合并后几个凭据入口？ | **一个**：合并包的 `gh_*` 身份工具族（`gh_resident_login` / `gh_cli_auth_web` / `gh_cli_status` / `gh_cli_logout` / `gh_cli_setup_git` / `gh_cli_resolve`）。Deck **不得**新增任何凭据读写 | Deck 现状：`package/package.json:26` 只依赖 `dsh-plugin-update`，`src/` 无 token 落盘路径（`grep` 无 `hosts.yml`/token 常量命中）。精确地说，Deck 有一处**只读诊断**：`gitCredentialExec.js:174` 读 `git config --get credential.helper`，并可在单次命令上加 `-c credential.helper=`（`38`、`83`）；该文件头部明确声明不保存凭据、不改 gitconfig、不带回显。它不构成第二个凭据写入口 |
| 谁负责销毁？ | 仍是 `gh_cli_logout`，但**不是合并/卸载/回滚的前置步骤**：常规路线默认不销毁任何凭据；只有用户另行明确要求销毁时，才带 `confirm:true` 与所需开关执行 | `LESSONS.md:102` 记的是「`remove_bundle` 不销毁凭据」这一现状；把它读成「必须先销毁」是过度推论，本次修订改正 |
| 插件包更新与 gh 二进制更新会不会变成两套凭据入口？ | **不会**。两条更新链的目标分别是插件包与 gh 二进制（详见 R4），两者都不读写凭据，与「凭据入口」无关 | `package/package.json:26`（`dsh-plugin-update`）、[plugin.js:2208](../../plugin.js#L2208)（`autoUpdate`）；原「两套凭据入口」论证已删除 |
| `gh_cli_logout` 要不要动 Deck 的数据？ | **不要**。凭据拆除不涉及 `choices.json`/`settings.yaml`/技能目录 | `choices.json` 无 token 字段（`choiceStore.js:67-82` 校验只看 `backendId/rev/pickedAt/source`） |

### 2.6 网络与文件权限面

| 面 | Resident | Deck | 合并后 |
|---|---|---|---|
| HTTP 出站 | `api.github.com`（`plugin.js:76`）、`github.com/login/device`（`1134`）、release 元数据与下载（`1140-1143`）、`127.0.0.1:3090/app/open` 拉浏览器（`1449`） | 无自有 HTTP；出站全部经 `gh`/`git`/`glab` 子进程（[repoKeys.js:70-143](../../../dsh-mattpocock-skills-deck/src/host/repoKeys.js#L70-L143)，`execProc 150-199`），并统一报给「出站闸」`gate.noteOutbound`（`33-41`） | 一个进程内两套出站记账（HTTP fetch 与 gh 子进程）会并存；**配额口径不同**（Deck 按「真实出站条数 + GraphQL 点数」记账，`repoKeys.js:37-39`），合并文档需说明哪个账管哪一段 |
| 回环监听 | 监听 `127.0.0.1:31790`（`2082-2083`） | 无 | 沿用 Resident；来源闸门现状见 `2088-2124`、`2534-2544` |
| 文件写入范围 | `~/.dsh/github-resident.json`、`~/.git-credentials`、`~/.dsh/github-resident/**`、`~/.dsh/gh-cli/**`、`~/.config/gh/**`（仅显式开关）、`git config --global` | `~/.dsh/mattskillsdeck/**`、`<cwd>/.dsh-mattskillsdeck-cache/**`、`<home>/updates/**`（经 dsh-plugin-update）、**仓库内 `docs/agents/workspace.yaml` 与 `label-colors.yaml`** | 并集。**「写仓库」这件事不发生冲突**：Resident 的「绝不写进仓库」是**登记操作**的契约（`PROTOCOL.registry.invariants` [plugin.js:2013-2018](../../plugin.js#L2013-L2018)、`guarantees.registryWritesOnlyItsOwnDir` [2026](../../plugin.js#L2026)），不是整个插件的全局承诺；Deck 按自己的既有契约写 `<workspace>/docs/agents/`。合并后**保留 Resident 既有承诺不动**，只需在 README/契约里把两段写清楚：登记不写仓库；后端配置与标签配色按 Deck 契约写 `docs/agents/` |
| 子进程 | `git`、`curl`、`dpkg`、`sh -c command -v`、`gh`（`plugin.js:29-47`、`1157-1161`、`1277`、`1685`、`1469`） | `gh`/`git`/`glab` 经平台 subprocess（`repoKeys.js:83-88`、`169-174`） | 两套进程执行器并存；合并后建议保留 Deck 的准入/分档，因为它是唯一有超时与并发控制的（`repoKeys.js:72-75`） |
| 敏感文件读 | `hosts.yml`（只取 token 用于撤销/掩码，`1573-1585`）、`.git-credentials`（只取行数与是否含 github.com，`896-899`） | `git config --get credential.helper`（只读诊断，[gitCredentialExec.js:174](../../../dsh-mattpocock-skills-deck/src/host/gitCredentialExec.js#L174)） | 保持；任何新增日志必须沿用「可重放凭证原文不落盘」红线（Deck `AGENTS.md` 日志纪律第 3 条） |

### 2.7 红线与合并后仍需逐次确认的动作

**红线（不得绕过原生权限/同意）**

1. **不得**用插件代码自行开启 Harness 侧授权，也不得把 `DSH_GH_NO_STATE_CHECK` 之类开关当成「用户同意」。
2. **不得**在未拿到 `consent:true`（工具路径）或带来源头的 UI 请求（`/registry/build?consent=1`）时写入登记库任何字节（[plugin.js:734](../../plugin.js#L734)、[invariants 2014](../../plugin.js#L2014)）。
3. **不得**把「用户亲手选的」降级成猜测：`choices.json` 只接受 `source:'user'`（`choiceStore.js:72, 280-288`），`backendDecision` 的 `detected/autodetect` 只作候选。
4. **不得**在删除凭据时静默扩大范围：`remove_gh_config`、`uninstall_gh`、`purge` 都必须显式开关 + `confirm:true`。
5. **不得**把同 uid 的裸 shell 能伪造 `Origin` 这件事说成「绝对安全」（`README.md:265`、`LESSONS.md:231`）。
6. **不得**把登记库清理（`forget`/`prune`/`purge`）的作用域扩到 `REGISTRY_DIR` 之外：不许删用户的后端选择（`choices.json`）、issue 数据或仓库文件。

**合并后仍需逐次确认的动作**

| 动作 | 确认形式 | 依据 |
|---|---|---|
| 首次建立或扩大 `root/depth` 的仓库登记库 | 工具回 `ask` 后由用户答复，再带 `consent:true`；UI 走带来源头的按钮。**已被既有 grant 覆盖的 `root`（且请求 depth ≤ grant.depth）无须再次确认** | [plugin.js:383-390](../../plugin.js#L383-L390)、`417-430`、[734](../../plugin.js#L734) |
| 清空登记库 | `purge` + `confirm:true` | `720-731` |
| 写入 `~/.git-credentials` / 改全局 `credential.helper` | 只在用户显式调用 `gh_resident_login` 时；`purge_git` 才清。**常规合并/卸载不做这一步** | `950-954`、`1666-1676` |
| GitHub 侧撤销 token | 用户另行明确要求销毁时 `revoke:true`（且只对 OAuth 有效） | `1661`、`1587-1594` |
| 删除系统 `gh` 包 | 用户另行明确要求时 `uninstall_gh:true` | `1677-1690` |
| 删整个 `~/.config/gh` | 用户另行明确要求时 `remove_gh_config:true` | `1698-1701` |
| 切换某工作区的后端 | 用户在面板亲手选（写入 `choices.json` 与 `docs/agents/workspace.yaml`） | `choiceStore.js:280-288`、证据 01 §3.5 |
| 写 `/registry/build` 等回环写路由 | 必须带浏览器来源头 | `2534-2544`、`2104` |

---

## 3. 原插件并存风险（Resident 与 Deck 各装一份时）

前提：当前**已经**是并存状态（`/root/.dsh/profiles/web/package.json:13-14`），因此以下每条都已具备现场，只是本次不允许做写入型验证。

### R1 同 slot 双注册与 order 竞争

- **场景**：`settings.section` 上有 3 条注册：Deck `dsws-settings-section`(18)、Resident `github-resident`(60)、Resident `github-repo-registry`(61)。（`本地源码`：[panelAssembly.js:91-93](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L91-L93)、[client.js:419-432](../../client.js#L419-L432)）
- **判定证据**：源码行如上；**槽位拓扑已由证据 02 §2.1 通过 Client 查询取得**（本次调研期的 `listSubTree` 超时只说明那次查询未返回，不能据此说「没有已连接页面」）；页面上三项的实际渲染与可见性仍待实机截图确认。
- **后果**：左栏出现三项，其中「MattSkills」（真实 label，locale `locale-panel.js:16`（zh）/`:171`（en）；仅产品显示名，不动工具名与包名）与「仓库登记库」在语义上高度接近，用户会以为是同一件事的两个入口；order 差异让两项不相邻，更难理解。
- **缓解**：合并为一条左栏入口，页内分段（证据 01 §6 的建议）；改造后把 `verify-ui.mjs` 的期望条目数同步改掉，否则门禁红。

### R2 两套设置页信息重复

- **场景**：Deck 同时注册 `settings.plugins.tab`（id `dsws-settings`，[panelAssembly.js:86-88](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L86-L88)）与 `settings.section`（[panelAssembly.js:91-93](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L91-L93)），两处复用同一个 `SettingsPage`；Resident 另有「GitHub」页与「仓库登记库」页。
- **判定证据**：源码行如上；证据 01 §3.4、02 §3.4。
- **后果**：用户在「设置 → 插件」与左栏各看到一次 Deck 配置；再叠上 Resident 的两页，同一屏出现四份「插件设置」观感。
- **缓解**：`settings.plugins.tab` 保留为宿主标准落点（证据 01 §6 建议），但内容改为跳转/嵌入同一组件；`settings.section` 的那条退役。

### R3 两处 gh 访问与配额

- **场景**：Resident 用 `fetch` 直打 `api.github.com`（`plugin.js:76`）；Deck 全部经 `gh` 子进程（`repoKeys.js:70-143`），并且**每一笔真实出站都要报给 Deck 自己的闸**（`repoKeys.js:33-41`，不变量 I1）。
- **判定证据**：源码行如上。
- **后果**：两台账本并存 —— Resident 的调用不计入 Deck 的额度/退避，Deck 的 `gh` 调用也不出现在 Resident 的回环 `/state` 里。用户看到「GitHub 限流了」时无法从任一账本定位。
- **缓解**：合并后明确「HTTP 直连段归 Resident 账、gh 子进程段归 Deck 账」，或把两个账本合到一个出口；**不要**只删其中一个记账点（Deck 门禁会因此判红，`repoKeys.js:25-27` 注释明说不许静默）。

### R4 两个 update 机制

- **场景**：Deck 经 `dsh-plugin-update@^0.13.0`（`package/package.json:26`）做**插件包**自更新，状态落 `<home>/updates/<pluginId>/<hash>/{state.json,...}`（`dist/store.js:28-41`）；Resident 经 `gh_cli_version`/`autoUpdate` 做**gh 二进制**自更新，落 `~/.dsh/gh-cli`（`plugin.js:2208`、`1136-1138`），并有独立 GC（`2253`）。
- **判定证据**：源码行如上；`~/.dsh/gh-cli/{bin/gh,install.json,gc.json}` **本次 stat 存在**；`~/updates` **本次未见**。
- **后果**：用户点「更新」时不清楚更新的是插件还是 gh；两条链的失败面、回滚面、状态目录都不同；Deck 的更新把「已装包的 manifest version 同步」作为补丁（[updateFromPackage.js:7-10](../../../dsh-mattpocock-skills-deck/src/host/updateFromPackage.js#L7-L10)、`__syncInstalledManifest 83-104`），而 Resident 的 gh 更新换的是二进制（`README.md:39-43`）。**两者都不是凭据入口**。
- **缓解**：合并后统一命名（「插件更新」vs「gh 更新」），并把 `UPDATE_RELEASE_CHANNEL='prerelease'`（[updateFromPackage.js:31](../../../dsh-mattpocock-skills-deck/src/host/updateFromPackage.js#L31)）这条「稳定版用户也可能收到预发布推送」的已知代价写进 release note。

### R5 `dsh-log` 常驻与 LESSONS 记录

- **场景**：Deck 有自建日志体系：宿主落 `<cwd>/.dsh-mattskillsdeck-cache/logs/`（`logStore.js:6-11`），开关 `log-switch.json`；`dsh-log` 已不作为 npm 依赖（`package/package.json` 的 deps 只有 `dsh-plugin-update` 与 `yaml`），而是以**派生复制**形式内联在 `src/host/logPkg/`（`src/host/logPkg/config.js:1-4` 注明「由 packages/dsh-log/dist/config.js 原样复制」）。Resident 侧没有日志体系，只有工具回执与 `LESSONS.md` 的 28 条踩坑记录。
- **判定证据**：源码行如上；`/root/.dsh-mattskillsdeck-cache/logs/2026-10-11.log` **本次 stat 存在**（13 MB，0600）。
- **后果**：合并后 Resident 的凭据/登记库动作若不走 Deck 日志出口，出问题时 Deck 的「只看日志定位」纪律落空；反过来，若为了统一而把 Resident 的 token 相关过程塞进日志出口，会撞上「可重放凭证原文永不落盘」红线。
- **缓解**：合并时把 Resident 的关键边界（落地 gh、读写 `hosts.yml`、登记库写入）接进同一个日志出口，**只记事件名 + 掩码/散列，不记原文**；同时保留 `LESSONS.md`，不要把它并进 CHANGELOG。

### R6 client 注入：两组 `inject` 必须分开看

- **场景**：两个客户端脚本各写一次 `window.__ModuleLoader__.load({id, factory})`（Resident 手写 [client.js:9-11](../../client.js#L9-L11)，Deck 构建生成，证据 01 §4.7）。合并后只保留一个 `load`，此时有两组**不同层级**的注入声明需要分别取并集：
  1. **包级 `dsh.client.inject`**（值是包名，宿主据此建客户端图行、排依赖）：Resident `['@deepseek-ai/dsh-client-ui-settings-general']`（[package.json:43-47](../../package.json#L43-L47)）；Deck `[]`（`package/package.json:56-58`）。**并集＝保留 Resident 那一项**。
  2. **纤维级 `inject`**（值是客户端服务名，客户端插件依赖的服务）：Resident `inject: ['slots']`（[client.js:417](../../client.js#L417)）；Deck `['connection','slots','locale','workspaces','sessions']`（证据 02 §7.2，来自已安装产物 `lib/client.js:27914`）。**并集＝5 项（含 `slots`）**。
- **判定证据**：源码行如上；两组的分表依据见证据 02 §7.2。原 R6 把两组混成一组并列出 6 项，已改正。
- **后果**：两个模块壳并存本身可行（id 不同），但合并成一行 patch 时两组字段都要一次写对；宿主要求「包级 inject 并集」的语义未在运行态验证（证据 01 §8）。
- **缓解**：合并后只保留一个客户端脚本：包级 `dsh.client.inject` 保留 `@deepseek-ai/dsh-client-ui-settings-general`；纤维级 `inject` 写 5 项并集；并在验收里用 `client/Slots.listSubTree` + 页面实机确认。

### R7 技能发现路径竞争

- **场景**：Deck 注册的 bundled 技能 `rank 350`，注释说明「家目录 400/500 旧副本被盖住，删项残留需手动清」（`bootstrap.js:7`）；候选根含 `~/.dsh/profiles/*/node_modules/dsh-mattpocock-skills-deck/bundled-skills`（`bootstrap.js:36-41`）。
- **判定证据**：源码行如上；`package/bundled-skills/` 含 27 个技能目录（`find` 结果）。
- **后果**：若合并后包名变了而候选表没同步，27 个随包技能全部判「未安装」；若旧包目录残留，用户会看到旧版技能（注释已提示「删项残留需手动清」）。
- **缓解**：合并时**同一提交**内改 `bootstrap.js:15-50`、`skillDoc.js:27-42` 与 `scripts/build.mjs` 的 27 项断言；卸载时清理旧包目录（`LESSONS.md:56-66` 的悬空软链坑同理）。

### R8 注册表/缓存双写与「仓库身份」关联原则

- **场景**：Deck 的工作区键映射与缓存按 `process.cwd()` 分桶（[repoKeys.js:251-261](../../../dsh-mattpocock-skills-deck/src/host/repoKeys.js#L251-L261)），Resident 的仓库登记库按绝对路径 + `sha1` 分桶（[plugin.js:173-176](../../plugin.js#L173-L176)），两者的「仓库身份」算法**不同**。
- **判定证据**：源码行如上；本次 stat `/root/.dsh-mattskillsdeck-cache/` 存在，而 `~/.dsh/github-resident/` 在默认路径未见（位置可被 `DSH_GH_REGISTRY_DIR` 改写）。
- **后果**：同一批仓库在两边各有各的「当前状态」，用户在登记库里看到的 dirty/HEAD（上次 rescan 快照，`README.md:263`）与 Deck 面板里的实时值可能不一致。
- **可实施的身份关联原则（合并方案必须遵守）**：
  1. **保留两把键**：Resident 的 `slug = <basename>-<sha1(绝对路径)[:12]>`（`plugin.js:173-176`）与 Deck 的原 workspace 键（`choices.json` 的 `sha256(key)[:24]`，`choiceStore.js:20-31`）都不要再造第三种；合并后不改任一算法。
  2. **不做自动合并**：以下情形一律**不**自动关联/合并两边记录——同一 remote 但位于不同目录；同一仓库的 `git worktree`；同一仓库不同 host（如 github.com 与自建 GitLab）；非 Git 的 Markdown 工作区（Deck 支持、Resident 登记库只收录 Git 仓库）。
  3. **登记清理只清登记库**：`forget`/`prune`/`purge` 只动 `REGISTRY_DIR`；不得删 `choices.json` 的后端选择、issue 数据或任何仓库文件（也见 §2.7 红线 6）。
  4. **展示层说明差异**：在文档里写明「登记库＝上次 rescan 快照，面板＝实时」；或者让 Resident 的登记条目多一个「打开对应面板」的跳转，而不是把两套判据合成一套。

### 3.1 并存退役顺序：互斥激活、隔离预演与失败恢复

综合 `LESSONS.md:100-113`、`272-277` 与本次源码结论，退役/切换按下列顺序（**这是未来的操作方案，本次未执行**）：

1. **常规路线不销毁凭据**：`remove_bundle` 只做「停插件 + pnpm remove」，账号、OAuth/PAT、`credential.helper`、gh 缓存与用户 git 配置默认保留（`LESSONS.md:100-113` 记录的就是这个现状）。凭据销毁是**独立动作**，只有用户另行明确要求时才执行 `gh_cli_logout{confirm:true, 需要的开关}`。
2. **互斥激活**：原插件与包含同名能力（`gh_*`/`deck_*` 工具、`settings.*` 槽位、client 模块 id、右栏 tab 类型）的新插件**不得同时激活**。切换要在一个隔离 profile 里先验证，再对目标 profile 做「停旧 → 装新」的一次性切换；不要设计「新旧同时激活」的中间态（同名工具双注册、槽位重复的失败面都没有运行态结论）。
3. **切换与失败恢复**：切换前记录 profile 行与版本（`--dump-config` 快照）；失败时按快照复位——停新、复旧，数据与凭据都不需要回滚（因为常规路线根本没有动它们）。客户端残留按 `ctx.effect` 清理（Deck 槽位 [panelAssembly.js:68-74](../../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L68-L74)，Resident loopback dispose `plugin.js:2636-2643`）。
4. **最后清磁盘残留（可选、默认保留）**：旧包目录、悬空软链（`LESSONS.md:56-66`）、`~/.dsh/mattskillsdeck/`、`<cwd>/.dsh-mattskillsdeck-cache/`。这些都是显式清理动作；`~/.dsh/github-resident/` 若存在，清不清由用户决定，且只经 `gh_repo_registry{action:"purge",confirm:true}` 或用户手工操作。

### 3.2 破坏性动作清单（不在迁移路线内）

| 动作 | 为什么不可回滚 | 何时才做 / 前置保护 |
|---|---|---|
| `revoke:true` 在 GitHub 侧撤销 OAuth | 撤销后旧 token 立即失效，本地无法恢复 | 只在用户**另行明确要求**停用时；未来验证只用隔离 profile + 测试凭据，**不销毁真实用户 token**；`dry_run` 先看 `found` |
| `purge{confirm:true}` 删登记库 | 目录被 `fs.rm -r`（[plugin.js:729](../../plugin.js#L729)），无备份 | 不在迁移路线；未来验证用临时测试仓库建库再清；对真实用户库先 `action:"plan"`/`"verify"` 留证据 |
| `uninstall_gh{uninstall_gh:true}` 跑 `dpkg -r gh` | 删的是系统包，回滚要重装 | 默认关；系统没装时如实跳过；只在用户另行明确要求时 |
| `remove_gh_config:true` 删整个 `~/.config/gh` | 会连带删掉用户其它 host 的 gh 配置 | 默认关；用户另行明确要求时；合并后可考虑改成「只删指定 host 条目」 |
| 包名/目录改名后旧 bundled-skills 被清 | 旧路径消失，`rank 350` 注册表引用会失效 | 改名与候选表改动放同一提交，并先跑 27 项断言 |
| 一次 `rescan` 覆盖 `consent.json` 的 `via` | 审计链丢失（历史真发生过，`LESSONS.md:267-268`） | 门禁「rescan 后 via 不变」必须常绿 |

---

## 4. 分阶段实施任务与依赖、工作量、验收与回滚

**说明**：本节全部内容都是**未来方案**，本次**未执行任何一项**。写入范围以合并后的目标仓库 `dsh-github-resident/` 为根（相对路径）。

### 4.1 DAG（依赖关系）

```
P0-1 ─┐
P0-2 ─┼─► P1-1 ─► P1-2 ─┬─► P2-1 ─┐
P0-3 ─┘                 ├─► P2-2 ─┼─► P3-1 ─► P3-2 ─┬─► P4-1 ─► P4-2 ─┐
                        └─► P2-3 ─┘                 ├─► P5-1 ─┬─► P5-2 ─┴─► P6-0 ─► P6-1 ─┐
                                                     │         └─► P6-2 ─────────────────┼─► P7-1
                                                     └─► P5-3（可选日志线，虚线，不阻塞 P6-0）
并行组：{P0-1, P0-2, P0-3}；{P2-1, P2-2, P2-3}；{P4-*, P5-*}（P4 与 P5 互不依赖）
顺序约束：装配/UI/必要检查（P3–P5）→ 隔离预演 + 全量回归 + 回滚演练（P6-0）→ 正式停旧启新（P6-1）→ 轻量只读冒烟 + 文档（P7-1）。
P6-2 的不可回滚动作门禁只在隔离测试阶段 + 测试凭据里验证，不是生产迁移步骤，可先于 P6-1 完成；P5-3 为可选日志线（虚线），不在 P6-0 的依赖内。
切换约束：P6-0（隔离 profile 预演）之前的任何阶段都不做真实 profile 的新旧并行；P6-1 是一次性停机切换。全量回归必须在 P6-1 之前（已并入 P6-0），P7-1 只做切换后只读冒烟。
```

### 4.2 任务表

**工作量估法（主观区间）**：下表只给**主观区间估算**（人日，1 人日 = 6 小时有效工时），依据是同类改动的类比、源文件与门禁数量级，以及装配复杂度；它**不是**历史实测工时，也不构成承诺。区间宽度表示不确定性：越靠后、越依赖运行态验证的任务，区间越宽。Deck 侧门禁**沿用其既有检查链**（`npm test` 与 `npm run verify`），实际清单与条数以脚本自身为准；本文不另行统计 Deck 测试条数，也不再引用具体历史人日当依据。

#### Phase 0 —— 基线与冻结（三件可并行，纯只读）

| 编号 | 任务 | 依赖 | 写入范围 | 工作量（主观区间，人日） | 验收标准（可执行/可观察） | 完成判据 | 回滚动作 / 回滚验证 | 失败如何停在安全态 |
|---|---|---|---|---|---|---|---|---|
| P0-1 | 快照两仓基线：HEAD、`git status`、两套门禁的当前通过面（Resident 7 项 + Deck `tests/` 门禁清单） | —— | 无（只产出报告到 `docs/merge-deck-evidence/`） | 0.5–1 | 报告里两仓 HEAD 与门禁清单可逐条比对；`git status --porcelain` 为空 | 报告归档且可复现命令齐全 | 不需回滚（只读） | 若某仓不干净，记为阻塞项并在报告中标注，不自行 stash/clean |
| P0-2 | 清点运行态落盘：`~/.dsh/**`、`<cwd>/.dsh-mattskillsdeck-cache/**`、`~/updates/**` 的存在性与权限位（**只 stat，不读内容**） | —— | 无 | 0.5–1 | 清点表与 §1 各行的「运行态」列一致（本次已得：`choices.json` 0600、`gh-cli/install.json` 0600、`bin/gh` 0755、`hosts.yml` 0600；`github-resident/` 与 `~/updates` 在默认路径未见） | 差异项被逐条解释或标为未验证 | 不需回滚 | 遇到需读内容的路径一律跳过并标注；对「未见」项补环境变量核对（如 `DSH_GH_REGISTRY_DIR`） |
| P0-3 | 冻结两份对外契约：Resident `PROTOCOL_SPEC`（`plugin.js:802-803`，当前 v6）与 Deck 的 `deck_*` 工具 schema + 客户端 RPC 端点 | —— | 无 | 0.5–1 | 契约快照可 diff；后续任何契约改动必须显式 bump | 快照入库且下次改动前不可变 | 不需回滚 | 若发现两契约已不兼容，记限制再进 P1 |

#### Phase 1 —— 归属决策与契约冻结

| 编号 | 任务 | 依赖 | 写入范围 | 工作量（主观区间，人日） | 验收标准 | 完成判据 | 回滚 / 回滚验证 | 失败停在安全态 |
|---|---|---|---|---|---|---|---|---|
| P1-1 | 拍板合并形态（证据 01 §5 的 A/B/C）与包名、Loader 行 id、包级 `dsh.client.inject`、纤维级 `inject` | P0-1 | `docs/`（决策记录） | 0.5–1 | 决策记录写明四处身份（`package.json` name / patch id / client 模块 id / 两组 inject）逐字一致 | 人签字确认 | 决策记录可推翻重写 | 四处身份未一次定死则 P3 不启动 |
| P1-2 | 产出「数据归属表」终稿（本文件 §1 逐行确认，尤其是 §1.6 的单一写者/默认不动清单） | P1-1 | 本文件 | 0.5–1 | §1.6 每条都有明确 owner；默认不动项有门禁或书面约束 | 表格评审通过 | 表格可改回 | 任何一行归属不明就停在该行，不做迁移 |

#### Phase 2 —— 数据与身份迁移（三件可并行，各自独立文件）

| 编号 | 任务 | 依赖 | 写入范围 | 工作量（主观区间，人日） | 验收标准 | 完成判据 | 回滚 / 回滚验证 | 失败停在安全态 |
|---|---|---|---|---|---|---|---|---|
| P2-1 | 身份与凭据归口：确认 token 只落 `~/.dsh/github-resident.json` + `~/.git-credentials` + `hosts.yml` 三处，不新增落点；**不销毁任何既有凭据** | P1-2 | `plugin.js`（身份段） | 0.5–1.5 | 用 `gh_cli_logout{dry_run:true}` 的 `found` 逐项核对（隔离 profile + 测试凭据），`pendingRemovals` 与文档一致 | `verify-logout.mjs` 通过 | 还原 `plugin.js` 改动 | 若发现第四个 token 落点，记为阻塞项并停该任务，等待归属决策 |
| P2-2 | 登记库归属确认：`consent.json`/`repos/*.json`/`index.json` 保持原位与权限位（0600/0700），补「index 可再生」的不变量说明；写明位置可被 `DSH_GH_REGISTRY_DIR` 改写 | P1-2 | `plugin.js`（登记库段）、`README.md` | 0.5–1 | `verify-registry.mjs` 全绿；未授权 build 时磁盘零字节 | 门禁通过 | 还原改动 | 若权限位被改动，回退并停 |
| P2-3 | Deck 侧数据归属确认：`choices.json`、`settings.yaml`、`<cwd>/.dsh-mattskillsdeck-cache/**`、`updates/<pluginId>/**` 保持原位；**明确不改用 `getCacheDir()`**，第一阶段不动 localStorage | P1-2 | Deck 侧源码（若需同步文档则改 `README`） | 0.5–1.5 | `grep` 确认四个 core 包仍为纯函数；`choices.json` 读写门禁通过（Deck `tests/verify-683-*.js` 一类） | Deck 相关门禁通过 | 还原改动 | 若 `getCacheDir` 被引入 `choiceStore`，立刻回退（`choiceStore.js:7-8` 是硬约束） |

#### Phase 3 —— 宿主半合体

| 编号 | 任务 | 依赖 | 写入范围 | 工作量（主观区间，人日） | 验收标准 | 完成判据 | 回滚 / 回滚验证 | 失败停在安全态 |
|---|---|---|---|---|---|---|---|---|
| P3-1 | 合并 patch 与包清单：一份 `cordis.patch.yml`、一份 `package.json`（含 Deck 的构建链与 `dsh-plugin-update`/`yaml` 依赖） | P1-1, P2-* | `package.json`、`cordis.patch.yml` | 1.5–2.5 | `dsh --profile <name> --dump-config` 输出里四处身份一致；`node --check` 全部 JS 通过 | 配置可 dump 且无未知行 | 还原两个清单；用 dump-config 比对 | 若 dump-config 出现重复 id 或缺失行，不安装 |
| P3-2 | 宿主入口合体：Resident 的 `plugin.js` 与 Deck 的 `src/host/**` 在同一插件里装配；**保留全部工具**：Resident 17 个 + Deck 10 个（9 个 `deck_*` 工具 + `deck_probe`），名字零交集 | P3-1 | `plugin.js`、`src/host/**` | 2–3.5 | 只读查询 `host/Tool.listTools` 断言 `gh_*`=17、`deck_*`=10（含 `deck_probe`），交集为空；用户原有的工具权限与 `root/depth` grant 原样保留；`host/Config.listConfigs` entry 数符合 P1-1 | 两套工具均已注册（清单口径）；**调用成功与注册所有权唯一性留给 P6-0 预演验证**（清单可见≠可调用） | 还原为合并前的 profile 行（Resident 1 行 + Deck 2 行；两包工具名零交集，可按原状并存） | 若同名工具出现两次，停止并回到 P1-1 重定形态（证据 01 §8 未决问题） |

#### Phase 4 —— 客户端合页

| 编号 | 任务 | 依赖 | 写入范围 | 工作量（主观区间，人日） | 验收标准 | 完成判据 | 回滚 / 回滚验证 | 失败停在安全态 |
|---|---|---|---|---|---|---|---|---|
| P4-1 | 客户端脚本合一：一个 `__ModuleLoader__.load`，槽位注册表 = Resident 2 条 + Deck 保留项（`conversation.input.dock`、`tool.view.cordis`、`sidebar.right.pane.tab(.title)`、`settings.plugins.tab`、`sidebarRightTabs` 类型登记） | P3-2 | `client.js`、`src/client/**` | 2–3.5 | 只读查询 `client/Slots.listSubTree(root='settings.section')` 条目符合 P1-1 决策；`sidebar.right.pane.tab` 仍含 Deck tab；包级 `dsh.client.inject` 保留 `…settings-general`，纤维级 `inject` 写 5 项并集 | 槽位清单与决策一致 | 还原 `client.js` 与 `src/client` | 若客户端无法同时保留两组注入，回到 P1-1 重定 |
| P4-2 | 把 Deck 设置页并入 Resident「仓库登记库」页（页内分段）；文案纪律沿用「只说建库许可，不说未授权/已授权」；**不改 localStorage 键、不迁存储** | P4-1 | `client.js`、`src/client/**`、`locale/**` | 1–2 | 页面实机确认（人眼）左栏条目数、明暗主题、文案不出现「未授权/已授权」混用；`verify-ui.mjs` 的 D 段 4 条仍过；合并后 UI 偏好仍从原 localStorage 键读取 | 人眼确认 + 门禁通过 | 还原页面组件 | 若文案纪律无法同时满足两套功能，拆成两段并各写一句免责说明，不得含糊 |

#### Phase 5 —— 权限/同意/凭据收口（与 P4 可并行）

| 编号 | 任务 | 依赖 | 写入范围 | 工作量（主观区间，人日） | 验收标准 | 完成判据 | 回滚 / 回滚验证 | 失败停在安全态 |
|---|---|---|---|---|---|---|---|---|
| P5-1 | 单一凭据入口：合并后 `gh_*` 身份族是唯一凭据写者；Deck 侧保留只读诊断，新增门禁断言「不出现 token/凭据写入」 | P3-2 | `plugin.js`、`tests/`（Deck） | 0.5–1.5 | 门禁断言 `grep` 无 token/凭据写路径（Deck 侧）；`gitCredentialExec` 的「不保存凭据」边界仍有测试 | 门禁绿 | 移除门禁 | 若 Deck 已有隐性凭据写路径，记为阻塞项并停该任务 |
| P5-2 | 回环端点登记完整：合并后所有新增路由都进 `PROTOCOL.http.endpoints`；`/registry/build?consent=1` 的来源闸门保持 | P3-2 | `plugin.js` | 0.5–1 | `curl -s http://127.0.0.1:<port>/protocol` 的 `http.endpoints` ⊇ 客户端实际调用的每条路径 | 契约自查通过 | 还原端点表 | 若有路由不在表里，`gh_protocol` 会漏报，必须补齐才继续 |
| P5-3 | 日志出口接入（**可选，虚线；不阻塞 P6-0 与最小合并**）：只记事件名 + 掩码/散列：落地 gh、读写 `hosts.yml`、登记库写入三类边界 | P3-2 | `plugin.js`、`src/host/**` | 1–2 | 用当天导出包只看日志能定位「谁在什么时候写了登记库」；日志中不出现 token 原文（人工抽查 + 断言） | 日志演练通过 | 还原日志接线 | 若无法在「不落原文」前提下记清，宁可不记该边界 |

#### Phase 6 —— 并存退役

| 编号 | 任务 | 依赖 | 写入范围 | 工作量（主观区间，人日） | 验收标准 | 完成判据 | 回滚 / 回滚验证 | 失败停在安全态 |
|---|---|---|---|---|---|---|---|---|
| P6-0 | **隔离环境预演 + 全量回归 + 回滚演练**：在隔离环境 + 临时测试仓库上安装合并包，验证「旧停/新装」互斥、工具与槽位无重复、失败可复旧；**并在生产切换前跑完两套全量门禁回归**；产出切换与恢复步骤单 | P4-2, P5-1, P5-2 | 隔离环境（不碰目标 profile）；只读脚本 | 2–3 | 隔离环境内两套门禁全绿；同一环境内不出现新旧同名工具/同名槽位；恢复步骤能在测试环境复位 | 预演报告 + 全量回归结果 + 步骤单 | 删除隔离环境即可 | 预演出现双注册或门禁红即停，回到 P1-1 |
| P6-1 | 对目标 profile 做**一次性停机切换**：停旧 → 装新（互斥，不并存）；数据与凭据原位保留，不做任何迁移或销毁 | P6-0 | profile 配置（由宿主操作，不由插件写） | 0.5–1.5 | `dsh --profile <目标 profile 占位名> --dump-config`（切换前后各一次）只剩合并后的行；`host/Tool.listTools` 名字与数量符合 P1-1；切换期间新旧不同时激活 | dump-config 与运行态一致 | 按 P6-0 的步骤单复位（停新、复旧）；凭据与数据无需回滚 | 失败即复旧完整可用；**不得**停在「旧 host 入口 + 新 tools 行」或「新旧同时激活」 |
| P6-2 | **不可回滚动作门禁校验（仅在隔离测试阶段 + 测试凭据中；不是生产迁移步骤）**：`revoke` / `purge` / `uninstall_gh` / `remove_gh_config` 四类一律 `confirm` + 独立开关；在隔离环境 dry-run 校验，**生产切换不执行任何真实注销/清理** | P5-1 | `plugin.js` | 0.5–1 | 每个动作在 `confirm` 缺失时只回勘察，且回执里有 `dryRun:true`；测试夹具不含真实凭据文件 | 逐条在隔离环境 + 测试凭据/临时仓库 dry-run 通过 | 还原 | 任一动作缺确认闸门即回退 |

#### Phase 7 —— 复核与发布

| 编号 | 任务 | 依赖 | 写入范围 | 工作量（主观区间，人日） | 验收标准 | 完成判据 | 回滚 / 回滚验证 | 失败停在安全态 |
|---|---|---|---|---|---|---|---|---|
| P7-1 | 切换后**只读冒烟 + 文档同步**（不做生产全量回归；全量回归已在 P6-0 完成）：`PROTOCOL.registry` 不变量表述归位为「登记操作契约」、`DSH_GH_*` 前缀边界、两套更新的命名、身份关联原则 | P6-1, P6-2 | `README.md`、`LESSONS.md`、`docs/` | 1–1.5 | §4.4 第 1 项只读断言冒烟通过；README 里「登记不写仓库」与「后端配置写 `docs/agents/`」两段分述且与实际一致；既有承诺未被降低 | 只读冒烟通过 + 文档评审 | 冒烟失败按 P6-0 步骤单复位（停新、复旧） | 冒烟任一红即复位；文档不一致先改文档再谈发布 |

### 4.3 可并行与串行边界

- **可并行**：`{P0-1, P0-2, P0-3}`；`{P2-1, P2-2, P2-3}`；`{P4-*, P5-*}`（客户端合页与权限收口互不依赖，但都依赖 P3-2）。
- **必须串行**：`P1-1 → P1-2`（先定形态才能定归属）、`P3-1 → P3-2`（先合清单再合入口）、`P6-0 → P6-1`（先在隔离环境预演、跑完全量回归，再切目标 profile）、`P6-1` 必须在 `P4-2` 与 `P5-*` 之后（否则退役后没有替代入口）。**全量回归（P6-0 内）必须先于生产切换（P6-1）；P7-1 只做切换后只读冒烟，不重跑全量门禁。**
- **安全停机点**：每个 Phase 结束都能停在「旧形态仍可用」或「新形态已可用」之一；**不允许**停在半合状态，**也不允许**停在「新旧同时激活」——含同名能力的两个版本互斥（见 §3.1 与 P6-1 的失败约束）。

### 4.4 未来验收方案（本次不执行，集中登记）

**前置纪律**：下列验证只在**隔离 profile + 临时测试仓库 + 测试凭据**上进行；不对真实用户仓库做删除性动作，不销毁真实 token，不改目标 profile 的既有授权，不迁用户数据。
**隔离环境要求**（只写要求）：用单独的测试容器/环境或明确注入的临时存储、测试 gh 配置/凭据、独立回环端口与独立登记目录；不得落到真实用户全局 Git/gh 配置、家目录文件或现有 `31790` 服务；即使只 dry-run 也不以真实凭据文件作测试夹具。示例的 profile 一律写占位名。
**回归位置**：第 6 项两套全量门禁属**生产切换前的隔离阶段（P6-0）**；切换后只做第 1 项只读冒烟。

1. **只读运行态断言**（隔离 profile 中安装合并包后）：`host/Tool.listTools` 的 `gh_*`=17、`deck_*`=10（9 个 + `deck_probe`）且交集为空；`host/Config.listConfigs(name=<合并包>)` 的 entry 数与 `status`；`client/Slots.listSubTree('settings.section')` 与 `('sidebar.right.pane.tab')` 的条目。**强度上限**：清单可见只证明「名字出现在清单里」，**不证明调用成功，也不证明注册所有权唯一**；不能从 `deckToolsRow.js` 注册循环里的 `try/catch` 推出「先到者胜出」，注册所有权仍须按 §5.2 分别单路启用来验证。
2. **凭据面**：用测试凭据在隔离 profile 里核对 `gh_cli_logout{dry_run:true}` 的 `found`/`pendingRemovals` 与 §1 表 A 逐项对齐；`leftover` 为空数组。**不跑**真实 `revoke`。
3. **登记库面**：用临时测试仓库做未授权 `build`（磁盘零字节，`verify-registry.mjs` 三条断言）；`rescan` 后 `consent.json` 的 `via` 不变；用后 `purge` 测试库。
4. **数据面**：`choices.json` 与 `settings.yaml` 在合并后仍可读；`<cwd>/.dsh-mattskillsdeck-cache/logs` 仍按天分桶；合并后 UI 偏好仍从原 localStorage 键读写（第一阶段**不**验证向 `settings.yaml` 的迁移，该统一属后续可选工作）。
5. **技能面**：`scripts/build.mjs` 的 27 项断言 + 探测通道候选根命中（`bootstrap.js` 候选表）。
6. **门禁面**：Resident `bash verify-bundle.sh && node verify-logout.mjs && node verify-registry.mjs && node verify-ui.mjs && node verify-gh-bootstrap.mjs && node verify-update-gc.mjs && node verify-real-artifact.mjs`；Deck `npm test`（`node scripts/verify-chain.js` + `npm run test:smoke`）+ `npm run verify`。
7. **人眼项**：合并后的设置页版式、左栏条目数、明暗主题各一次（不得用自造渲染器替代）。
8. **回滚验证**：在隔离 profile 里回滚后 `gh_*` 与 `deck_*` 数量恢复合并前值，`cordis.patch.yml` 行 id 与顺序还原，且 `leftover` 仍为空；目标 profile 的凭据与数据未被触碰。

---

## 5. 不确定性与证据边界

### 5.1 三类标注在本文件的分布

- **`本地源码`**：§1 的全部路径/行号/权限位（除标注「运行态」的）、§2 的全部源码引用、§3 的全部「判定证据」、§4 的依据。这是本文件证据强度最高的部分。
- **`已安装运行态`**：profile 里两插件并存（`/root/.dsh/profiles/web/package.json:13-14`）、两插件各 1 条 Config entry 且 `status:"absent"`、`choices.json` 存在且 0600（2 workspaces/1 layout）、`gh-cli/bin/gh` 0755 39 MB、`install.json`/`gc.json` 0600、`hosts.yml` 0600（2 条 `oauth_token` 行，内容未读）、`~/.git-credentials` 与 `~/.dsh/github-resident.json` 在固定路径未见、`~/.dsh/github-resident/` 与 `~/updates` 在默认路径未见、`/root/.dsh-mattskillsdeck-cache/logs/` 存在、`git config` 三项未设置、`/usr/bin/gh` 未见。**「未见」只描述本次 stat 结果，不等于「从未建立」**（登记库位置可被 `DSH_GH_REGISTRY_DIR` 改写）。Client Slots 全树（拓扑）已由证据 02 取得。
- **`上游远端`**：本文件只记了两仓 `origin` URL 与本次 `git ls-remote` 的结果（Resident 本地 HEAD = 远端 main `54a1a07`；Deck 本地 HEAD `3b25cd3f` ≠ 远端 main `21f3ca1`）。**没有**做 fetch 或逐提交差异比对。

### 5.2 未验证项（需实机或联网才能确定）

| 未验证项 | 为什么没验证 | 降级为可验证假设的方式 |
|---|---|---|
| `settings.section` 上三条注册在实机上的渲染与可见性 | 本文件调研期 `listSubTree` 超时；拓扑已由证据 02 取得，但拓扑≠页面可见性 | 假设：三条按 order 升序渲染；验证：隔离 profile 安装态下查询并截图对比 |
| 包级 `dsh.client.inject` 多项并集的宿主语义 | 需安装/启停 | 假设：宿主按包级 inject 排图依赖，Deck 为 `[]` 故并集就是 Resident 那一项；验证：合并后观察设置页依赖是否可用 |
| 纤维级 `inject` 5 项并集是否足够 | 需运行态 | 假设：`['connection','slots','locale','workspaces','sessions']` 覆盖两半所需服务；验证：客户端启动无 slot entry 报错 |
| Deck 两条 `deck_*` 注册通路（`deckToolsRow.js` 与 `wiring.js:309`→`agent-register.js`）哪条生效/是否去重 | 需运行态观察（证据 01 §8 列为首要未决） | 假设：隔离 profile 里 10 个 `deck_*` 各出现一次 = 已去重；验证：分别只启用一条，查 `host/Tool.listTools` |
| `ws@^8.22.0` 在 Deck 中的真实用途 | `src/` 无 `from 'ws'` 命中（证据 01 §4.6 同结论） | 假设：未被使用；验证：读 `lib/` 产物与运行态依赖树 |
| `settings.yaml` 与 localStorage 的最终归属 | `settings.js` 生产侧只被无调用方的 `configStore.js` import；`settings.yaml` 链未接线（本文件新发现，证据 01 未提） | 假设：UI 偏好现由 localStorage 承载，`settings.yaml` 是待接线目标；**第一阶段不迁移**；验证：改一次面板偏好后查两处是否变化 |
| `workspace.yaml`/`label-colors.yaml` 的核接线程度 | 核（`src/shared/config-store/*`）已接线：workspace 经垫片进 `workspaceCwd.js`/`backendDecision.js`，labels 经 markdown 后端；但 `src/host/configStore.js` 六个函数在 `src/` 无生产调用方 | 假设：生产读写以 `workspaceCwd.js`/`label-colors.js` 为准，`configStore.js` 是未接线的适配器层；验证：按 `tests/verify-config-store-*.js` + 生产路径 grep 复核 |
| 登记库在真机上是否建立过 | 默认路径未见；`DSH_GH_REGISTRY_DIR` 可改写位置 | 假设：以「本次未见」为准，不推断历史；验证：隔离 profile 里查 `DSH_GH_REGISTRY_DIR` 与默认路径 |
| 上游远端是否落后 | 本文件只做了 `ls-remote`，未做提交级比对；Deck 本地 HEAD 与远端 main 不同 | 假设：以本地 HEAD 为被测对象并如实标注；验证：`git log`/`git diff` 对比本地与远端 main |
| 合并后回环端口是否被 Deck 或其它插件占用 | 需运行态 | 假设：31790 未被占用；验证：`DSH_GH_API_PORT` 探测 + `/state.serverError` |
| Deck 已安装 `1.7.51` 与本地 `1.8.0-rc.7` 的行为差异 | 需逐文件比对 `lib/` 与 `src/` | 假设：本地源码代表目标行为；验证：按证据 01 §9 的差异比对清单逐项核 |
| 技能候选根在合并改名后是否仍命中 | 需安装态 | 假设：必须同提交改 `bootstrap.js:15-50`+`skillDoc.js:27-42`+构建断言；验证：27 项断言 + 探测通道命中 |
| 合并后是否仍满足 `LESSONS.md` 的「重启会摘掉第三方 bundle」现象 | 需实机重启 | 假设：仍会发生，安装 SOP 保留「重启后自检」一步；验证：重启后查 `host/Config.listConfigs` 与 `Tool.listTools` |

### 5.3 与证据 01/02 的交叉引用

- **证据 01《双插件功能矩阵与单插件形态》**（本文件完成时**已存在**）：本文件直接引用其 **§4.3 HTTP 端点与端口**（合并结论「保持」）、**§4.4 配置 schema 与配置键**（`DSH_GH_*` 前缀边界）、**§4.5 持久化目录**（两个父目录不重叠、Deck 写仓库内部）、**§4.6 npm 依赖与构建体系**（体系冲突→P3-1）、**§4.7 client 侧注入差异**（两组 `inject`→P4-1）、**§6 合并后设置页的落点**（P4-2 的映射来源）、**§8 未验证事项**、**§10 关键结论**。**未决点重申**：§10 第 4 条「同名工具双注册未决」、第 5 条「写仓库承诺冲突」——后者在本文件 §2.6 已按源码归位为登记操作契约。
- **证据 02《UI 设置与槽位冲突》**（本文件 v2 修订时**已存在**）：本文件采纳其 **§2.1 槽位注册对照表**与 **§2.3 冲突判定**（R1/R2 的拓扑证据）、**§3.4 设置页合并方案**（P4-2）、**§7.2 `inject` 与 `immediately`**（R6 的两组注入分表依据）。凡与 02 的实机证据冲突之处，以 02 为准。

---

## 6. 关键结论摘要

1. **数据面基本不用搬，最大的迁移风险在「以为要搬」**：两插件的父目录不重叠（Resident `~/.dsh/github-resident*` + `~/.dsh/gh-cli` vs Deck `~/.dsh/mattskillsdeck` + `<cwd>/.dsh-mattskillsdeck-cache` + `updates/<pluginId>`）。真正需要**一次性迁移**的只有两类：随包技能目录名、`updates/<pluginId>` 目录名。localStorage 的 UI 偏好**第一阶段原样保留**，持久化统一（搬进 `settings.yaml`）是后续可选工作，且须先接线。
2. **接线状态要分开看**：`settings.yaml` 完全未接线（`configStore.js` 在 `src/` 无生产调用方）；`workspace.yaml` 与 `label-colors.yaml` 的**核**已通过垫片/markdown 后端进入生产路径，而 `configStore.js` 里同名适配器函数仍无生产调用方。任何「把未接线的 `configStore.js` 适配器或 `settings.yaml` 当既有事实来源」的迁移脚本都会迁到一份空文件；**反向也成立**——不得因该适配器层未接线，就否认 `workspace.yaml`/`label-colors.yaml` 的生产读写与既有文件内容。
3. **凭据收敛成单一写入口，销毁是独立的用户动作**：Deck 现状无 token 落盘路径（只有 `gitCredentialExec` 的只读诊断）；合并后唯一凭据写者是 `gh_*` 身份族。**常规合并/回滚/卸载默认保留账号、OAuth/PAT、helper、gh 缓存与用户配置**；`gh_cli_logout` 的各开关只有用户另行明确要求销毁时才执行，不属迁移路线。
4. **合并时必须显式写对的三条硬约束**：① `choiceStore.js:7-8`「不许改用 `getCacheDir()`」；② `PROTOCOL.registry` 的写范围是**登记操作契约**（[plugin.js:2013-2018](../../plugin.js#L2013-L2018)、[2026](../../plugin.js#L2026)），既有承诺**不需要降低**，只需在文档里与 Deck 写 `docs/agents/` 分述；③ 登记库授权闸门是**写路径上的唯一入口**（[plugin.js:734](../../plugin.js#L734)），不得因为合并到 UI 而移到组件层；既有 `root/depth` grant 覆盖时不再重复确认。
5. **新旧必须互斥激活**：原插件与含同名能力（工具/槽位/client id/右栏类型）的新插件不得同时激活；先在隔离 profile + 临时测试仓库预演切换与失败恢复，再对目标 profile 做一次性停机切换。**没有「每一步都能停在新旧同时激活」这种安全态**。
6. **保留面**：10 个 Deck 工具全部保留（9 个 `deck_*` 工具 + `deck_probe`），Resident 17 个工具不动；两套右栏/槽位落点、用户原有权限与 grant 原样保留。
7. **并存风险里最紧迫的一条仍是「同名工具双注册」**：Deck 有两条注册 `deck_*` 的通路（`deckToolsRow.js` 与 `wiring.js:309`→`agent-register.js`），运行态目前每个名字只出现一次但**无法确认哪条生效**（§5.2）。它直接决定 P3-1 要不要保留 `/tools` 行，因此必须在 P1-1 之前回答，否则 P3 会建在错误形态上。

---

*本文件的唯一写入范围是 `/root/dsh-github-resident/dsh-github-resident/docs/merge-deck-evidence/03-migration-permission-plan.md`；v2/v3 修订只改本文件，未修改任何代码、manifest、构建产物、运行配置或凭据，未安装/启停插件，未执行任何迁移或写状态文件，未创建或修改 issue，未做任何 git 写操作。所有需要写盘或改状态的验证都只写在 §4.4「未来验收方案」里，本次未执行。*
