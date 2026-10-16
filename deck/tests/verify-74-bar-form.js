#!/usr/bin/env node
/**
 * verify-74-bar-form.js — 状态栏那条横条的**形态档**门禁（#74）
 *
 * 票面钉的四件事，逐条对应下面的四组断言（每组都带一条「改坏即红」的反证）：
 *   1. 每档一条反证：窄→滑（全滑不收）· 宽→展（全展不滑）· 平板分屏→先收后滑 —— 三台假 DOM 上逐档核；
 *   2. 一条单一写入者守卫：全仓搜 `dsws-bar-scroll` 的写入点，只允许一处 add/remove/toggle；
 *   3. 一条「视口与那一格不同尺」的用例：视口 1440 而那一格 420 → 必须按 420 判（同一格上换个视口，结论一字不变）；
 *   4. 沿用 926 门的量法（flex 写次数 / 档号）：全滑不收那一档一个档都不走（只一次测量 = 24 次 flex 写）。
 *
 * 为什么另开一份、而不是塞进 verify-926-capfold-gate.js：那一份量的是**性能与守卫**（同输入零写、换代从旧档
 *   起步），这一份量的是**形态判据**（哪一档、那个开关谁写、按谁判）。两份都跑在假 DOM 上、都不开浏览器。
 *
 * 运行：node tests/verify-74-bar-form.js（在 deck/ 目录下；只读源码 + 假 DOM，不需要产物）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { compileFn } from './lib/eval-probe.js'

let passed = 0, failed = 0
const ok = (msg) => { passed++; console.log('  PASS ' + msg) }
const bad = (msg) => { failed++; console.log('  FAIL ' + msg) }
const check = (cond, msg) => { if (cond) ok(msg); else bad(msg) }
const read = (rel) => readFileSync(resolve(rel), 'utf8')
const stripExport = (s) => s.replace(/^[ \t]*export[ \t]+/gm, '')
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

const BARFORM = 'src/client/statusbar/barForm.js'
const RULER = 'src/client/statusbar/capFoldRuler.js'
const MACHINE = 'src/client/statusbar/capFoldMachine.js'
const BARSCROLL = 'src/client/statusbar/barScroll.js'
const CAPFOLD = 'src/client/statusbar/capFold.js'
const STYLES = 'src/client/kernel/styles.js'
const CLS = 'dsws-bar-scroll'

console.log('=== #74 形态档门禁（全展不滑 / 先收后滑 / 全滑不收 + 单一写入者）===')

// ---- A. 判据是纯函数：三档、边界、未知 ----
// 与 scripts/build.mjs 同一套做法：剥行首 export，拼进同一作用域跑。
const judge = (function () {
  try {
    return compileFn([], stripExport(read(BARFORM)) + '\nreturn { barFormFoldsFit: barFormFoldsFit, barFormOf: barFormOf, BAR_FORM_CLASS: BAR_FORM_CLASS, BAR_FORM_FLAT: BAR_FORM_FLAT, BAR_FORM_FOLD: BAR_FORM_FOLD, BAR_FORM_SCROLL: BAR_FORM_SCROLL }')()
  } catch (e) { return null }
})()
check(!!judge && typeof judge.barFormOf === 'function', '形态判据可载入（statusbar/barForm.js）')
if (judge) {
  const { barFormFoldsFit, barFormOf } = judge
  check(judge.BAR_FORM_FLAT === 'flat' && judge.BAR_FORM_FOLD === 'fold' && judge.BAR_FORM_SCROLL === 'scroll', '三档的名字就是票面那三态（flat / fold / scroll）')
  check(judge.BAR_FORM_CLASS === CLS, '判据里那个开关与 CSS 用的是同一个类名（' + CLS + '）')
  // 边界：收光了放得下 → 折叠有得收（真）；收光了也放不下 → 折叠救不了（假）；量不到 → 未知（null）
  check(barFormFoldsFit(347, 436) === false, 'A1 手机那一格（room 347 < 载荷 436）：收光了也放不下 → 折叠救不了')
  check(barFormFoldsFit(466, 436) === true, 'A2 平板分屏那一格（room 466 ≥ 载荷 436）：收光了放得下 → 折叠有得收')
  check(barFormFoldsFit(435, 436) === true && barFormFoldsFit(434, 436) === false, 'A3 边界与阶梯同尺（容差 +1：436 ≤ 435+1 算放得下、436 > 434+1 算放不下，与 capFoldFits 一个字不差）')
  check(barFormFoldsFit(0, 436) === null && barFormFoldsFit(420, 0) === null, 'A4 量不到的那一趟是未知（null），不是「放得下」')
  // 三档：foldsFit=false → 全滑不收；foldsFit=true + 停在第 0 档 → 全展不滑；foldsFit=true + 收过字 → 先收后滑
  const scroll = barFormOf({ foldsFit: false })
  const flat = barFormOf({ foldsFit: true, tier: 0 })
  const fold = barFormOf({ foldsFit: true, tier: 7 })
  check(scroll.form === 'scroll' && scroll.barScroll === true && scroll.spread === true, 'A5 窄 → **全滑不收**：字全摊开（spread）、开关落上（barScroll）')
  check(flat.form === 'flat' && flat.barScroll === false && flat.spread === false, 'A6 宽 → **全展不滑**：第 0 档、开关撤掉')
  check(fold.form === 'fold' && fold.barScroll === true && fold.spread === false, 'A7 平板分屏 → **先收后滑**：收字（不进 spread 那一支）、开关落上')
  // 反证：把「停在第几档」这一项去掉（只按 foldsFit 判），A6 与 A7 会输出同一个结论 —— 三档退化成两档
  check(barFormOf({ foldsFit: true, tier: 0 }).form !== barFormOf({ foldsFit: true, tier: 7 }).form, 'A8 反证：判据认得「一段都没收」与「收过字」的区别（少了这一项就只剩两档）')
  const unknown = barFormOf({ foldsFit: null })
  check(unknown.form === '' && unknown.barScroll === false && unknown.spread === false, 'A9 未知一个字都不写（form 空串、开关不动）')
}

// ---- B. 一把尺：判据里不许再出现第二把尺（视口 / 设备线 / 写死的像素线） ----
const code = {
  barForm: stripComments(read(BARFORM)),
  machine: stripComments(read(MACHINE)),
  ruler: stripComments(read(RULER)),
}
check(!/innerWidth|matchMedia|devicePixelRatio|userAgent/.test(code.barForm + code.machine), 'B1 判据与机器都不读视口 / 设备（没有 innerWidth / matchMedia / devicePixelRatio）')
check(!/\b468\b|\b679\b/.test(code.barForm + code.machine), 'B2 两条写死的像素线（468 / 679）从判据与机器里消失（只剩注释里记的那段历史）')
check(!/capFoldRowScrolls/.test(code.machine), 'B3 旧的 capFoldRowScrolls（两条线 OR 出来的形态）已撤掉')
check(/barFormFoldsFit\(/.test(code.machine) && /barFormOf\(/.test(code.machine), 'B4 机器的形态结论只从判据拿（barFormFoldsFit / barFormOf）')
check(/\.dsws-barcell\.dsws-bar-scroll/.test(read(STYLES)), 'B5 那个开关在 CSS 里仍是横滑那一层（.dsws-barcell.dsws-bar-scroll）')
// 三档的期望形态写清了（票面要求：手机竖屏 / 平板（分屏、竖屏、横屏）/ 桌面）
const head = read(BARFORM)
check(['手机竖屏', '平板分屏', '平板竖屏', '桌面'].every((k) => head.indexOf(k) >= 0) && ['flat', 'fold', 'scroll'].every((k) => head.indexOf(k) >= 0), 'B6 三档的期望形态在判据里写清了（手机竖屏 / 平板分屏 / 平板竖屏 / 桌面逐条给出形态名）')

// ---- C. 单一写入者：全仓只有一个地方写那个类 ----
const writeSites = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (!name.endsWith('.js')) continue
    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/classList\s*\.\s*(add|remove|toggle)\s*\(/)
      if (!m) return
      if (line.indexOf(CLS) >= 0 || line.indexOf('BAR_FORM_CLASS') >= 0) writeSites.push({ file: full.split('/').slice(-1)[0], line: i + 1, text: line.trim(), verb: m[1] })
    })
  }
}
walk('src')
check(writeSites.length === 1, 'C1 全仓只有一处写 ' + CLS + '（实测 ' + writeSites.length + ' 处：' + writeSites.map((w) => w.file + ':' + w.line).join(' / ') + '）')
check(writeSites.length === 1 && writeSites[0].file === 'capFoldMachine.js', 'C2 那一处住在形态结论的持有者里（capFoldMachine.js）')
check(writeSites.length === 1 && /try\s*\{/.test(writeSites[0].text), 'C3 那一处带无障碍兜底（try/catch）、且用的是 toggle（宽窄两个方向都从这一处走）')
check(!new RegExp('classList\\s*\\.\\s*(add|remove|toggle)\\s*\\([^)]*' + CLS).test(stripComments(read(BARSCROLL))), 'C4 barScroll.js 只读不写（它过去那句 toggle 已撤掉）')

// ---- D. 三档在真判据 + 真机器上的行为（假 DOM：几何模型＝真机上那一把尺子）----
// 假 DOM 的几何：每个孩子 = 一段图标与数字（base 宽，收不掉）+ 一个可收的 span（一个字 8px）。
//   摊开脚印 = Σ(base + 4 + 字数×8) + 11×6 = 820；收光后的载荷脚印 = Σbase + 11×6 = 436
//   —— 与 deck/docs/research/2026-10-12-toolbar-narrow-threshold.md 量到的那两个数同量级（822 / 436）。
const SPAN_GAP = 4, CH = 8, ROW_GAP = 6
const BASES = [30, 12, 46, 46, 46, 28, 55, 30, 27, 20, 10, 16]      // 合计 366 → 载荷 = 366 + 11×6 = 432
const CHARS = [4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 4]                 // 合计 42 字
const PAYLOAD = BASES.reduce((a, b) => a + b, 0) + ROW_GAP * (BASES.length - 1)
const FOOT = PAYLOAD + CHARS.reduce((a, c) => a + SPAN_GAP + c * CH, 0)

const makeScene = function (room, viewportW) {
  const stats = { flexWrites: 0, textWrites: 0, classWrites: 0 }
  const mkClassList = (el, log) => {
    const set = new Set()
    return {
      add: (c) => { set.add(c); if (log) stats.classWrites++ },
      remove: (c) => { set.delete(c); if (log) stats.classWrites++ },
      toggle: (c, on) => { const v = on === undefined ? !set.has(c) : !!on; if (v) set.add(c); else set.delete(c); if (log) stats.classWrites++; return v },
      contains: (c) => set.has(c),
    }
  }
  const row = { nodeType: 1, isConnected: true, tag: 'row' }
  const kids = BASES.map(function (base, i) {
    // 起始态＝React 画出来的那一帧：每一段挂着它完整的那串字（机器自己会照阶梯改写）
    const span = { text: 'w'.repeat(CHARS[i]), display: '', cls: null, p: String(i + 1) }
    const kid = { base: base, span: span, nodeType: 1, _text: '' }
    span.classList = mkClassList(span, false)
    span.el = { getAttribute: (n) => (n === 'data-fold-priority' ? span.p : null) }
    // 可收段「看得见」= 不在 display:none、没被 .dsws-folded 收掉、字不是空串（与 writeTier 写下去的形状一致）
    const spanHidden = () => span.display === 'none' || span.classList.contains('dsws-folded') || span.text === ''
    kid.width = () => base + (spanHidden() ? 0 : SPAN_GAP + span.text.length * CH)
    return kid
  })
  // 版面：孩子一个挨一个摆开（每次读矩形前重排，宽度按当前档位算）
  const relayout = () => { let x = 0; for (const k of kids) { k._left = x; x += k.width() + ROW_GAP } }
  const spans = kids.map((k) => ({
    getAttribute: (n) => (n === 'data-fold-priority' ? k.span.p : null),
    get textContent() { return k.span.text },
    set textContent(v) { stats.textWrites++; k.span.text = String(v) },
    classList: k.span.classList,
    style: { get display() { return k.span.display }, set display(v) { k.span.display = String(v) } },
  }))
  kids.forEach((k) => { k.getBoundingClientRect = () => { relayout(); return { left: k._left, right: k._left + k.width(), top: 0, width: k.width(), height: 20 } } })
  row.children = kids
  row.clientWidth = room + 12
  row.offsetWidth = room + 12
  row.querySelectorAll = (sel) => (sel === '[data-fold-priority]' ? spans : [])
  row.getBoundingClientRect = () => ({ left: 0, top: 0, width: room + 12, height: 22 })
  row.dataset = {}
  row.classList = mkClassList(row, true)
  row.parentElement = null
  kids.forEach((k) => {
    k.style = {}
    Object.defineProperty(k.style, 'flex', { get: () => k._flex || '', set: (v) => { stats.flexWrites++; k._flex = String(v) }, configurable: true })
    k.classList = mkClassList(k, false)
  })
  const win = {
    innerWidth: viewportW,
    getComputedStyle: (el) => (el === row ? { paddingLeft: '6px', paddingRight: '6px', display: 'flex', visibility: 'visible' } : { display: 'block', visibility: 'visible' }),
    requestAnimationFrame: () => 1,
  }
  row.ownerDocument = { defaultView: win }
  const cap = { dataset: {}, nodeType: 1, querySelector: (sel) => (sel === '.dsws-barcell' ? row : null), querySelectorAll: (sel) => (sel === '[data-fold-priority]' ? spans : []), parentElement: null }
  Object.defineProperty(cap, 'clientWidth', { get: () => room + 12 })
  Object.defineProperty(cap, 'offsetWidth', { get: () => room + 12 })
  Object.defineProperty(cap, 'scrollWidth', { get: () => (relayout(), kids.reduce((a, k) => a + k.width(), 0) + (kids.length - 1) * ROW_GAP) })
  cap.getBoundingClientRect = () => ({ width: room + 12, height: 22 })
  cap.isConnected = true
  cap.ownerDocument = row.ownerDocument
  return { cap: cap, row: row, kids: kids, stats: stats, foldedCount: () => kids.filter((k) => k.span.classList.contains('dsws-folded')).length, barScroll: () => row.classList.contains(CLS) }
}
const machine = (function () {
  try {
    return compileFn([],
      stripExport(read(CAPFOLD)) + '\n' + stripExport(read(BARFORM)) + '\n' + stripExport(read(RULER)) + '\n' + stripExport(read(MACHINE)) +
      '\nreturn { runCapFold: runCapFold }'
    )()
  } catch (e) { return null }
})()
check(!!machine && typeof machine.runCapFold === 'function', 'D0 四件套（让位次序 / 形态档 / 尺子 / 机器）可载入')
if (machine) {
  const runCase = (room, vw) => { const sc = makeScene(room, vw); const tier = machine.runCapFold(sc.cap, { full: {}, written: {} }); return { sc: sc, tier: tier } }

  console.log('  [诊断] 假 DOM 的载荷脚印 = ' + PAYLOAD + '，摊开脚印 = ' + FOOT + '（研究票实测 436 / 822）')
  // D1 宽 → 全展不滑
  const wide = runCase(900, 1440)
  check(wide.tier === 0 && wide.sc.foldedCount() === 0 && wide.sc.barScroll() === false, 'D1 宽（room 900 ≥ 摊开 ' + FOOT + '）→ 全展不滑：第 0 档、一段没收、开关不在（档号 ' + wide.tier + '，实收 ' + wide.sc.foldedCount() + ' 段）')
  // D2 平板分屏（512 列 → room 466）→ 先收后滑
  const pad = runCase(466, 810)
  check(pad.tier > 0 && pad.sc.foldedCount() > 0 && pad.sc.barScroll() === true, 'D2 平板分屏（room 466）→ 先收后滑：收过字（' + pad.sc.foldedCount() + ' 段）、开关落上（档号 ' + pad.tier + '）')
  // D2b 468 那条像素线的反证：room 500 在旧判据里是「横滑形态 → 字全摊开」，新判据按测量走「先收后滑」
  const mid = runCase(500, 1440)
  check(mid.tier > 0 && mid.sc.foldedCount() > 0 && mid.sc.barScroll() === true, 'D2b room 500（旧 468 那条线的另一侧）→ 仍是先收后滑，不是「全摊开」：反证两条像素线 OR 已不在（档号 ' + mid.tier + '）')
  // D3 手机（393 列 → room 347）→ 全滑不收，且一个档都不走（只一次测量）
  const phone = runCase(347, 393)
  check(phone.tier === 0 && phone.sc.foldedCount() === 0 && phone.sc.barScroll() === true, 'D3 手机（room 347 < 载荷 ' + PAYLOAD + '）→ 全滑不收：字全摊开、开关落上（档号 ' + phone.tier + '）')
  check(phone.sc.stats.flexWrites === 24, 'D3b 那一档**一个档都不走**：只花一次测量（flex 写 ' + phone.sc.stats.flexWrites + ' 次 = 12 个孩子各一次写与还原），不去逐档试')
  // D4 视口与那一格不同尺：同一格（420）换个视口，结论一字不变
  const cell1440 = runCase(420, 1440)
  const cell390 = runCase(420, 390)
  check(cell1440.sc.barScroll() === cell390.sc.barScroll() && cell1440.tier === cell390.tier && cell1440.sc.foldedCount() === cell390.sc.foldedCount(), 'D4 视口 1440 而那一格 420：按 420 判（与视口 390 那一趟同结论：档号 ' + cell1440.tier + ' / 开关 ' + cell1440.sc.barScroll() + '）')
  check(cell1440.sc.barScroll() === true && cell1440.tier === 0, 'D4b 那一格 420 < 载荷 ' + PAYLOAD + ' → 全滑不收（若判据读视口 1440，这一条会当场红）')
  // D4c 反证：旧判据（两条写死的像素线 OR）在同一格上会判「不是横滑形态」→ 与今天的结论相反
  const oldRule = (room, vw) => (room >= 468 || vw <= 679)
  check(oldRule(420, 1440) === false && oldRule(500, 1440) === true, 'D4c 反证：旧 OR 判据在「420 那格」判不是横滑、在「500 那格」判是横滑 —— 今天两格都按测量走（前者全滑、后者先收后滑）')
  // D5 单一写入者的行为面：滑窗那台在「没有可滑量」时把状态画上去，不许撤掉形态开关
  const barScrollMod = (function () {
    try { return compileFn([], stripExport(read(BARSCROLL)) + '\nreturn { applyBarScrollState: applyBarScrollState }')() } catch (e) { return null }
  })()
  if (barScrollMod) {
    const sc = makeScene(466, 810)
    machine.runCapFold(sc.cap, { full: {}, written: {} })
    const before = sc.barScroll()
    barScrollMod.applyBarScrollState(sc.row, { canLeft: false, canRight: false, maxLeft: 0 })
    check(before === true && sc.barScroll() === true, 'D5 滑窗那台画状态（无可滑量）之后形态开关仍在 —— 第二个写入者确实撤掉了（若它还在 toggle，这一条红）')
  } else { bad('D5 barScroll.js 可载入') }
  // D6 守卫仍然有效：同输入第二趟零写（926 门那条语义在本门禁里也不能丢）
  const sc2 = makeScene(466, 810)
  const keep2 = { full: {}, written: {} }
  machine.runCapFold(sc2.cap, keep2)
  const beforeWrites = sc2.stats.flexWrites + sc2.stats.textWrites + sc2.stats.classWrites
  machine.runCapFold(sc2.cap, keep2)
  const afterWrites = sc2.stats.flexWrites + sc2.stats.textWrites + sc2.stats.classWrites
  check(afterWrites === beforeWrites, 'D6 同输入第二趟零写（守卫不动：flex/字/类都没再写，实测 +' + (afterWrites - beforeWrites) + '）')
}

console.log('')
console.log(failed ? '存在失败 — verify-74-bar-form 未通过' : '全部通过 — 形态档门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
