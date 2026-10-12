# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

The five defaults are kept 1:1: each role's label string equals its role name. No other label is mandatory for a new issue — when a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Wayfinder labels

`/wayfinder` needs all five wayfinder labels to exist in the tracker. Every wayfinder ticket carries exactly one of them; the `wayfinder:<type>` part is the ticket type.

| Label                  | Meaning                                                   |
| ---------------------- | --------------------------------------------------------- |
| `wayfinder:map`        | The map issue — holds Notes / Decisions so far / Fog       |
| `wayfinder:research`   | Research ticket (AFK)                                      |
| `wayfinder:prototype`  | Prototype ticket (HITL)                                    |
| `wayfinder:grilling`   | Grilling / discussion ticket (HITL)                        |
| `wayfinder:task`       | Implementation task ticket (HITL or AFK)                   |

## Colours

Colours are **not** recorded in this file. On GitHub the colours are the repository's own label colours — the ten core labels use the palette single-sourced in `deck/src/shared/labels.js`. On the local Markdown backend they live in the workspace file `docs/agents/label-colors.json`. This file only answers "which label string does a role map to".

Edit the right-hand column of the first table to match whatever vocabulary you actually use.
