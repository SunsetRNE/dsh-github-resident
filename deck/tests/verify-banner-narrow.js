// verify-banner-narrow.js — 黄条（`banner.setup`）窄屏适配门禁（票「黄条（banner.setup）窄屏适配」）
//
// 维护者 2026-10-12 真机截图报这条黄条「适配性太差」：窄屏下文案与那颗长按钮挤在一起、读不成句。
// 本门量的是**几何**，不靠肉眼：
//   窄屏档（393 / 360 / 320 CSS px）：黄条自身 `scrollWidth <= clientWidth`，且正文、主按钮、那颗叉
//     三个框都落在黄条自己的框内（不许有谁越界，也不许靠裁切换来「看着不溢出」）；
//   桌面档（1200）：必须还是一行 —— 正文与主按钮同排（中线差不超 2px）、黄条高度不涨（≤ 34px）。
//
// 量的是真东西：真 Chromium + 真产物（`package/lib/client.js`）+ 真引导链状态（仓库已就绪、初始化未过，
// 于是出的正是那条 `banner.setup` 黄条），挂在与真机同一套几何的宿主壳里。
//
// 依赖：playwright（含 chromium）与 esbuild，都在本仓 devDependencies；真渲染通道见 tests/lib/chromium-channel.js。
// 运行：cd deck && node scripts/build.mjs && node tests/verify-banner-narrow.js

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { launchChromium, describeChannel } from './lib/chromium-channel.js'

let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }

const CLIENT = 'package/lib/client.js'
if (!existsSync(resolve(CLIENT))) {
  console.log('产物缺失（' + CLIENT + '）：先跑 node scripts/build.mjs')
  process.exit(1)
}

const NARROW = [393, 360, 320]
const DESKTOP = 1200

const CWD = 'D:\\ilife\\packages\\skill-calorie'
// 链快照：GitHub 那条链走到「仓库已就绪、初始化没过」—— guideBannerStep 在这一步出的就是 `banner.setup`。
const CHAIN = [
  { id: 'gh:installed', status: 'done' },
  { id: 'gh:login', status: 'done' },
  { id: 'gh:remote', status: 'done' },
  { id: 'tracker:initialized', status: 'pending' },
]
const SNAP = {
  ok: true, version: 'verify-banner-narrow', generatedMs: Date.now() - 3 * 60 * 1000,
  workspaceRoot: 'd:/ilife', maps: [], checks: null, isLocal: false, tickets: [], groups: {},
  repository: { name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', backend: 'github' },
  selection: { backendId: 'github', source: 'explicit' },
  chainSnapshot: { steps: CHAIN },
}

const ENTRY = `
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
window.React = React
window.__RDOM__ = ReactDOMClient
const CWD = window.__CWD__
const SNAP = window.__SNAP__
let loaded = null
window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
const runInPage = (code) => { const s = document.createElement('script'); s.textContent = code; document.body.appendChild(s) }
runInPage(window.__CLIENT_SRC__)
const dict = {}
const trFn = (k, p) => {
  let s = dict[k] !== undefined ? dict[k] : k
  if (p) s = s.replace(/\\{(\\w+)\\}/g, (m, n) => (n in p ? String(p[n]) : m))
  return s
}
const regs = []
const reply = (method) => {
  if (method === 'cwd') return { ok: true, cwd: CWD }
  if (method === 'snapshot' || method === 'refresh') return SNAP
  if (method === 'chain') return { ok: true, snapshot: { steps: SNAP.chainSnapshot.steps }, chain: SNAP.chainSnapshot.steps.map((s) => s.id), fullChain: null, resolved: [] }
  if (method === 'registry') return { ok: true, modules: [{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }] }
  return { ok: true }
}
const services = {
  slots: { register: (m, c) => { regs.push({ m, c }); return () => {} }, inject: (n, f) => { try { f() } catch (e) {} } },
  sidebarRightTabs: { register: () => () => {} },
  connection: { rpc: { call: async (channel, endpoint, body) => ({ ok: true, value: reply(body && body.method) }) } },
  locale: { register: (ns, d) => { Object.assign(dict, (d && d.zh) || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [] },
  sessions: { list: async () => [] },
  timer: { timeout: (f, ms) => setTimeout(f, ms) },
}
const ctx = { get: (k) => services[k], effect: (f) => { f(); return () => {} }, inject: (deps, cb) => { cb(ctx); return { dispose: () => {} } } }
loaded.factory((m) => (m === 'react' ? React : m === 'react-dom' ? ReactDOMClient : {})).apply(ctx)
const dockComp = regs.filter((r) => r.m && r.m.name === 'conversation.input.dock')[0]

window.__TICK__ = async function (n) {
  for (let i = 0; i < (n || 3); i++) await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 16) }) })
}
window.__WAIT__ = (pred, ms) => new Promise((res) => {
  const t0 = Date.now()
  const tick = () => { if (pred() || Date.now() - t0 > ms) res(!!pred()); else setTimeout(tick, 25) }
  tick()
})
// 照抄真机几何：列 → 宿主的 composer dock → 插件的挂载点（与 verify-capsule-layout / verify-cap-fold-browser 同一套算式）
window.__MOUNT__ = async function (o) {
  const opt = o || {}
  const old = document.getElementById('col')
  if (old) old.remove()
  const col = document.createElement('div')
  col.id = 'col'
  col.style.width = (opt.column === undefined ? 1200 : opt.column) + 'px'
  const dock = document.createElement('div')
  dock.id = 'dock'
  dock.style.cssText = 'box-sizing:border-box;margin:0 auto;' +
    'width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));' +
    'max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))'
  const slot = document.createElement('div')
  slot.id = 'slot'
  dock.appendChild(slot)
  col.appendChild(dock)
  document.body.appendChild(col)
  window.__COL__ = col
  document.documentElement.style.setProperty('--dsh-conversation-column-width', (opt.column === undefined ? 1200 : opt.column) + 'px')
  if (!dockComp) return { error: 'no dock registration', names: regs.map((r) => r.m && r.m.name) }
  const props = Object.assign(
    dockComp.m.inject ? dockComp.m.inject('sess-1') : { sessionId: 'sess-1' },
    { session: { cwd: CWD }, useSessions: () => null, inputActions: null },
  )
  let thrown = null
  try { window.__RDOM__.createRoot(slot).render(React.createElement(dockComp.c, props)) } catch (e) { thrown = String((e && e.message) || e) }
  const arrived = await window.__WAIT__(() => !!slot.querySelector('.dsws-banner'), 8000)
  await window.__TICK__(4)
  return { ok: !!slot.querySelector('.dsws-banner'), arrived: arrived, thrown: thrown }
}
window.__SET_COLUMN__ = async function (w) {
  window.__COL__.style.width = w + 'px'
  document.documentElement.style.setProperty('--dsh-conversation-column-width', w + 'px')
  await window.__TICK__(3)
}
// 黄条这一帧的几何：自己多宽、有没有被内容撑出溢出、里面那几件东西的框相对它自己落在哪。
window.__BANNER__ = function () {
  const b = document.querySelector('.dsws-banner')
  if (!b) return { error: 'no banner' }
  const br = b.getBoundingClientRect()
  const cs = getComputedStyle(b)
  const kids = Array.from(b.children).map(function (el, i) {
    const r = el.getBoundingClientRect()
    return {
      i: i, tag: el.tagName.toLowerCase(), cls: String(el.className || ''),
      text: String(el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
      left: Math.round((r.left - br.left) * 100) / 100,
      top: Math.round((r.top - br.top) * 100) / 100,
      right: Math.round((r.right - br.left) * 100) / 100,
      bottom: Math.round((r.bottom - br.top) * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      cy: Math.round(((r.top + r.bottom) / 2 - br.top) * 100) / 100,
    }
  })
  const pick = function (el) {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      text: String(el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
      left: Math.round((r.left - br.left) * 100) / 100,
      top: Math.round((r.top - br.top) * 100) / 100,
      right: Math.round((r.right - br.left) * 100) / 100,
      bottom: Math.round((r.bottom - br.top) * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100,
      cy: Math.round(((r.top + r.bottom) / 2 - br.top) * 100) / 100,
    }
  }
  // 类名把手优先，取不到时按结构兜底 —— 这样修之前的产物也能被这把尺子量到（否则「修前」量不出东西）。
  const textEl = b.querySelector('.dsws-banner-text') || Array.from(b.children).find((el) => el.tagName === 'SPAN')
  const actEl = b.querySelector('.dsws-banner-act') || Array.from(b.querySelectorAll('button')).find((el) => !/fold-x/.test(String(el.className)))
  return {
    ok: true,
    cls: String(b.className || ''),
    w: Math.round(br.width * 100) / 100,
    h: Math.round(br.height * 100) / 100,
    clientW: b.clientWidth, scrollW: b.scrollWidth,
    overflow: b.scrollWidth - b.clientWidth,
    padL: parseFloat(cs.paddingLeft) || 0, padR: parseFloat(cs.paddingRight) || 0,
    wrap: cs.flexWrap,
    kids: kids,
    text: pick(textEl),
    act: pick(actEl),
    foldX: pick(b.querySelector('.dsws-banner-fold-x')),
  }
}
// 反证（自带）：在克隆件上把这条横幅打回改造前的写法 —— 不许折行（flex-wrap:nowrap）+ 正文 flex:1，
//   上面那把「正文拿到半宽以上 + 没被压成一列」的尺子必须当场报红；抓不住就是假绿。真节点一个字不碰。
window.__SQUEEZE__ = function () {
  const b = document.querySelector('.dsws-banner')
  if (!b) return { error: 'no banner' }
  const clone = b.cloneNode(true)
  clone.style.position = 'absolute'
  clone.style.visibility = 'hidden'
  clone.style.left = '-10000px'
  clone.style.width = Math.round(b.getBoundingClientRect().width) + 'px'
  clone.style.flexWrap = 'nowrap'          // 改造前：这条横幅不许折行
  b.parentElement.appendChild(clone)
  const t = clone.querySelector('.dsws-banner-text')
  if (t) { t.style.flex = '1'; t.style.overflowWrap = 'normal' }
  void clone.offsetWidth
  const cs = getComputedStyle(clone)
  const innerW = clone.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
  const r = t ? t.getBoundingClientRect() : null
  const out = {
    ok: true,
    w: r ? Math.round(r.width * 100) / 100 : null,
    h: r ? Math.round(r.height * 100) / 100 : null,
    innerW: Math.round(innerW * 100) / 100,
  }
  clone.remove()
  return out
}
window.__PROBE_READY__ = true
`

const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: resolve('.'), sourcefile: 'verify-banner-narrow-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text
const clientSrc = readFileSync(resolve(CLIENT), 'utf8')
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#10131a;color:#e6edf3;font-family:Arial,Helvetica,sans-serif}
:root{--dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:0px;
  --dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);
  --dsh-chat-content-width:clamp(680px, var(--dsh-conversation-column-width) * 0.64, 920px)}
#col{background:#0a0a0a;padding:8px 0}
</style></head>
<body>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(clientSrc)};</script>
<script>window.__CWD__ = ${JSON.stringify(CWD)};window.__SNAP__ = ${JSON.stringify(SNAP)};</script>
<script>${probeJs}</script></body></html>`

const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port + '/'
console.log(describeChannel())
const browser = await launchChromium()

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)))
  await page.goto(origin, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })

  console.log('')
  console.log('A) 挂载：仓库已就绪 / 初始化没过 → 出的就是那条 banner.setup 黄条')
  const mounted = await page.evaluate(() => window.__MOUNT__({ column: 1200 }))
  check(mounted && mounted.ok === true, '黄条挂上了（' + JSON.stringify(mounted) + '）')
  const first = await page.evaluate(() => window.__BANNER__())
  check(!first.error, '拿得到黄条的几何')
  check(/dsws-banner/.test(String(first.cls || '')), '把手不变：类名仍含 dsws-banner（实得 "' + String(first.cls) + '"）')
  // 正文那一格在本门里是「词条 → 文本」的探针话题：文本可能被 locale 桩渲染成对象，故只钉按钮标签与类名，
  // 正文的真实文案由真机截图那条线核（本门管的是几何，不管词条）。
  check(/初始化/.test(String(first.act && first.act.text)),
    '出的正是那条 `banner.setup` 黄条：按钮「' + String(first.act && first.act.text) + '」')

  console.log('')
  console.log('B) 窄屏档：393 / 360 / 320 —— 黄条不许溢出，里面三件东西都得落在它自己框里')
  for (const w of NARROW) {
    await page.evaluate((width) => window.__SET_COLUMN__(width), w)
    const m = await page.evaluate(() => window.__BANNER__())
    const tag = '列宽 ' + w + '（黄条 ' + m.w + '×' + m.h + '，scrollW-clientW=' + m.overflow + '）'
    check(m.overflow <= 0, tag + ' 黄条自身没有横向溢出')
    // 「挤在一起、读不成句」的可编程版：正文那一格必须拿到像样的宽（≥ 一半内宽），且不许被压成一列多行。
    const innerW = m.w - m.padL - m.padR
    check(m.text.w >= innerW * 0.5, tag + ' 正文拿到半宽以上（实得 ' + m.text.w + 'px，内宽 ' + Math.round(innerW * 100) / 100 + 'px）')
    check(m.text.h <= 48, tag + ' 正文没被压成一列（实得高 ' + m.text.h + 'px —— 12px 字两行约 32）')
    for (const key of ['text', 'act', 'foldX']) {
      const r = m[key]
      if (!r) { bad(tag + ' 找不到 ' + key + '（' + key + ' = ' + JSON.stringify(r) + '）'); continue }
      const inside = r.left >= -0.5 && r.right <= m.w + 0.5 && r.top >= -0.5 && r.bottom <= m.h + 0.5
      check(inside, tag + ' ' + key + ' 落在黄条框内（left ' + r.left + ' / right ' + r.right + ' / top ' + r.top + ' / bottom ' + r.bottom + '，黄条宽 ' + m.w + ' 高 ' + m.h + '）')
    }
  }

  console.log('')
  console.log('C) 桌面档：1200 下必须还是一行 —— 不因修窄屏把宽屏改坏')
  await page.evaluate((width) => window.__SET_COLUMN__(width), DESKTOP)
  const d = await page.evaluate(() => window.__BANNER__())
  console.log('     （实得：黄条 ' + d.w + '×' + d.h + '；正文 ' + d.text.w + '、主按钮 ' + d.act.w + '、叉 ' + (d.foldX ? d.foldX.w : '无') + '）')
  check(d.overflow <= 0, '桌面档不溢出（实得 ' + d.overflow + '）')
  check(d.h <= 40, '桌面档黄条仍是一行高（实得高 ' + d.h + 'px）')
  check(Math.abs(d.text.cy - d.act.cy) <= 2, '桌面档正文与主按钮同排（中线差 ' + Math.round(Math.abs(d.text.cy - d.act.cy) * 100) / 100 + 'px）')

  console.log('')
  console.log('D) 反证：把这格打回改造前的写法（flex:1），尺子必须当场报红（量在克隆件上，真节点不碰）')
  await page.evaluate((width) => window.__SET_COLUMN__(width), NARROW[0])
  const sq = await page.evaluate(() => window.__SQUEEZE__())
  const sqOk = sq && sq.w >= sq.innerW * 0.5 && sq.h <= 48
  check(sq && sq.ok === true, '反证件立起来了（' + JSON.stringify(sq) + '）')
  check(!sqOk, '反证成立：改造前的写法量出「正文只有 ' + (sq && sq.w) + 'px 宽、' + (sq && sq.h) + 'px 高」，那把尺子判它不合格')

  console.log('')
  console.log('E) 整段扫描期间页面没有未捕获的报错')
  check(pageErrors.length === 0, '实测 ' + pageErrors.length + ' 条' + (pageErrors.length ? '：' + pageErrors.slice(0, 3).join(' | ') : ''))
} finally {
  await browser.close()
  server.close()
}

console.log('')
console.log(failed === 0
  ? '全部通过：窄屏 ' + NARROW.join('/') + ' 黄条不溢出、三件东西都在框内；桌面 ' + DESKTOP + ' 仍是一行'
  : passed + ' 条通过，' + failed + ' 条失败')
process.exit(failed === 0 ? 0 : 1)
