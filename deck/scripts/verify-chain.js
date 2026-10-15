#!/usr/bin/env node
/**
 * scripts/verify-chain.js —— verify 链的执行器（1.7.50 发布门禁红线的根治）。
 *
 * 起因：上游 package.json 里 scripts.verify 是一整串 `node tests/*.js && ……`（8639 字），
 * Windows cmd.exe 单条命令上限 8191 字，npm test 经 cmd 转发直接报命令行过长。
 * 修法：不断链（不断言链内容的门禁用 includes() 钉着它，只能读不能搬），执行改走本脚本：
 * 读出链、按 && 切开、逐条直调 node，首红即停并透传退出码。
 *
 * 合并形态的两处变化（票「deck 门禁链 ESM/CJS 欠账」）：
 *   1. 方言：包根 package.json 是 `"type": "module"`，本文件原先用 require/__dirname，
 *      一加载就 `ReferenceError: require is not defined in ES module scope` —— 已改 ESM。
 *   2. 名单来源：上游把 deck 根 package.json **gitignore 了**（deck/.gitignore 的 /package.json），
 *      合并时它没被带进来，于是本脚本读不到名单（ENOENT），17 道按仓库惯例断言
 *      「本门禁已在链里」的门禁也一律 ENOENT。名单现在由
 *      `scripts/ensure-deck-manifest.mjs` 从 `tests/verify-*.js` 派生并落盘（幂等）；
 *      本脚本每次运行前先保证它是最新的。
 *
 * 用法：
 *   node scripts/verify-chain.js               # 全链
 *   node scripts/verify-chain.js --list        # 只列名单（不执行）
 *   node scripts/verify-chain.js --only <子串>  # 按子串抽查
 *   node scripts/verify-chain.js --from 40      # 从第 40 条开始（前面确认过的可跳过）
 *
 * 重活租约（票 61）：真跑之前**自己取**那把机器级的锁（tests/merge/_load-lease.mjs，与
 * verify:merge / verify:resident 同一份落点）；拿不到就 exit 2 + `BLOCKED-LOAD-LEASE`，
 * 一道门禁都不起。`--list` 是只读名单，不占锁。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { planFor } from './ensure-deck-manifest.mjs'
// 重活租约（票 61）：deck 门禁链与 verify:merge / verify:resident **共用同一把锁**。
// 直接相对引用那一支（tests/merge/_load-lease.mjs）—— 不抄第二份实现、不开第二把锁。
import { holdLoadLease } from '../../tests/merge/_load-lease.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 名单来源：deck/package.json 的 scripts.verify；缺失或漂移时先按 tests/verify-*.js 派生（幂等）。 */
function ensureChain() {
  const { roster, next, drifted } = planFor(ROOT)
  const manifest = path.join(ROOT, 'package.json')
  if (drifted) {
    // 名单是本地派生件（上游 gitignore），落盘只为两件事：本脚本读得到 + 成员断言门禁读得到。
    writeFileSync(manifest, JSON.stringify(next, null, 2) + '\n')
  }
  let raw
  try { raw = JSON.parse(readFileSync(manifest, 'utf8')) } catch (e) {
    console.error('FAIL 读不到名单来源 deck/package.json：' + String((e && e.message) || e))
    process.exit(1)
  }
  const chain = String((raw.scripts && raw.scripts.verify) || '')
  if (!chain) { console.error('FAIL verify 链为空（deck/package.json 的 scripts.verify）'); process.exit(1) }
  return { chain, gates: roster.gates.length }
}

/** 按 && 切，照顾引号里的 &&（链里现在没有，引号分支是防御）。 */
export function splitChain(s) {
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) { cur += ch; if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === '&' && s[i + 1] === '&') {
      out.push(cur.replace(/\s+$/, ''))
      cur = ''
      i += 1
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out.map((x) => x.trim()).filter(Boolean)
}

function splitArgs(cmd) {
  const args = []
  let cur = ''
  let quote = null
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (/\s/.test(ch)) { if (cur) { args.push(cur); cur = '' } continue }
    cur += ch
  }
  if (cur) args.push(cur)
  return args
}

const argv = process.argv.slice(2)
const listMode = argv.includes('--list')
const onlyIdx = argv.indexOf('--only')
const only = onlyIdx >= 0 && argv[onlyIdx + 1] ? argv[onlyIdx + 1] : ''
const fromIdx = argv.indexOf('--from')
const from = fromIdx >= 0 ? Math.max(1, Number(argv[fromIdx + 1]) || 1) : 1

// 开跑前自己取锁（**一道门禁都不起**就说清楚）：本链约 10 分钟、几百个子进程，正是
// 「重活并跑会把宿主压垮」那一族。拿不到就 exit 2 + BLOCKED-LOAD-LEASE —— 拒绝语义由
// tests/merge/_load-lease.mjs 一处产出，这里不自己拼文案、不自己写第二把锁。
// `--list` 是只读名单，不占锁（重活跑着的时候它也读得动）。
if (!listMode) {
  holdLoadLease({
    holder: 'verify:deck@' + (process.env.DSH_SESSION_ID || ('pid' + process.pid)),
    purpose: 'verify:deck（deck 门禁链，由 deck/scripts/verify-chain.js 执行）',
  })
}

const { chain, gates } = ensureChain()
const all = splitChain(chain)
const entries = all.filter((e) => !only || e.includes(only))

if (listMode) {
  console.log('verify-chain 名单（' + entries.length + '/' + all.length + ' 条；来源 deck/package.json 的 scripts.verify，由 tests/verify-*.js 派生）')
  entries.forEach((e, i) => console.log(String(i + 1).padStart(4, ' ') + '. ' + e))
  process.exit(0)
}
if (!entries.length) { console.error('FAIL 没有可跑的条目'); process.exit(1) }
console.log('verify-chain: 共 ' + entries.length + ' 条（名单 ' + all.length + ' 条，派生自 ' + gates + ' 道门禁）' + (only ? '，过滤 ' + only : ''))
let done = 0
for (let i = 0; i < entries.length; i++) {
  if (i + 1 < from) continue
  const entry = entries[i]
  const parts = splitArgs(entry)
  if (parts[0] !== 'node') { console.error('FAIL 非 node 条目拒绝执行：' + entry.slice(0, 120)); process.exit(1) }
  const r = spawnSync(process.execPath, parts.slice(1), { cwd: ROOT, stdio: 'inherit', shell: false })
  if (r.error) { console.error('FAIL 起不来：' + entry.slice(0, 120) + ' ' + String(r.error.message || r.error)); process.exit(1) }
  if (r.status !== 0) { console.error('FAIL 止于：' + entry.slice(0, 160) + '（exit ' + r.status + '）'); process.exit(r.status) }
  done += 1
}
console.log('verify-chain: 全绿（' + done + ' 条）')
