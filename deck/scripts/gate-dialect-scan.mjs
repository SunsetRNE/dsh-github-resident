#!/usr/bin/env node
/**
 * scripts/gate-dialect-scan.mjs —— 门禁方言扫描器（票「deck 门禁链 ESM/CJS 欠账」的判据引擎）。
 *
 * 为什么要有它：包根 `package.json` 是 `"type": "module"`，deck 子树没有自己的 package.json，
 * 于是 deck/**.js 一律按 ESM 加载。哪些文件还**在 ESM 作用域里用 CJS 自由变量**
 * （`require()` / `module.exports` / `__dirname`，一加载就 ReferenceError）、哪些只是
 * 「注释/字符串里提到」或「自己声明了 createRequire 垫片」，必须分开数 ——
 * 用 `grep -rl "require(\|module.exports"` 数出来的面会把注释也算进去
 * （票面 261 就是这么来的；去注释去字符串之后是 252，其中 233 个是 tests/verify-*.js 门禁）。
 *
 * 口径（与 scripts/verify-chain.js、migrate-cjs-to-esm.mjs 同源）：
 *   · 判据是**去掉注释与字符串之后**的代码，且**只看没被本地声明绑定的**自由标识符——
 *     自己写了 `const require = createRequire(import.meta.url)` 或
 *     `const __dirname = path.dirname(fileURLToPath(import.meta.url))` 的文件不算欠账（记 `esm-shimmed`）。
 *   · `src/**` 与生成物（`client.js` / `host.js` / `package/lib/**`）单独记，不与 node 直接加载的门禁混算。
 *
 * 用法：
 *   node scripts/gate-dialect-scan.mjs                 # 汇总 + 代码欠账清单
 *   node scripts/gate-dialect-scan.mjs --json          # 机器可读（migrate / audit / 门禁都吃这个口径）
 *   node scripts/gate-dialect-scan.mjs --root tests    # 只扫一棵子树（可重复）
 *   node scripts/gate-dialect-scan.mjs --limit 20      # 清单最多打几条
 * 退出码：0 = 被判方言的树里没有「ESM 作用域下的 CJS 自由变量」；1 = 有（即代码欠账仍在）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
export const DECK = path.resolve(SCRIPTS, '..')

/** 打包侧（浏览器产物源）：由 esbuild 处理，node 不直接加载 —— 单独记。 */
const BUNDLED = /^src[\\/]/
/** 生成物：构建脚本产出，不入迁移口径。 */
const GENERATED = /^(client\.js|host\.js|package[\\/]lib[\\/])/
const SKIP = /(^|[\\/])(node_modules|\.tmp[^\\/]*|fixtures)([\\/]|$)/

/** 与源码**等长**的掩码：注释与字符串内容换成空格（保留换行），偏移量与原文件一一对应。
 *  正则字面量也一起掩掉 —— 否则 `/['"]/` 这类写法里的引号会被当成字符串起始，
 *  把其后整段代码吞进「字符串」，判据就瞎了（实测 verify-666 的 8 处 require 就这么被吃掉）。 */
export function maskSource(src) {
  const a = src.split('')
  let i = 0
  const n = src.length
  let prev = '' // 上一个有意义的字符（跳空白）
  let word = '' // 上一个标识符词（判 return / typeof 后的正则）
  const REGEX_AFTER_PUNCT = '(,=:[!&|?{};+-*%^~<>'
  const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'instanceof', 'yield', 'await'])
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { a[i] = ' '; i++ } continue }
    if (c === '/' && d === '*') { while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') a[i] = ' '; i++ } if (i < n) { a[i] = ' '; a[i + 1] = ' ' } i += 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < n && src[i] !== q) { if (src[i] !== '\n') a[i] = ' '; if (src[i] === '\\') { i++; if (src[i] !== '\n') a[i] = ' ' } i++ }
      i++
      prev = q
      word = ''
      continue
    }
    if (c === '/' && (prev === '' || REGEX_AFTER_PUNCT.indexOf(prev) >= 0 || REGEX_AFTER_WORD.has(word))) {
      let j = i + 1
      let inClass = false
      let closed = -1
      while (j < n) {
        const ch = src[j]
        if (ch === '\\') { j += 2; continue }
        if (ch === '\n') break
        if (ch === '[') inClass = true
        else if (ch === ']') inClass = false
        else if (ch === '/' && !inClass) { closed = j; break }
        j++
      }
      if (closed > 0) {
        for (let k = i; k <= closed; k++) if (src[k] !== '\n') a[k] = ' '
        i = closed + 1
        while (i < n && /[a-z]/i.test(src[i])) i++
        prev = 'x'
        word = ''
        continue
      }
    }
    if (/[A-Za-z_$]/.test(c)) word = (word ? word : '') + c
    else { if (!/\s/.test(c)) prev = c; if (!/[\w$]/.test(c)) word = '' }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return a.join('')
}

/** 自由变量（没被本地声明绑定的 CJS 记号）才是「加载即崩」的那一类。 */
const FREE_PROBES = [
  { name: 'require()', re: /\brequire\s*\(/, bind: /\b(?:const|let|var)\s+require\s*=/ },
  { name: 'module（CJS 惯用法：require.main === module / module.exports / module.parent …）', re: /\brequire\s*\.\s*main\s*===\s*module\b|\bmodule\s*\.\s*(?:exports|parent|filename|id|paths|children|loaded)\b/, bind: /\b(?:const|let|var)\s+module\s*=|^[ \t]*import\s+module\b/m },
  { name: 'exports.x', re: /\bexports\s*\.\s*[A-Za-z_$]/, bind: /\b(?:const|let|var)\s+exports\s*=/ },
  { name: '__dirname', re: /\b__dirname\b/, bind: /\b(?:const|let|var)\s+__dirname\b/ },
  { name: '__filename', re: /\b__filename\b/, bind: /\b(?:const|let|var)\s+__filename\b/ },
]

const ARTIFACT = /(^|[\\/])(client\.js|host\.js|package[\\/]lib[\\/])/
/** 静态依赖面：**只看语句起始处的** import/require（行内正则、夹具字符串里的同名写法不算），
 *  相对路径找不到 → 看是不是构建产物；裸包找不到 → 环境缺件；URL 形态不算。 */
function missingDeps(deck, file, src) {
  const m = maskSource(src)
  const miss = []
  const re = /^[ \t]*(?:import[^\n]*?\bfrom\s+|(?:const|let|var)[^\n]*?=\s*require\s*\(\s*|import\s*\(\s*|require\s*\(\s*|export[^\n]*?\bfrom\s+)['"]([^'"]*)['"]/dgm
  for (const hit of m.matchAll(re)) {
    const spec = src.slice(hit.indices[1][0], hit.indices[1][1])
    if (!spec || /^(node:|data:|file:|https?:)/.test(spec)) continue
    if (spec.startsWith('.')) {
      const abs = path.resolve(path.dirname(path.join(deck, file)), spec.split('?')[0])
      const ok = [abs, abs + '.js', abs + '.mjs', abs + '.cjs', abs + '.json', path.join(abs, 'index.js')].some((c) => existsSync(c))
      if (!ok) miss.push({ spec, kind: ARTIFACT.test(spec) ? '产物缺失' : '代码欠账（路径写错/文件不存在）' })
    } else if (!spec.startsWith('/')) {
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      const ok = [path.join(deck, 'node_modules'), path.join(deck, '..', 'node_modules')].some((base) => existsSync(path.join(base, pkg)))
      if (!ok) miss.push({ spec, kind: '环境缺件（node_modules 里没有这个包）' })
    }
  }
  return miss
}

function walk(dir, deck, acc) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    const rel = path.relative(deck, p)
    if (SKIP.test(rel)) continue
    if (e.isDirectory()) walk(p, deck, acc)
    else if (e.isFile() && e.name.endsWith('.js')) acc.push(rel)
  }
  return acc
}

/** 扫描入口：逐文件判定与分类（migrate / audit / 门禁共用这一份口径）。 */
export function scanDeck(opts = {}) {
  const deck = opts.deck || DECK
  const roots = opts.roots || ['.', 'tests', 'scripts', 'src']
  const files = []
  for (const r of roots) walk(path.join(deck, r), deck, files)
  const rows = []
  for (const file of [...new Set(files)].sort()) {
    let src
    try { src = readFileSync(path.join(deck, file), 'utf8') } catch { continue }
    const code = maskSource(src)
    const free = FREE_PROBES.filter((p) => p.re.test(code) && !p.bind.test(code)).map((p) => p.name)
    const shimmed = FREE_PROBES.filter((p) => p.re.test(code) && p.bind.test(code)).map((p) => p.name)
    const esmSyntax = /(^|\n)\s*(import\s+[^(]|export\s+(default|const|let|var|function|class|\{))/.test(code)
    const bundled = BUNDLED.test(file)
    const generated = GENERATED.test(file)
    let verdict
    if (generated) verdict = 'generated'
    else if (free.length && esmSyntax) verdict = 'mixed'
    else if (free.length) verdict = bundled ? 'cjs-bundled' : 'cjs-in-esm'
    else if (shimmed.length) verdict = 'esm-shimmed'
    else verdict = 'esm-ok'
    const missing = free.length ? [] : missingDeps(deck, file, src)
    rows.push({ file, verdict, free, shimmed, esmSyntax, bundled, generated, missing })
  }
  const pick = (v) => rows.filter((r) => r.verdict === v)
  return {
    deck,
    scanned: rows.length,
    rows,
    debt: pick('cjs-in-esm'),
    mixed: pick('mixed'),
    bundledCjs: pick('cjs-bundled'),
    shimmed: pick('esm-shimmed'),
    generated: pick('generated'),
    esmOk: pick('esm-ok'),
    artifactMiss: rows.filter((r) => !r.generated && r.missing.some((m) => m.kind === '产物缺失')),
    depMiss: rows.filter((r) => !r.generated && r.missing.some((m) => m.kind.startsWith('环境缺件'))),
  }
}

function main() {
  const argv = process.argv.slice(2)
  const roots = []
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--root' && argv[i + 1]) roots.push(argv[i + 1])
  const limitIdx = argv.indexOf('--limit')
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) || 10 : 10
  const s = scanDeck({ roots: roots.length ? roots : undefined })
  const debtAll = [...s.debt, ...s.mixed]
  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      deck: s.deck,
      scanned: s.scanned,
      counts: { esmOk: s.esmOk.length, debt: s.debt.length, mixed: s.mixed.length, shimmed: s.shimmed.length, bundledCjs: s.bundledCjs.length, generated: s.generated.length, artifactMiss: s.artifactMiss.length, depMiss: s.depMiss.length },
      debt: debtAll.map((r) => ({ file: r.file, verdict: r.verdict, tokens: r.free })),
      shimmed: s.shimmed.map((r) => ({ file: r.file, tokens: r.shimmed })),
      artifactMiss: s.artifactMiss.map((r) => ({ file: r.file, missing: r.missing })),
      depMiss: s.depMiss.map((r) => ({ file: r.file, missing: r.missing })),
    }, null, 2))
    process.exit(debtAll.length ? 1 : 0)
  }
  console.log('门禁方言扫描（去注释去字符串 + 只看自由变量）：共扫 ' + s.scanned + ' 个 .js')
  console.log('  esm-ok（已合口径）          : ' + s.esmOk.length)
  console.log('  自垫片 esm-shimmed（合规）  : ' + s.shimmed.length)
  console.log('  代码欠账 cjs-in-esm        : ' + s.debt.length)
  console.log('  mixed（两种语法混着写）     : ' + s.mixed.length)
  console.log('  打包侧 cjs-bundled（src/）  : ' + s.bundledCjs.length)
  console.log('  生成物（不入迁移口径）      : ' + s.generated.length + '  ' + s.generated.slice(0, 4).map((r) => r.file).join(' ') + (s.generated.length > 4 ? ' …' : ''))
  console.log('  产物缺失（跑之前要 build）  : ' + s.artifactMiss.length)
  console.log('  环境缺件（缺 node_modules） : ' + s.depMiss.length)
  const show = (title, list, fmt) => {
    if (!list.length) return
    console.log('\n' + title + '（前 ' + Math.min(limit, list.length) + '/' + list.length + '）')
    list.slice(0, limit).forEach((r) => console.log('  ' + fmt(r)))
  }
  show('代码欠账', s.debt, (r) => r.file + '  [' + r.free.join(' ') + ']')
  show('mixed', s.mixed, (r) => r.file + '  [' + r.free.join(' ') + ']')
  show('自垫片', s.shimmed, (r) => r.file + '  [' + r.shimmed.join(' ') + ']')
  show('打包侧 CJS', s.bundledCjs, (r) => r.file + '  [' + r.free.join(' ') + ']')
  show('产物缺失', s.artifactMiss, (r) => r.file + '  -> ' + r.missing.map((m) => m.spec).join(', '))
  show('环境缺件', s.depMiss, (r) => r.file + '  -> ' + r.missing.map((m) => m.spec).join(', '))
  process.exit(debtAll.length ? 1 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
