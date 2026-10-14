/**
 * tests/merge/host/gh-takeover.test.mjs —— gh 的**接管 ＋ 熔断**（票 47 手机现场收口）。
 *
 * 为什么要有它（2026-10-14 手机实测，不是推断）：没有 gh 的机器上，**每次启动**都会自动落地一次
 * （下载 ~15MB ＋ 在 JS 里把整包读进内存解包出 39MB）。若这一步在某台机器上是致命的，就成了
 * 「启动 → 落地 → 机器死 → 重启 → 又落地」的**自锁环**：现场表现是界面一直「检查中」/「接口不可达」，
 * 点任何要 gh 的东西都会白屏 —— 而且**每次重启都会再犯一次**。
 *
 * 判据（对抗式，逐格可证伪）：
 *   ① 没装、没记录 → 落地一次；**失败不算熔断**（pending 清掉、下次可再试）；
 *   ② 有能跑的一份 → **识别接管**（layer/path/version/size/sha256 入记录），不落地；
 *   ③ **确认接管之后不再重复**：同一份 HOME 再启动一次 → action=confirmed，且落地尝试数为 0；
 *   ④ 看见**没清掉的 pending**（＝上次落地没回来）→ **熔断**：不落地、如实报，唯一解闸口是 gh_cli_install；
 *   ⑤ 记录与磁盘**大小不符**（没写完的副本）→ 判定可疑：**绝不执行它**（桩会写一个「被执行过」的标记）→ 替换一次。
 *
 * 隔离：全部在 `_env-harness` 的合成环境里跑（假 HOME ＋ 夹具 bin），不碰真 HOME、不起真网络
 *（`DSH_GH_NET_TIMEOUT_MS=150` 把唯一的网络出口压到毫秒级，断言的是**决策**不是下载本身）。
 * 用法：node tests/merge/host/gh-takeover.test.mjs
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { check, note, section, summary } from './_check.mjs'
import { makeHome, withPlugin } from './_env-harness.mjs'

process.env.DSH_GH_NET_TIMEOUT_MS = '150'   // 唯一的网络出口压到毫秒级：这一件断言的是决策，不是下载
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const statePath = (home) => home + '/.dsh/gh-cli/install.json'
const readState = (home) => { try { return JSON.parse(readFileSync(statePath(home), 'utf8')) } catch { return null } }
const seedState = (home, obj) => {
  mkdirSync(home + '/.dsh/gh-cli', { recursive: true })
  writeFileSync(statePath(home), JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 })
}
/** 跑一次「启动」：加载插件 → 等接管跑完 → 读 gh_cli_resolve 的 takeover。 */
const bootAndRead = async (home, tag) => {
  let out = null
  await withPlugin(home, { dataDir: home + '/.dsh/gh-cli', runEffects: true }, async ({ tool }) => {
    await sleep(700)
    out = await tool('gh_cli_resolve').execute({}, {})
  })
  return { ...out, _tag: tag }
}

// ===========================================================================
section('一、没装、没记录 → 落地一次；失败不算熔断（下次启动可再试）')
// ===========================================================================
const hA = makeHome('takeover-a', { withGh: false, withGit: true })
try {
  const r = await bootAndRead(hA.home, 'a')
  check(r.takeover && r.takeover.action === 'failed',
    '没 gh、离线 → 这次落地失败（action=' + (r.takeover && r.takeover.action) + '）')
  const st = readState(hA.home)
  check(Boolean(st) && st.pending === null, '失败后 pending 被清掉（' + JSON.stringify(st && st.pending) + '）')
  check(Boolean(st && st.lastFailed), '失败如实记进 lastFailed（不是静默）')
  check(!(st && st.takeover && st.takeover.ok), '没写成的东西**不许**记成「已接管」')
} finally { hA.cleanup() }

// ===========================================================================
section('二、有能跑的一份 → 识别接管（不落地）')
// ===========================================================================
const hB = makeHome('takeover-b', { withGh: true, withGit: true })
try {
  const r = await bootAndRead(hB.home, 'b')
  check(r.takeover && r.takeover.action === 'adopted' && r.takeover.layer === 'system',
    '系统层有能跑的 gh → 识别接管（action=' + (r.takeover && r.takeover.action) + '，layer=' + (r.takeover && r.takeover.layer) + '）')
  const st = readState(hB.home)
  check(Boolean(st && st.takeover && st.takeover.ok && st.takeover.version),
    '接管记录落在插件自己的目录（version=' + (st && st.takeover && st.takeover.version) + '）')

  // ---- ③ 同一份 HOME 再启动一次：确认接管，且**一次落地尝试都没有** ----
  const before = readState(hB.home)
  const r2 = await bootAndRead(hB.home, 'b2')
  check(r2.takeover && r2.takeover.action === 'confirmed',
    '第二次启动＝确认接管（action=' + (r2.takeover && r2.takeover.action) + '）—— 不再重复执行接管')
  check(Array.isArray(r2.takeover && r2.takeover.attempts) && r2.takeover.attempts.length === 0,
    '确认那一趟的落地尝试数 = 0（' + JSON.stringify(r2.takeover && r2.takeover.attempts) + '）')
  const after = readState(hB.home)
  check(after && after.pending === null && after.takeover && after.takeover.at === before.takeover.at,
    '记录没被无谓改写（at 未变、pending 仍空）')
} finally { hB.cleanup() }

// ===========================================================================
section('三、看见没清掉的 pending（上次落地没回来）→ 熔断：不落地、如实报')
// ===========================================================================
const hC = makeHome('takeover-c', { withGh: false, withGit: true })
try {
  seedState(hC.home, { pending: { at: '2026-10-14T20:00:00.000Z', reason: 'first-run' } })
  const r = await bootAndRead(hC.home, 'c')
  check(r.takeover && r.takeover.action === 'breaker-open',
    '未清的 pending → 熔断（action=' + (r.takeover && r.takeover.action) + '）')
  check(r.takeover && r.takeover.ok === false && r.takeover.pendingAt === '2026-10-14T20:00:00.000Z',
    '如实带回那条待办的时间（不是笼统一句「失败了」）')
  check(String(r.takeover && r.takeover.note).includes('gh_cli_install'),
    '指出唯一解闸口（' + (r.takeover && r.takeover.note) + '）')
  const st = readState(hC.home)
  check(st && st.pending && st.pending.at === '2026-10-14T20:00:00.000Z',
    '熔断时**不改写**那条待办（等显式工具来清）')
} finally { hC.cleanup() }

// ===========================================================================
section('四、记录与磁盘不符（没写完的副本）→ 判定可疑：绝不执行它')
// ===========================================================================
const hD = makeHome('takeover-d', { withGh: false, withGit: true })
try {
  // 夹具缓存里放一份「一跑就会留痕」的桩，并把记录写成完全不符的大小
  mkdirSync(hD.home + '/.dsh/gh-cli/bin', { recursive: true })
  writeFileSync(hD.home + '/.dsh/gh-cli/bin/gh',
    '#!/bin/sh\ntouch "' + hD.home + '/SUSPECT_WAS_EXECUTED"\necho "gh version 9.9.9 (SUSPECT)"\n', { mode: 0o755 })
  seedState(hD.home, {
    installedAt: '2026-10-14T00:00:00.000Z', version: 'gh version 2.102.0 (2026-09-30)', arch: 'arm64', source: ['tarball'],
    takeover: { at: '2026-10-14T00:00:00.000Z', by: 'auto', layer: 'plugin-cache', path: hD.home + '/.dsh/gh-cli/bin/gh', version: 'gh version 2.102.0 (2026-09-30)', size: 39059616, sha256: 'deadbeef', ok: true },
    pending: null,
  })
  const r = await bootAndRead(hD.home, 'd')
  check(!existsSync(hD.home + '/SUSPECT_WAS_EXECUTED'),
    '大小与记录不符 → **那份副本一次都没被执行**（桩没留痕）')
  check(r.takeover && (r.takeover.action === 'repaired' || r.takeover.action === 'failed'),
    '判定为损坏并尝试替换一次（action=' + (r.takeover && r.takeover.action) + '）')
  check(Array.isArray(r.takeover && r.takeover.attempts) && r.takeover.attempts.length > 0,
    '替换真去试了（离线所以失败，但 attempts 有记录：' + JSON.stringify(r.takeover && r.takeover.attempts && r.takeover.attempts.map((a) => a.step)) + '）')
} finally { hD.cleanup() }

note('这一件钉的是**决策**：五种格子各自的动作与「确认之后不再重复」；真下载由 CI 的真网络那几件覆盖。')
summary()
