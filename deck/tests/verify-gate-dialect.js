#!/usr/bin/env node
/**
 * tests/verify-gate-dialect.js —— 门禁方言与名单契约（票「deck 门禁链 ESM/CJS 欠账」的常驻判据）。
 *
 * 它钉住四件事，任何一条破了就红：
 *   ①  `node scripts/verify-chain.js --list` 能列出名单且退出码 0（编排入口不再加载即崩）；
 *   ②  方言口径成立：`gate-dialect-scan` 判定的「ESM 作用域下的 CJS 自由变量」= 0（代码欠账归零）；
 *   ③  名单来源可重跑且一致：`deck/package.json` 的 scripts.verify == `tests/verify-*.js` 派生结果；
 *   ④  **反证**：临时种一个写着 `require()` 的 .js，扫描器必须当场判它欠账；
 *       再种一个自带 `createRequire` 垫片的，扫描器必须不判它欠账（两向都测，避免判据恒绿）。
 *
 * 用法：cd deck && node tests/verify-gate-dialect.js
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanDeck } from '../scripts/gate-dialect-scan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DECK = path.resolve(HERE, '..')
let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log('  PASS ' + m) }
const bad = (m) => { fail++; console.log('  FAIL ' + m) }
const run = (args) => {
  try { return { code: 0, out: execFileSync(process.execPath, args, { cwd: DECK, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (e) { return { code: e.status == null ? -1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') } }
}

console.log('门禁方言与名单契约')

// ① 编排入口 --list
{
  const r = run(['scripts/verify-chain.js', '--list'])
  ok(r.code === 0 ? '① verify-chain.js --list 退出码 0（不再 ReferenceError）' : '① verify-chain.js --list 退出码 ' + r.code)
  if (!r.out.includes('verify-chain 名单')) bad('① --list 没打印名单（输出头 80 字：' + r.out.slice(0, 80).replace(/\n/g, ' / ') + '）')
  else ok('① --list 打印了名单')
  if (!/node tests\/verify-.*\.js/.test(r.out)) bad('① 名单里没有 node tests/verify-*.js 条目')
  else ok('① 名单里有 node tests/verify-*.js 条目')
}

// ② 方言口径：自由变量归零
{
  const s = scanDeck({ roots: ['.', 'tests', 'scripts', 'src'] })
  const debt = [...s.debt, ...s.mixed]
  if (debt.length === 0) ok('② 代码欠账 0 个（ESM 作用域下的 CJS 自由变量）')
  else bad('② 仍有 ' + debt.length + ' 个欠账文件：' + debt.slice(0, 3).map((d) => d.file + '[' + d.free.join(' ') + ']').join('/'))
  // 生成物与 src 打包侧不计入口径，但门禁树（tests/scripts）必须干净
  const dirtyGateTree = debt.filter((d) => /^(tests|scripts)\//.test(d.file))
  if (dirtyGateTree.length === 0) ok('② 门禁树（tests/ + scripts/）欠账 0')
  else bad('② 门禁树仍有欠账：' + dirtyGateTree.slice(0, 3).map((d) => d.file).join('/'))
}

// ③ 名单来源一致性
{
  const r = run(['scripts/ensure-deck-manifest.mjs', '--check'])
  if (r.code === 0) ok('③ deck/package.json 的 scripts.verify 与 tests/verify-*.js 派生结果一致')
  else bad('③ 名单漂移或缺失：' + r.out.trim().slice(0, 120))
  const manifestPath = path.join(DECK, 'package.json')
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const chain = String((m.scripts && m.scripts.verify) || '')
    if (m.type === 'module') ok('③ deck/package.json 的 type = module（与包根同方言）')
    else bad('③ deck/package.json 的 type = ' + JSON.stringify(m.type) + '（应为 module）')
    if (/--experimental-/.test(chain)) bad('③ 名录里出现 --experimental-* 开关（票面明令不许靠它糊）')
    else ok('③ 名单里没有 --experimental-* 开关')
    if (chain.includes('verify-gate-dialect.js')) ok('③ 本门禁已在名单里（仓库惯例：门禁自证入链）')
    else bad('③ 本门禁不在名单里')
  } catch (e) {
    bad('③ 读 deck/package.json 失败：' + String(e.message))
  }
}

// ④ 反证：判据既不能恒绿，也不能恒红
{
  const planted = path.join(HERE, 'dialect-probe-cjs.js')
  const shimmed = path.join(HERE, 'dialect-probe-shim.js')
  try {
    writeFileSync(planted, "const fs = require('node:fs')\nconsole.log(fs !== undefined)\n")
    writeFileSync(shimmed, "import { createRequire } from 'node:module'\nconst require = createRequire(import.meta.url)\nconsole.log(typeof require('node:fs').readFileSync)\n")
    const s2 = scanDeck({ roots: ['tests'] })
    const hitCjs = s2.rows.find((r) => r.file === 'tests/dialect-probe-cjs.js')
    const hitShim = s2.rows.find((r) => r.file === 'tests/dialect-probe-shim.js')
    if (hitCjs && (hitCjs.verdict === 'cjs-in-esm' || hitCjs.verdict === 'mixed')) ok('④ 反证命中：种下的 require() 文件被判欠账（' + hitCjs.verdict + '）')
    else bad('④ 反证无效：种下的 require() 文件没被判欠账（' + JSON.stringify(hitCjs && hitCjs.verdict) + '）')
    if (hitShim && hitShim.verdict === 'esm-shimmed') ok('④ 反向反证成立：自带 createRequire 垫片的文件不算欠账')
    else bad('④ 反向反证不成立：带垫片的文件被判成 ' + JSON.stringify(hitShim && hitShim.verdict))
    if (hitShim && hitShim.verdict !== 'cjs-in-esm') ok('④ 垫片文件没被误判成欠账')
    else bad('④ 垫片文件被误判成欠账')
  } finally {
    rmSync(planted, { force: true })
    rmSync(shimmed, { force: true })
  }
}

console.log('\n' + (fail ? '=== FAIL（' + pass + ' 项通过 / ' + fail + ' 项失败） ===' : '=== PASS（' + pass + ' 项全部通过） ==='))
process.exit(fail ? 1 : 0)
