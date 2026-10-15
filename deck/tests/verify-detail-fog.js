// verify-detail-fog.js — 分层 MapDetail 迷雾/四态数据验证（T3 #444）
// 断言：快照中每 map 的票 level 分层正确、被阻塞票可识别为迷雾、四态动作映射可推导
// 用法: node tests/verify-detail-fog.js <仓库根目录>
import fsx from 'node:fs'
const fsp = fsx.promises
import path from 'node:path'
import { spawn } from 'node:child_process'
const REPO_CWD = process.argv[2] || process.cwd()

const subprocess = {
  async resolveExecutable(name) {
    // PATH 分隔符与可执行后缀都按平台取：原来写死 ";" 与 PATHEXT，只有 Windows 找得到；
    // Linux/macOS 的 PATH 是冒号分隔，这些门禁在 CI 上会全场景报「找不到 git」。
    // （#600 附带的 CI 修复：verify-t1-initpublish.js 就是这么在 ubuntu/macos 上必红的。）
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    const exts = process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).map(function (x) { return x.toLowerCase() })
      : ['']
    const cands = []
    for (const d of dirs) { for (const ext of exts) cands.push(path.join(d, name + ext.toLowerCase())); cands.push(path.join(d, name)) }
    for (const c of cands) { try { fsx.accessSync(c); return c } catch (e) { /* 继续 */ } }
    throw new Error('executable not found: ' + name)
  },
  spawn(spec) {
    const cp = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = '', err = ''
    cp.stdout.on('data', d => { out += d })
    cp.stderr.on('data', d => { err += d })
    const done = new Promise(res => cp.on('close', (code, signal) => res({ exitCode: code, signal })))
    return { done, collected: { stdout: { readFrom: () => ({ text: out }) }, stderr: { readFrom: () => ({ text: err }) } }, terminate: () => { try { cp.kill() } catch (e) { /* ignore */ } } }
  },
}
const timer = { timeout: ms => new Promise(res => setTimeout(res, ms)), interval: (fn, ms) => { const id = setInterval(fn, ms); if (id.unref) id.unref(); return () => clearInterval(id) } }
const fsSvc = {
  async resolve(p, opts) { return path.resolve((opts && opts.cwd) || process.cwd(), p) },
  async lstat(p, opts) {
    const abs = path.resolve((opts && opts.cwd) || process.cwd(), p)
    try { const s = await fsp.lstat(abs); return { type: s.isDirectory() ? 'directory' : 'file', size: s.size } } catch (e) { return undefined }
  },
  async readText(t) { return fsp.readFile(t, 'utf8') },
  processPath(t) { return t },
}
// 装配（#58 修，2026-10-15）：宿主 apply 把几十条电话注册进 bootBody 内**自建**的那张表 —— 入参 harness
// 被 apply 内同名常量遮蔽，老写法（整份 host.js 当函数体求值、捕获外层 harness.handle）收到的是 0 条
// （handlers=0），而且宿主那些动态 import 在函数体里没有模块基址（#472 同款，整份 boot 都是死的）。
// 新交付口 `dswEndpoints` 只交**注册入口**（provide 出去的是 { handle }），不给读表口；对外真正载着那张表
// 走的只有一条路：connection.fetch.register 注册的 /api/dsws 分发路由。所以门禁按生产形状打信封走这条路
// （与 verify-t1-getrepokey.js / verify-t1-initpublish.js / verify-chain-env-e2e.js 同一做法），
// 被测物也换成真模块形态的包入口 ../package/lib/index.js（与 src/host/index.js 同源，由 build.mjs 生成）。
// 端点名按 harness shim 的规矩去掉 `wf.` 前缀：'wf.refresh' → 'refresh'。
async function loadPlugin(services) {
  const modRaw = await import('../package/lib/index.js')
  const mod = modRaw.default ?? modRaw
  let route = null
  const connection = { fetch: { register: r => { if (r && r.path === '/api/dsws') route = r; return () => {} } } }
  const ctx = {
    get: n => (n === 'connection' ? connection : services[n]),
    effect: fn => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  ;(mod.apply ?? mod.default?.apply)(ctx)
  // 通道注册在 ./rpcChannel.js 动态加载之后落地，等它。
  const t0 = Date.now()
  while (!route && Date.now() - t0 < 3000) await new Promise(function (r) { setTimeout(r, 20) })
  if (!route || typeof route.fetch !== 'function') throw new Error('宿主未注册 /api/dsws 路由（先跑 npm run build:deck）')
  return async function (endpoint, args) {
    const res = await route.fetch({
      method: 'POST',
      url: 'http://127.0.0.1:1/api/dsws',
      json: async () => ({ type: 'client-request', rpcId: 'gate-' + endpoint, method: 'dsws', payload: { method: endpoint, payload: args } }),
    })
    const env = (await res.json()).result
    if (env && typeof env.value === 'object' && env.value !== null && 'ok' in env.value) return env.value
    return env
  }
}

// 复刻 client 迷雾判定（D7）：open 且被 open 阻塞者 → 迷雾
function fogOf(map) {
  const byNum = {}
  map.tickets.forEach(function (t) { byNum[t.number] = t })
  const isFog = function (t) {
    if (t.state !== 'OPEN') return false
    const blk = (t.blockedBy || []).map(function (b) { return byNum[b] }).filter(Boolean)
    return blk.some(function (b) { return b.state === 'OPEN' })
  }
  return map.tickets.filter(isFog)
}

// 复刻 client 四态动作映射（D5）
function actionOf(t) {
  const labels = (t.labels || []).map(function (l) { return typeof l === 'string' ? l : l.name })
  if (labels.indexOf('needs-triage') >= 0) return 'diagnose'
  if (labels.indexOf('bug') >= 0) return 'fix'
  if (labels.indexOf('wayfinder:grilling') >= 0) return 'discuss'
  return 'execute'
}

async function main() {
  // 前置（#58 收尾 / 与 #63 同批）：这条门禁**要真 gh** —— 快照里的迷雾与层级都是从真 GitHub 读回来的，
  // 没有 gh 就没有数据可核（spawn gh --version 直接 ENOENT，还会以未捕获的 'error' 事件炸掉整个进程）。
  // 处置按环境类那一档（与清单里 27 道同源，见 docs/agents/deck-gate-triage.md）：**出声跳过、不计红**；
  // 但它只是「这台机器跑不了」，不是「这条判据不存在」—— 有 gh 时它必须真绿，跳过不是挡箭牌。
  let ghResolvable = true
  try { await subprocess.resolveExecutable('gh') } catch (e) { ghResolvable = false }
  if (!ghResolvable) {
    console.log('SKIP 前置缺失：PATH 上没有可跑的 gh（这条门禁要真 gh 才能核迷雾 / 层级）')
    console.log('     要真跑：把 gh 放进 PATH（本机自带那份在 ~/.dsh/gh-cli/bin/gh），或先跑 gh_cli_install')
    process.exit(0)
  }
  const checks = []
  const expect = (name, cond, extra) => {
    checks.push({ name, pass: !!cond, extra: extra || '' })
    if (!cond) console.error('  ✗ FAIL:', name, extra || '')
    else console.log('  ✓', name)
  }

  const h = await loadPlugin({ subprocess, timer, fs: fsSvc })
  const snap = await h('refresh', { cwd: REPO_CWD })
  expect('快照 ok', snap && snap.ok === true)
  const maps = (snap && Array.isArray(snap.maps)) ? snap.maps : []
  const withTickets = maps.filter(function (m) { return m.tickets && m.tickets.length > 0 })

  // T3a：迷雾识别 —— 被阻塞票 = 迷雾（D7 语义）
  let fogCount = 0
  withTickets.forEach(function (m) {
    const fog = fogOf(m)
    fogCount += fog.length
    // 每张被识别为迷雾的票：open 且存在 open 阻塞者
    fog.forEach(function (t) {
      const blkOpen = (t.blockedBy || []).some(function (b) { const bt = m.tickets.find(function (x) { return x.number === b }); return bt && bt.state === 'OPEN' })
      expect('map #' + m.number + ' 迷雾票 #' + t.number + ' 语义正确(open+被open阻塞)', t.state === 'OPEN' && blkOpen)
    })
    // 非迷雾 open 票：无 open 阻塞者
    const nonFogOpen = m.tickets.filter(function (t) { return t.state === 'OPEN' && !fog.some(function (f) { return f.number === t.number }) })
    nonFogOpen.forEach(function (t) {
      const hasOpenBlocker = (t.blockedBy || []).some(function (b) { const bt = m.tickets.find(function (x) { return x.number === b }); return bt && bt.state === 'OPEN' })
      expect('map #' + m.number + ' 非迷雾 open 票 #' + t.number + ' 无 open 阻塞者', !hasOpenBlocker)
    })
  })
  // 迷雾存在性不作硬断言（数据演进：T1/T2 完成后 #444 阻塞解除，迷雾可能为 0）
  console.log('  迷雾票总数: ' + fogCount + '（为 0 = 当前无被 open 阻塞的票，正常）')

  // T3b：四态动作映射（D5）—— 每张 open 票可推出动作
  withTickets.forEach(function (m) {
    m.tickets.filter(function (t) { return t.state === 'OPEN' }).forEach(function (t) {
      const act = actionOf(t)
      expect('map #' + m.number + ' 票 #' + t.number + ' 动作=' + act, ['diagnose', 'fix', 'discuss', 'execute'].indexOf(act) >= 0)
    })
  })

  // T3c：迷雾票与分层结合 —— 被阻塞票 level > 阻塞者 level（迷雾在更深层）
  withTickets.forEach(function (m) {
    const fog = fogOf(m)
    fog.forEach(function (t) {
      const blk = (t.blockedBy || []).map(function (b) { return m.tickets.find(function (x) { return x.number === b }) }).filter(Boolean)
      blk.forEach(function (b) {
        if (typeof b.level === 'number' && typeof t.level === 'number') {
          expect('map #' + m.number + ' 迷雾 #' + t.number + ' level>' + b.level + '(阻塞者)', t.level > b.level)
        }
      })
    })
  })

  // T3d：分层渲染前提 —— 每张票有 level（漏斗分层可渲染）
  withTickets.forEach(function (m) {
    const allHave = m.tickets.every(function (t) { return typeof t.level === 'number' })
    expect('map #' + m.number + ' 每张票有 level（漏斗可渲染）', allHave)
  })

  const pass = checks.filter(function (c) { return c.pass }).length
  const fail = checks.length - pass
  console.log('')
  console.log('TOTAL ' + checks.length + ' PASS ' + pass + ' FAIL ' + fail)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch(function (e) { console.error('ERROR', e); process.exit(2) })
