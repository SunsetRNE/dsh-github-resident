#!/usr/bin/env node
/**
 * verify-77-notice-fade.js —— 浮层小提示的**退场相位**门禁（#77）
 *
 * 对齐上游 Toast 的淡出口径（`packages/client/ui-primitives` 的 Toast.module.css）：
 *   · 一个值驱动两个时钟：淡出的时长与 JS 收尾定时器必须同值，不许淡到一半被卸载；
 *   · 公告类气泡永不拦点击：`pointer-events:none` + 关键帧末尾 `visibility:hidden`；
 *   · 减少动态不改变「气泡最终被收掉」这件事（动画可以关，收尾不许丢）。
 *
 * 断言分三组：
 *   A. 相位机（假定时器驱动真件）：hold 到点 → 仍在且 fading · hold+fade 到点 → null · 淡出期间重弹 → 旧退场作废；
 *   B. 运行期反证：把「淡完置 null」拆掉 → 气泡永久驻留（探针抓得住）；
 *   C. 源码判据：指针穿透 · 关键帧末尾 visibility:hidden · JS 与 CSS 的淡出时长同值 · 两处渲染挂退场类。
 *
 * 运行：node tests/verify-77-notice-fade.js（在 deck/ 目录下；只读源码 + 假定时器，不需要产物）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileFn } from './lib/eval-probe.js'

let passed = 0, failed = 0
const ok = (msg) => { passed++; console.log('  PASS ' + msg) }
const bad = (msg) => { failed++; console.log('  FAIL ' + msg) }
const check = (cond, msg) => { if (cond) ok(msg); else bad(msg) }
const read = (rel) => readFileSync(resolve(rel), 'utf8')
const stripExport = (s) => s.replace(/^[ \t]*export[ \t]+/gm, '')

const NOTICE = 'src/client/kernel/notice.js'
const STYLES = 'src/client/kernel/styles.js'
const DOCK = 'src/client/panel/Dock.js'
const SETTINGS = 'src/client/views/SettingsPage.js'

console.log('=== #77 浮层小提示的退场相位（淡出 + 点击穿透 + 减少动态）===')

const src = read(NOTICE)
const HOLD = (src.match(/NOTICE_HOLD_MS = (\d+)/) || [])[1]
const FADE = (src.match(/NOTICE_FADE_MS = (\d+)/) || [])[1]

function loadNotice(code) {
  try {
    const fn = compileFn(['timer', 'emit'], stripExport(code) + '\nreturn { flash: flash, NOTICE_HOLD_MS: NOTICE_HOLD_MS, NOTICE_FADE_MS: NOTICE_FADE_MS }')
    return (timer, emit) => fn(timer, emit)
  } catch (e) {
    bad('notice.js 可载入：' + (e && e.message))
    return null
  }
}

function makeRig(load) {
  let now = 0
  const live = []
  const timer = {
    timeout(fn, ms) {
      const h = { at: now + ms, fn, disposed: false, dispose() { this.disposed = true } }
      live.push(h)
      return h
    },
  }
  const advance = (to) => {
    for (;;) {
      const due = live.filter((h) => !h.disposed && h.at <= to).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      now = due.at
      due.disposed = true
      due.fn()
    }
    now = to
  }
  const st = { notice: null, tick: 0 }
  const api = load(timer, (s) => { s.tick += 1 })
  return { st, advance, flash: (msg, kind) => api.flash(st, msg, kind), holdMs: api.NOTICE_HOLD_MS, fadeMs: api.NOTICE_FADE_MS }
}

const real = loadNotice(src)
const H = Number(HOLD), F = Number(FADE)
check(H > 0 && F > 0, 'A0 两个时长都读得到（hold ' + HOLD + 'ms / fade ' + FADE + 'ms）')

if (real) {
  // ---- A1/A2：到点先进退场相位（节点留着），淡完才 null ----
  const r1 = makeRig(real)
  r1.flash('已复制链接 #74', 'ok')
  r1.advance(H - 10)
  check(r1.st.notice !== null && r1.st.notice.fading === false, 'A1 hold 还没到点时：气泡在、且不在退场相位（' + (H - 10) + 'ms）')
  r1.advance(H + 10)
  check(r1.st.notice !== null && r1.st.notice.fading === true, 'A2 hold 到点：气泡**仍在**、进入退场相位（节点先留，CSS 在淡）')
  r1.advance(H + F - 10)
  check(r1.st.notice !== null, 'A3 淡出没走完（hold+fade-' + 10 + 'ms）：还没被卸载 —— 不许淡到一半就删节点')
  r1.advance(H + F + 10)
  check(r1.st.notice === null, 'A4 hold+fade 走完才置 null（' + (H + F) + 'ms）')
  check(r1.st.tick === 3, 'A5 三轮广播一次不多一次不少（flash 1 + 退场相位 1 + 卸载 1，实测 ' + r1.st.tick + '）')

  // ---- A6/A7：淡出期间重弹 → 旧退场作废，新一轮从头计时 ----
  const r2 = makeRig(real)
  r2.flash('A', 'ok')
  r2.advance(H + 20)
  check(r2.st.notice && r2.st.notice.fading === true, 'A6 第一轮已进退场相位')
  r2.flash('A', 'ok') // 同一个文案在淡出期间重弹
  const id2 = r2.st.notice && r2.st.notice.id
  check(r2.st.notice && r2.st.notice.fading === false, 'A7 淡出期间重弹：退场相位被撤销（fading 回到 false，节点重新可见）')
  r2.advance(H + 20 + F + 10) // 旧退场的收尾时刻
  check(r2.st.notice !== null && r2.st.notice.id === id2, 'A8 旧退场的收尾到点不许动新一轮（认号，id 仍是 ' + id2 + '）')
  r2.advance(H + H + 20 + 10) // 新一轮自己的 hold
  check(r2.st.notice && r2.st.notice.fading === true && r2.st.notice.id === id2, 'A9 新一轮自己到 hold 才再次进退场相位')
  r2.advance(H + H + F + 40)
  check(r2.st.notice === null, 'A10 新一轮自己淡完才清空（重弹确实是完整一轮，不是把旧的一轮续上）')
}

// ---- B：运行期反证 —— 拆掉「淡完置 null」，气泡必须永久驻留（探针抓得住）----
const noClear = src.replace(/timer\.timeout\(function \(\) \{ if \(st\.notice && st\.notice\.id === id\) \{ st\.notice = null; emit\(st\) \} \}, NOTICE_FADE_MS\)/, 'void 0')
check(noClear !== src, 'B0 反证副本改得动（淡完那一步被拆掉）')
const mut = loadNotice(noClear)
if (mut) {
  const rm = makeRig(mut)
  rm.flash('A', 'ok')
  rm.advance(Number(HOLD) + Number(FADE) + 2000)
  check(rm.st.notice !== null && rm.st.notice.fading === true, 'B1 反证：拆掉收尾之后气泡永久驻留（探针抓得住「淡完不清」这类回退）')
}

// ---- C：源码判据 ----
check(src.indexOf('put(true)') !== -1 && /NOTICE_FADE_MS = 180/.test(src), 'C1 退场相位在真件里（put(true) + NOTICE_FADE_MS = 180）')
const css = read(STYLES)
check(/\.dsws-note\{[^}]*pointer-events:none/.test(css), 'C2 气泡不拦点击（.dsws-note 上有 pointer-events:none —— 上游那条「公告类气泡永不拦点击」）')
check(/@keyframes dsws-note-out\{to\{opacity:0;visibility:hidden\}\}/.test(css), 'C3 淡出关键帧末尾补 visibility:hidden（淡完的气泡既看不见、也不占指针）')
check(/\.dsws-note-out\{animation:dsws-note-out 180ms/.test(css), 'C4 淡出时长与 JS 同值（CSS 180ms = NOTICE_FADE_MS 180）')
check(/@media \(prefers-reduced-motion: reduce\)\{\.dsws-note-out\{animation:none;opacity:0;visibility:hidden\}\}/.test(css), 'C5 减少动态：动画关掉、直接落到「看不见也不拦点击」，而收尾仍由 JS 定时器负责')
const dockSrc = read(DOCK)
const setSrc = read(SETTINGS)
check(/dsws-note-out'.*: 'dsws-note'/.test(dockSrc) && /dsws-note-out'.*: 'dsws-note'/.test(setSrc), 'C6 两处渲染都在 fading 时挂退场类（面板 + 设置页，同一口径）')

console.log('')
console.log(failed ? '存在失败 — verify-77-notice-fade 未通过' : '全部通过 — 退场相位门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
