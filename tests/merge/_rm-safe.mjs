/**
 * tests/merge/_rm-safe.mjs —— 收尾用的「安全删树」：**清理失败不判红，只读夹具不毒运行器**。
 *
 * 为什么要有它（2026-10-15，v1.9.0 发版实测，CI 专属）：`host/env-probe.test.mjs` 的「HOME 不可写」场景把
 * 夹具 HOME `chmod 0500` 就没人恢复；夹具自己的 `cleanup()` 用 try/catch 吞掉 EACCES（所以那一格照绿），
 * 但**只读目录留在运行器根里** —— 运行器收尾时裸 `rmSync(root, {recursive:true})` 在**非 root**（CI 的 runner 用户）
 * 下删不动它 → 抛 EACCES → 整步判红 → Release 没发出去（判据其实全绿；本地以 root 跑永远复现不了）。
 *
 * 两层修法：
 *   ① 删之前先**递归把目录权限补回可写**（只读夹具是故意造的，不该因此判红）；
 *   ② 真删不掉也**如实返回、不抛** —— 结算不挂在收尾上（与 `build/_lib.mjs` 里那条
 *      「临时目录清理失败不影响结论」同源；运行器此前是唯一的例外）。
 *
 * `repaired` 是给判据看的**可观测信号**：只读夹具会置 true —— 没有它，以 root 跑的门禁只能证明
 * 「root 删得动」，证明不了「修权限那一步在」。
 */
import { chmodSync, existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 纯逻辑：这个 mode 的**属主位**缺不缺 rwx（缺就该补 —— 只读目录会挡住删它里面的东西）。
 * 单列出来是为了让判据**不依赖本机 chmod 是否生效**：这台设备的 chmod 实测是空操作（见下），
 * 只断言「repaired 变 true」的话，本机永远红、CI 才绿 —— 那不是判据，那是看天吃饭。
 */
export function needsOwnerRwx(mode) {
  return (mode & 0o700) !== 0o700
}

/**
 * 递归把**目录**的属主位补回 rwx（best-effort）。返回是否真动过权限。
 *
 * ⚠️ 本机实测（2026-10-15）：这个容器里 `chmod` 是**空操作** —— Node 的 `chmodSync` 与系统 `chmod`
 * 都改不动 mode（`/tmp` 是 tmpfs、`/` 是 ro ext4，且 syscall 被策略吞掉）。所以「只读夹具」在**本机
 * 根本造不出来**，`repaired` 也永远为 false；真权限只在 CI（GitHub runner）上生效。
 * 判据据此分成两半：纯逻辑（needsOwnerRwx 真值表）在哪都验；集成信号（repaired）只在 chmod 生效的
 * 环境里验，否则如实 note，不假装验到了。
 */
export function repairModes(root, opts = {}) {
  const maxNodes = Number.isFinite(opts.maxNodes) ? opts.maxNodes : 20000
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 24
  let repaired = false
  let visited = 0
  let capped = false
  const walk = (p, depth) => {
    if (visited >= maxNodes || depth > maxDepth) { capped = true; return }
    visited += 1
    // lstat 而不是 stat：**不跟符号链接**。追链接会走进 /proc/self/fd 这类伪文件系统绕不完
    // （2026-10-15 实测：探针在 /proc/self 上挂死 —— 收尾时挂死比删不掉更糟）。
    let st = null
    try { st = lstatSync(p) } catch { return }
    if (!st.isDirectory()) return
    if (needsOwnerRwx(st.mode)) {
      try { chmodSync(p, (st.mode & 0o777) | 0o700); repaired = true } catch { /* 尽力而为 */ }
    }
    let names = []
    try { names = readdirSync(p) } catch { return }
    for (const n of names) walk(join(p, n), depth + 1)
  }
  walk(root, 0)
  // 走上界兜住 = 有一片没修到：如实标 capped（调用方照样去删，删不掉就返回 error）。
  return { repaired, capped, visited }
}

/**
 * 删掉一棵树，**永不抛**。返回 `{ removed, repaired, error }`：
 *   removed  最终是否删干净（本来就不存在也算 true）；
 *   repaired 是否补过权限（只读夹具 → true；普通树 → false，不做无谓 chmod）；
 *   error    真删不掉时的原话（截断 200 字），交给调用方如实打一行。
 */
export function removeTreeRobust(root) {
  if (typeof root !== 'string' || !root || !existsSync(root)) return { removed: true, repaired: false, capped: false, error: null }
  let fix = repairModes(root)
  let error = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true })
      return { removed: !existsSync(root), repaired: fix.repaired, capped: fix.capped, error: null }
    } catch (e) {
      error = String((e && e.message) || e).slice(0, 200)
      const again = repairModes(root)    // 可能是删到一半才露出的只读目录，再补一次
      fix = { repaired: fix.repaired || again.repaired, capped: fix.capped || again.capped }
    }
  }
  return { removed: !existsSync(root), repaired: fix.repaired, capped: fix.capped, error }
}
