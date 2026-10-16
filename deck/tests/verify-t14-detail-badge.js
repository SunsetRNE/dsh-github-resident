// verify-t14-detail-badge.js — dsh-waystation #462（v1.5 T14）：map 详情页标题前方紫色编号徽章
// 用法：node tests/verify-t14-detail-badge.js（在插件根目录；无需 gh / 网络）
//
// 验收（issue #462）：进入 map #445 详情，标题前方可见紫色 #445 徽章。
//
// 方法：从目标文件提取真实的 T14 渲染块（外包 flex 行 → 编号徽章 span + 标题），
//   在沙箱中用忠实替身 h() 执行，断言产出的 vnode 结构：
//   a) 徽章 span.dsws-idnum 文本 = '#' + m.number（#445），颜色/边框 #c084fc，flex:none
//   b) 徽章位于标题 div.dsws-mtitle 之前（flex 行第一子节点）
//   c) 标题 div 保留 dsws-mtitle + dsws-tt-wrap 与 flex:1 minWidth:0
//   d) 徽章锚点仅 1 处（无重复写入漂移）+ 双源特征逐字等价
//   e) 上下文锚定：该块位于 map 详情渲染内（前置为新会话按钮行）
//
// 2026-10-16（#64 收口）：判据锚点对齐产物的现状形态 —— 这一块自 #691 由 MapDetail.js 移到
//   views/MapDetailHead.js 后，源码里的形态与旧锚点不再逐字相同：
//     · 旧的 `// T14：map 编号徽章` 注释锚点已不存在；改用紫色徽章那一段字面量当唯一锚点（全仓 1 处）。
//     · 标题的悬浮说明由原生 `title: m.title` 换成了 `h(Tip, { content: ... })`（同一 tooltip 语义，
//       内容里逐字保留 m.title）；标题文本外面多包了一层省略号 span（窄屏截断用）。
//     · 外包 flex 行加了 marginTop/marginBottom: 2。
//   徽章本身（className/颜色/flex/文本/前置于标题）一字未变。断言没有删除或放宽：每一条契约
//   （唯一性、前置于标题、紫色、CSS 外观、tooltip 保留）都照旧钉着，只是锚到新形态。
import fs from 'node:fs'
import { compileFn } from './lib/eval-probe.js'
const files = ['client.js', 'package/lib/client.js']
let failed = false
let passed = 0
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (ok) passed++; else failed = true }

// 忠实替身 h()：记录 vnode 结构（type / props / children）
const hStub = function (type, props, children) {
  return { type: type, props: props || {}, children: children === undefined ? null : children }
}

// 锚点：紫色编号徽章那一段（全仓唯一）+ 它所在的外包 flex 行
const BADGE_ANCHOR = "className: 'dsws-idnum', style: { color: '#c084fc', borderColor: '#c084fc', flex: 'none' }"
const ROW_OPEN = "h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 2 } }, ["

// 提取真实的 T14 渲染块：从徽章往上找外包 flex 行，再从 children 数组按方括号配平找收尾（含 h(...) 的右括号）
const extractT14 = function (src) {
  const badge = src.indexOf(BADGE_ANCHOR)
  if (badge < 0) return ''
  const start = src.lastIndexOf(ROW_OPEN, badge)
  if (start < 0) return ''
  const open = start + ROW_OPEN.length - 1
  if (src[open] !== '[') return ''
  let depth = 0
  let close = -1
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '[') depth++
    else if (c === ']') { depth--; if (depth === 0) { close = i; break } }
  }
  if (close < 0) return ''
  return src.slice(start, close + 2) // ']' 后面的 ')' 是 h(...) 的收尾
}

// 渲染块 → 可执行表达式（去掉注释行）
const toExpr = function (block) {
  return block.split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0 }).join('\n').trim()
}

console.log('T14: #462 map 详情编号徽章（标题前方紫色）')

const blocks = {}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const tag = f.indexOf('package/') >= 0 ? 'pkg' : 'cli'
  const block = extractT14(src)
  blocks[tag] = block
  check(block.length > 0, f + ' 提取 T14 渲染块成功')
  if (!block.length) { failed = true; continue }

  // 上下文锚定：T14 块在 map 详情头部组件里，而该头部由 map 详情渲染挂上（那张详情页带顶部操作行：
  //   返回 + 新会话）。#691 阶段 3 把头部从 MapDetail.js 拆成独立组件 views/MapDetailHead.js 之后，
  //   顶部操作行与头部在产物里不再前后相邻（两个模块各自成段），所以锚定改成「组件归属 + 同一详情页的标记」。
  const badgeIdx = src.indexOf(BADGE_ANCHOR)
  const headDecl = src.lastIndexOf('const MapDetailHead = ', badgeIdx)
  check(headDecl > 0 && headDecl < badgeIdx, f + ' 块位于 map 详情头部组件（MapDetailHead）内')
  check(src.includes('h(MapDetailHead,'), f + ' map 详情渲染挂上头部组件（编号 + 标题那一行）')
  check(src.includes('openInNewSession(st, m)') && src.includes("tr('list.back')"), f + ' map 详情渲染含顶部操作行（返回 + 新会话按钮）')

  // 静态特征
  check(block.includes("className: 'dsws-idnum'"), f + ' 徽章 className dsws-idnum')
  check(block.includes("color: '#c084fc', borderColor: '#c084fc', flex: 'none'"), f + ' 徽章紫色 #c084fc + flex:none')
  check(block.includes("'#' + m.number"), f + ' 徽章文本 = # + 编号')
  check(block.includes("className: 'dsws-mtitle dsws-tt-wrap'"), f + ' 标题保留 dsws-mtitle dsws-tt-wrap')
  check(block.includes('flex: 1, minWidth: 0'), f + ' 标题 flex:1 minWidth:0（徽章不被挤压）')
  check(block.includes("h(Tip, { content:") && /whiteSpace: 'normal' \} \}, m\.title\)/.test(block), f + ' 标题悬浮说明经 Tip 保留（内容含 m.title）')
  check(block.includes("gap: 6, marginTop: 2, marginBottom: 2"), f + ' 外包 flex 行（垂直居中）')

  // 唯一性：锚点仅 1 处
  const anchors = src.split(BADGE_ANCHOR).length - 1
  check(anchors === 1, f + ' T14 锚点仅 1 处（无重复写入漂移）')

  // 徽章外观依赖 CSS 类（等宽 + 边框 + 圆角）：类定义必须存在，否则「紫色徽章」退化成裸文字
  const idnumCss = src.indexOf('.dsws-idnum{')
  check(idnumCss >= 0, f + ' CSS 类 .dsws-idnum 已定义（徽章外观）')
  if (idnumCss >= 0) {
    const cssBlock = src.slice(idnumCss, idnumCss + 220)
    check(cssBlock.includes('font-family:Consolas,Menlo,monospace'), f + ' .dsws-idnum 等宽字体')
    check(cssBlock.includes('border:1px solid'), f + ' .dsws-idnum 边框徽章')
    check(cssBlock.includes('border-radius:6px'), f + ' .dsws-idnum 圆角')
  }

  // 行为：执行真实渲染块，断言 vnode 结构
  try {
    // 从产物里切出来的那段渲染块当函数体造函数（自由变量显式当参数名），所以走 compileFn。
    //   Tip：悬浮提示组件替身（原样产出 props.children，DOM 上它不额外加层）；
    //   tr / effortOf / multiEffort：块里用到的三个外层名字（本块走不到 effort 分支）。
    const Tip = function (props, children) { return hStub('TipWrapper', props, children) }
    const render = compileFn(['h', 'm', 'Tip', 'tr', 'effortOf', 'multiEffort'], 'return (' + toExpr(block) + ')')
    const m = { number: 445, title: '[dsh-waystation] map 详情缺编号显示（bug）' }
    const v = render(hStub, m, Tip, function (k) { return k }, function () { return '' }, false)
    check(v && v.type === 'div', f + ' 渲染根节点为 flex 行 div')
    const kids = v && Array.isArray(v.children) ? v.children : []
    check(kids.length === 2, f + ' flex 行含 2 子节点（徽章 + 标题）')
    if (kids.length === 2) {
      const badge = kids[0]
      const titleWrap = kids[1]
      check(badge.type === 'span' && badge.props.className === 'dsws-idnum', f + ' 首子节点 = span.dsws-idnum 徽章')
      check(badge.children === '#445', f + ' 徽章文本 = #445（' + badge.children + '）')
      check(badge.props.style && badge.props.style.color === '#c084fc' && badge.props.style.borderColor === '#c084fc', f + ' 徽章紫色 #c084fc')
      check(badge.props.style && badge.props.style.flex === 'none', f + ' 徽章 flex:none')
      check(badge.children === '#' + m.number, f + ' 徽章文本 = # + 编号（数据驱动）')
      // 标题：经 Tip 包裹（组件层不算 DOM 层），Tip 的子节点就是标题 div
      const title = titleWrap && titleWrap.children
      check(title && title.type === 'div' && title.props.className === 'dsws-mtitle dsws-tt-wrap', f + ' 次子节点 = div.dsws-mtitle 标题')
      check(title && title.props.style && title.props.style.flex === 1 && title.props.style.minWidth === 0, f + ' 标题 flex:1 minWidth:0')
      const titleKids = title && Array.isArray(title.children) ? title.children : []
      const titleText = titleKids.filter(function (k) { return k && k.children === m.title })[0]
      check(!!titleText, f + ' 标题文本原样（省略号 span 内）')
      // tooltip：Tip 的 content 里保留完整标题（原生 title 已换成 Tip，语义不变）
      const tipContent = titleWrap && titleWrap.props ? titleWrap.props.content : null
      const contentKids = tipContent && Array.isArray(tipContent.children) ? tipContent.children : []
      check(!!contentKids.filter(function (k) { return k && k.children === m.title }).length, f + ' 悬浮说明里保留完整标题')
    }
  } catch (e) {
    check(false, f + ' 渲染块执行异常: ' + e.message)
  }
}

// 双源等价已移除（T5 #98：一源两物，build 保证同构）
// 保留对单产物（_dev/_pkg 各自）的 T14 行为校验，足以覆盖 map 详情徽章契约

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过：' + passed + ' 项检查')
