/**
 * tests/merge/host/_check.mjs —— 合并包宿主侧测试的最小共用件（只做计数与路径，不碰设备/网络/HOME）。
 *
 * 为什么不用第三方测试框架：本仓的既有门禁（verify-*.mjs / verify-*.js）全是「自己数失败」的裸 node 脚本，
 * 合并后的契约测试沿用同一形态，谁都能 `node tests/merge/host/<x>.test.mjs` 直接跑，不需要先装依赖。
 *
 * 纪律（与 docs/merge-implementation-plan.md §6 一致）：
 *   - 只读本仓文件、只写 `os.tmpdir()` 下的临时目录；
 *   - 不读真实 HOME、不连网、不绑端口、不起浏览器；
 *   - 需要 HOME 的用例一律自己 monkey-patch 或走 os.tmpdir()。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 仓库根（本文件在 <root>/tests/merge/host/）。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

let total = 0
let failures = 0
const notes = []

export function section(title) {
  console.log('\n-- ' + title)
}

export function check(cond, msg) {
  total += 1
  if (cond) console.log('  PASS ' + msg)
  else {
    failures += 1
    console.log('  FAIL ' + msg)
  }
  return !!cond
}

export function note(msg) {
  notes.push(msg)
  console.log('  note ' + msg)
}

export function skip(msg) {
  console.log('  SKIP ' + msg)
}

/** 读仓库内文本文件（相对仓库根）。 */
export function readText(rel) {
  return readFileSync(join(REPO_ROOT, rel), 'utf8')
}

/** 读仓库内 JSON。 */
export function readJson(rel) {
  return JSON.parse(readText(rel))
}

/** 导入仓库内的 ESM/TS（Node 原生擦类型）。 */
export function importRel(rel) {
  return import(pathToFileURL(join(REPO_ROOT, rel)).href)
}

/** 导入绝对路径的文件（临时目录里的模拟布局用）。 */
export function importAbs(abs) {
  return import(pathToFileURL(abs).href)
}

/** 建一个临时目录，测试结束（进程退出）时自动清掉。 */
export function tmpDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), 'mergehost-' + tag + '-'))
  process.on('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 清理失败不影响判定 */
    }
  })
  return dir
}

/** 结束：打印统计并按失败数设置退出码。 */
export function summary() {
  if (failures > 0) {
    console.log('\n存在失败：' + failures + ' / ' + total)
    process.exit(1)
  }
  console.log('\n全部通过：' + total + ' 项')
  process.exit(0)
}

/** 让未处理的拒绝变成可判定的失败（而不是默默打一行警告）。 */
export function captureUnhandled() {
  const seen = []
  process.on('unhandledRejection', (reason) => {
    seen.push(reason)
  })
  return seen
}
