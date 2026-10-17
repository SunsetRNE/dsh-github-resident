// kernel/notice.js — 浮层小提示（提醒类气泡）这一族：颜色档 / 图标 / 显示与退场（#76 · #77）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
//   的 kernel 标记处（一源两物）。与 store-snapshot.js 分家的理由见 #77：那一份冻结在 358 行，
//   退场相位（状态 + 第二段定时器）塞不进去；三样东西一起搬走之后两份都在粒度红线以内。
//
// 寿命语义（#76，对齐上游 deepseek-ai/deepseek-harness 的 Toast 契约）：
//   · 每次显示一个自增号（st.noticeId）。清场**只认号、不认文案** —— 2.8s 内同文案重弹是新一轮，
//     上一轮的定时器到点只许对不上号（上游对应 c3ce020b 的「按每次显示编号」，重弹重走一轮）。
//   · 上游 f1e06a69 那条是**续命**问题的修法（onDone 进 effect deps → 重渲染无限续命）；本仓是
//     store + 定时器，坏的方向相反（提前掐），所以对齐的是契约不是代码形状。
//
// 退场相位（#77，对齐上游 Toast 的淡出口径）：到点不是直接置 null，而是先打 fading（节点留着、
//   CSS 在 180ms 里把透明度落到 0、末尾补 visibility:hidden），淡完才置 null。两条规矩：
//   · 两段定时器共用同一个号：淡出期间重弹 → 旧退场当场作废（和 #76 同一个守卫，不许换一种写法）；
//   · 卸载时刻不得早于 hold + fade（上游 CSS 注释那句话的本地版：一个值驱动两个时钟，不许淡到一半被卸载）。
//   本文件的 NOTICE_FADE_MS 与 styles.js 里 dsws-note-out 的 180ms 必须同值，门禁 verify-77 会比对。

export const NOTICE_COLOR = { ok: '#4ade80', warn: '#fbbf24', info: '#a1a1aa' }
export const noticeIcon = (k) => k === 'ok' ? 'check' : k === 'warn' ? 'alert' : 'clipboard'
export const NOTICE_HOLD_MS = 2800
export const NOTICE_FADE_MS = 180
export const flash = (st, msg, kind) => {
  // 每次显示一个序号：清场只认号（同文案重弹是新一轮，旧定时器到点只许对不上号）。
  const id = (st.noticeId = (st.noticeId || 0) + 1)
  const put = (fading) => { st.notice = { text: msg, kind: kind || 'info', id: id, fading: !!fading }; emit(st) }
  put(false)
  if (timer === undefined) return
  timer.timeout(function () {
    if (!st.notice || st.notice.id !== id) return
    put(true) // 退场相位：节点先留，样式把透明度落到 0（末尾 visibility:hidden，不拦点击）
    timer.timeout(function () { if (st.notice && st.notice.id === id) { st.notice = null; emit(st) } }, NOTICE_FADE_MS)
  }, NOTICE_HOLD_MS)
}
