/**
 * tests/merge/host/load-lease.test.mjs —— 票「重活租约：同一台机器上的重活一次只许一份」的门禁。
 *
 * 它要回答的是这几件事，缺一件这个机制就是纸糊的：
 *   ① **工具**（`gh_load_lease`）的语义：没人时拿得到、有人时拿不到（并说清是谁）、
 *      放锁只认持有者、**陈旧可回收且回收看得见**（持有者死了 / 过期）；
 *   ② **runner 自锁**：锁被占着时 `tests/merge/run.mjs` **一个门禁子进程都不起**，
 *      如实回 `BLOCKED-LOAD-LEASE` + 退出码 2；没人占时它自己取、跑完自己放；
 *   ③ **半重那一族也自锁**（票 61）：`deck/scripts/verify-chain.js`（verify:deck，约 10 分钟 /
 *      几百个子进程）与 resident 那族（`verify-bundle.sh` / `verify-*.mjs`，verify:resident）
 *      跟 runner **共用同一把锁**：被占着就 exit 2 + `BLOCKED-LOAD-LEASE` 且一个子进程都不起；
 *      没人占就自己取、跑完自己放；祖先进程已持有时不重复取。bash 那半边引不了 JS 模块，
 *      走 `tests/merge/_load-lease-cli.mjs` 命令壳（同一把锁，不另开一把）。
 *   ④ **只有一处会漂移**：落点路径 / 环境变量名 / 默认 TTL / 「拒绝标记行」只在
 *      `tests/merge/_load-lease.mjs` 一处；所有消费者引它（静态比对，清单从
 *      `package.json` 的 `verify:resident` 派生 —— 新加一件也跑不掉取锁）。
 *
 * 隔离：全程用夹具 HOME + `DSH_GH_LOAD_LEASE` 指向夹具里的租约文件；**不真跑 311 道 deck 链**
 *（`--from 99999`：取了锁、跑 0 道就收；`--list` 是只读名单，本来就不占锁）、
 * 也不真跑 resident 那族（静态比对 + 命令壳的动态验证），更不碰
 * `~/.dsh/github-resident/load-lease.json` 里那把真锁。
 * 用法：node tests/merge/host/load-lease.test.mjs
 */
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { check, note, readText, REPO_ROOT, section, summary } from './_check.mjs'
import { makeHome, withPlugin } from './_env-harness.mjs'

const ENV_FILE = 'DSH_GH_LOAD_LEASE'
const ENV_HELD = 'DSH_GH_LOAD_LEASE_HELD'
const SHARED_LEASE = 'tests/merge/_load-lease.mjs'      // 唯一那一支（谁都不能抄第二份）
const SHELL_WRAPPER = 'tests/merge/_load-lease-cli.mjs' // bash 半边用的命令壳（还是那一支）
const SMALL_GATE = 'assembly-lifecycle'   // 用来验「取到锁 → 跑 → 放锁」的最小门禁（一个文件，秒级）

const homes = []
const home = (tag, opts) => { const h = makeHome(tag, opts); homes.push(h); return h }
const cleanup = () => { for (const h of homes) h.cleanup() }

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }

/** 读仓库内文本；**读不到就回空串**（让「这个入口还不存在」如实判 FAIL，而不是把门禁整个炸掉）。 */
const readIf = (rel) => { try { return readText(rel) } catch { return '' } }

/** 占锁的人就是**本门禁进程**（pid 活着，所以不是陈旧）：模拟「另一个对话正在跑」。 */
function holdLeaseAt(file, holder) {
  writeFileSync(file, JSON.stringify({
    holder, purpose: '全量门禁', pid: process.pid, host: 'fixture',
    at: new Date().toISOString(), ttlMs: 1800_000, expiresAt: new Date(Date.now() + 1800_000).toISOString(),
  }, null, 2) + '\n', { mode: 0o600 })
}

/**
 * 跑一个 node 子进程（相对仓库根），回 `{ code, out }`。`lease` 是租约文件路径。
 *
 * 把外层可能带着的「祖先已持有」记号**显式摘掉**（本票自己的门禁在全量 runner 下面跑过一遍，
 * 就是因为继承了它而误判：嵌套入口见状直接放行、压根没去取锁 —— 判据不许看环境）。
 */
function runChild(scriptRel, args, lease, extraEnv = {}) {
  return new Promise((resolve) => {
    const base = { ...process.env }
    delete base[ENV_HELD]
    const child = spawn(process.execPath, [join(REPO_ROOT, scriptRel), ...args], {
      cwd: REPO_ROOT,
      env: { ...base, [ENV_FILE]: lease, ...extraEnv },
    })
    let out = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { out += c })
    child.on('close', (code) => resolve({ code, out }))
  })
}

const runRunner = (args, lease, extraEnv = {}) => runChild('tests/merge/run.mjs', args, lease, extraEnv)

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
holdLeaseAt(leaseR, '另一个对话@verify:merge')   // 占锁的人 pid 活着 → 不是陈旧

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
section('三、半重那一族（verify:deck / verify:resident）也取**同一把**锁')

// 3.1 deck 门禁链：`--from 99999` = 取了锁 → 跑 0 道 → 放锁。**不真跑 311 道链**。
const hD = home('lease-deck', { withGh: true })
const leaseD = join(hD.home, 'deck-lease.json')
const DECK_SKIP_ALL = ['--from', '99999']

holdLeaseAt(leaseD, '另一个对话@verify:deck')
const deckBlocked = await runChild('deck/scripts/verify-chain.js', DECK_SKIP_ALL, leaseD)
check(deckBlocked.code === 2, '锁被占着时 deck 链退出码 = 2（实得 ' + deckBlocked.code + '）')
check(deckBlocked.out.includes('BLOCKED-LOAD-LEASE'), 'deck 链如实回 BLOCKED-LOAD-LEASE（那一行由租约模块一处产出）')
check(deckBlocked.out.includes('另一个对话@verify:deck'), 'deck 链的回执里说清了是谁在跑')
check(!/^verify-chain: 共/m.test(deckBlocked.out), '**一道门禁都没进执行段**（被拒时连「共 N 条」都不打印）')
check(readJson(leaseD) && readJson(leaseD).holder === '另一个对话@verify:deck', '被拒之后别人的锁原样还在')

rmSync(leaseD, { force: true })
const deckRan = await runChild('deck/scripts/verify-chain.js', DECK_SKIP_ALL, leaseD)
check(deckRan.code === 0, '没人占时 deck 链照常跑（--from 99999 → 0 道门禁；退出码 = ' + deckRan.code + '）')
check(/重活租约：已取得/.test(deckRan.out), 'deck 链**自己取了锁**')
check(/重活租约：已释放/.test(deckRan.out), 'deck 链跑完**自己放了锁**（退出路径不止一条，放锁挂在 exit 钩子上）')
check(readJson(leaseD) === null, '跑完之后租约文件是空的')

// 异常退出也放锁：`--only` 一个不存在的条目 → 取了锁之后 exit 1（不是被阻塞的 2）。
// 「跑挂了却把锁留在盘上」正是本票要防的那类残骸，所以这条单拎出来钉。
rmSync(leaseD, { force: true })
const deckEarlyExit = await runChild('deck/scripts/verify-chain.js', ['--only', 'zzz-不存在的条目'], leaseD)
check(deckEarlyExit.code === 1, '取到锁之后按自己的结论判红（退出码 1），不冒充「被阻塞」的 2（实得 ' + deckEarlyExit.code + '）')
check(readJson(leaseD) === null, '提前退出（exit 1）也把锁放了 —— 不留下要别人回收的残骸')

const deckInherited = await runChild('deck/scripts/verify-chain.js', DECK_SKIP_ALL, leaseD, { [ENV_HELD]: 'ancestor-pid-1' })
check(deckInherited.code === 0 && /已由祖先进程持有/.test(deckInherited.out),
  '祖先进程已持有时 deck 链不重复取（这条链自己会起几百个子进程，记号必须一路传下去）')
check(readJson(leaseD) === null, '这种情形下 deck 链不会自己造一把锁出来')

// 3.2 resident 那半边的 bash 入口：引不了 JS 模块 → 走命令壳（**还是那一支**）。
const hS = home('lease-shell', { withGh: true })
const leaseS = join(hS.home, 'shell-lease.json')
const shellArgs = ['--', 'node', '-e', "process.stdout.write('CHILD-RAN\\n'); process.exit(7)"]

holdLeaseAt(leaseS, '另一个对话@verify:resident')
const shellBlocked = await runChild(SHELL_WRAPPER, shellArgs, leaseS)
check(shellBlocked.code === 2, '锁被占着时命令壳退出码 = 2（实得 ' + shellBlocked.code + '）')
check(shellBlocked.out.includes('BLOCKED-LOAD-LEASE') && shellBlocked.out.includes('另一个对话@verify:resident'),
  '命令壳如实回 BLOCKED-LOAD-LEASE，并说清是谁在跑')
check(!shellBlocked.out.includes('CHILD-RAN'), '被拒时**被包住的那条命令一个都没起**')
check(readJson(leaseS) && readJson(leaseS).holder === '另一个对话@verify:resident', '被拒之后别人的锁原样还在')

rmSync(leaseS, { force: true })
const shellRan = await runChild(SHELL_WRAPPER, shellArgs, leaseS)
check(shellRan.code === 7, '没人占时照常跑，且**透传子进程退出码**（子进程 exit 7 → 实得 ' + shellRan.code + '）')
check(shellRan.out.includes('CHILD-RAN'), '被包住的命令真的跑了')
check(/重活租约：已取得/.test(shellRan.out) && /重活租约：已释放/.test(shellRan.out), '命令壳自己取、自己放')
check(readJson(leaseS) === null, '跑完之后租约文件是空的')

const shellInherited = await runChild(SHELL_WRAPPER, shellArgs, leaseS, { [ENV_HELD]: 'ancestor-pid-1' })
check(shellInherited.code === 7 && /已由祖先进程持有/.test(shellInherited.out),
  '祖先进程已持有时命令壳不重复取，直接透传着跑')
check(readJson(leaseS) === null, '这种情形下命令壳不会自己造一把锁出来')

// ---------------------------------------------------------------------------
section('四、只有一处会漂移：所有重活入口引同一支（落点 / 环境变量 / 默认 TTL / 拒绝行）')

const pluginSrc = readText('plugin.js')
const leaseSrc = readText(SHARED_LEASE)
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
check(leaseSrc.includes('export function holdLoadLease'),
  '那一支导出「取锁 + 退出即放」的短入口（半重那一族用它，不必各自抄一遍 exit 钩子）')

// 消费者清单从 package.json 的 verify:resident 派生 —— 以后新加一件 resident 体检也跑不掉取锁。
const pkg = JSON.parse(readText('package.json'))
const residentCmd = String(pkg.scripts['verify:resident'] || '')
const residentFiles = [...residentCmd.matchAll(/(?:node|bash)\s+([\w./-]+)/g)].map((m) => m[1])
check(residentFiles.length >= 9 && residentFiles.includes('verify-bundle.sh'),
  'verify:resident 清单抓得到（' + residentFiles.length + ' 件：' + residentFiles.join(' ') + '）')

/**
 * 取锁的三种写法都认；**不许自己写第二把锁**：这些文件里不许出现落点字面量或
 * 建租约用的 `flag: 'wx'` —— 出现就说明有人抄了一份实现（本仓刚立红灯的那种病）。
 */
const takesLock = (src) => /requireLoadLease\s*\(|holdLoadLease\s*\(/.test(src)
const importsShared = (src) => new RegExp("from\\s+'[^']*" + SHARED_LEASE.split('/').pop().replace('.', '\\.') + "'").test(src)
const copiesLock = (src) => /load-lease\.json/.test(src) || /flag:\s*'wx'/.test(src) || /LEASE_FILE_ENV\s*=/.test(src)

const consumers = [
  ['tests/merge/run.mjs', readIf('tests/merge/run.mjs')],
  ['tests/merge/host/env-matrix.test.mjs', readIf('tests/merge/host/env-matrix.test.mjs')],
  ['deck/scripts/verify-chain.js', readIf('deck/scripts/verify-chain.js')],
  [SHELL_WRAPPER, readIf(SHELL_WRAPPER)],
  ...residentFiles.filter((f) => f.endsWith('.mjs')).map((f) => [f, readIf(f)]),
]
for (const [name, src] of consumers) {
  check(importsShared(src) && takesLock(src), name + ' 引同一支（' + SHARED_LEASE + '）并自己取锁')
  check(!copiesLock(src), name + ' **没有**第二份实现 / 第二个落点（不许抄一份租约逻辑）')
}

const bundleSrc = readIf('verify-bundle.sh')
check(bundleSrc.includes(SHELL_WRAPPER) && bundleSrc.includes('DSH_GH_LOAD_LEASE_HELD') && /exec node/.test(bundleSrc),
  'verify-bundle.sh 是 bash：未持有记号时 re-exec 到命令壳（同一把锁，不是第二把）')
check(!copiesLock(bundleSrc), 'verify-bundle.sh 里也没有第二个落点')

const chainSrc = readIf('deck/scripts/verify-chain.js')
const cliShellSrc = readIf(SHELL_WRAPPER)
// 判「有没有第二处产出」要看**代码**：注释里写「拿不到就 exit 2 + BLOCKED-LOAD-LEASE」是在说规矩，
// 不是又拼了一遍文案。所以先按本仓惯例去掉注释再找（与 verify-no-cross-import 的 stripForScan 同款）。
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length))
const printsBlocked = (src) => /BLOCKED-LOAD-LEASE/.test(stripComments(src))
check(/BLOCKED-LOAD-LEASE/.test(leaseSrc) && !printsBlocked(chainSrc) && !printsBlocked(readIf('tests/merge/run.mjs')) && !printsBlocked(cliShellSrc),
  '拒绝时的标记行由租约模块**一处**产出（chain / runner / 命令壳只引用它，代码里不自己再写一遍）')
check(/--list/.test(chainSrc) && /只读名单，不占锁/.test(chainSrc),
  'deck 链的 --list 仍是只读名单（不占锁）—— 别的门禁要能在重活跑着的时候读名单')

note('本用例没有跑全量门禁（那正是它要防的重活）：runner 那两条只跑一个最小门禁文件；deck 链用 --from 99999 取锁后跑 0 道；resident 那族只静态比对 + 命令壳动态验证。')
note('锁是**协作式**的：不阻止别人手动删文件或另指定 ' + ENV_FILE + ' 硬跑（那是故意的逃生门，写在拒绝文案里）。')

cleanup()
summary()
