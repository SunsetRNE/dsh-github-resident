/**
 * issue 51 的公开接缝：真实发布装配 → ModuleLoader → React 设置页 → connection → dsws。
 * 默认仅在外部 connection 接缝使用最小载体，业务端点由测试提供。
 * 不启动服务，不写 dist。DSH_CONNECTION_CLIENT 显式启用真实 DSH 模块，同组断言不变。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import * as React from 'react'
import { rewriteDeckClient } from '../../../tools/merge/rewrite-deck-client.ts'
import { createRpcChannel } from '../../../deck/src/host/rpcChannel.js'
import { installConnectionFixture } from './connection-carrier.fixture.mjs'

const require = createRequire(import.meta.url)
const repoFile = (path) => fileURLToPath(new URL('../../../' + path, import.meta.url))
const connectionSource = process.env.DSH_CONNECTION_CLIENT ? readFileSync(process.env.DSH_CONNECTION_CLIENT, 'utf8') : null
const clientSource = rewriteDeckClient(
  readFileSync(repoFile('deck/package/lib/client.js'), 'utf8'),
  readFileSync(repoFile('client.js'), 'utf8'),
).text

export const account = {
  authenticated: true, account: 'rpc-reader', cached: true,
  probe: { state: 'ready' }, gh: { version: 'gh test', layer: 'system' },
  commitEmail: { offer: true, stored: null },
}

export async function mountClient(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:3080/', runScripts: 'outside-only',
  })
  const win = dom.window
  // jsdom 没有 fetch；与内存传输的 Node Request 使用同一组标准取消对象。
  win.AbortController = globalThis.AbortController
  win.AbortSignal = globalThis.AbortSignal
  if (options.viewport) {
    Object.defineProperty(win, 'innerWidth', { value: options.viewport.width })
    Object.defineProperty(win.navigator, 'userAgent', { value: options.viewport.userAgent })
  }
  const savedGlobals = new Map()
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const { createRoot } = await import('react-dom/client')
  const reactDom = require('react-dom')
  const root = createRoot(win.document.getElementById('root'))
  const cleanups = []
  t.after(async () => {
    await React.act(async () => root.unmount())
    for (const dispose of cleanups.reverse()) dispose()
    dom.window.close()
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })

  // 冻结轮询；deadline 用外部时钟确定性推进，无需实际等 45 秒。
  let timerId = 0
  const timers = new Map()
  win.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id }
  win.clearTimeout = (id) => timers.delete(id)
  win.setInterval = () => ++timerId
  win.clearInterval = () => {}
  const directHttp = []
  win.fetch = async (url) => { directHttp.push(String(url)); throw new Error('禁止客户端私开 HTTP 通道') }
  const opened = []
  win.open = (...args) => opened.push(args)

  const handlers = new Map([
    ['ghr.state', () => account],
    ['ghr.registry', () => ({ libraryExists: true, consent: { recorded: true, grants: [] } })],
    ['ghr.registry.list', () => ({ libraryExists: true, entries: [], remoteBound: 0, withoutRemote: 0 })],
    ['pluginIdentity', () => ({ version: '1.9.7', repoUrl: 'https://github.com/SunsetRNE/dsh-github-resident' })],
    ['logGetSwitch', () => ({ ok: true, enabled: false })],
    ['logBatch', () => ({ ok: true })],
    ['bindings', () => ({ bindings: [] })],
    ['registry', () => ({ modules: [] })],
    ...Object.entries(options.handlers || {}),
  ])
  let route
  const registered = createRpcChannel({
    ctx: { get: () => ({ fetch: { register(spec) { route = spec; return () => {} } } }) },
    handlers, fireLog() {}, dispatchMeta: async () => ({ shortArgHash: () => '', dispatchErrorKind: () => 'internal' }),
  })
  assert.equal(registered.ok, true)
  const requests = []
  const transport = {
    fetch: async (url, init) => {
      const request = new Request(new URL(url, win.location.href), init)
      const envelope = await request.clone().json()
      requests.push({ url: request.url, envelope, signal: init.signal })
      if (options.transport) return options.transport(request, envelope, route.fetch)
      return route.fetch(request)
    },
  }

  const services = {
    locale: { register: () => () => {}, bind: () => (key) => key },
    workspaces: { list: async () => [], get: () => null },
    sessions: { list: () => [], get: () => null },
    timer: { timeout: win.setTimeout, clearTimeout: win.clearTimeout, interval: win.setInterval, clearInterval: win.clearInterval },
    sidebarRightTabs: { register: () => () => {} },
  }
  const registrations = []
  services.slots = {
    inject(name, fn) { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose); return () => {} },
    register(spec, component) { registrations.push({ ...spec, component }); return () => {} },
  }
  const ctx = {
    slots: services.slots,
    get: (name) => services[name],
    provide(name, service) { services[name] = service },
    inject(keys, fn) { if (typeof fn === 'function') fn(); return () => {} },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose); return () => {} },
    on: () => () => {},
  }
  function load(source) {
    let spec
    win.__ModuleLoader__ = { load(value) { assert.equal(spec, undefined, '每个产物只加载一次'); spec = value } }
    vm.runInContext(source, dom.getInternalVMContext())
    return spec.factory((name) => {
      if (name === 'react') return React
      if (name === 'react-dom') return reactDom
      throw new Error('未预期的客户端依赖：' + name)
    })
  }
  const installConnection = connectionSource ? load(connectionSource).installConnection : installConnectionFixture
  installConnection(ctx, { location: win.location, transport })
  if (options.noConnection) delete services.connection
  if (options.rejectLegacyApi) Object.defineProperty(win, '__DSH_GITHUB_RESIDENT_API__', { get() { throw new Error('旧端口配置不得再读取') } })
  const plugin = load(clientSource)
  plugin.apply(ctx)
  assert.equal(win.host, undefined, '宿主没有 window.host；Deck shim 只在自己的 factory 内')
  const section = registrations.find((r) => r.id === (options.section || 'github-resident'))
  assert.ok(section, '真实模块必须注册设置页')
  await React.act(async () => root.render(React.createElement(section.component)))

  return {
    win, handlers, requests, directHttp, opened, timers,
    carrier: connectionSource ? '真实 DSH 模块' : '外部 connection 接缝 fixture',
    text() { const node = win.document.getElementById('root').cloneNode(true); node.querySelectorAll('style').forEach((style) => style.remove()); return node.textContent },
    residentRequests: () => requests.filter((r) => r.envelope.payload.method.startsWith('ghr.')),
    button(label) {
      const button = [...win.document.querySelectorAll('button')].find((b) => b.textContent === label)
      assert.ok(button, '缺少按钮：' + label)
      return button
    },
    async click(label) {
      const button = this.button(label)
      assert.equal(button.disabled, false, '按钮应可操作：' + label)
      await React.act(async () => button.click())
    },
    async input(value) {
      const input = win.document.querySelector('.ghr-input')
      assert.ok(input, '提交邮箱入口应可见')
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new win.Event('input', { bubbles: true }))
      })
    },
    async settle(fn) { await React.act(async () => { if (fn) fn() }) },
    async expireDeadlines(previous = new Set()) {
      const deadlines = [...timers.entries()].filter(([id, timer]) => !previous.has(id) && timer.ms > 0 && timer.ms <= 45000)
      assert.ok(deadlines.length, '动作必须有不超过 45 秒的 deadline')
      await React.act(async () => {
        for (const [id, timer] of deadlines) { timers.delete(id); timer.fn() }
      })
    },
  }
}
