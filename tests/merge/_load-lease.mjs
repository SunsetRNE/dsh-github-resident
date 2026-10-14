/**
 * tests/merge/_load-lease.mjs —— 重活租约（与插件里的工具 `gh_load_lease` **同一份落点与格式**）。
 *
 * 为什么需要它（2026-10-14 实测，不是推测）：宿主进程被系统杀过 **6 次**
 * （00:35 / 00:51 / 01:07 / 01:17 上一轮记录的四次 + 02:16:05 / 02:18:58 本轮），
 * 签名都是「外部杀」（`repair-builtin.log` 多一行启动、无异常栈、日志无异常），凶手未定位；
 * 而相关性明确：**重活并跑 / 连着跑**。多个对话各跑一遍全量门禁，正是这个形状。
 *
 * 所以「锁」不能只写在文档里 —— runner 与矩阵**自己取**：拿不到就**如实拒绝**
 * （退出码 2 + `BLOCKED-LOAD-LEASE` 行，一个门禁子进程都不起），不静默跳过、不假装绿。
 *
 * 三处约定（改一处就得改另两处，`tests/merge/host/load-lease.test.mjs` 会静态比对）：
 *   ① 落点：`~/.dsh/github-resident/load-lease.json`（`DSH_GH_LOAD_LEASE` 可覆盖路径）；
 *   ② 记号：祖先进程已持有时把它写进 `DSH_GH_LOAD_LEASE_HELD`，子进程见到就不再取一次；
 *   ③ 语义：只在「没人持有 / 过期 / 持有人 pid 明确不在了」时拿到；回收要如实报出来。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'

export const LEASE_FILE_ENV = 'DSH_GH_LOAD_LEASE'
export const LEASE_HELD_ENV = 'DSH_GH_LOAD_LEASE_HELD'
export const DEFAULT_LEASE_FILE = join(homedir(), '.dsh', 'github-resident', 'load-lease.json')
export const DEFAULT_TTL_MS = 30 * 60 * 1000

export const leaseFile = () => process.env[LEASE_FILE_ENV] || DEFAULT_LEASE_FILE

/** pid 还活着吗？`null` = 没记 pid（不知道）；EPERM = 进程在、只是不是我的。 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try { process.kill(pid, 0); return true } catch (e) { return Boolean(e && e.code === 'EPERM') }
}

/** 租约的只读视图（与插件 `leaseView` 同口径）。 */
export function leaseView(lease) {
  if (!lease || typeof lease !== 'object') return null
  const alive = pidAlive(lease.pid)
  const expiresAt = typeof lease.expiresAt === 'string' ? lease.expiresAt : null
  const expired = expiresAt ? Date.parse(expiresAt) <= Date.now() : true
  return {
    holder: lease.holder || null, purpose: lease.purpose || null, pid: Number.isInteger(lease.pid) ? lease.pid : null,
    host: lease.host || null, at: lease.at || null, expiresAt, ttlMs: Number.isFinite(lease.ttlMs) ? lease.ttlMs : null,
    pidAlive: alive, expired, stale: expired || alive === false,
  }
}

export function readLease() {
  const file = leaseFile()
  try { return { file, exists: true, lease: JSON.parse(readFileSync(file, 'utf8')) } }
  catch { return { file, exists: false, lease: null } }
}

/** 取租约：没有 force，不抢别人的（只在陈旧/无人时成功）；回收事实如实带回。 */
export function acquireLease({ holder, purpose, ttlMs } = {}) {
  const file = leaseFile()
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.round(ttlMs) : DEFAULT_TTL_MS
  const me = {
    holder: String(holder || ('pid ' + process.pid)), purpose: String(purpose || '未注明'),
    pid: process.pid, host: hostname(), at: new Date().toISOString(),
    ttlMs: ttl, expiresAt: new Date(Date.now() + ttl).toISOString(),
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  let reclaimed = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(file, JSON.stringify(me, null, 2) + '\n', { mode: 0o600, flag: 'wx' })   // 原子：存在即失败
      return { ok: true, acquired: true, lease: me, reclaimed, file }
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return { ok: false, acquired: false, error: String((e && e.message) || e), file }
      const view = leaseView(readLease().lease)
      if (view && view.stale) { rmSync(file, { force: true }); reclaimed = view; continue }
      return { ok: false, acquired: false, heldBy: view, file }
    }
  }
  return { ok: false, acquired: false, error: '回收之后又撞上了（有人刚抢到）', file }
}

/** 放租约：只认持有者。 */
export function releaseLease(holder) {
  const { lease, file } = readLease()
  if (!lease) return { ok: true, released: false, note: '没有租约（已经是空的）' }
  const mine = holder ? String(lease.holder) === String(holder) : lease.pid === process.pid
  if (!mine) return { ok: false, released: false, heldBy: leaseView(lease), note: '租约不是你的：不替别人放' }
  rmSync(file, { force: true })
  return { ok: true, released: true, was: leaseView(lease) }
}

/**
 * 重活的入口：已由祖先持有时直接放行；否则取锁，**拿不到就退出 2**（如实拒绝，不跑任何东西）。
 * 返回持有者名字（放锁时用得上）；祖先进程持有时返回 null（那是它的锁，不归我放）。
 */
export function requireLoadLease({ holder, purpose }) {
  if (process.env[LEASE_HELD_ENV]) {
    console.log(`重活租约：已由祖先进程持有（${process.env[LEASE_HELD_ENV]}）—— 不重复取。`)
    return null
  }
  const got = acquireLease({ holder, purpose })
  if (!got.ok) {
    console.error('BLOCKED-LOAD-LEASE 同一台机器上已经有重活在跑 —— 拿不到租约就不开跑（不静默跳过、不硬跑）。')
    console.error('  租约文件：' + got.file)
    console.error('  当前持有者：' + JSON.stringify(got.heldBy || got.error))
    console.error('  正确反应：等它跑完再来（持有者确实没了 / 过期了才会被自动回收）。')
    console.error('  确需强跑（例如持有人是别的机器上残留的 pid）：显式删掉上面那个文件，或另指定 ' + LEASE_FILE_ENV + '。')
    process.exit(2)
  }
  if (got.reclaimed) console.log('重活租约：回收了一把陈旧的（' + JSON.stringify(got.reclaimed) + '）')
  console.log('重活租约：已取得 —— ' + JSON.stringify(leaseView(got.lease)))
  process.env[LEASE_HELD_ENV] = String(process.pid)
  return got.lease.holder
}
