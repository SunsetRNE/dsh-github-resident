/**
 * tests/merge/host/packaging-resolvable.test.mjs —— 「打包解压后还装得起来」的机器判据（任务 H · 交付物 1/2）。
 *
 * 为什么需要它：合并包把两套原本各自成包的东西塞进**一个**包的目录树里，
 * 而根 `package.json` 的 `files` 白名单是**唯一**决定「发布/打包后哪些文件还在」的东西。
 * 少一条白名单的症状全部是**静默**的：
 *   - 缺 `plugin.js` → dist/host.js 动态导入半边失败 → 17 个 gh_* 全没；
 *   - 缺 `deck/package/shared/` → `./tools` 行模块的 `../../shared/...` 解析不到 → 9 个 deck_* + 探针全没；
 *   - 缺 `deck/src/` → 宿主半边（源码形态随包发布）起不来；
 *   - 缺 `deck/package/bundled-skills/` → 27 个技能与 skillDoc 全空。
 * 目录直装（file: 依赖）通常不受 files 约束，所以这个洞在开发机上永远看不出来 —— 只有出 tarball 才炸。
 *
 * 做法：从「入口模块」出发，按相对 import 走一遍**静态闭包**，逐个断言每个落点都被 files 覆盖；
 * 再对 dist/host.js 的动态导入目标做同样断言（它们在 host-assembly.ts 里是常量，可直接读）。
 *
 * 只读检查：不写盘、不联网、不起进程。
 *
 * 用法：node tests/merge/host/packaging-resolvable.test.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative, sep } from 'node:path'
import { REPO_ROOT, check, importRel, note, readJson, readText, section, skip, summary } from './_check.mjs'

const pkg = readJson('package.json')
const files = pkg.files || []
/** npm 无论 files 怎么写都会随包发布的那几个（package.json / README / LICENSE）。 */
const ALWAYS_PUBLISHED = new Set(['package.json', 'README.md', 'README.en.md', 'LICENSE', 'LICENCE'])

section('1) files 白名单的形状')
check(Array.isArray(files) && files.length > 0, 'package.json 声明了 files 白名单（' + files.length + ' 条）')
check(files.includes('cordis.patch.yml'), 'files 含 cordis.patch.yml（bundle patch 要在包里）')
check(typeof pkg.exports['./cordis.patch.yml'] === 'string' && files.includes('cordis.patch.yml'), 'exports["./cordis.patch.yml"] 指向的文件在 files 里')

/** 把 files 条目当白名单判断一个仓库相对路径是否会被发布（支持 `dir/` 前缀与 `*` 通配）。 */
function coveredByFiles(relPosixPath) {
  if (ALWAYS_PUBLISHED.has(relPosixPath)) return true
  for (const entry of files) {
    if (entry.endsWith('/')) {
      if (relPosixPath === entry.slice(0, -1) || relPosixPath.startsWith(entry)) return true
      continue
    }
    if (entry.includes('*')) {
      const rx = new RegExp('^' + entry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$')
      if (rx.test(relPosixPath)) return true
      continue
    }
    if (relPosixPath === entry) return true
  }
  return false
}

function toRel(abs) {
  return relative(REPO_ROOT, abs).split(sep).join('/')
}

/** 从入口文件出发，走一遍相对 import 的静态闭包；返回 { files: [rel], missing: [rel], external: [spec] }。 */
function staticClosure(entryRel) {
  const visited = new Set()
  const queue = [entryRel]
  const missing = []
  const external = new Set()
  while (queue.length) {
    const rel = queue.shift()
    if (visited.has(rel)) continue
    visited.add(rel)
    let text = null
    try {
      text = readFileSync(join(REPO_ROOT, rel), 'utf8')
    } catch {
      missing.push(rel)
      continue
    }
    const specs = []
    // 只认真正的导入语句：`from '...'`（要空白分隔，免得把 `['from', 'to']` 这种字面量当导入）、
    // `import '...'`（副作用导入）、`import('...')`（动态导入）。注释先剥掉，注释里的路径不算依赖。
    const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const re = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g
    let m
    while ((m = re.exec(code))) specs.push(m[1])
    for (const spec of specs) {
      if (spec.startsWith('node:')) continue
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        external.add(spec)
        continue
      }
      const resolvedRel = toRel(normalize(join(REPO_ROOT, dirname(rel), spec)))
      queue.push(resolvedRel)
    }
  }
  return { files: [...visited].sort(), missing, external: [...external].sort() }
}

section('2) ./tools 行模块：清单路径 = 真源常量，且它的静态闭包都在 files 里')
const identity = await importRel('tools/merge/merge-identity.ts')
const toolsExport = String(pkg.exports['./tools']).replace(/^\.\//, '')
const SOURCE_ROW = 'deck/src/host/platform/deckToolsRow.js'
const BUILT_ROW = 'deck/package/lib/platform/deckToolsRow.js'
check(typeof toolsExport === 'string' && toolsExport.endsWith('/platform/deckToolsRow.js'), 'exports["./tools"] 指向行模块 deckToolsRow.js（实际 ' + toolsExport + '）')
check(toolsExport === SOURCE_ROW || toolsExport === BUILT_ROW, 'exports["./tools"] 落在两个已知位置之一（源码行 / 构建产物行）')
if (toolsExport === SOURCE_ROW || toolsExport === BUILT_ROW) {
  const rowAbs = join(REPO_ROOT, toolsExport)
  if (!existsSync(rowAbs)) {
    skip('行模块落点 ' + toolsExport + ' 现在不存在（构建产物，先跑 deck 构建）')
  } else {
    // 关键一致性：到底发哪一份，必须清单与真源说同一句话，否则「产物比对」与「谁被装载」分岔。
    check(toolsExport === identity.DECK_TOOLS_ROW_SOURCE, './tools 的清单值与真源 DECK_TOOLS_ROW_SOURCE 一致（真源=' + identity.DECK_TOOLS_ROW_SOURCE + '，清单=' + toolsExport + '）')
    const closure = staticClosure(toolsExport)
    check(closure.missing.length === 0, '行模块的相对 import 闭包全部存在（缺 ' + JSON.stringify(closure.missing) + '）')
    const notPublished = closure.files.filter((rel) => !coveredByFiles(rel))
    check(notPublished.length === 0, '行模块静态闭包每个文件都被 files 覆盖（漏发 ' + JSON.stringify(notPublished) + '）')
    note('行模块静态闭包 ' + closure.files.length + ' 个文件；外部依赖：' + closure.external.join(',') + '（框架不代装，属预期）')
    check(closure.external.length === 0, '行模块静态闭包零框架引用（外部依赖一个都没有）')
  }
}

section('3) dist/host.js 的两个半边：必须在 files 里能被解析到')
const hostAssemblySrc = readText('tools/merge/host-assembly.ts')
check(hostAssemblySrc.includes("const RESIDENT_HALF_REL = 'plugin.js'"), '装配层的 Resident 半边路径常量 = plugin.js')
check(hostAssemblySrc.includes("join('deck', 'src', 'host', 'index.js')"), '装配层的 Deck 半边路径常量 = deck/src/host/index.js')
check(coveredByFiles('plugin.js'), 'files 覆盖 plugin.js（否则 dist/host.js 导不到 Resident 半边，17 个 gh_* 全没）')
check(coveredByFiles('deck/src/host/index.js'), 'files 覆盖 deck/src/host/index.js（Deck 半边按源码形态随包发布）')
check(coveredByFiles('deck/src/host/bootstrap.js') && coveredByFiles('deck/src/host/skillDoc.js'), 'files 覆盖 bootstrap.js / skillDoc.js（技能发现与 readDoc 的实现）')

section('4) 27 个技能与行模块的随包目录')
check(coveredByFiles('deck/package/bundled-skills/VERSION'), 'files 覆盖 deck/package/bundled-skills/（27 个技能随包）')
check(coveredByFiles('deck/package/bundled-skills/wayfinder/SKILL.md'), '单个技能文件也在覆盖范围内')

section('5) exports 的每个落点都在 files 里')
for (const [key, target] of Object.entries(pkg.exports)) {
  if (typeof target !== 'string') continue
  if (target.includes('*')) {
    check(coveredByFiles('locale/en.json'), 'exports ' + key + ' 的 glob 落点有文件可覆盖')
    continue
  }
  const rel = target.replace(/^\.\//, '')
  check(coveredByFiles(rel), 'exports ' + key + ' → ' + rel + ' 被 files 覆盖')
}

summary()
