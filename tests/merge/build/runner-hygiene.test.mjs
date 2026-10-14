/**
 * tests/merge/build/runner-hygiene.test.mjs —— 运行器收尾的契约：**清理失败不判红，只读夹具不毒运行器**。
 *
 * 为什么放在 build 套件：这条守的不是任何一个人的产物，是**发版路径本身**（`tests/merge/run.mjs` 收尾跑在
 * 「门禁 · 契约与合并期测试」那一步里）—— 2026-10-15 v1.9.0 发版实测：那一步的判据**全绿**，却因为收尾时
 * `rmSync` 撞上 `env-probe.test.mjs` 留下的 `chmod 0500` 夹具目录（非 root 下删不动）抛 EACCES 而整步判红，
 * Release 因此没发出去。本地以 root 跑永远复现不了 —— 所以这里不能只断言「删得掉」。
 *
 * ⚠️ 本机实测（2026-10-15）：这个容器里 **`chmod` 是空操作**（Node 与系统 chmod 都改不动 mode，`/tmp` 是 tmpfs、
 * syscall 被策略吞掉）—— 只读夹具在**本机根本造不出来**，`repaired` 永远为 false，而 CI（真权限）上才生效。
 * 所以判据分两层，两层都有牙：
 *   - **纯逻辑**（`needsOwnerRwx` 真值表）在哪都验；
 *   - **集成信号**（只读目录 → `repaired=true`）只在 chmod 真生效的环境里验，否则**如实 note**，不假装验到了。
 *
 * 判据（`repaired` 是**可观测信号**：以 root/空 chmod 跑时「删得掉」什么都证明不了，能证明的是「补权限那一步在」）：
 *   ① 只读目录（0500）→ 删干净 **且 `repaired === true`**（不是靠 root 特权蒙过去的）；
 *   ② 嵌套只读（只读目录里还有子目录/文件）→ 同样删干净且 repaired；
 *   ③ 普通树 → 删干净且 **`repaired === false`**（不无谓 chmod）；
 *   ④ 不存在 / 空串 / 传进来的是一条文件 → 不抛，`removed === true`；
 *   ⑤ 「永不抛」这条契约本身：上面每种输入都不得抛（收尾判红的根因就是它抛了）；
 *   ⑥ 接线：`run.mjs` 的收尾与夹具的 `cleanup()` 都走这一支（否则修了模块、漏了调用点）。
 *
 * 用法：node tests/merge/build/runner-hygiene.test.mjs
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, section, finish } from './_lib.mjs'
import { needsOwnerRwx, removeTreeRobust, repairModes } from '../_rm-safe.mjs'
import { readFileSync } from 'node:fs'
import { REPO_ROOT } from './_lib.mjs'

const made = []
const mk = (prefix) => { const r = mkdtempSync(join(tmpdir(), prefix)); made.push(r); return r }
const modeOf = (p) => (statSync(p).mode & 0o777).toString(8)

section('① 纯逻辑：属主位缺 rwx 就该补（不依赖本机 chmod 是否生效）')
{
  check('0o500（只读目录）→ 该补', needsOwnerRwx(0o500) === true)
  check('0o555（r-xr-xr-x）→ 该补', needsOwnerRwx(0o555) === true)
  check('0o400（只读文件位）→ 该补', needsOwnerRwx(0o400) === true)
  check('0o700 → 不补（不留无谓 chmod）', needsOwnerRwx(0o700) === false)
  check('0o755 → 不补', needsOwnerRwx(0o755) === false)
  check('0o777 → 不补', needsOwnerRwx(0o777) === false)
}

section('② 集成：只读目录删得掉（真权限环境里再断 repaired 信号）')
{
  // 先探本机 chmod 是否真的生效 —— 不生效就别假装验到了「补权限那一步」
  const probe = mk('hyg-chmod-')
  chmodSync(probe, 0o500)
  const chmodWorks = (statSync(probe).mode & 0o777) === 0o500
  try { chmodSync(probe, 0o700) } catch { /* 尽力 */ }

  const root = mk('hyg-ro-')
  mkdirSync(join(root, 'home', 'inner'), { recursive: true })
  writeFileSync(join(root, 'home', 'inner', 'file.txt'), 'x')
  chmodSync(join(root, 'home', 'inner'), 0o500)
  chmodSync(join(root, 'home'), 0o500)
  const r = removeTreeRobust(root)
  check('只读（含嵌套）目录被删干净', r.removed === true && !existsSync(root), JSON.stringify(r))
  check('没有 error（删成功就不该留错）', r.error === null, JSON.stringify(r))
  if (chmodWorks) {
    check('repaired=true（真的补过权限，不是靠特权蒙过去）', r.repaired === true, JSON.stringify(r))
  } else {
    console.log('  note  本机 chmod 是空操作（实测）：只读目录造不出来 → repaired 信号本机验不了；'
      + '留给 CI 的真权限环境（那里 chmodWorks=true，同一分支会真断 repaired=true）。'
      + '本机仍验了「删干净 + 不抛」，逻辑那一半由 ① 的真值表覆盖。')
  }
}

section('③ 普通树：删干净，且不做无谓 chmod')
{
  const root = mk('hyg-ok-')
  mkdirSync(join(root, 'a', 'b'), { recursive: true })
  writeFileSync(join(root, 'a', 'b', 'f.txt'), 'x')
  const r = removeTreeRobust(root)
  check('普通树删干净', r.removed === true && !existsSync(root), JSON.stringify(r))
  check('repaired=false（没有只读目录就不动权限）', r.repaired === false, JSON.stringify(r))
}

section('④ 畸形输入：不抛、removed=true')
{
  const missing = join(tmpdir(), 'hyg-never-existed-' + Date.now())
  const a = removeTreeRobust(missing)
  check('不存在的路径 → removed=true、不抛', a.removed === true && a.error === null, JSON.stringify(a))
  const b = removeTreeRobust('')
  check('空串 → removed=true、不抛', b.removed === true, JSON.stringify(b))
  // 真删不掉的路径：**删不掉也要如实返回、不抛**（CI 那次就是这一支抛了才判红）
  if (existsSync('/proc/self')) {
    const d = removeTreeRobust('/proc/self')
    check('删不掉的路径（/proc/self）→ removed=false + error 原文，不抛',
      d.removed === false && typeof d.error === 'string' && d.error.length > 0, JSON.stringify(d))
  } else {
    console.log('  note  本机没有 /proc/self，跳过「真删不掉」这条（CI 上是 Linux，会真断）')
  }
  const root = mk('hyg-file-')
  const file = join(root, 'plain.txt')
  writeFileSync(file, 'x')
  const c = removeTreeRobust(file)
  check('传进来是一条文件 → 也删得掉、不抛', c.removed === true && !existsSync(file), JSON.stringify(c))
  try { rmSync(root, { recursive: true, force: true }) } catch { /* 交给下一段的收尾 */ }
}

section('④b 不跟符号链接（自指软链不挂死）+ capped 上界如实标出')
{
  const root = mk('hyg-loop-')
  mkdirSync(join(root, 'a'), { recursive: true })
  writeFileSync(join(root, 'a', 'f.txt'), 'x')
  symlinkSync('.', join(root, 'a', 'loop'))      // 自指软链：跟着走就会无限绕（/proc/self 那次实测）
  const t0 = Date.now()
  const fix = repairModes(root)
  const ms = Date.now() - t0
  check('自指软链下 repairModes 立刻返回（不挂死）', ms < 5000, ms + 'ms')
  check('capped=false（没撞上界；visited 走的是有界的那几个节点）', fix.capped === false && fix.visited < 20, JSON.stringify(fix))
  const r = removeTreeRobust(root)
  check('带自指软链的树也删得掉', r.removed === true && !existsSync(root), JSON.stringify(r))
}

section('⑤ 契约：这一支**永不抛**（收尾判红的根因就是它抛了）')
{
  const cases = []
  const root = mk('hyg-nothrow-')
  mkdirSync(join(root, 'ro'), { recursive: true })
  chmodSync(join(root, 'ro'), 0o500)
  cases.push(['只读树', () => removeTreeRobust(root)])
  cases.push(['不存在', () => removeTreeRobust(join(tmpdir(), 'nope-' + Date.now()))])
  cases.push(['空串', () => removeTreeRobust('')])
  for (const [name, fn] of cases) {
    let threw = null
    try { fn() } catch (e) { threw = String((e && e.message) || e) }
    check('不抛：' + name, threw === null, threw || '')
  }
  // 残留（如果上面的用例失败了）交给本文件的收尾再补一刀
  if (existsSync(root)) removeTreeRobust(root)
}

section('⑥ 接线：运行器收尾与夹具 cleanup 都走这一支')
{
  const runner = readFileSync(join(REPO_ROOT, 'tests/merge/run.mjs'), 'utf8')
  check('run.mjs 的收尾调用 removeTreeRobust', /removeTreeRobust\(root\)/.test(runner))
  check('run.mjs 不再裸删临时根（没有未包 try 的 rmSync(root…)）', !/^\s*rmSync\(root,/m.test(runner))
  const harness = readFileSync(join(REPO_ROOT, 'tests/merge/host/_env-harness.mjs'), 'utf8')
  check('夹具 cleanup 走 removeTreeRobust', /cleanup:\s*\(\)\s*=>\s*\{\s*removeTreeRobust\(home\)\s*\}/.test(harness))
  const probe = readFileSync(join(REPO_ROOT, 'tests/merge/host/env-probe.test.mjs'), 'utf8')
  check('env-probe 用完把只读 HOME 恢复回可写', /chmodSync\(hH\.home, 0o700\)/.test(probe))
}

// 本文件自己的收尾：把还活着的临时根删掉（走同一支）
for (const r of made.splice(0)) removeTreeRobust(r)
finish()
