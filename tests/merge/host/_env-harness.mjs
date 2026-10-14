/**
 * tests/merge/host/_env-harness.mjs —— **合成环境的唯一夹具**（票「合成环境矩阵门禁」）。
 *
 * 为什么要有它（2026-10-14 诊断，实测）：本仓三张门禁各写了一份 `fakeHome`（identity-resolver /
 * identity-audit / env-probe），两份 `withScenario` —— 合成环境是**每张票顺手各写一遍**，
 * 没有归口；「HOME 有/无 gh 登录态各跑一遍」甚至只活在开发者本机的 /tmp 脚本里。
 * 结果就是：门禁只证明「在**跑门禁这台机器**上恰好绿」。
 *
 * 三条设计约定（都是踩过的坑）：
 *   ① **环境必须在执行期生效**，不只是 import 期 —— 模块的 HOME 是加载期求值的，而工具是在之后执行的；
 *      只在 import 前设、`finally` 里就恢复，会让被测代码在执行时读回真环境（静默失真）。
 *      所以 `withPlugin()` 把「设环境 → import → apply → 跑用例 → 恢复」包成一段。
 *   ② **PATH 只用夹具自己的 bin**（`home.path`）：bin 里软链真 `git`/`sh`、放 `gh`/`curl` 的桩。
 *      这样「有没有 curl」「gh 在不在」由夹具说了算，而不是由这台机器说了算 —— 门禁不再看运气。
 *   ③ **桩要能造出真实状态**：正常 / 抖动（前 N 条连接掐断）/ 只认 curl / 重定向，外加挂死（接受连接不回包）。
 *
 * 用法：
 *   import { makeHome, withPlugin, startStub, urlOf, closeAll, listingOf } from './_env-harness.mjs'
 *   const h = makeHome('a', { withGh: true, files: { '.config/gh/hosts.yml': HOSTS } })
 *   const r = await withPlugin(h.home, { path: h.path, dataDir: h.home + '/.dsh/gh-cli' }, ({ tool }) => tool('gh_identity').execute({}, {}))
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync,
  symlinkSync, writeFileSync, rmSync,
} from 'node:fs'
import { accessSync, constants as FS } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from './_check.mjs'

export const PLUGIN_URL = pathToFileURL(join(REPO_ROOT, 'plugin.js')).href

/**
 * 真二进制：找到就用软链（行为要真），找不到就放桩（只求存在，并如实报出来）。
 *
 * ⚠️ **先查固定的绝对路径，再扫 PATH**（2026-10-14 矩阵抓出来的）：只扫 PATH 的话，
 * 外层环境一改（例如「无 curl」变体把 PATH 收成夹具 bin），夹具里的 curl 就跟着变样 ——
 * 门禁的夹具居然继承了「跑门禁这台机器」的样子，正是矩阵要消灭的那类不确定。
 */
const FIXED_CANDIDATES = {
  curl: ['/usr/bin/curl', '/usr/local/bin/curl', '/bin/curl'],
  git: ['/usr/bin/git', '/usr/local/bin/git', '/bin/git'],
  sh: ['/bin/sh', '/usr/bin/sh'],
  // 「挂死」的 gh 桩要用它（夹具的 PATH 只有夹具 bin，裸 `sleep` 在桩里根本找不到）
  sleep: ['/bin/sleep', '/usr/bin/sleep'],
}

export function whichReal(name) {
  for (const p of FIXED_CANDIDATES[name] || []) {
    try { accessSync(p, FS.X_OK); return p } catch { /* 试下一个 */ }
  }
  for (const dir of String(process.env.PATH || '').split(':')) {
    if (!dir) continue
    const p = join(dir, name)
    try { accessSync(p, FS.X_OK); return p } catch { /* 继续找 */ }
  }
  return null
}

export const REAL = {
  git: whichReal('git'),
  sh: whichReal('sh'),
  curl: whichReal('curl'),
  sleep: whichReal('sleep'),
}

const writeStub = (dir, name, body) => {
  const p = join(dir, name)
  writeFileSync(p, body, { mode: 0o755 })
  chmodSync(p, 0o755)
  return p
}

/** gh 桩记 argv 的分隔行（写与读共用一处，别在两处各写一遍格式）。 */
export const GH_CALL_MARKER = '---CALL---'

/** 读回 gh 桩记下的 argv：每次调用一组参数，空参数也保留。 */
export function readGhCalls(logFile) {
  if (!existsSync(logFile)) return []
  const lines = readFileSync(logFile, 'utf8').split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const calls = []
  let cur = null
  for (const line of lines) {
    if (line === GH_CALL_MARKER) { cur = []; calls.push(cur); continue }
    if (cur) cur.push(line)
  }
  return calls
}

/**
 * 「挂死形状是不是真的」的自证：纯 `spawn` + `kill`，看 'close' 到不到。
 * 返回 true = 800ms 内没等到 'close'（孙进程攥着管道不放）—— 说明这个桩**真能钉住一个父进程**，
 * 不是「随便挂一下」。两处门禁共用：回落那张票的第 ④ 节、探测这张票的第 ① 节。
 */
export async function orphanHoldsPipes(cmd, args = ['pr', 'create']) {
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let closed = false
  child.on('close', () => { closed = true })
  await new Promise((r) => setTimeout(r, 400))
  try { child.kill('SIGKILL') } catch { /* 已经死了 */ }
  await new Promise((r) => setTimeout(r, 400))
  try { if (child.stdout) child.stdout.destroy() } catch { /* 收尾 */ }
  try { if (child.stderr) child.stderr.destroy() } catch { /* 收尾 */ }
  return !closed
}

/**
 * gh 桩的脚本正文（2026-10-14，票「gh_pr 共用解析器 + 回落 gh pr create」扩的口子）。
 *
 * 不传 `prCreate` 时行为**与从前逐字节一致**：任何 argv 都只回版本行、exit 0（既有用例靠它）。
 * 传了才多认 `pr create`，四种形态：
 *   `{ url }`                     → 回 PR 链接、exit 0（回落成功的那一格）
 *   `{ exit: 1, stderr: '…' }`    → 按 gh 失败的样子回（原文进 stderr + 退出码）
 *   `{ noUrl: true }`             → exit 0 但**不回链接**（「exit 0 却没有 URL」这类假结论）
 *   `{ hang: true, hangMs, exec }`→ 挂住不回；默认**留一个攥着管道的孙进程**（正是本仓「子进程不退」
 *                                   那个坑的形状），`exec: true` 才让 shell 自己被替换掉（无孙进程）。
 * `log` 给绝对路径时，桩把每次 argv 追写进去 —— 「有 token 时 gh 没被 fork」这条判据靠它。
 *
 * 桩里**不写裸命令名**：夹具的 PATH 只有夹具 bin，`sleep` 一律走绝对路径。
 */
export function ghStubScript({ log = null, prCreate = null, hangAll = null } = {}) {
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'"
  const L = ['#!/bin/sh']
  if (log) {
    // 一次调用一组、一个参数一行（空参数也要留得住：`--body ''` 是「不给 gh 开交互式编辑器」的判据）。
    L.push(`printf '%s\\n' ${q(GH_CALL_MARKER)} >> ${q(log)}`)
    L.push(`for a in "$@"; do printf '%s\\n' "$a" >> ${q(log)}; done`)
  }
  // 「对任何 argv 都挂死」（票「gh 探测也要有界」）：连 `--version` 都不答 —— 无上界探测的现场形状。
  // 默认**留下一个攥着管道的孙进程**（把坑放回原样），`exec: true` 才让 shell 自己被替换掉。
  const hang = hangAll === true ? {} : hangAll
  if (hang) {
    const secs = Math.max(5, Math.round((hang.hangMs || 30000) / 1000))
    const sleeper = (REAL.sleep ? q(REAL.sleep) : 'sleep') + ' ' + secs
    L.push('      ' + (hang.exec ? 'exec ' : '') + sleeper)
    if (!hang.exec) L.push('      exit 0')
    return L.join('\n') + '\n'
  }
  L.push('case "$1" in')
  L.push('  --version) echo "gh version 9.9.9 (HARNESS-STUB)"; exit 0 ;;')
  if (prCreate) {
    L.push('  pr)')
    L.push('    if [ "$2" = "create" ]; then')
    if (prCreate.hang) {
      const secs = Math.max(5, Math.round((prCreate.hangMs || 30000) / 1000))
      const sleeper = (REAL.sleep ? q(REAL.sleep) : 'sleep') + ' ' + secs
      // 非 exec：shell 等孙进程 —— 父进程把 shell SIGKILL 掉之后，孙进程仍攥着 stdout/stderr 管道
      L.push('      ' + (prCreate.exec ? 'exec ' : '') + sleeper)
      if (!prCreate.exec) L.push('      exit 0')
    } else if (prCreate.noUrl) {
      L.push('      exit 0')
    } else if (prCreate.exit && prCreate.exit !== 0) {
      if (prCreate.stderr) L.push('      echo ' + q(prCreate.stderr) + ' 1>&2')
      L.push('      exit ' + Number(prCreate.exit))
    } else {
      L.push('      echo ' + q(prCreate.url || 'https://github.com/example/repo/pull/1'))
      L.push('      exit 0')
    }
    L.push('    fi')
    L.push('    ;;')
  }
  L.push('esac')
  L.push('echo "gh version 9.9.9 (HARNESS-STUB)"')
  L.push('exit 0')
  return L.join('\n') + '\n'
}

/**
 * 造一个假 HOME（含自己的 bin）。返回：
 *   home  —— 假 HOME 路径（模块的 ~/.dsh / ~/.config 都落在这里）
 *   bin   —— 夹具的 bin 目录（`gh`/`curl` 的桩 + 真 `git`/`sh` 的软链）
 *   path  —— **只用 bin** 的 PATH（门禁不看这台机器有什么；「无 curl」就是这么造的）
 *   pathWithReal —— bin + 真实 PATH（少数需要真环境的场景用）
 *   hasRealCurl / hasRealGit —— 如实报夹具里到底是不是真货
 *   ghLog —— gh 桩记 argv 的落点（只有传了 `gh: { log: true }` 才有；读它用 `readGhCalls`）
 *
 * `gh`：富桩选项（见 ghStubScript）：`{ log, prCreate }` —— 用它才认 `pr create`。
 */
export function makeHome(tag, { files = {}, withGh = false, ghExits = 0, withCurl = true, withGit = true, withSh = true, gh = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-env-' + tag + '-'))
  const bin = join(home, '.bin')
  mkdirSync(bin, { recursive: true })

  for (const [name, on] of [['git', withGit], ['sh', withSh]]) {
    if (!on) continue
    const real = REAL[name]
    if (real) { try { symlinkSync(real, join(bin, name)) } catch { /* 已有同名 */ } }
    else writeStub(bin, name, '#!/bin/sh\nexit 127\n')
  }
  // gh 桩记 argv 的落点：`gh.log === true` 时默认落在 home 里（调用方拿得到，见返回值 `ghLog`）。
  const ghLog = gh && gh.log ? (typeof gh.log === 'string' ? gh.log : join(home, 'gh-argv.log')) : null
  if (withGh) {
    // `gh` 选项给的是「会答 pr create / 会记 argv / 会挂死」的富桩；不给就还是老的两行桩。
    writeStub(bin, 'gh', gh
      ? ghStubScript({ ...gh, log: ghLog })
      : (ghExits === 0
        ? '#!/bin/sh\necho "gh version 9.9.9 (HARNESS-STUB)"\n'
        : '#!/bin/sh\nexit 1\n'))
  }
  if (withCurl) {
    if (REAL.curl) { try { symlinkSync(REAL.curl, join(bin, 'curl')) } catch { /* 已有同名 */ } }
    // 没有真 curl 时放个只回状态码的桩：能让「curl 在不在」这类判据确定，不假装能联网。
    else writeStub(bin, 'curl', '#!/bin/sh\necho 000\n')
  }
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(home, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body, { mode: 0o600 })
  }
  return {
    home, bin,
    path: bin,
    pathWithReal: bin + ':' + String(process.env.PATH || ''),
    hasRealCurl: Boolean(REAL.curl),
    hasRealGit: Boolean(REAL.git),
    ghLog,
    cleanup: () => { try { rmSync(home, { recursive: true, force: true }) } catch { /* 收尾 */ } },
  }
}

/** 要注入/恢复的环境键（含小写变体：代理变量两种写法都有人用）。 */
const ENV_KEYS = [
  'HOME', 'PATH', 'DSH_GH_DATA_DIR', 'GIT_CONFIG_GLOBAL', 'GH_TOKEN', 'GITHUB_TOKEN',
  // 回落路径的上界（票「gh_pr … 回落 gh pr create」）：门禁把它压到秒级，好做「挂死」用例。
  'DSH_GH_PR_TIMEOUT_MS',
  // gh **探测**的上界（票「gh 探测也要有界：probeGh 不能无限等」）：同上 —— 不列在这里会被夹具清掉，
  // 于是旋钮静默失效、用例退回 5s 默认值（本仓踩过这类「夹具把环境悄悄换掉」的坑）。
  'DSH_GH_PROBE_TIMEOUT_MS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
]

function snapshotEnv(extraKeys) {
  const out = {}
  for (const k of new Set([...ENV_KEYS, ...(extraKeys || [])])) out[k] = process.env[k]
  return out
}

/**
 * 把合成环境装进 process.env。
 *
 * ⚠️ **调用方点名的键必须真的设进去**（`ENV_KEYS ∪ patch 的键`）—— 2026-10-14 实测踩过：
 * 原来只遍历 `ENV_KEYS`，`opts.env` 里那些「不在清单里的键」会被**静默丢掉**：
 * `DSH_GH_PROBE_TIMEOUT_MS` 没生效（用例退回 5s 默认值）、`DSH_GH_RELEASE_API` 没生效
 *（于是「不外网」的判据其实打了真网，还测了个空）。没点名的键照旧一律清空。
 */
function applyEnv(patch) {
  for (const k of new Set([...ENV_KEYS, ...Object.keys(patch || {})])) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      const v = patch[k]
      if (v === undefined || v === null) delete process.env[k]
      else process.env[k] = String(v)
      continue
    }
    // 没点名的键在合成环境里一律**清空**：免得开发机上的 GH_TOKEN / 代理串进来（看运气）。
    delete process.env[k]
  }
}

function restoreEnv(saved) {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
}

/**
 * 顺序脚本式入口：**只**为「按 HOME 取一份模块实例」而设（模块的路径常量在 import 期定型，
 * 之后环境不再影响它 —— 例如直接驱导出接缝的身份解析器用例）。返回 `{ mod, tools, restore }`，
 * 由调用方在结尾统一 `restore()`。
 */
export async function importPluginAt(home, tag) {
  const saved = snapshotEnv()
  applyEnv({ HOME: home, PATH: `${home}/.bin` })
  try {
    const mod = await import(PLUGIN_URL + '?env=' + encodeURIComponent(home + '|' + (tag || '')))
    const tools = new Map()
    const provided = {}
    mod.apply({
      tools: { register: (t) => { tools.set(t.name, t); return () => {} } },
      provide: (k, v) => { provided[k] = v },
      effect: () => () => {},
      inject: () => {},
      get: () => undefined,
    })
    return { mod, tools, tool: (n) => tools.get(n), provided, restore: () => restoreEnv(saved) }
  } catch (e) {
    restoreEnv(saved)
    throw e
  }
}

/**
 * 在合成环境里跑一段用例：设环境 → 取一份新模块实例（每个 HOME 一份）→ apply → 跑 fn → 恢复环境。
 * fn 收到 `{ mod, tools, tool(name), provided }`。
 */
export async function withPlugin(home, opts, fn) {
  const saved = snapshotEnv(Object.keys(opts.env || {}))
  applyEnv({
    HOME: home,
    PATH: opts.path !== undefined ? opts.path : `${home}/.bin`,
    DSH_GH_DATA_DIR: opts.dataDir,
    GIT_CONFIG_GLOBAL: opts.gitConfig,
    ...(opts.env || {}),
  })
  try {
    const mod = await import(PLUGIN_URL + '?env=' + encodeURIComponent(home + '|' + (opts.tag || '')))
    const tools = new Map()
    const provided = {}
    mod.apply({
      tools: { register: (t) => { tools.set(t.name, t); return () => {} } },
      provide: (k, v) => { provided[k] = v },
      effect: () => () => {},
      inject: () => {},
      get: () => undefined,
    })
    return await fn({ mod, tools, tool: (n) => tools.get(n), provided })
  } finally {
    restoreEnv(saved)
  }
}

// ---------------------------------------------------------------------------
// 本地服务：可达性判据全靠它们，**不起真实外网请求**
// ---------------------------------------------------------------------------

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', r))

/** kind：'ok'（任何请求 200）· 'flaky'（前 failFirst 条连接掐断）· 'curlOnly'（UA=node 的连接掐断）· 'redirect'（302 到 to）。 */
export async function startStub(kind = 'ok', { failFirst = 2, to = null } = {}) {
  let conns = 0
  const server = http.createServer((req, res) => {
    if (kind === 'curlOnly' && /^node\b/.test(String(req.headers['user-agent'] || ''))) { req.socket.destroy(); return }
    if (kind === 'redirect') { res.writeHead(302, { location: to }); res.end(); return }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  if (kind === 'flaky') server.on('connection', (sock) => { conns += 1; if (conns <= failFirst) sock.destroy() })
  await listen(server)
  return server
}

/** 挂死服务：接受连接但**永不回包**（证「上界」真的生效）。 */
export async function startBlackhole() {  const socks = []
  const server = http.createServer(() => { /* 故意不回 */ })
  server.on('connection', (s) => { socks.push(s); s.on('error', () => {}) })
  await listen(server)
  return {
    server, socks,
    cleanup: () => { for (const s of socks) { try { s.destroy() } catch { /* 收尾 */ } } },
  }
}

export const urlOf = (server, path = '/') => 'http://127.0.0.1:' + server.address().port + path

export async function closeAll(servers) {
  for (const s of servers) {
    const server = s && s.server ? s.server : s
    if (!server || typeof server.close !== 'function') continue
    await new Promise((r) => server.close(r))
  }
}

// ---------------------------------------------------------------------------
// 只读判据用的快照
// ---------------------------------------------------------------------------

export const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

/** 目录快照：名字 + mtime（用来断言「跑一圈没多文件、内容没变」）。 */
export function listingOf(dir) {
  const names = readdirSync(dir).sort()
  return {
    names: names.join(','),
    mtimes: names.map((f) => f + ':' + statSync(join(dir, f)).mtimeMs).join(','),
  }
}

export const isRoot = () => typeof process.getuid === 'function' && process.getuid() === 0
export const exists = (p) => existsSync(p)
