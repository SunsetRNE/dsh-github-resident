// src/shared/deck-tools/exec-cell.js —— 宿主那张表在同一进程里的共享格（#758）
//
// 只讲一件事：行与宿主跑在同一个进程里（同一份组合、同一份工具注册表，
// 预设行经作用域读全局层，见上游 web-app 组合注释），所以宿主装好的那张表
// 不需要经任何调用面递过去——宿主把它放进这一格，行直接来取。
// 若两边真不在同一进程（旧桌面那种），这一格永远是空的，行按原路退回，
// 一行老行为都不变。
//
// 本文件零导入：共享层的文件之间不许互相引用，零导入是唯一的住法。
// 状态只有三种：empty（宿主还没放）、pending（放了还没装好）、ready（装好了）。
// pid 只在进程内比对，永不外发（探针只报比对结果的布尔值）。
// 另附一小段闸口径迹：壳把每次裁决的机器码（阶段、结论、原因枚举）记在这里，
// 探针读走，线上卡在哪一段一眼可见。正文与路径一律不记。

const cell = {
  state: 'empty',
  promise: null,
  hostPid: 0,
  // 属主：谁先 publish 谁就是这一格的属主（宿主一次激活一份 ctx）。退格只许属主自己退，
  // 别人的退格调用一律不生效——这样插件卸载/重载时清掉的是自己那份表，不会把新装那份清掉。
  owner: null,
  // 这一次发布的唯一身份（单调递增，模块内序号，永不出格）：格子只有一格，但「谁放的」会变
  //（卸载 → 重载、旧 promise 迟到敲定）。只比 owner 不够：同一个 owner 重发、或两边都是
  // legacy null 时，上一次的回调会把新表标成 ready、上一次的 release 会把新表清掉。
  pub: 0,
}

// 发布序号：每次 publish 取一个新值。退回 empty 时把格子的 pub 归 0，但序号只增不减，
// 所以「过期那一次」的 pub 永远不再复用，迟到的回调/释放认得出自己已经过期。
let pubSeq = 0

function pidNow() {
  try {
    if (typeof process !== 'undefined' && process !== null && typeof process.pid === 'number') return process.pid
  } catch (e) {}
  return 0
}

/**
 * 宿主接线装表时调一次：把装表那份承诺放进来（重复调只留第一次）。
 *
 * 第二参数 owner 是**属主令牌**（生产传宿主 ctx，同一份激活一个身份）。返回一个 `release()`：
 * 只有这一次发布的属主调用才会把格子退回 empty（插件卸载/重载时清掉自己那份表）。不是属主、或格子早被
 * 别人先占了，release 一律不生效——不做全局乱清，否则后装的插件会把前一份正在用的表清掉。
 * 不传 owner 时（测试夹具/旧调用）release 仍按 undefined 身份比对，行为与只有一格时一致。
 *
 * 除了属主，每次发布还有自己的 `pub`（见上）：回调与释放都只作用于**这一次发布**。
 * 上一次没兑现的 promise 迟到敲定，不会把后来那份标成 ready；上一次留下的 release 重复调用，
 * 也不会清掉后来那份表（同属主或 legacy null 时尤其重要）。
 */
export function publishDeckTable(tableP, owner) {
  try {
    if (cell.state !== 'empty') return null
    if (!tableP || typeof tableP.then !== 'function') return null
    const pub = ++pubSeq
    const own = (owner === undefined) ? null : owner
    cell.state = 'pending'
    cell.promise = tableP
    cell.hostPid = pidNow()
    cell.owner = own
    cell.pub = pub
    function settle() { try { if (cell.pub === pub && cell.state === 'pending') cell.state = 'ready' } catch (e) {} }
    tableP.then(settle, settle)
    return function release() {
      try {
        if (cell.pub !== pub) return // 过期发布：这一次的 release 不再有权动格子（新表是别人的）
        if (cell.owner !== own) return // 属主语义保留：只有发布它的那个身份才退得掉
        if (cell.state === 'empty') return
        cell.state = 'empty'
        cell.promise = null
        cell.hostPid = 0
        cell.owner = null
        cell.pub = 0
      } catch (e3) {}
    }
  } catch (e4) { return null }
}

/**
 * 宿主接线专用：把「发布 + 释放」整个放进 ctx.effect 拥有的生命周期里（见 wiring 那一处调用）。
 *
 * 为什么不能先 publish 再补登记 effect：这张表是**懒装**的（第一次真用到那几个工具才建），
 * 那一刻 ctx 可能已经卸了。先 publish 会把格子占住，而 ctx.effect 在已卸的 ctx 上会抛
 * INACTIVE_EFFECT，释放登记不上——格子从此空不出来，重载后的插件再也放不进自己的表。
 * 这里反过来：effect 的 execute 会立刻执行，publish 就发生在它里面。
 *   - ctx 还活着 → 发布落地，释放随 effect 一起在卸载时跑；
 *   - ctx 已经卸了 → effect 先抛（INACTIVE_EFFECT），这里一个字都不发，不留一份永远放不掉表；
 *   - ctx 没有 effect（老夹具/旧调用）→ 退回「发布但不登记释放」，与只有一格时的旧行为一致。
 * 返回 true 表示这次发布已交付给生命周期（或按旧路发布），false 表示没发。
 */
export function publishDeckTableOwned(tableP, ctx, label) {
  if (ctx && typeof ctx.effect === 'function') {
    try {
      ctx.effect(function () {
        const rel = publishDeckTable(tableP, ctx)
        return function () { try { if (typeof rel === 'function') rel() } catch (e) {} }
      }, label || 'deck table cell')
      return true
    } catch (eEffect) { return false }
  }
  try { publishDeckTable(tableP, ctx); return true } catch (e2) { return false }
}

/** 同步看一眼：空就别等（对方进程根本没放），有才值得等。 */
export function peekDeckTable() {
  try {
    if (cell.state === 'empty' || !cell.promise) return null
    return { state: cell.state, sameProcess: cell.hostPid !== 0 && cell.hostPid === pidNow() }
  } catch (e) { return null }
}

/** 等表装好：超时就回空，调用方按原路退回，不抛。 */
export function awaitDeckTable(timeoutMs) {
  try {
    const peek = peekDeckTable()
    if (!peek) return Promise.resolve(null)
    const cap = (typeof timeoutMs === 'number' && timeoutMs > 0) ? Math.floor(timeoutMs) : 25000
    return Promise.race([
      Promise.resolve(cell.promise).then(function (t) { return t || null }, function () { return null }),
      new Promise(function (resolve) { setTimeout(function () { resolve(null) }, cap) }),
    ])
  } catch (e) { return Promise.resolve(null) }
}

const gateNotes = []

function cleanGateWord(v) {
  try {
    const t = String(v || '')
    if (/^[a-z][a-z0-9-]{0,63}$/.test(t)) return t
    return ''
  } catch (e) { return '' }
}

/** 壳记一笔裁决口径：只收机器码（阶段、结论、原因枚举），正文路径一律不收。 */
export function noteDeckGate(info) {
  try {
    const at = info || {}
    gateNotes.push({
      phase: cleanGateWord(at.phase),
      verdict: cleanGateWord(at.verdict),
      reason: cleanGateWord(at.reason),
    })
    while (gateNotes.length > 8) gateNotes.shift()
  } catch (e) {}
}

/** 读走口径迹（探针用）：只含机器码的数组副本。 */
export function readDeckGate() {
  try { return gateNotes.map(function (n) { return { phase: n.phase, verdict: n.verdict, reason: n.reason } }) } catch (e) { return [] }
}

const lastPath = { tool: '', via: '' }

/** 行记一笔这次走的哪条路（探针用）：工具名是自家的，路是四选一枚举。 */
export function noteDeckPath(tool, via) {
  try {
    const t = (typeof tool === 'string' && tool) ? tool : ''
    const v = (via === 'cell' || via === 'connection' || via === 'fetch' || via === 'fallback') ? via : ''
    if (t && v) { lastPath.tool = t; lastPath.via = v }
  } catch (e) {}
}

/** 读走上次走的路（探针用）。 */
export function readDeckPath() {
  try { return { tool: lastPath.tool, via: lastPath.via } } catch (e) { return { tool: '', via: '' } }
}
