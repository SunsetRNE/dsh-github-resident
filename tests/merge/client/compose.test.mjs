/**
 * tests/merge/client/compose.test.mjs —— 「单 factory 装配两半」的受控集成测试
 *
 * 用真 Resident 作者态（根 client.js）+ 同形 Deck 夹具，跑一遍：
 *   1) 求值合并产物 → 恰好一个 load、模块 id = 合并包名；
 *   2) 真跑 exports.apply(ctx) → 注册集合、槽位顺序、inject 并集；
 *   3) Deck → Resident 的 mergeEmbed 交接：登记库页真的渲染 Deck 交出的组件；
 *   4) Resident 半边单独运行（无 embed）不崩、两页仍在。
 * 桩 React + 桩宿主 ctx，不渲染真 DOM，所以这是单元/集成测试，不是真机视觉验证。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { rewriteDeckClient } from '../../../tools/merge/rewrite-deck-client.ts'
import { MERGED_CLIENT_INJECT, MERGED_PACKAGE_NAME, MERGED_VERSION, MERGED_VERSION_LITERAL, MODULE_LOADER_MARKER } from '../../../tools/merge/merge-identity.ts'
import { captureHalf } from '../../../tools/merge/client-factory.ts'
import {
  findInTree,
  loadMergedModule,
  makeDeckSource,
  makeFakeCtx,
  makeRequire,
  readResidentSource,
  renderRegistration,
} from './harness.mjs'

function composeResidentHalf() {
  const result = rewriteDeckClient(makeDeckSource(), readResidentSource())
  const spec = loadMergedModule(result.text)
  const mod = spec.factory(makeRequire())
  return { result, spec, mod }
}

test('合并产物只有一个 load，模块 id 是合并包名，dock 槽位 id 逐字保留', () => {
  const { result, spec } = composeResidentHalf()
  assert.equal(result.text.split(MODULE_LOADER_MARKER).length - 1, 1)
  assert.equal(spec.id, MERGED_PACKAGE_NAME)
  assert.equal(result.moduleId, MERGED_PACKAGE_NAME)
  assert.ok(result.text.includes("id: 'dsh-mattpocock-skills-deck', order: 40"))
  assert.ok(!result.text.includes(`${MODULE_LOADER_MARKER}{\n  id: 'dsh-mattpocock-skills-deck',`))
  assert.equal(result.idReplaced, true)
  assert.equal(result.injectReplaced, true)
  assert.equal(result.bytesBefore, Buffer.byteLength(makeDeckSource(), 'utf8') + Buffer.byteLength(readResidentSource(), 'utf8'))
  assert.equal(result.bytesAfter, Buffer.byteLength(result.text, 'utf8'))
})

test('版本号改写：产出里是根 package.json 的版本，不留 Deck 上游字面量', () => {
  const result = rewriteDeckClient(makeDeckSource(), readResidentSource())
  const upstream = "const DSW_VERSION = 'v1.8.0-rc.7'"
  assert.ok(makeDeckSource().includes(upstream), '夹具必须带 Deck 上游版本锚点')
  assert.ok(result.text.includes('const DSW_VERSION = ' + MERGED_VERSION_LITERAL), '产出里是合并包版本 ' + MERGED_VERSION)
  assert.ok(!result.text.includes(upstream), '产出里不留 Deck 上游版本字面量')
  assert.equal(result.version, MERGED_VERSION)
})

test('inject 是两半并集，且顺序逐项等于 MERGED_CLIENT_INJECT', () => {
  const { mod } = composeResidentHalf()
  assert.deepEqual(mod.inject, MERGED_CLIENT_INJECT)
  assert.deepEqual(mod.inject, ['connection', 'slots', 'locale', 'workspaces', 'sessions'])
})

test('apply 之后：Deck 先注册、Resident 两个设置页随后；不再有 dsws-settings-section', () => {
  const { mod } = composeResidentHalf()
  const { ctx, registrations, injects } = makeFakeCtx()
  mod.apply(ctx)

  assert.deepEqual(injects, [
    'conversation.input.dock',
    'sidebar.right.pane.tab',
    'settings.plugins.tab',
    'settings.section',
    'settings.section',
  ])

  const dock = registrations.find((r) => r.spec.name === 'conversation.input.dock')
  assert.ok(dock, 'dock 注册必须存在（功能栏保留）')
  assert.deepEqual(dock.spec, { name: 'conversation.input.dock', id: 'dsh-mattpocock-skills-deck', order: 40 })

  const tab = registrations.find((r) => r.spec.name === 'settings.plugins.tab')
  assert.deepEqual(tab.spec, { name: 'settings.plugins.tab', id: 'dsws-settings', order: 40 })

  const sections = registrations.filter((r) => r.spec.name === 'settings.section')
  assert.deepEqual(
    sections.map((r) => [r.spec.id, r.spec.order]),
    [
      ['github-resident', 60],
      ['github-repo-registry', 61],
    ],
  )
  assert.equal(
    registrations.some((r) => r.spec.id === 'dsws-settings-section'),
    false,
    'Deck 旧左栏入口必须撤除',
  )
  assert.equal(globalThis.__DECK_FIXTURE__.applied, true, 'Deck 半边的 apply 必须真的跑过')
})

test('mergeEmbed 交接：登记库页渲染的正是 Deck 交出的那两个组件（同一函数对象）', () => {
  const { mod } = composeResidentHalf()
  const { ctx, registrations } = makeFakeCtx()
  mod.apply(ctx)
  const registry = registrations.find((r) => r.spec.id === 'github-repo-registry')
  const tree = renderRegistration(registry, {})

  const fx = globalThis.__DECK_FIXTURE__
  const renderedSections = findInTree(tree, (node) => node.type === fx.sections)
  const renderedUpdate = findInTree(tree, (node) => node.type === fx.update)
  assert.ok(renderedSections, 'Deck 的 SettingsSections 必须被登记库页渲染')
  assert.ok(renderedUpdate, 'Deck 的唯一更新入口必须被登记库页渲染')
  assert.equal(globalThis.__DECK_FIXTURE__.embed, true)
})

test('Resident 半边单独运行（旧形态、无 embed）不崩，两个设置页仍注册', () => {
  const half = captureHalf(readResidentSource(), 'resident-half')
  const plugin = half.factory(makeRequire())
  assert.deepEqual(plugin.inject, ['slots'])
  const { ctx, registrations } = makeFakeCtx()
  plugin.apply(ctx)
  assert.deepEqual(
    registrations.map((r) => [r.spec.id, r.spec.order]),
    [
      ['github-resident', 60],
      ['github-repo-registry', 61],
    ],
  )
  const tree = renderRegistration(registrations[1], {})
  assert.equal(
    findInTree(tree, (node) => node.props && node.props.className === 'deck-fixture-sections'),
    null,
  )
})

test('两半的顶层重名声明（React / h / API）在独立词法作用域里不冲突', () => {
  const result = rewriteDeckClient(makeDeckSource(), readResidentSource())
  // 若两半被拼进同一个函数体，new Function 会在编译期抛 "Identifier 'API' has already been declared"。
  const spec = loadMergedModule(result.text)
  assert.equal(spec.id, MERGED_PACKAGE_NAME)
  assert.equal(result.text.split('const API =').length - 1, 2, '两半各声明一份 API，用来证明作用域隔离')
})
