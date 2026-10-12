#!/usr/bin/env node
/**
 * scripts/gate-chain-audit.mjs —— 门禁链逐道审计（票「deck 门禁链 ESM/CJS 欠账」的验收器）。
 *
 * 回答两个问题，逐道答：
 *   ① 这道门禁**能不能加载**（模块方言/依赖解析层面，不跑到断言）；
 *   ② 跑不起来的那些，是**环境缺件**还是**代码欠账** —— 一句「已知问题」不算答案。
 *
 * 判据分两层：
 *   · 静态层（默认，不执行）：`gate-dialect-scan` 的自由变量面 + 静态依赖解析。
 *   · 实跑层（--probe，可选）：真起 `node <门禁>`，按 stderr 特征把「加载失败」与「跑起来但断言红」分开：
 *       加载失败 → 代码欠账（require/import 方言、导出形状、语法）或环境缺件（node_modules / 构建产物）；
 *       退出码非 0 但越过了加载 → `ran-red`（加载成功；红是断言/环境的事，另记最后一行为证）。
 *
 * 用法：
 *   node scripts/gate-chain-audit.mjs                       # 静态面（全部名单）
 *   node scripts/gate-chain-audit.mjs --probe --limit 40    # 实跑前 40 道
 *   node scripts/gate-chain-audit.mjs --probe --only verify-640 --timeout 90
 *   node scripts/gate-chain-audit.mjs --json --out /tmp/audit.json
 * 退出码：0 = 名单里没有「代码欠账」那类；1 = 还有（环境缺件单独算，退出码不因此变红）。
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanDeck, DECK } from './gate-dialect-scan.mjs'
import { deriveRoster } from './ensure-deck-manifest.mjs'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const probe = argv.includes('--probe')
const val = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const only = val('--only', '')
const limit = Number(val('--limit', '0')) || 0
const timeout = Number(val('--timeout', '60')) * 1000
const outPath = val('--out', '')

const LOAD_SIGNS = [
  [/is not defined in ES module scope/, '代码欠账：ESM 作用域下的 CJS 自由变量'],
  [/Cannot use import statement outside a module/, '代码欠账：按 CJS 解析了 ESM 写法'],
  [/Cannot use import\.meta/, '代码欠账：import.meta 出现在 CJS 解析下'],
  [/does not provide an export named/, '代码欠账：导出形状不匹配（具名/默认）'],
  [/ERR_REQUIRE_ESM/, '代码欠账：CJS require 撞上 ESM 目标'],
  [/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package/, '环境缺件：依赖/产物没装或没构建'],
  [/SyntaxError/, '代码欠账：语法层面就不成立'],
]

function classifyProbe(entry, r) {
  const err = String(r.stderr || '')
  const out = String(r.stdout || '')
  if (r.error && /timed? ?out|ETIMEDOUT|SIGTERM/i.test(String(r.error.message || ''))) return { verdict: 'timeout', reason: '跑得动但超过 ' + timeout / 1000 + 's（多半是浏览器/网络类）' }
  for (const [re, reason] of LOAD_SIGNS) {
    if (re.test(err)) {
      const m = err.match(/Cannot find (?:module|package) '([^']+)'/)
      const where = m ? m[1] : ''
      const kind = /^is not defined|Cannot use import|does not provide|ERR_REQUIRE_ESM|SyntaxError/.test(reason) ? '代码欠账'
        : (/^\.{1,2}\//.test(where) ? '环境缺件：构建产物/文件缺失' : '环境缺件：node_modules 缺包')
      return { verdict: 'load-error', reason: reason + (where ? '（' + where + '）' : ''), kind }
    }
  }
  if (r.status === 0) return { verdict: 'ok', reason: '' }
  const lastLine = (err.trim().split('\n').pop() || out.trim().split('\n').pop() || '').slice(0, 120)
  return { verdict: 'ran-red', reason: '加载成功、断言红（exit ' + r.status + '）：' + lastLine }
}

async function main() {
  const scan = scanDeck({ roots: ['.', 'tests', 'scripts'] })
  const byFile = new Map(scan.rows.map((r) => [r.file, r]))
  const roster = deriveRoster(DECK)
  let entries = roster.gates.map((n) => path.join('tests', n))
  if (only) entries = entries.filter((e) => e.includes(only))
  if (limit > 0) entries = entries.slice(0, limit)

  const rows = []
  for (const file of entries) {
    const d = byFile.get(file)
    const row = {
      file,
      dialect: d ? d.verdict : 'missing',
      free: d ? d.free : ['文件不存在'],
      missing: d ? d.missing.map((m) => m.kind + ':' + m.spec) : [],
      verdict: '',
      reason: '',
    }
    if (d && (d.verdict === 'cjs-in-esm' || d.verdict === 'mixed')) row.verdict = 'load-error'
    if (d && (d.verdict === 'cjs-in-esm' || d.verdict === 'mixed')) row.reason = '代码欠账：ESM 作用域下的 CJS 自由变量 ' + d.free.join(' ')
    if (!row.verdict && d && d.missing.some((m) => m.kind.startsWith('环境缺件'))) { row.verdict = 'env-gap'; row.reason = '环境缺件：' + d.missing.map((mm) => mm.spec).join(',') }
    if (!row.verdict && d && d.missing.some((m) => m.kind === '产物缺失')) { row.verdict = 'env-gap'; row.reason = '环境缺件：构建产物缺失 ' + d.missing.map((mm) => mm.spec).join(',') }
    if (!row.verdict) row.verdict = 'loadable'
    if (probe) {
      const r = spawnSync(process.execPath, [file], { cwd: DECK, encoding: 'utf8', timeout, env: process.env })
      const c = classifyProbe(file, r)
      row.probe = c.verdict
      row.probeReason = c.reason
      if (c.verdict === 'load-error') { row.verdict = 'load-error'; row.reason = c.reason; row.kind = c.kind }
    }
    rows.push(row)
  }

  const summary = (key) => rows.reduce((acc, r) => { const k = r[key] || '-'; acc[k] = (acc[k] || 0) + 1; return acc }, {})
  const payload = { deck: DECK, gates: roster.gates.length, audited: rows.length, probe, summary: summary('verdict'), rows }
  if (outPath) writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n')
  if (asJson) { console.log(JSON.stringify(payload, null, 2)); return rows.some((r) => r.verdict === 'load-error') ? 1 : 0 }

  console.log('门禁链审计' + (probe ? '（含实跑）' : '（静态面）') + '：名单 ' + roster.gates.length + ' 道，本次审 ' + rows.length + ' 道')
  const s = summary('verdict')
  for (const k of Object.keys(s).sort()) console.log('  ' + k + ': ' + s[k])
  const bad = rows.filter((r) => r.verdict === 'load-error')
  if (bad.length) {
    console.log('\n加载失败（' + bad.length + ' 道）：')
    for (const r of bad.slice(0, 20)) console.log('  ✗ ' + r.file + '  ← ' + r.reason)
  }
  const envGap = rows.filter((r) => r.verdict === 'env-gap')
  if (envGap.length) {
    console.log('\n环境缺件（' + envGap.length + ' 道）：')
    for (const r of envGap.slice(0, 10)) console.log('  ○ ' + r.file + '  ← ' + r.reason)
  }
  if (probe) {
    const reds = rows.filter((r) => r.probe === 'ran-red')
    console.log('\n加载成功但断言红（' + reds.length + ' 道）—— 红是断言/环境的事，不是方言的事：')
    for (const r of reds.slice(0, 10)) console.log('  · ' + r.file + '  ← ' + r.probeReason)
  }
  return bad.length ? 1 : 0
}

process.exit(await main())
