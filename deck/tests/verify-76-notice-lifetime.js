#!/usr/bin/env node
/**
 * verify-76-notice-lifetime.js —— 浮层小提示（提醒类气泡）的**寿命语义**门禁（#76）
 *
 * 对齐的是上游对同族气泡（`packages/client/ui-primitives` 的 Toast）那条修复定下的**契约**，
 * 不是照抄它的代码形状（上游是 React 组件、病根是 `onDone` 进了 effect deps 所以被重渲染续命；
 * 本仓这台是 store + 定时器，坏的方向相反 —— 同文案重弹会被**上一轮**的定时器提前掐掉）：
 *   · `f1e06a69`（preserve toast lifetime across rerenders）：气泡的寿命归气泡自己，完成回调认最新那个。
 *   · `c3ce020b`（render notices through keyed toast factory）：**按每次显示编号**，同文案重弹重走一轮。
 *
 * #77 起这一族搬进了 `src/client/kernel/notice.js`（store-snapshot 冻结在 358 行，退场相位塞不进去），
 * 本门禁读的是搬过去之后那份真件；退场相位与点击穿透由 verify-77 管，这里只管寿命与身份。
 *
 * 四组断言（每组都带一条反证）：
 *   A. 行为：同文案重弹不被提前掐 · 新一轮到点才退场 · A→B→A 时第一轮不许掐第三次 · 不同文案互不干扰；
 *   B. 编号：每次 flash 自增 1，`st.notice.id` 与 `st.noticeId` 同号；
 *   C. 运行期反证：把守卫换回「文案相等」的副本跑同一探针 —— 必须被掐掉（证明探针抓得住，不是摆设）；
 *   D. 源码判据：编号自增在 · 守卫认号不认文案 · hold 是 2800 · 两处渲染都带 status 语义且挂退场类。
 *
 * 运行：node tests/verify-76-notice-lifetime.js（在 deck/ 目录下；只读源码 + 假定时器，不需要产物）
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
const DOCK = 'src/client/panel/Dock.js'
const SETTINGS = 'src/client/views/SettingsPage.js'
const HOLD = 2800

console.log('=== #76 浮层小提示的寿命语义（按每次显示编号）===')

// 把 notice.js 按同一套做法（剥行首 export、参数化自由变量 timer / emit）载进本进程。
function loadNotice(src) {
  try {
    const fn = compileFn(['timer', 'emit'], stripExport(src) + '\nreturn { flash: flash, NOTICE_HOLD_MS: NOTICE_HOLD_MS, NOTICE_FADE_MS: NOTICE_FADE_MS }')
    return (timer, emit) => fn(timer, emit)
  } catch (e) {
    bad('notice.js 可载入：' + (e && e.message))
    return null
  }
}

// 假定时器 rig：一条时间轴 + 一个能推进的时钟，emit 只记 tick。
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
  return { st, advance, flash: (msg, kind) => api.flash(st, msg, kind) }
}

const src = read(NOTICE)
const real = loadNotice(src)
if (real) {
  // ---- A1/A2/A3：同文案重弹是新一轮，上一轮的定时器到点只许对不上号 ----
  const r1 = makeRig(real)
  r1.flash('已复制链接 #74', 'ok')
  r1.advance(2000)
  r1.flash('已复制链接 #74', 'ok')
  const idAfterReflash = r1.st.notice && r1.st.notice.id
  r1.advance(2000 + 810) // t=2810：第一轮（t=0 弹的那一轮）的 hold 到点
  check(r1.st.notice !== null && r1.st.notice.id === idAfterReflash && r1.st.notice.fading === false, 'A1 同文案在 2.8s 内重弹：上一轮定时器到点后气泡仍在、且没被推进退场（不被提前掐掉）')
  check(r1.st.tick === 2, 'A2 上一轮定时器到点时没有多发一次广播（tick 仍是 2 次 flash）')
  r1.advance(2000 + HOLD + 20) // t=4820：第二轮的 hold 到点 → 进退场相位（退场由 #77 管）
  check(r1.st.notice !== null && r1.st.notice.fading === true, 'A3 第二轮自己的 hold 到点才进退场相位（不是被上一轮掐掉、也不是更早）')

  // ---- A4/A5：A → B → A：第一轮 A 的定时器不许动第三次的 A ----
  const r2 = makeRig(real)
  r2.flash('A', 'ok')
  r2.advance(1000)
  r2.flash('B', 'info')
  r2.advance(2500)
  r2.flash('A', 'ok')
  r2.advance(HOLD + 20) // t=2820：第一轮 A 的 hold 到点，此刻 notice 又是一句 A
  check(r2.st.notice !== null && r2.st.notice.text === 'A' && r2.st.notice.fading === false, 'A4 A→B→A：第一轮的 A 定时器到点后，第三次的 A 仍在（认号不认文案）')
  check(r2.st.notice && r2.st.notice.id === 3, 'A5 第三次的 A 是第 3 号（第一轮那个 1 号没有复活）')

  // ---- A6：不同文案互不干扰（这条旧实现也过，留着防回归）----
  const r3 = makeRig(real)
  r3.flash('A', 'ok')
  r3.advance(500)
  r3.flash('B', 'warn')
  r3.advance(HOLD + 20)
  check(r3.st.notice !== null && r3.st.notice.text === 'B' && r3.st.notice.kind === 'warn' && r3.st.notice.fading === false, 'A6 不同文案：A 的定时器到点后 B 仍在，且档位跟着 B（warn）')

  // ---- B：编号自增 ----
  const r4 = makeRig(real)
  r4.flash('x', 'ok')
  const one = r4.st.notice && r4.st.notice.id
  r4.flash('y', 'ok')
  const two = r4.st.notice && r4.st.notice.id
  check(typeof one === 'number' && two === one + 1 && r4.st.noticeId === two, 'B1 每次显示一个自增号：notice.id 与 st.noticeId 同号且逐次 +1（' + one + ' → ' + two + '）')
  check(one === 1, 'B2 同一个 store 的第一个气泡编号是 1（不是 0、不是空）')
}

// ---- C：运行期反证 —— 把守卫换回「文案相等」，同一探针必须掐掉 ----
const mutated = src.replace(/st\.notice\.id !== id/g, 'st.notice.text !== msg').replace(/st\.notice\.id === id/g, 'st.notice.text === msg')
check(mutated !== src && mutated.indexOf('st.notice.text === msg') !== -1, 'C0 反证副本改得动（守卫被换回「文案相等」）')
const mut = loadNotice(mutated)
if (mut) {
  const rm = makeRig(mut)
  rm.flash('已复制链接 #74', 'ok')
  rm.advance(2000)
  rm.flash('已复制链接 #74', 'ok')
  rm.advance(2000 + 810)
  check(rm.st.notice === null || rm.st.notice.fading === true, 'C1 反证：换回「认文案」之后同一场景当场被提前推进退场/掐掉（探针抓得住这类回退）')
}

// ---- D：源码判据（防实现漂移）----
const block = (src.match(/export const flash = \(st, msg, kind\) => \{[\s\S]*?\n\}/) || [''])[0]
check(/st\.noticeId = \(st\.noticeId \|\| 0\) \+ 1/.test(block), 'D1 flash 里每次显示都自增一个编号（st.noticeId）')
check(/st\.notice\.id === id/.test(block), 'D2 守卫认号（st.notice.id === id）')
check(block.indexOf('st.notice.text === msg') === -1, 'D3 守卫不认文案（旧写法一个字不剩）')
check(/NOTICE_HOLD_MS = 2800/.test(src), 'D4 停留时长仍是 2800ms（这一票只动「谁的寿命」，不动寿命长短）')

const dockSrc = read(DOCK)
const setSrc = read(SETTINGS)
check(/role: 'status', 'aria-live': 'polite'/.test(dockSrc), 'D5 面板里那枚气泡带 status 语义（role=status + aria-live=polite，读屏能念）')
check(/role: 'status', 'aria-live': 'polite'/.test(setSrc), 'D6 设置页里那枚气泡带同样的 status 语义')
const renderSites = (dockSrc + setSrc).split('className:').filter((s) => s.indexOf('dsws-note') !== -1).length
check(renderSites === 2, 'D7 这枚气泡的渲染点恰好两处（面板 + 设置页，没有第三份口径；实测 ' + renderSites + '）')

console.log('')
console.log(failed ? '存在失败 — verify-76-notice-lifetime 未通过' : '全部通过 — 浮层小提示的寿命语义生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
