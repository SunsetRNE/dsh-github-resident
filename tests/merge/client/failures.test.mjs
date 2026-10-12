/**
 * tests/merge/client/failures.test.mjs —— 装配器的失败路径（拒绝静默省半边 / 拒绝锚点漂移）
 *
 * 每个负例都断言**抛错**而不是「尽量改」：合并客户端一旦静默少一半，症状是页面空白或
 * 某个设置页消失，排查成本极高。这里把每条拒绝理由钉成测试。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { rewriteDeckClient } from '../../../tools/merge/rewrite-deck-client.ts'
import { assertInjectCoverage } from '../../../tools/merge/client-factory.ts'
import { findInTree, loadMergedModule, makeDeckSource, makeFakeCtx, makeRequire, makeResidentSource, readResidentSource, renderRegistration } from './harness.mjs'

const RESIDENT = () => readResidentSource()
const DECK = () => makeDeckSource()

test('缺 Deck 输入 → 抛错（不许只装 Resident 半边）', () => {
  assert.throws(() => rewriteDeckClient(undefined, RESIDENT()), /源码缺失或为空/)
})

test('缺 Resident 输入 → 抛错（不许只装 Deck 半边，这正是旧的假合并）', () => {
  assert.throws(() => rewriteDeckClient(DECK(), undefined), /源码缺失或为空/)
})

test('输入是空串 → 抛错', () => {
  assert.throws(() => rewriteDeckClient(DECK(), '   \n'), /源码缺失或为空/)
  assert.throws(() => rewriteDeckClient('', RESIDENT()), /源码缺失或为空/)
})

test('deck 产物里出现两次 load → 抛错（重复注册）', () => {
  assert.throws(() => rewriteDeckClient(makeDeckSource({ extraLoad: true }), RESIDENT()), /出现 2 次/)
})

test('deck 模块 id 不是旧 Deck 身份 → 抛错', () => {
  assert.throws(
    () => rewriteDeckClient(makeDeckSource({ id: 'some-other-package' }), RESIDENT()),
    /模块 id 期望 'dsh-mattpocock-skills-deck'/,
  )
})

test('Resident 半边不是合并身份 → 抛错', () => {
  assert.throws(
    () => rewriteDeckClient(DECK(), makeResidentSource({ id: 'dsh-github-resident' })),
    /Resident 客户端模块 id 期望合并身份/,
  )
})

test('Resident 半边没有 apply → 构建期就抛错', () => {
  const src = `window.__ModuleLoader__.load({ id: '@local/dsh-github-resident-v2', factory(require) { return { inject: ['slots'] } } });`
  assert.throws(() => rewriteDeckClient(DECK(), src), /没有 apply/)
})

test('任一半声明了 inject 清单以外的服务 → 抛错（不许静默丢服务）', () => {
  assert.throws(
    () => rewriteDeckClient(DECK(), makeResidentSource({ inject: ['slots', 'timer'] })),
    /inject 清单以外的服务：timer/,
  )
})

test('常量里有半边都没声明的服务 → 抛错（常量漂移）', () => {
  // deck 半边固定声明全部 5 项，所以「缺哪项」只能用并集校验函数的输入直接单测。
  assert.throws(
    () => assertInjectCoverage(['slots'], ['connection', 'slots']),
    /半边都没声明的服务：locale, workspaces, sessions/,
  )
  assert.doesNotThrow(() =>
    assertInjectCoverage(['connection', 'slots', 'locale', 'workspaces', 'sessions'], ['slots']),
  )
})

test('deck 半边没有 dock 注册 → 抛错（功能栏被打偏不许产出）', () => {
  assert.throws(() => rewriteDeckClient(makeDeckSource({ dock: false }), RESIDENT()), /dock 槽位 id 不见了/)
})

test('deck 的 inject 锚点漂移 → 抛错（不猜）', () => {
  const drifted = DECK().replace(
    "    exports.inject = ['connection', 'slots', 'locale', 'workspaces', 'sessions']",
    "    exports.inject = ['connection', 'slots', 'locale', 'workspaces']",
  )
  assert.notEqual(drifted, DECK(), '夹具替换必须命中锚点')
  assert.throws(() => rewriteDeckClient(drifted, RESIDENT()), /inject 锚点出现 0 次/)
})

test('deck 半边不返回 mergeEmbed 时：Resident 仍注册两页，只是没有 Deck 区块（可降级但不静默）', () => {
  const result = rewriteDeckClient(makeDeckSource({ embed: false }), RESIDENT())
  const spec = loadMergedModule(result.text)
  const mod = spec.factory(makeRequire())
  const { ctx, registrations } = makeFakeCtx()
  mod.apply(ctx)
  assert.deepEqual(
    registrations.filter((r) => r.spec.name === 'settings.section').map((r) => r.spec.id),
    ['github-resident', 'github-repo-registry'],
  )
  const tree = renderRegistration(registrations.find((r) => r.spec.id === 'github-repo-registry'), {})
  assert.equal(findInTree(tree, (node) => node.props && node.props.className === 'deck-fixture-sections'), null)
})
