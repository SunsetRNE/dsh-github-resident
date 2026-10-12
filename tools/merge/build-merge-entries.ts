/**
 * tools/merge/build-merge-entries.ts —— 合并包「入口产物」的构建与校验（**不是** deck 构建的替代品）
 *
 * 职责边界（改这个文件的人先读）：
 *   - **不**负责 deck 的 `src/**` → `deck/package/lib/**` 派生。那是 `deck/scripts/build.mjs` 的活，
 *     本脚本只在 `--build-all` 时先把它跑一遍；
 *   - **不**负责 Resident 半边：那是仓库根的 `plugin.js`（宿主）与 `client.js`（客户端）原样发布文件，
 *     本脚本一个字都不改；
 *   - 只做四件事：
 *       1) 把作者态的 [`./host-assembly.ts`](./host-assembly.ts) 用 esbuild 擦类型，产出 `dist/host.js`，
 *          并**在构建期**断言它只依赖 node 内建模块（见下「为什么断言」）；
 *       2) 把 **两份真实输入**（`deck/package/lib/client.js` + 根 `client.js`）交给
 *          [`./rewrite-deck-client.ts`](./rewrite-deck-client.ts) 装配成**一个** `dist/client.js`；
 *       3) 把 `deck/package/bundled-skills/` 逐字复制到**包根** `bundled-skills/`
 *          （合并后宿主按 `<包名>/bundled-skills` 找随包技能，见 merge-identity.ts 的说明）；
 *       4) `--check` 只读比对：产物与本次重算结果逐字一致，且技能副本与源一致。
 *
 * 为什么宿主产物要断言「只有 node: 内建依赖」（A 项验收，2026-10-11 实测）：
 *   `dist/host.js` 与作者态 `tools/merge/host-assembly.ts` **不在同一层目录**。作者态写的
 *   `'../../plugin.js'`、`'./merge-identity.ts'` 这类相对说明符一旦被原样带进 `dist/`，
 *   就会被解析成 `<repo>/../plugin.js` 与 `dist/merge-identity.ts`（不存在）——产物一装载就死，
 *   死状还是「工具全没了」这种查不出原因的样子。现在作者态改用 `import.meta.url` 向上找包根
 *   （host-assembly.ts 里有详细说明），所以**唯一**还允许的导入形式是 `node:` 内建。
 *   这条断言把「相对路径被重新写进产物」变成构建期红，而不是装机后的静默失效。
 *
 * 用法：
 *   node tools/merge/build-merge-entries.ts            生成入口产物与技能副本
 *   node tools/merge/build-merge-entries.ts --check    只校验现有产物与预期一致（不改盘）
 *   node tools/merge/build-merge-entries.ts --build-all  先跑 deck 构建，再生成入口产物
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  BUNDLED_SKILLS_EXPECTED,
  BUNDLED_SKILLS_OUT,
  BUNDLED_SKILLS_SRC,
  DECK_CLIENT_SRC,
  MERGED_CLIENT_OUT,
  MERGED_HOST_INJECT,
  MERGED_HOST_OUT,
  MERGED_HOST_SRC,
  MERGED_PACKAGE_NAME,
  MERGED_VERSION_LITERAL,
  MODULE_LOADER_MARKER,
  RESIDENT_CLIENT_SRC,
} from './merge-identity.ts'
import { DOCK_SLOT_ANCHOR, rewriteDeckClient } from './rewrite-deck-client.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')

const HOST_BANNER =
  '// 构建产物，不要手改。作者态真源：tools/merge/host-assembly.ts\n' +
  '// 重新生成：node tools/merge/build-merge-entries.ts\n'

const argv = process.argv.slice(2)
const CHECK_ONLY = argv.includes('--check')
const BUILD_ALL = argv.includes('--build-all')

let failures = 0
function fail(message: string): void {
  failures += 1
  console.error('FAIL  ' + message)
}
function note(message: string): void {
  console.log('      ' + message)
}

/** 先跑 deck 自己的构建。失败即整脚本失败——入口产物绝不允许在旧 lib 上生成。 */
function runDeckBuild(): void {
  const script = join(REPO_ROOT, 'deck', 'scripts', 'build.mjs')
  if (!existsSync(script)) {
    fail('找不到 deck 构建脚本：' + script)
    return
  }
  note('先跑 deck 构建：node deck/scripts/build.mjs')
  const r = spawnSync(process.execPath, [script], { cwd: join(REPO_ROOT, 'deck'), stdio: 'inherit' })
  if (r.error) fail('deck 构建起不来：' + String(r.error.message || r.error))
  else if (r.status !== 0) fail('deck 构建退出码 ' + r.status)
}

/**
 * 收集 ESM 静态/动态导入的说明符（只认字面量，且锚定在语句位置）。
 * 不用一个宽松的 `from '…'` 正则：注释与提示词文本里会假命中，凭空造出「非法导入」把构建打红。
 */
function importSpecifiers(code: string): string[] {
  const out: string[] = []
  const patterns = [
    /^[ \t]*(?:import|export)\b[^\n]*?\bfrom[ \t]*(['"])([^'"\n]+)\1/gm,
    /^[ \t]*\}?[ \t]*from[ \t]*(['"])([^'"\n]+)\1/gm,
    /^[ \t]*import[ \t]*(['"])([^'"\n]+)\1[ \t]*;?[ \t]*$/gm,
    /\bimport[ \t]*\([ \t]*(['"])([^'"\n]+)\1[ \t]*\)/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) out.push(m[2])
  }
  return out
}

/**
 * esbuild 从本仓自己的 node_modules 解析，不依赖 PATH 里的 bin。
 *
 * `bundle: false`：只擦类型、不改写模块图。这样 `plugin.js`（127 KB）与
 * `deck/src/host/index.js` 的实现各自留在原地，`dist/host.js` 里只剩装配层本身。
 * 代价是**必须**自己把住「产物里不许出现相对说明符」这条（assetHostImportSafety）。
 */
async function transpileHost(): Promise<string> {
  const require = createRequire(join(REPO_ROOT, 'package.json'))
  let esbuildPath: string
  try {
    esbuildPath = require.resolve('esbuild')
  } catch {
    throw new Error(
      '解析不到 esbuild（devDependency）。请先在仓库根运行 pnpm install —— ' +
        '本脚本刻意不做 fallback：用别处的 esbuild 会让产物不可复现。',
    )
  }
  const esbuild = (await import(esbuildPath)) as {
    build: (options: Record<string, unknown>) => Promise<{ outputFiles?: Array<{ text: string }> }>
  }
  const result = await esbuild.build({
    entryPoints: [join(REPO_ROOT, MERGED_HOST_SRC)],
    bundle: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    logLevel: 'silent',
  })
  const file = result.outputFiles && result.outputFiles[0]
  if (!file) throw new Error('esbuild 没有产出内容')
  return file.text
}

/**
 * 收集模块的导出名，兼容两种 esbuild 写法：
 *   - 行内：`export const name = ...` / `export function apply(...)`
 *   - 尾部子句：`export { apply, inject, name };`（bundle:false 时 esbuild 常用这种）
 * 只看静态文本，不执行产物（产物顶部有 top-level await 会去真加载两半）。
 */
function exportedNames(code: string): Set<string> {
  const names = new Set<string>()
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1])
  }
  const clause = /(^|\n)\s*export\s*\{([\s\S]*?)\}/.exec(code)
  if (clause) {
    for (const part of clause[2].split(',')) {
      const t = part.trim().replace(/\s+/g, ' ')
      if (t === '') continue
      const m = /^(?:([A-Za-z_$][\w$]*)\s+as\s+)?([A-Za-z_$][\w$]*)$/.exec(t)
      if (m) names.add(m[2])
    }
  }
  return names
}

/**
 * 宿主产物装载安全性（A 项）：
 *   1. 每个导入说明符都必须是 `node:` 内建——产物要能被移到 `dist/`（乃至解压后的包）里照样装载；
 *   2. 导出形态必须是具名 `name` / `inject` / `apply`，且 `inject` 与真源常量逐项（含顺序）一致；
 *   3. 不许出现 `default` 导出（加载器会把具名命名空间与 default 当两个插件对象，同一套注册挂两次）。
 */
function assertHostImportSafety(code: string): void {
  const bad = importSpecifiers(code).filter((s) => !s.startsWith('node:'))
  if (bad.length) {
    fail(
      'dist/host.js 里出现了非 node 内建的导入说明符：' +
        JSON.stringify([...new Set(bad)]) +
        '。产物位于 dist/，相对说明符会指向错误目录（作者态写法见 tools/merge/host-assembly.ts 顶部注释）。',
    )
  }
  if (/\bexport\s+default\b/.test(code) || /\bas\s+default\b/.test(code)) {
    fail('dist/host.js 出现了 default 导出：加载器会把它与具名导出当两个插件对象，同一套注册会挂两次')
  }
  const names = exportedNames(code)
  for (const want of ['name', 'inject', 'apply']) {
    if (!names.has(want)) fail(`dist/host.js 没有导出 ${want}（宿主插件契约：name / inject / apply 三者都要）`)
  }
  const injectMatch = /(^|\n)\s*(?:export\s+)?const\s+inject\s*=\s*\[([\s\S]*?)\]/.exec(code)
  if (!injectMatch) {
    fail('dist/host.js 里找不到 `const inject = [...]` 字面量（Cordis 在 apply 之前读它，必须是静态字面量）')
  } else {
    const got = [...injectMatch[2].matchAll(/(['"])([^'"]+)\1/g)].map((m) => m[2])
    const want = [...MERGED_HOST_INJECT]
    if (got.length !== want.length || got.some((s, i) => s !== want[i])) {
      fail(
        'dist/host.js 的 inject 与真源不一致：产物 ' +
          JSON.stringify(got) +
          '，真源 ' +
          JSON.stringify(want) +
          '（真源：tools/merge/merge-identity.ts）',
      )
    }
  }
}

/** 收集随包技能目录（含 SKILL.md 的子目录），并做基本自洽检查。 */
function collectSkillDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

function assertSkillsSource(dir: string): string[] {
  if (!existsSync(dir)) {
    fail('找不到随包技能源目录：' + dir)
    return []
  }
  const dirs = collectSkillDirs(dir)
  if (dirs.length !== BUNDLED_SKILLS_EXPECTED) {
    fail(
      `随包技能目录数 ${dirs.length}，期望 ${BUNDLED_SKILLS_EXPECTED}（源：${BUNDLED_SKILLS_SRC}）`,
    )
  }
  for (const name of dirs) {
    if (!existsSync(join(dir, name, 'SKILL.md'))) fail(`技能 ${name} 缺 SKILL.md`)
  }
  for (const f of ['VERSION', 'LICENSE']) {
    if (!existsSync(join(dir, f))) fail(`随包技能缺 ${f}（技能发现与许可校验都要它）`)
  }
  return dirs
}

/** 列出目录下所有文件的相对路径（升序），用于逐字比对。 */
function listFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...listFiles(abs, base))
    else if (ent.isFile()) out.push(abs.slice(base.length + 1).split(sep).join('/'))
  }
  return out.sort()
}

/** 目标目录的绝对路径守卫：只允许删本仓包根的 bundled-skills。 */
function assertSafeSkillsOut(dest: string): void {
  const expected = join(REPO_ROOT, BUNDLED_SKILLS_OUT)
  if (dest !== expected) {
    throw new Error('内部错误：技能目标目录不是 ' + expected + '（实际 ' + dest + '）')
  }
  if (!dest.startsWith(REPO_ROOT + sep) || dest === REPO_ROOT) {
    throw new Error('拒绝清理仓库根之外的路径：' + dest)
  }
}

/**
 * 把 deck 快照里的随包技能复制到包根（合并后宿主按 <包名>/bundled-skills 找它）。
 * check 模式下只做逐字比对，绝不写盘。
 */
function syncBundledSkills(mode: 'write' | 'check'): void {
  const src = join(REPO_ROOT, BUNDLED_SKILLS_SRC)
  const dest = join(REPO_ROOT, BUNDLED_SKILLS_OUT)
  if (assertSkillsSource(src).length === 0) return

  if (mode === 'write') {
    assertSafeSkillsOut(dest)
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    cpSync(src, dest, { recursive: true, force: true })
    const dirs = collectSkillDirs(dest)
    if (dirs.length !== BUNDLED_SKILLS_EXPECTED) {
      fail(`复制后 ${BUNDLED_SKILLS_OUT}/ 只有 ${dirs.length} 个技能目录，期望 ${BUNDLED_SKILLS_EXPECTED}`)
      return
    }
    note(`已同步随包技能：${BUNDLED_SKILLS_SRC} → ${BUNDLED_SKILLS_OUT}/（${dirs.length} 个）`)
    return
  }

  if (!existsSync(dest)) {
    fail(`${BUNDLED_SKILLS_OUT}/ 不存在：先运行 npm run build（随包技能要落在包根，宿主才找得到）`)
    return
  }
  const srcFiles = listFiles(src)
  const destFiles = listFiles(dest)
  if (srcFiles.length !== destFiles.length || srcFiles.some((f, i) => f !== destFiles[i])) {
    fail(`${BUNDLED_SKILLS_OUT}/ 与 ${BUNDLED_SKILLS_SRC}/ 的文件清单不一致：先运行 npm run build`)
    return
  }
  for (const rel of srcFiles) {
    const a = readFileSync(join(src, rel))
    const b = readFileSync(join(dest, rel))
    if (!a.equals(b)) {
      fail(`${BUNDLED_SKILLS_OUT}/${rel} 与源不一致：先运行 npm run build`)
      return
    }
  }
  note(`随包技能副本与源逐字一致（${collectSkillDirs(dest).length} 个 / ${srcFiles.length} 个文件）`)
}

/** 装配客户端：**两份真实输入**都必传，装配层会拒绝半边缺失/锚点漂移。 */
function buildClientSource(): string {
  const deckPath = join(REPO_ROOT, DECK_CLIENT_SRC)
  const residentPath = join(REPO_ROOT, RESIDENT_CLIENT_SRC)
  if (!existsSync(deckPath)) {
    throw new Error(
      '找不到 deck 客户端产物：' +
        deckPath +
        '（它是构建产物，不在版本库里。先运行 npm run build:deck 或 npm run build -- --build-all）',
    )
  }
  if (!existsSync(residentPath)) {
    throw new Error('找不到 Resident 客户端源码：' + residentPath + '（根 client.js 必须随包发布/参与构建）')
  }
  const result = rewriteDeckClient(readFileSync(deckPath, 'utf8'), readFileSync(residentPath, 'utf8'))
  note(
    `客户端装配：Deck ${result.deckInject.length} 项 + Resident ${result.residentInject.length} 项 inject；` +
      `合并 ${result.inject.length} 项；版本 v${result.version}（根 package.json）；` +
      `${result.bytesBefore} → ${result.bytesAfter} 字节`,
  )
  return result.text
}

function checkGenerated(
  path: string,
  expected: string | null,
  mustContain: readonly string[],
  label: string,
): string | null {
  if (!existsSync(path)) {
    fail(`${label} 不存在：${path}（先运行 npm run build）`)
    return null
  }
  const text = readFileSync(path, 'utf8')
  for (const needle of mustContain) {
    if (!text.includes(needle)) fail(`${label} 缺少特征：${JSON.stringify(needle)}`)
  }
  if (expected !== null && text !== expected) {
    fail(`${label} 与本次重算结果逐字不一致（先运行 npm run build:entries）`)
  }
  return text
}

async function main(): Promise<void> {
  if (BUILD_ALL) runDeckBuild()
  if (failures > 0) {
    console.error(`\nbuild-merge-entries: 前置失败 ${failures} 项，未生成入口产物。`)
    process.exit(1)
  }

  // ---------- dist/host.js ----------
  let hostSource: string | null = null
  try {
    hostSource = await transpileHost()
    assertHostImportSafety(hostSource)
  } catch (e) {
    hostSource = null
    fail('宿主入口转译失败：' + String((e as Error)?.message || e))
  }

  // ---------- dist/client.js ----------
  let clientSource: string | null = null
  try {
    clientSource = buildClientSource()
  } catch (e) {
    fail('客户端装配失败：' + String((e as Error)?.message || e))
  }

  if (CHECK_ONLY) {
    checkGenerated(
      join(REPO_ROOT, MERGED_HOST_OUT),
      hostSource === null ? null : HOST_BANNER + hostSource,
      [MERGED_HOST_SRC, MERGED_PACKAGE_NAME],
      MERGED_HOST_OUT,
    )
    checkGenerated(
      join(REPO_ROOT, MERGED_CLIENT_OUT),
      clientSource,
      [MODULE_LOADER_MARKER, MERGED_PACKAGE_NAME, DOCK_SLOT_ANCHOR, `const DSW_VERSION = ${MERGED_VERSION_LITERAL}`],
      MERGED_CLIENT_OUT,
    )
    syncBundledSkills('check')
    if (failures === 0) console.log('build-merge-entries --check: 全部一致')
    else process.exit(1)
    return
  }

  mkdirSync(join(REPO_ROOT, 'dist'), { recursive: true })
  if (hostSource !== null) {
    writeFileSync(join(REPO_ROOT, MERGED_HOST_OUT), HOST_BANNER + hostSource)
    note(`已生成 ${MERGED_HOST_OUT}（${hostSource.length} 字节）`)
  }
  if (clientSource !== null) {
    writeFileSync(join(REPO_ROOT, MERGED_CLIENT_OUT), clientSource)
    note(`已生成 ${MERGED_CLIENT_OUT}（${clientSource.length} 字节）`)
  }
  syncBundledSkills('write')

  if (failures > 0) {
    console.error(`\nbuild-merge-entries: 失败 ${failures} 项。`)
    process.exit(1)
  }
  console.log('build-merge-entries: 完成')
}

await main()
