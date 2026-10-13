# dsh-github-resident（融合包）

两个插件融合成的单包：常驻 GitHub 身份（Resident 半边）+ 技能面板与工单工具（Deck 半边）。
本词表只收这个融合体特有的说法；通用编程概念不收。

## 语言

**半边（half）**：
融合包里的两半之一 —— Resident 半边（`gh_*` 工具、登记文件库、凭据拆除）或 Deck 半边
（`deck_*` 工具、面板、GitHub/GitLab 追踪后端）。
_Avoid_: 插件、模块、部分、子包

**身份真源（identity source）**：
凭据唯一的落脚处：插件自有 state（`~/.dsh/github-resident.json`，0600）。
别处出现的 token 都是投影，不是真源。
_Avoid_: 主 token、默认凭据、凭据本体

**投影（projection）**：
把真源投射到生态某个消费点的动作或结果 —— git 的 credential.helper、全局 git 身份、gh CLI、
子进程环境、自带 gh 的 PATH 落点。投影可重复、可撤、可对账。
_Avoid_: 同步、拷贝、写入配置

**对账（reconcile）**：
拿真源与现场逐点比对，报出「接了没有、接的是谁、什么时候接的、是否漂移」。
_Avoid_: 检查、verify（那是「跑一遍看通不通」；对账是「比出差异」）

**消费面（consumption surface）**：
别的半边或别的插件拿身份的唯一入口：服务位 + 协议 `identity` 段。
绕过它去读 `hosts.yml` 或自存一份 token 都属于违规。
_Avoid_: 接口、API、SDK

**环境契约（environment contract）**：
插件对宿主环境的一组显式要求与降级说明 —— 缺 gh、缺 curl、HOME 只读、无网、代理污染时各自怎么表现。
换环境时不靠人猜，靠它自述。
_Avoid_: 依赖、前置条件、运行要求

**有界（bounded）**：
每个对外动作（子进程、网络、等待）都有上界与失败记账；不许出现「不退出、不报错、不结束」的第三态。
_Avoid_: 超时（那只是达成有界的一种手段）
