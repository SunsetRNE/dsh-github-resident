# Issue tracker: GitHub

本仓库（`SunsetRNE/dsh-github-resident`）的 issue 与 spec 都存放在 GitHub Issues 里。所有操作走 `gh` CLI。

本文件是工作区初始化的主锚：仓库认后端时读它的**首行标题**（`# Issue tracker: GitHub` 这一行），
插件面板的「工作区已初始化」检查（`tracker:initialized`）判的就是它存在。改标题等于换后端。

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

### Mid-flight discovery（途中发现的分流）

开工中冒出来的需求（新洞、新票、新工程）**由 agent 当场判**：两问都答不了才问维护者；答得了就自己判，
并且**当场开票 + 出声**（维护者可当场否决）。这条规则不长，是因为现实是动态的（无关紧要 / 挡当前 / 卡后置 /
手边就能修）—— **预先分类必然错**，所以只有「当场两问」。

**Q1 它挡住谁的验收？**

- **挡当前这张票** → 【提前】：会撑大当前票的验收范围（它不属当前票的交付）→ 单开新票 + `当前票 blockedBy 新票`；
  不会（同一个洞的补丁）→ 就地做掉。
- **挡后面某张票** → 【进图，挂在后面那张上】：`后置票 blockedBy 新票`，新票自己**不带前置** → 它会出现在
  「可接」里，**这是唯一合法落在前沿的情况**，出声时必须说明「只挡着后面那张，本会话不做」。
- **谁都不挡** → 进 Q2。

⚠️ 挂边对象**必须还没关**：挂到已关的票等于没挂（它立刻可接，事实上被提前了）。

**Q2 它属于本图的目的地吗？**（Destination 那句话罩得住它吗）

- **属于** → 【进图：加一层】当场开新子票 + 一条真实阻塞边（挂到它真正等的前置）；
  说不清它等谁 / 说不清它长什么样 → 进 **Not yet specified**（雾），不开票。
- **不属于** → 【出图】当场开票：够得上一个目的地 → 另开**平级图**；否则 → **独立票**（不挂本图）。
  （子图不用：本仓整套流程跑下来没用到过，等真需要再说。）

**两个例外**

- 【顺手】：不挡路、但就在手边（同一处代码、代价小、不修会让本次红绿失真）→ 与本票同一提交修掉，
  票面写明「这不是本票的洞」（否则记账会串味）。
- 【不记】：不挡路、不进图、手边修也不划算，且下次有人踩到也不会有线索可寻 → 不开票、不记账。

**出声**（写在回复里 —— 票面上的字不会说话，票会：它出现在列表、反向边与下一次地图快照里）：

```
途中发现：<一句话>
判定：提前（就地 / 新票 #X 卡当前票）/ 进图（等 <票> / 只挡 <票>）/ 出图（独立票 #Y / 平级图 #Z）/ 顺手 / 不记
去向：<容器 + 它现在的状态（可接？等谁？图外？）>
```

**反悔**：同一会话里发现它已被别的票覆盖、或已经过时 → 当场并掉或关掉，票面写明被谁吸收
（既有先例：《启动自述：我是谁、我缺什么（一条只读状态）》按 `wontfix` 关闭 = 已被吸收，不是驳回）。

**当场落点**：票面写一节 `## 途中发现`，一条一行「发现 / 判定 / 去向」；沉淀轮据此审计归属与是否该关。

## 补充（origin 侧合并进来的一条事实）

- 随包 `deck_*` 工具走同一 tracker；装了就是首选路径。
