# 身份单一真源：插件持有，其余都是投影

Status: accepted（2026-10-14，用户拍板）· 实现分两版落地：1.8.3 只读半边 / 1.9.0 写半边

本包是两个插件融合的产物（Resident 半边 + Deck 半边）。融合只做完了一半：gh 的**位置**已经单源
（`ghResolver` 服务 + 执行点必须用解析出的路径，2026-10-13 的 #15 收口），gh 的**身份**仍是两套 ——
Resident 半边按 `GH_TOKEN → GITHUB_TOKEN → 自有 state` 取值，Deck 半边一律经 `gh` 执行、吃 gh CLI 的
`hosts.yml`。实测（2026-10-14，本机）这套分裂的代价：gh CLI 已认证、git 能推拉，而 Resident 的 REST
路线三样全空 —— `gh_pr` 因此必然 401，且代码里没有 `gh pr create` 回落（`"pr create"` 在 plugin.js 里
出现 0 次）。症状看着像一堆小 bug，其实是融合面缺一条身份契约。

**决定：身份的唯一真源是插件自有 state（0600）**；解析器按 `env GH_TOKEN/GITHUB_TOKEN → state →
gh CLI hosts.yml（只读）` 归一出 `{login, token, host, scopes?, source}`。其余一切都是**投影** ——
git 的 credential.helper、全局 git 身份、gh CLI、子进程环境、自带 gh 的 PATH 落点 —— 每条投影都必须
**可对账**（值、写入者、时间、是否漂移），而不是只回一个布尔。两个半边与将来的任何插件只认一个
**消费面**（服务位 + 协议 `identity` 段）；绕过它直接读 `hosts.yml` 或各存一份 token 都算违规。

边界（不做的）：不引入第二份 token 存储；不让 Deck 半边退回裸名 `gh`；不把 token 写进仓库、日志或
任何落盘的环境文件（子进程只注入）；不把 `hosts.yml` 当写目标 —— 它是 gh 自己的文件，替它维护格式
迟早对不上。

## Considered Options

- **gh CLI `hosts.yml` 为唯一真源**：跟生态标准走，但插件在 install/搬运时要能携带身份，而
  `hosts.yml` 是别人的格式。作为**只读后端**参与解析则没有这个问题 —— 所以选它当后端，不当真源。
- **两边对等、谁新用谁**：实现最省事，但「谁说了算」不可对账，漂移时无从定位。这次的症状正是
  缺一条契约所致，选它就等于把症状制度化。

## Consequences

- 「换到别的环境一样可用」这条目标由此有了唯一下游验收标准：插件必须能自述「这台机器上缺什么、
  准确的补救命令是什么」（`gh_env_probe` 能力矩阵 + `gh_identity` 体检/接线/对账 + 启动自述）。
- 写投影（尤其全局 git 配置）必须 consent-gated、幂等、可撤（`unwire`）—— 它是唯一会动宿主全局
  状态的动作，也是本 ADR 里唯一需要用户点头的部分。
- 两套身份的**优先级顺序**自此是契约：改顺序或改真源要走新的 ADR，不许顺手调。
- 门禁要跟着改：环境相关的东西进**合成环境矩阵**（无 gh / 有 gh 未登录 / HOME 只读 / 无 curl / 无网 /
  代理污染），把「只在某种环境才红」变成 CI 常态红灯 —— 这次发布路上踩的坑（子进程不退、
  release CDN 抖动、HOME 假设、reposRoot 指向不存在的目录）都属于这一类。
