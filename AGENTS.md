# AGENTS.md

本仓库是 **dsh-github-resident**（包名 `@sunsetrne/dsh-github-resident-v2`）—— 给 DeepSeek Harness 用的常驻 GitHub 身份 bundle：
`gh_*` 工具、Skills Deck 的 `deck_*` 工具与右侧面板，加上随包分发的工程技能。本文件给在本仓库里干活的 agent 用，
域词条与架构决定的位置见下面的 Agent skills 块。

## Agent skills

### Issue tracker

Issues 与 specs 都在 GitHub Issues 里（`SunsetRNE/dsh-github-resident`，走 `gh` CLI）。See `docs/agents/issue-tracker.md`.
（随包 `deck_*` 工具走同一 tracker；装了就是首选路径 —— origin 侧补充）

### Triage labels

五个 triage 状态角色沿用默认标签字符串：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。See `docs/agents/triage-labels.md`.
（另有 wayfinder 五个工单标签 `wayfinder:map`/`research`/`prototype`/`grilling`/`task`；除此之外不强制任何标签 —— origin 侧补充）

### Domain docs

single-context —— 一个仓库共用一份根目录的 `CONTEXT.md`，架构决定放 `docs/adr/`。See `docs/agents/domain.md`.

> 这三条由 `/setup-matt-pocock-skills` 初始化时写入：工程技能（`/to-tickets`、`/triage`、`/to-spec`、`/wayfinder`、`/domain-modeling` 等）
> 都从上面三份文件读工作流配置。要改工作流直接编辑 `docs/agents/*.md`；只有切换 issue tracker 或想从头重来，才需要重跑初始化。
