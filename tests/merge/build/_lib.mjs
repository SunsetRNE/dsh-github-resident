/**
 * tests/merge/build/_lib.mjs —— 合并包「构建/发布形态」契约测试的公共工具
 *
 * 只做四件事：断言记账、隔离临时目录、npm pack + 解包安装进临时 node_modules、静态导入图走查。
 * 不碰真实 HOME / profile / 凭据 / 31790（隔离环境由 tests/merge/run.mjs 负责，本文件也自带兜底）。
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..', '..', '..')
export const PKG_ROOT = REPO_ROOT

// 常用 fs 判据转发，省得每个测试各 import 一遍
export { existsSync }

const requireFromRepo = createRequire(join(REPO_ROOT, 'package.json'))

// ---------------------------------------------------------------------------
// 断言记账
// ---------------------------------------------------------------------------
let failures = 0
let passes = 0

export function check(label, ok, detail) {
  if (typeof label !== 'string' || typeof ok !== 'boolean') {
    throw new TypeError('check expects (label: string, result: boolean); reversed arguments must not pass')
  }
  if (ok) {
    passes += 1
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : '  —— ' + String(detail)))
  }
  return !!ok
}

export function section(title) {
  console.log('-- ' + title)
}

export function finish() {
  console.log(`\n（本文件：通过 ${passes} · 失败 ${failures}）`)
  process.exit(failures > 0 ? 1 : 0)
}

// ---------------------------------------------------------------------------
// 临时目录
// ---------------------------------------------------------------------------
const tempRoots = []

export function makeTempRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

export function cleanupTempRoots() {
  for (const r of tempRoots.splice(0)) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      // 临时目录清理失败不影响结论
    }
  }
}

process.on('exit', cleanupTempRoots)

// ---------------------------------------------------------------------------
// pack / 解包安装
// ---------------------------------------------------------------------------
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  return {
    status: r.status === null ? 1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error || null,
  }
}

/**
 * 把本仓打成 tarball（只写临时目录，不碰仓库里任何文件）。
 * `npm pack` 会按 package.json 的 files 白名单产出，这正是发布形态。
 */
export function packRepo(root) {
  const r = run('npm', ['pack', '--pack-destination', root, '--json'], { cwd: REPO_ROOT })
  const tgz = readdirSync(root).filter((f) => f.endsWith('.tgz'))
  return { status: r.status, tgz: tgz[0] ? join(root, tgz[0]) : null, stdout: r.stdout, stderr: r.stderr }
}

/**
 * 解包 + 在临时 fixture 里做出一份**真实的 npm 安装布局**：
 *   <fixture>/node_modules/@sunsetrne/dsh-github-resident-v2/**   ← tarball 解出来的内容
 *   <fixture>/node_modules/{yaml,dsh-plugin-update}           ← 声明的运行时依赖（从本仓已装副本真拷贝）
 * 然后 exports 解析、import、相对导入图都按「装好的包」来验证，绝不借用旁边的源码目录。
 */
export function installFromTarball(tgzPath, name) {
  const fixture = join(makeTempRoot('merge-fixture-'), 'fixture')
  const scope = name.startsWith('@') ? name.split('/')[0] : ''
  const bare = name.startsWith('@') ? name.split('/')[1] : name
  const pkgDir = join(fixture, 'node_modules', ...(scope ? [scope, bare] : [bare]))
  mkdirSync(dirname(pkgDir), { recursive: true })

  const stage = join(fixture, '.stage')
  mkdirSync(stage, { recursive: true })
  const untar = run('tar', ['-xzf', tgzPath, '-C', stage])
  if (untar.status !== 0) throw new Error('tar 解包失败：' + untar.stderr)
  cpSync(join(stage, 'package'), pkgDir, { recursive: true, force: true })
  rmSync(stage, { recursive: true, force: true })

  // 声明过的运行时依赖：按 npm 会做的事放进 fixture 自己的 node_modules（真拷贝，不用软链）。
  for (const dep of ['yaml', 'dsh-plugin-update']) {
    const real = realpathSync(dirname(requireFromRepo.resolve(dep + '/package.json')))
    cpSync(real, join(fixture, 'node_modules', dep), { recursive: true, force: true, dereference: true })
  }
  mkdirSync(join(fixture, 'node_modules', '.bin'), { recursive: true })

  return { fixture, pkgDir }
}

// ---------------------------------------------------------------------------
// 静态导入图
// ---------------------------------------------------------------------------
/**
 * 收集 ESM 静态/动态的**字面量**导入说明符。
 *
 * 为什么不能用一个宽松的 `from '...'` 正则：deck 源码里有大段提示词文本与注释，
 * 出现过 `from ', '`、`from\n …` 这类假命中（实测），会凭空造出「缺失的依赖」。
 * 这里把三类写法分开，并且都锚定在语句位置上：
 *   1) 单行 `import … from 'x'` / `export … from 'x'`
 *   2) 多行 import 的收尾行 `} from 'x'` 或 `from 'x'`
 *   3) 纯副作用 `import 'x'` 与动态 `import('x')`
 */
export function staticSpecifiers(code) {
  const out = []
  const patterns = [
    /^[ \t]*(?:import|export)\b[^\n]*?\bfrom[ \t]*(['"])([^'"\n]+)\1/gm,
    /^[ \t]*\}?[ \t]*from[ \t]*(['"])([^'"\n]+)\1/gm,
    /^[ \t]*import[ \t]*(['"])([^'"\n]+)\1[ \t]*;?[ \t]*$/gm,
    /\bimport[ \t]*\([ \t]*(['"])([^'"\n]+)\1[ \t]*\)/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(code)) !== null) out.push(m[2])
  }
  return out
}

/** 计算型（非字面量）动态 import 的出现次数——走查不到的边，单独报数，不冒充覆盖。 */
export function computedImportCount(code) {
  const all = (code.match(/\bimport\s*\(/g) || []).length
  const literal = (code.match(/\bimport\s*\(\s*(['"])/g) || []).length
  return Math.max(0, all - literal)
}

/**
 * 从 entryAbs 出发走静态导入图：
 *   - 相对说明符必须解析到**包内真实存在的文件**，否则记 missing；
 *   - @deepseek 框架包不允许出现在随包宿主树里（零框架引用纪律），记 framework。
 */
export function walkRelativeGraph(entryAbs) {
  const seen = new Set()
  const missing = []
  const bare = new Set()
  const framework = new Set()
  const queue = [entryAbs]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    if (!existsSync(file)) {
      missing.push(file)
      continue
    }
    if (!statSync(file).isFile()) continue
    const code = readFileSync(file, 'utf8')
    for (const spec of staticSpecifiers(code)) {
      if (spec.startsWith('.')) {
        const abs = resolve(dirname(file), spec)
        if (!existsSync(abs)) missing.push(abs)
        else queue.push(abs)
      } else if (spec.startsWith('@deepseek-ai/')) {
        framework.add(spec)
      } else if (!spec.startsWith('node:')) {
        bare.add(spec)
      }
    }
  }
  return { files: [...seen], missing, bare: [...bare].sort(), framework: [...framework].sort() }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
export function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

export function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1
}

export function listDir(dir) {
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

/** 递归列出目录下的相对文件路径（升序）。 */
export function listRelFiles(dir, base = dir) {
  const out = []
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const abs = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...listRelFiles(abs, base))
    else if (ent.isFile()) out.push(abs.slice(base.length + 1))
  }
  return out.sort()
}

/** 在 fixture 里跑一段探针脚本（子进程 + cwd=fixture，保证 ESM 解析走 fixture 自己的 node_modules）。 */
export function runProbe(fixture, scriptName, code) {
  const probe = join(fixture, scriptName)
  writeFileSync(probe, code)
  return run(process.execPath, [probe], { cwd: fixture })
}
