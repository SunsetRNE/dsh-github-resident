/**
 * tests/merge/host/assembly-lifecycle.test.mjs —— 宿主装配层的导出形态、错误可见性与清理语义（任务 H · 交付物 1）。
 *
 * 为什么需要它：`tools/merge/host-assembly.ts` 是「两半拼成一份插件」的唯一地方，它有三个容易写错、
 * 且错了以后**症状与原因离得很远**的点：
 *   1) 导出形态混用（具名 + default）：加载器 unwrapExports 取 default、别的路径取具名，同一套注册走两条路；
 *   2) 把 `apply()` 的返回值当布尔成功判据（旧实现的 `Boolean(...)`）：真失败被 `||` 吞掉，只剩「工具不见了」；
 *   3) 两半的返回值语义丢掉：Promise 不交回加载器 = 插件没起来就以为起来了；函数（旧式销毁器）不登记 = 卸载静默泄漏。
 * 所以这里既跑**合成半边**（把三种返回值与抛错逐条钉死），也跑**真两半**（证明装配层真的把两半都调了）。
 *
 * 只读检查：合成半边不碰文件；真半边用一个只记录、不执行 effect 的 fake 上下文（不绑端口、不联网、不读 HOME）。
 *
 * 用法：node tests/merge/host/assembly-lifecycle.test.mjs
 */
import { check, captureUnhandled, importRel, note, section, summary } from './_check.mjs'

section('1) 导出形态：只有一种，且与真源一致')
const assembly = await importRel('tools/merge/host-assembly.ts')
const identity = await importRel('tools/merge/merge-identity.ts')
const exportKeys = Object.keys(assembly).sort()
check(JSON.stringify(exportKeys) === JSON.stringify(['__applyHalves', 'apply', 'inject', 'name']), '导出键恰好是 name/inject/apply + 测试钩子 __applyHalves（实际 ' + exportKeys.join(',') + '）')
check(!('default' in assembly), '没有 default 导出（单一导出形态）')
check(assembly.name === identity.MERGED_PACKAGE_NAME, 'name = 真源 MERGED_PACKAGE_NAME（实际 ' + assembly.name + '）')
check(JSON.stringify(assembly.inject) === JSON.stringify(identity.MERGED_HOST_INJECT), 'inject = 真源 MERGED_HOST_INJECT 且顺序一致')

section('2) 复刻加载器 unwrapExports 后仍然可用')
// @deepseek-ai/cordis-plugin-loader/lib/index.js：
//   exports = exports.default ?? exports; if (!exports.__esModule) return exports; return exports.default ?? exports
function unwrapExports(exports) {
  if (exports === null || exports === undefined) return exports
  let out = exports.default ?? exports
  if (!out.__esModule) return out
  return out.default ?? out
}
function isApplicable(obj) {
  return !!obj && typeof obj === 'object' && typeof obj.apply === 'function'
}
const unwrapped = unwrapExports(assembly)
check(isApplicable(unwrapped), 'unwrapExports 之后是可装载的插件对象（有 apply）')
check(unwrapped.name === identity.MERGED_PACKAGE_NAME, 'unwrapExports 之后 name 仍是合并包名（实际 ' + unwrapped.name + '）')
check(JSON.stringify(unwrapped.inject) === JSON.stringify(identity.MERGED_HOST_INJECT), 'unwrapExports 之后 inject 未丢项')
check(unwrapped.apply === assembly.apply, '具名 apply 与装载器拿到的 apply 是同一个函数（不会挂两次）')

section('3) 合成半边：调用顺序、失败可见、返回值语义')
function makeCtx() {
  const state = { effects: [], injects: [] }
  return {
    state,
    ctx: {
      get: () => undefined,
      inject: (keys, cb) => state.injects.push({ keys: Array.from(keys || []), cb }),
      effect: (cb, label) => {
        state.effects.push({ cb, label })
        return () => {}
      },
    },
  }
}

// 3a) 两半都被调用，顺序 = 声明顺序
{
  const order = []
  const { ctx } = makeCtx()
  const ret = assembly.__applyHalves(ctx, [
    { label: 'a', apply: () => order.push('a') },
    { label: 'b', apply: () => order.push('b') },
  ])
  check(JSON.stringify(order) === JSON.stringify(['a', 'b']), '两半都按声明顺序被调用：' + JSON.stringify(order))
  check(ret === undefined, '两半都返回 undefined 时 apply 返回 undefined（不是布尔）')
}

// 3b) 返回布尔不被当成功判据
{
  const { ctx } = makeCtx()
  const ret = assembly.__applyHalves(ctx, [
    { label: 'a', apply: () => false },
    { label: 'b', apply: () => true },
  ])
  check(ret === undefined, '半边返回 false/true 都不改变 apply 的返回值（旧 Boolean(||) 判据已删）')
}

// 3c) Promise 原样交回，并被等待
{
  const order = []
  const { ctx } = makeCtx()
  const ret = assembly.__applyHalves(ctx, [
    { label: 'a', apply: async () => { await new Promise((r) => setTimeout(r, 20)); order.push('a') } },
    { label: 'b', apply: () => { order.push('b') } },
  ])
  check(typeof ret === 'object' && ret !== null && typeof ret.then === 'function', '任一半返回 Promise 时 apply 也返回 Promise（交给 fiber 等）')
  await ret
  check(JSON.stringify(order) === JSON.stringify(['b', 'a']), '异步那一半真的被等到了（顺序 ' + JSON.stringify(order) + '）')
}

// 3d) 函数返回值 = 旧式销毁器：必须登记进 ctx.effect 且真的能跑
{
  let disposed = 0
  const { ctx, state } = makeCtx()
  const disposer = () => { disposed += 1 }
  assembly.__applyHalves(ctx, [{ label: 'half-fn', apply: () => disposer }])
  check(state.effects.length === 1, '函数返回值被登记成 1 条 ctx.effect（实际 ' + state.effects.length + '）')
  check(String(state.effects[0] && state.effects[0].label).includes('half-fn'), 'effect 标签带半边名（' + (state.effects[0] && state.effects[0].label) + '）')
  const returned = state.effects[0].cb()
  check(returned === disposer, 'effect 回调返回的就是那一半给的销毁器（没被包成别的）')
  returned()
  check(disposed === 1, '销毁器真的跑到了（disposer 调用 1 次）')
}

// 3e) 没有 ctx.effect 时不静默丢弃销毁器
{
  let threw = null
  try {
    assembly.__applyHalves({ get: () => undefined }, [{ label: 'half-noeffect', apply: () => () => {} }])
  } catch (e) {
    threw = String((e && e.message) || e)
  }
  check(!!threw && threw.includes('half-noeffect'), '没有 ctx.effect 时抛错且指名那一半（实际 ' + JSON.stringify(threw) + '）')
}

// 3f) 前一半抛错：后一半仍被尝试，错误原样抛出（不包装、不吞）
{
  const order = []
  const boom = new Error('resident half exploded')
  let caught = null
  const { ctx } = makeCtx()
  try {
    assembly.__applyHalves(ctx, [
      { label: 'resident', apply: () => { order.push('resident'); throw boom } },
      { label: 'deck', apply: () => { order.push('deck') } },
    ])
  } catch (e) {
    caught = e
  }
  check(caught === boom, '抛出的是原来那个错误对象（身份不变）')
  check(JSON.stringify(order) === JSON.stringify(['resident', 'deck']), '前一半抛错后后一半仍被尝试（' + JSON.stringify(order) + '）')
}

section('4) 真两半：装配层确实把两边都调了')
function makeHostCtx({ ready }) {
  const state = { tools: [], effects: [], injects: [], providers: 0, fetchRoutes: [] }
  const services = {
    tools: { register: (def) => { state.tools.push(def); return () => {} } },
    connection: { fetch: { register: (route) => { state.fetchRoutes.push(route); return () => {} } } },
    skills: { registerProvider: () => { state.providers += 1; return () => {} } },
    subprocess: ready ? { exec: () => {} } : undefined,
    timer: ready ? { timeout: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) } : undefined,
  }
  return {
    state,
    ctx: {
      tools: services.tools,
      get: (key) => services[key],
      inject: (keys, cb) => state.injects.push({ keys: Array.from(keys || []), cb }),
      // 只记录、不执行：Resident 的回环 HTTP 服务就登记在这里，执行它会占用真实端口。
      effect: (cb, label) => { state.effects.push({ cb, label }); return () => {} },
      provide: () => {},
    },
  }
}

// 4a) subprocess/timer 未就绪：Deck 半边挂到依赖门上（这正是它 apply 被调用的证据），Resident 半边照常注册工具
{
  const { ctx, state } = makeHostCtx({ ready: false })
  const ret = assembly.apply(ctx)
  const gh = state.tools.filter((d) => d.name && d.name.startsWith('gh_'))
  check(gh.length === 17, '工具就绪的那一半注册了 17 个 gh_*（实际 ' + gh.length + '）')
  const deferred = state.injects.find((i) => i.keys.includes('subprocess') && i.keys.includes('timer'))
  check(!!deferred, 'Deck 半边挂到 ctx.inject([subprocess,timer]) 上（证明第二半被真正调用）')
  check(state.providers === 0, '依赖未就绪时不注册 bundled provider（不假装已就绪）')
  check(ret === undefined, '两半都同步时 apply 返回 undefined')
}

// 4b) subprocess/timer 就绪：Deck 半边真的装配起来（provider 注册 + RPC 路由注册）
{
  const { ctx, state } = makeHostCtx({ ready: true })
  try {
    assembly.apply(ctx)
  } catch (e) {
    note('apply 抛错：' + String((e && e.message) || e))
  }
  await new Promise((r) => setTimeout(r, 1200))
  check(state.tools.filter((d) => d.name && d.name.startsWith('gh_')).length === 17, 'Resident 半边仍然注册 17 个 gh_*')
  check(state.providers >= 1, 'Deck 半边注册了 bundled 技能 provider（实际 ' + state.providers + '）')
  check(state.fetchRoutes.some((r) => r && r.path === '/api/dsws'), 'Deck 半边经 connection.fetch 注册了 /api/dsws 路由（实际 ' + JSON.stringify(state.fetchRoutes.map((r) => r && r.path)) + '）')
  check(state.effects.length >= 1, '至少有一条 effect 被登记（清理可托管）')
}

section('5) 未处理的拒绝')
const unhandled = captureUnhandled()
await new Promise((r) => setTimeout(r, 300))
check(unhandled.length === 0, '装配后没有未处理的 Promise 拒绝（实际 ' + unhandled.length + '：' + unhandled.map((u) => String((u && u.message) || u)).join(' | ') + '）')

summary()
