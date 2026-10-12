# Domain Docs

域文档布局（本次初始化与用户确认的结论）：

**single-context** —— 一个仓库共用一份根目录的 `CONTEXT.md`，架构决定放 `docs/adr/`。

工程技能在探查本仓库代码时，按下面这几条消费本仓库的域文档。

## 布局：single-context

```
/
├── CONTEXT.md          ← 全仓共用一份；还没有，第一次真写下词条时才建
├── docs/adr/           ← 架构决定；还没有，第一个 ADR 需要时才建
└── deck/               ← 单包仓库，不是 workspace 成员，不另开上下文文档
```

- 本次初始化**不创建** `CONTEXT-MAP.md`，也**不创建**任何子项目的 `CONTEXT.md`：这两样只在仓库真的变成多上下文时才需要，留到第一次真正写下词条时再建。
- 本仓库没有 monorepo 结构信号：`pnpm-workspace.yaml` 里 `packages` 是空的，`deck/` 是自带 `package.json` 的子包、明确不进 workspace，所以按 single-context 记。

## Before exploring, read these

- 根目录的 **`CONTEXT.md`** —— 本仓库的域词条都放这一份里。
- **`docs/adr/`** —— 要动哪块，先读管着那块的决定。
- 文件还不存在就**静默继续**：不要报缺失，也不要提前建议去建。它们由 `/domain-modeling`（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 到达）在词条或决定真正定下来的当下按需创建。

## 命名：CONTEXT.md 与 GLOSSARY.md

本仓库按插件的说法叫 **`CONTEXT.md`**（一个上下文一份）。随插件分发的技能文档里那份老叫法是 **`GLOSSARY.md`**，
两者指同一件东西 —— 每上下文一份的词条文件。技能里凡是提到 `GLOSSARY.md` 的地方，在本仓库请读作 `CONTEXT.md`：
读它、按它的词说话、新词条写进它。等多上下文真的出现时，根目录的 `CONTEXT-MAP.md` 就是那个老叫法里 `GLOSSARY-MAP.md` 的位置。

## Use the glossary's vocabulary

输出的地方（issue 标题、重构提案、假设、测试名）提到域概念时，用 `CONTEXT.md` 里定义的那个词，
不要漂到它明确避开的同义词上。

需要的概念还没进词条，是个信号：要么你在造项目不用的语言（回头想），要么这里真有个缺口（记给 `/domain-modeling`）。

## Flag ADR conflicts

如果你的输出与已有 ADR 相矛盾，明确说出来，不要悄悄覆盖：

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
