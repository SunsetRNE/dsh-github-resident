/**
 * tests/merge/build/merged-render.test.mjs —— 用**当前 dist 产物**真挂载两半的界面（jsdom + 真 React）。
 *
 * 为什么不能只看注册数量：`settings.section` 的两条注册、dock 功能栏到底画不画得出来，
 * 只有把组件真 render 一遍才知道。已有 `deck/tests/smoke-render.test.js` 覆盖 dock / 右栏 / tab 的关键路径；
 * 本文件补的是合并特有的两件事：
 *   1) Resident 半边的**仓库登记库页**（`settings.section#github-repo-registry`）真挂载：
 *      显示根包版本（不是 Deck 上游版本）、如实说明「本地 private 包」，且把 Deck 交出的设置区块
 *      （`mergeEmbed.SettingsSections`）渲染在同一页里（同源同状态）；
 *   2) 功能栏（`conversation.input.dock`）真挂载后的**收起 → 展开往返**：收起态只剩一颗展开小按钮，
 *      点它横幅与胶囊都回来；收起状态按工作区记进 localStorage（会话语义不串）。
 * 另做静态把手核对（模态座位 / 技能入口 / 菜单类名仍在产物里），不做 jsdom 里点全菜单的重活。
 *
 * 限制（如实说）：桩宿主 + jsdom，不是真机视觉验证；宽度扫描/真 Chromium 由 deck 的 browser 门禁在屏障后跑。
 *
 * 用法：node tests/merge/build/merged-render.test.mjs（先跑 npm run build）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import { MERGED_IDENTITY, MERGED_PACKAGE_NAME, MERGED_VERSION } from '../../../tools/merge/merge-identity.ts'
import { REPO_ROOT, check, countOccurrences, existsSync, finish, section } from './_lib.mjs'

const CLIENT = join(REPO_ROOT, 'dist/client.js')
const requireFromRepo = createRequire(join(REPO_ROOT, 'package.json'))

section('0. 前置')
check('dist/client.js 存在', existsSync(CLIENT), '先运行 npm run build')
if (!existsSync(CLIENT)) finish()
const code = readFileSync(CLIENT, 'utf8')
check('全文只有一个模块装载点（单 Client）', countOccurrences(code, 'window.__ModuleLoader__.load(') === 1)

section('1. 在 jsdom 窗口里装载合并产物')
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:59519/',
  runScripts: 'outside-only',
})
const win = dom.window
const React = requireFromRepo('react')
const ReactDOM = requireFromRepo('react-dom')
const ReactDOMClient = requireFromRepo('react-dom/client')
const { act } = React
const hookErrors = []
const originalConsoleError = console.error
console.error = (...args) => {
  const text = args.map(String).join(' ')
  if (/change in the order of Hooks|Expected static flag|Rendered (?:more|fewer) hooks/i.test(text)) hookErrors.push(text)
  originalConsoleError(...args)
}

// 从真实 Provider 元素的 value 观察 cx，不读取 React 渲染结束后已恢复的 _currentValue。
// 不替换 Context 或组件，只记录产物交给 React.createElement 的值。
let renderedDeckCx = null
const reactForHalf = new Proxy(React, {
  get(target, prop) {
    if (prop === 'createElement') {
      return (type, props, ...children) => {
        if (props && props.value && props.value.storeSvc && props.value.h) renderedDeckCx = props.value
        return React.createElement(type, props, ...children)
      }
    }
    return Reflect.get(target, prop)
  },
})
function deckCx() { return renderedDeckCx }

// React DOM 在 **Node 上下文**里跑（渲染调用由本测试发起），它的更新优先级要读全局 window.event；
// 合并客户端自己则在 jsdom 的 vm 上下文里求值。两边都得看到同一个 window/document，否则
// 真挂载第一步就 ReferenceError: window is not defined —— 那不是被测界面的缺陷，是测试夹具缺全局。
globalThis.window = win
globalThis.document = win.document
// Node 22+ 的 globalThis.navigator 只有 getter（赋值即 TypeError）；jsdom 的 navigator 能拿到就用，
// 拿不到也不影响本测试（不测剪贴板），所以这里只尝试、不判失败。
try { globalThis.navigator = win.navigator } catch (eNav) {}
globalThis.Node = win.Node
globalThis.HTMLElement = win.HTMLElement
globalThis.getComputedStyle = win.getComputedStyle
globalThis.requestAnimationFrame = win.requestAnimationFrame || ((cb) => win.setTimeout(cb, 0))
globalThis.cancelAnimationFrame = win.cancelAnimationFrame || ((id) => win.clearTimeout(id))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
win.IS_REACT_ACT_ENVIRONMENT = true

win.React = React
// 真页面里 window.ReactDOM 是完整的 react-dom（带 createPortal）。给 client 版的话 RDOM 探不到
// createPortal，弹窗/悬浮菜单就退化成原地渲染 —— 那测出来的就不是浏览器里的那条路。
win.ReactDOM = ReactDOM
win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
win.document.fonts = { ready: Promise.resolve() }
win.requestAnimationFrame = (cb) => win.setTimeout(cb, 0)
win.cancelAnimationFrame = (id) => win.clearTimeout(id)
// 宿主电话桩：StatusBar / 设置区块都用 host.call 取数，取不到也要能渲染（失败静默是既有行为）。
const hostStub = { call: async () => ({ ok: true }) }
win.host = hostStub
// 登记库页读回环接口：给一份最小合法快照，断言页面按业务文案渲染（不联网、不打真实端口）。
win.fetch = async (url) => {
  const u = String(url)
  const body = u.includes('/registry/list')
    ? { entries: [], remoteBound: 0, withoutRemote: 0, libraryExists: false }
    : u.includes('/registry')
      ? { phase: 'ok', consent: { recorded: true, grants: [{ root: '/tmp/x', depth: 2, via: 'lead' }] }, libraryExists: false, dir: '/tmp/registry' }
      : { authenticated: true, account: 'tester', probe: { state: 'idle' } }
  return { ok: true, status: 200, json: async () => body }
}

let loaded = null
win.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
let loadError = null
try {
  vm.runInContext(code, dom.getInternalVMContext())
} catch (e) { loadError = e }
check('合并客户端求值不抛错', loadError === null, loadError && loadError.message)
check('ModuleLoader.load 恰好一次且 id = 合并身份', !!loaded && loaded.id === MERGED_PACKAGE_NAME, loaded && loaded.id)
if (!loaded) finish()

const mod = loaded.factory((m) => {
  if (m === 'react') return reactForHalf
  if (m === 'react-dom') return ReactDOM
  if (m === 'react-dom/client') return ReactDOMClient
  throw new Error('合并客户端请求了未预期的模块：' + m)
})

section('2. 用宿主桩 apply：捕获两半的插槽注册')
const dict = {}
const trFn = (key, params) => {
  let s = dict[key] !== undefined ? dict[key] : key
  if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
  return s
}
const registrations = []
const slots = {
  register(meta, comp) { registrations.push({ meta, comp }); return () => {} },
  inject(name, fn) { try { fn() } catch (e) { /* stub */ } },
}
const nativeTypes = []
const services = {
  slots,
  sidebarRightTabs: { register: (def) => { nativeTypes.push(def); return () => {} } },
  connection: { rpc: { call: async () => ({ ok: true, value: { status: 'ok' } }) } },
  locale: { register: (ns, d) => { Object.assign(dict, (d && d.zh) || {}, (d && d.en) || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [], get: () => null },
  sessions: { list: () => [], get: () => null },
  timer: { timeout: (fn, ms) => win.setTimeout(fn, ms), clearTimeout: (id) => win.clearTimeout(id), interval: (fn, ms) => win.setInterval(fn, ms), clearInterval: (id) => win.clearInterval(id) },
}
const ctx = {
  slots,
  get: (k) => services[k],
  inject: (deps, cb) => { if (typeof cb === 'function') cb(ctx); return { dispose: () => {} } },
  effect: (fn) => { try { const r = fn(); return typeof r === 'function' ? r : () => {} } catch (e) { return () => {} } },
  provide: () => {},
  on: () => () => {},
}
let applyError = null
try { mod.apply(ctx) } catch (e) { applyError = e }
check('apply 不抛错（两半都在桩宿主下跑通）', applyError === null, applyError && applyError.stack && applyError.stack.split('\n')[0])

const byName = {}
for (const r of registrations) {
  const key = (r.meta && r.meta.name) + '#' + (r.meta && (r.meta.id || r.meta.key))
  byName[key] = r.comp
}
const StatusBarComp = byName['conversation.input.dock#' + MERGED_IDENTITY]
const RegistryComp = byName['settings.section#github-repo-registry']
const RightPaneComp = byName['sidebar.right.pane.tab#' + MERGED_IDENTITY + '/deck:map']
const RunPanelComp = byName['tool.view.cordis#self']
check('dock 功能栏组件被捕获（id = 合并身份）', !!StatusBarComp)
check('仓库登记库页组件被捕获（settings.section#github-repo-registry）', !!RegistryComp)
check('右侧栏面板内容体被捕获（keyed 槽）', !!RightPaneComp)
check('RunPanel 被捕获（tool.view.cordis key=self）', !!RunPanelComp)

async function renderTo(Comp, props) {
  const container = win.document.createElement('div')
  win.document.body.appendChild(container)
  let root = null
  await act(async () => {
    root = ReactDOMClient.createRoot(container)
    root.render(React.createElement(Comp, props || null))
  })
  // useEffect 在首个 act 提交后才安排两跳 RAF；必须在提交之后再等它们。
  await act(async () => { await new Promise((r) => win.setTimeout(r, 30)) })
  return {
    html: () => container.innerHTML,
    body: () => win.document.body.innerHTML,
    container,
    unmount: async () => { try { await act(async () => root.unmount()) } catch (e) {} try { container.remove() } catch (e) {} },
  }
}
const has = (h, s) => h.indexOf(s) >= 0
/** 用产物自己的 storeSvc.emit 驱动一次会话私有状态更新，并在 act 内等它提交完。 */
async function actEmit(cx, st, mutate) {
  await act(async () => {
    mutate()
    if (cx && cx.storeSvc) cx.storeSvc.emit(st)
    await new Promise((r) => win.setTimeout(r, 25))
  })
}

section('3. 仓库登记库页真挂载：根包版本 + 本地 private 说明 + Deck 区块同页')
{
  const view = await renderTo(RegistryComp, null)
  const html = view.html()
  check('渲染出登记库页标题', has(html, '仓库登记文件库'))
  check('版本号来自根 package.json（含 ' + MERGED_VERSION + '）', has(html, MERGED_VERSION.replace(/^v/, '')))
  check('不显示 Deck 上游版本 1.8.0-rc.7', !has(html, '1.8.0-rc.7'))
  check('状态区有「插件版本」一行（唯一更新入口的位置）', has(html, '插件版本'))
  check('如实说明本包是本地 private、更新走源码重装', has(html, '本地 private') && has(html, '源码重新安装'))
  check('如实说明不从 npm 更新、不装回旧 Deck', has(html, '不从 npm 更新') && has(html, '不会装回旧的 Deck'))
  check('许可状态区渲染（读的是同一份 /registry 快照）', has(html, 'ghreg-ask') || has(html, '登记库已建立') || has(html, '未许可') || has(html, '许可'))
  check('Deck 交出的设置区块渲染在同一页里（mergeEmbed 交接）', has(html, 'dsws-embed') || has(html, 'dsws-cfg-group'))
  check('Deck 区块的标题渲染出来（同源组件）', has(html, '工作区总览') || has(html, 'cfg.wsTitle') || has(html, 'dsws-cfg-gtitle'))
  await view.unmount()
}

section('4. 功能栏真挂载：胶囊 / 收起展开 / 菜单 / 弹窗座位 / 会话与工作区隔离')
{
  const CWD_A = '/tmp/merge-render-ws-a'
  const CWD_B = '/tmp/merge-render-ws-b'
  const props = (sid, cwd) => ({ sessionId: sid, session: { cwd: cwd }, useSessions: () => null, inputActions: null })
  const viewA = await renderTo(StatusBarComp, props('sid-a', CWD_A))
  const viewB = await renderTo(StatusBarComp, props('sid-b', CWD_B))

  check('展开态画出胶囊（.dsws-capsule）', has(viewA.html(), 'dsws-capsule'))
  check('胶囊最右有收起按钮（.dsws-fold-toggle）', has(viewA.html(), 'dsws-fold-toggle'))
  check('技能入口在胶囊里（.dsws-skillbtn）', has(viewA.html(), 'dsws-skillbtn') || has(viewA.html(), 'dsws-skillpop'))

  // 从产物自己的 createContext 取 cx：用它自己的 storeSvc 驱动会话私有状态，
  // 这样「菜单 / 弹窗座位 / 会话隔离」测的是产物内部真状态，而不是静态类名。
  const cx = deckCx()
  check('拿到产物自己的 cx（DswsCtx.Provider 已渲染）', !!cx)
  const stA = cx ? cx.storeSvc.storeOf('sid-a') : null
  const stB = cx ? cx.storeSvc.storeOf('sid-b') : null
  check('两个会话各有一份 store（会话隔离的前提）', !!stA && !!stB && stA !== stB)
  if (!cx || !stA || !stB) { await viewA.unmount(); await viewB.unmount() } else {

    // ---- 悬浮菜单（PortalOverlay 挂 body）----
    await actEmit(cx, stA, () => { stA.takeMenuOpen = true; stA.takeMenuPos = { left: 4, bottom: 4 } })
    check('take 菜单打开后挂到 body（.dsws-takemenu）', has(win.document.body.innerHTML, 'dsws-takemenu'))
    check('take 菜单全页只有一份（只有会话 A 的状态被打开）', win.document.body.querySelectorAll('.dsws-takemenu').length === 1)
    await actEmit(cx, stA, () => { stA.takeMenuOpen = false })
    check('关掉后菜单从 body 撤掉', !has(win.document.body.innerHTML, 'dsws-takemenu'))

    await actEmit(cx, stA, () => { stA.bugMenuOpen = true; stA.bugMenuPos = { left: 4, bottom: 4 } })
    check('bug 菜单打开后挂到 body（.dsws-bugmenu）', has(win.document.body.innerHTML, 'dsws-bugmenu'))
    await actEmit(cx, stA, () => { stA.bugMenuOpen = false })
    check('关掉后 bug 菜单撤掉', !has(win.document.body.innerHTML, 'dsws-bugmenu'))

    // ---- 弹窗座位：SetupCard 与表单弹窗共用 StatusBar 里那一个座位 ----
    await actEmit(cx, stA, () => { stA.setupLayoutCardOpen = true })
    const cardTitle = dict['setup.cardTitle'] || 'setup.cardTitle'
    check('SetupCard 打开时座位画出 .dsws-modalbox', has(win.document.body.innerHTML, 'dsws-modalbox'))
    check('SetupCard 标题来自 locale（' + cardTitle + '）', has(win.document.body.innerHTML, cardTitle))
    await actEmit(cx, stA, () => { stA.setupLayoutCardOpen = false })
    check('关掉卡后座位不残留', !has(win.document.body.innerHTML, 'dsws-modalbox'))

    await actEmit(cx, stA, () => {
      stA.formModal = { open: true, label: 'MERGE-RENDER-MODAL-A', schema: [{ name: 'repo', label: 'Repo', type: 'text' }] }
    })
    const modalBody = win.document.body.innerHTML
    check('表单弹窗用同一个座位渲染（label 出现）', has(modalBody, 'MERGE-RENDER-MODAL-A'))
    check('弹窗带 dialog 语义', has(modalBody, 'role="dialog"') || has(modalBody, "role='dialog'"))
    check('弹窗按 schema 渲染字段', has(modalBody, 'Repo'))
    check('会话 B 看不到 A 的弹窗（会话隔离）', !has(viewB.html(), 'MERGE-RENDER-MODAL-A'))
    await actEmit(cx, stA, () => { stA.formModal = null })
    check('关掉后弹窗撤掉', !has(win.document.body.innerHTML, 'MERGE-RENDER-MODAL-A'))

    // ---- 会话隔离：门控窗由 StatusBar 就地渲染（不走 portal），正好能按容器分辨 ----
    const gateText = dict['switch.pleaseSelectTracker'] || 'switch.pleaseSelectTracker'
    await actEmit(cx, stB, () => { stB.gateModalOpen = true; stB.gateModalSource = 'status' })
    check('会话 B 的门控窗渲染在自己的容器里（' + gateText + '）', has(viewB.html(), gateText))
    check('会话 A 不受 B 的状态影响（会话隔离）', !has(viewA.html(), gateText))
    await actEmit(cx, stB, () => { stB.gateModalOpen = false })

    // ---- 收起 → 展开往返（按工作区记忆）----
    const fold = viewA.container.querySelector('.dsws-fold-toggle')
    check('取到收起按钮的 DOM 节点', !!fold)
    if (fold) {
      await act(async () => { fold.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await new Promise((r) => win.setTimeout(r, 40)) })
      check('点收起后胶囊不再渲染（整条功能区收起）', !has(viewA.html(), 'dsws-capsule'))
      check('收起只作用于本工作区：另一个工作区的胶囊还在（工作区隔离）', has(viewB.html(), 'dsws-capsule'))
      const expandBtn = viewA.container.querySelector('[aria-label="' + (dict['banner.expandDeck'] || 'banner.expandDeck') + '"]')
      check('收起态只剩一颗展开小按钮（aria-label = banner.expandDeck）', !!expandBtn)
      if (expandBtn) {
        await act(async () => { expandBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await new Promise((r) => win.setTimeout(r, 40)) })
        check('点展开后胶囊与横幅都回来（收起可恢复）', has(viewA.html(), 'dsws-capsule'))
      }
      // 收起记忆按工作区写进 localStorage：key 里带工作区规整键，不串会话。
      let stored = ''
      try { stored = JSON.stringify(Object.keys(win.localStorage).filter((k) => k.indexOf('dsws.bannerFold') >= 0)) } catch (e) { stored = 'localStorage-unavailable' }
      check('收起状态写进 dsws.bannerFold 桶（实际 ' + stored + '）', stored.indexOf('bannerFold') >= 0)
    }
  }
  await viewA.unmount()
  await viewB.unmount()
}

section('5. 右侧栏面板：关闭（卸载）后重开仍可用')
{
  const paneProps = { sessionId: 'sid-a', session: { cwd: '/tmp/merge-render-ws-a' }, useSessions: () => null }
  const first = await renderTo(RightPaneComp, paneProps)
  check('第一次打开：先出面板本人那层空壳（.dsws-hold，防右栏黑一下）', has(first.html(), 'dsws-hold'))
  check('下一帧挂上内容体（.dsws-tabs / .dsws-body）', has(first.html(), 'dsws-tabs') || has(first.html(), 'dsws-body'))
  await first.unmount()

  const again = await renderTo(RightPaneComp, paneProps)
  check('关闭后重开：空壳照常（注册未被关一次就损坏）', has(again.html(), 'dsws-hold'))
  check('关闭后重开：面板内容体仍画得出来（右栏关闭后仍可用）', has(again.html(), 'dsws-tabs') || has(again.html(), 'dsws-body'))
  await again.unmount()
}

section('6. 静态把手：模态座位 / 菜单 / 会话语义标记仍在产物里（合并没顺手改坏）')
for (const marker of ['dsws-modal', 'dsws-modalbox', 'dsws-banner', 'dsws-capsule', 'dsws-skillpop', 'dsws-takemenu', 'dsws-bugmenu', 'data-dsws-logdot', 'dsws-folded', 'dsws.bannerFold', 'data-fold-priority']) {
  check('产物含 ' + marker, has(code, marker))
}
check('模态座位（FormModalSeat/modalSeat）仍在状态栏渲染路径里', has(code, 'FormModalSeat') && has(code, 'modalSeat'))
check('右栏 tab 类型 id/kind = 合并身份（老会话由身份迁移接管）', nativeTypes.length === 1 && nativeTypes[0].kind === MERGED_IDENTITY + ':deck-map')
console.error = originalConsoleError
check('卡片 / 表单 / 关闭状态切换不改变 Hooks 顺序', hookErrors.length === 0, hookErrors.join('\n'))
finish()
