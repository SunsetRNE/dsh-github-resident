// verify-handoff-latest-sort.js — 状态栏 handoff 文档 mtime/sort 加固（BUG4 · issue #12）
// 用法: node tests/verify-handoff-latest-sort.js [entry...]（默认 host.js + package/lib/index.js 两个入口）
//
// 背景：DSH 沙箱里 fs.stat 返回的 info.mtime 形态不可控（Date 对象 / ISO 串 / 秒级 Unix / 本地化串 / null / undefined / NaN），
//       原实现 `typeof mt === 'number' ? mt : Date.parse(String(mt))` 在非 number 形态下任一无法 parse 的格式都得 NaN；
//       原 sort 单键 `b.mtime - a.mtime` 在两 mtime 相等/NaN 时返回 0/NaN → Array.sort 视为 equal → 原顺序保留；
//       fs.listDir 按名字典序返回 → 老文件天然排第一 → mds[0].name = 字典序最小 = 上一次写入。
//
// 修复（双重防御里的「副路径」）：
//   1) parseHandoffMtime(raw)  —— isFinite 严格校验 + Date 对象优先 → 任何无法 parse 的形态安全归 0
//   2) pickLatestHandoff(mds)  —— mtime desc 主键 + name desc 兜底（时间戳文件名 = 字典序 = 时间序）；
//      mtime 退化为 0 的退化形态（NaN/null/全 0/全等）一律走 name desc 兜底返回字典序最大
//
// 【#64 判据锚点变更 · 判据过期】原判据在两个入口电话体里分别找 parseHandoffMtime / pickLatestHandoff 的定义 ——
//   H6 #450 已把这一整块（原 host/index.js 324–477 的电话体）搬进 src/host/handoffClaim.js（拆分账本见
//   docs/design/837-host-index-wiring-ledger.md §7「H6 #450：认领交接…」），零打包构建逐字节复制成
//   package/lib/handoffClaim.js；两个入口只剩 `_handoff()` 的 `await import('./handoffClaim.js')` +
//   `createHandoffClaim({...})` 与 `harness.handle('wf.handoffLatest' / 'wf.handoffResolve')` 的委派。
//   证据：`git log --oneline -- src/host/handoffClaim.js` → 40ebd3a（2026-10-12「身份融合前的现状快照」，
//   178 行整块带入，此后未再改动）。故实现侧断言改锚到模块产物、入口只断言接线；
//   断言语义一条未减（isFinite / name desc 兜底 / 三条 resolve 路径 / 旧脆写法已删 / 7+3 case 全保留）。
//   实现侧检查不再按入口重复两遍 —— 因为实现本身已不在两个入口里各存一份（旧形态是「一源两物」）。
//
// 验收（按 issue #12 agent brief 验收标准节）：
//   a) 模块产物 package/lib/handoffClaim.js 含 parseHandoffMtime + pickLatestHandoff 定义；mtime 解析用 isFinite
//      严格校验；sort 含 name desc 兜底（b.name < a.name）；handoffResolve 在模块内注册；handoffLatest /
//      handoffResolve 均通过 helpers 实现（不再内联 sort）；两个入口都经 harness.handle 注册这两个端点并委派给模块实例。
//   b) sort 加固后，pickLatestHandoff 在以下 7 case 中行为符合契约：
//      - mtime=NaN（新文件，DSH 沙箱典型失败）+ 正常（旧文件） → 旧文件（sort 加固无法修复 mtime 倒挂）
//      - mtime=null（同上形态）
//      - mtime=0（stat 全失败，等价于全部退化） → 新文件（name desc 兜底）
//      - mtime 全等（全部相同 finite） → 新文件（name desc 兜底）
//      - mtime 全 NaN（DSH 沙箱全崩） → 新文件（name desc 兜底）
//      - 混合（new=valid + old=NaN）：new 文件 mtime 1000、old 文件 NaN→0 → 新文件（NaN→0 顺带修复）
//      - 正常有先后（new>old） → 新文件（mtime desc 主键生效）
//
// 注：「1 case 旧文件」由主路径（client 端 handoffFile → host.handoffResolve(name)）独立保障，
//     本测试只覆盖 sort 加固的子路径契约。
import fs from 'node:fs'
import assert from 'node:assert'
import { compileFn } from './lib/eval-probe.js'

const entries = process.argv.slice(2).length ? process.argv.slice(2) : ['host.js', 'package/lib/index.js']
// 承载实现的模块产物（产物侧）：零打包构建把 src/host/handoffClaim.js 逐字节复制到这里。
const MODULE = 'package/lib/handoffClaim.js'

const OLD_PARSE_RE = /typeof\s+\w+\s*===\s*['"]number['"]\s*\?\s*\w+\s*:\s*\(\s*\w+\s*\?\s*Date\.parse/
const OLD_SORT_RE = /mds\.sort\(function\s*\(a,\s*b\)\s*\{\s*return\s+b\.mtime\s*-\s*a\.mtime/

// ---- Part A-1：静态契约 · 承载实现的模块产物 ----
const moduleStatChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  // 1) helpers 存在
  ok('parseHandoffMtime helper 定义', src.includes('const parseHandoffMtime'))
  ok('pickLatestHandoff helper 定义', src.includes('const pickLatestHandoff'))
  // 2) mtime 解析：isFinite 严格校验（替代脆 Date.parse 单一路径）
  ok('mtime 解析用 isFinite 校验', src.includes('isFinite'))
  ok('mtime 解析覆盖 typeof number 分支', /typeof\s+\w+\s*===\s*['"]number['"]/.test(src))
  // 3) sort：name desc 兜底（不是只看 mtime）
  ok('sort 含 name desc 兜底（b.name < a.name）', /b\.name\s*<\s*a\.name/.test(src))
  // 6) handoffResolve 接 args.name
  ok('handoffResolve 处理 args.name', /args(?:\s*&&\s*args)?\.name/.test(src) && /args\.name/.test(src))
  // 7) 三种路径：命中（name 在目录里）/ fallback（无 args.name，走 mtime 最新）/ strict-miss（args.name 有但文件不存在 → null，不退化）
  ok('handoffResolve 命中优先：返回 args.name', src.includes('return { ok: true, file: want }') || /file:\s*want\b/.test(src))
  ok('handoffResolve fallback（无 args.name）：走 mtime 最新', /!want/.test(src) && /pickLatestHandoff\(/.test(src))
  ok('handoffResolve strict-miss（有 args.name 但不在目录）：返回 file=null', /!want/.test(src) && /file:\s*null/.test(src))
  // 8) 旧脆路径已删（typeof number 单分支 + Date.parse 串行脆解析）
  ok('旧脆单行解析已删（no `typeof ... ? ... : Date.parse(String(...))` 单行脆模式）', !OLD_PARSE_RE.test(src))
  ok('旧脆 sort 已删（no inline `mds.sort(function (a, b) { return b.mtime - a.mtime })`)', !OLD_SORT_RE.test(src))
}

// ---- Part A-2：静态契约 · 入口接线（两个端点各自注册 + 委派给模块实例） ----
const entryStatChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  const wf = tag === 'npm' ? '' : 'wf.'  // host.js 注册名带 wf. 前缀；package/lib/index.js 不带（两入口现在都是 'wf.*' 端点名，保留原判据口径）
  // 4) handoffLatest 仍注册
  ok('handoffLatest 仍注册（' + (wf + 'handoffLatest') + '）', src.includes(wf + 'handoffLatest') || src.includes("'handoffLatest'"))
  // 5) handoffResolve 新注册
  ok('handoffResolve 新注册（' + (wf + 'handoffResolve') + '）', src.includes(wf + 'handoffResolve') || src.includes("'handoffResolve'"))
  // 接线：两个端点都经 harness.handle 注册，并委派给动态加载出来的模块实例
  ok('入口经 harness.handle 注册两个端点（wf.handoffLatest / wf.handoffResolve）', src.includes("harness.handle('wf.handoffLatest'") && src.includes("harness.handle('wf.handoffResolve'"))
  ok('入口动态 import 承载模块并建实例（./handoffClaim.js + createHandoffClaim）', src.includes("await import('./handoffClaim.js')") && src.includes('createHandoffClaim('))
  ok('两个端点委派给模块的 handler（handleHandoffLatest / handleHandoffResolve）', src.includes('h.handleHandoffLatest') && src.includes('h.handleHandoffResolve'))
  ok('入口不再内联旧脆解析/旧脆 sort（实现只在模块产物里一份）', !OLD_PARSE_RE.test(src) && !OLD_SORT_RE.test(src))
}

// ---- Part B：行为契约 —— 从模块产物抽 helper，直接调 pickLatestHandoff 验证 7+3 case ----
const extractHelpers = function (src) {
  // 提取 parseHandoffMtime + pickLatestHandoff 两个函数定义（按括号深度配对定位函数结尾）
  const grab = function (name) {
    const startRe = new RegExp('const\\s+' + name + '\\s*=\\s*function', 'm')
    const m = src.match(startRe)
    if (!m) throw new Error('helper ' + name + ' 未在源中找到')
    const start = m.index
    // 从 `function` 后第一个 `{` 开始统计大括号深度，配对到深度归 0 的 `}`
    const openIdx = src.indexOf('{', start)
    if (openIdx < 0) throw new Error('helper ' + name + ' 未找到 {')
    let depth = 1
    let i = openIdx + 1
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      i++
    }
    if (depth !== 0) throw new Error('helper ' + name + ' 大括号不配对')
    // 截到行尾（避免包到下一行注释/代码）
    let end = i
    while (end < src.length && src[end] !== '\n') end++
    return src.slice(start, end)
  }
  return grab('parseHandoffMtime') + '\n' + grab('pickLatestHandoff')
}

const runPickLatest = function (helperSrc, mds) {
  // 本处走 compileFn：参数名给 mds，函数体与原来逐字相同。
  const $ = compileFn(
    ['mds'],
    helperSrc + '\n; return pickLatestHandoff(mds)'
  )
  return $(mds)
}

// 文件命名约定（按时间戳）：YYYYMMDD-HHMMSS.md
// 字典序小 = 时间早 = 旧文件；字典序大 = 时间晚 = 新文件
const OLD = '20260818-074046.md'
const NEW = '20260818-091652.md'

const scenarios = [
  {
    name: 'mtime=NaN（新）+ 正常（旧）→ 旧文件（sort 加固无法区分 mtime 倒挂，主路径兜底）',
    mds: [{ name: OLD, mtime: 1787010180000 }, { name: NEW, mtime: NaN }],
    expect: OLD,
    expectKind: 'sort-subpath-cannot-fix',
  },
  {
    name: 'mtime=null（新）+ 正常（旧）→ 旧文件（同上）',
    mds: [{ name: OLD, mtime: 1787010180000 }, { name: NEW, mtime: null }],
    expect: OLD,
    expectKind: 'sort-subpath-cannot-fix',
  },
  {
    name: 'mtime 全 0（stat 全失败）→ 新文件（name desc 兜底）',
    mds: [{ name: OLD, mtime: 0 }, { name: NEW, mtime: 0 }],
    expect: NEW,
    expectKind: 'sort-subpath-fix',
  },
  {
    name: 'mtime 全等（同 finite）→ 新文件（name desc 兜底）',
    mds: [{ name: OLD, mtime: 1787000000000 }, { name: NEW, mtime: 1787000000000 }],
    expect: NEW,
    expectKind: 'sort-subpath-fix',
  },
  {
    name: 'mtime 全 NaN → 新文件（NaN→0 + name desc 兜底）',
    mds: [{ name: OLD, mtime: NaN }, { name: NEW, mtime: NaN }],
    expect: NEW,
    expectKind: 'sort-subpath-fix',
  },
  {
    name: '混合（new=valid + old=NaN）→ 新文件（NaN→0 顺带修复）',
    mds: [{ name: OLD, mtime: NaN }, { name: NEW, mtime: 1787023412000 }],
    expect: NEW,
    expectKind: 'sort-subpath-fix',
  },
  {
    name: '正常有先后（new>old）→ 新文件（mtime desc 主键生效）',
    mds: [{ name: OLD, mtime: 1787010180000 }, { name: NEW, mtime: 1787023412000 }],
    expect: NEW,
    expectKind: 'sort-baseline',
  },
  {
    name: '空数组 → null（无交接文档）',
    mds: [],
    expect: null,
    expectKind: 'sort-baseline',
  },
  {
    name: '单文件 → 那个文件',
    mds: [{ name: NEW, mtime: 1787023412000 }],
    expect: NEW,
    expectKind: 'sort-baseline',
  },
  {
    name: 'parseHandoffMtime 处理 Date 对象（Date 实例 → getTime）',
    mds: [{ name: OLD, mtime: new Date(1787010180000) }, { name: NEW, mtime: new Date(1787023412000) }],
    expect: NEW,
    expectKind: 'sort-baseline',
  },
]

const main = async function () {
  let failed = false

  // ---- 承载实现的模块产物：实现侧（Part A-1 + Part B）断言都打在这里 ----
  console.log('=== ' + MODULE + ' ===（承载实现的模块产物 · 零打包自 src/host/handoffClaim.js）')
  const modSrc = fs.readFileSync(MODULE, 'utf8')
  const modTag = 'mod'
  console.log('-- Part A 静态契约（实现侧） --')
  let modOk = true
  try { moduleStatChecks(modSrc, modTag) } catch (e) { modOk = false; failed = true; console.log('  FAIL ' + modTag + ' Part A — ' + e.message) }
  if (modOk) {
    console.log('-- Part B 行为契约（pickLatestHandoff 7+3 case · helper 从模块产物抽） --')
    let helperSrc
    try { helperSrc = extractHelpers(modSrc) } catch (e) { failed = true; console.log('  FAIL ' + modTag + ' 提取异常 — ' + e.message); helperSrc = null }
    if (helperSrc) {
      for (const s of scenarios) {
        try {
          const got = runPickLatest(helperSrc, s.mds)
          assert.strictEqual(got, s.expect, '期望 ' + s.expect + '，实际 ' + got)
          console.log('  PASS ' + modTag + ' · ' + s.name)
        } catch (e) { failed = true; console.log('  FAIL ' + modTag + ' · ' + s.name + ' — ' + e.message) }
      }
    }
  }

  // ---- 两个入口：只断言接线（注册 + 委派），实现侧断言已在上面打过 ----
  for (const file of entries) {
    const tag = file.indexOf('package/') >= 0 ? 'npm' : 'dyn'
    console.log('=== ' + file + ' ===（入口接线）')
    const src = fs.readFileSync(file, 'utf8')
    console.log('-- Part A 静态契约（入口接线） --')
    try { entryStatChecks(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part A — ' + e.message) }
  }

  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}
main()
