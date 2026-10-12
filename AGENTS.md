# Agent Instructions

This file gives an agent working in this repo the context it needs to operate well.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in this repo, read and written through the `gh` CLI (the bundled `deck_*` tools sit on the same tracker and are the preferred path when present). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles keep their default strings (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`), plus wayfinder's five ticket labels (`wayfinder:map` / `wayfinder:research` / `wayfinder:prototype` / `wayfinder:grilling` / `wayfinder:task`); no other label is mandatory. See `docs/agents/triage-labels.md`.

### Domain docs

`single-context` layout — one `CONTEXT.md` at the repo root, architecture decisions in `docs/adr/`. See `docs/agents/domain.md`.
