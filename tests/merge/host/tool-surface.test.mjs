/**
 * tests/merge/host/tool-surface.test.mjs —— 27 个工具「真的注册出来、各一次、互不重名」的机器判据（任务 H · 交付物 2/4/6）。
 *
 * 为什么需要它：合并后的工具面来自**两个不同的作用域**——
 *   - 宿主半边（`plugin.js` 的 apply）注册 17 个 `gh_*`；
 *   - agent 层的行模块（`deck/src/host/platform/deckToolsRow.js` 的 apply）注册 9 个 `deck_*` 业务工具 + `deck_probe`。
 * 两个作用域各注册一次，谁多挂一次、谁把名字撞了，症状都只是「某个工具不见了」或「调用回错的那一份」。
 * 所以这里用 fake 服务（只记注册、不执行副作用）**真调用两个 apply**，再逐个断言名字、数量、交集与失败可见性。
 *
 * 安全边界（这是本文件敢真调 apply 的前提）：
 *   - fake 上下文的 `effect` **只记录、不执行**：Resident 的回环 HTTP 服务（默认 31790）就挂在那个 effect 里，
 *     执行它等于占用真实端口；本测试全程不绑端口。
 *   - 不执行任何 `gh_*` 工具的 execute（它们会读写真实 HOME/gh/git/网络）。
 *   - `deck_*` 的 execute 走「同进程共享格 → 连接服务 → 同源 fetch」三条通道；测试里三条都空/不可解析，
 *     落到诚实占位；不产生网络请求（相对 URL 在 Node 的 global fetch 下直接抛，被内部 catch）。
 *
 * 用法：node tests/merge/host/tool-surface.test.mjs
 */
import { check, captureUnhandled, importRel, note, section, summary } from './_check.mjs'

/** 只记录的 fake 宿主上下文：注册能看见，副作用一个不跑。 */
function makeFakeCtx(services = {}) {
  const state = { tools: [], effects: [], injects: [], provides: [] }
  const bind = (key) => {
    // 半边可能按裸属性（ctx.tools）或按 ctx.get('tools') 取服务，两种都喂。
    if (key === 'tools') return { register: (def) => { state.tools.push(def); return () => {} } }
    return services[key]
  }
  const ctx = {
    tools: bind('tools'),
    effect: (cb, label) => { state.effects.push({ cb, label }); return () => {} },
    inject: (keys, cb) => { state.injects.push({ keys: Array.from(keys || []), cb }) },
    provide: (key, value) => { state.provides.push({ key, value }) },
    get: (key) => bind(key),
  }
  return { ctx, state }
}

section('1) 宿主半边：真调用 plugin.js 的 apply')
const resident = await importRel('plugin.js')
const hostCtx = makeFakeCtx()
const hostReturn = resident.apply(hostCtx.ctx)
const ghTools = hostCtx.state.tools.filter((d) => d && typeof d.name === 'string' && d.name.startsWith('gh_'))
const hostDeckNames = hostCtx.state.tools.filter((d) => d && typeof d.name === 'string' && d.name.startsWith('deck_'))
check(hostCtx.state.tools.length === 17, '宿主半边注册 17 个工具（实际 ' + hostCtx.state.tools.length + '）')
check(ghTools.length === 17, '其中 17 个以 gh_ 开头（实际 ' + ghTools.length + '）')
check(hostDeckNames.length === 0, '宿主半边不注册任何 deck_* 工具（那是 agent 行模块的事，实际 ' + hostDeckNames.length + '）')
check(hostCtx.state.tools.every((d) => typeof d.execute === 'function' && typeof d.description === 'string' && d.parameters), '每个注册项都有 name/description/parameters/execute 四件套')
check(hostCtx.state.provides.some((p) => p.key === 'githubResident'), '宿主半边 provide 了 githubResident 服务（10 方法契约的载体）')
check(hostCtx.state.effects.length >= 1, '宿主半边把回环服务/启动检查登记进 ctx.effect（' + hostCtx.state.effects.length + ' 条，本测试不执行它们）')
check(hostReturn === undefined, '宿主半边 apply 返回 undefined（清理走 ctx.effect，不靠返回值）')

section('2) agent 行：真调用 deckToolsRow.js 的 apply')
const row = await importRel('deck/src/host/platform/deckToolsRow.js')
check(row.name === '@sunsetrne/dsh-github-resident-v2/tools', '行模块 name = 合并包名 + /tools（实际 ' + row.name + '）')
check(JSON.stringify(row.inject) === JSON.stringify(['tools']), '行模块 inject = [tools]（与宿主半边分开的作用域）')

const rowCtx = makeFakeCtx()
row.apply(rowCtx.ctx)
const deckNames = rowCtx.state.tools.map((d) => d && d.name)
const businessNames = deckNames.filter((n) => n && n !== 'deck_probe')
check(deckNames.length === 10, '行模块注册 10 个工具（9 业务 + 探针，实际 ' + deckNames.length + '）')
check(businessNames.length === 9 && businessNames.every((n) => n.startsWith('deck_')), '其中 9 个 deck_* 业务工具：' + businessNames.join(','))
check(deckNames.includes('deck_probe'), '探针 deck_probe 在注册表里（不得降级为可选/可删）')
check(!deckNames.some((n) => n && n.startsWith('gh_')), '行模块不注册任何 gh_* 工具')
check(new Set(deckNames).size === deckNames.length, '行模块内 10 个名字两两不同')

section('3) 两个作用域合起来：27 个名字、交集空、各一次')
const allNames = hostCtx.state.tools.map((d) => d.name).concat(deckNames)
check(allNames.length === 27, '两半合计 27 个注册（实际 ' + allNames.length + '）')
check(new Set(allNames).size === 27, '27 个名字两两不同（去重后 ' + new Set(allNames).size + '）')
const ghSet = new Set(hostCtx.state.tools.map((d) => d.name))
const deckSet = new Set(deckNames)
const inter = [...ghSet].filter((n) => deckSet.has(n))
check(inter.length === 0, 'gh_* 与 deck_* 交集为空（实际 ' + JSON.stringify(inter) + '）')
note('27 个工具名：' + allNames.slice().sort().join(','))

section('4) 失败可见：服务不在就抛，不静默少注册')
let missingToolsErr = null
try {
  row.apply({ get: () => undefined })
} catch (e) {
  missingToolsErr = String((e && e.message) || e)
}
check(!!missingToolsErr && missingToolsErr.includes('tools'), 'ctx.tools 缺失时行模块抛错且指名 tools（实际 ' + JSON.stringify(missingToolsErr) + '）')

let nullCtxErr = null
try {
  row.apply(null)
} catch (e) {
  nullCtxErr = String((e && e.message) || e)
}
check(!!nullCtxErr, 'ctx 为 null 时行模块抛错（不静默）')

section('5) 探针真的能调用（覆盖 probe）')
const probeDef = rowCtx.state.tools.find((d) => d && d.name === 'deck_probe')
let probeRaw = null
try {
  probeRaw = await probeDef.execute({}, {})
} catch (e) {
  probeRaw = 'THREW: ' + String((e && e.message) || e)
}
let probe = null
try {
  probe = JSON.parse(String(probeRaw))
} catch {
  probe = null
}
check(!!probe, '探针返回可解析的 JSON 文本')
if (probe) {
  check(probe.tools === true, '探针报 ctx.tools 在（fake 上下文里确实在）')
  check(probe.globalCaps && typeof probe.globalCaps.fetch === 'boolean', '探针报 globalCaps 的形状')
  check(probe.bridgeDryRun === 'no-hint', '无会话提示时探针不做等待型干跑（bridgeDryRun=' + probe.bridgeDryRun + '）')
  check(typeof probe.envKeys !== 'undefined', '探针报 envKeys（只报键名，不报值）')
  const leak = JSON.stringify(probe)
  check(!leak.includes('/root/') && !leak.includes('DSH_GH_TOKEN'), '探针输出不含绝对路径或令牌值（只报键名与有无）')
}

section('6) 业务工具在三条通道都不通时给诚实占位（实际安全调用）')
const ctxTool = rowCtx.state.tools.find((d) => d && d.name === 'deck_context')
const okExec = await ctxTool.execute({}, { agent: { session: { cwd: '/tmp/mergehost-session-a', id: 'sid-a' } } })
check(!!okExec && okExec.status === 'unsupported' && typeof okExec.text === 'string', '通道不通时回 {status:unsupported, text}（实际 ' + JSON.stringify(okExec && okExec.status) + '）')
check(!!okExec && /还没接通|没接好|请先用面板/.test(okExec.text), '占位文案如实说通道未接通：' + String(okExec && okExec.text).slice(0, 60))
check(!!okExec && okExec.reason === 'not-wired', 'reason = not-wired（不伪称成功）')

const badArgs = await ctxTool.execute(null, { agent: { session: { cwd: '/tmp/x', id: 'sid-a' } } })
check(!!badArgs && badArgs.reason === 'bad-args', '坏参数回 bad-args（不抛）')

const aborted = await ctxTool.execute({}, { signal: { aborted: true }, agent: { session: { cwd: '/tmp/x', id: 'sid-a' } } })
check(!!aborted && aborted.reason === 'aborted', '已中止回 aborted（不抛）')

const noHint = await ctxTool.execute({}, {})
check(!!noHint && noHint.status === 'unsupported', '没有会话上下文时也回占位（不抛）')

section('7) 未处理的拒绝（真实 apply 会拉起若干动态 import，失败必须看得见）')
const unhandled = captureUnhandled()
await new Promise((r) => setTimeout(r, 200))
check(unhandled.length === 0, '等待 200ms 后没有未处理的 Promise 拒绝（实际 ' + unhandled.length + '：' + unhandled.map((u) => String((u && u.message) || u)).join(' | ') + '）')

summary()
