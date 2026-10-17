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
import { MERGED_CLIENT_INJECT, MERGED_PACKAGE_NAME, MERGED_REPO_URL_LITERAL, MERGED_VERSION, MERGED_VERSION_LITERAL, MODULE_LOADER_MARKER } from '../../../tools/merge/merge-identity.ts'
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

test('合并产物只有一个 load，模块 id 是合并包名，dock 槽位 id 用合并身份且 order 40 不变', () => {
  const { result, spec } = composeResidentHalf()
  assert.equal(result.text.split(MODULE_LOADER_MARKER).length - 1, 1)
  assert.equal(spec.id, MERGED_PACKAGE_NAME)
  assert.equal(result.moduleId, MERGED_PACKAGE_NAME)
  // 2026-10-12 身份融合：槽位 id 从旧 Deck 名换成合并身份（MERGED_IDENTITY），order 40 不动。
  // 这是**有意的契约变更**，不是漂移：旧身份只许出现在客户端身份迁移那一行常量里（见 merge-identity.ts）。
  assert.ok(result.text.includes("id: 'dsh-github-resident-v2', order: 40"))
  assert.ok(!result.text.includes(`${MODULE_LOADER_MARKER}{\n  id: 'dsh-mattpocock-skills-deck',`))
  assert.equal(result.idReplaced, true)
  assert.equal(result.injectReplaced, true)
  assert.equal(result.bytesBefore, Buffer.byteLength(makeDeckSource(), 'utf8') + Buffer.byteLength(readResidentSource(), 'utf8'))
  assert.equal(result.bytesAfter, Buffer.byteLength(result.text, 'utf8'))
})

test('版本 / 仓库地址：产出里是主包自己的值，不留 Deck 上游字面量（两种来源都覆盖）', () => {
  // 情形一（幂等）：身份融合后 deck 构建自己就读主包 package.json，夹具给的就是正确值 —— 装配层只核对。
  const ok = rewriteDeckClient(makeDeckSource(), readResidentSource())
  assert.ok(ok.text.includes('DSW_VERSION = ' + MERGED_VERSION_LITERAL), '产出里是合并包版本 ' + MERGED_VERSION)
  assert.ok(ok.text.includes('DSW_REPO_URL = ' + MERGED_REPO_URL_LITERAL), '产出里是主包仓库地址')
  assert.equal(ok.version, MERGED_VERSION)

  // 情形二（改写）：deck 半边仍带着**上游**版本与上游仓库地址时，装配层必须把它们换成主包的值。
  // 这条路径保留着，是为了防"哪天 deck 构建回退到读自己那份 package.json"时静默通过。
  const upstreamVersion = "const DSW_VERSION = 'v1.8.0-rc.7'"
  const upstreamRepo = "const DSW_REPO_URL = 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck'"
  const legacy = makeDeckSource()
    .split("const DSW_VERSION = 'v1.7.0'").join(upstreamVersion)
    .split("const DSW_REPO_URL = 'https://github.com/SunsetRNE/dsh-github-resident'").join(upstreamRepo)
  assert.ok(legacy.includes(upstreamVersion) && legacy.includes(upstreamRepo), '对照夹具必须带上游版本与上游仓库地址')
  const fixed = rewriteDeckClient(legacy, readResidentSource())
  assert.ok(fixed.text.includes('DSW_VERSION = ' + MERGED_VERSION_LITERAL), '上游版本被换成合并包版本')
  assert.ok(fixed.text.includes('DSW_REPO_URL = ' + MERGED_REPO_URL_LITERAL), '上游仓库地址被换成主包仓库')
  assert.ok(!fixed.text.includes(upstreamVersion), '产出里不留 Deck 上游版本字面量')
  assert.ok(!fixed.text.includes(upstreamRepo), '产出里不留 Deck 上游仓库地址字面量')
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
  assert.deepEqual(dock.spec, { name: 'conversation.input.dock', id: 'dsh-github-resident-v2', order: 40 })

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

test('mergeEmbed 交接：默认数据页不挂 Deck 区块与更新入口，页签照常渲染（#78）', () => {
  const { mod } = composeResidentHalf()
  const { ctx, registrations } = makeFakeCtx()
  mod.apply(ctx)
  const registry = registrations.find((r) => r.spec.id === 'github-repo-registry')
  const tree = renderRegistration(registry, {})

  const fx = globalThis.__DECK_FIXTURE__
  // #78：这一页改成五个子页，默认落在「数据」。桩 React 的 useState 返回定值、切不了页，
  // 所以这里断言的是「默认页上不再挂 Deck 区块与更新入口」；切换后的挂载由
  // tests/merge/build/merged-render.test.mjs 用真 React 点页签来验。
  assert.ok(!findInTree(tree, (node) => node.type === fx.sections), '数据页不再渲染 Deck 整块')
  assert.ok(!findInTree(tree, (node) => node.type === fx.workspace), '数据页不渲染工作区区块（归「绑定」）')
  assert.ok(!findInTree(tree, (node) => node.type === fx.update), '更新入口不再被设置页挂载（分发页只给链接）')
  assert.ok(findInTree(tree, (node) => node.type === 'button' && node.children === '数据'), '五子页的页签真渲染出来了')
  assert.equal(globalThis.__DECK_FIXTURE__.embed, true)
})

test('Resident 半边单独运行（旧形态、无 embed）不崩，两个设置页仍注册', () => {
  const half = captureHalf(readResidentSource(), 'resident-half')
  const plugin = half.factory(makeRequire())
  assert.deepEqual(plugin.inject, ['connection', 'slots'])
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

test('两半的顶层重名声明（React / h）在独立词法作用域里不冲突', () => {
  const result = rewriteDeckClient(makeDeckSource(), readResidentSource())
  // 若两半被拼进同一个函数体，new Function 会在编译期抛 "Identifier 'React' has already been declared"。
  const spec = loadMergedModule(result.text)
  assert.equal(spec.id, MERGED_PACKAGE_NAME)
  assert.equal(result.text.split("const React = require('react')").length - 1, 2, '两半各声明一份 React，用来证明作用域隔离')
})
