// verify-tabs-narrow.js — 面板 tabs 行窄屏分级折叠 + 悬浮提示 · issue #15（效果升级版）
// 用法: node tests/verify-tabs-narrow.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// 验收标准（issue #15 + 效果升级 + grilling 收口）：
//   1) 单行基础：.dsws-tabs 含 flex-wrap:nowrap + overflow:hidden + white-space:nowrap；.dsws-tab 含 nowrap + flex:none。
//   2) 短文案起步：动作按钮不再显示「新建」（+ 号即新建语义）——面板.newWayfinder='+ 需求'、panel.newBug='+ bug'（EN 同理）。
//   3) 分级折叠（内容自适应）：
//      - L1：动作按钮（需求/bug/刷新）→ 纯图标（版本号隐藏）
//      - L2：tab 三键 → 也纯图标（版本号隐藏）
//   4) 折叠判定：tabsLevelDecide(level, avail, nats) —— 当前级放不下升级、回够空间(+滞回4)降级。
//   5) 悬浮提示：折叠图标态 hover 用 portal Tooltip（portalTop + zIndex 2147483000，跟随鼠标），替代原生 title
//      （动作按钮 minLevel=1、tab 三键 minLevel=2；原生 title 已移除，避免双提示）。
//   6) hook 合法性：唯一容器 Dock 的 tabsRef/折叠 effect 在组件渲染 return 之前，effect 挂载一次（依赖 []）。
//   7) 双源镜像：CSS（dsws-tabs/l 规则）+ tabs 容器 JSX + 折叠 effect 块 byte-for-byte 等价。
import fs from 'node:fs'
import { compileFn } from './lib/eval-probe.js'
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

// ---- Part A：CSS / JS 静态契约 ----
const statChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }

  // 期望 1：单行基础
  const tabsCss = (src.match(/\.dsws-tabs\{[^}]*\}/) || [''])[0]
  ok('CSS · .dsws-tabs 含 flex-wrap:nowrap', /flex-wrap:nowrap/.test(tabsCss))
  ok('CSS · .dsws-tabs 不含 flex-wrap:wrap', !/flex-wrap:wrap/.test(tabsCss))
  ok('CSS · .dsws-tabs 含 overflow:hidden（溢出守卫）', /overflow:hidden/.test(tabsCss))
  ok('CSS · .dsws-tabs 含 white-space:nowrap', /white-space:nowrap/.test(tabsCss))
  const tabCss = (src.match(/\.dsws-tab\{[^}]*\}/) || [''])[0]
  ok('CSS · .dsws-tab 含 white-space:nowrap', /white-space:nowrap/.test(tabCss))
  ok('CSS · .dsws-tab 含 flex:none', /flex:none/.test(tabCss))

  // 期望 2：短文案起步（无「新建」）
  ok('i18n · 不再出现「新建需求/新增BUG单」全称', !src.includes("'+ 新建需求'") && !src.includes("'+ 新增BUG单'") && !src.includes("'+ New requirement'"))
  const zhM = src.match(/'panel\.newWayfinder': '([^']*)'/)
  const zhB = src.match(/'panel\.newBug': '([^']*)'/)
  ok('i18n · zh 短文案 + 需求 / + bug', zhM && zhM[1] === '+ 需求' && zhB && zhB[1] === '+ bug')
  ok('i18n · en 短文案 + Requirement / + BUG', /'panel\.newWayfinder': '\+ Requirement'/.test(src) && /'panel\.newBug': '\+ BUG'/.test(src))

  // 期望 3：渐进式折叠 CSS（data-priority 按钮逐个折叠 + max-width 动画 + 版本号跟随）
  ok('CSS · 折叠用 max-width 动画（非 display:none）', /\.dsws-tabs \.dsws-tab\.collapsed > span:last-child,\.dsws-tabs \.dsws-btn\.collapsed > span:last-child\{max-width:0;opacity:0;margin-left:-4px;margin-right:-4px\}/.test(src))
  ok('CSS · 文字 span 有 max-width transition', /\.dsws-tabs \.dsws-tab > span:last-child,\.dsws-tabs \.dsws-btn > span:last-child\{max-width:120px;overflow:hidden;white-space:nowrap;transition:max-width \.25s ease,opacity \.2s ease,margin \.25s ease\}/.test(src))
  ok('CSS · collapsed 按钮 padding 收窄（保留 icon）', /\.dsws-tabs \.dsws-tab\.collapsed,\.dsws-tabs \.dsws-btn\.collapsed\{padding-left:6px;padding-right:6px;transition:padding \.25s ease\}/.test(src))
  ok('CSS · 无残留旧 dsws-tabs-l1/l2 display:none 规则', !/dsws-tabs-l1/.test(src) && !/dsws-tabs-l2/.test(src))
  ok('CSS · 无残留旧 dsws-tabs-fold 规则', !src.includes('.dsws-tabs-fold'))

  // 期望 4：等级决策函数
  ok('逻辑 · TABS_FOLD_HYST = 4 存在', /const TABS_FOLD_HYST = 4/.test(src))
  ok('逻辑 · TABS_LEVELS = 3 存在', /const TABS_LEVELS = 3/.test(src))
  ok('逻辑 · tabsLevelDecide 存在', /const tabsLevelDecide = function/.test(src))

  // 期望 5：装配（唯一容器 Dock + 渐进折叠 applyFold + dataset）
  // 收拢证据（0704e78b · 2026-09-19 · #646「删掉页内浮窗组件本体与它的拼接标记」）：删掉
  //   src/client/panel/Overlay.js 后，dock + overlay 两份 tabsRef/容器收拢成 Dock 一处；
  //   src/client/views/shared/Tabs.js 里的 tabsRef 是入参（消费方），不是 ref 声明。
  //   本仓 git log -- deck/src/client/panel/Dock.js 只有 40ebd3a（现状快照），Overlay.js 在本仓从未存在
  //   （git cat-file -e 40ebd3a:deck/src/client/panel/Overlay.js → 不存在）；退役决定另见 router.js「页内浮窗已退役」。
  const tabsRefN = (src.match(/const tabsRef = React\.useRef\(null\)/g) || []).length
  ok('逻辑 · tabsRef 声明 1 处（唯一容器 Dock；Overlay 已退役）', tabsRefN === 1)
  ok('逻辑 · ref: tabsRef 挂到 1 个 tabs 容器（Dock）', (src.match(/className: 'dsws-tabs', ref: tabsRef/g) || []).length === 1)
  // 另一处 applyFold 是状态栏胶囊（#725），不是已退役的 Overlay。
  ok('逻辑 · applyFold 定义 ≥2 次（Dock tabs 行 + 状态栏胶囊 #725）', (src.match(/const applyFold = function/g) || []).length >= 2)
  ok('逻辑 · 全展开 + 强制 reflow 起步', /classList\.remove\('collapsed'\)/.test(src) && /void t\.offsetWidth/.test(src))
  ok('逻辑 · 按 priority 降序逐个折叠（大者先折叠）', /\.sort\(function \(a, b\) \{ return b\.p - a\.p \}\)/.test(src))
  ok('逻辑 · 折叠到放得下为止（scrollWidth ≤ clientWidth）', /t\.scrollWidth <= t\.clientWidth \+ 1/.test(src))
  // 492357a2（2026-09-23 · 面板头部改造）把「刷新」那颗从这一排挪去头部（Tabs.js 注释：自此这一排没有
  //   priority=3 的元素），版本号不再跟随它，改判自己的真实处境：仍溢出就折叠。
  ok('逻辑 · 版本号按自身溢出折叠（刷新键已挪头部 · 492357a2）', /if \(ver\) ver\.classList\.toggle\('collapsed', t\.scrollWidth > t\.clientWidth \+ 1\)/.test(src))
  ok('逻辑 · 折叠结果写 dataset.tabsLevel', /t\.dataset\.tabsLevel = String\(t\.querySelectorAll\('\[data-priority\]\.collapsed'\)\.length\)/.test(src))
  ok('逻辑 · ResizeObserver + resize + fonts.ready 重算', /new ResizeObserver\(function \(\) \{ applyFold\(\) \}\)/.test(src) && /window\.addEventListener\('resize', apply\)/.test(src) && /document\.fonts\.ready\.then\(apply\)/.test(src))
  ok('逻辑 · RO 观察到元素被替换时重观察（observed !== t → unobserve+observe）', /ro && observed !== t/.test(src) && /ro\.observe\(t\)/.test(src))
  ok('逻辑 · tabBtn 带 data-priority 参数', /const tabBtn = \(id, icon, label, priority\)/.test(src))
  // 6b7beeca（2026-10-03 · #818 版本管理页签）在列表后插入 versionControl=5，既有三项各加一档成 6/7/8；
  //   492357a2（2026-09-23）把「刷新」挪去头部后，这一排只剩 5 个 tabBtn + 2 个动作键。
  //   字面量从「每个按钮各写一遍」收成 tabBtn 模板一处 + 两个动作键各一处，旧的「出现 ≥12 次」不再成立。
  ok('逻辑 · 5 个 tabBtn 各传档号（列表4/版本5/PR6/技能7/检查8）', /tabBtn\('list', 'list', tr\('panel\.tabList'\), 4\)/.test(src) && /tabBtn\('versionControl', 'branch', tr\('panel\.tabVersionControl'\), 5\)/.test(src) && /tabBtn\('pr', 'swap', tr\('panel\.tabPr'\), 6\)/.test(src) && /tabBtn\('skills', 'compass', tr\('panel\.tabSkills'\), 7\)/.test(src) && /tabBtn\('checks', 'gear', tr\('panel\.tabChecks'\), 8\)/.test(src))
  ok('逻辑 · 动作键各带 data-priority（需求2/bug1）+ tabBtn 模板注入', /'data-priority': priority/.test(src) && /'data-priority': 2/.test(src) && /'data-priority': 1/.test(src))

  // 期望 5b：悬浮提示（portal Tooltip 替代 title）
  ok('提示 · tabTip 状态存在', /const \[tabTip, setTabTip\] = React\.useState\(null\)/.test(src))
  ok('提示 · portalTooltip 渲染（zIndex 2147483000）', /tabTip && portalTop\) \? portalTop\(/.test(src) && /zIndex: 2147483000/.test(src))
  ok('提示 · tabsTip 带 priority 门控（自身折叠才显示）', /const tabsTip = function \(e, text, priority\)/.test(src) && /btn\.classList\.contains\('collapsed'\)/.test(src))
  // 492357a2：刷新键挪去头部后走头部自己的 Tip（不再走 tabsTip，也没有 priority=3 这一档）。
  ok('提示 · 动作按钮传各自 priority（需求=2 / bug=1；刷新已挪头部走 Tip）', /tabsTip\(e, tr\('panel\.newWayfinderTitle'\), 2\)/.test(src) && /tabsTip\(e, tr\('panel\.newBugTitle'\), 1\)/.test(src))
  ok('提示 · tabBtn 传 priority 参数', /tabsTip\(e, label, priority\)/.test(src))
  // 同理 492357a2 少了一个触发点：现在每个 tabsTip 触发点（tabBtn 模板 + 需求 + bug，共 3 处）各配一个清除。
  const tipN = (src.match(/tabsTip\(e,/g) || []).length
  const offN = (src.match(/onMouseLeave: tabsTipOff/g) || []).length
  ok('提示 · 每个 tabsTip 触发点都配 onMouseLeave 清除（3 对）', tipN === 3 && offN === tipN)
  ok('提示 · 原生 title 已从动作按钮移除', !/title: tr\('panel\.(newWayfinderTitle|newBugTitle)'\)/.test(src))
  ok('提示 · 原生 title 已从 tabBtn 移除', !/title: label, className: 'dsws-tab'/.test(src))

  // 期望 6：hook 顺序合法（唯一消费方 DetailsDock；0704e78b 删掉 Overlay.js 后那条 early-return 不存在了）
  //   原判据锚在悬浮面板 Overlay 的 panelRef/tabsRef 与 `if (!s.open) return null` 之间、effect 依赖 [s.open]；
  //   退役后的等价形态：唯一那处 tabsRef 与它名下的折叠 effect 都排在组件渲染 return 之前（hooks 无条件、不进分支），
  //   effect 依赖 []（面板常驻右栏、开合不重挂 —— Dock.js 头注「关闭时子树不卸载（状态保留）」）。
  const ti1 = src.indexOf('const tabsRef = React.useRef(null)')
  const foldMark = src.indexOf('if (ro && observed !== t) {', ti1)
  const foldDeps = src.indexOf('}, [])', ti1)
  const ret = src.indexOf("return h('div', { ref: dockRef", ti1)
  ok('hook 顺序 · tabsRef 声明在 DetailsDock 渲染 return 之前', ti1 >= 0 && ret > ti1)
  ok('hook 顺序 · 折叠 effect 在 tabsRef 之后、渲染 return 之前，依赖 []（挂载一次）', foldMark > ti1 && foldDeps > foldMark && foldDeps < ret)
}

// ---- Part B：行为契约 —— tabsLevelDecide 真值表 ----
const behaviorChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  const m = src.match(/const tabsLevelDecide = function[\s\S]*?\n\s*\}/)
  if (!m) throw new Error(tag + ' · tabsLevelDecide 提取失败')
  const fnSrc = m[0].replace(/^const tabsLevelDecide\s*=\s*/, '')
  // 切出来的函数表达式配一个假滞回常量求值：改走共用入口 compileFn，参数名照原样列出。
  const fn = compileFn(['TABS_FOLD_HYST'], 'return (' + fnSrc + ')')(4)
  const N = [440, 300, 220] // 模拟：L0 短文案自然宽 440 / L1 图标 300 / L2 tab 图标 220
  const cases = [
    // [level, avail, nats, expect, desc]
    [0, 500, N, 0, '宽裕 → 保持 L0（短文案全显）'],
    [0, 400, N, 1, 'L0 放不下 → L1（动作按钮转图标）'],
    [0, 350, N, 1, 'L1 放得下且 L0 不够 → L1'],
    [0, 280, N, 2, 'L1 也不够 → L2（tab 转图标）'],
    [0, 80, N, 2, '极窄 → 顶格 L2'],
    [1, 500, N, 0, 'L1 且空间回够（≥L0+4）→ 降回 L0'],
    [1, 430, N, 1, '滞回带内（<L0+4）→ 保持 L1 防抖'],
    [1, 444, N, 0, '恰好 L0+4 → 降回 L0'],
    [2, 350, N, 1, 'L2 且空间够 L1(+4) → 降回 L1（tab 文字恢复）'],
    [2, 500, N, 0, 'L2 且空间够 L0 → 回 L0'],
    [2, 280, N, 2, 'L2 依旧放不下 → 保持 L2'],
    [0, 400, [], 0, 'nats 空保护 → 0'],
  ]
  for (const [lv, avail, nats, expect, desc] of cases) {
    const r = fn(lv, avail, nats)
    ok('行为 · tabsLevelDecide(' + [lv, avail, 'nats'].join(',') + ') = ' + r + '（' + desc + '）', r === expect)
  }
}

// ---- Part C（T5 #98 已移除）：双源镜像同步由一源两物构建保证 ----
// 保留 Part A/B 静态与行为契约对单产物的校验

const main = function () {
  let failed = false
  const sources = {}
  for (const file of files) {
    const tag = file.indexOf('package/') >= 0 ? 'npm' : 'dyn'
    console.log('=== ' + file + ' ===')
    const src = fs.readFileSync(file, 'utf8')
    sources[tag] = src
    try { statChecks(src, tag); behaviorChecks(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' — ' + e.message) }
  }
  // Part C 已移除（T5 #98）
  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}
main()
