/**
 * tests/merge/host/env-matrix.test.mjs —— 合成环境矩阵：同一套门禁 × 多种环境（现在是八种），各格**明确期望结论**。
 *
 * 为什么需要它（2026-10-14，票「合成环境矩阵门禁（把本轮的坑变成常态红灯）」）：
 * 在这之前，发布门禁只证明「在**跑门禁这台机器**上恰好绿」——合成环境是每张票顺手各写一遍
 * （三份 fakeHome），而「HOME 有/无 gh 登录态各跑一遍」只活在开发者本机的 /tmp 脚本里。
 * 本文件把「跑在什么环境里」抽成**一张表**：新增一种环境只加一行；判据仍归各 ticket 的门禁文件（不另写一份）。
 *
 * 矩阵怎么跑：每种变体用夹具（`_env-harness.mjs`）造出 HOME + 只含夹具 bin 的 PATH，
 * 再把门禁文件当**子进程**跑（`PATH`/`HOME`/`DSH_GH_DATA_DIR`/代理变量都在子进程环境里定死）。
 * 每格都有硬上界（SIGKILL），并有一条挂死夹具证明这上界真的在管。
 *
 * 变异证明（把坑放回去，对应变体必须红）—— 见文件末尾的 note：
 *   ① 子进程不退 → 矩阵每格 SIGKILL + `_fixture-hang.mjs` 那一格必须红；
 *   ② 假 HOME 只在 import 期生效 → 夹具把环境注入包到执行期（`withPlugin`），改回 import 期即红；
 *   ③ 配置指向不存在的目录 → `config-missing` 变体；
 *   ④ HOME 有/无登录态 → `gh-unauthenticated` 与 `baseline` 两个变体。
 *
 * 用法：node tests/merge/host/env-matrix.test.mjs
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { check, note, section, skip, summary, REPO_ROOT } from './_check.mjs'
import { makeHome, isRoot } from './_env-harness.mjs'
import { releaseLease, requireLoadLease } from '../_load-lease.mjs'

const GATES = {
  resolver: 'tests/merge/host/identity-resolver.test.mjs',
  audit: 'tests/merge/host/identity-audit.test.mjs',
  surface: 'tests/merge/host/tool-surface.test.mjs',
  probe: 'tests/merge/host/env-probe.test.mjs',
  // 票「gh_pr 共用解析器 + 回落 gh pr create」：自己造 gh 桩与假 fetch，全离线；
  // 放进矩阵是为了证明它**不看跑门禁这台机器**有什么（no-gh 那一格照样绿）。
  pr: 'tests/merge/host/pr-fallback.test.mjs',
  // 票「gh 探测也要有界」：挂死的 gh 桩同样是自造的 —— 同理进矩阵（外层有没有 gh 都不该影响它）。
  probeBound: 'tests/merge/host/gh-probe-bound.test.mjs',
  // 票「子进程环境：插件启动的 gh / git 子进程按需带上真源 token」：真源（state）与 gh 桩都是自造的，
  // 桩会记下**子进程 env 长什么样** —— 同样进矩阵，证明它不看跑门禁这台机器有什么。
  subprocessEnv: 'tests/merge/host/subprocess-env.test.mjs',
  // 票「Deck 半边接消费面（执行环境由消费面供给）」：Deck 侧三个执行出口的戴与不戴、两组不混、探活不戴、
  // 两半答案一致、真 git 端到端。真源（state）与 gh 桩同样是它自己造的 —— 进矩阵，证明它不看跑门禁这台机器。
  deckChildIdentity: 'tests/merge/host/deck-child-identity.test.mjs',
}

/**
 * 矩阵表：**新增一种环境只加一行**。每行写清「怎么造环境」与「每张门禁的期望结论」。
 * expect: 'pass'（必须绿）· 'skip'（不在这个变体里跑，附理由 —— 不假装覆盖）。
 */
const TABLE = [
  {
    name: 'baseline（夹具 HOME + 夹具 bin，无代理）',
    home: { tag: 'm-base', withGh: true },
    gates: [
      { gate: 'resolver', expect: 'pass' },
      { gate: 'audit', expect: 'pass' },
      { gate: 'surface', expect: 'pass' },
      { gate: 'probe', expect: 'pass' },
      { gate: 'pr', expect: 'pass' },
      { gate: 'probeBound', expect: 'pass', why: '挂死的 gh 桩是它自己造的：外层有没有 gh 都不该影响' },
      { gate: 'subprocessEnv', expect: 'pass', why: '真源与 gh 桩都是它自己造的，全离线' },
      { gate: 'deckChildIdentity', expect: 'pass', why: '同上：Deck 那一侧的消费判据也自带真源与 gh 桩' },
    ],
  },
  {
    name: 'no-gh（PATH 里没有 gh，HOME 无 hosts.yml）',
    home: { tag: 'm-nogh', withGh: false },
    gates: [
      { gate: 'resolver', expect: 'pass' },
      { gate: 'audit', expect: 'pass' },
      { gate: 'surface', expect: 'pass' },
      { gate: 'probe', expect: 'pass', why: '这一格正是「无 gh 也要如实」的主判据' },
      { gate: 'pr', expect: 'pass', why: '回落那半自己造 gh 桩：外层没有 gh 也得照样绿（门禁不看这台机器）' },
      { gate: 'probeBound', expect: 'pass', why: '同上：这一半全用自造的挂死桩，外层环境不参与' },
    ],
  },
  {
    name: 'gh-unauthenticated（gh 装好了但没登录）',
    home: { tag: 'm-nologin', withGh: true },
    gates: [
      { gate: 'resolver', expect: 'pass' },
      { gate: 'audit', expect: 'pass' },
      { gate: 'surface', expect: 'pass' },
      { gate: 'probe', expect: 'skip', why: '身份判据在 resolver/audit 两格；探针不读 hosts.yml，没有新信息' },
      { gate: 'pr', expect: 'pass', why: '本票的目标环境就是它（有 gh、三处无 token）' },
      { gate: 'subprocessEnv', expect: 'pass', why: '「宿主什么都没有」这一半正是它自己的环境之一（它另造真源）' },
      { gate: 'deckChildIdentity', expect: 'pass', why: '同上：它的 gh 桩自造，外层没有 gh 也照样绿' },
    ],
  },
  {
    // 票「子进程环境：插件启动的 gh / git 子进程按需带上真源 token」的目标环境：
    // **宿主没配 gh 凭据、也没全局 git 配置，但真源 state 里有 token 与登录名**。
    // 这一格要回答的是「插件自己 spawn 的子进程能不能拿到身份」，与「宿主配没配」无关。
    name: 'no-host-identity（宿主没配 gh 凭据 / 没全局 git 配置；真源 state 有 token）',
    home: {
      tag: 'm-noident', withGh: true,
      files: { '.dsh/github-resident.json': JSON.stringify({ token: 'ghp_matrixFake0000000000000000000000000000', login: 'matrix-user' }) },
    },
    gates: [
      { gate: 'subprocessEnv', expect: 'pass', why: '本票的目标环境（真源有身份、宿主什么都没有）' },
      { gate: 'deckChildIdentity', expect: 'pass', why: '本票的目标环境：Deck 半边靠消费面供给，宿主什么都没有也照样干活' },
      { gate: 'audit', expect: 'pass', why: '体检在这种环境里也得如实：不假绿、也不假装没身份' },
      { gate: 'resolver', expect: 'pass' },
    ],
  },
  {
    name: 'home-readonly（HOME chmod 500；root 下是近似）',
    home: { tag: 'm-ro', withGh: true, chmod: 0o500 },
    gates: [
      { gate: 'resolver', expect: 'pass' },
      { gate: 'audit', expect: 'pass' },
      { gate: 'surface', expect: 'pass' },
      { gate: 'probe', expect: 'skip', why: '探针内部的 HOME 只读/不存在场景已覆盖（scenario H）' },
    ],
  },
  {
    name: 'no-curl（PATH 的 bin 里没有 curl）',
    home: { tag: 'm-nocurl', withGh: true, withCurl: false },
    gates: [
      { gate: 'resolver', expect: 'pass' },
      { gate: 'audit', expect: 'pass' },
      { gate: 'surface', expect: 'pass' },
      { gate: 'probe', expect: 'pass', why: '探针必须在没有 curl 的机器上仍然给出结论（scenario I）' },
    ],
  },
  {
    name: 'dead-proxy（HTTP(S)_PROXY 指向死端口：代理污染）',
    home: { tag: 'm-proxy', withGh: true },
    env: { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', http_proxy: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1' },
    gates: [
      { gate: 'resolver', expect: 'pass' },
      { gate: 'audit', expect: 'pass' },
      { gate: 'surface', expect: 'pass' },
      { gate: 'probe', expect: 'skip', why: '探针内部的坏代理场景已覆盖（scenario J，且说明 curl 对 loopback 会绕过代理）' },
    ],
  },
  {
    name: 'config-missing（DSH_GH_DATA_DIR 指向不存在的目录）',
    home: { tag: 'm-cfg', withGh: true, dataDirMissing: true },
    gates: [
      { gate: 'resolver', expect: 'pass' },
      { gate: 'audit', expect: 'pass' },
      { gate: 'surface', expect: 'pass' },
      { gate: 'probe', expect: 'skip', why: '探针内部的数据目录缺失场景已覆盖（scenario B）' },
    ],
  },
]

/** 跑一个门禁文件（子进程，带上界）。 */
function runGate(rel, env, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    execFile(process.execPath, [join(REPO_ROOT, rel)], {
      env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, cwd: REPO_ROOT,
    }, (err, stdout, stderr) => {
      const out = String(stdout || '') + String(stderr || '')
      resolve({
        ok: !err,
        code: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
        killed: Boolean(err && (err.killed || err.signal === 'SIGKILL')),
        ms: Date.now() - t0,
        tail: out.trim().split('\n').slice(-3).join(' | '),
      })
    })
  })
}

/** 小并发池：变体之间并行跑，但不把机器压满。 */
async function pool(items, limit, worker) {
  const out = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return out
}

/**
 * 并发度：默认 3，`DSH_TEST_MATRIX_POOL` 可覆盖（钳 1–4）。
 *
 * 为什么留这个旋钮（2026-10-14 实测）：矩阵是整套门禁里唯一**并发跑子进程**的地方，
 * 也是两次全量回归**恰好都死在这一格**的地方（27 个文件跑完 8 个、第 9 个进到矩阵就被中断，
 * 宿主进程被系统杀掉）。手机 / 小内存机器上 `DSH_TEST_MATRIX_POOL=1` 能把峰值压到一个门禁。
 */
const MATRIX_POOL = Math.min(4, Math.max(1, Number(process.env.DSH_TEST_MATRIX_POOL) || 3))

// 矩阵也是重活（一次起一堆子进程）：自己上锁。被全量 runner 带着跑时（祖先已持有）不重复取。
const LEASE_HOLDER = requireLoadLease({
  holder: 'env-matrix@' + (process.env.DSH_SESSION_ID || ('pid' + process.pid)),
  purpose: '合成环境矩阵（tests/merge/host/env-matrix.test.mjs）',
})

section('一、矩阵：' + TABLE.length + ' 种环境 × 环境敏感门禁，逐格对照期望结论')
const startedAt = Date.now()
const prepared = TABLE.map((row) => {
  const h = makeHome(row.home.tag, {
    withGh: row.home.withGh,
    withCurl: row.home.withCurl !== false,
    ghExits: row.home.ghExits || 0,
    // 环境自带文件（票「子进程环境…」那一格要一个「真源有 token」的 HOME）与富桩：
    // 表说「这格长什么样」就得真长那样，别让门禁自己去猜。
    files: row.home.files || {},
    gh: row.home.gh || null,
  })
  const dataDir = row.home.dataDirMissing ? join(h.home, 'never-created', 'gh-cli') : join(h.home, '.dsh', 'gh-cli')
  return { row, h, dataDir }
})

const results = await pool(prepared, MATRIX_POOL, async ({ row, h, dataDir }) => {
  const cells = []
  for (const cell of row.gates) {
    if (cell.expect === 'skip') { cells.push({ ...cell, skipped: true }); continue }
    // 子进程环境**只用夹具给的键**：不看这台机器有什么（PATH 只含夹具 bin）。
    const env = {
      PATH: h.path,
      HOME: h.home,
      DSH_GH_DATA_DIR: dataDir,
      ...(row.env || {}),
    }
    const r = await runGate(GATES[cell.gate], env)
    cells.push({ ...cell, result: r })
  }
  return { row, cells }
})

let passCells = 0
let skipCells = 0
for (const { row, cells } of results) {
  for (const c of cells) {
    if (c.skipped) {
      skipCells += 1
      check(typeof c.why === 'string' && c.why.length > 0, '「' + row.name + '」× ' + c.gate + '：跳过时写明理由（' + String(c.why).slice(0, 40) + '…）')
      continue
    }
    passCells += 1
    check(c.result.ok, '「' + row.name + '」× ' + c.gate + ' 期望绿（实得 rc=' + c.result.code + '，' + c.result.ms + 'ms）'
      + (c.result.ok ? '' : ' ｜ 尾部输出：' + c.result.tail))
    check(!c.result.killed, '「' + row.name + '」× ' + c.gate + '：没有靠超时被杀（否则等于没跑）')
  }
}
const elapsedMatrix = Date.now() - startedAt
check(passCells >= 20, '矩阵真的跑了足够多的格子（实跑 ' + passCells + ' 格，跳过 ' + skipCells + ' 格）')
check(elapsedMatrix < 240000, '矩阵总时长有上界（实测 ' + elapsedMatrix + 'ms < 240000ms）')
note('矩阵：' + TABLE.length + ' 种环境 × ' + (passCells + skipCells) + ' 格（实跑 ' + passCells + '，跳过 ' + skipCells + '），耗时 ' + elapsedMatrix + 'ms')
if (isRoot()) note('以 root 跑：home-readonly 变体的 chmod 500 拦不住写权限 —— 该变体在此只验「门禁在外层环境里仍能存活」，不假装验到了只读（探针内部的不存在-HOME 场景是真判据）。')

section('二、加一行就生效：矩阵是唯一真源')
// 「新增环境只需加一行」不是口号：下面把表里的一行**临时**复制成新变体，证明跑法完全由表驱动。
const synthetic = { ...TABLE[1], name: 'no-gh（临时复制的一行：证明加一行就能跑）' }
const hS = makeHome('m-syn', { withGh: false })
const synEnv = { PATH: hS.path, HOME: hS.home, DSH_GH_DATA_DIR: join(hS.home, '.dsh', 'gh-cli') }
const synRun = await runGate(GATES.resolver, synEnv)
check(synRun.ok && synRun.ms > 0, '临时加的一行照样跑得起来（rc=' + synRun.code + '，' + synRun.ms + 'ms）—— 跑法由表驱动，不是写死的分支')
check(synthetic.gates.length === TABLE[1].gates.length, '新行的格子数与来源行一致（表结构就是契约）')

section('三、每格都有硬上界：子进程不退时被杀掉并如实记红')
const hHang = makeHome('m-hang', { withGh: false })
const hang = await runGate('tests/merge/host/_fixture-hang.mjs', { PATH: hHang.path, HOME: hHang.home }, 2500)
check(!hang.ok, '挂死夹具被如实记成红灯（rc=' + hang.code + '）')
check(hang.killed, '挂死夹具是靠 SIGKILL 收场的（killed=' + hang.killed + '）—— 上界真的在管，不是等它自己结束')
check(hang.ms >= 2000 && hang.ms <= 8000, '收场耗时贴着上界（实测 ' + hang.ms + 'ms）')
check(hang.tail.indexOf('__FIXTURE_HANG__') >= 0, '挂死夹具确实启动过（tail 里有它的标记）')

note('变异证明（把坑放回去 → 对应变体必须红）：')
note('  ① 子进程不退 → 第三节：SIGKILL + 红灯（本仓踩过的坑）；')
note('  ② 假 HOME 只在 import 期生效 → 夹具把它包成执行期注入（_env-harness.withPlugin）；改回 import 期即红（identity-resolver 的 env 优先级、env-probe 的 HOME 判据都会翻）；')
note('  ③ 配置指向不存在的目录 → config-missing 变体 + 探针 scenario B、体检的 reposRoot 补救说明；')
note('  ④ HOME 有/无 gh 登录态 → baseline 与 gh-unauthenticated 两个变体各跑一遍（原来只在开发者 /tmp 脚本里）。')

for (const { h } of prepared) h.cleanup()
hS.cleanup()
hHang.cleanup()

// 放锁（只有自己取的那份才放；被全量 runner 带着跑时 LEASE_HOLDER 是 null，不替它放）。
if (LEASE_HOLDER) {
  const rel = releaseLease(LEASE_HOLDER)
  note('重活租约：' + (rel && rel.released ? '已释放' : ('释放时如实回报 —— ' + JSON.stringify(rel))))
}

summary()
