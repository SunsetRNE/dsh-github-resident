#!/usr/bin/env node
/**
 * scripts/ensure-deck-manifest.mjs —— 派生并落盘 deck 子树的本地清单 `deck/package.json`。
 *
 * 为什么需要它（票「deck 门禁链 ESM/CJS 欠账」的根因之一）：
 *   上游 deck 仓的**根 package.json 是 gitignore 掉的**（见 `deck/.gitignore` 的 `/package.json`
 *   一行），合并进本仓时它没被带进来。于是合并形态下：
 *     · `scripts/verify-chain.js` 读不到名单（ENOENT）；
 *     · 17 道门禁按仓库惯例断言「本门禁已在 npm run verify 链里」（读 cwd 的 package.json），
 *       一律 ENOENT 崩在断言之前。
 *   名单上游只有一处来源，合并形态下这个来源必须重新长出来——本脚本按**文件系统**派生它
 *   （`tests/verify-*.js`，字典序），写进 `deck/package.json` 的 `scripts.verify`；因为
 *   `/package.json` 被 gitignore，这份清单是本地派生件，不入库、每次可重跑、幂等。
 *
 * 口径：`"type": "module"` —— 与包根一致，deck/**.js 一律 ESM（改 ESM，不改扩展名）。
 *       写别的值会让本目录 900+ 个 .js 的方言整体翻面，等于把这次迁移按回去。
 *
 * 用法：
 *   node scripts/ensure-deck-manifest.mjs            # 派生并落盘（幂等；内容一致就不写盘）
 *   node scripts/ensure-deck-manifest.mjs --check    # 只判有没有 / 是否漂移（0=一致，1=缺或漂移）
 *   node scripts/ensure-deck-manifest.mjs --print    # 只把名单打出来，不写盘
 * 退出码：0 正常；1 --check 下缺失或漂移。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const DECK = path.resolve(SCRIPTS, '..')
const MANIFEST = path.join(DECK, 'package.json')
const argv = process.argv.slice(2)

/** 名单派生：门禁 = tests/verify-*.js；冒烟 = tests/smoke-*.test.js。字典序，去掉目录与辅助件。 */
export function deriveRoster(deck = DECK) {
  const tests = path.join(deck, 'tests')
  let names = []
  try { names = readdirSync(tests) } catch { names = [] }
  const gates = names.filter((n) => /^verify-.*\.js$/.test(n)).sort()
  const smokes = names.filter((n) => /^smoke-.*\.test\.js$/.test(n)).sort()
  return {
    gates,
    smokes,
    chain: gates.map((n) => 'node tests/' + n).join(' && '),
    smokeChain: smokes.map((n) => 'node tests/' + n).join(' && '),
  }
}

function readManifest() {
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')) } catch { return null }
}

export function planFor(deck = DECK) {
  const r = deriveRoster(deck)
  const cur = readManifest()
  let version = '0.0.0-local'
  try { version = JSON.parse(readFileSync(path.join(deck, 'package', 'package.json'), 'utf8')).version || version } catch { /* 保持占位 */ }
  const next = Object.assign({}, cur || {}, {
    name: (cur && cur.name) || 'dsh-mattpocock-skills-deck',
    version: (cur && cur.version) || version,
    private: true,
    type: 'module',
    _generated: 'deck/scripts/ensure-deck-manifest.mjs —— 合并形态的本地清单（上游 /package.json 被 gitignore，见 deck/.gitignore）。scripts.verify 由 tests/verify-*.js 派生，改门禁文件即自动进名单；不要手改这一条。',
    scripts: Object.assign({}, (cur && cur.scripts) || {}, {
      verify: r.chain,
      'test:smoke': r.smokeChain,
    }),
  })
  const drifted = !cur || currentChain(cur) !== r.chain || cur.type !== 'module' || cur.name !== next.name
  return { roster: r, next, drifted, existed: !!cur }
}

function currentChain(m) { return String((m.scripts && m.scripts.verify) || '') }

function main() {
  const { roster, next, drifted, existed } = planFor()
  if (argv.includes('--print')) { console.log(roster.chain); return 0 }
  if (argv.includes('--check')) {
    if (!existed) { console.error('FAIL deck/package.json 不存在（名单来源缺失）'); return 1 }
    if (drifted) { console.error('FAIL deck/package.json 的 scripts.verify 与 tests/verify-*.js 派生结果不一致'); return 1 }
    console.log('OK deck/package.json 名单与 tests/verify-*.js 一致（' + roster.gates.length + ' 道门禁 + ' + roster.smokes.length + ' 道冒烟）')
    return 0
  }
  if (!drifted && existed) { console.log('deck/package.json 已是最新（' + roster.gates.length + ' 道门禁），未写盘'); return 0 }
  writeFileSync(MANIFEST, JSON.stringify(next, null, 2) + '\n')
  console.log((existed ? '已更新' : '已派生') + ' deck/package.json：' + roster.gates.length + ' 道门禁 + ' + roster.smokes.length + ' 道冒烟')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
