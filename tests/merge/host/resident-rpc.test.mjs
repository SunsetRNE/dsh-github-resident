import { Server } from 'node:net'
import { makeHome, withPlugin } from './_env-harness.mjs'
import { check, section, summary } from './_check.mjs'
import { createRpcChannel } from '../../../deck/src/host/rpcChannel.js'

const h = makeHome('resident-rpc', { withGh: true, withGit: true })
await withPlugin(h.home, { path: h.path, env: {
  DSH_GH_NO_STATE_CHECK: '1', DSH_GH_NO_BOOTSTRAP: '1', DSH_GH_NO_UPDATE: '1',
} }, async ({ mod }) => {
  const handlers = new Map(), services = new Map(), tools = new Map(), waiting = [], cleanups = []
  let listenCalls = 0
  const listen = Server.prototype.listen
  Server.prototype.listen = function () { listenCalls++; throw new Error('test forbids listening') }
  const ctx = {
    tools: { register: (tool) => tools.set(tool.name, tool) },
    get: (k) => services.get(k),
    provide: (k, v) => { services.set(k, v); for (const w of waiting) if (w.keys.every(k => services.has(k))) w.run() },
    inject: (keys, fn) => {
      const w = { keys, run: () => { if (!w.done) { w.done = true; const stop = fn(ctx); if (typeof stop === 'function') cleanups.push(stop) } } }
      waiting.push(w); if (keys.every(k => services.has(k))) w.run()
    },
    effect: (fn) => { const stop = fn(); if (typeof stop === 'function') cleanups.push(stop) },
  }
  try {
    section('Resident 先加载，Deck 服务位随后到位')
    mod.apply(ctx)
    await new Promise(r => setTimeout(r, 20))
    ctx.provide('dswEndpoints', { handle: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) } })
    check(handlers.has('ghr.state'), '晚到的服务位仍注册状态端点')
    check(handlers.has('ghr.identity.email'), '晚到的服务位仍注册邮箱写入口')
    check(listenCalls === 0, '真 effect 完整运行时不监听任何端口')
    let route
    services.set('connection', { fetch: { register: (def) => { route = def.fetch; return () => {} } } })
    createRpcChannel({ ctx, handlers, fireLog() {}, dispatchMeta: async () => ({ shortArgHash: () => '', dispatchErrorKind: () => 'internal' }) })
    const call = async (method, payload = {}, origin) => {
      const response = await route(new Request('http://127.0.0.1:3080/api/dsws', {
        method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify({ type: 'client-request', rpcId: 'resident-test', method: 'dsws', payload: { method, payload } }),
      }))
      return (await response.json()).result
    }
    const state = await call('ghr.state', { query: 'cached=1' })
    check(state.ok === true && state.value?.probe?.state === 'disabled', '真实 RPC 通道返回快照而不是 unknown endpoint')
    const forged = await call('ghr.identity.email', { query: 'email=attacker@example.com', headers: { origin: 'http://127.0.0.1:3080' } })
    check(forged.value?.ok === false && /E_IDENTITY_EMAIL_ORIGIN/.test(forged.value.error), 'payload 伪造来源不能越过写入闸门')
    const foreign = await call('ghr.identity.email', { query: 'email=attacker@example.com' }, 'https://foreign.example')
    check(foreign.value?.ok === false, '外源页面不能写邮箱')
    const saved = await call('ghr.identity.email', { query: 'email=owner@example.com' }, 'http://127.0.0.1:3080')
    check(saved.value?.wrote === true && saved.value.email === 'owner@example.com', '真实同源来源经宿主传递后可以保存邮箱')
    const changedMethod = await call('ghr.identity.email', { method: 'GET', query: 'email=wrong@example.com' }, 'http://127.0.0.1:3080')
    check(changedMethod.value?.ok === false && /E_RPC_ARGS/.test(changedMethod.value.error), '入参不能覆盖端点方法')
    const proto = await call('ghr.protocol')
    check(proto.value.spec === 'dsh-github-resident/8', '协议号不变')
    check(proto.value.http.endpoints.length === 14 && proto.value.http.endpoints.every(e => handlers.has(e.path)), '协议列全十四项能力（含后来加入的邮箱）且全部已注册')
    check(proto.value.http.base === '/api/dsws', '协议只指向宿主路由')
    const expected = await tools.get('gh_cli_status').execute({}, {})
    const rpc = await call('ghr.state', { query: 'cached=1' })
    check(rpc.value.cached === true && rpc.value.account === expected.activeAccount && rpc.value.gh.path === expected.path, 'gh_cli_status 重建的同一份状态快照供RPC读取')
    const service = await services.get('githubResident').status({ cached: true })
    check(service.snapshotAt === rpc.value.snapshotAt && service.account === rpc.value.account, '服务与RPC共享同一快照时间与账号')
  } finally {
    for (const stop of cleanups.reverse()) stop()
    Server.prototype.listen = listen
  }
})
h.cleanup()
summary()
