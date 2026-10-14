/**
 * tests/merge/host/load-lease.test.mjs —— 票「重活租约：同一台机器上的全量门禁一次只许一份」的门禁。
 *
 * 它要回答的是三件事，缺一件这个机制就是纸糊的：
 *   ① **工具**（`gh_load_lease`）的语义：没人时拿得到、有人时拿不到（并说清是谁）、
 *      放锁只认持有者、**陈旧可回收且回收看得见**（持有者死了 / 过期）；
 *   ② **runner 自锁**：锁被占着时 `tests/merge/run.mjs` **一个门禁子进程都不起**，
 *      如实回 `BLOCKED-LOAD-LEASE` + 退出码 2；没人占时它自己取、跑完自己放；
 *   ③ **两边只有一处会漂移**：落点路径 / 环境变量名 / 默认 TTL 在「插件」与「runner」两侧一致（静态比对），
 *      协议 `load` 段与工具真回执对得上。
 *
 * 隔离：全程用夹具 HOME + `DSH_GH_LOAD_LEASE` 指向夹具里的租约文件；不起重活（只跑一个最小的门禁文件）。
 * 用法：node tests/merge/host/load-lease.test.mjs
 */
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { check, note, readText, REPO_ROOT, section, summary } from './_check.mjs'
import { makeHome, withPlugin } from './_env-harness.mjs'

const ENV_FILE = 'DSH_GH_LOAD_LEASE'
const ENV_HELD = 'DSH_GH_LOAD_LEASE_HELD'
const SMALL_GATE = 'assembly-lifecycle'   // 用来验「取到锁 → 跑 → 放锁」的最小门禁（一个文件，秒级）

const homes = []
const home = (tag, opts) => { const h = makeHome(tag, opts); homes.push(h); return h }
const cleanup = () => { for (const h of homes) h.cleanup() }

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }

/** 跑一次 runner（子进程），回 `{ code, out }`。`lease` 给的是租约文件路径（要占锁时先自己写好）。 */
function runRunner(args, lease, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, 'tests', 'merge', 'run.mjs'), ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, [ENV_FILE]: lease, ...extraEnv },
    })
    let out = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { out += c })
    child.on('close', (code) => resolve({ code, out }))
  })
}

// ---------------------------------------------------------------------------
section('一、工具：拿得到 / 拿不到 / 只认持有者 / 陈旧可回收')

const h = home('lease-a', { withGh: true })
const leaseFile = join(h.home, 'load-lease.json')
const leaseEnv = { [ENV_FILE]: leaseFile }

await withPlugin(h.home, { path: h.bin, dataDir: join(h.home, '.dsh', 'gh-cli'), env: leaseEnv }, async ({ tool }) => {
  const t = (args) => tool('gh_load_lease').execute(args, {})
  const proto = await tool('gh_protocol').execute({}, {})

  const before = await t({})
  check(before.ok === true && before.held === false && before.exists === false,
    '没有人跑时 status 如实回「没有人在跑重活」（' + JSON.stringify({ held: before.held, exists: before.exists }) + '）')

  const a1 = await t({ action: 'acquire', holder: 'gate/A', purpose: '门禁自测' })
  check(a1.ok === true && a1.acquired === true && a1.lease && a1.lease.holder === 'gate/A',
    '没人持有时 acquire 拿得到，且回执带上「谁、干什么、什么时候到期」')
  check(a1.reclaimed === undefined, '干净地拿到时**不**报回收（回收是另一件事，别混）')
  const onDisk = readJson(leaseFile)
  check(onDisk && onDisk.pid && onDisk.expiresAt && onDisk.holder === 'gate/A', '租约真的落盘（pid / 到期时间 / 持有者都在）')

  const a2 = await t({ action: 'acquire', holder: 'gate/B', purpose: '另一个对话' })
  check(a2.ok === false && a2.acquired === false && a2.heldBy && a2.heldBy.holder === 'gate/A',
    '有主时 acquire 拿不到，并**说清是谁在跑**（' + JSON.stringify(a2.heldBy && a2.heldBy.holder) + '）')

  const mid = await t({})
  check(mid.held === true && mid.lease && mid.lease.holder === 'gate/A' && mid.lease.pidAlive === true,
    'status 看得到持有者、pid 还活着、还没过期')

  const wrongRelease = await t({ action: 'release', holder: 'gate/B' })
  check(wrongRelease.ok === false && wrongRelease.released === false,
    'release 只认持有者：别人来放放不掉（回执写明不替别人放）')
  check(readJson(leaseFile) !== null, '别人放不掉之后，锁还在（没被误清）')

  // 陈旧回收：**持有者已经死了**（用一个已经退出并被回收的 pid）+ 已过期。
  const dead = spawn(process.execPath, ['-e', 'process.exit(0)'])
  const deadPid = dead.pid
  await new Promise((r) => dead.on('close', r))
  writeFileSync(leaseFile, JSON.stringify({
    holder: 'gate/dead', purpose: '上一轮被杀的门禁', pid: deadPid, host: 'fixture',
    at: new Date(Date.now() - 3600_000).toISOString(), ttlMs: 60_000,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  }, null, 2) + '\n', { mode: 0o600 })
  const stale = await t({})
  check(stale.held === true && stale.lease.stale === true && stale.lease.pidAlive === false,
    'status 能认出「陈旧」：持有人 pid 已经不在（pidAlive=false、stale=true）')
  const reclaimed = await t({ action: 'acquire', holder: 'gate/C', purpose: '接上被杀的上一轮' })
  check(reclaimed.ok === true && reclaimed.acquired === true && reclaimed.reclaimed && reclaimed.reclaimed.holder === 'gate/dead',
    '陈旧的那把**可以回收**，而且**回收这件事在回执里看得见**（reclaimed=' + JSON.stringify(reclaimed.reclaimed && reclaimed.reclaimed.holder) + '）')

  // 协议 `load` 段：说的是不是这个工具、字段与真回执对不对得上。
  const seg = proto.load
  check(!!seg, '协议里有 load 段')
  check(seg && seg.tool === 'gh_load_lease', 'load 段指向工具 gh_load_lease')
  check(seg && String(seg.leaseFile).includes('load-lease.json'), 'load 段写清了租约落点（' + (seg && seg.leaseFile) + '）')
  check(seg && Array.isArray(seg.rule) && seg.rule.some((r) => r.includes('拿不到就换时间')),
    'load 段的规矩里写明「拿不到就换时间，不硬跑」')
  const row = (proto.tools || []).find((x) => x.name === 'gh_load_lease')
  check(!!row, '协议表里有 gh_load_lease 那一行')
  const views = (seg && seg.views) || {}
  const declared = new Set([].concat(...Object.values(views)))
  check(declared.size > 0, 'load 段的 views 抓得到（抓不到说明判据失配，不是"没问题"）')
  const business = (r) => Object.keys(r || {}).filter((k) => k !== 'protocol' && k !== 'ok')
  const receiptKeys = [...new Set([
    ...business(a1), ...business(a2), ...business(stale), ...business(reclaimed), ...business(wrongRelease),
  ])]
  const undeclared = receiptKeys.filter((k) => !declared.has(k))
  check(undeclared.length === 0, '真回执里没有 views 没声明的键（多出来的：' + JSON.stringify(undeclared) + '）')
  check(row && JSON.stringify([...new Set(row.returns)].sort()) === JSON.stringify([...declared].sort()),
    '协议表那一行 == views 的并集（同一处声明派生，不是手抄）')

  const rel = await t({ action: 'release', holder: 'gate/C' })
  check(rel.ok === true && rel.released === true && readJson(leaseFile) === null, '持有者自己放得掉，且锁真的没了')
})

// ---------------------------------------------------------------------------
section('二、runner 自锁：拿不到就一个门禁子进程都不起')

const hR = home('lease-r', { withGh: true })
const leaseR = join(hR.home, 'runner-lease.json')
// 占锁的人就是**本门禁进程**（pid 活着，所以不是陈旧）：模拟「另一个对话正在跑」。
writeFileSync(leaseR, JSON.stringify({
  holder: '另一个对话@verify:merge', purpose: '全量门禁', pid: process.pid, host: 'fixture',
  at: new Date().toISOString(), ttlMs: 1800_000, expiresAt: new Date(Date.now() + 1800_000).toISOString(),
}, null, 2) + '\n', { mode: 0o600 })

const blocked = await runRunner(['--only', SMALL_GATE], leaseR)
check(blocked.code === 2, '锁被占着时 runner 退出码 = 2（实得 ' + blocked.code + '）')
check(blocked.out.includes('BLOCKED-LOAD-LEASE'), '如实回 BLOCKED-LOAD-LEASE（不是静默跳过、也不是假装绿）')
check(blocked.out.includes('另一个对话@verify:merge'), '回执里说清了是谁在跑（换时间才知道等谁）')
check(!/^== tests\/merge\//m.test(blocked.out), '**一个门禁子进程都没起**（输出里没有任何门禁文件标题行）')
check(readJson(leaseR) && readJson(leaseR).holder === '另一个对话@verify:merge', '被拒之后别人的锁原样还在')

rmSync(leaseR, { force: true })
const ran = await runRunner(['--only', SMALL_GATE], leaseR)
check(ran.code === 0, '没人占时 runner 照常跑（--only 一个小门禁；退出码 = ' + ran.code + '）')
check(/重活租约：已取得/.test(ran.out), '它**自己取了锁**（输出里有「已取得」）')
check(/重活租约：已释放/.test(ran.out), '跑完**自己放了锁**')
check(readJson(leaseR) === null, '跑完之后租约文件是空的（不留下需要别人回收的残骸）')

// 祖先已持有时不重复取：runner 的子进程带着记号，就应当直接放行。
const inherited = await runRunner(['--only', SMALL_GATE], leaseR, { [ENV_HELD]: 'ancestor-pid-1' })
check(inherited.code === 0 && /已由祖先进程持有/.test(inherited.out),
  '祖先进程已持有时（' + ENV_HELD + ' 在环境里）不重复取，直接跑')
check(readJson(leaseR) === null, '这种情形下子进程不会自己造一把锁出来')

// ---------------------------------------------------------------------------
section('三、两边只有一处会漂移：插件与 runner 的落点/环境变量/默认 TTL 一致')

const pluginSrc = readText('plugin.js')
const leaseSrc = readText('tests/merge/_load-lease.mjs')
check(pluginSrc.includes("'github-resident', 'load-lease.json'") && leaseSrc.includes("'github-resident', 'load-lease.json'"),
  '租约落点两边写的是同一个（~/.dsh/github-resident/load-lease.json）')
check(pluginSrc.includes("process.env.DSH_GH_LOAD_LEASE ||") && leaseSrc.includes("process.env[LEASE_FILE_ENV] ||"),
  '两边都认 DSH_GH_LOAD_LEASE 覆盖路径（常量名各写各的，值必须一样）')
check(leaseSrc.includes("LEASE_FILE_ENV = 'DSH_GH_LOAD_LEASE'") && pluginSrc.includes('DSH_GH_LOAD_LEASE'),
  '环境变量名一致：' + ENV_FILE)
check(leaseSrc.includes("LEASE_HELD_ENV = 'DSH_GH_LOAD_LEASE_HELD'") && pluginSrc.includes("LOAD_LEASE_HELD_ENV = 'DSH_GH_LOAD_LEASE_HELD'"),
  '「祖先已持有」的记号名一致：' + ENV_HELD)
check(pluginSrc.includes('LOAD_LEASE_DEFAULT_TTL_MS = 30 * 60 * 1000') && leaseSrc.includes('DEFAULT_TTL_MS = 30 * 60 * 1000'),
  '默认 TTL 一致（30 分钟）')
const runnerSrc = readText('tests/merge/run.mjs')
const matrixSrc = readText('tests/merge/host/env-matrix.test.mjs')
check(runnerSrc.includes('requireLoadLease(') && matrixSrc.includes('requireLoadLease('),
  '两个重活入口（runner 与矩阵）**自己取锁**（不是只写在文档里）')
check(/BLOCKED-LOAD-LEASE/.test(leaseSrc) && /BLOCKED-LOAD-LEASE/.test(runnerSrc) === false,
  '拒绝时的标记行由租约模块**一处**产出（runner 只引用它，不自己再写一遍）')

note('本用例没有跑全量门禁（那正是它要防的重活）：runner 那两条只跑一个最小门禁文件，其余全是工具语义与静态比对。')
note('锁是**协作式**的：不阻止别人手动删文件或另指定 ' + ENV_FILE + ' 硬跑（那是故意的逃生门，写在拒绝文案里）。')

cleanup()
summary()
