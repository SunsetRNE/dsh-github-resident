# 合并契约：对话框上方的功能栏（`conversation.input.dock` 占用者）

- 本文件服务的主任务：把 `dsh-mattpocock-skills-deck` 合并进 `dsh-github-resident`、以一个插件（一个客户端产物）运行。
- 本文件只覆盖**一件事**：对话框（输入卡）上方那条功能栏 —— 也就是 Deck 在宿主 `conversation.input.dock` 槽里注册的 `StatusBar`。
- 用户刚补充的书面要求：「注册在对话框上方的功能栏也保留」。本文把「保留」写成可逐条核对的契约，而不是一句意愿。
- 本文是**只读盘点 + 独立验收文档**：没有改任何代码、没有安装/启停插件、没有点按真机按钮、没有建改 issue、没有 commit/push、没有动 `docs/merge-implementation-plan.md` / `progress.md`。
- 全文只有一处可写文件，就是本文自身。

## 0. 证据与限制（先说清楚哪些是实测、哪些是源码）

| 事实 | 来源 | 可靠度 |
|---|---|---|
| 功能栏所在槽位是 `conversation.input.dock`，`kind: list`、`scope: session`、purpose 为「Full-width entries above the composer card」 | 主代理本轮实时核验（`Client Slots.listSubTree(root='conversation.input.dock')` 返回 `available=true`、`scope=session`） | 运行态事实 |
| 同槽既有占用者：`todo` order 0、`goal` order 10、`queue` order 20；Deck 的 `id='dsh-mattpocock-skills-deck'` order 40、`active=true` | 同上（主代理实时核验，本轮输入） | 运行态事实 |
| 该注册行在源码里的写法 | [panelAssembly.js:79-81](../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L79-L81) | 本地源码 |
| 功能栏内部的每一个元素、出现条件、交互去向 | Deck 仓 `src/client/**`（下文逐条给行号链接） | 本地源码 |
| 合并后的形态（单 `client.js`、一个 `__ModuleLoader__.load`、包级 `inject` 取并集） | [合并评估报告](./merge-deck-assessment-2026-10-11.md)、[证据 02 §7](./merge-deck-evidence/02-ui-settings-and-slot-conflicts.md) | 评估结论（非运行态） |

**限制（必须明说）**：本文执笔时**自己**再查一次 `Slots.listSubTree` 也超时了（10 秒，提示「Open or reconnect the Harness page」）。按纪律不重试。所以上表第 1、2 行的运行态事实**引用主代理的实时核验**，本文作者**没有**独立复现；功能栏内部的一切结论都来自源码，属于「源码事实」，不等于「页面上看起来是什么样」。合并后的产物尚未存在，第 5 节里凡标「需新增」的验证都还没有跑过。

## 1. 不可改的五条（客户端作者的硬约束）

1. **注册位置不变**：仍然注册在 `conversation.input.dock`，`scope` 仍由宿主按 session 解析。不许搬进设置页、不许改成「只在右侧栏里画」（右栏今天承载的是面板本体，不是这条功能栏）。
2. **注册身份不变**：`id` 仍是 `'dsh-mattpocock-skills-deck'`。这个 id 是门禁定位组件用的把手（[smoke-render.test.js:143](../../dsh-mattpocock-skills-deck/tests/smoke-render.test.js#L143) 用 `byId['dsh-mattpocock-skills-deck']` 找它），也是同槽不重名的依据。
3. **注册顺序不变**：`order` 仍是 `40`，排在宿主 `todo`(0) / `goal`(10) / `queue`(20) 之后（更靠近输入卡）。不许抢到它们前面，也不许把它们的条目挪走。
4. **功能栏内部元素不丢**：第 2 节矩阵里「保留标识」一栏列到的元素、文案键、`data-*` 钩子都要在合并后存在且行为不变。
5. **折叠状态机与模态座位不退化**：按工作区记忆的收起/展开、收起态仍能画弹窗座位（`FormModalSeat` / `SetupCard`）这两件事，是这份功能栏最容易被合并顺手改坏的地方，必须原样保留。

## 2. 元素矩阵（元素 / 原行为 / 出现条件 / 调用入口 / 保留标识 / 对应测试场景）

### 2.1 座位与容器

| # | 元素 | 原行为 | 出现条件 | 调用入口 | 保留标识 | 对应测试场景 |
|---|---|---|---|---|---|---|
| A1 | 槽位注册行 | 把 `StatusBar` 交给宿主，画在输入卡上方整宽处 | 插件 apply 时注入一次（`__injectOnce` 幂等闸） | `slots.inject('conversation.input.dock', …)` → `slots.register` | `name='conversation.input.dock'`、`id='dsh-mattpocock-skills-deck'`、`order=40` | [smoke-render.test.js:100](../../dsh-mattpocock-skills-deck/tests/smoke-render.test.js#L100)、[:143](../../dsh-mattpocock-skills-deck/tests/smoke-render.test.js#L143)；[verify-slot-idempotency.js](../../dsh-mattpocock-skills-deck/tests/verify-slot-idempotency.js)；[verify-cap-fold-browser.js:92](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold-browser.js#L92)；[verify-669-collapsed-recoverable.js:259](../../dsh-mattpocock-skills-deck/tests/verify-669-collapsed-recoverable.js#L259) |
| A2 | 外层几何容器 | 宽度算式与输入卡**卡片**同源：`calc(100% - 2*var(--dsh-composer-side-clearance,0px))`、上限 `--dsh-composer-card-max-width`、左右自动居中 | 任何分支都套这一层 | `dswsStatusDockGeom()` | 两个宿主 CSS 变量名；兜底 `0px` / `100%` | [verify-640-dock-width-browser.js](../../dsh-mattpocock-skills-deck/tests/verify-640-dock-width-browser.js)（真浏览器量「容器左右边 == 输入卡左右边」，收起态例外为包裹内容居中） |
| A3 | 三个渲染分支 | ①收起态 ②展开且无横幅 ③展开且有横幅 | `isBannerFolded(s.cwd)`；`guideBannerStep(...)` 是否为 null | `StatusBar` 组件体 | 分支结构本身（收起 / 无横幅 / 有横幅） | [verify-669-collapsed-recoverable.js](../../dsh-mattpocock-skills-deck/tests/verify-669-collapsed-recoverable.js) C 组、[verify-671-modal-global-overlay.js](../../dsh-mattpocock-skills-deck/tests/verify-671-modal-global-overlay.js) A 组 |
| A4 | 按工作区记忆的收起开关 | 收起/展开写进 `localStorage` 的 `dsws.bannerFold`，键是工作区规整键；同一工作区各会话跟着重渲染 | 点收起叉、点收起态小按钮 | `isBannerFolded` / `setBannerFolded` | storage key `'dsws.bannerFold'`、键规整函数 `keyOf(cwd)` | [store-prefs.js:190-215](../../dsh-mattpocock-skills-deck/src/client/kernel/store-prefs.js#L190-L215)；行为由 [verify-669](../../dsh-mattpocock-skills-deck/tests/verify-669-collapsed-recoverable.js) C 组间接覆盖 |

### 2.2 横幅（`stepBanner`）

| # | 元素 | 原行为 | 出现条件 | 调用入口 | 保留标识 | 对应测试场景 |
|---|---|---|---|---|---|---|
| B1 | 蓝条（读不到后端那一档） | 罗盘图标 + 一句说明 +（读到设置时）一颗主按钮 + 收起叉 | `guideBannerMeta(...).tone === 'info'`，且后端还没确定 | 按钮 → `runGuideMissing(s, bannerStep)`；叉 → `foldBanner()` | `.dsws-banner`、`.dsws-banner-fold-x`、`aria-label=banner.foldDeck` | [bannerChain.js:60-80](../../dsh-mattpocock-skills-deck/src/client/statusbar/bannerChain.js#L60-L80)、[StatusBar.js:320-329](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L320-L329)；[verify-663-banner-chain.js](../../dsh-mattpocock-skills-deck/tests/verify-663-banner-chain.js) |
| B2 | 「正在读取」过渡态 | 只显示 `banner.gateReading` 与转圈，**一个动作都不给** | 后端还没确定，且快照/选择探测还在途（`snapLoading` 或 `selPending`） | 同上，无按钮 | 词条键 `banner.gateReading` | [StatusBar.js:191](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L191)、[:326-328](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L326-L328)；[verify-916-ghauth-unknown-banner.js](../../dsh-mattpocock-skills-deck/tests/verify-916-ghauth-unknown-banner.js) |
| B3 | 「正在探测后端」黄条 | 转圈 + 一句中文 + 「重试」按钮（强制重取快照）+ 收起叉 | `_isGatePending`（选择处于 pending 且已有 cwd） | 重试 → `loadSnapshot(s,true,true)` | 该分支文案与按钮位置 | [StatusBar.js:326-327](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L326-L327) |
| B4 | 通用横幅（黄/红/绿一档） | 警示图标 + 文案（可带占位符）+ 一颗主按钮 +（可收起时）图形叉，叉与主按钮间隔 12px | `guideBannerStep` 给出第一个没过且带 `banner` 的步骤 | 主按钮 → `runGuideMissing(s, bannerStep)`（注入文案 / 开弹窗 / 开选后端窗，三选一） | `.dsws-banner` + `.dsws-banner-fold-x`；按钮与叉的 12px 间隔 | [StatusBar.js:302-314](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L302-L314)、[bannerChain.js:201-248](../../dsh-mattpocock-skills-deck/src/client/statusbar/bannerChain.js#L201-L248)；[verify-669-collapsed-recoverable.js](../../dsh-mattpocock-skills-deck/tests/verify-669-collapsed-recoverable.js) A/B 组 |
| B5 | 引导链日志 | 每次点横幅按钮落一行常驻日志 `guide.inject`，只记「哪一步、给出去的是哪一类」 | 任何一次按钮点击 | `logGuideInject(stepId, outcome)` | 事件名 `guide.inject`、字段 `step` / `outcome` | [bannerChain.js:250-258](../../dsh-mattpocock-skills-deck/src/client/statusbar/bannerChain.js#L250-L258) |
| B6 | 无横幅 | 不画横幅，只画胶囊（+弹窗座位） | `bannerStep` 为 null | —— | 分支存在（有横幅/无横幅都带 `modalSeat`） | [verify-671-modal-global-overlay.js](../../dsh-mattpocock-skills-deck/tests/verify-671-modal-global-overlay.js) A 组 |

### 2.3 胶囊（任何情况下都不隐藏；这是 #187 之后定下的规矩）

| # | 元素 | 原行为 | 出现条件 | 调用入口 | 保留标识 | 对应测试场景 |
|---|---|---|---|---|---|---|
| C1 | 胶囊本体 | 整条点击打开右侧栏面板；不换行、随输入卡宽度伸缩 | 恒渲染（展开的两种分支） | `onClick → openPanel(s)` | `.dsws-capsule`（`flex-wrap:nowrap`、`max-width:var(--dsh-composer-card-max-width)`） | [StatusBar.js:240](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L240)、[styles.js:140/148](../../dsh-mattpocock-skills-deck/src/client/kernel/styles.js#L140)；[verify-capsule-narrow.js](../../dsh-mattpocock-skills-deck/tests/verify-capsule-narrow.js) |
| C2 | 品牌段 | 罗盘图标 + 「MattSkills」；点它展开/收起面板 | 恒在；首帧（还没量到有效宽）只留图标，量到后照阶梯从第 0 档显示 | `onClick → togglePanel(s)`（并阻止冒泡） | `data-fold-priority=1`、字号 14、`CAP_FOLD_START_FOLDED=['1']` | [StatusBar.js:241-244](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L241-L244)、[capFold.js:87](../../dsh-mattpocock-skills-deck/src/client/statusbar/capFold.js#L87)、[capFoldMachine.js:149-163](../../dsh-mattpocock-skills-deck/src/client/statusbar/capFoldMachine.js#L149-L163)；[verify-cap-fold.js](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold.js) A/D 组 |
| C3 | 当前会话在办票那一段 | 图钉 + （地图图标）+ 号；悬停出一张单子列当前会话记录（旧在上、新在下，最多 20 条），点行进票详情并打开面板 | 快照里有当前会话的记录（散列对得上）；没记录不占位；读坏了画一枚警示图标 | `SessionChainCapsule`；行点击 → `sessionChainOpenTicket` + `openPanel` | `data-fold-priority=12`、类名 `dsws-capsule-chain` / `dsws-chainmenu` | [StatusBar.js:245](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L245)、[SessionChainCapsule.js:133-236](../../dsh-mattpocock-skills-deck/src/client/statusbar/SessionChainCapsule.js#L133-L236)；[verify-chain-capsule.js](../../dsh-mattpocock-skills-deck/tests/verify-chain-capsule.js) |
| C4 | 「可接」段 | 绿色圆点段 + 数字；点它切列表页到可接过滤；悬停出「需求」菜单 | 恒在 | 段 → `go('list')` 且清空标签过滤；菜单 → `openTextInNewSession` | `data-fold-priority=9`、数字 `.dsws-num` 宽 `2ch`、色 `#4ade80`、菜单类 `dsws-takemenu` | [StatusBar.js:246-254](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L246-L254)；[verify-statusbar-filter-reset.js](../../dsh-mattpocock-skills-deck/tests/verify-statusbar-filter-reset.js) |
| C5 | 「BUG」段 | 红色段 + 数字；点它切到 open+bug 过滤；悬停出「新增」菜单 | 恒在 | 段 → `go('list')` + `lblFilters=['bug']`；菜单 → `openTextInNewSession` | `data-fold-priority=10`、色 `#f87171`、菜单类 `dsws-bugmenu` | [StatusBar.js:255-263](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L255-L263)；[verify-statusbar-filter-reset.js](../../dsh-mattpocock-skills-deck/tests/verify-statusbar-filter-reset.js) |
| C6 | 「诊断」段 | 橙色段 + 数字；点它切到 open+needs-triage 过滤 | 恒在 | `go('list')` + `lblFilters=['needs-triage']` | `data-fold-priority=11`、色 `#f59e0b` | [StatusBar.js:264](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L264)；[verify-statusbar-filter-reset.js](../../dsh-mattpocock-skills-deck/tests/verify-statusbar-filter-reset.js) |
| C7 | 「沉淀」段 | 紫色段；点它把进度快照 prompt 注入当前会话 | 恒在 | `injectFixate(s)` | `data-fold-priority=7` | [StatusBar.js:265](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L265)、[api-naming.js:9](../../dsh-mattpocock-skills-deck/src/client/kernel/api-naming.js#L9) |
| C8 | 「交接」分体按钮 | 左半发交接、右半开新会话并预填路径；右半在后端/仓库没就绪时置灰；搜索中转圈 | 恒在（就绪态决定颜色与可点性） | `doHandoff(s)` / `doHandoffOpen(s)` | `data-fold-priority=8`、`.dsws-split` / `.dsws-split-part` / `.dsws-split-div`、`dsws-spinner` | [StatusBar.js:266-275](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L266-L275)、[api-new-session.js:65/83](../../dsh-mattpocock-skills-deck/src/client/kernel/api-new-session.js#L65) |
| C9 | 「环境」段 | 图标随好坏换（对勾/圆点/警告），显示 `n/total`，负值显示 `?` | 恒在 | `go('checks')` | `data-fold-priority=4`（标签）、`=5`（计数）、段尺寸 14 | [StatusBar.js:276](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L276)、[probe-chain.js:189-191](../../dsh-mattpocock-skills-deck/src/client/kernel/probe-chain.js#L189-L191) |
| C10 | 刷新 + 时间按钮 | 点它全量刷新；刷新中转圈；显示日期与时间两段 | 恒在 | `refreshAll(s)` | `data-fold-priority=2`（刷新字）、`=3`（日期）、`=6`（时间）、`.dsws-timebtn` | [StatusBar.js:277](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L277)、[capFold.js:73-78](../../dsh-mattpocock-skills-deck/src/client/statusbar/capFold.js#L73-L78) |
| C11 | 技能入口 | 悬停或点击展开技能名单（27 项），点技能名把 `/<技能>` 注入输入框；与日志菜单互斥 | 恒在 | `SkillFloatList`；行点击 → `inject(s, '/' + sk.name)` | `.dsws-skillbtn`、`.dsws-skillpop`、`aria-label=nav.skillsTitle`、每行 `aria-label='/'+name` | [StatusBar.js:278](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L278)、[SkillFloatList.js:88-111](../../dsh-mattpocock-skills-deck/src/client/floating/SkillFloatList.js#L88-L111)；[verify-skill-tooltip.js](../../dsh-mattpocock-skills-deck/tests/verify-skill-tooltip.js)、[smoke-render.test.js](../../dsh-mattpocock-skills-deck/tests/smoke-render.test.js) |
| C12 | 诊断日志小点 | 开调试时绿点（常驻）、关时灰点；悬停 200ms 或点击开四键菜单；与技能菜单互斥 | **只有日志开关打开时才挂载**（关着不留空位） | `StatusLogDot` | `data-dsws-logdot`、`.dsws-logdot`、直径 10、两色 `#4ade80` / `#6b6b75` | [StatusBar.js:236-238](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L236-L238)、[:279](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L279)、[StatusLogMenu.js:70-328](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusLogMenu.js#L70-L328)；[verify-log-statusbar.js](../../dsh-mattpocock-skills-deck/tests/verify-log-statusbar.js) |
| C13 | 收起按钮（胶囊最右） | 图形「∨」，收起整条功能区（横幅+胶囊） | 展开态恒在，排在技能入口之后 | `foldBanner()`（并阻止冒泡） | `.dsws-fold-toggle`、`data-fold-priority` 之外的载荷元素、`aria-label=banner.foldDeck` | [StatusBar.js:201-204](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L201-L204) |

### 2.4 悬浮菜单（都走 portal，`z-index:2147483000`）

| # | 菜单 | 原行为 | 出现条件 | 调用入口 | 保留标识 | 对应测试场景 |
|---|---|---|---|---|---|---|
| D1 | 可接 / BUG 菜单 | 各一行动作，点它开新会话并预填对应 prompt | 悬停对应段展开，离开 160ms 后关 | `showStatusTakeMenu` / `showStatusBugMenu` | `.dsws-takemenu` / `.dsws-bugmenu`、`s.takeMenuPos` / `s.bugMenuPos` | [StatusMenus.js:19-70](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusMenus.js#L19-L70)、[StatusBar.js:248-262](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L248-L262) |
| D2 | 技能名单 | 27 行，行内悬停高亮，行说明走统一悬停提示 | 悬停/点击技能入口 | `SkillFloatList` | `.dsws-skillpop` / `.dsws-skillpop-row`、`skillPopPos` | [SkillFloatList.js:26-111](../../dsh-mattpocock-skills-deck/src/client/floating/SkillFloatList.js#L26-L111)、[matt-skills.js:51-81](../../dsh-mattpocock-skills-deck/src/shared/matt-skills.js#L51-L81) |
| D3 | 日志四键菜单 | 导出今日日志 / 打开位置 / 复制路径 / 清空；失败各有提示；Esc 与外部点击关闭 | 点或悬停小点（200ms） | `StatusLogMenu` → `wf.logExport` / `wf.openFolder` / 剪贴板 / `wf.logClear` | `data-dsws-logmenu`、`role=menu`、`role=menuitem` | [StatusLogMenu.js:301-316](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusLogMenu.js#L301-L316)；[verify-log-statusbar.js](../../dsh-mattpocock-skills-deck/tests/verify-log-statusbar.js) |
| D4 | 清空确认框与留痕横幅 | 清空这类不可逆动作先冒确认框（焦点在确认键）；动手后出「人工关掉才消失」的结果横幅，失败带重试 | 点菜单里的「清空」 | `LogDangerConfirmBox` / `LogDangerNotice` | `role=dialog` + `aria-label=logmenu.clearTitle`、`role=status` + `aria-live=polite`、类 `dsws-fb-okflash` / `dsws-fb-errflash` | [LogDangerConfirm.js:18-80](../../dsh-mattpocock-skills-deck/src/client/statusbar/LogDangerConfirm.js#L18-L80)；[verify-954-danger-confirm.js](../../dsh-mattpocock-skills-deck/tests/verify-954-danger-confirm.js) |
| D5 | 当前会话票单 | 见 C3 的悬停单子 | 悬停 C3 | `chainShow` / `chainHide` | `.dsws-chainmenu`、`.dsws-chainmenu-row` | [SessionChainCapsule.js:168-218](../../dsh-mattpocock-skills-deck/src/client/statusbar/SessionChainCapsule.js#L168-L218) |
| D6 | 后端菜单三件（当前无人调用） | `place/show/closeStatusBackendMenu` 三个函数还在，但今天渲染路径上没有挂点 | 不出现 | 保留为函数 | 三个函数名 | [StatusMenus.js:71-93](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusMenus.js#L71-L93)（该文件头注释也写明「当前渲染未直接调用」） |

### 2.5 模态座位（在 dock 里，三条分支都带）

| # | 元素 | 原行为 | 出现条件 | 调用入口 | 保留标识 | 对应测试场景 |
|---|---|---|---|---|---|---|
| E1 | 弹窗座位 `FormModalSeat` | 全屏遮罩 + 居中盒，portal 挂到 `document.body`；表单 / 向导 / 成功三种形态；ESC 关、Tab 在盒内循环 | 座位恒在三种分支；有 `formModal` 时才画内容 | `FormModalSeat({st})` | `.dsws-modal` / `.dsws-modalbox`、`role=dialog`、`aria-modal=true`、`zIndex:10000` | [StatusBar.js:219](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L219)、[slotRenderer-modal-view.js:10-18](../../dsh-mattpocock-skills-deck/src/client/kernel/slotRenderer-modal-view.js#L10-L18)、[:332](../../dsh-mattpocock-skills-deck/src/client/kernel/slotRenderer-modal-view.js#L332)；[verify-671-modal-global-overlay.js](../../dsh-mattpocock-skills-deck/tests/verify-671-modal-global-overlay.js) B 组 |
| E2 | 「域文档布局」小卡 `SetupCard` | 一句话 + 两个单选 + 确认/取消 + 点遮罩等于取消；确认才注入；取消退回开卡前的答案 | `setupLayoutCardOpen === true`（黄条初始化按钮或「切换后端」那条路） | 座位里优先画卡（[slotRenderer-modal-view.js:18](../../dsh-mattpocock-skills-deck/src/client/kernel/slotRenderer-modal-view.js#L18)）；确认 → `confirmStatusSetupPick` | `aria-label=setup.cardTitle`、`role=dialog`、`.dsws-modalbox` | [SetupCard.js:23-53](../../dsh-mattpocock-skills-deck/src/client/views/SetupCard.js#L23-L53)、[StatusBackend.js:159-176](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBackend.js#L159-L176)；[verify-698-switch-asks-layout.js](../../dsh-mattpocock-skills-deck/tests/verify-698-switch-asks-layout.js)、[verify-655-setup-layout.js](../../dsh-mattpocock-skills-deck/tests/verify-655-setup-layout.js) |
| E3 | 状态栏来源的门控窗 | 标题 + 说明 + WIP 提示 + 后端单选（能力不全的置灰）+ 取消/确认并继续；**只选后端，不注入任何文字** | `gateModalOpen && gateModalSource==='status'` | 「还没有设置」那条蓝条的主按钮 → `openStatusGate(s)`；确认 → `confirmStatusGate(s)` | `gateSelected` / `gateBackendModules` / `backendModules`、`data-target-id`、`data-target-locked` | [StatusBar.js:340-358](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L340-L358)、[StatusBackend.js:188-208](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBackend.js#L188-L208) |

**E3 的一个源码事实**（合并时别当成缺陷改掉，先照抄）：这个窗只画在**有横幅**那一支里，且是容器内的绝对定位层（不是 portal）；因此它的出现前提正是「蓝条那一档在」。另外，未选后端时点 C4/C5/C6/C9 这些段只把面板页签指向 settings、**不打开面板**（`go()` 的早退分支），要看到门控窗得点胶囊本体或蓝条主按钮。

### 2.6 折叠状态机（胶囊随宽度一档一档变短）

| # | 元素 | 原行为 | 出现条件 | 调用入口 | 保留标识 | 对应测试场景 |
|---|---|---|---|---|---|---|
| F1 | 阶梯判据 | 12 段让位次序、每档只让一个单位；1/3/5/6/12 逐字让，2/4/7/8/9/10/11 整段让 | 纯函数，任何宽度 | `capFoldLadderOf` / `capFoldStateAt` / `splitTimeStr` | `CAP_FOLD_POLICY` 的 12 个键；`data-fold-priority` 号码含义（1 品牌 … 12 在办编号） | [capFold.js:54-67](../../dsh-mattpocock-skills-deck/src/client/statusbar/capFold.js#L54-L67)；[verify-cap-fold.js](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold.js) A 组 |
| F2 | 阶梯机 | 量不到有效宽就不下结论；量到后按守卫指纹复用/重算；把结果写进 DOM 与 `dataset` | 两条 `ResizeObserver`（胶囊、父容器）、`window.resize`、字体就绪、**每次提交后一次** | `runCapFold(cap, keep)` / `capFoldScheduleFold` | `cap.dataset.foldTier`、`cap.dataset.fold`、`.dsws-folded` | [capFoldMachine.js:36-117](../../dsh-mattpocock-skills-deck/src/client/statusbar/capFoldMachine.js#L36-L117)、[StatusBar.js:155-180](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L155-L180)；[verify-926-capfold-gate.js](../../dsh-mattpocock-skills-deck/tests/verify-926-capfold-gate.js)、[verify-cap-fold-browser.js](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold-browser.js) |
| F3 | 首帧起始态 | 还没量到有效宽时，只有品牌那一段收起（`display:none`），其余照原样 | 胶囊第一次画出来 | `applyCapFoldStart` / `capFoldStartWordsOf` | `CAP_FOLD_START_FOLDED=['1']` | [capFoldMachine.js:149-163](../../dsh-mattpocock-skills-deck/src/client/statusbar/capFoldMachine.js#L149-L163)；[verify-cap-fold-browser.js](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold-browser.js) I2 |
| F4 | 载荷不撤 | 图标与计数器数字（含 C3 的号）不进阶梯，任何宽度都不被撤掉；收到底后不再产生档位 | 恒在 | 阶梯机的元素筛选只取 `[data-fold-priority]` | `.dsws-folded` 的 CSS 只作用于 `[data-fold-priority]` 或 `[data-head-fold]` | [styles.js:165](../../dsh-mattpocock-skills-deck/src/client/kernel/styles.js#L165)；[verify-cap-fold-browser.js](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold-browser.js) I1、[verify-capsule-layout.js](../../dsh-mattpocock-skills-deck/tests/verify-capsule-layout.js) |

## 3. 场景矩阵（用户在什么处境下看到什么）

| 场景 | 功能栏的表现 | 依据 |
|---|---|---|
| **桌面宽屏** | 胶囊停在第 0 档：12 段文字全在（含品牌那串）；横幅照常；容器左右边与输入卡对齐 | [verify-cap-fold-browser.js](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold-browser.js) W 组、[verify-640](../../dsh-mattpocock-skills-deck/tests/verify-640-dock-width-browser.js) |
| **窄屏 / 列变窄** | 从品牌那一段开始一档一档收字；图标与数字永在；宽度回来时可见字只增不减 | [verify-cap-fold.js](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold.js) C 组、[verify-cap-fold-browser.js](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold-browser.js) I1/I3 |
| **会话切换** | 每会话各自一份 store：切走再切回时草稿注入只消费一次（`consumedDraftRef` 按 sessionId 记）；C3 只显示**当前会话**的票；折叠记忆按工作区、不按会话 | [StatusBar.js:60-76](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L60-L76)、[SessionChainCapsule.js:69-73](../../dsh-mattpocock-skills-deck/src/client/statusbar/SessionChainCapsule.js#L69-L73) |
| **工作区切换** | `s.cwd` 变了就重新水合、重取链与快照；每个工作区的收起状态互不影响；折叠记忆键按工作区规整 | [StatusBar.js:80-99](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L80-L99)、[store-prefs.js:200-215](../../dsh-mattpocock-skills-deck/src/client/kernel/store-prefs.js#L200-L215) |
| **后端未选择** | 胶囊不隐藏（#187 起）；上方是蓝条；「还没读到」与「确实没设置」分成两句；点段只把页签指向 settings、不打开面板；点胶囊/蓝条按钮才出门控窗 | [StatusBar.js:104-113](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L104-L113)、[:187-196](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L187-L196) |
| **右侧栏关闭** | 功能栏完全不受影响（它挂在输入区，不挂在右栏）；弹窗座位、各悬浮菜单照常；但「切换后端」那颗按钮在右栏面板头部，侧栏关着时改后端只能走蓝条的门控窗 | [panelAssembly.js:79-81](../../dsh-mattpocock-skills-deck/src/client/panelAssembly.js#L79-L81)、[StatusBar.js:205-218](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L205-L218)、[Dock.js:229](../../dsh-mattpocock-skills-deck/src/client/panel/Dock.js#L229) |
| **功能区收起后** | 整条只剩一颗 10px 灰字按钮（`banner.expandDeck`）+ 弹窗座位；横幅、胶囊、以及胶囊上的**全部**菜单（可接/BUG/技能/日志/票单）都不可达，必须先展开 | [StatusBar.js:220-235](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L220-L235)；[verify-669-collapsed-recoverable.js](../../dsh-mattpocock-skills-deck/tests/verify-669-collapsed-recoverable.js) A/C 组 |
| **模态弹窗 / SetupCard** | 与「有没有横幅」「收没收起」「右栏在不在」都无关：座位在三条分支里都画；同一时刻只画一张（卡优先于表单） | [StatusBar.js:213-219](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L213-L219)、[:233](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L233)、[:300](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L300)、[:339](../../dsh-mattpocock-skills-deck/src/client/statusbar/StatusBar.js#L339)；[verify-671](../../dsh-mattpocock-skills-deck/tests/verify-671-modal-global-overlay.js)、[verify-698](../../dsh-mattpocock-skills-deck/tests/verify-698-switch-asks-layout.js) |

## 4. 重点集成验收场景（12 条，都是行为，不是「某字符串还在」）

1. **单 Client 装配后只有一个占用者**：合并产物在同一个会话里，`conversation.input.dock` 的占用者恰好一条，`id='dsh-mattpocock-skills-deck'`、`order=40`；同槽 `todo/goal/queue` 的位置与前缀内容不变（渲染顺序：todo → goal → queue → 本功能栏）。
2. **合并后功能栏真的画出来**：合并产物 apply 一次，用 jsdom + 真 React 挂载 dock 占用者，断言胶囊、品牌段、四个计数器、技能入口都在 DOM 里，且没有整棵子树因渲染异常消失（[smoke-render.test.js](../../dsh-mattpocock-skills-deck/tests/smoke-render.test.js) 的合并版）。
3. **收起 → 展开往返**：收起后只剩一颗写着「展开」的小按钮；点它横幅与胶囊都回来；把所有可点元素逐个点一遍（除收起叉与收起按钮外）都不许让横幅与胶囊消失。收起状态按工作区记住：切到另一个工作区仍是展开、切回来仍是收起。
4. **宽度扫描（真 Chromium + 宿主几何）**：900 → 240 每 6px 一档，档号涨几可见单位就少几；四枚计数器数字与所有图标在任何宽度都在 DOM 里可见；宽度回弹后可见字集合只增不减。
5. **会话切换不串**：A 会话交接草稿不会覆盖 B 会话正在打的字；C3 不显示 A 会话的票；A、B 各自的横幅进度不互相顶替。
6. **工作区切换不串**：切工作区后横幅重新判定（旧工作区的快照/链不显示在新工作区头上），计数与时间刷新到新工作区。
7. **后端未选择这条完整旅程**：蓝条出现 → 「还没读到」与「确实没设置」两态可区分 → 点主按钮开门控窗 → 选一个可用后端、确认 → 窗关、蓝条消失，并在**同一次交互内**出现下一步该出的横幅（不许等后台 8 秒定时器）。
8. **右侧栏关闭时点胶囊**：右栏被打开、面板内容出现；同时模态座位（建仓弹窗/布局卡）在右栏没开的情况下也能自己弹出来。
9. **收起态里打开 SetupCard**：先在黄条那一步点出布局卡 → 收起整条功能区 → 卡仍在屏上（盖子来自收起分支里的座位）→ 取消与确认两条路的行为都不变。
10. **技能入口注入**：悬停技能入口出名单，点某个技能名，输入框里出现 `/<技能名>\n` 形式的草稿；同时日志菜单是关着的（两者互斥）。
11. **日志入口读屏级旅程**（调试开关打开时）：绿点常驻 → 悬停 200ms 出四键菜单 → 点「清空今日日志」出确认框 → 确认后出「人工关掉才消失」的结果横幅，失败时带重试。
12. **没有 React 崩溃**：点黄条主按钮、点收起叉、点收起态小按钮、在展开态点胶囊与各段，全程 console 无未捕获错误，且胶囊与横幅不会整棵消失（[verify-669](../../dsh-mattpocock-skills-deck/tests/verify-669-collapsed-recoverable.js) C 组与 D 组反证一起跑）。

## 5. 现有门禁怎么复用，合并后还要新增什么

### 5.1 合并后可直接复用（只改路径/取源，不改判据）

| 门禁 | 管什么 | 合并后要动的只有 |
|---|---|---|
| [verify-cap-fold.js](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold.js) | 阶梯判据、机器接线、真渲染扫宽度、删轮询后的两条兜底 | 取源改成合并后的 client 产物路径 |
| [verify-cap-fold-browser.js](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold-browser.js) | 照抄宿主几何量「载荷不撤 / 无效测量不推进 / 可回弹 / 宽度变化必重算」 | 同上；fixture 里的宿主几何来自 DSH 安装包，不受合并影响 |
| [verify-640-dock-width-browser.js](../../dsh-mattpocock-skills-deck/tests/verify-640-dock-width-browser.js) | 容器左右边 == 输入卡左右边（容差 1px） | 同上；拿不到宿主包时它会 SKIP，合并验收要设 `DSWS_REQUIRE_HOST_BUNDLE=1` 防假绿 |
| [verify-capsule-narrow.js](../../dsh-mattpocock-skills-deck/tests/verify-capsule-narrow.js) / [verify-capsule-layout.js](../../dsh-mattpocock-skills-deck/tests/verify-capsule-layout.js) | 不换行、`data-fold-priority` 契约、点击契约、间距几何 | 双源路径（`client.js` / `package/lib/client.js`）改名 |
| [verify-669-collapsed-recoverable.js](../../dsh-mattpocock-skills-deck/tests/verify-669-collapsed-recoverable.js) | 收起态写法、收起/展开行为、反证 | 取源路径 |
| [verify-671-modal-global-overlay.js](../../dsh-mattpocock-skills-deck/tests/verify-671-modal-global-overlay.js) | 弹窗座位在状态栏、三条分支都带、与右栏无关 | 取源路径 |
| [verify-926-capfold-gate.js](../../dsh-mattpocock-skills-deck/tests/verify-926-capfold-gate.js) | 折叠机的守卫等价 / 变化重算 / 未知不缓存 / 换代重算 | 取源路径 |
| [verify-chain-capsule.js](../../dsh-mattpocock-skills-deck/tests/verify-chain-capsule.js) | C3 的判据、版面纪律、12 段让位表未被擅动 | 取源路径 |
| [verify-log-statusbar.js](../../dsh-mattpocock-skills-deck/tests/verify-log-statusbar.js) | 日志小点两色/直径、四键接线、回退形态、反馈闭环 | 取源路径 |
| [verify-statusbar-filter-reset.js](../../dsh-mattpocock-skills-deck/tests/verify-statusbar-filter-reset.js) | C4/C5/C6 三段过滤互不残留 | 取源路径 |
| [verify-t3-locale.js](../../dsh-mattpocock-skills-deck/tests/verify-t3-locale.js) | 中英键平衡、无悬空 `tr()` 键 | 合并后要在**并集字典**上跑 |
| [smoke-render.test.js](../../dsh-mattpocock-skills-deck/tests/smoke-render.test.js) | jsdom 真挂载 dock 占用者 | 合并后产物路径，外加断言 Resident 那两条设置页注册仍在 |
| [verify-slot-idempotency.js](../../dsh-mattpocock-skills-deck/tests/verify-slot-idempotency.js) | 6 个槽位各只注入一次 | 槽位名单要改成「合并后并集」（6 个 Deck 槽 + 2 条 Resident 的 `settings.section`） |
| [verify-deck-slots.js](../../dsh-mattpocock-skills-deck/tests/verify-deck-slots.js)、[verify-build-artifacts.js](../../dsh-mattpocock-skills-deck/tests/verify-build-artifacts.js) | 五座位契约、双产物一致 | 取源路径；`gateSingleDeclaration` 的组件名单要扩容 |

### 5.2 合并后必须新增（都是「单 Client 装配」特有的风险，现有门禁不覆盖）

| 新门禁 | 要拦住的退化 | 建议判据 |
|---|---|---|
| N1 单模块壳 | 两个 `window.__ModuleLoader__.load` 并存，或两次 `apply` 导致槽位重复注册 | 静态：合并产物全文 `__ModuleLoader__.load(` 出现 1 次、模块 id 唯一、`apply` 函数体含两半；动态：[verify-ui.mjs](../verify-ui.mjs) B 段那种「stub ModuleLoader 跑一遍 client.js」的加长版 |
| N2 槽位并集与顺序 | 功能栏被挤到 todo/goal/queue 之前，或 dock 出现两个占用者 | 断言注册集合恰好 = {dock 1 条(id/order 40)、tool.view.cordis、settings.plugins.tab、settings.section×3、右栏 2 条}；dock 的 order 严格大于宿主 0/10/20 |
| N3 `inject` 并集 | 合并后 `exports.inject` 只带 Resident 那项，Deck 的 `locale/workspaces/sessions` 拿不到 → 胶囊文案或会话信息静默缺失 | 断言 `exports.inject` 是并集 `['connection','slots','locale','workspaces','sessions']`，且 apply 期不因缺服务而静默跳过 |
| N4 闭包重名 | 两半拼进同一闭包后顶层标识符撞名（如 `SKILLS`、`Icon`、`StatusBar`、`h`、`React`），后声明覆盖前者 → 运行期行为漂移 | 静态扫描合并后的 apply 闭包顶层声明，重复名一律失败；`gateSingleDeclaration` 扩容到 `['StatusBar','DetailsDock','SettingsPage','RunPanel','IssueDetail','Panel','RegistryPanel']` |
| N5 折叠状态机不被顺手改 | 合并时把「每次提交后重算一次」的副作用删掉（当年就是这条替掉了 2 秒轮询），窄屏卡在错档位 | 复用 [verify-926](../../dsh-mattpocock-skills-deck/tests/verify-926-capfold-gate.js) 的接线断言，并对合并产物跑一次宽度扫描 |
| N6 主题与 i18n 并集 | 合并后 CJK 明文混进 `statusbar/`（门禁扫 CJK），或两半的同名词典键互相覆盖 | 在合并产物上跑 locale 平衡 + 悬空键 + CJK 扫描；词条键冲突单列 |
| N7 样式注入与类名 | 两半各插一段 `<style>` 或前缀撞车（`ghr-*` / `ghreg-*` / `dsws-*`） | 断言样式注入只发生一次；`dsws-` 与 `ghr-`/`ghreg-` 交叉匹配数为 0 |
| N8 真机/真浏览器复跑 | 「源码还在但页面变了」 | 在合并产物上重跑 [verify-cap-fold-browser](../../dsh-mattpocock-skills-deck/tests/verify-cap-fold-browser.js) / [verify-640](../../dsh-mattpocock-skills-deck/tests/verify-640-dock-width-browser.js) / [verify-669](../../dsh-mattpocock-skills-deck/tests/verify-669-collapsed-recoverable.js) / [verify-671](../../dsh-mattpocock-skills-deck/tests/verify-671-modal-global-overlay.js) |
| N9 宿主占用快照 | 注册写对了、宿主实际没渲染（或渲染在别处） | 合并产物在真 profile 里跑起来后查一次 `Slots.listSubTree(root='conversation.input.dock')`，核对 occupants 为 todo/goal/queue/deck 且 deck `active=true`（本文执笔时该查询超时，未取得快照） |
| N10 设置页合并不得波及功能栏 | 「Deck 设置页并入 Resident 仓库登记页」时误删 `settings.section#dsws-settings-section` 的同一次改动顺手碰掉了 dock 注册 | 断言 dock 注册仍在不依赖任何 settings 服务的代码段里；删除设置页入口的那次提交单独跑一遍 N2 |

## 6. 给客户端代码作者的最短清单

- 只动「注册所在的装配段」与「两半如何拼进一个 apply」，不动 `StatusBar` 及其 12 个叶子文件的行为与标识。
- 保留：`name='conversation.input.dock'`、`id='dsh-mattpocock-skills-deck'`、`order=40`、`withCx(StatusBar)` 这条注册的完整形状。
- 保留全部 `data-fold-priority` 号码（1–12）、`.dsws-capsule` / `.dsws-banner` / `.dsws-modal` / `data-dsws-logdot` / `data-dsws-logmenu`、`cap.dataset.foldTier` / `cap.dataset.fold` —— 这些是门禁的把手。
- 三条分支（收起 / 无横幅 / 有横幅）都要继续带 `modalSeat`；收起态只允许出现「展开」小按钮与那张座位。
- 合并后跑一遍第 4 节的 12 条集成场景与第 5.2 节的 N1–N10；第 5.1 节的门禁改路径后必须全绿。
- 未验证项要如实写：本文作者没有独立取得宿主运行态占用快照（查询超时），也没有做真机视觉验证；这两件事要由合并后的 N9 与真浏览器门禁补上。
