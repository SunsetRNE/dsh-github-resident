/**
 * tests/merge/build/pack-contract.test.mjs —— 合并包的**发布形态**契约
 *
 * 为什么必须打真包再验：`files` 白名单、**嵌套 .gitignore**（实测：deck/.gitignore 的
 * `/package/lib/` 会把 deck/package/lib 从 tarball 里剔掉，即使根 files 写了它）、
 * exports 子路径解析、包根 bundled-skills 布局，这四件事只有在「npm pack → 解包 → 装成
 * node_modules 布局」之后才是真的。作者态路径下相对 import 偶然成功一律不算数（历史 A 项翻车方式）。
 *
 * 用法：node tests/merge/build/pack-contract.test.mjs（先跑 npm run build）
 */

import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUNDLED_SKILLS_EXPECTED,
  MERGED_CLIENT_INJECT,
  MERGED_HOST_INJECT,
  MERGED_PACKAGE_NAME,
  MODULE_LOADER_MARKER,
} from '../../../tools/merge/merge-identity.ts'
import {
  REPO_ROOT,
  check,
  computedImportCount,
  countOccurrences,
  existsSync,
  finish,
  installFromTarball,
  listDir,
  listRelFiles,
  packRepo,
  readJson,
  runProbe,
  section,
  staticSpecifiers,
  walkRelativeGraph,
} from './_lib.mjs'

const DIST_HOST = join(REPO_ROOT, 'dist/host.js')
const DIST_CLIENT = join(REPO_ROOT, 'dist/client.js')

const PROBE = `// 由 pack-contract.test.mjs 生成：只在临时 fixture 里跑，不进仓库
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const NAME = ${JSON.stringify(MERGED_PACKAGE_NAME)}
const out = {}
const require = createRequire(import.meta.url)

const host = await import(NAME)
out.host = { keys: Object.keys(host).sort(), name: host.name, inject: host.inject, apply: typeof host.apply }

out.resolve = {}
for (const sp of ['/client', '/tools', '/deck', '/cordis.patch.yml', '/package.json', '/locale/en.json']) {
  try { out.resolve[sp] = require.resolve(NAME + sp) } catch (e) { out.resolve[sp] = 'ERR:' + e.code }
}

const tools = await import(NAME + '/tools')
out.tools = { keys: Object.keys(tools).sort(), name: tools.name, inject: tools.inject, apply: typeof tools.apply }

const deck = await import(NAME + '/deck')
out.deck = { apply: typeof ((deck.default && deck.default.apply) || deck.apply) }

// 客户端不在本探针里求值（浏览器脚本，求值交给 client-union.test.mjs 的 jsdom 组合测试）；
// 这里只把「exports 解析得到的确实是同一个客户端文件」记录下来。
out.client = { resolved: require.resolve(NAME + '/client') }
console.log('PROBE_RESULT ' + JSON.stringify(out))
`

section('0. 前置：产物必须先构建')
check('dist/host.js 存在', existsSync(DIST_HOST), '先运行 npm run build')
check('dist/client.js 存在', existsSync(DIST_CLIENT), '先运行 npm run build')
if (!existsSync(DIST_HOST) || !existsSync(DIST_CLIENT)) finish()

section('1. npm pack 产物形态')
const packDir = join(REPO_ROOT, 'node_modules', '.merge-pack-check')
rmSync(packDir, { recursive: true, force: true })
mkdirSync(packDir, { recursive: true })
const packed = packRepo(packDir)
check('npm pack 退出码 0', packed.status === 0, packed.stderr.slice(0, 400))
check('产出 tarball', !!packed.tgz, packed.stdout.slice(0, 200))
if (!packed.tgz) finish()

const { fixture, pkgDir } = installFromTarball(packed.tgz, MERGED_PACKAGE_NAME)
check('tarball 解出的包目录存在', existsSync(pkgDir), pkgDir)

const pkg = readJson(join(pkgDir, 'package.json'))
check('包名 = 合并身份', pkg.name === MERGED_PACKAGE_NAME, pkg.name)
check('根 package.json 不再带 private（@SunsetRNE 改名后要能 npm publish）', pkg.private === undefined, String(pkg.private))
// 2026-10-13：npm 只收**全小写**的包名（`@SunsetRNE/...` 会被拒：「缺少合法的 npm 插件名称」）。
//   把这条写进门禁，别再靠人记 —— 名字里一个大写字母就要重打一次包。
check('包名合法：全小写、带 scope、段与段之间没有空段（npm 发布前置）',
  typeof pkg.name === 'string' && /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(pkg.name) && pkg.name === pkg.name.toLowerCase(),
  String(pkg.name))

for (const rel of [
  'dist/host.js',
  'dist/client.js',
  'plugin.js',
  'cordis.patch.yml',
  'icon.svg',
  'README.md',
  'LICENSE',
  'locale/en.json',
  'locale/zh.json',
]) {
  check(`包内含 ${rel}`, existsSync(join(pkgDir, rel)))
}
check(
  'plugin.js 块头够大（Resident 半边实现必须随包）',
  existsSync(join(pkgDir, 'plugin.js')) && statSync(join(pkgDir, 'plugin.js')).size > 100000,
)
check('dist/client.js 非空', statSync(join(pkgDir, 'dist/client.js')).size > 100000)

section('2. exports 子路径都能落到包内真实文件')
const exportEntries = Object.entries(pkg.exports || {})
for (const [key, target] of exportEntries) {
  if (key.includes('*')) continue
  const rel = String(target).replace(/^\.\//, '')
  check(`exports["${key}"] → ${rel} 存在`, existsSync(join(pkgDir, rel)), String(target))
}
check(
  'exports 面 = 计划冻结的 7 条',
  exportEntries.length === 7,
  JSON.stringify(Object.keys(pkg.exports || {})),
)
check('exports["./tools"] 指向 deck/src 源行模块（deck/package/lib 会被嵌套 .gitignore 剔出 tarball）',
  String(pkg.exports['./tools']).includes('deck/src/host/platform/deckToolsRow.js'),
  String(pkg.exports['./tools']))

section('3. 随包技能落在**包根**（宿主按 <包名>/bundled-skills 找）')
const skillsRoot = join(pkgDir, 'bundled-skills')
check('包根 bundled-skills/ 存在', existsSync(skillsRoot), skillsRoot)
if (existsSync(skillsRoot)) {
  const dirs = listDir(skillsRoot).filter((f) => statSync(join(skillsRoot, f)).isDirectory())
  check(`技能目录数 = ${BUNDLED_SKILLS_EXPECTED}`, dirs.length === BUNDLED_SKILLS_EXPECTED, String(dirs.length))
  for (const f of ['VERSION', 'LICENSE']) check(`bundled-skills/${f} 存在`, existsSync(join(skillsRoot, f)))
  const bad = []
  for (const name of dirs) {
    const md = join(skillsRoot, name, 'SKILL.md')
    if (!existsSync(md)) {
      bad.push(name + '(缺 SKILL.md)')
      continue
    }
    const text = readFileSync(md, 'utf8')
    const m = /^---[\s\S]*?^name:\s*(.+?)\s*$/m.exec(text)
    const fm = m ? m[1].replace(/^['"]|['"]$/g, '') : ''
    if (fm !== name) bad.push(`${name}≠${fm || '(无 name)'}`)
  }
  check('27 个 SKILL.md 的 frontmatter name 与目录名一致', bad.length === 0, bad.slice(0, 5).join(', '))
}
check(
  'deck 侧快照 deck/package/bundled-skills/ 也随包（deck 自己的门禁按它认路径）',
  existsSync(join(pkgDir, 'deck/package/bundled-skills')),
)

section('4. 真实 exports 解析 + import（fixture 自己的 node_modules）')
const probe = runProbe(fixture, '__probe.mjs', PROBE)
check('探针退出码 0', probe.status === 0, (probe.stderr || probe.stdout).slice(-600))
let out = null
if (probe.status === 0) {
  const line = probe.stdout.split('\n').find((l) => l.startsWith('PROBE_RESULT '))
  try {
    out = JSON.parse(line.slice('PROBE_RESULT '.length))
  } catch (e) {
    check('探针输出可解析', false, probe.stdout.slice(-300))
  }
}
if (out) {
  check(
    'import(包名) 成功且导出 name/inject/apply',
    out.host.name === MERGED_PACKAGE_NAME && out.host.apply === 'function' && Array.isArray(out.host.inject),
    JSON.stringify(out.host),
  )
  check(
    '宿主 inject 逐项（含顺序）= MERGED_HOST_INJECT',
    JSON.stringify(out.host.inject) === JSON.stringify(MERGED_HOST_INJECT),
    JSON.stringify(out.host.inject),
  )
  for (const [sp, p] of Object.entries(out.resolve)) {
    check(`解析 ${sp}`, typeof p === 'string' && !p.startsWith('ERR:') && existsSync(p), String(p))
  }
  check(
    'import(包名/tools) 成功且 name = <包名>/tools',
    out.tools.name === MERGED_PACKAGE_NAME + '/tools' && out.tools.apply === 'function',
    JSON.stringify(out.tools),
  )
  check('import(包名/deck) 的 apply 可用', out.deck.apply === 'function', String(out.deck.apply))
  check(
    '包内 ./client 与仓库 dist/client.js 是同一份字节（组合行为由 client-union.test.mjs 在同一字节上验）',
    existsSync(out.client.resolved) &&
      readFileSync(out.client.resolved).equals(readFileSync(DIST_CLIENT)),
  )
}

section('5. dist/client.js 合并形态（两半都在 + 功能栏注册把手不丢）')
const clientText = readFileSync(join(pkgDir, 'dist/client.js'), 'utf8')
check('全文只有一个模块装载点', countOccurrences(clientText, MODULE_LOADER_MARKER) === 1)
{
  const at = clientText.indexOf(MODULE_LOADER_MARKER)
  const id = at >= 0 ? (/id:\s*'([^']+)'/.exec(clientText.slice(at)) || [])[1] : null
  check('load({id}) = 合并身份', id === MERGED_PACKAGE_NAME, String(id))
}
check('inject 并集字面量逐项含 MERGED_CLIENT_INJECT', MERGED_CLIENT_INJECT.every((s) => clientText.includes(`'${s}'`)))
// 槽位 id 由运行时身份常量派生（构建期注入），所以只钉 order 与派生的那一写法。
check('dock 注册把手（id=身份常量 / order 40）仍在', clientText.includes('id: DSW_IDENTITY, order: 40') || clientText.includes("id: 'dsh-github-resident-v2', order: 40"))
check('旧 Deck 模块 id 没有残留', !clientText.includes(`${MODULE_LOADER_MARKER}{\n  id: 'dsh-mattpocock-skills-deck',`))
for (const marker of [
  'github-repo-registry',
  'github-resident',
  'dsws-capsule',
  'conversation.input.dock',
  'sidebar.right.pane.tab',
  'tool.view.cordis',
]) {
  check(`客户端含两半特征：${marker}`, clientText.includes(marker))
}

section('6. 导入图完整性（相对/动态字面量导入都要落在包内）')
const HOST_OPTIONAL = new Set(['react', 'react-dom', 'electron'])
const RUNTIME_DEPS = new Set(Object.keys(pkg.dependencies || {}))
for (const [label, rel] of [
  ['dist/host.js', 'dist/host.js'],
  ['deck/src/host/index.js', 'deck/src/host/index.js'],
  ['deck/src/host/platform/deckToolsRow.js', 'deck/src/host/platform/deckToolsRow.js'],
]) {
  const abs = join(pkgDir, rel)
  const g = walkRelativeGraph(abs)
  check(`${label} 相对导入全部命中包内`, g.missing.length === 0, g.missing.slice(0, 4).join(', '))
  check(`${label} 无 @deepseek-ai 框架引用`, g.framework.length === 0, g.framework.join(', '))
  const unknown = g.bare.filter((s) => !RUNTIME_DEPS.has(s) && !HOST_OPTIONAL.has(s))
  check(`${label} 裸导入都在运行时依赖或显式可选集里`, unknown.length === 0, unknown.join(', '))
  console.log(
    `        （${label}：走查 ${g.files.length} 个文件；计算型动态 import ${computedImportCount(readFileSync(abs, 'utf8'))} 处）`,
  )
}
const hostText = readFileSync(join(pkgDir, 'dist/host.js'), 'utf8')
check(
  'dist/host.js 静态导入只剩 node: 内建',
  staticSpecifiers(hostText).every((s) => s.startsWith('node:')),
  JSON.stringify([...new Set(staticSpecifiers(hostText))]),
)

section('7. 隔离：包内任何文件都不指向作者态仓库路径')
const leaked = []
for (const rel of listRelFiles(pkgDir)) {
  if (!/\.(js|mjs|cjs|json|yml|yaml|md|ts)$/.test(rel)) continue
  const text = readFileSync(join(pkgDir, rel), 'utf8')
  if (text.includes(REPO_ROOT)) leaked.push(rel)
}
check('没有文件写死作者态仓库根路径', leaked.length === 0, leaked.slice(0, 5).join(', '))

finish()
