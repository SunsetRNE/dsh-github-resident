# Triage Labels

技能用五个「triage 角色」的名字说话，本文件把这些角色映射到本仓库 issue tracker 上实际使用的标签字符串。

本次初始化选择了**保留默认五角色**（标签字符串与角色同名），未做任何改名。

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## 不在本表里的标签

- **类别角色**由仓库既有标签承担，不改名、不新建：`bug` = 坏了，`enhancement` = 新功能或改进。
- **wayfinder 工作流标签**（走 `/wayfinder` 时才用，与 triage 状态机无关）：`wayfinder:map`、`wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task`。
- 这批标签里，本仓库已存在的有：五个 triage 状态标签（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）、`bug`、`enhancement`、以及五个 `wayfinder:*`。
- 打标签严格按技能规则走，不额外强制任何标签。

Edit the right-hand column to match whatever vocabulary you actually use.
