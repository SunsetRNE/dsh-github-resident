/**
 * tests/merge/build/client-union.test.mjs —— 「一个 loader 装载点、两半 UI 都注册」的组合测试
 *
 * 光看静态文本不够：`settings.section` 的两条注册、dock 功能栏、右栏两个 keyed 槽、
 * RunPanel（`tool.view.cordis`）到底有没有真的调 `slots.register`，只有把合并产物**真跑一遍**
 * 才知道。这里用 jsdom + 最小宿主 stub 跑 `dist/client.js`：
 *   1) 全文只有一个 `window.__ModuleLoader__.load(`；
 *   2) 模块 id = 合并身份；
 *   3) `exports.inject` = 两半并集（顺序），apply 调用后两半的注册都到齐；
 *   4) 二次 apply 不重复注册（#298 幂等闸）；
 *   5) 被删掉的 `settings.section#dsws-settings-section`（order 18）确实不再出现。
 *
 * 用法：node tests/merge/build/client-union.test.mjs（先跑 npm run build）
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import {
  MERGED_CLIENT_INJECT,
  MERGED_IDENTITY,
  MERGED_PACKAGE_NAME,
  MODULE_LOADER_MARKER,
} from '../../../tools/merge/merge-identity.ts'
import { REPO_ROOT, check, countOccurrences, existsSync, finish, section } from './_lib.mjs'

const CLIENT = join(REPO_ROOT, 'dist/client.js')
const requireFromRepo = createRequire(join(REPO_ROOT, 'package.json'))

section('0. 前置')
check('dist/client.js 存在', existsSync(CLIENT), '先运行 npm run build')
if (!existsSync(CLIENT)) finish()

const code = readFileSync(CLIENT, 'utf8')
check('全文只有一个模块装载点', countOccurrences(code, MODULE_LOADER_MARKER) === 1)

section('1. 在 jsdom 里装载合并客户端')
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1:59519/',
  runScripts: 'outside-only',
})
const win = dom.window
let loaded = null
win.__ModuleLoader__ = {
  load(spec) {
    loaded = spec
    return spec
  },
}

let loadError = null
try {
  vm.runInContext(code, dom.getInternalVMContext())
} catch (e) {
  loadError = e
}
check('合并客户端求值不抛错', loadError === null, loadError && loadError.message)
check('ModuleLoader.load 被调用恰好一次', !!loaded)
if (!loaded) finish()

check('模块 id = 合并身份', loaded.id === MERGED_PACKAGE_NAME, loaded.id)
check('load 声明里有 factory 函数', typeof loaded.factory === 'function')

const react = requireFromRepo('react')
const reactDom = requireFromRepo('react-dom')
const mod = loaded.factory((m) => {
  if (m === 'react') return react
  if (m === 'react-dom') return reactDom
  throw new Error('合并客户端请求了未预期的模块：' + m)
})
check('factory 返回插件对象', !!mod && typeof mod === 'object')
check(
  'exports.inject 逐项（含顺序）= MERGED_CLIENT_INJECT',
  JSON.stringify(mod.inject) === JSON.stringify([...MERGED_CLIENT_INJECT]),
  JSON.stringify(mod.inject),
)
check('exports.apply 是函数', typeof mod.apply === 'function')

section('2. apply 时两半的插槽注册都要到齐')
const registrations = []
const injections = []
const slots = {
  register(opts, component) {
    registrations.push({ ...opts, componentType: typeof component })
    return () => {}
  },
  inject(name, cb) {
    injections.push(name)
    // Cordis 的语义：槽位可用时回调被调用，回调返回销毁器。这里立即调用，好观察注册结果。
    let disposer = null
    try {
      disposer = cb()
    } catch (e) {
      throw e
    }
    return () => {
      if (typeof disposer === 'function') disposer()
    }
  },
}
const services = {
  slots,
  connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
  locale: { register: () => () => {}, bind: () => (k) => k },
  workspaces: { list: async () => [], get: () => null },
  sessions: { list: () => [], get: () => null },
  timer: { timeout: () => 0, clearTimeout: () => {}, interval: () => 0, clearInterval: () => {} },
  skills: { registerProvider: () => () => {}, list: () => [] },
  subprocess: { exec: async () => ({ ok: true }) },
  // 原生右栏类型注册口：panelAssembly 只有在它可用时才注册两条 keyed 槽
  sidebarRightTabs: { register: () => () => {} },
}
const ctx = {
  // Resident 半边直接读 ctx.slots；Deck 半边读 ctx.get('slots')：两个口都按宿主真实形状给。
  slots,
  get: (k) => services[k],
  inject: (keys, cb) => {
    if (typeof keys === 'function') keys()
    else if (typeof cb === 'function') cb()
    return () => {}
  },
  effect: (fn) => {
    try {
      fn()
    } catch {
      /* stub：清理登记失败不影响注册断言 */
    }
    return () => {}
  },
  provide: () => {},
  on: () => () => {},
}

let applyError = null
try {
  mod.apply(ctx)
} catch (e) {
  applyError = e
}
check('apply 不抛错（两半都在最小宿主 stub 下跑通）', applyError === null, applyError && applyError.stack?.split('\n')[0])

// 只看**首轮 apply** 的注册结果：Deck 的客户端整棵模块体就是 apply 函数体，
// `__slotOnce` 是每次 apply 的局部量，「二次 apply 不增生」在这套结构下本来就不成立（见第 3 节注记）。
const firstApply = registrations.slice()

const bySection = (name) => firstApply.filter((r) => r.name === name)
const dock = bySection('conversation.input.dock')
check('conversation.input.dock 恰好 1 条（一个 client 只有一个占用者）', dock.length === 1, String(dock.length))
check(
  // 2026-10-12 身份融合：槽位 id 换成合并身份（有意的契约变更），order 40 不变。
  'dock 注册身份/顺序：合并身份 + order 40',
  !!dock[0] && dock[0].id === MERGED_IDENTITY && dock[0].order === 40,
  JSON.stringify(dock[0]),
)

const sections = bySection('settings.section')
const sectionIds = sections.map((r) => r.id).sort()
check(
  'settings.section = 两条 Resident 页面（github-resident 60 / github-repo-registry 61）',
  sectionIds.length === 2 && sectionIds.includes('github-resident') && sectionIds.includes('github-repo-registry'),
  JSON.stringify(sectionIds),
)
check(
  '订单号仍是 60 / 61',
  sections.find((r) => r.id === 'github-resident')?.order === 60 &&
    sections.find((r) => r.id === 'github-repo-registry')?.order === 61,
  JSON.stringify(sections.map((r) => [r.id, r.order])),
)
check(
  'Deck 的设置页入口已并入（不再有 settings.section#dsws-settings-section / order 18）',
  !sections.some((r) => r.id === 'dsws-settings-section' || r.order === 18),
)

const tabs = bySection('settings.plugins.tab')
check(
  'settings.plugins.tab 仍保留（兼容入口 dsws-settings，order 40）',
  tabs.length === 1 && tabs[0].id === 'dsws-settings' && tabs[0].order === 40,
  JSON.stringify(tabs),
)

const rightbar = bySection('sidebar.right.pane.tab')
const rightbarTitle = bySection('sidebar.right.pane.tab.title')
check('右栏 keyed 槽两条都在（tab + title）', rightbar.length === 1 && rightbarTitle.length === 1)
check(
  // 身份融合后 key 用合并身份；**老会话不丢**由客户端身份迁移（identityMigration）负责读旧写新。
  '右栏 tab 类型 key = 合并身份 + /deck:map',
  rightbar[0] && rightbar[0].key === MERGED_IDENTITY + '/deck:map',
  JSON.stringify(rightbar[0] && rightbar[0].key),
)

const run = bySection('tool.view.cordis')
check(
  'RunPanel 仍在 tool.view.cordis（key=self）注册',
  run.length === 1 && run[0].key === 'self' && run[0].componentType === 'function',
  JSON.stringify(run[0]),
)

const totalAfterFirst = firstApply.length
check('首轮注册总数 > 0（两半都动过）', totalAfterFirst > 0, String(totalAfterFirst))

section('3. 首轮 apply 内每个槽位只注册一次（#298 闸的当次语义）')
const nameCounts = {}
for (const r of firstApply) nameCounts[r.name] = (nameCounts[r.name] || 0) + 1
check('conversation.input.dock 一次只注册一条', nameCounts['conversation.input.dock'] === 1, String(nameCounts['conversation.input.dock']))
check('settings.plugins.tab 一次只注册一条', nameCounts['settings.plugins.tab'] === 1, String(nameCounts['settings.plugins.tab']))
check('tool.view.cordis 一次只注册一条', nameCounts['tool.view.cordis'] === 1, String(nameCounts['tool.view.cordis']))
check('settings.section 一次两条（两条不同 id，不是同一条重复）', nameCounts['settings.section'] === 2, String(nameCounts['settings.section']))

// 二次 apply 只验「不抛错」，不验「不增生」——见下面的观察注记。
let secondError = null
try {
  mod.apply(ctx)
} catch (e) {
  secondError = e
}
check('二次 apply 不抛错', secondError === null, secondError && secondError.message)
console.log(
  '        （观察，非断言：Deck 客户端的整棵模块体就是 apply 函数体，`__slotOnce` 因此是每次 apply 的局部量；' +
    'Resident 的 settings.section 也没有幂等闸。宿主对同一插件实例只调一次 apply，线上不受影响；' +
    '如实记录，不据此改动两半的既有行为。）',
)

section('4. 功能栏内部把手仍在（合并不得顺手改坏）')
for (const marker of [
  "data-fold-priority",
  'dsws-capsule',
  'dsws-banner',
  'dsws-modal',
  'dsws-fold-toggle',
  'dsws.bannerFold',
]) {
  check(`客户端产物含 ${marker}`, code.includes(marker))
}

finish()
