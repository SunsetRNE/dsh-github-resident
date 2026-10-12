# 研究：窄屏阈值取证 —— 功能条（`conversation.input.dock` 那条胶囊）的载荷最小宽、各宽度停档与截断点

- 票：#4「窄屏阈值取证：载荷最小宽、各宽度停档与截断点」（`wayfinder:research`）
- 日期：2026-10-12
- 方法：Chromium 120 真渲染 + 页内复刻 `capFold`/`capFoldMachine` 的判据与阶梯，逐宽度量 `clientWidth` / `scrollWidth` / 逐项右缘
- 状态：数字全部为实测（真浏览器量尺）；`RDOM` 一条为产物级推断，已单独标注

---

## 结论摘要

1. **载荷档（12 段字全收光）的自然宽 = 443.69px（胶囊外框）**；内容（12 个孩子 + 11×6px 列间距）= 429.69px；走位机器那把尺子（孩子强制 `flex:0 0 auto` 时的 `scrollWidth`）= **436px**。
2. **硬地板：容器（列）宽 469px**（= 胶囊外框 437px）。低于它，阶梯收到最后一档仍判「放不下」——阶梯再也让不出东西。实测：容器宽 ≤ 468 时停在第 33 档（收到底），容器 ≥ 479 才留得住「在办号」的最后一个字符。
3. **真正被外层截（右缘切掉）从容器宽 454px 起**，被截顺序**严格自右向左**：收起∨（≤454）→ 日志点（≤432）→ 技能（≤416）→ 时间（≤390）→ 环境（≤357）→ 交接分割（≤321）→ 沉淀（≤260）。题面预期的「先收起∨、再日志点」被数字证实，并且还有后续四级。
4. **393px（典型手机宽）实测**：胶囊 361px、阶梯停在最后一档（12 段字一个不剩）、内容溢出容器右缘 **61.70px**，被截的是【技能 · 日志点 · 收起∨】——注意「收起整个功能区」的那颗按钮此刻点不到。
5. **九段字全展开（第 0 档）需要列宽 ≥ 1240px**（实测；该档尺子 822px → 需 `clientWidth` ≥ 821 → 胶囊外框 ≥ 823）。
6. `RDOM`（决定外层 `overflow` 是 `hidden` 还是 `visible`）**在打包形态下取得到**，因此上面第 3、4 条那种截断是真实生效的那一支（推断，见第五节）。
7. **推荐阈值：胶囊外框 468px**（= 载荷 443.69 + 24 余量），等价容器（列）宽 **500px**（`--dsh-composer-side-clearance = 16px` 时）/ 484px（8px 时）。它落在「列宽绑宽」区间（< 712 的卡宽上限），因此**不能**拿 `--dsh-composer-card-max-width` 或 680px 兜底当判据——那两个值在小屏上恒大于阈值，等于永不触发。

---

## 一、方法与可复现命令

真渲染通道（沿用已验证过的组合）：`~/.cache/ms-playwright/chromium-1091` 的 **Chromium 120** + 启动参数 **`--disable-dev-shm-usage`**（本容器没有 `/dev/shm`），驱动用 `/tmp/pwold` 下那套 **playwright@1.40.0**；仓库依赖一个字节没动，仓库外全部落在 `/tmp/narrowfix/`。

- UA（实测）：`Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.6099.28 Safari/537.36`
- 字体：容器只有 Liberation Sans（Arial 的等宽替代）与 WenQuanYi Zen Hei（中文）；页面 `document.fonts.size = 0`。字体差异已列入「未验证之处」。

脚本（一次性，均在 /tmp，不进仓库）：

- `/tmp/narrowfix/measure.mjs` —— 生成 fixture + 8 档量测 + 260..700 细扫
- `/tmp/narrowfix/diag.mjs` —— 逐档尺子宽（验证「尺子与容器宽无关」）
- `/tmp/narrowfix/wide2.mjs` —— 宽屏修正扫描（找第 0 档出现的列宽）
- 产物：`/tmp/narrowfix/fixture.html`、`/tmp/narrowfix/extracted.css`、`/tmp/narrowfix/result.json`

```bash
cd /tmp/narrowfix && node measure.mjs      # 8 档数字表 + 载荷档自然宽 + 截断细扫
cd /tmp/narrowfix && node diag.mjs         # 每档尺子宽（320 与 900 两个视口对照）
cd /tmp/narrowfix && node wide2.mjs        # 列宽 900..1440 的停档（第 0 档何时出现）
```

`measure.mjs` 里的 CSS 不是手抄的：它按选择器前缀从 `deck/src/client/kernel/styles.js` **原文抽取**（抽不到直接 `process.exit(1)`），抽出的 18 条规则落盘在 `/tmp/narrowfix/extracted.css`。

## 二、被测对象（原样复刻）

### 2.1 CSS（`deck/src/client/kernel/styles.js` 原文，行号为该文件行号）

| 行 | 选择器（原文起点） |
| --- | --- |
| 96 / 97 | `.dsws-seg{...}` / `:hover` |
| 99–104 | `.dsws-split{...}` / `:hover` / `.dsws-split-part` / `:hover` / `.dsws-split-div` / `.dsws-split:hover .dsws-split-div` |
| 105 / 106 | `.dsws-timebtn{...}` / `:hover` |
| 110 | `.dsws-num{...min-width:5ch...}` |
| 140 | `.dsws-capsule{width:100%;box-sizing:border-box;display:flex;flex-wrap:nowrap;white-space:nowrap;justify-content:space-between;...gap:2px 6px;...padding:3px 6px;font-size:12px;...}` |
| 148 | `.dsws-capsule{max-width:var(--dsh-composer-card-max-width, 100%)}` |
| 151 / 152 | `.dsws-capsule .dsws-capsule-word{...flex:0 1 auto;min-width:0;max-width:max-content;...}` |
| 153 | `.dsws-capsule .dsws-seg{flex:none}` |
| 154 | `.dsws-capsule .dsws-timebtn{flex:none}` |
| 165 | `.dsws-capsule [data-fold-priority].dsws-folded,[data-head-fold].dsws-folded{display:none}` |

外层容器照 `StatusBar.js:36` 的 `dswsStatusDockGeom()` 原文（`width: calc(100% - 2*var(--dsh-composer-side-clearance,0px))`、`maxWidth: var(--dsh-composer-card-max-width,100%)`、`padding: 3px 0 0`），并加上 `StatusBar.js:300` 那一处唯一的 overflow 分支。宿主变量照题面给的算式：`--dsh-composer-card-max-width = clamp(680px, 列宽×0.64, 920px) + 32px`、`--dsh-composer-side-clearance = 16px`。

### 2.2 DOM 子元素顺序与文字（照 `StatusBar.js:240`–`:281`）

品牌（罗盘 14 + `panel.title`『GitHub 常驻』，优先级 1）→ 会话链（图钉 12 + 在办号 `#4`，优先级 12）→ 可接（target 12 + 『可接』9 + 计数 2ch）→ 故障（alert 12 + 『故障』10 + 计数 2ch）→ 诊断（search 12 + 『诊断』11 + 计数 2ch）→ 沉淀（note 12 + 『沉淀』7）→ 交接分割（handoff 12 + 『交接』8 ‖ 灰态 handoff-off 12）→ 环境（check 14 + 『环境』4 + `envLabel` 8/8，挂在 `.dsws-num` 上，优先级 5）→ 时间（refresh 11 + 『更新』2 + 日期『 10-12』3 + 时间『 12:42』6）→ 技能（skills 12）→ 日志绿点（10px）→ 收起∨（chev-down 12）。

词条取自 `deck/src/client/kernel/locale-panel.js` 的 zh 段（`panel.title` / `nav.takeable` / `nav.bug` / `nav.triage` / `nav.word` / `nav.handoff` / `nav.env` / `nav.refresh`）；图标为 `kernel/icons.js` 里 `Ic` 的**原文路径**（含 `handoff` / `handoff-off` / `skills` / `chev-down` / `check` / `refresh` 等），尺寸取调用点实参。

### 2.3 让位逻辑（页内按 `capFold.js` + `capFoldMachine.js` 的契约复刻）

- 阶梯按 `CAP_FOLD_POLICY` 排：1/3/5/6/12 用 `char`（一次少一个字），2/4/7/8/9/10/11 用 `word`（整段一次收完）；本组文字下阶梯共 **34 档**（第 0 档 + 33 步）。
- 收起来的形状与机器一致：给 `[data-fold-priority]` 元素写空串并加 `.dsws-folded`（`display:none`）。
- 放得下判据照 `capFoldFits`：把孩子一律强制 `flex:0 0 auto` 后比 `scrollWidth ≤ clientWidth + 1`。
- 停档：从第 0 档往下走，停在**第一个放得下的档**；都放不下就停在最后一档。

## 三、载荷档（完全没有字的档）的自然宽 —— 单列的一个数

把 12 个 `[data-fold-priority]` 全部收空（= 阶梯最后一档，只剩图标 + 计数数字 + 日志点 + 收起∨），在超宽容器里量胶囊外框的自然宽：

| 口径 | 数值 |
| --- | --- |
| 胶囊**外框**自然宽（`width:max-content` 实测） | **443.69px** |
| 内容宽（12 个孩子 + 11×6px 列间距） | 429.69px |
| 机器尺子口径（强制 `flex:0 0 auto` 的 `scrollWidth`） | **436px** |

逐项（实测，px）：brand 30.00 / chain 12.00 / take 45.23 / bug 45.23 / triage 45.23 / fixate 28.00 / split 55.00 / env 30.00 / time 27.00 / skills 20.00 / logdot 10.00 / toggle 16.00 → 合计 **363.69**，加 11 个 6px 列间距（66）= 429.69，加 12px 内边距 + 2px 边框 = 443.69。

分解可逐项对上 CSS：可接/故障/诊断各 = 7+7 内边距 + 2 边框 + 图标 12 + 一个 4px 间隙 + 2ch 计数（13.23）= 45.23；环境 = 16 + 图标 14 = 30（字与计数两段都 `display:none`，也就不产生间隙）；时间 = 16 + 图标 11 = 27；分割 = 26 + 1 + 26 + 2 边框 = 55；技能 = 4+4 内边距 + 12 = 20。**注意 `.dsws-num` 的 `min-width:5ch` 在折叠态不占位**（`display:none` 优先），所以环境计数收空后是 0 而不是 33px。

## 四、8 档数字表（容器宽 = 列宽，`--dsh-composer-side-clearance = 16px`）

`scrollWidth` 两个口径都给：**原始**（按当前 flex 分布实渲）与**尺子**（孩子强制 `flex:0 0 auto`，即 `capFoldFits` 用的那一把）；「被截」= 该元素右缘 > 外层容器右缘（外层 `overflow:hidden` 时就是被切掉），由逐项 `getBoundingClientRect()` 判定。

| 容器宽 | 胶囊外框 | 胶囊 `clientWidth` | `scrollWidth`（原始） | `scrollWidth`（尺子） | 停在第几档 | 还剩哪些字 | 右缘溢出 | 被截元素（自右向左） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 320 | 288 | 286 | 422 | 436 | 33 / 33（收到底） | 无 | +134.70px | split, env, time, skills, logdot, toggle |
| 360 | 328 | 326 | 422 | 436 | 33 / 33（收到底） | 无 | +94.70px | time, skills, logdot, toggle |
| 393 | 361 | 359 | 422 | 436 | 33 / 33（收到底） | 无 | +61.70px | skills, logdot, toggle |
| 412 | 380 | 378 | 422 | 436 | 33 / 33（收到底） | 无 | +42.70px | skills, logdot, toggle |
| 480 | 448 | 446 | 446 | 446 | 32 / 33 | 仅『#』 | −7.00px | 无 |
| 600 | 568 | 566 | 566 | 566 | 27 / 33 | 交接 · 可接 · 故障 · 诊断 · #4 | −7.00px | 无 |
| 768 | 712 | 710 | 710 | 710 | 13 / 33 | 日期『 10』· 环境 · 8/8 · 时间『 12:42』· 沉淀 · 交接 · 可接 · 故障 · 诊断 · #4 | −7.00px | 无 |
| 900 | 712 | 710 | 710 | 710 | 13 / 33 | 同 768（卡宽上限 712 已封顶，900 与 768 同档） | −7.00px | 无 |

说明：

- 「尺子」列在内容小于可用宽时下限就是 `clientWidth`（`scrollWidth` 的定义），所以 480/600/768/900 四行它等于 `clientWidth`，不等于内容自然宽。
- 480 那一行「只剩 #」、768/900 两行停在 13 档且 900 与 768 完全同档，都是**实测**，不是推算。
- 右缘溢出为负 = 内容没顶到容器右缘（−7px 恰是胶囊右内边距 6 + 边框 1，即刚好贴边）。

## 五、谁被切：从哪个宽度开始、按什么顺序

细扫 260–700 每 1px 一次（同一档位逻辑），按「被截元素第一次出现的最小容器宽」排出顺序：

| 顺序 | 元素 | 被截的容器宽区间 | 容器 393 时的实测右缘 |
| --- | --- | --- | --- |
| 1 | **收起∨**（`chev-down`） | ≤ 454 | 438.70（容器右缘 377 → 超出 61.70） |
| 2 | **日志绿点** | ≤ 432 | 416.70 |
| 3 | 技能入口 | ≤ 416 | 400.70 |
| 4 | 时间（刷新 + 日期 + 时间） | ≤ 390 | 374.70（最后一个没被截的） |
| 5 | 环境（对勾 + 计数） | ≤ 357 | 341.70 |
| 6 | 交接分割（两半 + 分隔线） | ≤ 321 | 305.70 |
| 7 | 沉淀 | ≤ 260 | 244.70 |

- 顺序**严格自右向左**，与 DOM 顺序互为逆序：外层把溢出的右半边切掉，先掉最右那颗。
- 393 那一行的逐项右缘（实测）就是上面的数字：容器右缘 377，技能 400.70、日志点 416.70、收起∨ 438.70 全在右缘之外 → 三者被切。
- 关键边界（容器宽，clearance 16）：
  - **≤ 454 开始真被截**（先掉收起∨）；
  - **≤ 468 连「收到底」都仍判放不下**（尺子 436 > `clientWidth + 1`）→ 硬地板 437px 胶囊 / 469px 容器；
  - **≤ 478 阶梯已收到底**（12 段字一个不剩）；
  - **≥ 479 至少留得住「在办号」的最后一格**；**≥ 1240 才可能出现九段全展开（第 0 档）**。

## 六、档位 → 需要多少可用宽（把阈值算清楚的中间量）

尺子宽与容器宽无关（同一档在 320 与 900 两个视口下量到同一个数，`diag.mjs` 对照过）：

| 阶梯档 | 该档还剩什么（择要） | 尺子 `scrollWidth` | 需要 `clientWidth` ≥ | 对应胶囊外框 ≥ |
| --- | --- | --- | --- | --- |
| 33（最后一档） | 全空，只剩图标 + 计数 + 绿点 + 收起∨ | 436 | 435 | 437 |
| 32 | 在办号『#』 | 446 | 445 | 447 |
| 31 | 在办号『#4』 | 453 | 452 | 454 |
| 30 | 诊断 + 『#4』 | 481 | 480 | 482 |
| 27 | 交接 · 可接 · 故障 · 诊断 · #4 | 565 | 564 | 566 |
| 20 | 上述 + 环境/计数/沉淀/时间 | 626 | 625 | 627 |
| 10 | 上述 + 日期与部分品牌字 | 726 | 725 | 727 |
| 5 | 品牌字只剩尾字 | 780 | 779 | 781 |
| 0 | 九段全展开 | 822 | 821 | 823 |

（换算式：`clientWidth = 胶囊外框 − 2`；容器宽 = 胶囊外框 + 2×clearance。上表最后两列之差就是 2px 边框。）

## 七、`RDOM` 在运行中的 GUI 里取不取得到 —— **产物级推断，非实测**

按题面要求没有去读 3080 页面、没有碰运行态。以下是代码/产物层的证据链，结论标注为**推断**。

1. `deck/src/client/kernel/portal.js:18-23` 的 `RDOM` 是三路探测：① 闭包里的 `ReactDOM`；② `window.ReactDOM`；③ `require('react-dom')`——三路都拿不到 `createPortal` 才是 `null`，那才落到 `StatusBar.js:300` 的 `overflow:'visible'`。
2. 打包形态（`deck/package/lib/client.js:52-59`，也就是 `cordis_define` 的 `code.client` 那一段）是模块系统注册：`window.__ModuleLoader__.load({ id: 'dsh-github-resident-v2', factory: (require) => { ... const React = require('react') ... } })`。**factory 的第一个参数就是模块系统的 `require`**，所以第 ③ 路探测里的 `require` 不是 `undefined`。
3. 宿主侧 `dsh-client-modules/lib/client.js:548/700` 的解析顺序是「platform seed word → 已物化模块 → 注册的包工厂」，而 web 壳（`dsh-web-frontend/dist/assets/index-5SrrfWpU.js`）里那张 seed 表原文是
   `{react: …, "react/jsx-runtime": …, "react-dom": …, "react-dom/client": …, "@deepseek-ai/cordis": …, …}`，
   所以 `require('react-dom')` 会命中 seed 表、返回宿主自己的 react-dom 实例（带 `createPortal`）。旁证：宿主自带的多个客户端插件（`dsh-client-ui-chat` / `-conversation` / `-renderer` / `-schedule` …）都在同一套加载器下写 `let react_dom = require("react-dom")`。
4. 打包产物 `deck/client.js`（2,263,745 字节）里**没有** react-dom 的实现痕迹：`createRoot` / `react-dom/client` 出现 0 次，`react-dom` 这三个字全文件只出现 1 次——就是上面那条探测语句本身。也就是说 react-dom 只能由宿主提供，而第 3 条说明宿主确实提供。
5. 因此推断：**`RDOM !== null`，走的是 `overflow:'hidden'` 那一支**；`cx.rdom`（`panelAssembly.js:25` 把 `rdom: RDOM` 放进 G3 冻结清单）同样非空，弹层 `createPortal` 正常。反过来说：第四、五节量到的「右缘被切」就是线上真实那一支的表现；若某天 `RDOM` 退化成 `null`，同样这些元素不会被切，而是**溢出到列外**（画到输入区/侧栏上方）——那是另一种坏法，不是修复。

**为什么这是推断**：没有在运行中的页面里跑 `RDOM` 求值、没有读 3080。上面每一步都可在本地复现（命令：`grep -n "require('react-dom')" deck/src/client/kernel/portal.js`；`grep -c "createRoot\|react-dom/client" deck/client.js`；`sed -n '52,60p' deck/package/lib/client.js`；`grep -rn '"react-dom"' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js`）。

## 八、推荐阈值

### 8.1 数值

**判据写「胶囊外框 ≥ 468px」**，等价**容器（列）宽 500px**（`--dsh-composer-side-clearance = 16px`）/ **484px**（8px）。

### 8.2 余量算法

| 项 | 值 | 来源 |
| --- | --- | --- |
| 载荷档自然宽 | 443.69px | 第三节实测 |
| 计数位数余量 | +20px | 三处计数各按 2ch 最小宽计；从 2 位涨到 3 位各多约 6.6px（`--ds-font-family-code` 等宽 11px） |
| 刷新态余量 | +1px | `dsws-spinner` 12px 换掉 refresh 图标 11px |
| 取整/抖动 | +3px | 亚像素与整数 `scrollWidth` 的 ±1 往返 |
| 合计 | **468px** = 443.69 + 24 | |

再换算成容器宽：`468 + 2×16 = 500`；`468 + 2×8 = 484`。

- **硬地板（不含余量，实测）**：胶囊 437px / 容器 469px。低于它，阶梯收到底也放不下（第六节第一行）。
- 推荐值 468 比硬地板高 31px（≈ 7%），覆盖上面三项浮动。

### 8.3 它相对卡宽上限与 680px 兜底的位置

- 宿主卡宽上限 `--dsh-composer-card-max-width = clamp(680px, 列宽×0.64, 920px) + 32px`：列宽 ≤ 1062.5px 时它恒等于 **712px**。
- 胶囊实测宽 = `min(列宽 − 2×clearance, 712)`；两者的交叉点在**列宽 744px**（clearance 16）。推荐阈值 500px 远在这条交叉线之下，也就是说**窄屏上真正绑宽的是列宽（dock），不是卡宽上限**。
- **680px 兜底（以及 712px 的卡宽上限）不能当判据**：它们在小屏上恒大于阈值——393px 的手机上卡宽上限仍是 712，比整个列还宽 319px。拿它当门口等于永不触发。
- 误触发分析：映射单调。clearance 16 时，列宽 500 ≤ W ≤ 744 区间胶囊 = W−32 ≥ 468 → 不触发；W > 744 时胶囊 = 712 ≥ 468 → 不触发；只有 W < 500 才触发。所以**只要判据挂在「胶囊/容器实测宽」上就不会误触发**。
  - 唯一要小心的一处：若把判据写成「列宽 < 500」这个写死的数字，则在 clearance = 8px 的宿主上、列宽 484–500 这一段会提前进入窄屏态（保守方向，不会漏判）。所以判据应写成「容器实测宽 < 468 + 2×clearance」或直接量胶囊。
- 触发之后做什么，不在本票范围（本票只给阈值与测量）；但数字给出了两个可用的支点：载荷档 443.69px 是「什么都不藏也放不下」的绝对下限，437px 是阶梯的硬地板。

## 九、近似与未验证之处

**近似（复刻与真实渲染之间的差）**

1. 页内这台机器是**近似**：判据（`capFoldFits`：强制 `flex:0 0 auto` 后比 `scrollWidth ≤ clientWidth + 1`）、阶梯（`CAP_FOLD_LADDER` 的 `char`/`word` 切法）、写 DOM 的方式（写空串 + 加 `.dsws-folded`）都照原文，但**没有**复刻 `capFoldMachine` 的三件外围事：① 首帧起始态（`CAP_FOLD_START_FOLDED = ['1']`：还没量到可用宽时品牌字收起）；② 输入指纹守卫（`room|段数|字散列`）与上一档起步的回弹；③ `keep.full` 的跨调用记忆。三者都只影响「哪一趟算、从哪档起步」，不改变「停在哪一档」的结果——本 fixture 每次都从第 0 档重走一遍，等价于冷启动的那一趟。
2. 复刻的是**状态**而不是**会话状态机**：计数取 `可接 3 / 故障 2 / 诊断 1 / 环境 8/8 / 在办 #4`，`logDotOn = true`（日志绿点挂载）、`handoffReady = false`（灰态右半）。换一组数字，载荷档那几个宽度会平移（见 8.2 的计数位数余量），阶梯停档的**位置**也会变；**载荷地板 443.69 与各级截断阈值**随之变化——这是状态相关量，报告里所有数字都对应上面这一组状态。
3. fixture 里 `--dsh-composer-card-max-width` 用 `calc(clamp(680px, 64%, 920px) + 32px)` 这种**带百分比**的写法（宿主真源若是 JS 算好的 px 值，见仓库自带 `deck/tests/fixtures/640-dock-width-repro.html` 的 px 写法）。百分比会在两层各自解析一次（外层 64% 对列宽、胶囊自己对 wrapper 宽），列宽 > 1063px 之后两者分叉——**本报告 ≤ 900px 的 8 档数字不受影响**（两层都落在 680px 兜底上，结果同为 712），宽屏扫描已改用 px 写法重测（`wide2.mjs`）后才引用。
4. Browser 只有一种：Chromium 120 / Linux aarch64。Firefox/Safari 未测；`scrollWidth` 的整数取整、`gap` 与 `display:none` 的交互在不同引擎上可能有 1–2px 差。

**未验证（拿不到就写「未取得 + 原因」）**

1. **真机上这些宽度的实测**：未取得 + 原因：本票只允许 /tmp 的一次性 fixture 与只读源码，不动运行中的 GUI（pid 28922 / 3080）。
2. **宿主输入区的真实列宽与 `--dsh-composer-side-clearance` 的实时取值**：未取得 + 原因：不碰运行态；报告里按题面给的算式（16px / 8px 两档）与「列宽 = 视口宽」做参数化。真机上列宽还会被壳的侧栏/内距再收窄，落到阈值上要减去那部分——这一步需要一次真机量尺，本票没做。
3. **字体**：宿主实际字体族未取得 + 原因：运行态不可读。本次用 Liberation Sans（Arial 度量兼容）+ WenQuanYi Zen Hei，`document.fonts.size = 0`。中文字宽随字体浮动（品牌『GitHub 常驻』、『沉淀/交接/可接/故障/诊断/环境/更新』这些字），会影响**停档位置**，不影响只含图标与 ASCII 数字的**载荷地板**（443.69 里没有中文字）。
4. **`RDOM` 的运行时取值**：未取得（见第七节）+ 原因：不去读运行页。结论是产物级推断。
5. **`capFoldMachine` 在真机上的档位数据集**（`cap.dataset.foldTier`）未取得 + 原因：同上；本报告的档位是复刻机器的结果。
6. 载荷档里那颗日志点为**灰态**（`debugOn = false` → `#6b6b75`）时的宽同样是 10px（尺寸不变，只有颜色/阴影变），故未另测。

## 十、原始输出（摘要）

```
UA: Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.6099.28 Safari/537.36
=== 载荷档（全字收起）自然宽 ===
border-box natural = 443.7 px
分解: brand=30, chain=12, take=45.23, bug=45.23, triage=45.23, fixate=28, split=55, env=30, time=27, skills=20, logdot=10, toggle=16
=== 第 0 档（九段全展开）尺子宽 === 822 px   阶梯总档数 = 34
=== 8 档数字表 ===
W=320 col=320 capBorderBox=288 client=286 scroll=422 forced=436 over=true tier=33/33 folded=[1..12] clipped=[split,env,time,skills,logdot,toggle]
W=360 col=360 capBorderBox=328 client=326 scroll=422 forced=436 over=true tier=33/33 folded=[1..12] clipped=[time,skills,logdot,toggle]
W=393 col=393 capBorderBox=361 client=359 scroll=422 forced=436 over=true tier=33/33 folded=[1..12] clipped=[skills,logdot,toggle]
W=412 col=412 capBorderBox=380 client=378 scroll=422 forced=436 over=true tier=33/33 folded=[1..12] clipped=[skills,logdot,toggle]
W=480 col=480 capBorderBox=448 client=446 scroll=446 forced=446 over=false tier=32/33 visible={"12":"#"} clipped=[]
W=600 col=600 capBorderBox=568 client=566 scroll=566 forced=566 over=false tier=27/33 visible={"8":"交接","9":"可接","10":"故障","11":"诊断","12":"#4"} clipped=[]
W=768 col=768 capBorderBox=712 client=710 scroll=710 forced=710 over=false tier=13/33 visible={"3":" 10","4":"环境","5":"8/8","6":" 12:42","7":"沉淀","8":"交接","9":"可接","10":"故障","11":"诊断","12":"#4"} clipped=[]
W=900 col=900 capBorderBox=712 client=710 scroll=710 forced=710 over=false tier=13/33 同 768 clipped=[]

=== 截断细扫（260..700 每 1px）被截元素出现区间 ===
toggle  W ∈ [260,454]
logdot  W ∈ [260,432]
skills  W ∈ [260,416]
time    W ∈ [260,390]
env     W ∈ [260,357]
split   W ∈ [260,321]
fixate  W ∈ [260,260]

=== 逐档尺子宽（320 与 900 两个视口一致，故与容器宽无关）===
tier 0 → 822 | tier 5 → 780 | tier 10 → 726 | tier 20 → 626 | tier 27 → 565
tier 30 → 481 | tier 31 → 453 | tier 32 → 446 | tier 33 → 436

=== 宽屏修正扫描（卡宽按 px 写回；第 0 档首次出现）===
W=1100 cardMax=736  cap=736  tier=10  vis=10
W=1200 cardMax=800  cap=800  tier=2   vis=12
W=1220 cardMax=812.8 cap=812.8 tier=1 vis=12
W=1240 cardMax=825.6 cap=825.6 tier=0 vis=12
W=1300 cardMax=864  cap=864  tier=0   vis=12
W=1440 cardMax=952  cap=952  tier=0   vis=12
```
