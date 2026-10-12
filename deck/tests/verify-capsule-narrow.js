// verify-capsule-narrow.js — 状态栏胶囊窄屏契约 · issue #16（V2：内容自适应渐进收缩）
// 用法: node tests/verify-capsule-narrow.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// V2 契约（2026-08-18 复现后重设计，替代 R1-R13 的 data-narrow 阈值体系）：
//   1) 任何宽度下胶囊禁止换行：.dsws-capsule CSS 含 flex-wrap:nowrap 且不含 flex-wrap:wrap
//   2) 留 gap，center 居中；children flex:none 不被挤压
//   3) 内容自适应渐进收缩（仿 #15）：每个可收缩文字 span 打 data-fold-priority（1=最先收…9=最后收），
//      applyFold 全展开后按 priority 升序逐个加 .dsws-folded，直到 scrollWidth ≤ clientWidth
//      - 优先级 = 信息价值：品牌(1) → 沉淀(2)/交接(3)/刷新字(4) → 可接(5)/BUG(6)/诊断(7)/环境(8) → 时间(9)
//      - 图标+数字永不收缩；最窄态 = 图标+数字紧凑条
//   4) 点击事件契约：capsule→openPanel / capsule-word→togglePanel / seg/split/timebtn→各自 handler
//   5) EN locale：i18n 键齐备（panel.title 中英同字 —— 品牌改名也不许只改一边）
//   6) 双源同步：client.js ↔ package/lib/client.js 的 capsule CSS 块 + JSX 块一致
//
// 2026-10-13（#3）两处改动，都是「让这道门真的能跑、且守的还是原来那件事」：
//   a. 本文件原先是 CJS（require/fs.readFileSync），而本仓 package.json 是 "type": "module"，
//      直接跑是加载即 `ReferenceError: require is not defined in ES module scope` —— 一百多条断言一条都没跑到。
//      改成 ESM（node 内建模块走 import；tests/lib/eval-probe.js 仍是 CJS，借 createRequire 抓一个）。
//   b. 期望 5 的「panel.title zh = "MattSkills" / en = "MattSkills"」两条是**过期断言**：插件的品牌
//      早已是 GitHub 常驻 / GitHub Resident（src/client/kernel/locale-panel.js:16 与 :171），
//      硬写旧字串等于把「守品牌」换成「守某个名字还没改」。原来想守的是那句**中英同字**（同一个品牌
//      在两个 locale 里渲染同一串字，改一边就红），所以改成量真值 + 直接比 zh===en，而不是把判据降级成
//      「字符串还在」。真值不写死在门禁里：品牌再改名时这门仍然守得住，只有「只改一遍」才红。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
// 本文件按文本求值统一走共用入口 compileFn：从产物里切出点击处理体再造成函数（理由与用法见 tests/lib/eval-probe.js 文件头）。
const require = createRequire(import.meta.url)
const { compileFn } = require('./lib/eval-probe.js')

// 默认两源按「本文件所在位置」定位，而不是靠调用者的 cwd：从仓库根跑（npm run verify:deck 的形态）
// 与从 deck/ 跑都指向同一对产物，改以前那种相对路径写法会随 cwd 漂。
const DECK_ROOT = path.resolve(import.meta.dirname, '..')
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.join(DECK_ROOT, 'client.js'), path.join(DECK_ROOT, 'package/lib/client.js')]

// ---- Part A：CSS / JS 静态契约（双源同步） ----
const statChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }

  // 期望 1：胶囊禁止换行 + 跟随输入区宽
  ok('胶囊 .dsws-capsule CSS 含 flex-wrap:nowrap', /\.dsws-capsule\s*\{[^}]*flex-wrap:nowrap/.test(src))
  ok('胶囊 .dsws-capsule CSS 不含 flex-wrap:wrap', !/\.dsws-capsule\s*\{[^}]*flex-wrap:wrap/.test(src))
  ok('胶囊 .dsws-capsule CSS 含 white-space:nowrap（防御性单行）', /\.dsws-capsule\s*\{[^}]*white-space:nowrap/.test(src))
  // #640 改写：胶囊的宽度上限不再自编一个像素数，改为与输入卡同源的那个变量
  //   （宿主 .p_FcLG_card 用的就是 --dsh-composer-card-max-width；外层容器已按同一条算式收窄，
  //    所以胶囊外框与输入卡外框等宽）。自编 min(100%,1400px) 的毛病：它比输入卡宽，
  //   于是「对齐」形同虚设 —— 实测胶囊 1377、输入卡 1231，被 100% 撑满。
  //   真正的像素级对齐由 tests/verify-640-dock-width-browser.js 在浏览器里量，不在本文件里断言字符串。
  ok('胶囊 .dsws-capsule CSS max-width 取宿主卡宽变量（不再自编 1400px）',
    /\.dsws-capsule\s*\{[^}]*max-width:\s*var\(--dsh-composer-card-max-width,\s*100%\)\s*\}/.test(src))
  // 旧的自编兜底（第一条规则里那个 min(100%,1400px)）必须在改造后消失，否则两条规则里还留着老上限
  ok('胶囊 .dsws-capsule CSS 不再自编像素上限（1400px 已弃）', !/max-width:\s*min\(100%,\s*1400px\)/.test(src))
  ok('胶囊 .dsws-capsule CSS 不再含 max-width:min(96vw, ...) （旧 R1 行为已弃）', !/\.dsws-capsule\s*\{[^}]*max-width:\s*min\(96vw/.test(src))
  ok('胶囊 .dsws-capsule CSS 不再含 margin:0 auto（外层 wrapper 负责居中）', !/\.dsws-capsule\s*\{[^}]*margin:\s*0\s+auto/.test(src))
  // #640 改写：外层容器的几何收敛到 StatusBar.js 的 dswsStatusDockGeom 一处，三支容器都调它。
  //   原来这里断言的是「wrapper 内联 width:100% + boxSizing + overflow」这串属性，那是改造前的形状；
  //   那条断言在改造前就已经失效（主干上一直红着，且没挂进门禁链），所以这里改成断言真源关系。
  ok('外层容器几何收敛到 dswsStatusDockGeom 一处（三支容器共用）', /const dswsStatusDockGeom = function \(\)/.test(src))
  ok('外层容器宽度取宿主「侧距」变量（不是内联 100%）',
    /width:\s*'calc\(100%\s*-\s*2\s*\*\s*var\(--dsh-composer-side-clearance/.test(src))
  ok('外层容器 max-width 取宿主卡宽变量（不再无约束铺满整列）',
    /maxWidth:\s*'var\(--dsh-composer-card-max-width,\s*100%\)'/.test(src))
  ok('外层容器不带横向内边距（否则胶囊会被再挤进来一层，与输入卡又对不上）',
    /padding:\s*'3px 0 0'/.test(src))
  // 外层容器三支都必须**亲自**调用几何：原来这里只数「dswsStatusDockGeom() 出现次数 >= 3」，
  //   数次数会漏掉「某一支停止调用、别处多一次字符串」（独立复核的变异实验 c 就是这样漏过去的），
  //   所以改成每一支各断言一次结构（branchHits 由上面按三种锚点文本分别扫出来）。
  const helperCalls = (src.match(/dswsStatusDockGeom\(\)/g) || []).length
  ok('外层容器几何被调用（至少 3 次：收起态 / 无横幅 / 有横幅各一次）', helperCalls >= 3)
  const branchHits = [
    ['收起态（justifyContent:center + 包裹内容居中那一支）', /Object\.assign\(\{ display:\s*'flex',\s*flex:\s*'none',\s*justifyContent:\s*'center',\s*alignSelf:\s*'center' \},\s*dswsStatusDockGeom\(\),\s*\{ width:\s*'auto' \}\)/],
    ['无横幅那一支（gap: 2）', /Object\.assign\(\{ display:\s*'flex',\s*flex:\s*'none',\s*flexDirection:\s*'column',\s*alignItems:\s*'center',\s*gap:\s*2,[^}]*\},\s*dswsStatusDockGeom\(\)\)/],
    // 这一支的属性顺序与另两支不同（flexDirection 排在 flex 前面），所以断言只钉住它独有的两个词
    // （gap: 4 + position: relative）与末尾的 helper 调用，不钉属性顺序。
    ['有横幅那一支（gap: 4 + position:relative）', /Object\.assign\([\s\S]{0,240}gap:\s*4[\s\S]{0,120}position:\s*'relative'\s*\},\s*dswsStatusDockGeom\(\)\)/],
  ]
  for (const [label, re] of branchHits) ok('几何套在这一支上：' + label, re.test(src))
  // 三支的横向内边距只由几何那一处给：断言几何的 padding 就是 '3px 0 0'，且三支都不再自己拼字面量。
  //   注意不要把范围放宽成「整个文件里不许出现 padding:'0 8px'」——那个写法在状态栏别处还有正当用途
  //   （折叠按钮等），一并禁掉会误伤。
  ok('几何自带的 padding 就是不带横向内边距的 \'3px 0 0\'', /padding:\s*'3px 0 0'/.test(src))
  ok('三支都不再各自硬写外层容器的横向内边距', !/gap:\s*2\s*,[^}]*padding:/.test(src) && !/gap:\s*4\s*,\s*position:\s*'relative'\s*,\s*padding:/.test(src))
  ok('外层容器正常路径仍保留 overflow:hidden 截胶囊溢出、缺 ReactDOM 时 visible 降级',
    /overflow:\s*RDOM\s*\?\s*'hidden'\s*:\s*'visible'/.test(src))
  // 2026-10-13（#3）改写：原来这条断言「.dsws-capsule 不含 overflow:hidden」（针对 #640 时期那个裸胶囊，
  //   担心裁掉圆角背景）。设计已经改成两层：胶囊是**外框**（保留自己的 background/border-radius），
  //   内容进内层滑窗 .dsws-barcell（overflow-x:auto + overflow-y:hidden + touch-action:pan-x），
  //   窄屏横滑的裁切就发生在这一层。胶囊自己那层 overflow:hidden 是外框的一部分（#7 落地时加的），
  //   不是 #640 当年防的那件事，所以判据从「谁都不许裁」改成「裁在哪一层、外框还在不在」——
  //   滑窗那层被删掉或改回 visible 时照样红（那才是「字溢出到卡片外」）。
  //   已知副作用（#3 实测，另记不修）：胶囊框高 26px，@media (pointer:coarse) 里那些 44px 命中区
  //   （::after）会被这层 overflow 裁到 26px 内 —— 窄屏横滑与命中区扩大两条改动在这里互相顶。
  ok('窄屏横滑的裁切落在内层滑窗 .dsws-barcell（overflow-x:auto + overflow-y 收住、可拖动）',
    /\.dsws-barcell\{[^}]*overflow-x:\s*auto/.test(src) &&
    /\.dsws-barcell\{[^}]*overflow-y:\s*hidden/.test(src) &&
    /\.dsws-barcell\{[^}]*touch-action:\s*pan-x/.test(src))
  ok('胶囊外框自身的圆角与底色都还在（外层裁切不许把外框裁掉）',
    /\.dsws-capsule\{[^}]*border-radius:14px/.test(src) &&
    /\.dsws-capsule\{[^}]*background:var\(--dsw-alias-bg-layer-1/.test(src))
  // 期望 2：children 保持不被挤压（2026-09-24 #725 起：品牌那一段与另两段的挤压规则各自写明）
  //   维护者这一轮定「内容平铺在这一条里」：胶囊两端分布，多出来的空间均分在**各项之间**。
  //   2026-09-24 晚按真机测量改了一处：品牌那一段原来写 `flex:1 1 auto`，它一个元素把余量全吃了
  //   （实测宽条上被撑到 230 像素、里面只装 79 像素的东西），其余各项被顶成一簇 —— 维护者看到的就是
  //   「按钮过于集中在右侧」。现在它写 `flex:0 1 auto` + `max-width:max-content`：只占自己的内容宽、
  //   仍可收缩（min-width:0 保留），余量交给 space-between 在各项之间平分（真机量与阈值见
  //   tests/verify-capsule-layout.js）。seg 与 timebtn 仍 flex:none。
  ok('children 的挤压规则照平铺来（品牌段只占内容宽 flex:0 1 auto + max-width:max-content + min-width:0 / seg 与 timebtn 仍 flex:none）',
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*flex:0 1 auto/.test(src) && /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*max-width:max-content/.test(src) && /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*min-width:0/.test(src) && /\.dsws-capsule\s+\.dsws-seg\{flex:none/.test(src) && /\.dsws-capsule\s+\.dsws-timebtn\{flex:none/.test(src))
  // 图标与它自己那串字是一个不可分的整体：那一段自己的列间距写死 5px（原来那条随视口放大的 clamp
  //   把它也撑开了，真机实测宽条 28px —— 维护者截图上「图标与文字之间的间隙太大」就是它）。
  ok('图标↔自己的文字间隙写死不随视口变（那一段的 column-gap:5px；随宽度变化的那条只留给各项之间）',
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*column-gap:5px/.test(src) && !/\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*column-gap:clamp\(/.test(src))
  ok('胶囊 gap 保留 2px 6px（行间距 / 列间距）', /\.dsws-capsule\s*\{[^}]*gap:\s*2px\s+6px/.test(src))
  ok('胶囊 justify-content 是平铺的 space-between（#725 维护者定，替掉旧的 center）', /\.dsws-capsule\s*\{[^}]*justify-content:\s*space-between/.test(src))

  // 期望 3（V2）：内容自适应渐进收缩
  // 3a. CSS 折叠规则：一条规则命中所有带 data-fold-priority 且被加 .dsws-folded 的文字 span
  //   2026-09-22 起这条规则也管面板头部第一行里那几颗单字形小图标（标记 data-head-fold + data-head-icon，
  //   见 panel/Dock.js）：图标本身就是单个字形，一步撤一颗，做法与胶囊同一套（全展开 → 按优先序逐个加
  //   .dsws-folded → 收到放得下为止）。同一行里那些「一串字」的元素（仓库名 / 刷新按钮的字 / 时间标签）
  //   不走这一条 —— 它们按 panel/headFold.js 那条阶梯逐字变短，永远不整块 display:none。
  ok('V2 · CSS 折叠规则同时管胶囊与面板头部那几颗单字形小图标',
    /'\.dsws-capsule \[data-fold-priority\]\.dsws-folded,\[data-head-fold\]\.dsws-folded\{display:none\}'/.test(src))
  // 3b. 12 个文字 span 的 priority 绑定（信息价值从小到大）：
  //     品牌(1) 更新字(2) 日期串(3) 环境字(4) 环境计数(5) 时间串(6) 沉淀(7) 交接(8) 可接(9) BUG(10) 诊断(11) 在办编号(12)
  const prio = function (n, re) { return ok('V2 · priority=' + n + ' 绑定 ' + (re.source || re), re.test(src)) }
  prio(1, /'data-fold-priority':\s*1[\s\S]{0,40}tr\('panel\.title'\)/)
  prio(2, /'data-fold-priority':\s*2[\s\S]{0,40}tr\('nav\.refresh'\)/)
  prio(3, /'data-fold-priority':\s*3[\s\S]{0,100}\.date/)
  prio(4, /'data-fold-priority':\s*4[\s\S]{0,40}tr\('nav\.env'\)/)
  prio(5, /'data-fold-priority':\s*5[\s\S]{0,60}envLabel/)
  prio(6, /'data-fold-priority':\s*6[\s\S]{0,100}\.time/)
  prio(7, /'data-fold-priority':\s*7[\s\S]{0,40}tr\('nav\.word'\)/)
  prio(8, /'data-fold-priority':\s*8[\s\S]{0,40}tr\('nav\.handoff'\)/)
  prio(9, /'data-fold-priority':\s*9[\s\S]{0,40}tr\('nav\.takeable'\)/)
  prio(10, /'data-fold-priority':\s*10[\s\S]{0,40}tr\('nav\.bug'\)/)
  prio(11, /'data-fold-priority':\s*11[\s\S]{0,40}tr\('nav\.triage'\)/)
  prio(12, /'data-fold-priority':\s*12[\s\S]{0,140}text/)
  // 3c. 那台阶梯机的核心形状（2026-09-24 #725：机器搬进 statusbar/capFoldMachine.js —— 判据是
  //   statusbar/capFold.js 的纯函数，StatusBar.js 只留接线。这些断言量的是**产物里的代码**，
  //   搬了住处照样量得到；下面几句的判据一条没放松，只是把「谁在实现」写清楚了。）
  ok('V2 · applyFold 函数存在（接线：把胶囊与两张跨调用带着走的表交给阶梯机）', /const applyFold = function\s*\(\)\s*\{/.test(src))
  ok('V2 · 单写路径：写某一档时只写字与折叠类、不读布局（写读不再交替，926）', /const writeTier = function \(tier\)[\s\S]{0,600}classList\.remove\(['"]dsws-folded['"]\)/.test(src) && (src.match(/void cap\.offsetWidth/g) || []).length <= 2)
  ok('V2 · 阶梯按 priority 升序（小号先让位）', /sort\(function \(a, b\) \{ return a\.p - b\.p \}\)/.test(src))
  ok('V2 · 溢出判定 scrollWidth ≤ clientWidth+1（放得下就停在这一档）', /scrollWidth\s*<=\s*cap\.clientWidth\s*\+\s*1/.test(src))
  ok('V2 · 首帧起始态仍收品牌段并加 .dsws-folded（默认折叠保持，926 未动）', /classList\.add\(['"]dsws-folded['"]\)[\s\S]{0,80}void cap\.offsetWidth/.test(src))
  ok('V2 · 记下 dataset.fold 折叠段数与 dataset.foldTier 档号（调试与门禁的锚点）',
    /cap\.dataset\.fold\s*=\s*String\(/.test(src) && /cap\.dataset\.foldTier\s*=\s*String\(/.test(src))
  // 3d. foldRef 挂 capsule + ResizeObserver 监听
  // 2026-10-13（#3）放宽：胶囊根上的 ref 从 `ref: foldRef` 改成了回调形态
  //   `ref: function (el) { foldRef.current = el; barCellRef.current = el }`（#7 横滑要量同一个 DOM 节点）。
  //   这句要守的是「胶囊根把 ref 交出去」（谁用那个节点由下面两条 ResizeObserver 断言管），
  //   所以两种形态都认；真丢了 ref（或 ref 指向别人）照样红。
  ok('V2 · capsule 根挂 ref（foldRef 直接形态或回调形态：函数体里把 foldRef.current 赋成该节点）',
    /className:\s*['"]dsws-capsule['"][^{]*ref:\s*foldRef\b/.test(src) ||
    /className:\s*['"]dsws-capsule['"][^{]*ref:\s*function\s*\(el\)\s*\{[^{}]*foldRef\.current\s*=/.test(src))
  ok('V2 · foldRef = React.useRef(null)', /foldRef\s*=\s*React\.useRef\(null\)/.test(src))
  ok('V2 · ResizeObserver 监听 foldRef.current 进合并队列（926 同帧只跑一次）', /new ResizeObserver\(function\s*\(\)\s*\{\s*scheduleFold\(\)\s*\}\)[\s\S]{0,200}roFold\.observe\(foldRef\.current\)/.test(src))
  ok('V2 · window resize 进合并队列（实时响应，926 起与观察器同一队列）', /window\.addEventListener\(['"]resize['"],\s*scheduleFold\)/.test(src))
  ok('V2 · fonts.ready 后重测（防字体宽差误判，走合并队列）', /document\.fonts\.ready\.then\(scheduleFold\)/.test(src))

  // 3e. 旧 data-narrow 阈值体系清除（防双体系并存误导）
  ok('V2 · 旧 [data-narrow-N] CSS 选择器已删', !/\[data-narrow-[1-4]\]/.test(src))
  ok('V2 · JSX 不再写 data-narrow 属性', !/['"]data-narrow['"]?\s*:\s*dn/.test(src))
  ok('V2 · 不再有 let dn 阈值计算', !/let dn = 0/.test(src))
  // 注：DetailsDock（#15 面板列宽）自有 [dw,setDw]，不在此处断言（非 StatusBar 胶囊体系）

  // 期望（R13 对齐 - 第一性原理 B）：胶囊与输入卡同源，不再 JS 量像素
  // 旧 R13 iw 已退休，改为 CSS 变量驱动：width:100% + max-width:var(--dsh-composer-card-max-width)
  ok('R13 · 胶囊 CSS 默认 width:100%（撑满 wrapper=输入区）', /\.dsws-capsule\{[^}]*width:100%/.test(src))
  ok('R13 · 胶囊 CSS box-sizing:border-box', /\.dsws-capsule\{[^}]*box-sizing:border-box/.test(src))
  ok('R13 · 胶囊 CSS max-width 复用宿主变量 --dsh-composer-card-max-width（与输入卡同源）', /--dsh-composer-card-max-width/.test(src))
  ok('R13 · inline 胶囊 width:100%（不再用 iw 像素）', /className:\s*['"]dsws-capsule['"][\s\S]{0,120}width:\s*'100%'/.test(src))
  ok('R13 · inline 不再含 iw 像素（旧方案已退休）', !/width:\s*iw\s*\+\s*'px'/.test(src))
  ok('R13 · 旧 fit-content 弃用', !/\.dsws-capsule\{[^}]*width:fit-content/.test(src) && !/style:\s*\{[^}]*width:\s*'fit-content'/.test(src))
  ok('R9 · 第一性原理：不再查询特定 textarea 类名（已去耦）', !/textarea\.uV2eYG_input/.test(src))
  ok('R9 · ResizeObserver 监听 foldRef 及其 parent（可用宽变化即折叠，走合并队列）', /new ResizeObserver\(function\s*\(\)\s*\{\s*scheduleFold\(\)\s*\}\)[\s\S]{0,300}roFold\.observe\(foldRef\.current\)/.test(src) && /roParent\.observe/.test(src))
  ok('R9 · useEffect 清理断开 roFold/roParent（防泄漏）', /roFold\.disconnect\(\)[\s\S]{0,120}roParent\.disconnect\(\)/.test(src))
  // 2026-09-24（#725）：这条 2 秒轮询退役（维护者定：这一条横向随宽度一格一格变短，但不许挂自续定时器）。
  //   它原先兜的是「字被换掉了、尺寸没变，观察器不会响」那一种（React 重渲染会把收短的那串换回完整的一串），
  //   现在由「每次提交之后重算一次」那条副作用接管；真实表现由 tests/verify-cap-fold.js 的宽度扫描门禁钉住
  //   （含「改完宽度等 2200 毫秒再量一次，仍然正确」那条证据）。
  ok('R9 · 2 秒轮询已退役（#725），改由 ResizeObserver + 提交后重算 + fonts.ready 三条路接管',
    !/setInterval\(applyAll, 2000\)/.test(src) && /React\.useEffect\(function \(\) \{ scheduleFold\(\) \}\)/.test(src))
  ok('R12 · !firstBlock 分支 wrapper 含 flex:\'none\'（防 flex-shrink 压矮）', /display:\s*'flex',\s*flex:\s*'none',\s*justifyContent:\s*'center'/.test(src))
  ok('R12 · firstBlock 分支 wrapper 含 flex:\'none\'（横幅 + 胶囊列布局同样防压缩）', /display:\s*'flex',\s*flex:\s*'none',\s*flexDirection:\s*'column'/.test(src))
  ok('R6b · !firstBlock 分支 wrapper 不再含 alignItems:\'stretch\'', !/display:\s*'flex',\s*justifyContent:\s*'center'[\s\S]{0,200}alignItems:\s*'stretch'/.test(src))

  // 期望 4：点击事件契约
  // 2026-10-13（#3）改写：#7 横滑落地后，点开面板的点击不再写在胶囊根上，而写在**内层滑窗** .dsws-barcell
  //   上，并多了一道位移守卫（`if (barMoved.current) { barMoved.current = false; return } openPanel(s)`）——
  //   拖动横向滚过之后松手不许顺手把面板点开。原来那条断言（胶囊根 `onClick → openPanel(s)`）问的是老结构，
  //   所以拆成三条问新结构：① 胶囊根不再自己吞点击（否则内层那层白写）；② 滑窗上有点击；③ 那口点击里
  //   既有守卫、也真的调 openPanel(s)。守卫本身的行为由下面 Part D 真跑一遍。
  ok('capsule 根不再自己吞点击（点击交内层滑窗，胶囊根只做外形）',
    !/className:\s*['"]dsws-capsule['"][^{]*onClick:/.test(src))
  ok('capsule 点击 → 内层滑窗 .dsws-barcell 上有 onClick',
    /className:\s*['"]dsws-barcell['"][^{]*onClick:/.test(src))
  ok('capsule 点击 → openPanel(s)，且带拖动位移守卫（拖完松手不许顺手点开）',
    /className:\s*['"]dsws-barcell['"][^{]*onClick:\s*function\s*\(\)\s*\{[^{}]*barMoved[\s\S]{0,120}?openPanel\(s\)/.test(src))
  ok('capsule-word onClick → togglePanel(s) + stopPropagation', /className:\s*['"]dsws-capsule-word['"][^}]*onClick:[^}]*togglePanel\(s\)/.test(src) && /className:\s*['"]dsws-capsule-word['"][^}]*e\.stopPropagation/.test(src))
  ok('seg onClick → e.stopPropagation + onGo()', /className:\s*['"]dsws-seg['"][^}]*e\.stopPropagation/.test(src) && /className:\s*['"]dsws-seg['"][^}]*onGo\(\)/.test(src))
  ok('timebtn onClick → e.stopPropagation + refreshAll(s)', /className:\s*['"]dsws-timebtn['"][^}]*e\.stopPropagation/.test(src) && /className:\s*['"]dsws-timebtn['"][^}]*refreshAll\(s\)/.test(src))

  // 期望 5：EN locale i18n 键齐备
  const extractLocaleBlock = function (s, lang) {
    const re = new RegExp("\\b" + lang + ":\\s*\\{[\\s\\S]*?\\n\\s*\\}", 'm')
    return (s.match(re) || [''])[0]
  }
  const zhBlock = extractLocaleBlock(src, 'zh')
  const enBlock = extractLocaleBlock(src, 'en')
  ok('i18n 字典存在 zh 块（zh: { ... }）', !!zhBlock)
  ok('i18n 字典存在 en 块（en: { ... }）', !!enBlock)
  // 期望 5 的核心（#3 第二次改写，把第一次的猜测纠正掉）：原来两条硬写死 'MattSkills'，早就不是真值
  //   （真值 zh = GitHub 常驻 / en = GitHub Resident）。但判据**不是**「中英同字」——我第一版按那个理解
  //   改了，实测两边就是不同的字（英文里品牌本来就叫 GitHub Resident），那是 i18n 字典该有的样子，
  //   不是缺陷。当初那两条真正守的是「品牌这句话不是空的、也不是没翻译的键」：
  //     ① 两个 locale 里 panel.title 都取得到、都是非空串（漏翻 / 空串照样红）；
  //     ② 胶囊上那一段（data-fold-priority=1）与面板头部用的是**同一个键** tr('panel.title')——
  //        改品牌只需改字典一处，不许某一处写死字面量导致两处显示不同。
  //   真值仍不写死在门禁里：品牌下次改名，只要顺着键改，这门还是绿的。
  const panelTitleOf = function (block, lang) {
    const m = String(block).match(/'panel\.title':\s*'([^']*)'/)
    if (!m) throw new Error('期望 5 · ' + lang + ' 的 panel.title 取不到（字典块里没有这一键）')
    return m[1]
  }
  const zhTitle = panelTitleOf(zhBlock, 'zh')
  const enTitle = panelTitleOf(enBlock, 'en')
  ok('panel.title 两个 locale 都取得到且非空（漏翻 / 空串照样红）：zh=' + JSON.stringify(zhTitle) + ' en=' + JSON.stringify(enTitle),
    zhTitle.trim().length > 0 && enTitle.trim().length > 0)
  // 「两处同键」按两处真交付点各断言一次（胶囊那段 + 面板头部那句），不用出现次数 —— 数次数会漏。
  ok('品牌同键（一）：胶囊里那一段用 tr(\'panel.title\')，不是写死的字面量',
    /'data-fold-priority':\s*1[\s\S]{0,80}tr\('panel\.title'\)/.test(src))
  ok('品牌同键（二）：面板头部标题也走同一个键 tr(\'panel.title\')',
    /className:\s*'t'[^}]*tr\('panel\.title'\)/.test(src) || /h\('strong',\s*null,\s*tr\('panel\.title'\)\)/.test(src))
  ok('nav.triage zh = "诊断"（与诊断段一致，非 "待分诊"）', /'nav\.triage':\s*'诊断'/.test(zhBlock))
  ok('nav.triage en = "Triage"', /'nav\.triage':\s*'Triage'/.test(enBlock))
  ok('nav.word zh = "沉淀"', /'nav\.word':\s*'沉淀'/.test(zhBlock))
  ok('nav.refresh zh = "更新"', /'nav\.refresh':\s*'更新'/.test(zhBlock))
  ok('nav.takeable / nav.bug / nav.triage / nav.env / nav.refresh / nav.handoff 键齐',
    /'nav\.takeable'/.test(src) && /'nav\.bug'/.test(src) && /'nav\.triage'/.test(src) &&
    /'nav\.env'/.test(src) && /'nav\.refresh'/.test(src) && /'nav\.handoff'/.test(src))
}

// ---- Part B（T5 #98 已移除）：双源镜像同步由一源两物构建保证，不再断言双源 byte-for-byte 一致 ----
// 保留 Part A/C/D 对单产物的契约校验，足以覆盖胶囊视图契约

// ---- Part C：行为契约 —— priority 映射表语义（纯静态重算，与代码同表） ----
const behaviorCheck = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  // 信息价值顺序（1=最先收）：品牌 → 更新字 → 时间串 → 无数字操作段（沉淀/交接）→ 有数字监控段（可接/BUG/诊断/环境字）→ 在办编号 → 环境计数
  // 断言：priority 升序 = 上述顺序；且 1..12 全部出现且唯一
  // 2026-10-13（#3）改判据：唯一性只在**可见那一行**里算。唯一性是这条阶梯的承重墙 —— 阶梯机按
  //   data-fold-priority 号码认字段、还跨帧用号码当键记折叠状态，号码撞车就会有一格永远收不掉。
  //   但新增的幻影行（`.dsws-bar-phantom`，aria-hidden，只用来量「不折叠时多宽」）会把这 12 段原样
  //   再渲染一份（品牌那格与整颗 SessionChainCapsule 都在里面），于是全文件按字面量数会数出两套。
  // 量法改成按**真源位置**分域计数，两个域各自是一处真源：
  //   ① .dsws-barcell 那一块（从它开头到 `]` 收尾）—— 明细字段 1..11 的渲染点；
  //   ② statusbar/SessionChainCapsule.js —— 在办编号（priority=12）的渲染点，它由那一块以组件形式挂进来，
  //      在本文件里只是 `h(SessionChainCapsule, …)` 一行，看不到 12。
  //   幻影行那一块是尺子（`aria-hidden`、只借它的宽度），它的副本不参与可见行唯一性；两块在源码里的
  //   前后顺序是「幻影行在前、可见行在后」，别按 idx 大小硬切。
  const idxCell = src.indexOf("className: 'dsws-barcell'")
  const idxPhantom = src.indexOf("className: 'dsws-bar-phantom'")
  const cellEnd = idxCell >= 0 ? src.indexOf('\n  ])', idxCell) : -1
  const barCellRegion = idxCell >= 0 ? src.slice(idxCell, cellEnd > idxCell ? cellEnd : idxCell + 8000) : ''
  const phantomRegion = idxPhantom >= 0
    ? src.slice(idxPhantom, (function () { const n = src.indexOf("h('div',", idxPhantom); return n > idxPhantom ? n : idxPhantom + 2000 })())
    : ''
  let chainSrc = ''
  try {
    chainSrc = fs.readFileSync(path.join(DECK_ROOT, 'src/client/statusbar/SessionChainCapsule.js'), 'utf8')
  } catch { /* 只跑产物、拿不到源码时下面那格会红并说清楚 */ }
  const countIn = function (text, p) {
    return (text.match(new RegExp("'data-fold-priority':\\s*" + p + "\\b", 'g')) || []).length
  }
  const prios = []
  for (let p = 1; p <= 11; p++) {
    const inCell = countIn(barCellRegion, p)
    if (!inCell) throw new Error('priority=' + p + ' 在可见行（.dsws-barcell 区块）里缺失')
    if (inCell !== 1) throw new Error('priority=' + p + ' 在可见行里出现 ' + inCell + ' 次（应唯一）')
    prios.push(p)
  }
  // 12（在办编号）由 SessionChainCapsule 组件渲染，量它的真源：整组件里恰好一处 12。
  const inChain = countIn(chainSrc, 12)
  if (!chainSrc) throw new Error('读不到 src/client/statusbar/SessionChainCapsule.js，无法核对 priority=12 的渲染点')
  if (inChain !== 1) throw new Error('priority=12 在 SessionChainCapsule.js 里出现 ' + inChain + ' 次（应唯一）')
  prios.push(12)
  ok('V2 · 12 个 data-fold-priority 在可见行里全部存在且唯一（1..12）', prios.length === 12)
  ok('V2 · 幻影行是尺子：品牌那格在里面另有一份副本、整行 aria-hidden（副本不参与可见行唯一性）',
    countIn(phantomRegion, 1) === 1 && /className:\s*'dsws-bar-phantom'[^}]*'aria-hidden':\s*'true'/.test(src))
  // 语义表：每个 priority 对应的文案来源（tr 键 / 时间戳 / 在办编号 / 环境计数），确保顺序与「信息价值」一致
  // （2026-09-27 定终版：品牌 → 更新字 → 日期串 → 环境字 → 环境计数 → 时间串 → 沉淀 → 交接 → 可接 → BUG → 诊断 → 在办编号）
  const sem = [
    { p: 1, re: /'data-fold-priority':\s*1[\s\S]{0,50}panel\.title/, d: '品牌 MattSkills（纯装饰，最先收）' },
    { p: 2, re: /'data-fold-priority':\s*2[\s\S]{0,40}nav\.refresh/, d: '更新字（图标留着，字先让）' },
    { p: 3, re: /'data-fold-priority':\s*3[\s\S]{0,100}\.date/, d: '日期串（环境字前面先让，逐字）' },
    { p: 4, re: /'data-fold-priority':\s*4[\s\S]{0,40}nav\.env/, d: '环境字（晚于日期早于时间）' },
    { p: 5, re: /'data-fold-priority':\s*5[\s\S]{0,60}envLabel/, d: '环境计数（早于时间，逐字）' },
    { p: 6, re: /'data-fold-priority':\s*6[\s\S]{0,100}\.time/, d: '时间串（撑后，逐字）' },
    { p: 7, re: /'data-fold-priority':\s*7[\s\S]{0,50}nav\.word/, d: '沉淀（无数字操作段）' },
    { p: 8, re: /'data-fold-priority':\s*8[\s\S]{0,50}nav\.handoff/, d: '交接（无数字操作段）' },
    { p: 9, re: /'data-fold-priority':\s*9[\s\S]{0,50}nav\.takeable/, d: '可接（监控标签，数字保留）' },
    { p: 10, re: /'data-fold-priority':\s*10[\s\S]{0,50}nav\.bug/, d: 'BUG（监控标签，数字保留）' },
    { p: 11, re: /'data-fold-priority':\s*11[\s\S]{0,50}nav\.triage/, d: '诊断（监控标签，数字保留）' },
    { p: 12, re: /'data-fold-priority':\s*12[\s\S]{0,140}text/, d: '在办编号（排在最后，逐字）' },
  ]
  for (const s of sem) {
    if (!s.re.test(src)) throw new Error('priority=' + s.p + ' 语义不符（' + s.d + '）')
    console.log('  PASS ' + tag + ' · V2 · priority=' + s.p + ' → ' + s.d)
  }
}

// ---- Part D：DOM 模拟点击（期望行为 4：实际跑 handler 函数体，验证 stopPropagation + 路由） ----
const domSimCheck = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  const findHandler = function (re) {
    const m = src.match(re)
    return m ? m[1] : null
  }
  // #3 改写：点开面板的处理器现在挂在 .dsws-barcell 上，且是箭头函数形态、闭包两个变量
  //   （barMoved 位移标志、s 会话）。抽出来单独跑：参数名写成它真正依赖的那几个。
  const capFn = (function () {
    const head = src.match(/className:\s*['"]dsws-barcell['"][^{]*onClick:\s*(?:function\s*\(\)|\(\)\s*=>)\s*\{/)
    if (!head) return null
    // 处理体里有嵌套花括号（`if (barMoved.current) { … }`），所以按花括号配平一路读到收尾，
    // 不靠正则偷懒 —— 非贪婪会停在里层 `}` 上（第一版就是这样红的），贪婪会把后面的兄弟属性一起吞掉。
    const from = head.index + head[0].length
    let d = 1
    let k = from
    for (; k < src.length; k++) {
      if (src[k] === '{') d++
      else if (src[k] === '}') { d--; if (d === 0) break }
    }
    if (d !== 0) return null
    return compileFn(['barMoved', 'openPanel', 's'], src.slice(from, k))
  })()
  const cwBody = findHandler(/onClick:\s*function\s*\(e\)\s*\{\s*(e\.stopPropagation\(\);\s*togglePanel\(s\))\s*\}/)
  const segBody = findHandler(/onClick:\s*function\s*\(e\)\s*\{\s*(e\.stopPropagation\(\);\s*onGo\(\))\s*\}/)
  const tbBody = findHandler(/onClick:\s*function\s*\(e\)\s*\{\s*(e\.stopPropagation\(\);\s*refreshAll\(s\))\s*\}/)
  if (!capFn) throw new Error('capsule（.dsws-barcell）onClick handler 提取失败')
  if (!cwBody) throw new Error('capsule-word onClick handler 提取失败')
  if (!segBody) throw new Error('seg onClick handler 提取失败')
  if (!tbBody) throw new Error('timebtn onClick handler 提取失败')

  const runHandler = function (body, ctx) {
    // 切出来的处理体配假事件与假 handler 求值：改走共用入口 compileFn，参数名逐个列出。
    const fn = compileFn(['s', 'e', 'openPanel', 'togglePanel', 'onGo', 'refreshAll'], body)
    return fn(ctx.s, ctx.e, ctx.openPanel, ctx.togglePanel, ctx.onGo, ctx.refreshAll)
  }
  const makeEvent = () => ({ stopped: false, stopPropagation: function () { this.stopped = true } })
  const calls = { openPanel: 0, togglePanel: 0, onGo: 0, refreshAll: 0 }
  const st = { tag: 'fixture' }

  // ① 拖动位移标志是 false（这一次是「点」不是「拖」）→ 正常开面板
  let capCalls = 0
  capFn({ current: false }, function (s) { capCalls++; if (s !== st) throw new Error('openPanel 收到的 s 不一致') }, st)
  ok('点击胶囊空白（未拖动）→ openPanel(s) 触发 1 次', capCalls === 1)
  // ② 位移标志是 true（刚横向拖过）→ 这一次不许开面板，且标志要归零（下一次点击照常生效）
  const moved = { current: true }
  let capCalls2 = 0
  capFn(moved, function () { capCalls2++ }, st)
  ok('拖动后松手那一次点击 → 不开面板（位移守卫拦住），且标志已归零',
    capCalls2 === 0 && moved.current === false)
  ok('点击胶囊空白 → 不误触其他三个 handler', calls.togglePanel === 0 && calls.onGo === 0 && calls.refreshAll === 0)

  calls.openPanel = 0
  const e2 = makeEvent()
  const r2 = runHandler(cwBody, { s: st, e: e2, togglePanel: function (s) { calls.togglePanel++; if (s !== st) throw new Error('togglePanel 收到的 s 不一致') } })
  ok('点击 capsule-word → togglePanel(s) 触发 1 次 + stopPropagation 已调用',
    calls.togglePanel === 1 && e2.stopped === true)
  ok('点击 capsule-word → 没有冒泡到 openPanel', calls.openPanel === 0)

  calls.togglePanel = 0
  const e3 = makeEvent()
  const r3 = runHandler(segBody, { s: st, e: e3, onGo: function () { calls.onGo++ } })
  ok('点击 seg → onGo() 触发 1 次 + stopPropagation 已调用',
    calls.onGo === 1 && e3.stopped === true)

  calls.onGo = 0
  const e4 = makeEvent()
  const r4 = runHandler(tbBody, { s: st, e: e4, refreshAll: function (s) { calls.refreshAll++; if (s !== st) throw new Error('refreshAll 收到的 s 不一致') } })
  ok('点击 timebtn → refreshAll(s) 触发 1 次 + stopPropagation 已调用',
    calls.refreshAll === 1 && e4.stopped === true)

  const verifyIsolation = function (handlerName, body, expectedStub) {
    const calls2 = { openPanel: 0, togglePanel: 0, onGo: 0, refreshAll: 0 }
    const stubs = {
      openPanel: function () { calls2.openPanel++ },
      togglePanel: function () { calls2.togglePanel++ },
      onGo: function () { calls2.onGo++ },
      refreshAll: function () { calls2.refreshAll++ }
    }
    runHandler(body, { s: st, e: makeEvent(), openPanel: stubs.openPanel, togglePanel: stubs.togglePanel, onGo: stubs.onGo, refreshAll: stubs.refreshAll })
    for (const k of ['openPanel', 'togglePanel', 'onGo', 'refreshAll']) {
      const shouldBe = (k === expectedStub) ? 1 : 0
      if (calls2[k] !== shouldBe) {
        throw new Error(handlerName + ' handler 路由泄漏：' + k + ' 被调用 ' + calls2[k] + ' 次，应为 ' + shouldBe)
      }
    }
  }
  // 胶囊那口点击的路由隔离：用同一套四路 stub 真跑一次（未拖动），只许 openPanel 被点名一次。
  const capSeen = { openPanel: 0, togglePanel: 0, onGo: 0, refreshAll: 0 }
  capFn({ current: false }, function (x) { capSeen.openPanel++; if (x !== st) throw new Error('openPanel 收到的 s 不一致') }, st)
  // compileFn 造出来的函数只拿到点名的那几个参数，其余三路在这里压根递不进去：
  //   所以「另外三路 0 次」是结构性的（函数签名里没有它们），不是靠这一次调用碰巧没碰到。
  ok('handler 路由隔离：capsule（滑窗那口点击）只调 openPanel（其他三路根本没进参数表）',
    capSeen.openPanel === 1 && capSeen.togglePanel === 0 && capSeen.onGo === 0 && capSeen.refreshAll === 0)
  verifyIsolation('capsule-word', cwBody, 'togglePanel')
  ok('handler 路由隔离：capsule-word 只调 togglePanel（其他函数 0 次）', true)
  verifyIsolation('seg', segBody, 'onGo')
  ok('handler 路由隔离：seg 只调 onGo（其他函数 0 次）', true)
  verifyIsolation('timebtn', tbBody, 'refreshAll')
  ok('handler 路由隔离：timebtn 只调 refreshAll（其他函数 0 次）', true)
}

const main = async function () {
  let failed = false
  const sources = {}
  for (const file of files) {
    const tag = file.indexOf('package/') >= 0 ? 'npm' : 'dyn'
    console.log('=== ' + file + ' ===')
    const src = fs.readFileSync(file, 'utf8')
    sources[tag] = src
    console.log('-- Part A 静态契约 --')
    try { statChecks(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part A — ' + e.message); continue }
    console.log('-- Part C 行为契约（priority 语义表）--')
    try { behaviorCheck(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part C — ' + e.message); continue }
    console.log('-- Part D DOM 模拟点击（期望行为 4）--')
    try { domSimCheck(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part D — ' + e.message); continue }
  }
  // Part B 已移除（T5 #98）—— 双源镜像由构建保证
  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}
main()