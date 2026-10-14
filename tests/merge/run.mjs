#!/usr/bin/env node
/**
 * tests/merge/run.mjs —— 合并包合并期契约测试的**隔离运行器**
 *
 * 职责：把 tests/merge/ 下各人自己的契约测试逐个丢进**隔离子进程**跑，并如实汇报每条结果。
 *   - 本 runner 不属于任何一个人的产物范围：它只读目录、只写自己的临时目录；
 *   - 它**不**碰真实 HOME / 真实 profile / 真实 GitHub 凭据 / 真实 31790 端口。
 *
 * 隔离手段（每次运行一份临时根目录，退出即删）：
 *   1) HOME / XDG_* / TMPDIR 全部指向临时目录 —— 任何按 os.homedir() 推状态路径的代码都落在沙箱里；
 *   2) GH_TOKEN / GITHUB_TOKEN / GH_CONFIG_DIR / GIT_CONFIG_GLOBAL 一律清空或指向临时文件 ——
 *      真实凭据绝不参与测试；
 *   3) DSH_GH_* 指向临时登记目录与数据目录，并关掉启动即落地 gh / 探测远端 / 自动更新；
 *   4) DSH_PROFILE / DSH_PROFILE_DIR 清掉 —— 防止哪条脚本「顺着环境变量」摸到正在跑的 profile。
 *
 * 目录约定（谁的东西谁写，本 runner 只发现、不创建）：
 *   tests/merge/build/   构建与发布形态契约（构建负责人）
 *   tests/merge/host/    宿主落地契约（任务 H）
 *   tests/merge/client/  客户端落地契约（任务 C）
 * 目录不存在就跳过并在汇总里标明「未提供」——不冒充通过。
 *
 * 退出码约定：
 *   0 = 全部通过；
 *   1 = 有失败（真红）；
 *   2 = 没有失败，但有测试自报「被别的任务阻塞」（BLOCKED-* 行）；
 *   3 = 运行器自身出错（例如一个测试都没发现）。
 *
 * 用法：node tests/merge/run.mjs [--only <子串>]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseLease, requireLoadLease } from './_load-lease.mjs'
import { removeTreeRobust } from './_rm-safe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const SUITES = ['build', 'host', 'client']

const argv = process.argv.slice(2)
const onlyIdx = argv.indexOf('--only')
const only = onlyIdx >= 0 ? argv[onlyIdx + 1] || '' : ''

function discover() {
  const found = []
  for (const suite of SUITES) {
    const dir = join(HERE, suite)
    if (!existsSync(dir)) {
      found.push({ suite, file: null, reason: '目录未提供（该任务尚未交付测试）' })
      continue
    }
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.test.mjs') || f.endsWith('.test.js'))
      .sort()
    if (files.length === 0) {
      found.push({ suite, file: null, reason: '目录存在但还没有 *.test.mjs' })
      continue
    }
    for (const f of files) found.push({ suite, file: join(dir, f), reason: '' })
  }
  return found.filter((e) => !only || (e.file || suite).includes(only) || e.suite === only)
}

/** 造一份隔离环境：临时 HOME/XDG/TMPDIR + 清空的凭据 + 临时 DSH_GH_* 目录。 */
function isolatedEnv(root) {
  const env = { ...process.env }
  const home = join(root, 'home')
  const tmp = join(root, 'tmp')
  const xdg = join(root, 'xdg')
  const ghRegistry = join(root, 'registry')
  const ghData = join(root, 'data')
  for (const d of [home, tmp, xdg, ghRegistry, ghData]) mkdirSync(d, { recursive: true })

  env.HOME = home
  env.USERPROFILE = home
  env.TMPDIR = tmp
  env.TMP = tmp
  env.TEMP = tmp
  env.XDG_CONFIG_HOME = join(xdg, 'config')
  env.XDG_DATA_HOME = join(xdg, 'data')
  env.XDG_CACHE_HOME = join(xdg, 'cache')
  env.XDG_STATE_HOME = join(xdg, 'state')

  // 真实凭据一律不参与
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  delete env.GH_ENTERPRISE_TOKEN
  env.GH_CONFIG_DIR = join(root, 'gh-config')
  env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig')
  env.GIT_CONFIG_SYSTEM = join(root, 'gitconfig-system')
  env.GIT_TERMINAL_PROMPT = '0'

  // 真实 profile 一律不参与
  delete env.DSH_PROFILE
  delete env.DSH_PROFILE_DIR
  delete env.DSH_SESSION_ID

  // 副作用闸：不落地 gh、不探测远端、不自动更新
  env.DSH_GH_REGISTRY_DIR = ghRegistry
  env.DSH_GH_DATA_DIR = ghData
  env.DSH_GH_NO_BOOTSTRAP = '1'
  env.DSH_GH_NO_STATE_CHECK = '1'
  env.DSH_GH_NO_UPDATE = '1'

  // 构建期标记清掉，免得上游脚本按它走别的分支
  delete env.DSW_SYNC
  delete env.DSW_NO_SYNC
  return env
}

const entries = discover()
console.log('tests/merge/run.mjs —— 隔离运行器（临时 HOME/TMPDIR，真实 profile 与凭据不参与）')
console.log('临时根：<mkdtemp>/tests-merge-*')
console.log('')

if (entries.filter((e) => e.file).length === 0) {
  console.error('没有发现任何可跑的契约测试（先交付 tests/merge/<suite>/*.test.mjs）')
  process.exit(3)
}

// 重活租约（票「重活租约」）：全量门禁是重活 —— 同一台机器一次只许一份。
// 多会话并跑会把宿主压垮（本机实测被杀 6 次）。拿不到锁就**如实拒绝**，一个门禁子进程都不起。
const LEASE_HOLDER = requireLoadLease({
  holder: 'verify:merge@' + (process.env.DSH_SESSION_ID || ('pid' + process.pid)),
  purpose: 'verify:merge（全量合并包门禁' + (only ? ' --only ' + only : '') + '）',
})
console.log('')

const root = mkdtempSync(join(tmpdir(), 'tests-merge-'))
const env = isolatedEnv(root)

let passed = 0
let failed = 0
let blocked = 0
const skipped = []

try {
  for (const entry of entries) {
    if (!entry.file) {
      skipped.push(`${entry.suite}: ${entry.reason}`)
      continue
    }
    const rel = entry.file.slice(REPO_ROOT.length + 1)
    process.stdout.write(`== ${rel}\n`)
    const r = spawnSync(process.execPath, [entry.file], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const out = `${r.stdout || ''}${r.stderr || ''}`
    if (out.trim()) {
      process.stdout.write(
        out
          .split('\n')
          .map((l) => '   ' + l)
          .join('\n') + '\n',
      )
    }
    const status = r.status === null ? 1 : r.status
    if (status === 0) {
      passed += 1
    } else if (status === 3 || /^BLOCKED-/m.test(out)) {
      blocked += 1
      process.stdout.write('   => BLOCKED（被别的任务阻塞，不是本套测试的失败）\n')
    } else {
      failed += 1
      process.stdout.write(`   => FAIL（exit ${status}）\n`)
    }
    process.stdout.write('\n')
  }
} finally {
  // 收尾**不该判红**：只读夹具目录（例如 env-probe 的「HOME 不可写」场景）在非 root 下删不动，
  // 裸 rmSync 会抛 EACCES 把**全绿**的一遍判成失败（2026-10-15 v1.9.0 发版实测：判据全绿、Release 没发出去）。
  const cleaned = removeTreeRobust(root)
  if (!cleaned.removed) {
    process.stdout.write('   note 收尾：临时目录没删干净（' + cleaned.error + '）—— 不影响本次结论\n')
  }
}

console.log('===== tests/merge 汇总 =====')
console.log(`通过 ${passed} · 失败 ${failed} · 被阻塞 ${blocked}`)
for (const s of skipped) console.log('SKIP  ' + s)

// 放锁：只有自己取的那份才放（祖先进程持有的话 LEASE_HOLDER 是 null，不替它放）。
if (LEASE_HOLDER) {
  const rel = releaseLease(LEASE_HOLDER)
  console.log(rel && rel.released ? '重活租约：已释放' : ('重活租约：释放时如实回报 —— ' + JSON.stringify(rel)))
}

if (failed > 0) process.exit(1)
if (blocked > 0) process.exit(2)
process.exit(0)
