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
}

const writeStub = (dir, name, body) => {
  const p = join(dir, name)
  writeFileSync(p, body, { mode: 0o755 })
  chmodSync(p, 0o755)
  return p
}

/**
 * 造一个假 HOME（含自己的 bin）。返回：
 *   home  —— 假 HOME 路径（模块的 ~/.dsh / ~/.config 都落在这里）
 *   bin   —— 夹具的 bin 目录（`gh`/`curl` 的桩 + 真 `git`/`sh` 的软链）
 *   path  —— **只用 bin** 的 PATH（门禁不看这台机器有什么；「无 curl」就是这么造的）
 *   pathWithReal —— bin + 真实 PATH（少数需要真环境的场景用）
 *   hasRealCurl / hasRealGit —— 如实报夹具里到底是不是真货
 */
export function makeHome(tag, { files = {}, withGh = false, ghExits = 0, withCurl = true, withGit = true, withSh = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-env-' + tag + '-'))
  const bin = join(home, '.bin')
  mkdirSync(bin, { recursive: true })

  for (const [name, on] of [['git', withGit], ['sh', withSh]]) {
    if (!on) continue
    const real = REAL[name]
    if (real) { try { symlinkSync(real, join(bin, name)) } catch { /* 已有同名 */ } }
    else writeStub(bin, name, '#!/bin/sh\nexit 127\n')
  }
  if (withGh) {
    writeStub(bin, 'gh', ghExits === 0
      ? '#!/bin/sh\necho "gh version 9.9.9 (HARNESS-STUB)"\n'
      : '#!/bin/sh\nexit 1\n')
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
    cleanup: () => { try { rmSync(home, { recursive: true, force: true }) } catch { /* 收尾 */ } },
  }
}

/** 要注入/恢复的环境键（含小写变体：代理变量两种写法都有人用）。 */
const ENV_KEYS = [
  'HOME', 'PATH', 'DSH_GH_DATA_DIR', 'GIT_CONFIG_GLOBAL', 'GH_TOKEN', 'GITHUB_TOKEN',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
]

function snapshotEnv() {
  const out = {}
  for (const k of ENV_KEYS) out[k] = process.env[k]
  return out
}

function applyEnv(patch) {
  for (const k of ENV_KEYS) {
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
  for (const k of ENV_KEYS) {
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
  const saved = snapshotEnv()
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
export async function startBlackhole() {
  const socks = []
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
