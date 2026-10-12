# 原型 #5 · 窄屏横滑条（钉住区 / 滚动手感 / 触屏点开）

**这是用完即弃的原型，不是实现。** 它回答一个问题（票 [#5](https://github.com/SunsetRNE/dsh-github-resident/issues/5)）：

> 393px 竖屏上，这条横条（`conversation.input.dock` 那条胶囊 + `capFold` 阶梯）怎么滚、左端钉不钉、
> 触屏点开一个菜单点不点得中、窄屏下单行高度与黄条怎么排，同时仍要推进「顺手」？

形态按 `prototype` 技能判的 **LOGIC 分支**（票面问的是「滚动手感 / 点开规则 / 排布」这类状态与手感，
不是「界面上换几套皮」），所以产出是一个**单文件可分享 HTML**：自由操作按钮 + 四条引导式走查 + 一个把
全部相关状态摊开的状态面板。真 CSS 片段从 `deck/src/client/kernel/styles.js` 原文照抄，**不接插件运行时**。

## 跑起来（两种，都不用动仓库依赖）

```bash
# ① 手机浏览器（竖屏最真实）：从这一层起一个静态服务，再在手机浏览器打开这个地址
cd deck/research/prototype-5-narrow-scrollbar && python3 -m http.server 8791 --bind 0.0.0.0
# 手机浏览器打开 http://127.0.0.1:8791/narrow-scrollbar-PROTOTYPE.html     （视口 < 760px 时页面自动压成单列）
```

```bash
# ② 桌面浏览器双击打开就行（不启服务也可以）：file:///<仓库>/deck/research/prototype-5-narrow-scrollbar/narrow-scrollbar-PROTOTYPE.html
# ③ 无头复验（量数 + 自检读数 + 截图）：
npm i playwright@1.56.0 --prefix /tmp/pwproto
cd deck/research/prototype-5-narrow-scrollbar/verify && NODE_PATH=/tmp/pwproto/node_modules node verify-prototype.cjs
```

## 这一页怎么用

- **左边那一条是真跑的**：改宽度、滚、点开菜单，都会走 `narrow-scrollbar-PROTOTYPE.html` 里那个**纯逻辑模块**
  （`CAP_ITEMS` / `CAP_CUT` / `buildLadder` / `pickTier` / `placeOverlay` / `reduce`，不碰 DOM、不碰事件）。
  答案定下来之后，那一层可以直接搬进实现；页面外壳是抛的。
- **形状开关**四组：钉住区（不钉 / 钉住+线 / 钉住+渐隐 / 钉住无线）、滚动提示（无 / 两端渐隐 / 细滚动条 / 边缘箭头）、
  密度（照现状 / 放松）、弹层定位（夹取 / 只按锚点）。切换只改显示，状态模型不动。
- **自由操作** + **四条走查**：L1 钉住区、L2 滚动手感、L3 触屏点开、L4 高度/横幅。每条走查最后一步都带「定论」按钮，
  按下去就是维护者的取舍，写回票正文。
- **状态面板**每步整块重画，改过的格子亮一下；**几何自检**给的是这个浏览器当场量的数（不是推算）。

## 键盘上量到的数（Chromium 1208 容器 + 393px 视口，2026-10-12）

| 量到的东西 | 值 | 说明 |
| --- | --- | --- |
| 横条容器（`dock`） | 367px | = 列宽 367（`393 − 2×12`）− 0，`min-width:0` 之后不再被内容撑宽 |
| 滚动窗 / 内容 | 272px / 496px | 钉住区吃掉 49px，尾巴 30px |
| 溢出 | 224px | 12 段字全展开时；阶梯收到第 17/17 档（收到底）后仍溢出，靠横滑 |
| 触屏点按目标 | 11 个里 11 个 < 44px | 最小 16×6（时间串），最大 69×23；横条本体高 33px |
| 弹层（夹取） | 右缘超出 −7px（不越界） | 只按锚点那档：**越出横条右缘 117px** |
| 弹层宽度 | 168px（可接菜单） | 窄屏下必须夹取，否则被视口切掉 |

截图：`measurements/m4-412-真手机视口（自带脱壳）.png` 是真手机（OnePlus PJD110 / Android 16，412px 视口）
里的页面；其余 `m1`~`m3` 是桌面 Chromium 量几何用的，`screenshots-raw/` 是同一批的原始编号。
**容器 Chromium 没有中文字体**，那些截图里的汉字是豆腐块 —— 字宽仍然算得对（CJK 按 1em），真机截图里字体正常。

## 归档与留档

- 原型本体与截图只住在**抛弃式分支** `prototype/ig5-5-narrow-scrollbar`，不进 main（main 只留验证过的决定）。
- 本票的取舍清单与进度写在票 [#5](https://github.com/SunsetRNE/dsh-github-resident/issues/5) 正文；
  落地那一张是 [#6](https://github.com/SunsetRNE/dsh-github-resident/issues/6)。
- 已知边界：这里量的是「一条 12 段字的横条」，没有接插件运行时，也没有真机字体度量；窄屏最终值以真机复验为准。
