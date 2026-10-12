/**
 * tests/merge/build/manifest-contract.test.mjs —— 根清单与「随包依赖是否够用」的契约
 *
 * 这一份管的是**声明与实际使用对得上**：
 *   - 身份三处逐字一致（package.json / cordis.patch.yml / dist/client.js 的 load id）；
 *   - exports 面与 files 白名单覆盖运行期真正要读到的路径；
 *   - 运行时依赖 = 随包源码里真正 import 到的第三方包（含动态 import 的字面量）；
 *     不靠「静态 grep 一把梭」删依赖，也不留下已经没人用的依赖；
 *   - engines 说清 dsh 最低版本与 Node 真实支持版本；
 *   - 两条既有检查链（verify:resident / verify:deck）都还在。
 *
 * 用法：node tests/merge/build/manifest-contract.test.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { MERGED_CLIENT_INJECT, MERGED_PACKAGE_NAME, MODULE_LOADER_MARKER } from '../../../tools/merge/merge-identity.ts'
import { REPO_ROOT, check, existsSync, finish, readJson, section, staticSpecifiers } from './_lib.mjs'

const requireFromRepo = createRequire(join(REPO_ROOT, 'package.json'))
const pkg = readJson(join(REPO_ROOT, 'package.json'))
const patch = readFileSync(join(REPO_ROOT, 'cordis.patch.yml'), 'utf8')

section('1. 身份三处逐字一致')
check('package.json name = 合并身份', pkg.name === MERGED_PACKAGE_NAME, pkg.name)
const patchNames = [...patch.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1])
check('cordis.patch.yml 主行 name = 合并身份', patchNames[0] === MERGED_PACKAGE_NAME, patchNames[0])
check(
  'cordis.patch.yml 行模块 name = <包名>/tools（与 exports["./tools"] 同一条子路径行）',
  patchNames.includes(MERGED_PACKAGE_NAME + '/tools'),
  JSON.stringify(patchNames),
)
const distClient = join(REPO_ROOT, 'dist/client.js')
if (existsSync(distClient)) {
  const text = readFileSync(distClient, 'utf8')
  const at = text.indexOf(MODULE_LOADER_MARKER)
  const id = at >= 0 ? (/id:\s*'([^']+)'/.exec(text.slice(at)) || [])[1] : null
  check('dist/client.js 的 load({id}) = 合并身份', id === MERGED_PACKAGE_NAME, id || '(未找到 load 声明)')
} else {
  console.log('  SKIP  dist/client.js 未构建（先 npm run build）')
}

section('2. exports 面与 files 白名单')
const expectedExports = {
  '.': './dist/host.js',
  './client': './dist/client.js',
  './tools': './deck/src/host/platform/deckToolsRow.js',
  './deck': './deck/src/host/index.js',
  './cordis.patch.yml': './cordis.patch.yml',
  './package.json': './package.json',
  './locale/*.json': './locale/*.json',
}
for (const [k, v] of Object.entries(expectedExports)) {
  check(`exports["${k}"] = ${v}`, pkg.exports[k] === v, String(pkg.exports[k]))
}
const files = pkg.files || []
/** files 里的一条模式是否覆盖某个包内相对路径（只认简单目录前缀与 * 通配）。 */
function coveredByFiles(rel) {
  return files.some((f) => {
    const clean = f.replace(/\/$/, '')
    if (clean === rel) return true
    if (rel.startsWith(clean + '/')) return true
    if (clean.includes('*')) {
      const re = new RegExp('^' + clean.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$')
      if (re.test(rel)) return true
    }
    return false
  })
}
for (const rel of ['plugin.js', 'dist/host.js', 'dist/client.js', 'bundled-skills/VERSION', 'deck/src/host/index.js', 'deck/src/host/platform/deckToolsRow.js', 'cordis.patch.yml', 'locale/en.json']) {
  check(`files 白名单覆盖 ${rel}`, coveredByFiles(rel), JSON.stringify(files))
}

section('3. 运行时依赖 = 随包源码真正用到的第三方包')
const shippedTrees = [
  join(REPO_ROOT, 'plugin.js'),
  join(REPO_ROOT, 'client.js'),
  join(REPO_ROOT, 'deck/src'),
]
function collectShipped(dir) {
  const out = []
  const walk = (p) => {
    const st = statSync(p)
    if (st.isFile()) {
      if (/\.(js|mjs|cjs|ts)$/.test(p) && !p.endsWith('.d.ts')) out.push(p)
      return
    }
    for (const e of readdirSync(p, { withFileTypes: true })) walk(join(p, e.name))
  }
  walk(dir)
  return out
}
const shippedFiles = shippedTrees.flatMap((p) => (statSync(p).isFile() ? [p] : collectShipped(p)))
const bareUsage = new Map()
for (const file of shippedFiles) {
  for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
    if (spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('data:')) continue
    const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    if (!bareUsage.has(root)) bareUsage.set(root, new Set())
    bareUsage.get(root).add(file.slice(REPO_ROOT.length + 1))
  }
}
// 这三类由宿主按运行时环境提供（浏览器 require / Electron / 平台可选），不是 npm 依赖
const HOST_PROVIDED = new Set(['react', 'react-dom', 'electron'])
const runtimeDeps = Object.keys(pkg.dependencies || {})
const missingDeps = [...bareUsage.keys()].filter((d) => !HOST_PROVIDED.has(d) && !runtimeDeps.includes(d))
check('随包源码用到的第三方包都在 dependencies 里', missingDeps.length === 0, missingDeps.join(', '))
const unusedDeps = runtimeDeps.filter((d) => !bareUsage.has(d))
check('dependencies 里没有已经没人 import 的包', unusedDeps.length === 0, unusedDeps.join(', '))
check('ws 不再作为直接依赖（实测随包源码零引用）', !runtimeDeps.includes('ws') && !Object.keys(pkg.devDependencies || {}).includes('ws'))
check(
  'dsh-log 是构建期依赖（devDependencies），不是运行时依赖',
  Object.keys(pkg.devDependencies || {}).includes('dsh-log') && !runtimeDeps.includes('dsh-log'),
)
check(
  'yaml / dsh-plugin-update 在运行时依赖里（deck/src/host 会 import 它们）',
  runtimeDeps.includes('yaml') && runtimeDeps.includes('dsh-plugin-update'),
)
for (const [dep, users] of bareUsage) {
  if (HOST_PROVIDED.has(dep)) continue
  console.log(`        （${dep} ← ${[...users].slice(0, 3).join(', ')}${users.size > 3 ? ` 等 ${users.size} 处` : ''}）`)
}

section('4. SDK devDependency 与 engines')
const sdkSpec = (pkg.devDependencies || {})['@deepseek-ai/dsh-tools']
check('@deepseek-ai/dsh-tools 在 devDependencies（只给门禁/测试用，不进运行时依赖）', !!sdkSpec, String(sdkSpec))
check('@deepseek-ai/dsh-tools 不再是旧版 0.1.7-rc.2', sdkSpec !== '0.1.7-rc.2', String(sdkSpec))
try {
  const installedSdk = requireFromRepo('@deepseek-ai/dsh-tools/package.json').version
  check('@deepseek-ai/dsh-tools 声明与已装版本一致', sdkSpec === installedSdk, `声明 ${sdkSpec} / 已装 ${installedSdk}`)
} catch {
  console.log('  SKIP  本仓未装 @deepseek-ai/dsh-tools，无法比对已装版本')
}
check('engines.node 说清真实支持版本（原生 TS 擦除需要 >=22.18）', /^>=22\.18/.test(String(pkg.engines?.node || '')), String(pkg.engines?.node))
const dshEngine = String(pkg.engines?.dsh || '')
check('engines.dsh 声明了最低 dsh 版本', /^>=\d+\.\d+\.\d+/.test(dshEngine), dshEngine || '(缺失)')
const minDsh = dshEngine.replace(/^>=/, '')
const [maj, min] = minDsh.split('.').map((n) => parseInt(n, 10))
check('engines.dsh 与合并骨架的宿主契约相符（>=0.2.0-rc.2）', maj > 0 || min >= 2, dshEngine)

section('5. 生命周期：不假装 nested prepare，不改全局配置')
check('根 package.json 没有 prepare（安装不顺手构建，构建一律显式跑）', !(pkg.scripts || {}).prepare)
check('根 package.json 没有把 deck 当 workspace 依赖', !(pkg.dependencies || {}).deck && !(pkg.devDependencies || {}).deck)
const wsYaml = join(REPO_ROOT, 'pnpm-workspace.yaml')
check('pnpm-workspace.yaml 存在（pnpm 10 的安装设置都放这里，不写全局配置）', existsSync(wsYaml))
if (existsSync(wsYaml)) {
  const y = readFileSync(wsYaml, 'utf8')
  check('pnpm-workspace.yaml 的 packages 不含 deck（否则安装会自动触发 deck 的 prepare）', !/^\s*-\s*['"]?deck/m.test(y), y.split('\n').filter((l) => /deck/.test(l)).join(' | '))
  check(
    'pnpm-workspace.yaml 保留 packageImportMethod: copy（PRoot 下硬链接会把原生 tsc 的 /proc/self/exe 指向 /.l2s，删掉它构建就红）',
    /^\s*packageImportMethod:\s*copy\s*$/m.test(y),
  )
}

section('6. 两条既有检查链都还在（不删门禁）')
check('scripts.verify:resident 仍在', typeof pkg.scripts['verify:resident'] === 'string')
check('scripts.verify:deck 仍在（deck 237 条链）', typeof pkg.scripts['verify:deck'] === 'string')
check('scripts.verify:merge 指向本 runner', pkg.scripts['verify:merge'] === 'node tests/merge/run.mjs', String(pkg.scripts['verify:merge']))
check('scripts.build 仍是 --build-all（先 deck 后入口）', pkg.scripts.build === 'node tools/merge/build-merge-entries.ts --build-all', String(pkg.scripts.build))
check('scripts.build:deck 仍在', pkg.scripts['build:deck'] === 'node deck/scripts/build.mjs', String(pkg.scripts['build:deck']))
for (const s of ['verify-logout.mjs', 'verify-registry.mjs', 'verify-ui.mjs', 'verify-gh-bootstrap.mjs', 'verify-update-gc.mjs', 'verify-real-artifact.mjs']) {
  check(`verify:resident 仍包含 ${s}`, pkg.scripts['verify:resident'].includes(s))
}

section('7. 已知的入库阻塞（如实报，不改别人的文件）')
try {
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync('git', ['check-ignore', '-v', 'deck/package.json'], { cwd: REPO_ROOT, encoding: 'utf8' })
  const ignored = r.status === 0
  if (ignored) {
    console.log(
      '  WARN  deck/package.json 被 deck/.gitignore 的 `/package.json` 规则忽略（' +
        r.stdout.trim() +
        '）。它是 deck 构建/门禁的读取对象，必须入库；本文件不在构建负责人的写范围内，' +
        '请集成人用 `git add -f deck/package.json`（或删掉 deck/.gitignore 第 27 行）后再提交 deck/。',
    )
  } else {
    check('deck/package.json 可被 git 收录', true)
  }
} catch {
  console.log('  SKIP  git 不可用，跳过 deck/package.json 入库性检查')
}

finish()
