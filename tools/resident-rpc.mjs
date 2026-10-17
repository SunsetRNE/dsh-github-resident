#!/usr/bin/env node
/**
 * 只读诊断：--offline [--bundle-dir DIR] 真 apply 后走 githubResident 服务；--live 走宿主 RPC。
 * 在线：DSH_GUI（默认 http://127.0.0.1:3080）+ 显式 DSH_GUI_HEADERS_FILE（每行 Header: value）。
 * 凭据只从 header 文件读取，不读日志/identity/环境 token；stdout 为诊断 JSON，失败退出 1。
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Socket } from 'node:net'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NEXT = '可在当前宿主会话调用 gh_protocol / gh_cli_status；在线诊断需显式设置 DSH_GUI_HEADERS_FILE（每行一个 HTTP header）。'
const ENDPOINTS = [
  'ghr.state', 'ghr.version', 'ghr.update', 'ghr.protocol', 'ghr.registry',
  'ghr.registry.list', 'ghr.registry.root', 'ghr.registry.plan', 'ghr.registry.build', 'ghr.registry.verify',
  'ghr.registry.revoke', 'ghr.registry.purge', 'ghr.authStart', 'ghr.ensureGh', 'ghr.logout', 'ghr.identity.email',
].sort()
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = (code, message) => { throw Object.assign(new Error(message), { diagnosticCode: code }) }

export function guiOrigin(value = process.env.DSH_GUI || 'http://127.0.0.1:3080') {
  let url
  try { url = new URL(value) } catch { fail('GUI_URL', 'DSH_GUI 不是合法的 HTTP(S) 来源。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    fail('GUI_URL', 'DSH_GUI 必须是无凭据、无查询串、无片段的 HTTP(S) 来源；凭据请放在 header 文件。')
  }
  return url.origin
}

export function validateProtocol(protocol) {
  if (!object(protocol) || protocol.ok === false || protocol.spec !== 'dsh-github-resident/9'
      || protocol.version !== 9 || !Array.isArray(protocol.tools) || !protocol.tools.length) {
    fail('PROTOCOL_SHAPE', 'ghr.protocol 未返回 Resident /9 协议和工具清单。')
  }
  const http = protocol.http
  if (!object(http) || http.base !== '/api/dsws' || http.loopbackOnly !== false
      || !Array.isArray(http.endpoints)
      || http.endpoints.some((entry) => !object(entry) || entry.method !== 'POST')
      || JSON.stringify(http.endpoints.map((entry) => entry.path).sort()) !== JSON.stringify(ENDPOINTS)) {
    // 数量从 ENDPOINTS 派生：写死字面量在加端点时必然漂移（这次就是）。
    fail('PROTOCOL_TRANSPORT', '协议未声明 /api/dsws 宿主通道及全部 ' + ENDPOINTS.length + ' 个 POST ghr.* 端点。')
  }
  return protocol
}

export function validateState(state) {
  if (!object(state) || state.ok === false || !object(state.gh) || !object(state.probe)
      || typeof state.gh.layer !== 'string' || typeof state.probe.state !== 'string'
      || !(state.gh.installed === null || typeof state.gh.installed === 'boolean')
      || typeof state.cached !== 'boolean'
      || !(state.authenticated === null || typeof state.authenticated === 'boolean')
      || !(state.account === null || typeof state.account === 'string')) {
    fail('STATE_SHAPE', 'ghr.state 未返回有效账号快照（未知登录态必须保留为 null）。')
  }
  return state
}

function readHeaders(file) {
  if (!file) fail('CREDENTIALS_MISSING', '未提供 DSH_GUI_HEADERS_FILE，宿主 RPC 认证未就绪。')
  let text
  try { text = readFileSync(file, 'utf8') } catch { fail('CREDENTIALS_UNREADABLE', '显式 header 文件不存在或不可读，宿主 RPC 认证未就绪。') }
  const headers = new Headers()
  const secrets = []
  let hasCredential = false
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(\S.*)$/.exec(line)
    if (!match || /^(host|content-length|transfer-encoding|connection)$/i.test(match[1])) {
      fail('HEADERS_FORMAT', 'header 文件格式无效或试图覆盖 HTTP 路由字段；内容不回显。')
    }
    const [, name, rawValue] = match
    const value = rawValue.trim()
    try { headers.set(name, value) } catch { fail('HEADERS_FORMAT', 'header 文件含非法字段值；内容不回显。') }
    if (/^(authorization|cookie|x-[\w-]*(token|auth|key))$/i.test(name)) {
      hasCredential = true
      secrets.push(value, value.replace(/^Bearer\s+/i, ''))
      if (/^cookie$/i.test(name)) {
        for (const part of value.split(';')) {
          const at = part.indexOf('=')
          if (at >= 0) secrets.push(part.slice(at + 1).trim())
        }
      }
    }
  }
  if (!hasCredential) fail('CREDENTIALS_MISSING', 'header 文件未包含认证 header，宿主 RPC 认证未就绪。')
  headers.set('content-type', 'application/json')
  return { headers, secrets: [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length) }
}

function redact(value, secrets) {
  if (typeof value === 'string') {
    let out = value
    for (const secret of secrets) out = out.split(secret).join('***')
    return out
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, secrets))
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry, secrets)]))
  return value
}

// 只输出诊断所需字段；凭据助手可能是带认证内容的 shell 命令，永不回显原文。
function receipt(mode, protocol, state, extra = {}) {
  return {
    ok: true, mode, ...extra,
    protocol: {
      version: protocol.version, spec: protocol.spec,
      tools: protocol.tools.map((tool) => ({ name: tool.name })),
      http: { base: protocol.http.base, loopbackOnly: protocol.http.loopbackOnly,
        endpoints: protocol.http.endpoints.map(({ method, path }) => ({ method, path })) },
    },
    state: {
      authenticated: state.authenticated, account: state.account, cached: state.cached,
      gh: { installed: state.gh.installed, layer: state.gh.layer, version: state.gh.version },
      credHelper: state.credHelper ? 'configured' : null,
      snapshotAt: state.snapshotAt || null,
      probe: { state: state.probe.state, snapshotAt: state.probe.snapshotAt || null },
    },
  }
}

export async function diagnoseLive({ gui, headerFile = process.env.DSH_GUI_HEADERS_FILE, fetchImpl = globalThis.fetch } = {}) {
  const origin = guiOrigin(gui)
  const { headers, secrets } = readHeaders(headerFile)
  const call = async (method, payload) => {
    const rpcId = 'resident-diagnostic-' + randomUUID()
    let response
    let envelope
    try {
      response = await fetchImpl(origin + '/api/dsws', {
        method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(12000),
        body: JSON.stringify({ type: 'client-request', rpcId, method: 'dsws', payload: { method, payload } }),
      })
      if (!response.ok) fail('HTTP_STATUS', method + '：宿主返回 HTTP ' + response.status + '，RPC 未就绪。')
      envelope = await response.json()
    } catch (error) {
      if (error.diagnosticCode) throw error
      fail('RPC_UNAVAILABLE', method + '：宿主请求失败、超时、重定向或未返回 JSON；响应正文不回显。')
    }
    if (!object(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId || !object(envelope.result)) {
      fail('RPC_ENVELOPE', method + '：宿主回执不符合 server-response/rpcId/result 信封。')
    }
    if (envelope.result.ok !== true) fail('RPC_REJECTED', method + '：宿主拒绝该端点，或插件未加载；错误正文不回显。')
    return envelope.result.value
  }
  const protocol = validateProtocol(await call('ghr.protocol', {}))
  // 请求缓存视图，不发送 refresh=1，也不调用任何身份写入端点。
  const state = validateState(await call('ghr.state', { query: 'cached=1' }))
  return redact(receipt('live', protocol, state, { origin }), secrets)
}

export async function diagnoseOffline(bundleDir = ROOT) {
  const temporaryRoot = realpathSync(tmpdir())
  const fixtureDir = mkdtempSync(join(temporaryRoot, 'resident-rpc-offline-'))
  const environment = process.env
  const oldEnv = { ...environment }
  const oldFetch = globalThis.fetch
  const oldConnect = Socket.prototype.connect
  let networkAttempts = 0
  const denyNetwork = () => { networkAttempts += 1; fail('OFFLINE_NETWORK', '离线诊断尝试了网络访问。') }
  try {
    // 必须逐键修改原 process.env；整体替换普通对象不会更新 os.homedir() 使用的原生环境。
    // 从 import 到调用始终是同一假 HOME；不继承 token、代理、git 配置或 DSH 路径覆盖。
    const fixtureEnv = {
      HOME: fixtureDir, PATH: fixtureDir, TMPDIR: fixtureDir,
      XDG_CONFIG_HOME: join(fixtureDir, '.config'), GIT_CONFIG_GLOBAL: join(fixtureDir, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1', DSH_GH_NO_BOOTSTRAP: '1', DSH_GH_NO_UPDATE: '1', DSH_GH_NO_STATE_CHECK: '1',
    }
    for (const key of Object.keys(environment)) delete environment[key]
    for (const [key, value] of Object.entries(fixtureEnv)) environment[key] = value
    if (homedir() !== fixtureDir) fail('OFFLINE_HOME', '原生 HOME 未切换到临时目录，已拒绝导入插件。')
    globalThis.fetch = denyNetwork
    Socket.prototype.connect = denyNetwork
    const provided = new Map()
    const plugin = await import(pathToFileURL(join(resolve(bundleDir), 'plugin.js')).href + '?diagnostic=' + randomUUID())
    await plugin.apply({
      tools: { register() { return () => {} } },
      provide(key, value) { provided.set(key, value) },
      get(key) { return provided.get(key) },
      // 只验证服务位；不运行启动自更新、设备登录或任何其它 effect。
      effect() { return () => {} }, inject() {},
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    })
    const service = provided.get('githubResident')
    if (!service || typeof service.protocol !== 'function' || typeof service.status !== 'function') {
      fail('SERVICE_MISSING', '真 apply 后未提供 githubResident.protocol/status 服务。')
    }
    const protocol = validateProtocol(await service.protocol())
    const state = validateState(await service.status({ cached: true }))
    if (networkAttempts) fail('OFFLINE_NETWORK', '离线服务调用尝试了网络访问。')
    return receipt('offline', protocol, state)
  } finally {
    for (const key of Object.keys(environment)) delete environment[key]
    for (const [key, value] of Object.entries(oldEnv)) environment[key] = value
    globalThis.fetch = oldFetch
    Socket.prototype.connect = oldConnect
    // 仅清理由本次 mkdtemp 创建、仍位于原临时目录下的真实目录。
    if (dirname(fixtureDir) === temporaryRoot && basename(fixtureDir).startsWith('resident-rpc-offline-')
        && realpathSync(fixtureDir) === fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
  }
}

async function main() {
  const args = process.argv.slice(2)
  const mode = args.shift()
  let bundleDir = ROOT
  if (args.length === 2 && args[0] === '--bundle-dir' && mode === '--offline') bundleDir = args[1]
  else if (args.length) fail('ARGUMENTS', '只接受 --offline [--bundle-dir DIR] 或 --live；不接受端口或凭据参数。')
  if (mode === '--offline') return diagnoseOffline(bundleDir)
  if (mode === '--live') return diagnoseLive()
  fail('ARGUMENTS', '请显式选择 --offline 或 --live。')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((receipt) => console.log(JSON.stringify(receipt))).catch((error) => {
    console.log(JSON.stringify({ ok: false, code: error.diagnosticCode || 'DIAGNOSTIC_FAILED',
      message: error.diagnosticCode ? error.message : '诊断执行失败；未回显可能含凭据的异常内容。', next: NEXT }))
    process.exitCode = 1
  })
}
