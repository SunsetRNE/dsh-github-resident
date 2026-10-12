/**
 * tests/merge/host/identity-parity.test.mjs —— 合并包身份「三处逐字相同」的机器判据（任务 H · 交付物 1/5）。
 *
 * 为什么需要它：合并包里同一个身份在**四个不同介质**上各写了一次（根 package.json、根 cordis.patch.yml、
 * 宿主入口 dist/host.js、deck 源码里的 name / manifest 名 / 技能根候选），而 deck/ 内的文件**不能**在运行期
 * import `tools/merge/merge-identity.ts`（那是 .ts，且打包时 tools/ 根本不进 files 白名单）。所以真源只有
 * 构建期能被引用，运行期各处的字面只能靠门禁比对。id 不一致的失败方式是**静默的**（客户端脚本加载不上、
 * 技能目录全丢），这正是要机器判据而不是人眼的原因。
 *
 * 只读检查：不写盘、不联网、不读 HOME。`dist/` 不存在时逐条 SKIP 并说明原因（构建由构建负责人跑）。
 *
 * 用法：node tests/merge/host/identity-parity.test.mjs
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, check, importRel, note, readJson, readText, section, skip, summary } from './_check.mjs'

section('1) 真源常量与根清单')
const identity = await importRel('tools/merge/merge-identity.ts')
const MERGED = identity.MERGED_PACKAGE_NAME
const MERGED_IDENTITY = identity.MERGED_IDENTITY
const LEGACY_DECK_PACKAGE_NAME = identity.LEGACY_DECK_IDENTITY
const HOST_INJECT = identity.MERGED_HOST_INJECT
const CLIENT_INJECT = identity.MERGED_CLIENT_INJECT
check(typeof MERGED === 'string' && MERGED.length > 0, '真源 MERGED_PACKAGE_NAME = ' + MERGED)
check(Array.isArray(HOST_INJECT) && HOST_INJECT.length === 4, '真源 MERGED_HOST_INJECT 有 4 项：' + HOST_INJECT.join(','))

const pkg = readJson('package.json')
const exportTarget = (key) => String((pkg.exports || {})[key] || '').replace(/^\.\//, '')
check(pkg.name === MERGED, '根 package.json name === 真源（实际 ' + pkg.name + '）')
check(pkg.private === undefined, '根 package.json 无 private 标记（可发布包：@SunsetRNE 改名后走 npm publish）')
check(pkg.exports['.'] === './dist/host.js', 'exports["."] 指向 dist/host.js')
check(exportTarget('./tools') === identity.DECK_TOOLS_ROW_SOURCE, 'exports["./tools"] 与真源 DECK_TOOLS_ROW_SOURCE 一致（清单=' + exportTarget('./tools') + '，真源=' + identity.DECK_TOOLS_ROW_SOURCE + '）')
check(pkg.exports['./deck'] === './deck/src/host/index.js', 'exports["./deck"] 保留原始宿主半边（回滚/兼容）')

section('2) bundle patch 两行身份')
const patch = readText('cordis.patch.yml')
check(patch.includes("name: '" + MERGED + "'"), 'patch 主机行 name = 合并包名')
check(patch.includes("name: '" + MERGED + "/tools'"), 'patch 工具行 name = 合并包名 + /tools（子路径行）')
check(!patch.includes("'" + identity.DECK_SUBDIR + "'"), 'patch 不出现裸 deck 子目录名当包名')

section('3) deck 源码里的运行期字面')
const deckIndex = readText('deck/src/host/index.js')
const deckNameMatch = /name:\s*'([^']+)'/.exec(deckIndex)
check(!!deckNameMatch && deckNameMatch[1] === MERGED, 'deck/src/host/index.js 的 name = 合并包名（实际 ' + (deckNameMatch && deckNameMatch[1]) + '）')

const rowSrc = readText('deck/src/host/platform/deckToolsRow.js')
const rowNameMatch = /export const name = '([^']+)'/.exec(rowSrc)
check(!!rowNameMatch && rowNameMatch[1] === MERGED + '/tools', 'deckToolsRow.js 的 name = 合并包名 + /tools（实际 ' + (rowNameMatch && rowNameMatch[1]) + '）')
check(patch.includes("'" + (rowNameMatch && rowNameMatch[1]) + "'"), '行模块名与 patch 里那一行逐字相同')

const rpcSrc = readText('deck/src/host/rpcChannel.js')
const rpcNameMatch = /const MANIFEST_NAME = '([^']+)'/.exec(rpcSrc)
check(!!rpcNameMatch && rpcNameMatch[1] === MERGED, 'rpcChannel.js 的 MANIFEST_NAME = 合并包名（实际 ' + (rpcNameMatch && rpcNameMatch[1]) + '）')

const updateSrc = readText('deck/src/host/updateFromPackage.js')
// 2026-10-12 身份融合：三个身份改住在共享真源 deck/src/shared/plugin-identity.js，
// updateFromPackage.js 只 import + 转出（不再是本文件里的字面量）。这里改钉两件事：
//   ① 它确实从共享真源取；② 共享真源的值与合并层真源逐字一致。
const sharedIdentitySrc = readText('deck/src/shared/plugin-identity.js')
const sharedNameMatch = /MERGED_PACKAGE_NAME = '([^']+)'/.exec(sharedIdentitySrc)
check(!!sharedNameMatch && sharedNameMatch[1] === MERGED, '共享身份真源的 MERGED_PACKAGE_NAME = 合并层真源（实际 ' + (sharedNameMatch && sharedNameMatch[1]) + '）')
const sharedLegacyMatch = /LEGACY_DECK_PACKAGE_NAME = '([^']+)'/.exec(sharedIdentitySrc)
check(!!sharedLegacyMatch && sharedLegacyMatch[1] === LEGACY_DECK_PACKAGE_NAME, '共享身份真源的旧 Deck 包名 = 合并层真源（漂移守卫对照值）')
check(/from '\.\.\/shared\/plugin-identity\.js'/.test(updateSrc), 'updateFromPackage.js 从共享真源取身份（不再自己写第二份）')
check(!/export const MERGED_PACKAGE_NAME = '/.test(updateSrc), 'updateFromPackage.js 里不再有 MERGED_PACKAGE_NAME 字面量（单一真源）')

section('4) 技能/清单发现：旧包名不得再出现在候选里')
for (const rel of ['deck/src/host/bootstrap.js', 'deck/src/host/skillDoc.js']) {
  const text = readText(rel)
  check(text.includes("'" + MERGED + "'"), rel + ' 声明了合并包名字面（node_modules 候选用）')
  check(!text.includes("'dsh-mattpocock-skills-deck'"), rel + ' 不再有旧包名候选（读到旧 Deck 等于两套技能并存）')
  check(text.includes("'package'") && text.includes("'bundled-skills'"), rel + ' 按 package/bundled-skills 逐级向上找（不是假设根 bundled-skills）')
}

section('5) 宿主装配层的 inject 字面与真源逐项 + 顺序一致')
const assemblySrc = readText('tools/merge/host-assembly.ts')
const injectMatch = /export const inject: readonly string\[\] = \[([^\]]+)\]/.exec(assemblySrc)
const assemblyInject = injectMatch
  ? injectMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  : []
check(JSON.stringify(assemblyInject) === JSON.stringify(HOST_INJECT), 'host-assembly 的 inject = MERGED_HOST_INJECT（含顺序）：' + JSON.stringify(assemblyInject))
check(assemblySrc.includes(MERGED), 'host-assembly 里带合并包名字面锚（build-merge-entries --check 按它找锚）')
check(!/export default/.test(assemblySrc.replace(/\/\*[\s\S]*?\*\//g, '')), 'host-assembly 不再给 default 导出（单一导出形态）')

section('6) 产物（dist/）存在时的运行期形状')
const hostOut = join(REPO_ROOT, identity.MERGED_HOST_OUT)
const clientOut = join(REPO_ROOT, identity.MERGED_CLIENT_OUT)
if (!existsSync(hostOut) || !existsSync(clientOut)) {
  skip('dist/host.js 或 dist/client.js 不存在（构建产物，gitignore；构建负责人跑 npm run build 后本段才有意义）')
} else {
  const hostMod = await import(new URL('file://' + hostOut).href)
  // 复刻 cordis loader 的 unwrapExports 语义（@deepseek-ai/cordis-plugin-loader/lib/index.js）：
  //   exports = exports.default ?? exports; if (!exports.__esModule) return exports; return exports.default ?? exports
  const unwrapped = hostMod.default ?? hostMod
  const plugin = !unwrapped.__esModule ? unwrapped : (unwrapped.default ?? unwrapped)
  check(typeof plugin.apply === 'function', 'loader 取到的插件对象有 apply（unwrapExports 后）')
  check(plugin.name === MERGED, 'loader 取到的插件 name = 合并包名（实际 ' + plugin.name + '）')
  check(JSON.stringify(plugin.inject) === JSON.stringify(HOST_INJECT), 'loader 取到的 inject = MERGED_HOST_INJECT（含顺序）')
  check(!('default' in hostMod), 'dist/host.js 没有 default 导出（装载器只会拿到具名命名空间，不会出现两个插件对象）')
  const clientText = readText(identity.MERGED_CLIENT_OUT)
  const loadCount = clientText.split(identity.MODULE_LOADER_MARKER).length - 1
  check(loadCount === 1, 'dist/client.js 里 ' + identity.MODULE_LOADER_MARKER + ' 恰好 1 次（实际 ' + loadCount + '）')
  check(clientText.includes("id: '" + MERGED + "'"), 'dist/client.js 模块 id = 合并包名')
  check(clientText.includes("id: 'dsh-github-resident-v2', order: 40") || clientText.includes('id: DSW_IDENTITY, order: 40'), 'dist/client.js 的 dock 槽位 id = 合并身份、order 40')
}

note('客户端 inject 真源：' + JSON.stringify(CLIENT_INJECT))
summary()
