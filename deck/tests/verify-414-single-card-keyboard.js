/**
 * verify-414-single-card-keyboard —— #414 的**行为**判据（不是 grep 源码字形）。
 *
 * 为什么要有它（2026-10-14，票 #39《deck 门禁红：#414 single-card 的四条判据》）：`verify-414-single-card.js`
 * 那十条读的是源码**文本**（拼合后 includes）。它能证明「那几行字还在某个文件里」，**不能**证明
 * 「键盘真的能用、ARIA 真的报了选中态」—— 而 #414 当初要的正是后者（字形对不上行为时，形似判据是绿的）。
 * 这一条直接 import 渲染模块、用桩 `h` 建树、真调 `onKeyDown` / `onClick`，看值有没有落地。
 *
 * 判据：
 *   ① 语义：single 字段渲染出的选项带 role=radio / aria-checked（选中 true、其余 false）/ aria-label；非 pending 时 tabIndex=0；
 *   ② 键盘可达：' ' / 'Enter' / 'Spacebar' / 'Space' 四个键都提交值，且调用 preventDefault（不让空格滚页面）；
 *   ③ 向导：提交时同步 m.valuesByStep[stepIndex]（按步隔离，Q3 最后一起提交）；
 *   ④ pending：tabIndex -1，键盘与点击**都不写值**（禁用态不能靠键盘绕过）；
 *   ⑤ 异常分支：非提交键（'a' / 'Escape'）与没带 key 的事件都不写值；
 *   ⑥ 回归：multi 与文本框那两支不受影响（multi 的选项不带 role=radio）。
 *
 * 离线、不依赖浏览器与 jsdom：桩 h 返回普通对象树。
 *
 * **本件证明什么 / 不证明什么**（照 verify-671 的先例把替身的盲区写下来 —— LESSONS 坑 26：自己写的替身
 * 「通过了」只证明替身写得对）：
 *   - **证明**：渲染模块**产出的 props 与 handler 逻辑**对不对 —— 桩 `h` 建树之后真调 `onKeyDown` / `onClick`，
 *     值有没有落到 `setVals` / `valuesByStep` 上是**真判据**（不是 grep 源码字形）；
 *   - **不证明**：真浏览器里的行为 —— 真实焦点与 Tab 顺序、读屏实际念出什么、CSS 可见性。
 *     那些要真浏览器（本机缺 Chromium headless shell，见 #42 的存量红分流），本件**不假装覆盖**。
 *
 * 用法：node tests/verify-414-single-card-keyboard.js
 */
import { modalFormFields } from '../src/client/kernel/modal-fields.js'

function check(cond, msg){ if(!cond){ console.error('FAIL', msg); process.exitCode = 1 } else console.log('PASS', msg) }

/** 桩 h：建一棵可遍历的普通对象树（够用来读 props、调 handlers）。 */
const h = (tag, props, children) => ({ tag, props: props || {}, children: children || [] })
const walk = (tree, out) => {
  if (Array.isArray(tree)) { for (const t of tree) walk(t, out); return out }
  if (!tree || typeof tree !== 'object') return out
  out.push(tree)
  if (tree.children) walk(tree.children, out)
  return out
}
const nodes = (tree) => walk(tree, [])
const radios = (tree) => nodes(tree).filter((n) => n.props && n.props.role === 'radio')

/** 渲染一个字段；回执里带 vals / setVals 的调用记录 / m / 树。 */
function render(field, opts = {}) {
  const vals = Object.assign({}, opts.vals || {})
  const calls = []
  const setVals = (next) => { calls.push(next); Object.assign(vals, next) }
  const m = { pending: Boolean(opts.pending), valuesByStep: opts.valuesByStep || null }
  const ctx = { m, isWizard: Boolean(opts.isWizard), stepIndex: opts.stepIndex || 0, vals, setVals, onPick: () => () => {}, h }
  return { tree: modalFormFields([Object.assign({ name: 'visibility', label: '可见性', options: ['public', 'private'] }, field)], ctx), vals, calls, m }
}
const SINGLE = { type: 'single' }

// ---------------------------------------------------------------------------
// ① 语义：ARIA 与 tab 序
// ---------------------------------------------------------------------------
const r1 = render(SINGLE, { vals: { visibility: 'public' } })
const opts1 = radios(r1.tree)
check(opts1.length === 2, 'single 字段渲染出 2 个 role=radio 的选项（实得 ' + opts1.length + '）')
check(opts1[0] && opts1[0].props['aria-checked'] === 'true' && opts1[1] && opts1[1].props['aria-checked'] === 'false',
  'aria-checked 跟着选中态走（public=true / private=false）')
check(opts1.every((o) => typeof o.props['aria-label'] === 'string' && o.props['aria-label'].length > 0),
  '每个选项都带 aria-label（读屏认得这一项）')
check(opts1.every((o) => o.props.tabIndex === 0), '非 pending：tabIndex=0（能进 tab 序）')
check(opts1.every((o) => typeof o.props.onClick === 'function' && typeof o.props.onKeyDown === 'function'),
  '两个 handler 都在（鼠标与键盘各一条路）')

// ---------------------------------------------------------------------------
// ② 键盘可达：四个键名变体
// ---------------------------------------------------------------------------
const keyLabel = (k) => (k === ' ' ? '空格' : k)
for (const key of [' ', 'Enter', 'Spacebar', 'Space']) {
  const r = render(SINGLE, { vals: { visibility: 'public' } })
  let prevented = false
  const target = radios(r.tree)[1]
  target.props.onKeyDown({ key, preventDefault: () => { prevented = true } })
  check(r.calls.length === 1 && r.calls[0].visibility === 'private',
    '按「' + keyLabel(key) + '」提交到 private（写值恰好一次）')
  check(prevented === true,
    '按「' + keyLabel(key) + '」时 preventDefault（' + (key === ' ' || key === 'Spacebar' || key === 'Space' ? '空格不会滚页面' : '不让按键穿透默认行为') + '）')
}
// 鼠标那条路与键盘等价（同一处写入逻辑）
const r2 = render(SINGLE, { vals: { visibility: 'public' } })
radios(r2.tree)[1].props.onClick()
check(r2.calls.length === 1 && r2.calls[0].visibility === 'private', '点击也提交到 private（与键盘同一条写入逻辑）')

// ---------------------------------------------------------------------------
// ③ 向导：按步隔离
// ---------------------------------------------------------------------------
const r3 = render(SINGLE, { isWizard: true, stepIndex: 1, vals: { visibility: 'public' }, valuesByStep: { 1: { visibility: 'public' } } })
radios(r3.tree)[1].props.onKeyDown({ key: ' ' })
check(r3.m.valuesByStep && r3.m.valuesByStep[1] && r3.m.valuesByStep[1].visibility === 'private',
  '向导场景：键盘提交同步 valuesByStep[stepIndex]（不会污染别的步）')
check(r3.m.valuesByStep[1] !== r3.vals, '同步的是副本（不是把同一对象塞进去）')

// ---------------------------------------------------------------------------
// ④ pending：禁用态
// ---------------------------------------------------------------------------
const r4 = render(SINGLE, { pending: true, vals: { visibility: 'public' } })
check(radios(r4.tree).every((o) => o.props.tabIndex === -1), 'pending：tabIndex=-1（从 tab 序里摘掉）')
radios(r4.tree)[1].props.onKeyDown({ key: ' ' })
radios(r4.tree)[1].props.onClick()
check(r4.calls.length === 0, 'pending：键盘与点击都不写值（禁用态不能靠键盘绕过）')

// ---------------------------------------------------------------------------
// ⑤ 异常分支：不是提交键就不写
// ---------------------------------------------------------------------------
for (const ev of [{ key: 'a' }, { key: 'Escape' }, { key: 'Tab' }, {}]) {
  const r = render(SINGLE, { vals: { visibility: 'public' } })
  radios(r.tree)[1].props.onKeyDown(ev)
  check(r.calls.length === 0, '非提交键（' + JSON.stringify(ev.key === undefined ? '(无 key)' : ev.key) + '）不写值')
}

// ---------------------------------------------------------------------------
// ⑥ 回归：别的字段类型不受影响
// ---------------------------------------------------------------------------
const r6 = render({ type: 'multi' }, { vals: { visibility: ['public'] } })
check(radios(r6.tree).length === 0, 'multi 字段不渲染 radio（single 的语义不外溢）')
check(nodes(r6.tree).some((n) => n.tag === 'input' && n.props.type === 'checkbox'), 'multi 仍是复选框那支')
const r7 = render({ type: 'text' }, { vals: {} })
check(radios(r7.tree).length === 0 && nodes(r7.tree).some((n) => n.tag === 'input' && n.props.type === 'text'),
  '文本框那支仍渲染 text input（回归）')

check(typeof modalFormFields === 'function',
  '渲染模块能 import 进来且是函数 —— 这条判据测的就是被拼进产物那一支（它若搬家，这里 import 就报错）')
console.log('done')
