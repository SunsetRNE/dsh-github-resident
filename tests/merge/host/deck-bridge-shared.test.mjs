/**
 * tests/merge/host/deck-bridge-shared.test.mjs —— 「宿主那半边与 /tools 行模块共享同一个 exec-cell 实例」+ 正向代执行路径。
 *
 * 为什么这条非有不可：宿主半边按包根动态 import `<pkg>/deck/src/host/index.js`，而 agent 行由
 * cordis.patch.yml 的 `@local/dsh-github-resident-v2/tools` 经 `exports["./tools"]` 解析。只要这两条落点
 * 指向**不同目录**（历史上是 host 读 deck/src、/tools 读 deck/package/lib），`deck/src/shared/deck-tools/exec-cell.js`
 * 就会被 Node 当成**两个模块实例**（`exec-cell.js` 里的 cell 是模块局部变量，不是 global）。后果：
 *   宿主 `publishDeckTable()` 放进的表，行里的 `peekDeckTable()` 永远看不到 → 每一笔 deck_* 调用静默退回
 *   connection/fetch/fallback，症状只是「工具能用但比同进程慢且偶发超时」。
 *
 * 本文件两层判据：
 *   A 落点同一性：从 `exports["./tools"]` 与宿主 wire（deck/src/host/refresh/wiring.js）各自的 import 说明符
 *     解析出 exec-cell 的真实路径，realpath 比对；再真 import 两份 URL 断言拿到的函数是同一个身份。
 *   B 正向路径：用**真实宿主装配**（createDeckToolsForHost + 假后端注册表/闸）建出工具表，经宿主那一侧的
 *     exec-cell 发布；再从 `exports["./tools"]` 导入行模块，真调用 `deck_context` 与一个只读业务动作
 *     （`deck_issue_list`），断言拿到的是**业务结果**（不是 unsupported/not-wired 占位），
 *     且 `deck_probe` 观测到这次走的是同进程共享格（`bridgeLastPath.via === 'cell'`）。
 *   C 生命周期：每次发布有自己的身份（旧 promise 迟到敲定不许把新表标成 ready、过期 release 不许清新表，
 *     同属主与 legacy null 两种身份都覆盖），卸载→重载可用；再跑**真接线** createRefreshWiring，
 *     证明 publish/release 住在 ctx.effect 拥有的生命周期里，ctx 已卸才懒装时一个字都不发（不占格泄漏）。
 *
 * 隔离：不联网、不绑端口、不读 HOME、不写盘（后端注册表与闸都是本文件里的假件）。
 *
 * 用法：node tests/merge/host/deck-bridge-shared.test.mjs
 */
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT, check, importRel, note, readJson, readText, section, summary } from './_check.mjs'

const pkg = readJson('package.json')
const rowRel = String(pkg.exports['./tools'] || '').replace(/^\.\//, '')
const rowAbs = join(REPO_ROOT, rowRel)
const rowDir = dirname(rowAbs)

function execCellSpecifier(fromFile, rel) {
  const src = readFileSync(fromFile, 'utf8')
  const re = new RegExp("from\\s+'([^']*" + rel + ")'")
  const m = re.exec(src)
  if (!m) throw new Error('在 ' + fromFile + ' 里找不到 ' + rel + ' 的 import 说明符')
  return m[1]
}

section('1) A：两条落点解析出的 exec-cell 是同一个文件、同一个模块实例')
check(rowRel.startsWith('deck/src/'), 'exports["./tools"] 指向源行模块（deck/src/…），实际 ' + rowRel)
const rowECSpec = execCellSpecifier(rowAbs, 'exec-cell\\.js')
const rowECAbs = realpathSync(resolve(rowDir, rowECSpec))
const wiringAbs = join(REPO_ROOT, 'deck', 'src', 'host', 'refresh', 'wiring.js')
const hostECSpec = execCellSpecifier(wiringAbs, 'exec-cell\\.js')
const hostECAbs = realpathSync(resolve(dirname(wiringAbs), hostECSpec))
note('行模块用：' + rowECAbs)
note('宿主 wire 用：' + hostECAbs)
check(rowECAbs === hostECAbs, '两侧 exec-cell 的 realpath 相同（模块实例只可能有一个）')

const rowEC = await import(pathToFileURL(rowECAbs).href)
const hostEC = await import(pathToFileURL(hostECAbs).href)
check(typeof rowEC.publishDeckTable === 'function' && typeof rowEC.peekDeckTable === 'function', 'exec-cell 导出 publishDeckTable / peekDeckTable')
check(rowEC.publishDeckTable === hostEC.publishDeckTable && rowEC.peekDeckTable === hostEC.peekDeckTable, '两侧拿到的是同一组函数（同一个 ESM 实例）')

const tick = () => new Promise((r) => setTimeout(r, 0))
function deferred() {
  const box = {}
  box.promise = new Promise((res) => { box.resolve = res })
  return box
}

section('1b) 装载/卸载语义：publish 只留第一次 + 属主语义退格（不做全局乱清）')
{
  const ownerA = { tag: 'A' }
  const ownerB = { tag: 'B' }
  check(rowEC.peekDeckTable() === null, '起点是空格子')
  const relA = rowEC.publishDeckTable(Promise.resolve({ names: ['a'], tools: {} }), ownerA)
  check(typeof relA === 'function', 'publish 返回 release 函数（供 ctx.effect 托管）')
  check(!!rowEC.peekDeckTable(), 'A 发布后格子有内容')
  const relB = rowEC.publishDeckTable(Promise.resolve({ names: ['b'], tools: {} }), ownerB)
  check(relB === null, 'B 再发布时只留第一次（返回 null，不覆盖）')
  check(!!rowEC.peekDeckTable(), '格子仍是 A 那份（没被 B 顶掉）')
  relA()
  check(rowEC.peekDeckTable() === null, 'A 退格后格子回到 empty（卸载清的是自己那份）')
  relA()
  check(rowEC.peekDeckTable() === null, 'A 重复退格是无操作（幂等）')
  const relB2 = rowEC.publishDeckTable(Promise.resolve({ names: ['b'], tools: {} }), ownerB)
  check(typeof relB2 === 'function' && !!rowEC.peekDeckTable(), 'A 退了之后 B 能正常发布（重载场景）')
  relA()
  check(!!rowEC.peekDeckTable(), '非属主（A）的退格不会清掉 B 的表（有属主语义，无全局乱清）')
  relB2()
  check(rowEC.peekDeckTable() === null, 'B 自己退格生效')
  check(rowEC.publishDeckTable(null, ownerA) === null, '非 thenable 的表拒绝发布（返回 null）')
}

section('1c) 每次发布有自己的身份：过期 promise / 过期 release 都不许污染新表')
{
  // (a) 旧 promise 迟到敲定，不许把「还没装好的新表」标成 ready
  const p1 = deferred()
  const r1 = rowEC.publishDeckTable(p1.promise) // legacy：不传 owner，两次都是 null 身份
  const pk1 = rowEC.peekDeckTable()
  check(!!pk1 && pk1.state === 'pending', 'P1 发布后是 pending（还没敲定）')
  r1()
  check(rowEC.peekDeckTable() === null, 'P1 退格后回到空格子')
  const p2 = deferred()
  const r2 = rowEC.publishDeckTable(p2.promise)
  p1.resolve({ names: ['old'], tools: {} })
  await tick()
  const pk2 = rowEC.peekDeckTable()
  check(!!pk2 && pk2.state === 'pending', '旧 promise 敲定后，新表仍是 pending（旧回调不再标 ready）')
  p2.resolve({ names: ['new'], tools: {} })
  await tick()
  check(!!rowEC.peekDeckTable() && rowEC.peekDeckTable().state === 'ready', '新表自己敲定之后才 ready')
  const gotNew = await rowEC.awaitDeckTable(300)
  check(!!gotNew && Array.isArray(gotNew.names) && gotNew.names[0] === 'new', 'awaitDeckTable 拿到的是新表（不是旧 promise 的结果）')
  r2()
  check(rowEC.peekDeckTable() === null, '新表退格生效')

  // (b) 同一个 owner 下，过期 release 不许清新表
  const sameOwner = { tag: 'same' }
  const p3 = deferred()
  const r3 = rowEC.publishDeckTable(p3.promise, sameOwner)
  r3()
  const p4 = deferred()
  const r4 = rowEC.publishDeckTable(p4.promise, sameOwner)
  r3()
  check(!!rowEC.peekDeckTable(), '过期 release（同一个 owner）不清掉新表')
  r4()
  check(rowEC.peekDeckTable() === null, '新表自己的 release 仍然生效')

  // (c) legacy null 身份下同理（只比 owner 时两边都是 null，旧 release 会误清新表）
  const p5 = deferred()
  const r5 = rowEC.publishDeckTable(p5.promise)
  r5()
  const p6 = deferred()
  const r6 = rowEC.publishDeckTable(p6.promise)
  r5()
  check(!!rowEC.peekDeckTable(), '过期 release（legacy null owner）不清掉新表')
  r6()
  check(rowEC.peekDeckTable() === null, 'legacy 新表自己的 release 生效')

  // (d) 卸载再加载：退了之后新身份能正常发布、能被 await 到
  const p7 = deferred()
  const r7 = rowEC.publishDeckTable(p7.promise, { tag: 'A' })
  r7()
  check(rowEC.peekDeckTable() === null, '卸载后格子里没有残留（旧身份的那一次彻底结束）')
  const p8 = deferred()
  const r8 = rowEC.publishDeckTable(p8.promise, { tag: 'B' })
  check(!!rowEC.peekDeckTable(), '重载（新身份）能发布自己的表')
  p8.resolve({ names: ['reloaded'], tools: {} })
  await tick()
  const t8 = await rowEC.awaitDeckTable(300)
  check(!!t8 && t8.names[0] === 'reloaded', '重载后的表真的能被 await 到')
  r8()
  check(rowEC.peekDeckTable() === null, '重载后的表也能干净退格')
}

section('2) 用真实宿主装配建工具表（fake 后端注册表 + fake 闸）')
const assembly = await importRel('deck/src/host/platform/deckToolsAssembly.js')
const row = await import(pathToFileURL(rowAbs).href)
check(typeof assembly.createDeckToolsForHost === 'function', 'createDeckToolsForHost 可导入')

const tracker = {
  async preflight() { return { ok: true } },
  async list(_repo, filter) {
    return {
      ok: true,
      data: [
        { key: '7', title: '地图甲', state: 'OPEN', url: 'https://example.invalid/7', labels: [], assignees: [] },
        { key: '8', title: '普通票', state: 'OPEN', url: 'https://example.invalid/8', labels: [], assignees: [] },
      ],
    }
  },
}
const registry = {
  has: () => true,
  select: async () => ({ backendId: 'github', source: 'explicit' }),
  describe: () => ({ backend: 'github', refId: 'owner/repo', name: 'repo', url: 'https://example.invalid/owner/repo' }),
  get: () => tracker,
  allBindings: () => [],
}
const gate = {
  admitAiTool: () => ({ admitted: true, reason: '' }),
  async send(_req, work) { const claimed = await work(); return Object.assign({ sent: true }, claimed || {}) },
}
const log = { fire: () => {}, isEnabled: () => false }

let built = null
let buildError = null
try {
  built = assembly.createDeckToolsForHost({
    gate,
    registry,
    budget: {},
    handleFor: (s) => ({ cwd: (s && s.cwd) || '' }),
    canonicalKey: (x) => String(x || ''),
    workspaceKeyOf: (x) => 'wk:' + String(x || ''),
    readChoice: async () => null,
    readWorkspaceFileText: async () => null,
    parseWorkspaceFile: () => null,
    backendCtx: () => ({}),
    invalidate: () => {},
    onTicketCreated: () => {},
    chainNote: () => null,
    hourUsage: () => ({}),
    ensureReading: async () => null,
    noteGate: () => {},
    log,
  })
} catch (e) { buildError = e }

check(buildError === null, '宿主装配不抛错' + (buildError ? '：' + String(buildError.message || buildError) : ''))
const names = (built && built.names) || []
check(names.includes('deck_context') && names.includes('deck_issue_list'), '工具表里有 deck_context 与 deck_issue_list（实际 ' + names.join(',') + '）')
check(!(built && built.missing || []).includes('deck_context'), 'deck_context 不在 missing 里（装配真的建起来了）')

section('3) 宿主把表放进共享格；行模块（exports["./tools"] 落点）真调用业务工具')
const CWD = '/tmp/merge-bridge-workspace'
const hostRel = hostEC.publishDeckTable(Promise.resolve({ names: names, tools: (built && built.tools) || {} }))
const peek = hostEC.peekDeckTable()
check(!!peek && peek.state === 'pending', 'publishDeckTable 之后共享格是 pending（宿主那一侧写进去的）')
check(!!rowEC.peekDeckTable(), '行模块那一侧立刻看得到这个格子（同一个实例的直接证据）')

const rowCtx = {
  tools: { register: () => () => {} },
  get: () => undefined,
  inject: () => {},
  effect: () => () => {},
}
row.apply(rowCtx)
// 重新取注册出来的执行函数：row.apply 内部 register 到 fake 表里，这里用返回定义拿 execute。
const registered = []
const rowCtx2 = { tools: { register: (d) => { registered.push(d); return () => {} } }, get: () => undefined, inject: () => {}, effect: () => () => {} }
row.apply(rowCtx2)
const execOf = (name) => (registered.find((d) => d.name === name) || {}).execute
const execLike = { agent: { session: { cwd: CWD, id: 'sid-bridge' } } }

const ctxRes = await execOf('deck_context')({}, execLike)
check(!!ctxRes && ctxRes.status === 'ok', 'deck_context 回业务状态 ok（实际 ' + JSON.stringify(ctxRes && ctxRes.status) + '）')
check(!!ctxRes && !!ctxRes.data && ctxRes.data.backend && ctxRes.data.backend.id === 'github', 'deck_context 带出真实后端 github')
check(!!ctxRes && Array.isArray(ctxRes.data && ctxRes.data.maps) && ctxRes.data.maps.length === 2, 'deck_context 带回后端给的两张地图（不是占位）')

const listRes = await execOf('deck_issue_list')({ limit: 10 }, execLike)
check(!!listRes && listRes.status === 'ok', 'deck_issue_list（只读业务动作）回业务状态 ok（实际 ' + JSON.stringify(listRes && listRes.status) + '）')
check(!!listRes && !!listRes.data && Array.isArray(listRes.data.issues) && listRes.data.issues.length >= 1, 'deck_issue_list 带回后端给的票行（不是占位）')

section('4) 探针观测到这次走的是同进程共享格')
const probeRes = await execOf('deck_probe')({}, execLike)
let probe = null
try { probe = JSON.parse(String(probeRes)) } catch { probe = null }
check(!!probe, 'deck_probe 回可解析 JSON')
check(!!probe && probe.bridgeTableReady === true && probe.bridgeSameProcess === true, '探针报共享格已就绪且同进程（ready=' + (probe && probe.bridgeTableReady) + ', sameProcess=' + (probe && probe.bridgeSameProcess) + '）')
check(!!probe && probe.bridgeLastPath && probe.bridgeLastPath.via === 'cell', '探针报最近一次走的路是 cell（实际 ' + JSON.stringify(probe && probe.bridgeLastPath) + '）')
check(!!probe && Array.isArray(probe.bridgeTools) && probe.bridgeTools.includes('deck_context'), '探针能看到表里的工具名（不带路径原文）')
const leak = JSON.stringify(probe)
check(!leak.includes(CWD) && !leak.includes('/root/'), '探针输出不含工作区绝对路径')

section('5) wiring：发布与释放整个住在 ctx.effect 拥有的生命周期里（迟到的懒装不泄漏）')
// 这一节跑的是**真接线**（deck/src/host/refresh/wiring.js 的 createRefreshWiring），不是手写发布：
// 表是懒装的（第一次真用到那几个工具才建），那一刻 ctx 可能已经卸了。判据两条：
//   a) ctx 活着 → 发布落地，卸载时 release 随 effect 一起跑，格子里不留残留；
//   b) ctx 已卸才懒装 → effect 抛 INACTIVE_EFFECT，这里一个字都不发，格子保持空（不占格、不泄漏）。
// fake ctx 只提供 on/get/effect，effect 与 cordis 同形：立刻执行 execute，收集返回的销毁器；
// 已卸之后再调 effect 就抛（对应 cordis 的 assertActive() → INACTIVE_EFFECT）。
function makeLifecycleCtx() {
  const state = { disposers: [], disposed: false }
  const ctx = {
    on: () => () => {},
    get: () => undefined,
    effect: (cb, label) => {
      if (state.disposed) throw new Error('INACTIVE_EFFECT: ' + label)
      const d = cb()
      if (typeof d === 'function') state.disposers.push(d)
      return () => {}
    },
  }
  return {
    ctx,
    dispose() {
      state.disposed = true
      for (const d of state.disposers.splice(0).reverse()) { try { d() } catch (e) {} }
    },
  }
}
const wiringMod = await importRel('deck/src/host/refresh/wiring.js')
check(typeof wiringMod.createRefreshWiring === 'function', 'createRefreshWiring 可导入')
const wiringDeps = (ctx) => ({ ctx, logCtx: { fire: () => {}, isEnabled: () => false }, getTrackerRegistry: async () => null })
{
  // 先把第 3 节那张表退掉，腾出格子
  if (typeof hostRel === 'function') hostRel()
  check(rowEC.peekDeckTable() === null, '腾空格子（第 3 节那张表已随自己的 release 退掉）')

  const a = makeLifecycleCtx()
  const w1 = wiringMod.createRefreshWiring(wiringDeps(a.ctx))
  const t1 = await w1.deckToolsForHost()
  check(!!t1 && t1.reason === 'no-registry', '懒装如实回 no-registry（没有假装装配成功）')
  check(!!rowEC.peekDeckTable(), 'ctx 活着时发布真的落到共享格（行那一侧看得见）')
  a.dispose()
  check(rowEC.peekDeckTable() === null, 'ctx 卸载时 release 随 effect 退格（格子里没有残留）')

  // 卸载再加载：新 ctx / 新接线照常能发布自己的表
  const b = makeLifecycleCtx()
  const w2 = wiringMod.createRefreshWiring(wiringDeps(b.ctx))
  await w2.deckToolsForHost()
  check(!!rowEC.peekDeckTable(), '卸载后重新加载（新 ctx）能发布自己的表')
  b.dispose()
  check(rowEC.peekDeckTable() === null, '第二次卸载同样退得干净')

  // 迟到的懒装：ctx 已经卸了才第一次用到工具 → 不发布，不占格
  const c = makeLifecycleCtx()
  c.dispose()
  const w3 = wiringMod.createRefreshWiring(wiringDeps(c.ctx))
  await w3.deckToolsForHost()
  check(rowEC.peekDeckTable() === null, 'ctx 已卸时懒装不发布（effect 抛 INACTIVE_EFFECT，格子保持空）')

  // 迟到那一次没有占格，后面的加载照常能发布
  const d4 = makeLifecycleCtx()
  const w4 = wiringMod.createRefreshWiring(wiringDeps(d4.ctx))
  await w4.deckToolsForHost()
  check(!!rowEC.peekDeckTable(), '迟到那次没泄漏，之后的新 ctx 照常能发布')
  d4.dispose()
  check(rowEC.peekDeckTable() === null, '收尾仍然干净')
}

section('6) 跨进程语义不回归：格子里没有表时，行按原路退回（不假装同进程）')
// 换一个全新进程无法在这里模拟，但可以断言「格子未被 publish 时 peek 为空」这条原语义：
check(rowEC.peekDeckTable() === null, '收尾后格子为空：没有表时 peek 回 null（行按原路退回）')
note('同进程格子的跨进程行为由「cell 是模块局部量 + publish 无 global 落点」保证，见 exec-cell.js 文件头。')

summary()
