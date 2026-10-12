# 合并实施进度

> **最新接续：2026-10-12**。已生成 1.7.0 本地合并试装包，16 组合并检查、62 项界面交互及 6 项 Deck 冒烟通过。Deck 全量链因缺 Chromium 中止，未宣称全量通过；未安装到当前 profile。详见 [本轮交付核查](./merge-delivery-2026-10-12.md)。下文 M0 为历史阶段记录，不代表当前完成状态。

> 更新纪律：**每完成一个重要里程碑就追加/改写一次**，只写「实际做了什么、用什么命令验的、结果是什么、
> 还差什么」。不写「进行中」「基本完成」这类没有判据的状态。空壳一律写进「未完成项」，不许计入完成。

---

## 里程碑 M0 —— 阶段一（骨架 + 可执行分工）· 2026-10-11 UTC

### 基线

| 项 | 值 |
|---|---|
| 主体仓 | `/root/dsh-github-resident/dsh-github-resident` |
| `main` HEAD | `54a1a07d233e23037b847d3ac407b33851fe7284`（`feat: v1.6.4 — 仓库登记文件库 / 自带 gh 落地 / 两轮审计修复`） |
| 合并分支 | `feat/merge-skills-deck`，**创建时 HEAD 与 `main` 相同**（`54a1a07`），未覆盖任何既有分支（创建前 `git branch --list feat/merge-skills-deck` 为空） |
| 原有未跟踪内容 | `docs/`（4 个评估 Markdown）在分支切换前后**状态不变**，未被提交、未被移动 |
| 参考源仓 | `/root/dsh-github-resident/dsh-mattpocock-skills-deck`，HEAD `3b25cd3f`，快照前后**未做任何写入** |
| 运行时 | Node `v24.19.0`、pnpm `10.34.5`（`/root/dsh-bin/pnpm`） |
| 远端 | **未 pull、未 fetch、未 push**。设计基线保持 `3b25cd3f` |

### 本阶段实际写入的文件

**新建**

| 路径 | 内容 |
|---|---|
| [`deck/`](../deck/) | Deck 源码快照，1406 个文件 / 25 MB。来源、排除项与布局理由逐条写在 [`deck/IMPORTED-FROM.md`](../deck/IMPORTED-FROM.md) |
| [`deck/IMPORTED-FROM.md`](../deck/IMPORTED-FROM.md) | 导入来源、排除清单、许可署名、`deck/package.json` 为何不改名、危险脚本禁令 |
| [`tools/merge/merge-identity.ts`](../tools/merge/merge-identity.ts) | 身份与三层 inject 的**单一真源**常量 + `RewriteResult` 类型 |
| [`tools/merge/host-assembly.ts`](../tools/merge/host-assembly.ts) | 宿主入口装配层（具名导出 + default 对象，`inject` 取并集，顺序调用两半） |
| [`tools/merge/rewrite-deck-client.ts`](../tools/merge/rewrite-deck-client.ts) | 把 deck 客户端产物改写成合并包客户端的模块（两个锚点，各要求唯一） |
| [`tools/merge/build-merge-entries.ts`](../tools/merge/build-merge-entries.ts) | 入口产物构建/校验脚本（`--build-all` / `--check`） |
| [`docs/merge-implementation-plan.md`](./merge-implementation-plan.md) | 实施计划：基线实测、冻结接口、3 个并行任务、隔离检查、DoD |
| `docs/merge-implementation-progress.md` | 本文件 |

**修改**

| 路径 | 改动 |
|---|---|
| [`package.json`](../package.json) | 合并包清单：`exports` 增 `./tools`、`./deck`，`"."`→`./dist/host.js`，`"./client"`→`./dist/client.js`；`files` 加入 `dist/` 与 `deck/**` 白名单；`scripts` 改为 `build` / `build:deck` / `build:entries` / `check:entries` / `verify:{resident,deck,deck:smoke}`；合并 `dependencies`（`dsh-log` / `dsh-plugin-update` / `yaml` / `ws`）与 `devDependencies`；`engines.node>=22`；`meta` 与 `description` 更新为合并口径。**`name` 与 `private: true` 未变** |
| [`cordis.patch.yml`](../cordis.patch.yml) | 增第二行 `@local/dsh-github-resident-v2/tools`（`/tools` 行默认暂留），并把「为什么保留、为什么子路径行不会产生第二个客户端」写进注释 |
| [`.gitignore`](../.gitignore) | 增 `dist/`、`deck/package/{lib,shared,scripts}`、`deck/client.js`、`deck/host.js`、`deck/.tmp/`、`deck/scripts/generated/updateEntryPanel.bundle.js`（构建产物一律不入库） |

### 本阶段用真实命令验过的事

| 检查 | 命令 | 结果 |
|---|---|---|
| 分支基线一致 | `git rev-parse HEAD` | 创建分支前后均为 `54a1a07d…` |
| 4 份评估文档未受影响 | `git status --porcelain=v1` | 仍为 `?? docs/`（未跟踪，未提交） |
| 清单 JSON 合法 | `node -e "JSON.parse(...)"` | `package.json OK` |
| 身份三处一致（两处已就位，第三处待构建） | 解析 `package.json` + `cordis.patch.yml` | `pkg.name` = patch 主行 `name` = `@local/dsh-github-resident-v2`；行名为 `…-v2/tools` |
| 三个新 `.ts` 语法 | `node --check tools/merge/*.ts` | 全部通过 |
| 客户端改写对**真实 deck 产物**有效 | `node --input-type=module -e "..."`（import `rewrite-deck-client.ts`，喂 `/root/.dsh/plugin-src/dsh-mattpocock-skills-deck/lib/client.js`（已安装的构建产物）） | `id` 与 `inject` 各替换 1 处；2 128 355 → 2 128 358 字节；合并 id 就位、`dock id` 保留、旧模块 id 消失 |
| 客户端改写负例 | 同上，三个构造输入 | 全部按预期抛错：load 出现 2 次 / id 锚点缺失 / inject 锚点缺失 |
| 客户端 inject 并集**今天是否真的变了** | 比对 `MERGED_CLIENT_INJECT` 与 `DECK_INJECT_ANCHOR` | **逐字相同**：deck 自己就是这 5 项，Resident 客户端只用 `ctx.slots`（`client.js` 里 `ctx.*` 只出现 `ctx.slots`）。所以 inject 那一步目前是**恒等替换**，只起契约核对作用，**挡不住**「Resident 新增服务依赖却没并进常量」的漂移——已列为任务 B 的一条门禁 |
| deck 门禁可离线启动 | `timeout 240 node deck/scripts/verify-chain.js` | 无 `node_modules` 下跑到第 2 条 `verify-prompt-newlines.js` 因缺 `client.js` 与 `package/lib/client.js` 而红（`exit 1`）。**这不是回归，是构建产物还没生成** |
| 27 工具清单基线（当前双插件运行态） | `host/Tool.listTools` | `gh_*` 17、`deck_*` 10（含 `deck_probe`），交集空，共 27 |
| 合并包入口尚未生效 | `host/Config.listConfigs(name='dsh-mattpocock-skills-deck')` | 仍只有旧 Deck entry（`status: absent`）；**本阶段未安装、未启停任何插件** |

### 未完成项（空壳，**不得当成已完成**）

1. **`dist/host.js` 与 `dist/client.js` 不存在**。要跑 `npm run build`（先 `pnpm install`）才出现；两个文件已 gitignore。
2. **宿主落地一处未改**：`deck/src/host/**` 仍是原样快照（身份串、7 处技能候选根、`UPDATE_PLUGIN_ID`、`MANIFEST_NAME`、行模块 `name` 全未动）。
3. **客户端落地一处未改**：`deck/src/client/**` 仍是原样快照（未删 `dsws-settings-section`、未合页、3 个错名主题 token 未改）。
4. **`deck/package/lib/**` 等构建产物不存在**（原仓也 gitignore）。
5. **`tests/merge/` 契约测试不存在**，属后续任务的交付物。
6. **两套门禁从未在合并形态下跑过**，一次都没有。
7. **本仓自己的 `pnpm-lock.yaml` 不存在**：首次安装前构建不可复现。
8. **隔离 profile 的互斥激活验证、真机渲染、深浅色、双语混排、浮层 z-index、31790 占用情况**：全部未做。
9. **`deck/package.json` 的 `prepare` 仍指 deck 构建**：安装依赖会自动触发 deck 构建（刻意保留，但安装前必须知情且有 `esbuild`）。

### 下一步门禁（进入下一阶段必须同时满足）

| # | 门禁 | 判据 |
|---|---|---|
| G1 | 依赖可装且可复现 | `pnpm install` 成功，生成并提交本仓 `pnpm-lock.yaml`；安装副作用（`prepare`→deck 构建）已在日志里可见 |
| G2 | 两个入口产物可生成 | `npm run build:deck && npm run build:entries` 退出码 0，`dist/host.js` 与 `dist/client.js` 出现 |
| G3 | 产物与重算一致 | `npm run check:entries` 打印「全部一致」，退出码 0 |
| G4 | 宿主入口形状 | `import('./dist/host.js')` 得到 `{ name, inject, apply }`，`name==='@local/dsh-github-resident-v2'`，`inject` 逐项等于 `MERGED_HOST_INJECT` |
| G5 | 客户端形状 | `dist/client.js` 里 `load({id})` 的 id 等于包名；同一文件仍含 `id: 'dsh-mattpocock-skills-deck', order: 40`（dock 槽位） |
| G6 | deck 门禁在合并形态下全绿 | `npm run verify:deck` 退出码 0（237 条） |
| G7 | Resident 门禁全绿 | `npm run verify:resident` 退出码 0（**必须在隔离 HOME + 独立端口下跑**；`verify-bundle.sh` 要显式传参） |
| G8 | 三个并行任务全部完成 | 各自 writeScope 内门禁绿、共享入口文件以补丁片段交出、未触碰冻结接口 |
| G9 | 集成人收尾 | 按计划 2.5 顺序写共享入口文件，每次写完重跑 G3；`dist/` 变更与新入口一起提交 |

### 已知风险（按严重度）

1. **`deck/src/host/updateFromPackage.js` 的 `UPDATE_PLUGIN_ID` 改成 scoped 名后的行为未验证**：
   `dsh-plugin-update` 是否支持 scoped 包名（registry 请求路径 `@scope/name`）没查。**当前决策是不承诺
   npm 自更新可在这条路上工作**，更新入口必须如实说明本包是本地 private 包。这条是「更新入口不能装回旧 Deck」的直接相关项。
2. **`deck/package.json` 保留旧包名是有意的，但会让读者以为本包还没改名**：已在
   [`deck/IMPORTED-FROM.md`](../deck/IMPORTED-FROM.md) §4.1 写明判据。
3. **`deck/` 与根 `package.json` 同时声明了一份 `dsh` 字段**：`deck/package.json` 的 `dsh.bundle.patch` 指向
   `./package/cordis.patch.yml`。deck 不在 profile 的 `node_modules` 顶层，不会被当作可安装包扫描，
   但集成时要以「宿主只读根清单」实测确认，不能只靠推断。
4. **25 MB 快照让仓库体积显著变大**：换来的是门禁与构建可复现。若后续确认某棵子树（如 `docs/` 156 个文件、
   `assets/` 41 个）无人读取，可单独立项瘦身，本阶段不为省体积删文件。
5. **`deck/.gitattributes` 已随快照带入**：它管的是 `deck/**` 内的换行符，不影响本仓根文件。已核实无冲突。

### 本阶段明确没做的事

未安装、未启停任何插件；未改 profile（`/root/.dsh/profiles/web/**`）与 DSH 安装；
未碰真实凭据 / registry / choices；未写外部 issue；未推送、未发布；未删除或移动任何用户原文件；
未执行任何带网络副作用的脚本；未 commit（4 份评估文档仍是未跟踪状态，交由后续阶段决定是否入库）。
