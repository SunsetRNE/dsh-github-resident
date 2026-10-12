/**
 * tests/merge/client/static-contract.test.mjs —— 合并形态下客户端源码/产物的静态契约
 *
 * 这些断言不跑 React：它们钉住「谁在哪里注册、谁是唯一入口、哪个身份串必须一致」。
 * 真机视觉与宿主渲染属于集成人的最终构建那一步（本文件不能替代）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { MERGED_PACKAGE_NAME } from '../../../tools/merge/merge-identity.ts'
import { readRepoFile } from './harness.mjs'

const PANEL_ASSEMBLY = 'deck/src/client/panelAssembly.js'
const CLIENT = 'client.js'
const SETTINGS_PAGE = 'deck/src/client/views/SettingsPage.js'
const UPDATE_ENTRY = 'deck/src/client/views/UpdateEntryHost.js'
const LOCALE_FLOW = 'deck/src/client/kernel/locale-flow.js'
const SETTINGS_WS = 'deck/src/client/views/SettingsWorkspaces.js'

function count(text, needle) {
  return text.split(needle).length - 1
}

test('panelAssembly：撤除 Deck 左栏入口，保留功能栏、右栏、插件 tab 与 mergeEmbed 出口', () => {
  const src = readRepoFile(PANEL_ASSEMBLY)
  assert.equal(count(src, "id: 'dsws-settings-section'"), 0, 'Deck 旧 settings.section 注册必须撤除')
  assert.equal(count(src, "__injectOnce('settings.section'"), 0, 'Deck 半边不再注入 settings.section')
  // 身份融合后槽位 id 是运行时身份常量派生（DSW_IDENTITY，构建期注入），order 40 不变。
  assert.equal(count(src, 'id: DSW_IDENTITY, order: 40'), 1, 'dock 注册必须恰好一条（身份常量 + order 40）')
  assert.equal(count(src, "id: 'dsh-mattpocock-skills-deck', order: 40"), 0, '不再用旧 Deck 身份注册槽位')
  assert.ok(src.includes("'conversation.input.dock'"))
  assert.ok(src.includes("'sidebar.right.pane.tab'"))
  assert.ok(src.includes("'sidebar.right.pane.tab.title'"))
  assert.ok(src.includes("'settings.plugins.tab'"))
  assert.ok(src.includes("'tool.view.cordis'"))
  assert.ok(src.includes('mergeEmbed'))
  assert.equal(count(src, 'h(UpdateEntryHost, null)'), 1, '更新入口只在 panelAssembly 的 mergeEmbed 里挂一次')
})

test('root client.js：两个 Resident 设置页仍在（60 / 61），并接住 Deck 交出的区块', () => {
  const src = readRepoFile(CLIENT)
  assert.ok(src.includes("id: 'github-resident',"), 'GitHub 账号页必须独立保留')
  assert.ok(src.includes('order: 60,'))
  assert.ok(src.includes("id: 'github-repo-registry',"))
  assert.ok(src.includes('order: 61,'))
  assert.ok(src.includes('deckEmbed'))
  assert.ok(src.includes('DeckSections'))
  assert.ok(src.includes('DeckUpdate'))
  assert.ok(src.includes("apply(ctx, embed)"), 'apply 必须接收合并装配层传来的 embed')
  assert.ok(src.includes('刷新登记快照'), '写库快照的按钮必须与只读总览区分命名')
})

test('SettingsPage：三个分区组件可复用，本页不再挂第二个更新入口', () => {
  const src = readRepoFile(SETTINGS_PAGE)
  assert.ok(src.includes('const DeckWorkspacesSection'))
  assert.ok(src.includes('const DeckDiagnosticsSection'))
  assert.ok(src.includes('const DeckAuthorPluginsSection'))
  assert.ok(src.includes('const SettingsPage'))
  assert.ok(src.includes("tr('cfg.updateInRegistry')"))
  assert.equal(count(src, 'h(UpdateEntryHost'), 0, '更新入口不在本页第二次挂载')
  assert.equal(count(src, 'h(DeckWorkspacesSection'), 1)
  assert.equal(count(src, 'h(DeckDiagnosticsSection'), 1)
  assert.equal(count(src, 'h(DeckAuthorPluginsSection'), 1)
})

test('作者链接默认折叠（<details>），不是默认展开的分组', () => {
  const src = readRepoFile(SETTINGS_PAGE)
  assert.ok(src.includes("h('details'"), '作者其他插件必须是默认收起的 details')
  assert.ok(src.includes('MORE_PLUGINS'), '作者链接一个不删')
})

test('唯一更新入口用去 scope 的本地 pluginId，且与 Host UPDATE_PLUGIN_ID 逐字一致', () => {
  const src = readRepoFile(UPDATE_ENTRY)
  // update 包的 assertPluginId 会拒绝带 `/` 的值，所以传的是去 scope 的本地状态命名空间；
  // 真正的 npm 包身份（含 scope 的合并包名）由 Host 作为 targetPackageName 显式传下去。
  // 两边靠 UPDATE_PLUGIN_ID 对齐 —— 这里读 Host 源核对，不是各写一份。
  const localId = MERGED_PACKAGE_NAME.replace(/^@[^/]+\//, '')
  assert.notEqual(localId, MERGED_PACKAGE_NAME, '合并包名必须带 scope，否则这条断言失去意义')
  // 2026-10-12 身份融合：两边都不再各写一份字面量 —— 客户端用构建期注入的 DSW_IDENTITY，
  // 宿主用共享真源 deck/src/shared/plugin-identity.js 的 UPDATE_PLUGIN_ID。这里钉三件事：
  //   ① 共享真源的值 = 去 scope 的合并包名；② 客户端传的是那个常量而不是字面量；
  //   ③ 两边都不回旧 Deck 包名、也不把含 scope 的包名当 pluginId。
  const sharedSrc = readRepoFile('deck/src/shared/plugin-identity.js')
  const sharedMatch = /UPDATE_PLUGIN_ID = MERGED_PACKAGE_NAME\.replace\(\/\^@\[\^\/\]\+\\\/\/, ''\)/.exec(sharedSrc)
  assert.ok(sharedMatch, '共享真源必须由 MERGED_PACKAGE_NAME 派生 UPDATE_PLUGIN_ID')
  const hostSrc = readRepoFile('deck/src/host/updateFromPackage.js')
  assert.ok(/export \{ MERGED_PACKAGE_NAME, LEGACY_DECK_PACKAGE_NAME, UPDATE_PLUGIN_ID \}/.test(hostSrc), 'Host 仍导出 UPDATE_PLUGIN_ID（改从共享真源取）')
  assert.ok(src.includes('pluginId: DSW_IDENTITY'), '客户端 pluginId 用构建期注入的身份常量')
  assert.equal(count(src, `pluginId: '${MERGED_PACKAGE_NAME}'`), 0, '不把含 scope 的包名当 pluginId')
  assert.equal(count(src, "pluginId: 'dsh-mattpocock-skills-deck'"), 0, '不回旧 Deck 包名')
  assert.equal(localId, 'dsh-github-resident-v2', '去 scope 的本地标识形状不变')
})

test('locale：新键中英各一份，工作区刷新按钮改名为「刷新工作区总览」', () => {
  const src = readRepoFile(LOCALE_FLOW)
  assert.equal(count(src, "'cfg.updateInRegistry'"), 2, '中英各一条')
  assert.equal(count(src, "'cfg.wsRefresh'"), 2, '中英各一条')
  assert.ok(src.includes("'cfg.wsRefresh': '刷新工作区总览'"))
  assert.ok(src.includes("'cfg.wsRefresh': 'Refresh workspace overview'"))
  assert.ok(readRepoFile(SETTINGS_WS).includes("tr('cfg.wsRefresh')"))
})

test('主题 token：三个错名 token 已清零，改用真名', () => {
  const files = [CLIENT, PANEL_ASSEMBLY, SETTINGS_PAGE, UPDATE_ENTRY, LOCALE_FLOW,
    'deck/src/client/kernel/modal-fields.js', 'deck/src/client/kernel/styles.js',
    'deck/src/client/panel/Dock.js', 'deck/src/client/views/ChecksTab.js', 'deck/src/client/views/shared/md.js']
  const all = files.map(readRepoFile).join('\n')
  assert.equal(count(all, '--dsw-alias-state-warning-primary'), 0)
  assert.equal(count(all, '--dsw-alias-interactive-bg-primary'), 0)
  assert.equal(count(all, '--dsw-alias-markdown-heading'), 0)
  assert.ok(all.includes('--dsw-alias-state-warn-primary'))
  assert.ok(all.includes('--dsw-alias-brand-primary'))
  assert.ok(all.includes('--dsw-alias-link'))
})

test('诊断组与 Resident 的 busy 模型互不禁用（两套状态各自独立）', () => {
  const diagnostics = readRepoFile(SETTINGS_PAGE)
  assert.ok(diagnostics.includes('dbgBusy'), 'Deck 诊断组保留自己的 dbgBusy')
  const client = readRepoFile(CLIENT)
  assert.ok(client.includes('busy === '), 'Resident 页保留「每个动作一个 tag」的 busy')
})
