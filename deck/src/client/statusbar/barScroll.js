// statusbar/barScroll.js — 状态栏胶囊那条横条的横滑窗（票 #7 真机反馈：滑不动；2026-10-13）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。
//
// 他原话：「注册在对话框的这个小横条没办法滑动」。查实：这条横条从来没有横滑 —— 窄了就是斩断
//   （`StatusBar.js` 只写了 `overflow: hidden/visible`，没有任何可滑容器）。这一台补上：
//   · 内容进一个 `overflow-x: auto` 的滑窗，手指能拖、两端能滑；
//   · 右端那两件（日志点、收起∨）留在**窗外**钉死（他上一轮定的「右端已定钉住」）；
//   · 到端头给提示 —— 用他 2026-10-12 定的小箭头（左端不显、右边还有余量才显），
//     点一下滚约一屏的 80%（`arrowStepPx`）；
//   · 滑完之后**不误开右面板**：滑窗上的 click 里用「按下到抬起移动超过 6px 就算滑动」判掉，
//     这条判据与箭头本身都在这里，`StatusBar.js` 只负责把节点摆上去、把观察器接上。
//
// 与 capFold 阶梯的关系：阶梯仍然管「字收多少」，一台机器同时管两件事会打架。分工写成：
//   **阶梯只负责把字号收小到内容刚好放得下；一旦收到底还放不下（或这条线本来就不收字），
//   剩下的宽度差交给横滑。** 所以放置器先让阶梯跑（runCapFold），量一次；若仍然溢出，
//   就把箭头挂上、把滑窗的滚动位置夹回合法范围。
export const BAR_SCROLL_MOVE_PX = 6   // 一次指针序列里移动超过这么多像素 → 算滑动，不算点击

/**
 * 纯判据：给定这一档的几何，算出滑窗该显哪几颗箭头、还能滚多少。
 *   data = { clientW, scrollW, scrollLeft, hitPx }
 * 返回 { hasOverflow, canLeft, canRight, maxLeft, leftPx, rightPx }
 *   leftPx/rightPx 是「这条还有没有余量」的像素口径（箭头是视觉提示，不给它撑 44px，
 *   免得它盖住内容；点击判定仍按 BAR_SCROLL_MOVE_PX）。
 */
export const barScrollState = function (data) {
  const d = data || {}
  const clientW = Math.max(0, Number(d.clientW) || 0)
  const scrollW = Math.max(0, Number(d.scrollW) || 0)
  const scrollLeft = Math.max(0, Number(d.scrollLeft) || 0)
  const maxLeft = Math.max(0, scrollW - clientW)
  return {
    hasOverflow: maxLeft > 1,
    canLeft: scrollLeft > 1,
    canRight: scrollLeft < maxLeft - 1,
    maxLeft: maxLeft,
    leftPx: Math.round(scrollLeft),
    rightPx: Math.round(maxLeft - scrollLeft),
  }
}

/** 点箭头滚多少：一屏的 80%，至少 80px，最多不超过剩余量。 */
export const arrowStepPx = function (clientW, remainPx) {
  const step = Math.max(80, Math.round((Number(clientW) || 0) * 0.8))
  return Math.max(0, Math.min(step, Math.round(Number(remainPx) || 0)))
}

/**
 * 把一份 barScrollState 画到滑窗那个元素上（只碰 class 与 dataset，不碰结构）：
 * 给 `.dsws-barcell` 加 `dsws-can-left` / `dsws-can-right`；`data-bar-overflow` 记还有多少像素。
 */
export const applyBarScrollState = function (cell, st2) {
  if (!cell || !cell.dataset) return
  const s2 = st2 || {}
  try {
    cell.classList.toggle('dsws-can-left', !!s2.canLeft)
    cell.classList.toggle('dsws-can-right', !!s2.canRight)
    // 2026-10-13（真机「字被图标替代」）：还有东西没露出来，就说明这一条是**横滑形态**。
    //   这一条 class 是给 CSS 看的开关：横滑形态下可见行里的各段不许再被压扁（见 styles.js 里
    //   `.dsws-barcell.dsws-bar-scroll > *{flex:0 0 auto;min-width:auto}`），内容该溢出到滑窗里，
    //   而不是被 flex 压成看不见、让阶梯以为「放得下」。两端都没有可滑量时不加，避免宽屏上多一层规则。
    cell.classList.toggle('dsws-bar-scroll', !!(s2.canLeft || s2.canRight))
    cell.dataset.barOverflow = String(s2.maxLeft || 0)
    // 箭头跟着状态亮灭：节点由 StatusBar 摆好、挂在滑窗的父节点（.dsws-capsule）下。
    // 2026-10-13 门禁抓到过一版没接上：箭头永远不亮（S2 那条断言）。
    const host = cell.parentElement
    if (host) {
      const l = host.querySelector('.dsws-bar-arrow-l')
      const r = host.querySelector('.dsws-bar-arrow-r')
      if (l) l.classList.toggle('dsws-show', !!s2.canLeft)
      if (r) r.classList.toggle('dsws-show', !!s2.canRight)
    }
  } catch (e) { /* 无障碍环境：只影响提示，不影响功能 */ }
}

/**
 * 量一次滑窗并落状态（`StatusBar.js` 的观察器与滚动回调都调它）。
 *   win  = `.dsws-barcell`（可滑容器）
 *   keep = 调用方跨调用带着走的记账（挂 ref），这里只用一个字段 scrollState。
 * 量不到有效宽（宽高都 0）时不下结论、不写状态。
 */
export const measureBarScroll = function (win, keep) {
  if (!win || typeof win.getBoundingClientRect !== 'function') return null
  const r = win.getBoundingClientRect()
  const clientW = Math.round(win.clientWidth || r.width || 0)
  const scrollW = Math.round(win.scrollWidth || 0)
  if (!clientW || !scrollW) return null
  const st2 = barScrollState({ clientW: clientW, scrollW: scrollW, scrollLeft: win.scrollLeft })
  if (keep) keep.scrollState = st2
  applyBarScrollState(win, st2)
  return st2
}

/** 箭头点击：往哪边滚多少。delta = -1 左 / +1 右。 */
export const scrollBarBy = function (win, delta, keep) {
  if (!win) return null
  const st2 = (keep && keep.scrollState) || measureBarScroll(win, keep) || { maxLeft: 0, leftPx: 0 }
  const remain = delta < 0 ? st2.leftPx : st2.rightPx
  const step = arrowStepPx(win.clientWidth, remain)
  try { win.scrollLeft = Math.max(0, Math.round((win.scrollLeft || 0) + (delta < 0 ? -step : step))) } catch (e) { /* 忽略 */ }
  return measureBarScroll(win, keep)
}

/**
 * 滑动的「按下-抬起」判定：返回一个闭包，pointerdown 记起点，pointerup 判定这次算不算滑动。
 * 用途：滑窗上的点击若跟在一次滑动之后，不许把它读成「点胶囊开面板」。
 */
export const makeScrollClickGuard = function () {
  let startX = null
  let startY = null
  return {
    down: function (e) { try { startX = e.clientX; startY = e.clientY } catch (e2) { startX = null } },
    // true = 这次抬起来算滑动（调用方应拦掉 click）
    up: function (e) {
      if (startX === null) return false
      let moved = 0
      try { moved = Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) } catch (e2) { moved = 0 }
      startX = null; startY = null
      return moved > BAR_SCROLL_MOVE_PX
    },
    // click 到得比 pointerup 晚：记一次「刚滑过」，由调用方在读的时候消费掉
    markMoved: function () { startX = null; return true },
  }
}
