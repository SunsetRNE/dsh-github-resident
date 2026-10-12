/**
 * tests/merge/client/deck-splice.test.mjs —— Deck 半边「按 build.mjs 的拼法」能不能编译
 *
 * 为什么需要它：deck 的客户端是 scripts/build.mjs 把 kernel/leaf 文件按 index.js 里的
 * `// ==== leaf:<id> (spliced by build) ====` 标记拼进**同一个 apply 闭包**的。我在
 * SettingsPage.js / panelAssembly.js / SettingsWorkspaces.js / UpdateEntryHost.js 里改了内容，
 * 如果拼出来有重复声明、括号不配、或 `return` 落到了错误层级，只有在构建时才暴露 —— 而
 * 本仓此刻还没有 node_modules（构建属于构建负责人）。
 *
 * 这里只做**语法级**复现：按同样的标记替换 + 去掉行首 `export `，把 apply 体编译一次。
 * 其余未替换的标记是注释，原样保留不影响语法；不执行、不渲染、不碰生成物。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readRepoFile } from './harness.mjs'

const SPLICES = [
  ['settingsPage', 'deck/src/client/views/SettingsPage.js'],
  ['SettingsWorkspaces', 'deck/src/client/views/SettingsWorkspaces.js'],
  ['updateEntryHost', 'deck/src/client/views/UpdateEntryHost.js'],
  ['panelAssembly', 'deck/src/client/panelAssembly.js'],
]

function stripExportLine(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^(\s*)export\s+/, '$1'))
    .join('\n')
    .trim()
}

test('deck apply 闭包：本次改动的 4 个叶子按 build.mjs 的拼法拼起来能编译', () => {
  const indexSource = readRepoFile('deck/src/client/index.js')
  const start = indexSource.indexOf('export default {')
  assert.ok(start >= 0, 'src/client/index.js 必须有 export default {')
  const end = indexSource.lastIndexOf('}')
  assert.ok(end > start)
  let body = indexSource.slice(start + 'export default {'.length - 1, end + 1)

  for (const [id, file] of SPLICES) {
    const marker = `// ==== leaf:${id} (spliced by build) ====`
    assert.ok(body.includes(marker), `index.js 缺标记 ${marker}`)
    body = body.replace(marker, stripExportLine(readRepoFile(file)))
  }

  // 其余叶子/内核标记在真构建里也会被内容替换掉；这里只做语法复现，所以把标记文本清掉，
  // 避免「同一行上另一个标记的 // 前缀把内容注释掉」这种假故障。
  body = body.replace(/\/\/ ==== (?:leaf|kernel):[^=]+? \(spliced by build\) ====/g, '')

  // 编译成「对象字面量里的 apply」：重复声明/括号不配/return 错层都会在这里抛 SyntaxError。
  assert.doesNotThrow(() => {
    // eslint-disable-next-line no-new-func
    new Function(`return (${body})`)
  }, 'deck apply 体必须能编译')

  // 合并出口在 apply 体里，且只声明一次
  assert.equal(body.split('const DeckSettingsSections').length - 1, 1)
  assert.equal(body.split('return {').length - 1 >= 1, true)
  assert.ok(body.includes('mergeEmbed'))
})

test('deck 半边不再向 settings.section 注入（合并后由 Resident 的两个页承担）', () => {
  const panel = readRepoFile('deck/src/client/panelAssembly.js')
  assert.equal(panel.split("__injectOnce('settings.section'").length - 1, 0)
  assert.equal(panel.split('mergeEmbed').length - 1, 1)
})
