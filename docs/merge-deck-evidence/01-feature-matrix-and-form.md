# 证据文档 01：双插件功能矩阵与单插件形态

> 本文件是主报告 `docs/merge-deck-assessment-2026-10-11.md` 的证据底稿，供其直接引用。
> 全文只做只读调研，**不实现、不改代码、不安装、不启停插件、不执行迁移、不创建或修改 issue、不 commit/push**。
> 任何带副作用的验证都只写进第 9 节「未来验收方案」，本次一律未执行。

### 修订记录（本次文档修订；仍是只读评估，未改任何代码/manifest/profile/凭据/数据）

本轮按验收反馈修正 8 处已证伪或过度断言，另含 1 处后续定点更正（第 9 条），正文已就地改正（不是只在文末附勘误）：

1. **`deck_probe` 改回「原样保留」**。其定义注释「通道接通即退役」（[`agent-register.js:228`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/shared/deck-tools/agent-register.js#L228)、[`:240-243`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/shared/deck-tools/agent-register.js#L240-L243)）是维护者对未来的注记，**不构成本次合并的删除授权**；合并后 27 个工具（17 `gh_*` + 9 `deck_*` + `deck_probe`）全部保留（3.1 第 10 行）。
2. **单插件形态重写**（第 5 节）。删除原先「完全单行合并 / 灾难级」这一被曲解的比较对象——**单 Host 入口可以调用模块化内部 `apply`，不等于把所有代码揉进一个文件，也不必然毁掉 Deck 测试**。改为公平比较「单包多内部行」「单 Host 入口 + 内部模块」「依赖旧独立包」三形态，推荐须满足**一个安装运行单元**。
3. **客户端装载按 02 号证据 §7.1 更正**（4.7、5.5）：单包客户端图只注册**包名这一项**；两个旧 `__ModuleLoader__.load` 不能直接拼接并期望全部生效。合并后只留**一个统一 Client factory**，factory 内部顺序调用两半的 `apply(ctx)`。
4. **区分两套 `inject`**（4.7、5.5）：包级 `dsh.client.inject` 是**包名图依赖**（Resident 1 项 `@deepseek-ai/dsh-client-ui-settings-general`，Deck `[]`）；客户端导出 `inject` 是**服务名**（`connection/slots/locale/workspaces/sessions`）。此前把它们「求并集」是把两回事混成一组，已拆开。
5. **Deck 设置页内容以 02 号证据 §3.2 的逐行核实为准**：只有只读工作区总览、诊断开关与四个日志动作、更新入口与链接区块（[`SettingsPage.js:132-198`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/client/views/SettingsPage.js#L132-L198)）。删除「模板 / 面板默认高度 / 外观仍在设置页」的错误断言（3.4）。
6. **「登记过程不写仓库」是操作级不变量**，限定在登记操作范围（[`plugin.js:2013-2019`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/plugin.js#L2013-L2019) 的 `invariants`、[`:2026`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/plugin.js#L2026) 的 `registryWritesOnlyItsOwnDir`），**不是整个插件的全局无写承诺**；与 Deck 写 `docs/agents/*` 配置**不冲突**，约定保持（4.5、5.5）。
7. **「`gh_*` / `deck_*` 无同名」只证明跨插件工具名不相交**，**不能**证明 Deck 内部两条注册通路（[`deckToolsRow.js:319-341`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/platform/deckToolsRow.js#L319-L341)、[`agent-register.js:351`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/shared/deck-tools/agent-register.js#L351)）不会重复注册。已按作用域重述，并把「注册所有权归谁」列为合并前必须先验证项（4.1、8、9.2）。
8. **「已安装运行态」拆分**：磁盘文件事实改称**「已安装副本」**；`host/Tool.listTools` 的可见性只说明工具在清单里出现，**不证明调用成功**（1.1、1.2）。
9. **接线状态按文件分开标注**（后续定点更正）：`settings.yaml` 只是**已实现但未接线**的存储模块，生产 UI 偏好仍在浏览器 `localStorage`，第一阶段**不迁移、不新建** `settings.yaml`；而 `workspace.yaml` 的生产读写**已接线**（写 [`workspaceCwd.js:185-193`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/workspaceCwd.js#L185-L193)、读 [`backendDecision.js:100-127`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/tracker/detection/backendDecision.js#L100-L127)），`label-colors.yaml` 的生产读写也已接线（[`markdown/label-colors.js:234-300`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/tracker/backends/markdown/label-colors.js#L234-L300)）——**不能**因为 `src/host/configStore.js` 无生产调用方，就误推所有 YAML 都没接线（3.4、4.4、4.5）。同轮把 `SEVEN` 数组名与探针旧注释按实际「9 个 Deck 业务工具 + `deck_probe` = 10」更正（3.1）。

**本轮已解的两处矛盾**：①「Resident 绝不写仓库」与「Deck 写 `docs/agents/*`」——两者作用域不同（登记操作 vs Deck 配置写），不构成行为冲突（4.5）；②「单 Host 入口」与「Deck 保留多文件分层」——入口只做装配转调、内部实现仍是模块，两者可并存（5.2）。

---

## 1. 范围、方法与来源纪律

### 1.1 评估对象与基线

| 项 | 值 | 来源 |
|---|---|---|
| Resident 本地检出 | `/root/dsh-github-resident/dsh-github-resident`，HEAD `54a1a07`，`main...origin/main` 干净 | `git log --oneline -3`、`git status --porcelain`（只读） |
| Resident 上游远端 | `https://github.com/SunsetRNE/dsh-github-resident.git`，`ls-remote HEAD` = `54a1a07d233e23037b847d3ac407b33851fe7284` | `git remote -v`、`git ls-remote`（只读，网络可用） |
| Deck 本地检出 | `/root/dsh-github-resident/dsh-mattpocock-skills-deck`，HEAD `3b25cd3f`，干净 | 同上 |
| Deck 上游远端 | `https://github.com/FeatherHunter/dsh-mattpocock-skills-deck.git`，`ls-remote HEAD` = `3b25cd3f1dceec56c6327f18bb893e2426c619ab` | 同上 |
| 已安装副本（Resident，磁盘文件事实） | `/root/.dsh/plugin-src/@local/dsh-github-resident-v2/`，profile 依赖 `link:` 指过去；`plugin.js` / `client.js` / `cordis.patch.yml` 与本地检出**逐字节相同**（`cmp`/`diff -q` 通过） | `/root/.dsh/profiles/web/package.json:12`、`cmp` |
| 已安装副本（Deck，磁盘文件事实） | `/root/.dsh/plugin-src/dsh-mattpocock-skills-deck/`，**版本 `1.7.51`**，与本地检出 `1.8.0-rc.7` **不是同一份** | `/root/.dsh/plugin-src/dsh-mattpocock-skills-deck/package.json:2-3` |

> 「已安装副本」只说明盘上这一份的版本与字节，**不说明它当前被加载、也不说明其中的功能在当前运行里可用**。运行态结论只能用 1.2 的「运行态观测」，且其强度上限见该条。

### 1.2 事实分类与标注约定（五类）

- `本地源码 路径:行号（HEAD commit）` —— 只读本地检出。
- `上游远端 URL / ls-remote commit` —— 只读远端。
- `已安装副本` —— 只读查看 `/root/.dsh` 下落地文件得到的**磁盘事实**（版本、字节、目录内容）。它不代表该份被加载，也不代表其功能可用。
- `运行态观测` —— 通过 `cordis_inspect_query`（`host/Tool`、`host/Config`）得到。**强度上限**：`host/Tool.listTools` 只证明某工具**在本会话可见的工具清单里出现**，不证明它调用会成功、不证明它的注册所有权唯一；`host/Config.listConfigs` 只证明配置 entry 的注册状态。
- `客户端槽位拓扑` —— Client `Slots.listSubTree` 返回的是**槽位声明树**（`kind`/`scope`/`registration` schema/purpose 等契约），**不含实时占用者**，因此既不能证明页面可见性，也不能证明某个 section 一定被渲染。

**纪律**：源码推断绝不写成实机验证。「工具在清单里可见」≠「执行成功」；「槽位在拓扑里存在」≠「页面渲染出来」。凡本文件写运行态事实处，均注明取得手段与其强度上限。

### 1.3 已用到的只读手段

**源码链接基址（重要来源可点击，均按本次基线 commit 钉住）**：
- Resident：`https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/` —— 例 [`plugin.js:2013-2019`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/plugin.js#L2013-L2019)。
- Deck：`https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/` —— 例 [`deckToolsRow.js:319-341`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/platform/deckToolsRow.js#L319-L341)。
- 约定：修订记录、第 5 节、第 8 节与第 10 节的关键来源用完整可点击链接；各矩阵表内为节省版面保留 `路径:行号` 简写，按上面两个基址拼接即可定位到同一行区间。

- 文本：`read` 工具；文件发现：`glob` 工具；内容检索：`grep` 工具（均按平台要求，未用 shell `cat`/`find`）。
- 运行态观测：先 `cordis_inspect_list`，再按需精确 `cordis_inspect_query`（`host/Tool.listTools`、`host/Config.listConfigs`）。强度上限见 1.2。
- 客户端槽位：主代理取到过一份 Client `Slots.listSubTree` 全树（本会话落盘于 `/tmp/dsh-spill-wu6U81/session-5fd6d5f03a9f/4c50c4ef765c-cordis_inspect_query.txt`）。核对后确认它是**槽位声明拓扑**（`kind`/`scope`/`registration` schema/purpose），**不含实时占用者与渲染结果**，因此只用来印证槽位契约，不用来断言页面可见性或「某 section 当前被注册」。
- 关于「没有已连接页面」：曾有一次子代理查询超时。超时**不能推断浏览器没有连上或页面不存在**，故本文件不作该结论；页面级结论一律留到第 9 节现场验收。
- 网络：`git ls-remote`（只读）两次，均成功；本文件未用 `web_fetch`。
- 未读取任何 secret：`~/.git-credentials`、`~/.config/gh/hosts.yml`、`~/.dsh/github-resident.json` 只按「存在性与权限位」描述（见 2.4），不读取内容。

---

## 2. 功能保留矩阵（a）Resident

每行格式：功能 / 触发入口 / 通道 / 源码路径:行号 / 合并后归属 / 证据强度。
「合并后归属」取值：原样保留、合并改写、需重命名、可废弃（**本次没有任何条目归为「可废弃」**；`deck_probe` 的维护注释只是未来注记，见 3.1 第 10 行）。

### 2.1 工具面（17 个 `gh_*`）

单一事实来源是 `plugin.js:806-824` 的 `TOOL_PROTOCOL` 数组（`本地源码 plugin.js:806-824（54a1a07）`）。下表「注册点」列给出每个工具真正 `ctx.tools.register(...)` 的行号。

| # | 功能（工具名） | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|---|
| 1 | `gh_resident_status`（kind read；required 无；optional `root`,`depth`） | 模型调用 | 工具 | 协议 `plugin.js:807`；注册 `plugin.js:875-876` | 原样保留 | 强：协议表 + 注册点 + **运行态观测**（`host/Tool.listTools` 中该工具及其参数**可见**；可见≠调用成功） |
| 2 | `gh_resident_login`（write；required `token`,`user_login`；optional `user_name`,`user_email`,`repos_root`） | 模型调用 | 工具 | `plugin.js:808`；注册 `plugin.js:928-929` | 原样保留 | 同上 |
| 3 | `gh_repos`（read；optional `root`,`depth`） | 模型调用 | 工具 | `plugin.js:809`；注册 `plugin.js:979-980` | 原样保留 | 同上 |
| 4 | `gh_repo_registry`（write；optional `action`,`root`,`depth`,`consent`,`confirm`,`prune`,`path`,`slug`,`note`,`tags`） | 模型调用 | 工具 | `plugin.js:810`；注册 `plugin.js:1017-1018` | 原样保留 | 同上 |
| 5 | `gh_repo_registry_list`（read；optional `root`,`prefix`,`only_missing_remote`,`has_remote`,`host`,`tag`） | 模型调用 | 工具 | `plugin.js:811`；注册 `plugin.js:1036-1037` | 原样保留 | 同上 |
| 6 | `gh_commit`（write；required `repo`,`message`；optional `push`） | 模型调用 | 工具 | `plugin.js:812`；注册 `plugin.js:1051-1052` | 原样保留 | 同上 |
| 7 | `gh_sync`（write；optional `root`,`depth`,`message`,`push`,`dry_run`） | 模型调用 | 工具 | `plugin.js:813`；注册 `plugin.js:1067-1068` | 原样保留 | 同上 |
| 8 | `gh_pr`（write；required `repo`,`title`；optional `head`,`base`,`body`,`draft`） | 模型调用 | 工具 | `plugin.js:814`；注册 `plugin.js:1087-1088` | 原样保留 | 同上 |
| 9 | `gh_cli_install`（write；optional `force`,`prefer`） | 模型调用 | 工具 | `plugin.js:815`；注册 `plugin.js:1766-1767` | 原样保留 | 同上 |
| 10 | `gh_cli_auth_web`（write；optional `setup_git`,`open_browser`） | 模型调用 | 工具 | `plugin.js:816`；注册 `plugin.js:1816-1817` | 原样保留 | 同上 |
| 11 | `gh_cli_status`（read） | 模型调用 | 工具 | `plugin.js:817`；注册 `plugin.js:1846-1847` | 原样保留 | 同上 |
| 12 | `gh_cli_setup_git`（write；optional `set_identity`） | 模型调用 | 工具 | `plugin.js:818`；注册 `plugin.js:1890-1891` | 原样保留 | 同上 |
| 13 | `gh_cli_logout`（write；optional `hostname`,`confirm`,`revoke`,`purge_git`,`reset_state`,`uninstall_gh`,`remove_gh_config`,`dry_run`） | 模型调用 | 工具 | `plugin.js:819`；注册 `plugin.js:1722-1723` | 原样保留 | 同上 |
| 14 | `gh_cli_resolve`（read） | 模型调用 | 工具 | `plugin.js:820`；注册 `plugin.js:1794-1795` | 原样保留 | 同上 |
| 15 | `gh_cli_version`（write；optional `update`,`force`） | 模型调用 | 工具 | `plugin.js:821`；注册 `plugin.js:1740-1741` | 原样保留 | 同上 |
| 16 | `gh_cache_gc`（write；optional `dry_run`,`keep_versions`） | 模型调用 | 工具 | `plugin.js:822`；注册 `plugin.js:1755-1756` | 原样保留 | 同上 |
| 17 | `gh_protocol`（read，无参数） | 模型调用 | 工具 | `plugin.js:823`；注册 `plugin.js:2069-2070` | 原样保留（**它是合并后的对外协议入口，必须保住**） | 同上 |

工具封装口径：所有工具经 `textTool()`（`plugin.js:839-872`）注册，统一给返回值加 `{ protocol, ok }` 信封（`plugin.js:863-869`），只读工具 `isConcurrencySafe()` 返回 true（`plugin.js:870`）。

### 2.2 注册表文件库（`gh_repo_registry` 的落盘契约）

| 功能 | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|
| schema 常量：`repo-entry` / `registry-index` / `registry-consent`，版本 2 | 模块常量 | 后台/落盘 | `plugin.js:159-162` | 原样保留 | 强 |
| 目录布局 `REGISTRY_DIR/registry/{repos/,index.json,consent.json}`，环境变量 `DSH_GH_REGISTRY_DIR` 覆盖 | 模块常量 | 落盘 | `plugin.js:164-168` | 原样保留 | 强 |
| 8 个 action：`status/plan/build/rescan/verify/forget/revoke/purge` | 工具参数 `action` | 工具 | `plugin.js:170` | 原样保留 | 强 |
| slug 规则 `<basename>-<sha1(abs path)[:12]>` | 内部 | 落盘 | `plugin.js:173-176` | 原样保留 | 强 |
| 远端 URL 脱敏（剥 userinfo） | 内部 | 落盘 | `plugin.js:179-190` | 原样保留 | 强 |
| `parseRemoteUrl` / `remoteView`（URL 与 `git@host:owner/repo` 两种写法） | 内部 | 后台 | `plugin.js:193-218` | 原样保留 | 强 |
| 原子写 + `0600` 文件 / `0700` 目录 | 内部 | 落盘 | `plugin.js:240-249` | 原样保留 | 强 |
| 授权模型：`grants[]`，root 必须命中且 depth 不得放大；缺 depth 的旧 grant 不覆盖 | `consent.json` | 落盘 | `plugin.js:361-403` | 原样保留 | 强 |
| 未授权回执只回 `{consentRequired:true, ask:{...}}`、不写字节 | 工具回包 | 工具 | `plugin.js:405-429` | 原样保留 | 强 |
| 一仓一文件读盘、schema 不符进 `malformed` | 内部 | 落盘 | `plugin.js:330-351` | 原样保留 | 强 |
| Host Service 导出 `githubResident`（10 个方法） | `ctx.provide` | 后台 | API `plugin.js:1924-1938`；实现 `plugin.js:2030-2066`；挂载 `plugin.js:2067` | 原样保留（服务键名建议不动） | 强（源码）；**未在运行态确认服务可被其它插件取到** |

### 2.3 `gh_protocol` 自描述文档

| 功能 | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|
| 协议 id/version：`dsh-github-resident` v6 | 模块常量 | 工具 | `plugin.js:801-803` | 合并改写：合并 Deck 后必须**升 version 并补 deck 章节**，否则自描述文档会撒谎 | 强 |
| `PROTOCOL.service`（key、10 个方法签名、消费示例） | `gh_protocol` | 工具 | `plugin.js:1924-1939` | 合并改写（追加 Deck 的能力描述） | 强 |
| `PROTOCOL.http`（base `127.0.0.1:31790`、13 条回环路由） | `gh_protocol` | 工具 | `plugin.js:1940-1958` | 合并改写（若 Deck 也走回环则须登记） | 强 |
| `PROTOCOL.envelope` / `tools` / `errors`（9 个错误码） | `gh_protocol` | 工具 | `plugin.js:1959-1965`、`826-836` | 合并改写（错误码表合并） | 强 |
| `PROTOCOL.registry`（schema/entry/consent/invariants） | `gh_protocol` | 工具 | `plugin.js:1966-2019` | 原样保留 | 强 |
| `PROTOCOL.guarantees`（掩码、回环、只读工具清单、幂等） | `gh_protocol` | 工具 | `plugin.js:2020-2027` | 合并改写 | 强 |

### 2.4 凭据、状态与自带 gh 落地

| 功能 | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|
| 状态文件 `~/.dsh/github-resident.json`，`0600`（代码写 mode + chmod） | `gh_resident_login` 等 | 落盘 | `plugin.js:22-23`、`57-63` | 原样保留 | 强（源码口径）；**运行态只确认「已知路径存在性」，未读内容** |
| `~/.git-credentials`（按 host 更新一行、`0600`） | login / logout | 落盘 | `plugin.js:24`、`221-233` | 原样保留 | 强（源码） |
| token 只从 env / 状态文件读，输出只回掩码 | 全部工具 | 工具 | `plugin.js:65-73`；掩码在 `plugin.js:886-890` | 原样保留 | 强 |
| gh 三层解析：system → plugin-cache → 落地 | `resolveGh()` | 后台 | `plugin.js:1394-1418` | 原样保留 | 强 |
| 自带落地目录 `~/.dsh/gh-cli`（`bin/gh`、`install.json`、tarball/deb 抽取） | `gh_cli_install` / 启动自动落地 | 落盘 | `plugin.js:1136-1138`、`1297-1332` | 原样保留 | 强 |
| 设备码网页认证（PTY 起 `gh auth login`，抓 8 位码） | `gh_cli_auth_web` / 设置页按钮 | 工具+UI | `plugin.js:1520`；调用 `plugin.js:2053-2058` | 原样保留 | 强（源码） |
| 凭据销毁（revoke / hosts.yml / git-credentials / state / helper / 可选 dpkg -r） | `gh_cli_logout` | 工具 | `plugin.js:1623-1660`（`found` 勘察）+ 后续执行段 | 原样保留 | 强（源码）；**全过程未在真机执行** |
| `~/.config/gh/hosts.yml` 只做存在性与权限位检查 | teardown 勘察 | 后台 | `plugin.js:1135`、`1648` | 原样保留 | 强（源码说明「只描述存在性」） |
| 版本自更新（24h 冷却、系统层只报告） | `gh_cli_version` / 启动 | 工具+后台 | `plugin.js:2171`、`2208` | 原样保留 | 强（源码） |
| 落地缓存 GC | `gh_cache_gc` / 落地后 | 工具+后台 | `plugin.js:2253-2262` | 原样保留 | 强（源码） |

### 2.5 本机回环 HTTP API（设置页数据通道）

| 功能 | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|
| 回环服务只监听 `127.0.0.1:<DSH_GH_API_PORT\|31790>` | 插件加载（`ctx.effect`） | 后台 | `plugin.js:2082-2083`、`2451-2452`、`2594`、`2631-2649` | 原样保留 | 强（源码） |
| 13 条路由（`/state`、`/gh/version`、`/gh/update`、`/protocol`、`/registry*` 6 条、`/auth/start`、`/logout`） | 设置页 / 外部脚本 | HTTP | 声明 `plugin.js:1943-1957`；分发 `plugin.js:2452` 起 | 原样保留 | 强（源码） |
| 写路由来源头闸门 `originGate`（缺 Origin/Referer 一律拒） | 写路由 | HTTP | `plugin.js:2092-2109` | 原样保留 | 强 |
| CORS 只回显回环来源（不再 `*`） | 全部路由 | HTTP | `plugin.js:2114-2127` | 原样保留 | 强 |
| 端口占用时如实回报 `serverError`，不伪装成功 | 启动失败 | HTTP | `plugin.js:2459-2466`（状态字段）+ `plugin.js:2586-2592` | 原样保留 | 强 |
| 启动期后台三件事：账号快照 / 自动落地 gh / 版本检查；可用 `DSH_GH_NO_STATE_CHECK`、`DSH_GH_NO_BOOTSTRAP` 关 | 插件加载 | 后台 | `plugin.js:2598-2629` | 原样保留 | 强（源码） |

### 2.6 客户端 UI（`client.js`）

| 功能 | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|
| 客户端模块壳 `window.__ModuleLoader__.load({id:'@local/dsh-github-resident-v2'})` | 页面加载 | UI | `client.js:9-11` | **需重命名/改写**：合并后客户端图只注册**包名一项**，只能留一个统一 factory（内部调用 Resident 半与 Deck 半），不能把两个 `load` 并排拼起来。包名一旦变化，此处 id 与 `verify-bundle.sh` 的身份三处一致检查都要跟着改（见 4.7、5.5，依据 02 号证据 §7.1） | 强 |
| 页 1「GitHub」：`settings.section` id `github-resident`、order 60 | 设置左栏 | UI | `client.js:419-424` | 原样保留 | 强 |
| 页 2「仓库登记库」：`settings.section` id `github-repo-registry`、order 61 | 设置左栏 | UI | `client.js:427-432`；组件定义 `client.js:114` | **合并改写的主战场**：Deck 设置页要求并进这一页 | 强 |
| 注入声明 `inject: ['slots']`（客户端**导出**的服务名依赖，不是包级 `dsh.client.inject`） | 客户端插件契约 | UI | `client.js:417` | 合并成单一 factory 后取服务名并集（含 `slots`），与 Deck 的 5 项不冲突，见 4.7 | 强 |
| 只用主题 token（`--dsw-alias-*`），样式随组件挂载 | 两页渲染 | UI | `client.js:47-60`（`CSS_SHARED`） | 原样保留 | 强 |
| 页 1 的「在会话里驱动」命令清单（复制按钮） | 设置页 | UI | `client.js:29-40`（`COMMANDS`）、`client.js:409-412` | 合并改写：清单需并入 Deck 的命令入口 | 强 |

### 2.7 发布、校验与配套

| 功能 | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|
| `package.json` 元数据与 `exports`（`.`/`./client`/`./package.json`/`./locale/*.json`） | 安装 | 构建 | `package.json:7-12` | 合并改写（新增 Deck 子路径导出） | 强 |
| `dsh.bundle.patch` → `./cordis.patch.yml` | 安装 | 构建 | `package.json:38-41` | 合并改写 | 强 |
| `dsh.client`：platform web、`immediately:true`、`inject:['@deepseek-ai/dsh-client-ui-settings-general']`（**包级、包名图依赖**） | 页面加载 | UI | `package.json:42-48` | 合并改写：两边都取并集，而 Deck 声明为 `[]`，故合并后仍是 Resident 这一项（**不是**与客户端服务名 inject 合并；见 4.7） | 强 |
| 打包白名单 `files`（不含 `docs/`） | 发布 | 构建 | `package.json:13-22` | 合并改写（Deck 的 `lib/`、`bundled-skills/` 必须进白名单） | 强 |
| 7 个 verify 脚本 + `verify` 聚合 | 人跑 | 构建 | `package.json:23-32` | 原样保留（但需扩到覆盖合并形态） | 强 |
| `verify-bundle.sh`：身份三处一致（pkg.name / patch.name / client id）检查 | 人跑 | 构建 | `verify-bundle.sh:23-40` | 合并改写（合并后这三处必须重新对齐，否则装不上） | 强 |
| `verify-ui.mjs`：真起回环服务 + 桩 `__ModuleLoader__` 检查两个 `settings.section` | 人跑 | 构建 | `verify-ui.mjs:1-25` | 合并改写（期望的 section 数量与 id 会变） | 强 |
| `verify-registry.mjs` / `verify-gh-bootstrap.mjs` / `verify-logout.mjs` / `verify-update-gc.mjs` / `verify-real-artifact.mjs` | 人跑 | 构建 | 同目录同名文件 | 原样保留 | 强 |
| `SHA256SUMS`（两个发布物哈希） | 发布核对 | 构建 | `SHA256SUMS:1-2` | 需重新生成（本次不动） | 强 |
| `tools/account-ui-check.sh`（账号页只读体检脚本） | 人跑 | 构建 | `tools/account-ui-check.sh` | 原样保留 | 中（只确认存在与可执行位） |
| `locale/zh.json`、`locale/en.json`（仅 meta 标题与描述） | 安装元数据 | UI | `locale/zh.json:1-6`、`locale/en.json` | 合并改写（合并后的标题/描述） | 强 |
| `icon.svg` | 安装元数据 | UI | `package.json:37` | 待定（两插件各有图标，合并后取一） | 中 |

---

## 3. 功能保留矩阵（b）Deck

### 3.1 工具面（9 个 `deck_*` + 1 个诊断探针）

Deck 的工具走**两条互不相干的注册路**：
（i）bundle patch 第二行 `dsh-mattpocock-skills-deck/tools` → `package/lib/platform/deckToolsRow.js`，其 `apply()` 直接 `ctx.tools.register(...)`（`本地源码 src/host/platform/deckToolsRow.js:319-341（3b25cd3f）`）；
（ii）宿主装配点 `deckToolsAssembly.js` 把 9 个工厂装成表，再由 `hookDeckAgentTools` 注册（`src/host/refresh/wiring.js:309`）。
`deckToolsRow.js` 注册 **9 个 Deck 业务工具 + 1 个诊断探针 `deck_probe`，合计 10 个**（注册循环与探针见 `deckToolsRow.js:330-341`）。工具数组常量在源码里仍叫 **`SEVEN`**（`deckToolsRow.js:27`），但这个名字**已过时**：数组实际含 9 个定义，不是 7 个；探针定义处「通道接通即退役」同样是旧注释（`agent-register.js:240-243`），**不构成本次删除授权**。

| # | 功能（工具名） | 输入（required / optional） | 读/写 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|---|
| 1 | `deck_context` | 无参数 | read | 定义 `src/host/tools/deckContext.js:32-33`；工厂 `:44-46` | 原样保留 | 强：定义 + **运行态观测**（`host/Tool.listTools` 中可见；可见≠调用成功） |
| 2 | `deck_issue_get` | required `key`；optional `comments`,`section`（本地源码另有 `blocking`，见注） | read | `src/host/tools/deckIssueGet.js:31-42` | 原样保留 | 强（定义）；**运行态版本较旧，无 `blocking`** |
| 3 | `deck_map_snapshot` | required `key`；optional `frontierOnly`（本地源码另有 `detail`） | read | `src/host/tools/deckMapSnapshot.js:27-37` | 原样保留 | 强（定义）；**运行态无 `detail`** |
| 4 | `deck_issue_list` | required `[]`；optional `state`,`type`,`labels`,`assignee`,`query`,`limit`,`effortId` | read | `src/host/tools/deckIssueList.js:16-29` | 原样保留 | 强 |
| 5 | `deck_issue_create` | required `title`；optional `body`,`kind`,`parentKey`,`labels`,`assignees`,`idempotencyKey`,`effortId` | write | `src/host/tools/deckIssueCreate.js:39-53` | 原样保留 | 强 |
| 6 | `deck_map_plan_create` | required `title`,`children`；optional `body`,`planId`,`edges`,`effortId` | write | `src/host/tools/deckMapPlanCreate.js:26-64` | 原样保留 | 强 |
| 7 | `deck_map_link` | required `key`（另有整批 `edges`）；optional `parentKey`,`blockedBy` | write | `src/host/tools/deckMapLink.js:25-43` | 原样保留 | 强 |
| 8 | `deck_issue_patch` | required `key`；optional `comment`,`addLabels`,`removeLabels`,`assignees`,`title`,`body`,`progress`,`close`,`effortId` | write | `src/host/tools/deckIssuePatch.js:38-54` | 原样保留 | 强 |
| 9 | `deck_issue_report` | required `key`；optional `note`,`effortId` | write | `src/host/tools/deckIssueReport.js:34-44`；`kind` 由 shell 传入 `:89` | 原样保留 | 强 |
| 10 | `deck_probe`（诊断探针） | 无参数 | read | 定义 `src/shared/deck-tools/agent-register.js:240-243` 的 `probeDefinition`；注册 `deckToolsRow.js:330-341` | **原样保留（本次合并必须保留）**：它是 `deck_*` 工具面的一部分，合并后连同其余 26 个工具一并留下；维护注释「通道接通即退役」只是维护者对未来的注记，**不构成本次授权删除** | 强 |

注（版本差异，**必须写进主报告**）：本地源码 `deckIssueGet.js:39` 有 `blocking` 参数、`deckMapSnapshot.js:34` 有 `detail` 参数，而**已安装副本（1.7.51）的工具清单观测里没有这两个参数**。这说明「源码 = 已加载运行态」这一假设对 Deck **不成立**，合并评估不能拿本地源码当已上线行为。

Deck 工具的注册形态另有两条关键事实：
- 行模块交的是**纯数据对象**（`name/description/parameters/timeoutMs/output/execute`），刻意不引用工具包，理由是自带一份工具包会导致注册时 `Cannot read properties of undefined (reading 'prepare')`（`src/host/platform/deckToolsRow.js:1-22` 注释）。`本地源码 src/host/platform/deckToolsRow.js:1-22（3b25cd3f）`
- 工具超时 `AGENT_TOOL_TIMEOUT_MS = 120000`；输出模式有「定义函数写法」与「原生写法」两份，退路用后者（`src/shared/deck-tools/agent-register.js` 的 `AGENT_TOOL_TIMEOUT_MS`、`deckAgentOutputSpec`、`deckAgentOutputSchemaRaw`）。
- 工具顺序单一真源 `DECK_TOOL_ORDER`（`src/shared/deck-tools/plan.js:100-102`）。

### 3.2 27 个随包技能与发现路径

| 功能 | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|
| 随包技能 provider（rank 350，盖过家目录 400/500 旧副本） | `skills.registerProvider` | 技能 | `src/host/bootstrap.js:9-11`、`106-108`、`180-188` | 原样保留 | 强（源码） |
| 候选目录探测（cwd 各级、`$HOME/.dsh/profiles/*/node_modules/.../bundled-skills`） | provider 初始化 | 技能 | `src/host/bootstrap.js:19-67` | 原样保留 | 强 |
| 27 个技能目录（`find package/bundled-skills -maxdepth 1 -type d` = 27） | 随包 | 技能 | `package/bundled-skills/`；构建期断言 `scripts/build.mjs:770-772` | 原样保留 | 强（本地目录计数）；**已安装副本**目录下有 30 个条目（27 目录 + `LICENSE`/`README.md`/`VERSION`），与源码注释一致 |
| 技能名清单真源 `MATT_SKILL_PROBE_NAMES` | provider / 链检查 | 技能 | `src/shared/matt-skills.js:21+` | 原样保留 | 强 |
| 技能卡读取（`skill.readDoc`，含 `SKILL.zh.md` 回退） | 右侧栏技能页 | RPC | `src/host/skillDoc.js:25-57`、`58-79` | 原样保留 | 强 |
| 技能名去重/合法性（连字符规则） | provider | 技能 | `src/host/bootstrap.js:105`、`123` | 原样保留 | 强 |

安装后 bundled 技能随包分发，位置由 `files` 白名单保证（`package/package.json:29-36`）。

### 3.3 右侧栏与面板

| 功能 | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|
| 原生右侧栏注册一个 tab 类型（id/kind、标题、图标、`priority:'builtin'`、引导项 order 60） | `ctx.get('sidebarRightTabs').register` | UI | `src/client/panelAssembly.js:104-118`；常量 `src/client/kernel/router.js:30-31` | 原样保留 | 强（源码） |
| 右栏内容体两个槽位（`sidebar.right.pane.tab`、`...tab.title`，key 同上） | 槽位注册 | UI | `src/client/panelAssembly.js:121-130` | 原样保留 | 强 |
| 等待方式是服务（`ctx.inject(['sidebarRightTabs'])`），老宿主退化为每秒重试 10 次 | 启动 | UI | `src/client/panelAssembly.js:132-146` | 原样保留 | 强 |
| 卸载清理（`ctx.effect` 复位 tab 与槽位） | 卸载 | UI | `src/client/panelAssembly.js:147-154`；槽位闸门 `:49-83` | 原样保留 | 强 |
| 会话输入区停靠条 `conversation.input.dock`（id `dsh-mattpocock-skills-deck`，order 40） | 槽位 | UI | `src/client/panelAssembly.js:84-87` | 原样保留 | 强 |
| `tool.view.cordis` 槽位（RunPanel，`key:'self'`） | 槽位 | UI | `src/client/panelAssembly.js:88-90` | 原样保留 | 强 |
| 面板页签：列表 / 版本管理 / 拉取请求 / 技能 / 环境检查（折叠优先级 4/5/6/7/8） | 面板内 | UI | `src/client/views/shared/Tabs.js:38-44`；文案 `src/client/kernel/locale-panel.js:113-116,151` | 原样保留 | 强 |
| 状态栏胶囊与横幅（`StatusBar`、`capFold` 折叠机） | `conversation.input.dock` | UI | `src/client/statusbar/StatusBar.js`、`capFold.js`、`capFoldMachine.js` | 原样保留 | 中（只按文件与注册点确认，未逐行读） |
| 面板浮窗已退役（只留右栏一个落点） | —— | UI | `src/client/panelAssembly.js:84-85` 注释 | 原样保留（说明 Deck 不再依赖 better-sidebar） | 强 |

### 3.4 Deck 设置页（要求并入 Resident 的仓库登记页）

| 功能 | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|
| 设置 → 插件 → `settings.plugins.tab`（id `dsws-settings`，order 40，label=`panel.title`） | 设置页 | UI | `src/client/panelAssembly.js:86-88` | **需重命名/合并**（并入 Resident 页后是否保留双入口需人拍板） | 强 |
| 设置左栏 `settings.section`（id `dsws-settings-section`，order 18） | 设置页 | UI | `src/client/panelAssembly.js:89-93` | **合并改写**：并入 `github-repo-registry`（order 61）那一页 | 强 |
| 设置页内容组件 `SettingsPage` | 两入口共用同一组件 | UI | `src/client/views/SettingsPage.js`；工作区总览拆在 `src/client/views/SettingsWorkspaces.js` | 合并改写（内容整体搬进登记页做分区） | 强（逐行核实，见 02 号证据 §3.2） |
| **设置页实际内容＝只读工作区后端总览**（默认收起的 `<details>`，摘要「工作区 N / 已绑定 M」+ 刷新；每行目录 + 后端色点名 + 来源标签 + 跳转） | 设置页 | UI | `SettingsPage.js:130,161`；`SettingsWorkspaces.js:8-141` | 合并改写（整体并入登记页分区） | 强 |
| **诊断日志分组**：主开关 + 导出今日日志 / 打开位置 / 复制路径 / 清空今日日志（清空带行内二次确认） | 设置页 | UI | `SettingsPage.js:164-188` | 合并改写（并入登记页分区） | 强 |
| **标题行与链接区块**：图标 + `MattSkills` + 版本号（可点跳仓库）；更新入口 `UpdateEntryHost`；🌟 仓库首页 / 💬 新建 issue；底部「作者其他插件」4 行外链 | 设置页 | UI | `SettingsPage.js:139-152,190-198`；`views/UpdateEntryHost.js:22-45` | 合并改写（搬家，不丢） | 强 |
| 配置落盘：`~/.dsh/mattskillsdeck/settings.yaml` | **当前设置页不写它** | 落盘（**已实现但未接线**） | 存储核 `src/shared/config-store/settings.js:3`；适配器 [`configStore.js:6-22`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/configStore.js#L6-L22)，但该适配器在 `src/` 内**无生产调用方**（命中只在 `tests/verify-config-store-*.js`） | **第一阶段不迁移、不新建 `settings.yaml`**：UI 偏好现在仍由浏览器 `localStorage`（`dsws.*` 键）承载；把偏好统一到该文件是后续可选工作，须先接线 | 中（存储模块已实现，但生产未接线；**不能**当既有事实来源，否则会迁到空文件） |
| 工作区配置：`<repo>/docs/agents/workspace.yaml`（旧 `.json` 兼容读、老文件保留备查） | 选后端时 | 落盘 | **生产读** [`backendDecision.js:100-127`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/tracker/detection/backendDecision.js#L100-L127)、`explicitDetector.js:44-50`、`workspaceCwd.js:174-183`；**生产写（首绑与迁移）** [`workspaceCwd.js:185-193`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/workspaceCwd.js#L185-L193)（`stringifyWorkspaceFile` → `writeText`）与 `208-243`；存储核 `src/shared/config-store/workspace.js:3-5` 经垫片接入。**注意**：`src/host/configStore.js:234-260` 的同名适配器在 `src/` 内无生产调用方（未接线） | 原样保留 | 强（生产路径已接线） |
| 标签配色：`<repo>/docs/agents/label-colors.yaml`（旧 `.json` 兼容读） | 打开改色弹窗/写标签色时 | 落盘 | **生产读写** [`label-colors.js:234-300`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/tracker/backends/markdown/label-colors.js#L234-L300) 与 `label-colors-ops.js:11-216`；文本/形状核由 `label-colors-codec.js:14` import `src/shared/config-store/labels.js:5-7`。**注意**：`src/host/configStore.js:305-330` 的同名适配器在 `src/` 内无生产调用方（未接线） | 原样保留 | 强（生产路径已接线） |

**更正（删除已证伪断言）**：本表此前列有「面板默认高度 / 开始模板 / 外观等配置项」。按 02 号证据 §3.2 的逐行核实，这些**不在**当前设置页：

- 「打开位置（DSH 右栏 / BetterSidebar 二选一）」整项删除（`SettingsPage.js:125-127`、`kernel/config.js:10-14`）。
- 配置页模板编辑入口删除（`kernel/config.js:29-31`）；已存模板值只被行级快捷按钮沿用，设置页不再写它（`kernel/config.js:15-24`）。
- 剩余 `dsws.cfg` 存档只有一个 `withWayfinder`，本页既不读也不写；外观图标/动作词由设计定死，不提供配置项（`kernel/config.js:11-24`）。
- Deck 页内浮窗（`shell.overlay`）整份退役，面板只有右栏一个落点（`panelAssembly.js:76-78`）。

因此「Deck 设置页今天没有真正的配置项」，合并工作量是**搬 4 个区块 + 处理双入口**，不是搬配置表单（02 号证据 §10 第 2 条）。

### 3.5 后端能力、刷新与日志

| 功能 | 触发入口 | 通道 | 源码路径:行号 | 合并后归属 | 证据强度 |
|---|---|---|---|---|---|
| 后端能力：**GitHub 支持、Markdown 当前为预览版、GitLab 暂不支持**（`package/package.json:8` 原文）；`backends/gitlab/` 目录存在仅为源码事实，合并**不等于**启用 GitLab 支持 | 后端探测 | 后台 | `src/host/tracker/backends/{github,gitlab,markdown}/`；`package/package.json:8` | 原样保留（保留现有能力与限制，不扩大承诺） | 强（目录 + package 描述 + 后端入口） |
| 版本管理（写：stage/commit/push/pull 等） | 版本管理页签 | RPC | RPC 注册 `src/host/index.js:243-253`；实现 `src/host/versionControl*.js`、`src/client/views/versionControl/` | 原样保留 | 强 |
| 刷新机制（闸 + 账本 + 写事件 + 会话链） | 后台常驻 | 后台 | `src/host/refresh/wiring.js`；`src/host/index.js:105-112` | 原样保留 | 强 |
| 常驻诊断日志（`dsh-log` 派生进包，落 `<cwd>/.dsh-mattskillsdeck-cache/logs/`） | 页签/面板 | 后台+落盘 | `src/host/logStore.js:7-13`、`:168-192`；`src/host/logPkg/` | 原样保留 | 强 |
| 命名守护（`naming-guardian.json`，落缓存目录） | 常驻 | 后台 | `src/host/namingGuardian.js:15` | 原样保留 | 强 |
| 更新面板（检查/安装/重启，依赖 `dsh-plugin-update`） | 面板 | RPC | RPC `src/host/index.js`（`wf.updateCheck` 等）；实现 `src/host/updateFromPackage.js:18` | 原样保留 | 强（RPC 注册表 + 依赖 import） |
| 会话链 / 交接 / 提交信息注入 | 面板 | RPC | `src/host/handoffClaim.js`、`src/host/refresh/chain*.js` | 原样保留 | 中 |
| 选择记忆（`~/.dsh/mattskillsdeck/choices.json`） | 选后端时 | 落盘 | `src/host/choiceStore.js:20-22`、`:37-45` | 原样保留 | 强 |
| 按仓库磁盘快照缓存 | 刷新 | 落盘 | `src/host/repoKeys.js:251-260` | 原样保留 | 强 |
| 会话票记忆（`session-tickets.json`） | 会话切换 | 落盘 | `src/host/refresh/sessionTickets.js:24-26` | 原样保留 | 强 |

### 3.6 客户端 RPC 端点（Deck 的第二套对外契约）

Deck 的宿主能力全部经 `harness.handle('wf.*')` 暴露给客户端（`本地源码 src/host/index.js` 多处 + `src/host/*.js`）。共 **55 个** `wf.*` 端点加 1 个 `skill.readDoc`，**合计 56 个注册 RPC**，例如：
`wf.detect`、`wf.chain`、`wf.snapshot`、`wf.deckExec`、`wf.gitStatus`、`wf.gitDiff`、`wf.gitLog`、`wf.gitWriteCheck`、`wf.gitStage`、`wf.gitUnstage`、`wf.gitCommit`、`wf.gitPull`、`wf.gitFetch`、`wf.gitPush`、`wf.refresh`、`wf.focus`、`wf.gateStats`、`wf.issuesPage`、`wf.bind`、`wf.bindings`、`wf.registry`、`wf.selection`、`wf.setupLayout`、`wf.listLabels`、`wf.setLabelColors`、`wf.issueDetail`、`wf.issueComments`、`wf.commentIssue`、`wf.probe`、`wf.handoffLatest`、`wf.handoffResolve`、`wf.naming*`、`wf.log*`、`wf.update*`、`wf.open*`、`wf.pick*`、`wf.retryPush`、`wf.initPublish`、`wf.awaitCreatedIssue` 等（完整清单由 `grep "harness.handle('"` 得到，来源 `src/host/index.js` 与 `src/host/*.js`）。
→ 合并后这 55 条 `wf.*` 加 `skill.readDoc`（共 56 条注册 RPC）**必须原样保留**，否则右栏面板整体失效。

---

## 4. 工具与注册冲突清单（宿主层，七类）

### 4.1 工具名集合

- Resident：17 个名字，全部以 `gh_` 开头（`plugin.js:806-824`）。
- Deck：9 个名字 + `deck_probe`，全部以 `deck_` 开头（`deckToolsRow.js:27`、`:330-346`）。
- 判定证据（三种，互相印证，**作用域仅限跨插件**）：
  1. 协议表：`plugin.js:806-824` 与 `src/shared/deck-tools/plan.js:100-102` + `deckToolsRow.js:27` 逐个核对，无同名。
  2. 结构化核对：运行态观测 `host/Tool.listTools` 中 `gh_*` **17** 个、`deck_*` **10** 个，两个集合交集为空（按名字排序后取交集为空）。这只是「清单里各出现一次」的观测，不证明注册所有权。
  3. 前缀规则：`gh_` 与 `deck_` 前缀不相交，且任一源码都未出现对方的工具名。
- 结论与边界：以上证据只支持「**跨插件**工具名不相交」。它**不能**证明 Deck **内部两条注册通路**（`deckToolsRow.js:319-341` 的行模块与 `wiring.js:309` → `agent-register.js:351` 的宿主钩子）不会对同一批 9 个名字重复注册——两条源码都在调 `ctx.tools.register`。注册所有权必须单独验证（见第 8 节与 9.2 第 4 项）。
- 建议：**保持**。工具名不需要改名；保留全部 27 个工具（17 + 9 + `deck_probe`）。

### 4.2 Host Service / 事件名

| 项 | Resident | Deck | 冲突判定 | 证据 |
|---|---|---|---|---|
| Host Service 键 | `githubResident`（`ctx.provide`，`plugin.js:2067`） | **无**：全仓 `grep "ctx.provide"` 零命中 | 无冲突 | `grep -rn "ctx\.provide" src/` → 0 条 |
| Host 入口注入 | `inject = ['tools']`（`plugin.js:19`） | 主行 `inject: ['connection','llm','sessionQuery']`（`src/host/index.js:10-12`）；工具行 `inject = ['tools']`（`deckToolsRow.js:14`） | 无冲突（都以 `tools` 为前置，属并列声明） | 源码行如上 |
| 事件名 | 无 `ctx.on` 等事件订阅 | 无 `ctx.on`；Deck 走 `harness.handle('wf.*')` 自建分发 | 无冲突 | `grep "ctx.on\|ctx.emit"` 两仓均无（源码） |
| 分发端点命名空间 | Resident 无 | Deck 占 `wf.*` + `skill.readDoc` | 无冲突 | `src/host/index.js` 多处 |

建议：现行三条 Host 行（Resident 1 行 + Deck 2 行）互不冲突，服务键与端点前缀都无需改名。合并后的行数形态见第 5 节：形态 B 下 Resident 入口成为唯一 Host 入口并调用 Deck 的模块化 `apply`，Deck `/tools` 行是否保留取决于 4.1 的注册所有权验证。

### 4.3 HTTP 端点与端口

| 项 | Resident | Deck | 冲突判定 | 证据 |
|---|---|---|---|---|
| 自开回环 HTTP 服务 | 有：`127.0.0.1:31790`（可用 `DSH_GH_API_PORT` 改） | **无**：全仓 `grep "127.0.0.1\|localhost\|createServer"` 零命中 | **无冲突** | `plugin.js:2082-2083,2451-2452,2594`；Deck `grep` 0 条 |
| 对宿主页面 API 的调用 | `http://127.0.0.1:3090/app/open`（拉起浏览器，`plugin.js:1449`） | 无（Deck 不走 3090） | 无冲突 | 源码行如上 |
| 客户端直连端口 | `client.js` 默认 `31790`（`client.js:15-18`） | 无（Deck 客户端只 `host.call('wf.*')`） | 无冲突 | 源码行如上 |
| 服务端端点命名 | `/state`、`/gh/*`、`/protocol`、`/registry*`、`/auth/start`、`/logout` | 无 HTTP | 无冲突 | `plugin.js:1943-1957` |

建议：**保持**。若未来要让 Deck 面板也读插件回环数据，须显式登记进 `PROTOCOL.http.endpoints`，否则 `gh_protocol` 会漏报。

### 4.4 配置 schema 与配置键

| 项 | Resident | Deck | 冲突判定 | 证据 |
|---|---|---|---|---|
| patch `config` | `config: {}`（`cordis.patch.yml:4`） | 两行均 `config: {}`（`package/cordis.patch.yml:11,14`） | 无键冲突（都为空） | 源码行如上 |
| 插件 Config schema | 无 schema：运行态观测 `host/Config.listConfigs` 对 `@local/dsh-github-resident-v2` 只回 1 条 entry，`status: "absent"` | Deck 也不走 Config schema；客户端设置存档落在自管位置（`dsws.cfg`、`dsws.templates`，即浏览器 `localStorage`；`~/.dsh/mattskillsdeck/settings.yaml` 存储模块已实现但**生产未接线**），且**当前设置页已无真正的配置项**（3.4 更正） | 无冲突 | 运行态观测 + `src/client/kernel/config.js:11-31`、`src/shared/config-store/settings.js:3` |
| 配置键来源 | 环境变量 `DSH_GH_*` | 环境变量 `DSH_GH_PATH`（读 gh 路径）、`DSH_*` 探测 | `DSH_GH_PATH` 与 Resident 的 `DSH_GH_*` 前缀相邻但**不重合**（Resident 用 `DSH_GH_REGISTRY_DIR`/`DSH_GH_API_PORT`/`DSH_GH_DATA_DIR`/`DSH_GH_NO_*`） | `src/host/index.js:35`；`plugin.js:164,1136,2082,2598,2608` |

建议：**保持**；但合并文档要显式规定「`DSH_GH_*` 前缀归 Resident，Deck 不得新增同前缀变量」，避免以后撞车。

### 4.5 持久化目录

| Resident | Deck | 是否重叠 | 证据 |
|---|---|---|---|
| `~/.dsh/github-resident.json`（`0600`） | —— | 否 | `plugin.js:22-23` |
| `~/.dsh/github-resident/registry/{repos/,index.json,consent.json}` | —— | 否 | `plugin.js:164-168` |
| `~/.dsh/gh-cli/{bin/gh,install.json,...}` | —— | 否 | `plugin.js:1136-1138` |
| `~/.git-credentials`、`~/.config/gh/hosts.yml` | —— | 否（Deck 不碰） | `plugin.js:24,1135` |
| —— | `~/.dsh/mattskillsdeck/settings.yaml`（存储核已实现，生产**未接线**）、`choices.json`（生产已接线） | 否 | `src/shared/config-store/settings.js:3`、`src/host/choiceStore.js:20-22` |
| —— | `<DSH 进程 cwd>/.dsh-mattskillsdeck-cache/`（logs、naming-guardian.json、session-tickets.json、deck-plans/） | 否 | `src/host/repoKeys.js:258`、`src/host/namingGuardian.js:15`、`src/host/logStore.js:7`、`src/host/tools/deckMapPlanCreate.js:86` |
| —— | 仓库内 `<repo>/docs/agents/{workspace,label-colors}.{yaml,json}`（Deck 配置写） | 否（**作用域不同，不是同一类写**） | `src/shared/config-store/workspace.js:3-4`、`labels.js:5-6`；Resident 的登记不变量 `plugin.js:2013-2019`、`:2026` |

结论：**两个父目录不重叠**（`.dsh/github-resident*` 与 `.dsh/mattskillsdeck`、`.dsh-mattskillsdeck-cache`）。
关于「Deck 会往仓库内写 `docs/agents/*`」与 Resident 承诺的「绝不写进任何仓库」：这是**两条作用域不同的规则，不是冲突**（已解矛盾）：

- Resident 的那句是**操作级不变量**，写在 `PROTOCOL.registry.invariants` 里（`plugin.js:2013-2019`），配套的保证 `guarantees.registryWritesOnlyItsOwnDir` 原文是「**登记过程**不在任何仓库里写文件」（`plugin.js:2026`）。它约束的是 `gh_repo_registry` 的 build/rescan/purge 等登记操作——**不是整个插件的全局无写承诺**。
- Deck 的 `docs/agents/*` 是**配置写**，由 Deck 面板/设置动作触发（工作区布局、标签配色），与登记操作是两回事。

因此合并后**保持该约定即可**，只需在自描述文档里把作用域写准（说「登记操作」而不是笼统的「本插件不写仓库」），不需要改登记行为，也不是必须让人重新拍板的承诺冲突。

### 4.6 npm 依赖与构建体系

| 维度 | Resident | Deck | 冲突判定 | 证据 |
|---|---|---|---|---|
| 运行依赖 | **零**（只用 `node:` 内建） | `package/package.json` 声明 `dsh-plugin-update@^0.13.0`、`yaml@^2.9.1`；根 `package.json` 另有 `dsh-log@^0.2.2`、`ws@^8.22.0` | **不冲突，但体系不同** | `dsh-github-resident/package.json`（无 `dependencies`）；`dsh-mattpocock-skills-deck/package/package.json:25-28`；根 `package.json` 的 `dependencies` |
| 实际 import | —— | `yaml`（`src/host/configStore.js:17`）、`dsh-plugin-update`（`src/host/updateFromPackage.js:18`）；`ws` 在 `src/` 无 import 命中，`dsh-log` 以**派生复制**形式内联在 `src/host/logPkg/` 与客户端产物里 | `ws` 疑为未被 `src/` 使用的声明（源码证据，**未在运行态验证**） | grep 结果：`from 'ws'` 0 条；`src/host/logPkg/config.js:1-4` 注明「派生文件」 |
| 构建体系 | **无构建**：单文件 `plugin.js` + `client.js` 直接发布；`files` 白名单只含手写产物 | **必须有构建**：`main: lib/index.js`、`exports` 指向 `package/lib/*`，`package/lib/` 被 `.gitignore:35` 忽略，靠 `scripts/build.mjs` 生成 | **体系冲突**：合并后必须保留 Deck 的构建链 | `dsh-github-resident/package.json:7-22`；`dsh-mattpocock-skills-deck/package/package.json:13-24`、`.gitignore:33-35`、`scripts/build.mjs:581-612,627-672` |
| 构建期断言 | `verify-*.mjs` 在装完后校验 | `scripts/build.mjs:770-772` 断言 bundled-skills 27 项；`:264-265` 断言 pkg 产物含 `__ModuleLoader__` 特征；`:589` precheck | 合并后两套断言都得留下 | 源码行如上 |
| 测试规模 | 7 个 `verify-*.mjs` + 1 个 `verify-bundle.sh` | `tests/` 327 个 `verify-*` + 6 个 smoke 入口，共 359 个文件、6.6 MB | 合并后**回归面巨大** | `ls tests | wc -l` = 359；`du -sh tests` = 6.6M |
| 包体 | 约 0.2 MB 级（单文件 127 KB + 27 KB client） | 源码树 455 个 `src/` 文件 + 27 个技能 + 构建产物 | 合并后包体会显著变大 | `find src -type f | wc -l` = 455 |

### 4.7 client 侧 `dsh.client.*` 与注入差异

| 项 | Resident | Deck | 冲突判定 | 证据 |
|---|---|---|---|---|
| `dsh.client.platform` | `web` | `web` | 相同 | `dsh-github-resident/package.json:43`；`package/package.json:56` |
| `dsh.client.immediately` | `true` | `true` | 相同 | 同上 |
| 包级 `dsh.client.inject`（**包名图依赖**，值是被依赖的**包名**） | `['@deepseek-ai/dsh-client-ui-settings-general']` | `[]`（Deck 不声明） | **两类 inject 之一**：合并后取并集仍只有 Resident 这一项，保证 `settings.section` 声明方先就位；**不要**把它与下面那行「客户端导出的 inject」合成一组 | `dsh-github-resident/package.json:45-47`；`package/package.json:58` |
| 客户端模块壳（`__ModuleLoader__.load`） | 手写 `load({id:'@local/dsh-github-resident-v2', factory})`（`client.js:9-11`） | 构建生成同形壳，id `dsh-mattpocock-skills-deck`（`scripts/build.mjs:595-605`） | **不能并存**：单包客户端图只注册**包名一项**，宿主按包名建图行、未注册该 id 即判加载失败、重复 id 直接抛错。合并后必须留**一个统一 factory**（内部顺序调用两半 `apply`）；把两个 `load` 拼在一个文件里，Deck 那半注册的旧 id 在图里没有对应行，槽位不会被实例化（依据：02 号证据 §7.1 与 §10 第 4 条） | 源码行如上；02 号证据 §7.1 |
| 客户端导出 `inject`（**服务名**依赖，与包级 inject 是两回事） | `inject: ['slots']`（`client.js:417`） | `exports.inject = ['connection','slots','locale','workspaces','sessions']`（`scripts/build.mjs:603`） | 单一 factory 的导出 inject 取并集 = 5 项（含 `slots`），无冲突 | 源码行如上 |
| 运行时取的服务 | `ctx.slots` | `ctx.get('locale'/'sessions'/'sidebarRight'/'sidebarRightTabs'/'slots'/'timer'/'uiWorkspace'/'workspaces')` | 无冲突（Deck 用的更多）；合并后各半继续用各自取法 | `grep -o "ctx\.get('[a-z]*')" src/client/` 结果 |
| 槽位命名空间 | `settings.section` × 2（`github-resident` 60、`github-repo-registry` 61） | `conversation.input.dock`、`tool.view.cordis`、`settings.plugins.tab`、`settings.section`（`dsws-settings-section` 18）、`sidebar.right.pane.tab(.title)` | 同槽位并存，id 不撞（`settings.section` 出现 3 个不同 id） | `client.js:419-432`；`panelAssembly.js:84-93,121-130` |
| locale 机制 | 包级 `locale/{zh,en}.json` 只含 meta | 自建 `dsws` 命名空间，`L.zh/L.en` 合并 9 个片段 | 两套机制并存，key 不撞 | `locale/zh.json:1-6`；`src/client/kernel/locale.js:11-13` |

建议：**保持**，但 `settings.section` 合并成同一页时，要么只留 Resident 那一条（61）并在页内做分段，要么显式保留 Deck 的独立条目——这是产品决策，见第 6 节。

### 4.8 two patch files 的行 id 与顺序

Resident（`cordis.patch.yml:1-4`）：
```yaml
- insert:
    - id: github-resident-v2
      name: '@local/dsh-github-resident-v2'
      config: {}
```
Deck（`package/cordis.patch.yml:8-14`）：
```yaml
- insert:
    - id: dsh-mattpocock-skills-deck
      name: 'dsh-mattpocock-skills-deck'
      config: {}
    - id: dsh-mattpocock-skills-deck-tools
      name: 'dsh-mattpocock-skills-deck/tools'
      config: {}
```
- id 冲突：无（三个 id 互不相同）。
- 加载顺序：**没有任何显式顺序声明**；两者之间无依赖，谁先谁后不影响功能（Resident 不需要 Deck，Deck 不需要 Resident）。
- 安装侧事实：两者当前**各自独立安装**为 profile 的两个 bundle（**已安装副本/profile 依赖记录**：`/root/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 列表同时含 `dsh-mattpocock-skills-deck` 与 `@local/dsh-github-resident-v2`）。这属于磁盘事实，不说明当前运行里两者都被加载。
- 合并后的行数形态见第 5 节：形态 B 推荐单一 Host 入口（Resident 入口调用 Deck 的模块化 `apply`）；Deck `/tools` 行是否保留由 4.1 的注册所有权验证决定，验证未完成前**默认保留**这一行以规避「工具永不注册」的历史事故。形态 A 则原样保留三行。

---

## 5. 单插件形态比较与推荐

比较口径先统一：**「一个安装运行单元」= 一个 `package.json`/一个 bundle、一次安装、一份 profile 依赖**；行数（Loader 行）是运行时的插件实例数，与安装单元不是一回事。客户端侧另有一条硬约束（02 号证据 §7.1）：**单包客户端图只注册包名一项**，所以三种形态都必须把两半合成**一个统一 Client factory**，不存在「保留两个 `__ModuleLoader__.load`」的选项。

### 5.1 形态 A：单包多内部行（保留三个 Loader 行）

- **做法**：一个 `package.json`，一份 `cordis.patch.yml` 放三行：Resident 1 行 + Deck 主行 + Deck `/tools` 行。Deck 的 `/tools` 行模块机制原样沿用（`exports['./tools']` 指向行模块），Deck 源码树与构建链原样 vendor 进包内。
- **改动面**：`package.json`（`exports` 增 `./tools`、`files` 增 `lib/`+`bundled-skills/`+`shared/`、包级 `dsh.client.inject` 取并集）、`cordis.patch.yml`、新增 Deck 源码树与构建脚本，外加**客户端合成一个统一 factory**（见下）。
- **对工具注册的影响**：三条注册路（Resident `ctx.tools.register`、Deck 行模块、Deck 宿主 `hookDeckAgentTools`）各自独立，跨插件名字无交集（4.1）；但 Deck **内部**两条路是否重复注册仍未证（4.1、8）。
- **对客户端加载的影响**：**不能**让两个 `load` 各自注册——单包只注册包名一项。需由构建生成一个 `load({id: 合并包名, factory})`，factory 内顺序调用 Resident 半与 Deck 半的 `apply(ctx)`，导出 inject 为服务名并集（5 项），Deck 自建的 `host/styles/timer` shim 原样保留（02 号证据 §7.1）。
- **对 Deck `tests/` 与 verify 脚本的冲击**：**不是零冲击，但可控**。Deck 的 327 个 `verify-*` 仍按 `src/` 与 `package/` 路径工作，**纯内部行为与文件布局类断言可复用**；**身份、patch/装配形状、客户端入口类断言仍需随合并形态更新**。另需把 Resident 的 7 个 verify 挂进同一 `package.json` 的 `scripts`（或保留两条聚合命令）。
- **升级难度**：低。Deck 上游更新只需替换 Deck 子树并重跑其构建；Resident 更新只换 `plugin.js`/`client.js`。
- **回滚难度**：低。删掉 Deck 两行即回到 Resident 单插件；Deck 侧文件残留在包里但不加载。
- **与两个上游同步的代价**：低——Deck 子树与 Resident 根文件几乎是两个独立目录，`git subtree`/子模块或脚本同步都可行。
- **是否满足目标**：满足「一个安装单元」；运行时是 3 个插件行，不是严格意义上的「一个插件实例」。

### 5.2 形态 B：单 Host 入口 + 内部模块（推荐）

- **做法**：合并包只有一个 Host 入口（Resident 的 `plugin.js`，或它加一层薄装配）。该入口 `import` Deck 的 **模块化** 宿主代码（`src/host/**`、`src/shared/**` 原样保留为多文件），调用其 `apply(ctx)`；Deck 的工具注册既可由入口装配，也可按验证结果保留 `/tools` 行。
- **关键更正（本轮重点）**：**单 Host 入口 ≠ 把所有代码揉成单文件**。Deck 的实现仍住在其模块里，入口只做装配转调；因此 Deck 的 `tests/verify-no-same-layer-import.js`、`verify-no-cross-import.js`、`verify-strict-module-syntax.js` 等门禁所检查的文件**依然存在**，不会因为「入口合一」而变成空断言或跑不起来。
- **改动面**：`package.json`（`exports` 保留宿主入口与 `./client`，`./tools` 视验证结果）、`files` 白名单、入口处新增转调；Resident 半新增包名/客户端 factory 改写；Deck 的构建链与源码树保留。
- **对工具注册的影响**：入口调用 Deck 宿主 `apply` 后，Deck 的 9 个工厂依赖（闸、后端注册表、额度、会话→句柄、后端 ctx、planStore、invalidate）仍在 Deck 自己的模块里装配，不需要搬进 Resident 闭包（`src/host/platform/deckToolsAssembly.js:1-25` 说明这层装配为什么必须留在平台区）。**必须验证的仍是注册所有权**（4.1）：`deckToolsRow.js:319-341` 与 `wiring.js:309` → `agent-register.js:351` 都在调 `ctx.tools.register`，哪条真正生效/是否去重未证。验证前**默认保留 `/tools` 行**，以规避「工具永不注册」的历史事故（`src/host/index.js:13-15` 启动门注释、`agent-register.js:393-434` 的重试上限）。
- **入口的 Host 级 `inject` 需取并集**：Resident `['tools']`（`plugin.js:19`）+ Deck `['connection','llm','sessionQuery']`（`src/host/index.js:10-12`）。Deck 宿主内有启动门与 `ctx.get` 降级路径（`src/host/index.js:6-15`），服务不齐时部分能力静默降级，因此并集声明是合并入口的必要条件。该并集的实际就绪顺序**未在运行态验证**。
- **对客户端加载的影响**：与形态 A 相同——一个统一 factory 内部调用两半；不能靠拼接两个 `load`（02 号证据 §7.1）。Deck 半继续走它自己的 `scripts/build.mjs` 生成物与方言 shim，Resident 半是手写单文件，两半通过同一个 factory 组装。
- **对 Deck `tests/` 与 verify 脚本的冲击**：**小且局部，但不是零**。纯内部行为与 `src/**` 文件内容类断言可复用；需要**逐一检查**的是断言「patch 行形状 / `./tools` 行存在 / 两行 id / 身份串 / 客户端入口」的门禁（例如 `tests/verify-build-artifacts.js`、`tests/verify-deck-tools-row-zero-dep.js`、`tests/verify-deck-tools-host-wiring.js`）——这是待核清单，不是已证会坏（只有保留 `/tools` 行时其中一部分才可能需要同步）。
- **升级难度**：低到中。Deck 子树替换 + 重跑构建不变；新增的只是入口转调层的维护。
- **回滚难度**：中。入口恢复为不转调、移除 Deck 子树。
- **与两个上游同步的代价**：中——入口是 Resident 的，转调层需要长期维护；Deck 上游可合并性保留（源码未内联）。
- **是否满足目标**：满足「一个安装单元」，且 Host 运行时只有**一个入口**，最贴近「以一个插件运行」。前提是注册所有权验证通过；若不通过则退化为「单包 + 单入口 + 保留 1 行 `/tools`」，仍是单包单入口，只是多一个工具行。

### 5.3 形态 C：依赖旧独立包（Resident 依赖已发布的 Deck 包）

- **做法**：Resident 的 `package.json` 把 Deck 作为 dependency，profile 里仍是**两个 bundle**（Deck 依旧独立安装），入口转调 Deck 导出。
- **不满足目标**：安装/运行单元仍是两个（两个 bundle、两份 profile 依赖、两个客户端脚本要各注册自己的包名）。宿主当前 `dsh.client` 元数据只描述一个 `platform/immediately/inject`，未声明一个插件挂两个客户端脚本（`dsh-github-resident/package.json:42-48`、`package/package.json:55-59`）——**该能力的实际行为未验证**，但它已足以说明形态 C 与「一个安装运行单元」相悖。
- **其它代价**：Deck 的 `package/lib/` 是构建产物且被 `.gitignore:35` 忽略，作为 dependency 安装要靠 `prepare` 或随包发布，链路更长；升级依赖 npm 发布节奏与 `dsh-plugin-update` 路径。
- **对 Deck `tests/` 的冲击**：小（Deck 目录原样），但新增一层「外壳转调」正确性验证。
- **结论**：**不推荐**——它保留了「两个包/两个 bundle」，与用户「以 Resident 为主体合并成一个插件」的目标方向相反。

### 5.4 三形态对照表

| 维度 | A 单包多内部行 | B 单 Host 入口 + 内部模块 | C 依赖旧独立包 |
|---|---|---|---|
| 安装单元 | 1 个包 / 1 个 bundle | 1 个包 / 1 个 bundle | 2 个包 / 2 个 bundle（不达标） |
| 运行时 Host 行 | 3 行（同一 bundle 内） | 1 行入口（`/tools` 行视注册所有权验证，默认暂留则 2 行） | 2 个 bundle 内各自保留（至少 3 行） |
| 改动文件数 | 少（元数据 + Deck 子树 + 客户端 factory） | 中（元数据 + 入口转调 + 客户端 factory） | 中（元数据 + 转调 + 依赖链） |
| 工具注册风险 | 跨插件无冲突；Deck 内部是否重复注册仍未证（4.1） | 同左；且入口合一后更依赖「宿主注册路」为主，须先验证所有权 | 同左；仍保留两条独立通路 |
| 客户端加载 | 必须合成 1 个统一 factory | 必须合成 1 个统一 factory | 需宿主支持 2 个客户端脚本（未验证） |
| Deck tests 冲击 | 内部行为断言可复用；身份/patch 形状/装配/客户端入口类仍需更新 | 内部行为断言可复用；少数 patch 形状与身份/入口断言待核 | 内部行为断言可复用；新增转调正确性门禁 |
| 升级难度 | 低 | 低到中 | 中（依赖发布节奏） |
| 回滚难度 | 低 | 中 | 中 |
| 与上游同步代价 | 低 | 中（维护入口转调层） | 中 |
| 是否「一个插件实例」 | 否（3 行） | 是（1 入口） | 否（2 bundle 各自运行） |

### 5.5 推荐

**推荐形态 B（单 Host 入口 + 内部模块）**：它同时满足「以 Resident 为主体」「一个安装运行单元」「一个 Host 运行时入口」，并且**不要求把 Deck 的模块化实现内联**——Deck 的源码树、构建链与绝大多数测试原样保留。

**回退规则（都仍满足一个安装单元）**：
- 若注册所有权验证表明**宿主注册路无法单独保证 9 个工具全部注册**：在 B 的基础上保留 `/tools` 行（Resident 单一入口 + 1 行工具行，Deck 主行不存在，由入口转调）；这仍是一个包、一个 Host 入口，只是多一个工具行。
- 若还要最大化降低改动风险、且接受运行时 3 个插件行：退到形态 A（Resident 行 + Deck 主行 + `/tools` 行同在一个包）。

**形态 C 不推荐**（两个 bundle，与目标相悖）。

**前提条件**（按优先级）：

1. **身份链对齐**：合并后 `package.json` 必须同时满足 Resident 的 `verify-bundle.sh` 三处一致检查（pkg.name / patch.name / client id，[`verify-bundle.sh:23-40`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/verify-bundle.sh#L23-L40)）与 Deck 构建的 pkg 产物 `__ModuleLoader__` 特征（[`scripts/build.mjs:264-265`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/scripts/build.mjs#L264-L265)）。两处 id 目前不同（`@local/dsh-github-resident-v2` 对 `dsh-mattpocock-skills-deck`），必须统一改名或同步放宽检查。
2. **一个统一 Client factory**（按 02 号证据 §7.1）：只保留一个 `load({id: 合并包名})`，内部顺序调用两半 `apply`；把两个旧 `load` 拼在一起**不会**两半都生效。
3. **两套 inject 分开处理**：包级 `dsh.client.inject`（包名图依赖）取并集后仍只有 Resident 的 `@deepseek-ai/dsh-client-ui-settings-general`（Deck 为 `[]`）；客户端导出 `inject`（服务名）取并集为 `['connection','slots','locale','workspaces','sessions']`。**不要把两者合成一组**。合并 Host 入口的 Host 级 `inject` 另取并集：`['tools','connection','llm','sessionQuery']`（[`plugin.js:19`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/plugin.js#L19)、[`src/host/index.js:10-12`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/index.js#L10-L12)）。
4. **注册所有权验证**（合并前必须先回答）：Deck 内部两条通路（[`deckToolsRow.js:319-341`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/platform/deckToolsRow.js#L319-L341) 与 [`wiring.js:309`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/host/refresh/wiring.js#L309) → [`agent-register.js:351`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/shared/deck-tools/agent-register.js#L351)）谁在生效、是否去重；这直接决定 `/tools` 行去留（4.1、8、9.2）。
5. **`files` 白名单**必须把 Deck 的 `lib/`、`shared/`、`bundled-skills/`、`scripts/` 加进去（[`package/package.json:29-36`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/package/package.json#L29-L36)），否则装出来的包没有右栏与技能（27 个技能随包）。
6. **自描述文档措辞按作用域写准**：「登记操作不写仓库」保持为登记操作级不变量（[`plugin.js:2013-2019`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/plugin.js#L2013-L2019)、[`:2026`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/plugin.js#L2026)），不要写成整个插件的全局无写承诺；Deck 的 `docs/agents/*` 配置写由 Deck 动作触发（4.5）。这不是需要重新拍板的冲突。

---

## 6. 合并后设置页的落点（与用户要求的映射）

用户要求：「把 Deck 设置页合并进 Resident 设置页的仓库登记页」。

| 现状 | 合并后建议 | 依据 | 风险 |
|---|---|---|---|
| Resident「仓库登记库」页：`settings.section` id `github-repo-registry`、order 61（`client.js:427-432`） | 作为宿主页容器，页内分成「仓库登记库」与「Deck 设置」两段 | 用户的直接要求 | 该页现有文案纪律是「只说登记库许可，不说未授权/已授权」（`client.js:425-426` 注释）；Deck 设置项的措辞必须与之区分，否则用户会误以为账号掉线 |
| Deck `settings.plugins.tab`（id `dsws-settings`，order 40，`panelAssembly.js:86-88`） | 建议**保留**（插件页入口是宿主给插件配置的标准落点），但其内容改为跳转/嵌入同一组件 | 设置页的双入口是 Deck 既有产品决定（`panelAssembly.js:89` 注释） | 若同时删掉，用户在「设置 → 插件」里找不到 Deck 配置，与宿主习惯不符 |
| Deck `settings.section`（id `dsws-settings-section`，order 18，`panelAssembly.js:89-93`） | **合并进 `github-repo-registry` 页后退役**（或改 id 后并入同页分段） | 用户明确要求「合并进仓库登记页」 | 退役会改变左栏条目数，需要同步改 `verify-ui.mjs` 的期望与 Deck 侧相关门禁（`tests/verify-496b-inject-guard.js` 一类） |
| Resident 页 1「GitHub」id `github-resident` order 60（`client.js:419-424`） | 不动 | —— | —— |

要搬的内容以 3.4 为准：**只有 4 类**——只读工作区后端总览、诊断日志开关与四个日志动作、标题行与更新入口、星标/反馈/作者插件外链。设置页没有配置表单，故「合并」是搬家与分区，不是迁移配置项。

---

## 7. 证据强度与不足（自评）

- **强**：所有带「源码路径:行号」且本次直接读到该行的断言；`SettingsPage.js` 的内容清单已在 02 号证据 §3.2 逐行核实，不再是「只确认存在」。
- **中**：只确认了文件存在/注册点，未逐行读其全部行为（如状态栏胶囊、`capFold` 折叠机的完整行为）。
- **弱/未证**：任何「宿主在合并形态下的实际行为」判断（如单一 Client factory 内两半 `apply` 的就绪顺序、`Slots` 查询能否返回占用者而不是拓扑）——这些属于运行态事实，本次**没有做安装/启停，故一律未验证**。
- 已可确认、不再列为未证的一点：**单包客户端图只注册包名一项**、两个 `__ModuleLoader__.load` 不能拼接并存，来自宿主框架源码（02 号证据 §7.1 引 `dsh-client-modules/lib/client.js:569-575,625`），属于源码级契约，不需要安装来确认。
- 本文件**没有**把任何源码推断写成实机验证；磁盘事实一律称「已安装副本」，`Tool.listTools` 的结论一律限定为「清单可见，非执行成功」。

---

## 8. 本次未能验证的事项与原因

| 未验证事项 | 原因 | 影响 |
|---|---|---|
| 合并后**单一 Client factory** 内部顺序调用两半 `apply` 的真实表现（服务注入就绪顺序、Deck 的 `host/styles/timer` shim 在新壳里是否照常、`settings.section` 注册是否都发生） | 需要安装/启停插件并看页面（禁止副作用）。已排除的选项：直接拼两个 `__ModuleLoader__.load`（宿主按包名建图行，旧 id 无对应行即失败，02 号证据 §7.1） | 形态 A/B 都必须走「一个 factory 内部拼装」，验收时要看这层拼装是否让两半都真的注册 |
| 包级 `dsh.client.inject`（包名图依赖，合并后仍为 Resident 的 1 项）与客户端导出 `inject`（服务名并集 5 项）在合并包里的共存与解析行为 | 需要安装/启停；本次只按宿主契约与两仓 manifest 推断二者是两种不同声明 | 只要不把两套 inject 混成一组，风险面很小；仍建议在验收里分别读 manifest 与产物 |
| Deck 设置页并入 Resident 登记页后的真实渲染（左侧栏条目数、样式一致性、明暗主题） | 需要浏览器控制与安装后的页面 | 第 6 节的落点是设计建议，不是实机结论 |
| `ws@^8.22.0` 在 Deck 中的真实用途 | 需要读构建产物与运行态；`src/` 中 0 条 import | 合并后依赖清单纯净度（可能是可删声明）——**源码推断，未在运行态验证** |
| Deck 已安装副本 1.7.51 与本地 1.8.0-rc.7 的完整差异 | 需要逐个 `lib/` 产物与 `src/` 对比（本次只抽样对比了 `deck_issue_get`/`deck_map_snapshot` 的参数） | 任何「按本地源码写的合并方案」在真机上可能对不上（这是 Deck 特有的风险） |
| 合并后 `gh_repo_registry` 的授权流程与 Deck 的写操作是否会产生「一次同意覆盖两次写」的语义混淆 | 需要实机走一遍授权流程 | 合并文档需明确两套写许可的边界；注意 Resident 的登记不变量是**操作级**，不覆盖 Deck 的配置写（4.5） |
| **Deck 的注册所有权**：`hookDeckAgentTools`（`wiring.js:309` → `agent-register.js:351`）与 `/tools` 行模块（`deckToolsRow.js:319-341`）都会对同一批 9 个名字调 `ctx.tools.register`，谁生效/是否去重 | 需要实机观察注册表（禁止安装/启停）。源码里 `agent-register.js:359` 有 `already-registered` 这一 reason 分支，说明作者考虑过重复；但**不能据此断定**当前是它在去重 | **这是合并前必须回答的问题**。它决定形态 B 是否必须保留 `/tools` 行（4.1、5.2、9.2）。注意：「`gh_*`/`deck_*` 无同名」只证明跨插件不撞，对这个问题**没有证明力** |
| 上游远端是否有比本地更新的提交 | 已用 `ls-remote` 核对：两仓 HEAD 与本地相同（网络可用） | 无 |

---

## 9. 未来验收方案（只写方案，本次不执行）

以下条目**全部未执行**，留给实现阶段的验收清单：

> **隔离环境要求（只写要求）**：用单独的测试容器/环境或明确注入的临时存储，配测试 gh 配置/凭据、独立回环端口与独立登记目录；不得落到真实用户全局 Git/gh 配置或现有 `31790` 服务，**即使只 dry-run 也不以真实凭据文件作测试夹具**。示例一律用测试 profile 占位名。

**9.1 打包与安装（须人批准后执行）**
1. 记录起始状态：`git -C 两个检出 status --porcelain`、`dsh --profile <测试 profile> --dump-config` 输出（只读）。
2. 安装合并包后，用 `cordis_inspect_query`：
   - `host/Tool.listTools` 断言 `gh_*` 数量 = 17、`deck_*` 数量 = 10（含 `deck_probe`），且交集为空。**注意这只是清单可见性**，第 6 步另做调用验证。
   - `host/Config.listConfigs(name=合并包名)` 断言 entry 数与 `status`。
3. **客户端身份形态**：读合并后的 `package.json` 与客户端产物，断言只有**一个** `__ModuleLoader__.load`，其 `id` 等于合并包名；客户端导出 `inject` 为 5 个服务名；包级 `dsh.client.inject` 仍只含 `@deepseek-ai/dsh-client-ui-settings-general`（**不要**把它与那 5 个服务名混为一组）。
4. **槽位占用**：核对 `settings.section` 的条目（`github-resident`、`github-repo-registry`，以及 Deck 条目去留符合第 6 节决定）、`sidebar.right.pane.tab` 的 Deck tab 仍注册。**方法注意**：本次拿到的 `Slots.listSubTree` 输出是**槽位声明拓扑**，不含占用者；验收时须确认所用查询/页面观察能返回**实际占用集合**，否则改用页面核对。
5. 明暗主题各看一次设置页合并后的版式（视觉验证必须由人眼确认，不用自造渲染器替代）。

**9.2 功能回归（须人批准后执行）**
6. 真调一次：对 `gh_protocol` 与任一 `deck_*` 工具各发一次调用，确认返回成功信封（**可见性 ≠ 执行成功**，这一步才验证「工具能用」）。
7. 跑 Resident 7 个 verify：`bash verify-bundle.sh && node verify-logout.mjs && node verify-registry.mjs && node verify-ui.mjs && node verify-gh-bootstrap.mjs && node verify-update-gc.mjs && node verify-real-artifact.mjs`（注意 `verify-gh-bootstrap.mjs` 会造临时 HOME 与假 release 端点，属于脚本自身设计）。
8. 跑 Deck 的聚合：`node scripts/verify-chain.js` + `npm run test:smoke` + `npm run verify`（327 项）；若形态 B 保留了 `/tools` 行，另需确认 `tests/verify-build-artifacts.js`、`verify-deck-tools-row-zero-dep.js`、`verify-deck-tools-host-wiring.js` 的期望仍成立。
9. 单独确认**注册所有权**：在安装态下只启用 Deck `/tools` 行、再只启用宿主注册路，分别观察 `deck_*`（9 个）是否各注册一次、有无重复或缺失（第 8 节未决问题）。

**9.3 回滚**
10. 记录安装前的 profile 依赖与 bundles 列表，回滚时对照还原；确认回滚后 `gh_*` 与 `deck_*` 恢复为合并前状态。

---

## 10. 关键结论摘要（3–5 条）

1. **跨插件工具面无冲突，但这只覆盖「名字」**：`gh_*`（17）与 `deck_*`（10，含探针）名字零交集，Host Service 只有 Resident 提供（`githubResident`，[`plugin.js:2067`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/plugin.js#L2067)），HTTP 回环只有 Resident 提供（31790，[`plugin.js:2082-2083`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/plugin.js#L2082-L2083)），配置键都为空。**合并的全部 27 个工具保留**（`deck_probe` 一并保留，其维护注释不构成本次删除授权）。名字不相交**不能**证明 Deck 内部两条注册通路不会重复注册——注册所有权是合并前必须先回答的问题（4.1、8）。
2. **推荐形态 B（单 Host 入口 + 内部模块）**：Resident 入口调用 Deck 的模块化 `apply`，Deck 源码树与构建链保留，因此 Deck 的 `src/**` 内部行为类门禁可复用；**身份、patch/装配形状与客户端入口类断言仍需随形态更新**。**单 Host 入口不等于揉成单文件，也不必然毁掉测试**。形态 A（单包三行）作为回退；形态 C（依赖旧独立包）不推荐，因为它仍是两个 bundle（5 节）。
3. **客户端必须合成一个统一 factory**：单包客户端图只注册包名一项，两个旧 `__ModuleLoader__.load` 不能拼接并期望两半都生效（02 号证据 §7.1）。同时要分清**包级 `dsh.client.inject`（包名图依赖，合并后仍只有 Resident 的 1 项）**与**客户端导出 `inject`（服务名并集 5 项）**，不可混成一组（4.7、5.5）。
4. **Deck 的本地源码 ≠ 已安装副本**：本地 `1.8.0-rc.7` vs 已安装副本 `1.7.51`，`deck_issue_get`/`deck_map_snapshot` 在工具清单观测里比源码少 `blocking`/`detail` 参数；Resident 则三文件逐字节相同。做合并方案时不能拿 Deck 本地源码当已加载行为（1.1、3.1 注）。另：`Tool.listTools` 可见性只代表清单里出现，**不代表调用成功**。
5. **「登记不写仓库」保持即可，无需重新拍板**：它是 `gh_repo_registry` 的**操作级**不变量（[`plugin.js:2013-2019`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/plugin.js#L2013-L2019)、[`:2026`](https://github.com/SunsetRNE/dsh-github-resident/blob/54a1a07/plugin.js#L2026)），与 Deck 写 `docs/agents/*` 配置（[`workspace.js:3-4`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/shared/config-store/workspace.js#L3-L4)、[`labels.js:5-6`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/3b25cd3f/src/shared/config-store/labels.js#L5-L6)）作用域不同、不冲突；合并文档只需把作用域写准，不要把登记级承诺写成整个插件的全局无写承诺（4.5、5.5）。

---

*本文件的唯一写入范围是 `/root/dsh-github-resident/dsh-github-resident/docs/merge-deck-evidence/01-feature-matrix-and-form.md`；未修改任何代码、manifest、构建产物、运行配置或凭据，未安装/启停插件，未执行迁移，未创建或修改 issue，未 commit/push。*
