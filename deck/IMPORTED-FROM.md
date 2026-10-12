# deck/ —— 导入来源与边界声明

本目录是 `dsh-mattpocock-skills-deck` 的**一次性源码快照**，供合并包
`@local/dsh-github-resident-v2` 在内部复用。它不是子模块、不是 fork、不是上游镜像，
**不要**把上游提交直接合进这里；后续同步由人显式选取提交并重做本快照。

## 1. 来源（逐字，取自本机检出，未联网）

| 项 | 值 |
|---|---|
| 仓库 | `FeatherHunter/dsh-mattpocock-skills-deck` |
| 本机检出 | `/root/dsh-github-resident/dsh-mattpocock-skills-deck`（只读保留，未被本仓修改） |
| 快照时 HEAD | `3b25cd3f`（分支 `main`，工作树干净） |
| 包版本 | `1.8.0-rc.7`（见 [package/package.json](./package/package.json)） |
| 快照时间 | 2026-10-11（UTC） |
| 快照方式 | `tar` 目录树拷贝（**不含** `.git`，因此本目录没有独立历史） |

选择 `3b25cd3f` 而不是当时的 `origin/main`（`21f3ca1d`）：`3b25cd3f` 是评估阶段
冻结的**设计基线**，本次不 pull 最新上游、不换基线（见
[../docs/merge-deck-assessment-2026-10-11.md](../docs/merge-deck-assessment-2026-10-11.md) §1.1）。

## 2. 为什么整棵仓库树搬进 `deck/`，而不是揉进本仓根

Deck 有 **4 个构建期核心源码树**挂在仓库根，不在 `src/` 下：
`label-color-core/`、`refresh-core/`、`version-control-core/`、`config-store-core/`。
[scripts/build.mjs](./scripts/build.mjs) 的根是 `resolve(dirname(build.mjs), '..')`，
即「`scripts/` 的上一级」。整棵仓库树原样放在 `deck/` 下之后：

- `deck/scripts/build.mjs` 的 `ROOT` 仍然等于 `deck/`，**四个 `../*-core/build.mjs` 全部命中**；
- `build.mjs` 内部读写的每一条相对路径（`src/…`、`package/…`、`tests/…`）**一个都不用改**；
- 源文件之间的相对动态 `import('./x.js')`（`src/host/index.js` 里有 66 处）在
  `deck/package/lib/` 里靠「`src/host` 整树原样复制」保持，路径长短与原文一致。

把 `src/` 单独提到本仓根会让上面三条同时失效（迁移脚本、58 处构建路径、门禁文本断言），
收益只是少一层目录。**本阶段不做这种「为了好看改布局」的重写。**

## 3. 有意排除的内容（逐条给理由）

| 排除 | 理由 |
|---|---|
| `.git/` | 宿主仓只要一份历史；子仓历史可回源仓取 |
| `.github/` | 上游 issue 模板 / CI 工作流，对本包无效 |
| `node_modules/` | 依赖由本包 `package.json` 统一声明 |
| `.local/`、`.scratch/`、`.tmp*`、`logs/`、`.dsh-*-cache/`、`.dsh-vision-router/` | 本地调测产物与缓存，不得进仓 |
| `docs/prototype/`（114 MB） | 开发期截图与原型 HTML，对实现无用；其余 `docs/`（架构/设计/ADR/release 模板）保留，源注释大量引用 |
| `package/lib/`、`package/shared/`、`package/scripts/` | **构建产物**，由 `deck/scripts/build.mjs` 现场重新生成（原仓亦 gitignore） |
| `package/package-lock.json` | 与本包使用的 pnpm 无关，避免第二套锁 |
| `.env`、`.wizard-release.env` | 凭据/发布落盘，禁止进仓 |
| `*.tgz` | 发布产物 |
| `packages/`、`.worktrees/` | 原仓的开发工作树目录，本快照不含 |

## 4. 有意保留、但**不构成新仓顶层规则**的文件

这些文件原样在 `deck/` 内，作为**内部参考资料**存在，不搬到本仓根：

- `AGENTS.upstream.md`（**由原仓 `AGENTS.md` 改名而来**）、`CONTEXT.md` —— 原仓给 agent 的
  开发指令。**改名理由**：`AGENTS.md` 是宿主会**自动加载**的指令文件名，只要它在 `deck/`
  下，其中的「及时提交与推送」「Release 发布」等原仓流程就会作为指令生效——那正是本次
  明确不要的「把原仓开发指令变成新仓规则」。改名后它只作为普通 Markdown 存在，内容一字未删。
  真源仍是原仓。**不复制成新仓的顶层 `AGENTS.md`，也不在 `deck/` 下保留这个名字。**
- `README.md`、`CHANGELOG.md`、`SECURITY.md`、`docs/`、`specs/`、`acceptance/`、`research/`
  —— 背景材料，供实现时对照；不作为对外承诺。
- 根 `package.json`（`private: true` 的开发壳）与 `pnpm-workspace.yaml` —— 保留为原状证据，
  **不**是本包的 manifest；本包 manifest 在仓库根（见 [../package.json](../package.json)）。

### 4.1 为什么 `deck/package.json` 与 `deck/package/package.json` 都**不改名**

两处都留着旧包名 `dsh-mattpocock-skills-deck`，这是**有意的**：

- `deck/package/package.json` 是**构建输入**：`deck/scripts/build.mjs` 从它读
  `version`（注入 `__DSW_VERSION__`）与 `repository`（注入面板的仓库外链），
  门禁还按它的 `files` 白名单机械求值发布包集合。改名会打断构建与门禁。
- `deck/package.json` 是 deck 构建的 `createRequire` 锚点（解析 `dsh-plugin-update`、
  `typescript`、`esbuild`）与十来个 `tests/verify-*.js` 的读取对象。
- **真正生效的包身份在仓库根的 `package.json` 与 `cordis.patch.yml`**：宿主按那份
  装包、建客户端图行、读 `dsh` 字段。`deck/**/package.json` 对宿主不可见
  （它们不在 profile 的 `node_modules` 顶层，不会被当作可安装包扫描）。

这条要写清是因为它反直觉：仓库里同时存在两个旧包名字面量，而它们都不是本包名字。
判断「本包叫什么」只看根 `package.json`、根 `cordis.patch.yml`、
`tools/merge/merge-identity.ts` 三处，三处必须逐字相同。

## 5. 会对外产生副作用的脚本：保留但**禁止在本仓运行**

`deck/scripts/` 里有发布/同步类脚本（`wizard-release.sh`、`wizard-npm-publish.sh`、
`publish-*.ps1`、`create-release-issue.mjs`、`sync-matt-skills.mjs`、`star-history.mjs`）。
它们原样保留（删掉会打断门禁的「文件存在」断言），但**不属于本仓任何 `npm run` 脚本**，
本仓任何阶段都不得执行它们：它们会发 npm 包、建外部 issue、改技能源。
可离线安全运行的命令清单见 [../docs/merge-implementation-plan.md](../docs/merge-implementation-plan.md)。

## 6. 许可与署名

- Deck 本体：MIT，Copyright (c) 2026 王辰浩 —— 原文见 [LICENSE](./LICENSE)。
- 随包 27 个技能：MIT，Copyright (c) 2026 Matt Pocock —— 原文见
  [package/bundled-skills/LICENSE](./package/bundled-skills/LICENSE)，
  上游技能版本见 [package/bundled-skills/VERSION](./package/bundled-skills/VERSION)（`v1.3.1`）。
- Resident 本体：MIT，Copyright (c) 2026 SunsetRNE —— 见 [../LICENSE](../LICENSE)。

合并包同时携带这三份许可原文，**不删除、不改写、不合并成一份**。
