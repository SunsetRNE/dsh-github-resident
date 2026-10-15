#!/usr/bin/env node
/**
 * tests/merge/_load-lease-cli.mjs —— 重活租约的**命令壳**（给引不了 JS 模块的 bash 半边用）。
 *
 * 为什么要有它（票 61「重活租约扩到半重那一族」）：租约只有一处实现（`./_load-lease.mjs`），
 * 而 `verify-bundle.sh` 是 bash —— 它引不了那一支。于是未持有记号时它 re-exec 到本壳：
 *
 *   node tests/merge/_load-lease-cli.mjs -- bash verify-bundle.sh [参数...]
 *
 * 本壳：取**同一把锁**（拒绝语义与退出码由 `_load-lease.mjs` 一处产出）→ 带着
 * `DSH_GH_LOAD_LEASE_HELD` 记号跑子进程（子进程与孙进程见到记号就不再取）→ 退出时放锁 →
 * **透传子进程退出码**。拿不到锁就 exit 2 + `BLOCKED-LOAD-LEASE`，子进程一个都不起。
 *
 * 这里**没有第二份锁**：落点、格式、TTL、回收语义全在 `./_load-lease.mjs`。
 *
 * 用法：node tests/merge/_load-lease-cli.mjs -- <命令> [参数...]
 */
import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'
import { holdLoadLease } from './_load-lease.mjs'

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
const cmd = sep >= 0 ? argv.slice(sep + 1) : argv
if (!cmd.length) {
  console.error('FAIL _load-lease-cli.mjs 要接 `-- <命令> [参数...]`（例：-- bash verify-bundle.sh）')
  process.exit(1)
}

// 「谁在跑」报的是**被包住的那件活**（不是本壳）—— 别人在拒绝文案里才认得出等谁。
const wrapped = (cmd[0] === 'node' || cmd[0] === 'bash') && cmd[1] ? cmd[1] : cmd[0]
holdLoadLease({
  holder: 'verify:resident/' + basename(wrapped) + '@' + (process.env.DSH_SESSION_ID || ('pid' + process.pid)),
  purpose: 'verify:resident（' + cmd.join(' ').slice(0, 160) + '）',
})

const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: process.env })
if (r.error) {
  console.error('FAIL 起不来：' + cmd.join(' ') + ' —— ' + String(r.error.message || r.error))
  process.exit(1)
}
process.exit(r.status == null ? 1 : r.status)   // 退出码透传；放锁走 holdLoadLease 的 exit 钩子
