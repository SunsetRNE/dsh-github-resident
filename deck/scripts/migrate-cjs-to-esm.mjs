#!/usr/bin/env node
/**
 * scripts/migrate-cjs-to-esm.mjs —— 把 deck 门禁树里的 CJS 写法机械改成 ESM（票「deck 门禁链 ESM/CJS 欠账」）。
 *
 * 口径（唯一一条，别在别处再定一份）：
 *   · 包根 package.json 是 `"type": "module"`，deck 子树没有自己的 package.json →
 *     deck/**.js 一律按 **ESM** 加载。迁移方向是「改成 ESM」，不是「改名 .cjs」，
 *     也不加第二份 package.json 边界（那会让 tests/ 里 113 个已写 ESM 的门禁整体翻面）。
 *   · 内建模块写 `node:` 前缀；`const x = require('m')` → `import x from 'm'`；
 *     `const { a } = require('m')` → `import { a } from 'm'`；语句中间的 `require('m')` →
 *     取一个不与本文件重名的命名空间别名 + `import * as <别名> from 'm'`（不靠猜形状）；
 *     `module.exports = {...}` 全简写键 → 具名导出（有消费方解构时）+ 默认导出；
 *     `__dirname`/`__filename` → `fileURLToPath(import.meta.url)` 现算。
 *   · 只有**字面量拿不到的** require 才留垫片：动态 `require(expr)` 与 `require.resolve()` →
 *     `createRequire(import.meta.url)`（与 tests/lib/eval-probe.js 既有先例同款），并在报告里点名。
 *   · 生成物（`client.js` / `host.js` / `package/lib/**`）与 `src/**` 不在本脚本口径内。
 *
 * 判据（改完必须成立）：`node scripts/gate-dialect-scan.mjs` 的「代码欠账」归零；
 *                       `node scripts/gate-chain-audit.mjs` 逐道能加载。
 *
 * 用法：
 *   node scripts/migrate-cjs-to-esm.mjs                 # 干跑：列出会改什么，不写盘
 *   node scripts/migrate-cjs-to-esm.mjs --apply         # 真改（原件先拷进 .tmp-esm-backup/）
 *   node scripts/migrate-cjs-to-esm.mjs --rollback      # 从备份还原
 *   node scripts/migrate-cjs-to-esm.mjs --only verify-423 [--apply]
 *   node scripts/migrate-cjs-to-esm.mjs --json
 * 退出码：0 = 干跑完成或已应用；1 = 还有需要人工的文件（干跑时列出）。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanDeck, DECK as DECK_DIR, maskSource } from './gate-dialect-scan.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const DECK = DECK_DIR
const BACKUP = path.join(DECK, '.tmp-esm-backup')
const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const asJson = argv.includes('--json')
const onlyIdx = argv.indexOf('--only')
const only = onlyIdx >= 0 && argv[onlyIdx + 1] ? argv[onlyIdx + 1] : ''

const BUILTINS = new Set(['assert', 'assert/strict', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'path/posix', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib'])
/** 只有具名导出、没有默认导出的依赖：用命名空间 import（esbuild 官方写法就是 import * as）。 */
const NAMESPACE_ONLY = new Set(['esbuild'])
const GENERATED = /^(client\.js|host\.js|package\/lib\/)/

const bareOf = (spec) => (spec.startsWith('node:') ? spec.slice(5) : spec)
const norm = (spec) => {
  if (spec.startsWith('.') || spec.startsWith('/')) return spec
  return BUILTINS.has(bareOf(spec)) ? 'node:' + bareOf(spec) : spec
}
const pascal = (s) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[a-z]/, (c) => c.toUpperCase())

function aliasFor(spec, taken) {
  const bare = bareOf(spec).replace(/^.*\//, (m) => m)
  let name = BUILTINS.has(bareOf(spec)) ? 'node' + pascal(bare) : pascal(bare) + 'Mod'
  if (spec.startsWith('.')) name = pascal(path.basename(spec).replace(/\.js$/, '')) + 'Mod'
  let out = name
  let i = 2
  while (taken.has(out)) out = name + i++
  return out
}

/** 一条语句被换成 import 时，如果同一行后面还有别的语句，必须补一个换行，否则两句会粘在一起。 */
function sepAfter(m, endIdx) {
  const ch = m[endIdx]
  return ch === undefined || ch === '\n' || ch === '\r' ? '' : '\n'
}

const braceDepthAt = (m, idx) => {  let depth = 0
  for (let i = 0; i < idx; i++) {
    if (m[i] === '{') depth++
    else if (m[i] === '}') depth--
  }
  return depth
}
/** 从 mask 里 `{` 的位置配平括号，返回原文本里的对象字面量。 */
function sliceBrace(src, m, openIdx) {
  let depth = 0
  for (let i = openIdx; i < m.length; i++) {
    if (m[i] === '{') depth++
    else if (m[i] === '}') { depth--; if (depth === 0) return src.slice(openIdx, i + 1) }
  }
  return null
}

/** 消费方形态：谁 require 了它、整体拿还是解构拿 —— 决定导出写成具名还是默认。 */
function consumerStyle(target, files) {
  const styles = new Set()
  const base = target.replace(/\.js$/, '')
  for (const f of files) {
    if (f === target) continue
    let s
    try { s = readFileSync(path.join(DECK, f), 'utf8') } catch { continue }
    const m = maskSource(s)
    const relFrom = ('./' + path.relative(path.dirname(f), base)).replace(/\\/g, '/')
    for (const hit of m.matchAll(/(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/dg)) {
      const spec = s.slice(hit.indices[2][0], hit.indices[2][1]).replace(/\.js$/, '')
      if (spec !== relFrom && spec !== './' + path.basename(base) && spec !== path.basename(base)) continue
      styles.add(hit[1].startsWith('{') ? 'named' : 'whole')
    }
  }
  return styles
}

/** 单个文件的改写：返回 { out, notes, manual, changed }。 */
export function rewriteFile(file, allFiles) {
  const src = readFileSync(path.join(DECK, file), 'utf8')
  const m = maskSource(src)
  const notes = []
  const manual = []
  const hoisted = []
  const takenIds = new Set([...m.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map((x) => x[0]))
  const edits = [] // {start, end, text} 按原文本偏移，原子替换
  const inject = [] // 头部要注入的 import / 垫片
  let needShim = false

  // ① 声明式 require（顶层与块内都认；块内的把 import 提到头部，绑定名不变）。
  const declRe = /(?:const|let|var)\s+(\{[^}\n]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])([^'"]+)\2\s*\)(?!\s*[.([])\s*;?/dg
  for (const hit of m.matchAll(declRe)) {
    const spec = src.slice(hit.indices[3][0], hit.indices[3][1])
    if (!spec.trim() || /['"$+`]/.test(spec)) { needShim = true; continue }
    const depth = braceDepthAt(m, hit.index)
    const s = norm(spec)
    let lhs = hit[1]
    if (lhs.startsWith('{')) {
      if (/=/.test(lhs)) { manual.push('解构带默认值，ESM import 不吃默认值：' + lhs.slice(0, 40)); continue }
      lhs = lhs.replace(/([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/g, '$1 as $2') // CJS 的 `{ a: b }` 在 ESM 里写 `{ a as b }`
    }
    const star = NAMESPACE_ONLY.has(s) && !lhs.startsWith('{')
    const stmt = lhs.startsWith('{')
      ? "import " + lhs + " from '" + s + "'"
      : 'import ' + (star ? '* as ' : '') + lhs + " from '" + s + "'"
    if (depth > 0) {
      edits.push({ start: hit.index, end: hit.index + hit[0].length, text: '' })
      hoisted.push(stmt)
      notes.push('块内声明 require 提到顶层：' + spec)
    } else {
      edits.push({ start: hit.index, end: hit.index + hit[0].length, text: stmt + sepAfter(m, hit.index + hit[0].length) })
      notes.push((star ? 'namespace ' : '') + 'import ' + s)
    }
  }
  // ② 裸 require('x') 当**语句**用（副作用导入）——只有语句起始处才算，`=> require('url').x` 这类走 ③。
  for (const hit of m.matchAll(/(^|[;\n{}][ \t]*)require\s*\(\s*(['"])([^'"]+)\2\s*\)\s*;?/dgm)) {
    const at = hit.index + hit[1].length
    if (edits.some((e) => at >= e.start && at < e.end) || braceDepthAt(m, at) > 0) continue
    const spec = src.slice(hit.indices[3][0], hit.indices[3][1])
    if (!spec.trim()) continue
    edits.push({ start: at, end: hit.index + hit[0].length, text: "import '" + norm(spec) + "'" + sepAfter(m, hit.index + hit[0].length) })
    notes.push('side-effect import ' + spec)
  }
  // ③ 语句中间的 require('x')（如 require('url').pathToFileURL）→ 命名空间别名 + 替换。
  for (const hit of m.matchAll(/require\s*\(\s*(['"])([^'"]+)\1\s*\)/dg)) {
    if (edits.some((e) => hit.index >= e.start && hit.index < e.end)) continue
    const spec = src.slice(hit.indices[2][0], hit.indices[2][1])
    if (!spec.trim() || spec.startsWith('.')) { needShim = true; continue }
    const alias = aliasFor(spec, takenIds)
    takenIds.add(alias)
    hoisted.push('import * as ' + alias + " from '" + norm(spec) + "'")
    edits.push({ start: hit.index, end: hit.index + hit[0].length, text: alias })
    notes.push('内联 require → ' + alias + '（' + spec + '）')
  }

  let out = src
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  let mNow = maskSource(out)

  // ④ require.resolve / 动态 require：垫片接管（保留 CJS 语义）。
  if (/\brequire\.resolve\s*\(/.test(mNow)) {
    needShim = true
    out = out.replace(/\brequire\.resolve\s*\(/g, 'createRequire(import.meta.url).resolve(')
    notes.push('require.resolve → createRequire(...).resolve')
  }
  const inlineLeft = [...maskSource(out).matchAll(/\brequire\s*\(/g)].length
  if (inlineLeft) {
    needShim = true
    const samples = out.split('\n').filter((l) => /\brequire\s*\(/.test(l)).slice(0, 2).map((l) => l.trim().slice(0, 60))
    notes.push('余下 ' + inlineLeft + ' 处 require → createRequire 垫片')
    manual.push('有非字面量/构造性 require，已放垫片（' + inlineLeft + ' 处）：' + samples.join(' | '))
  }

  // ④b CJS 入口守卫 `require.main === module`：ESM 里 `module` 是自由变量（一跑就 ReferenceError）。
  if (/\brequire\s*\.\s*main\s*===\s*module\b/.test(maskSource(out))) {
    out = out.replace(/\brequire\s*\.\s*main\s*===\s*module\b/g, 'isMainEntry')
    const urlImport = out.match(/^[ \t]*import\s*\{([^}]*)\}\s*from\s*['"]node:url['"]/m)
    if (urlImport) {
      if (!/\bpathToFileURL\b/.test(urlImport[1])) out = out.replace(urlImport[0], 'import {' + urlImport[1].replace(/\s*$/, '') + ", pathToFileURL } from 'node:url'")
    } else if (!/\bpathToFileURL\b/.test(out)) {
      inject.push("import { pathToFileURL } from 'node:url'")
    }
    inject.push("const isMainEntry = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href")
    notes.push('require.main === module → isMainEntry（import.meta 判据）')
  }

  // ⑤ module.exports → 导出。
  const mExp = mNow.match(/\bmodule\.exports\s*=\s*/d)
  if (mExp) {
    const after = mExp.index + mExp[0].length
    const obj = mNow[after] === '{' ? sliceBrace(out, mNow, after) : null
    if (obj) {
      // 对象里每条：`key: value` 或简写 `key`。值是本文件里的局部名 → 可以给具名导出。
      const entries = [...obj.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?=[,}])/g)]
        .map((x) => ({ key: x[1], value: x[2] || x[1] }))
      const declared = (n) => new RegExp('(?:function|const|let|var|class)\\s+' + n + '\\b|\\b' + n + '\\s*=\\s*(?:async\\s+)?(?:function\\b|\\()').test(mNow)
      const allLocal = entries.length > 0 && entries.every((e) => declared(e.value))
      const styles = consumerStyle(file, allFiles)
      const namedWanted = styles.has('named') || !styles.size
      const wholeWanted = styles.has('whole') || !styles.size
      const parts = []
      if (allLocal) {
        if (namedWanted) parts.push('export { ' + entries.map((e) => e.key).join(', ') + ' }')
        if (wholeWanted) parts.push('export default ' + obj)
      } else if (!entries.length) {
        parts.push('export default ' + obj)
      } else {
        parts.push('export default ' + obj)
        manual.push('导出对象里有非局部标识符的值，具名导出需人工：' + obj.replace(/\s+/g, ' ').slice(0, 60))
      }
      // 从 `module.exports` 起、到对象字面量结束（尾随 `;` 一并吃掉）替换成导出语句；
      // 同一行后面若还有别的语句，原样留在后面。
      let end = after + obj.length
      if (out[end] === ';') end += 1
      const lineEnd = out.indexOf('\n', end)
      const tail = out.slice(end, lineEnd >= 0 ? lineEnd : out.length)
      out = out.slice(0, mExp.index) + parts.join('\n') + tail + out.slice(lineEnd >= 0 ? lineEnd : out.length)
      notes.push('module.exports{ ' + entries.length + ' 键 } → ' + (allLocal ? (namedWanted ? (wholeWanted ? '具名 + 默认' : '具名') : '默认') : '默认') + '导出')
    } else {
      out = out.replace(/\bmodule\.exports\s*=/g, 'export default ')
      notes.push('module.exports → export default')
    }
  }
  if (/\bexports\.[A-Za-z_$]/.test(maskSource(out))) manual.push('exports.x = ... 需人工（未自动改）')

  // ⑥ __dirname / __filename 垫片 + 头部 import 注入。
  mNow = maskSource(out)
  if (/\b__dirname\b/.test(mNow) || /\b__filename\b/.test(mNow)) {
    const hasPathImport = /^[ \t]*import\s+path\s+from\s+['"]node:path['"]/m.test(out)
    const shadowed = /(?:const|let|var|function|class)\s+path\b/.test(mNow) && !hasPathImport
    const alias = shadowed ? 'nodePathAlias' : 'path'
    if (shadowed) notes.push('本文件已有 path 绑定 → 垫片别名 ' + alias)
    if (!hasPathImport) inject.push(shadowed ? "import nodePathAlias from 'node:path'" : "import path from 'node:path'")
    // fileURLToPath 可能已经随别的具名导入从 node:url 进来了 —— 那就把名字并进去，别另起一条 import
    // （另起一条会与已有的 `{ pathToFileURL }` 撞名不撞名都不对：要么重复导入 url，要么漏掉 fileURLToPath）。
    const urlNamed = out.match(/^[ \t]*import\s*\{([^}]*)\}\s*from\s*['"]node:url['"]/m)
    if (urlNamed && !/\bfileURLToPath\b/.test(urlNamed[1])) {
      out = out.replace(urlNamed[0], "import {" + urlNamed[1].replace(/\s*$/, '') + ", fileURLToPath } from 'node:url'")
    } else if (!urlNamed && !/\bfileURLToPath\b/.test(out)) {
      inject.push("import { fileURLToPath } from 'node:url'")
    }
    const shim = []
    // 已经声明过就别再声明一遍（这个脚本会重跑：上次留下的垫片必须认得出来）。
    if (/\b__dirname\b/.test(mNow) && !/^[ \t]*const\s+__dirname\s*=/m.test(out)) shim.push('const __dirname = ' + alias + '.dirname(fileURLToPath(import.meta.url))')
    if (/\b__filename\b/.test(mNow) && !/^[ \t]*const\s+__filename\s*=/m.test(out)) shim.push('const __filename = fileURLToPath(import.meta.url)')
    if (shim.length) out = insertAfterImports(out, shim)
    notes.push('__dirname/__filename → fileURLToPath 现算')
  }
  if (needShim) {
    if (!/from\s+['"]node:module['"]/.test(out)) inject.push("import { createRequire } from 'node:module'")
    inject.push('const require = createRequire(import.meta.url)')
    notes.push('createRequire 垫片')
  }

  const fresh = [...new Set([...hoisted, ...inject])].filter((line) => !out.split('\n').includes(line))
  if (fresh.length) {
    out = insertAfterImports(out, fresh)
    notes.push('注入 ' + fresh.length + ' 条 import/垫片')
  }
  return { out, notes, manual, changed: out !== src }
}


/** 垫片/新 import 插在**头部那段连续的 import 块**之后：不能插到文件中间的 import 后面，
 *  否则像 `const ROOT = path.resolve(__dirname, '..')` 这种早于垫片的用法会踩 TDZ。 */
function insertAfterImports(text, list) {
  const all = text.split('\n')
  let first = -1
  for (let i = 0; i < all.length; i++) if (/^import\s/.test(all[i])) { first = i; break }
  let at = 0
  if (first >= 0) {
    at = first
    while (at < all.length && (/^import\s/.test(all[at]) || /^\s*$/.test(all[at]))) at++
  } else if (all[0] && all[0].startsWith('#!')) {
    at = 1
  }
  all.splice(at, 0, ...list)
  return all.join('\n')
}

function main() {
  const scan = scanDeck({ roots: ['.', 'tests', 'scripts'] })
  const targets = [...scan.debt, ...scan.mixed].map((d) => d.file).filter((f) => !GENERATED.test(f))
  const picked = targets.filter((f) => !only || f.includes(only))
  const results = picked.map((f) => Object.assign({ file: f }, rewriteFile(f, targets)))
  const manual = results.filter((r) => r.manual.length)
  const changed = results.filter((r) => r.changed)

  if (asJson) {
    console.log(JSON.stringify({ apply, targets: picked.length, changed: changed.map((r) => ({ file: r.file, notes: r.notes, manual: r.manual })), manual: manual.map((r) => r.file) }, null, 2))
  } else {
    console.log('CJS → ESM 迁移' + (apply ? '（真改）' : '（干跑，不写盘）') + '：候选 ' + picked.length + ' 个文件，' + changed.length + ' 个会被改写')
    for (const r of changed.slice(0, 6)) console.log('  · ' + r.file + '  ← ' + r.notes.join('；'))
    if (changed.length > 6) console.log('  …（其余 ' + (changed.length - 6) + ' 个同型）')
    if (manual.length) {
      console.log('\n带提示的文件（' + manual.length + ' 个）：')
      for (const r of manual.slice(0, 20)) console.log('  ! ' + r.file + '  ← ' + r.manual.join('；'))
    }
  }

  if (apply) {
    if (!existsSync(BACKUP)) mkdirSync(BACKUP, { recursive: true })
    let wrote = 0
    for (const r of changed) {
      const abs = path.join(DECK, r.file)
      const bak = path.join(BACKUP, r.file.replace(/\//g, '__'))
      if (!existsSync(bak)) copyFileSync(abs, bak)
      writeFileSync(abs, r.out)
      wrote += 1
    }
    console.log('\n已写盘 ' + wrote + ' 个文件；原件备份在 deck/.tmp-esm-backup/（回滚：--rollback）')
  }
  if (argv.includes('--rollback')) {
    let n = 0
    for (const r of results) {
      const bak = path.join(BACKUP, r.file.replace(/\//g, '__'))
      if (existsSync(bak)) { copyFileSync(bak, path.join(DECK, r.file)); n += 1 }
    }
    console.log('已回滚 ' + n + ' 个文件（备份目录保留）')
  }
  return manual.length && !apply ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
