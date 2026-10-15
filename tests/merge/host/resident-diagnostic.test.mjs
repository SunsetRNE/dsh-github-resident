/**
 * Resident 诊断回归：真 apply 的假 HOME 服务位 + 内存 RPC 回执；不联网、不监听、不读真实身份。
 * 运行：node tests/merge/host/resident-diagnostic.test.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { Socket } from 'node:net'
import { check, section, summary, REPO_ROOT } from './_check.mjs'
import { diagnoseOffline, diagnoseLive, guiOrigin, validateProtocol, validateState } from '../../../tools/resident-rpc.mjs'

const temporaryRoot = realpathSync(tmpdir())
const fixtureDir = mkdtempSync(join(temporaryRoot, 'resident-diagnostic-test-'))
const helper = join(REPO_ROOT, 'tools', 'resident-rpc.mjs')
const credential = 'synthetic-diagnostic-credential'
const headerFile = join(fixtureDir, "header's with spaces")
const expectCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.diagnosticCode, code)
    assert.equal(error.message.includes(credential), false, '失败文案不能回显 header 凭据或响应正文')
    return true
  })
}

async function verifyOfflineHomeIsolation() {
  section('零、导入期 HOME 隔离（只比较路径，不读任何身份文件）')
  const bundle = join(fixtureDir, 'home-import-bundle')
  mkdirSync(bundle)
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ type: 'module' }))
  const endpointNames = ['state', 'version', 'update', 'protocol', 'registry', 'registry.list',
    'registry.plan', 'registry.build', 'registry.verify', 'registry.revoke', 'registry.purge',
    'authStart', 'logout', 'identity.email']
  const protocol = { version: 8, spec: 'dsh-github-resident/8', tools: [{ name: 'fixture' }],
    http: { base: '/api/dsws', loopbackOnly: false,
      endpoints: endpointNames.map((name) => ({ method: 'POST', path: 'ghr.' + name })) } }
  const state = { gh: { installed: null, layer: 'checking' }, authenticated: null,
    account: null, cached: false, probe: { state: 'idle' } }
  const observerKey = 'resident-home-import-' + basename(fixtureDir)
  const observer = Symbol.for(observerKey)
  let observed
  const inheritedKey = 'DSH_DIAGNOSTIC_HOME_SENTINEL'
  const inheritedValue = process.env[inheritedKey]
  const originalEnv = process.env
  const originalHome = homedir()
  process.env[inheritedKey] = 'fixture-inherited-marker'
  const originalValues = { ...process.env }
  globalThis[observer] = (facts) => { observed = { ...facts, env: process.env } }
  // 观察发生在模块顶层，与真实 plugin.js 的 HOME/STATE_FILE 求值时机一致。
  // 不匹配就立刻抛错，整个夹具不会读取身份文件（包括旧实现仍指向的真实 HOME）。
  writeFileSync(join(bundle, 'plugin.js'), `
import { homedir } from 'node:os'
import { join } from 'node:path'
const importedHome = homedir()
const fixtureHome = process.env.HOME
const stateFile = join(importedHome, '.dsh', 'github-resident.json')
globalThis[Symbol.for(${JSON.stringify(observerKey)})]({ importedHome, fixtureHome, stateFile,
  inheritedAbsent: process.env.DSH_DIAGNOSTIC_HOME_SENTINEL === undefined })
if (importedHome !== fixtureHome) throw new Error('offline native HOME differs from fixture HOME')
process.env.DSH_DIAGNOSTIC_IMPORT_ADDED = 'fixture-added-marker'
export function apply(ctx) {
  ctx.provide('githubResident', {
    protocol: () => (${JSON.stringify(protocol)}),
    status: () => (${JSON.stringify(state)}),
  })
}
`)
  try {
    await diagnoseOffline(bundle)
    assert.ok(observed && observed.importedHome === observed.fixtureHome,
      '模块导入时 os.homedir() 必须指向 fixture HOME')
    assert.ok(observed.importedHome !== originalHome && observed.env === originalEnv,
      '导入期必须保留原始 process.env 对象并使用不同的 HOME')
    assert.equal(observed.stateFile, join(observed.fixtureHome, '.dsh', 'github-resident.json'))
    assert.ok(observed.inheritedAbsent, '导入时不能继承外部环境键')
    check(true, '模块顶层的 os.homedir/身份路径确在 fixture HOME，process.env 对象身份不变')
    const restored = () => {
      const keys = Object.keys(process.env)
      return process.env === originalEnv && homedir() === originalHome
        && keys.length === Object.keys(originalValues).length
        && keys.every((key) => process.env[key] === originalValues[key])
    }
    assert.ok(restored(), '离线结束后必须逐键恢复原生环境，清除模块新增键')
    check(true, '结束后原生 HOME 与全部环境值恢复，模块导入新增的键已清除')
    check(!existsSync(observed.fixtureHome), '本次假 HOME 在诊断结束后被清理')
    await assert.rejects(diagnoseOffline(join(bundle, 'missing-bundle')))
    assert.ok(restored(), '导入失败后也必须逐键恢复原生环境')
    check(true, '导入异常后原生 HOME、process.env 对象身份与全部环境值同样恢复')
  } finally {
    delete globalThis[observer]
    if (inheritedValue === undefined) delete process.env[inheritedKey]
    else process.env[inheritedKey] = inheritedValue
  }
}

function cleanupFixture() {
  assert.equal(dirname(fixtureDir), temporaryRoot)
  assert.ok(basename(fixtureDir).startsWith('resident-diagnostic-test-'))
  assert.equal(realpathSync(fixtureDir), fixtureDir)
  rmSync(fixtureDir, { recursive: true, force: true })
  assert.equal(existsSync(fixtureDir), false)
}

// 修复 HOME 隔离时可只跑这条最小回归，不重跑其它诊断或主线程门禁。
if (process.argv.includes('--home-isolation-only')) {
  try { await verifyOfflineHomeIsolation() } finally { cleanupFixture() }
  summary()
}

try {
  await verifyOfflineHomeIsolation()
  section('一、离线服务位：真 apply、隔离环境、网络守卫')
  const before = { env: process.env, fetch: globalThis.fetch, connect: Socket.prototype.connect }
  const offline = await diagnoseOffline(REPO_ROOT)
  check(offline.ok === true && offline.mode === 'offline', '默认档真正调用 githubResident 服务并拿到 protocol/state')
  check(offline.protocol.spec === 'dsh-github-resident/8' && offline.protocol.http.endpoints.length === 14,
    '离线回执是 /8 协议和全部 14 个端点')
  check(offline.state.authenticated === null && offline.state.cached === false,
    '假 HOME 尚无账号快照，未知态不伪造为已登录/未登录')
  check(process.env === before.env && globalThis.fetch === before.fetch && Socket.prototype.connect === before.connect,
    '离线调用结束后恢复环境与网络函数')

  const probeBundle = join(fixtureDir, 'probe-bundle')
  mkdirSync(probeBundle)
  writeFileSync(join(probeBundle, 'package.json'), JSON.stringify({ type: 'module' }))
  writeFileSync(join(probeBundle, 'plugin.js'), `
export async function apply(ctx) {
  try { await fetch('https://example.invalid/never-sent') } catch {}
  ctx.provide('githubResident', {
    protocol: () => (${JSON.stringify(offline.protocol)}),
    status: () => (${JSON.stringify(offline.state)}),
  })
}
`)
  await expectCode(diagnoseOffline(probeBundle), 'OFFLINE_NETWORK')
  check(process.env === before.env && globalThis.fetch === before.fetch && Socket.prototype.connect === before.connect,
    '被测插件即便吞掉出网异常，离线诊断仍报失败并恢复环境')
  await assert.rejects(diagnoseOffline(join(fixtureDir, 'missing-bundle')))
  check(process.env === before.env && globalThis.fetch === before.fetch && Socket.prototype.connect === before.connect,
    'import 失败同样恢复环境与网络函数')

  section('二、在线请求形状与凭据脱敏（fetch 内存桩）')
  // 尾部空白与 CRLF 模拟 curl 风格 header 文件；不能让 Headers 的规范化破坏脱敏。
  writeFileSync(headerFile, 'Authorization: Bearer ' + credential + '  \r\n', { mode: 0o600 })
  const requests = []
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body)
    requests.push(request)
    assert.equal(url, 'http://host.fixture/api/dsws')
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.get('authorization'), 'Bearer ' + credential)
    assert.equal(request.type, 'client-request')
    assert.equal(request.method, 'dsws')
    assert.match(request.rpcId, /^[A-Za-z0-9_-]{1,128}$/)
    assert.equal(options.body.includes(credential), false)
    const value = request.payload.method === 'ghr.protocol' ? offline.protocol : {
      ...offline.state, account: credential, credHelper: 'secret-helper-command',
      ignoredDetail: credential,
    }
    return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } })
  }
  const live = await diagnoseLive({ gui: 'http://host.fixture', headerFile, fetchImpl })
  assert.deepEqual(requests.map((request) => request.payload), [
    { method: 'ghr.protocol', payload: {} },
    { method: 'ghr.state', payload: { query: 'cached=1' } },
  ])
  check(live.ok === true && live.mode === 'live', '两个只读调用使用标准 client-request/dsws 信封与 cached=1 参数')
  check(requests[0].rpcId !== requests[1].rpcId, '每个调用使用独立 rpcId')
  check(live.state.account === '***' && !JSON.stringify(live).includes(credential),
    '响应意外包含认证值时脱敏，header 尾部空白不影响匹配')
  check(live.state.credHelper === 'configured' && !JSON.stringify(live).includes('secret-helper-command')
    && !Object.hasOwn(live.state, 'ignoredDetail'), '回执只保留诊断字段，凭据助手命令和其它详情不回显')

  writeFileSync(headerFile, 'Cookie: dsh_session=' + credential + '\n')
  const cookieLive = await diagnoseLive({ gui: 'http://host.fixture', headerFile, fetchImpl: async (_, options) => {
    assert.equal(options.headers.get('cookie'), 'dsh_session=' + credential)
    const request = JSON.parse(options.body)
    const value = request.payload.method === 'ghr.protocol' ? offline.protocol : { ...offline.state, account: credential }
    return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } })
  } })
  check(cookieLive.state.account === '***' && !JSON.stringify(cookieLive).includes(credential),
    '显式 Cookie header 的单个 cookie 值同样脱敏')
  writeFileSync(headerFile, 'Authorization: Bearer ' + credential + '\n')

  section('三、拒绝分支必须真实失败，不编 READY')
  const noFetch = () => assert.fail('缺凭据或非法输入时不应发请求')
  await expectCode(diagnoseLive({ headerFile: '', fetchImpl: noFetch }), 'CREDENTIALS_MISSING')
  check(true, '无显式 header 文件立即拒绝，不读其它凭据来源、不发请求')
  await expectCode(diagnoseLive({ headerFile: join(fixtureDir, 'missing-header'), fetchImpl: noFetch }), 'CREDENTIALS_UNREADABLE')
  check(true, 'header 文件不可读如实拒绝')
  await expectCode(diagnoseLive({ gui: 'http://host.fixture/?token=' + credential, headerFile, fetchImpl: noFetch }), 'GUI_URL')
  for (const url of ['http://user:password@host.fixture/', 'http://host.fixture/#token', 'file:///tmp/file']) {
    assert.throws(() => guiOrigin(url), { diagnosticCode: 'GUI_URL' })
  }
  check(true, '含查询串、userinfo、片段或非 HTTP(S) 的 GUI URL 均拒绝，文案不回显输入')
  writeFileSync(headerFile, 'User-Agent: diagnostic\n')
  await expectCode(diagnoseLive({ headerFile, fetchImpl: noFetch }), 'CREDENTIALS_MISSING')
  check(true, '只有普通 header 不能冒充已提供认证凭据')
  for (const text of ['not-a-header\n', 'Host: another-origin.fixture\n', 'Content-Length: 100\n']) {
    writeFileSync(headerFile, text)
    await expectCode(diagnoseLive({ headerFile, fetchImpl: noFetch }), 'HEADERS_FORMAT')
  }
  check(true, '非法 header 和覆盖 HTTP 路由/消息长度字段均拒绝')
  writeFileSync(headerFile, 'Authorization: Bearer ' + credential + '\n')

  const failureResponses = [
    ['HTTP_STATUS', 'HTTP 401', () => new Response(credential, { status: 401 })],
    ['RPC_UNAVAILABLE', 'HTTP 200 但正文是 HTML', () => new Response('<html>' + credential + '</html>')],
    ['RPC_ENVELOPE', '缺失 RPC 信封', () => Response.json({ ok: true })],
    ['RPC_ENVELOPE', 'rpcId 不匹配', () => Response.json({ type: 'server-response', rpcId: 'wrong', result: { ok: true, value: offline.protocol } })],
    ['RPC_REJECTED', '外层 result.ok=false', (request) => Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: false, error: credential } })],
    ['PROTOCOL_SHAPE', '业务值 ok=false', (request) => Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { ok: false, error: credential } } })],
  ]
  for (const [code, label, response] of failureResponses) {
    await expectCode(diagnoseLive({ gui: 'http://host.fixture', headerFile,
      fetchImpl: async (_, options) => response(JSON.parse(options.body)) }), code)
    check(true, label + ' 不会产生 READY 或回显响应正文')
  }
  await expectCode(diagnoseLive({ headerFile, fetchImpl: async () => { throw new Error(credential) } }), 'RPC_UNAVAILABLE')
  check(true, '请求异常只报通用失败，不回显可能含凭据的底层错误')

  for (const change of [
    { base: 'http://legacy.fixture' }, { loopbackOnly: true },
    { endpoints: offline.protocol.http.endpoints.slice(1) },
    { endpoints: offline.protocol.http.endpoints.map((e, i) => i === 0 ? { ...e, method: 'GET' } : e) },
  ]) {
    assert.throws(() => validateProtocol({ ...offline.protocol, http: { ...offline.protocol.http, ...change } }), { diagnosticCode: 'PROTOCOL_TRANSPORT' })
  }
  check(true, '协议仍指向独立来源、错误监听声明、漏端点或非 POST 均拒绝')
  assert.throws(() => validateProtocol({ ...offline.protocol, spec: 'dsh-github-resident/7' }), { diagnosticCode: 'PROTOCOL_SHAPE' })
  check(true, '协议 spec 必须保持 /8')
  for (const change of [{ gh: {} }, { probe: {} }, { authenticated: 'true' }, { cached: undefined }, { ok: false }]) {
    assert.throws(() => validateState({ ...offline.state, ...change }), { diagnosticCode: 'STATE_SHAPE' })
  }
  check(true, '缺字段/错类型/业务失败的账号快照均拒绝')

  const cli = spawnSync(process.execPath, [helper, '--live'], {
    env: { HOME: fixtureDir, PATH: fixtureDir, DSH_GUI: 'http://host.fixture', DSH_GUI_HEADERS_FILE: '' },
    encoding: 'utf8', timeout: 5000,
  })
  const cliResult = JSON.parse(cli.stdout)
  check(cli.status === 1 && cliResult.ok === false && cliResult.code === 'CREDENTIALS_MISSING',
    'CLI 缺凭据返回结构化未就绪结果并退出 1')
  check(cliResult.next.includes('gh_protocol') && cliResult.next.includes('gh_cli_status'),
    'CLI 缺凭据仍给出可用的宿主工具诊断路径')
} finally {
  cleanupFixture()
}
summary()
