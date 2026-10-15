/**
 * tests/merge/host/net-bounds.test.mjs —— 对 GitHub 的 REST 动作的**上界**
 *（票「给对 GitHub 的网络动作定一套统一的有界冗余策略（可达性随机）」的收窄版：只做三处无上界的 REST）。
 *
 * 为什么需要它：这三处 REST 原先**完全没有上界**（`fetch` 裸调、无 signal）—— 一个不回话的目标就能让
 * 整条路停在「不退出、不报错、不结束」的第三态，而本仓明令不许有第三态。本件钉四件事：
 *   ① **旋钮**：可配 + 上下限钳制 + 调用时才读（不重载插件）；
 *   ② **三处都真的在设定上界内返回**（旋钮压到 300ms，用一个**永不回话**的 fetch 桩实跑）；
 *   ③ 超时**按失败回**，且措辞说得清是「超时 / 未知」—— 不是泛化错误，也不是「HTTP null」；
 *   ④ 三处走的是**同一支** `fetchBounded`（tripwire 防回潮），而下载那条的 300s 上界没被顺手改（重试 / 退避 / 分档口径由 tests/merge/host/net-policy.test.mjs 接着钉 —— 票 55 / #38）。
 *
 * 离线：门禁里临时替换 `globalThis.fetch`（照《gh_pr 共用解析器 + 回落 gh pr create》那条裁决），
 * **不联网、不碰真实 api.github.com**；销毁那条路只走「撤销」一档，破坏性选项全部显式关掉。
 *
 * 用法：node tests/merge/host/net-bounds.test.mjs
 */
import { check, note, section, summary, readText } from './_check.mjs'
import { makeHome, withPlugin, PLUGIN_URL } from './_env-harness.mjs'

const TOKEN_FAKE = 'gho_NETBOUNDS_fixture_abcdefghij'
const LOGIN = 'octocat'
const STATE_REL = '.dsh/github-resident.json'
const BOUND = '300'

const fixture = (tag, state) => makeHome(tag, {
  withGh: true,
  withGit: true,
  files: { [STATE_REL]: JSON.stringify(state) },
})

/**
 * 一个**永不回话**的 fetch：只有上界能救它。
 * abort 时按 `AbortSignal.timeout()` 的语义 reject（`name === 'TimeoutError'`），
 * 这样跑的确实是产品代码里那条 catch 分支，而不是一个自造的假错误。
 * **没有 signal 就永远挂着** —— 这一档正是本票要消灭的第三态；但为了让判据能干净地报红（而不是把门禁挂住），
 * 没 signal 时 5s 后自己 reject 一句「这一处没有上界」。
 */
const hangFetch = (calls) => {
  const real = globalThis.fetch
  globalThis.fetch = (url, init = {}) => new Promise((_, reject) => {
    const sig = init.signal
    calls.push({ url: String(url), hasSignal: Boolean(sig) })
    const bail = () => reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
    if (!sig) { setTimeout(() => reject(new Error('这一处没有上界 signal —— 回到「永远等下去」了')), 5000); return }
    if (sig.aborted) return bail()
    sig.addEventListener('abort', bail, { once: true })
  })
  return () => { globalThis.fetch = real }
}

/**
 * 等待期间**保活**。⚠️ 这是判据自己的事，不是产品的：
 * Node 的 `AbortSignal.timeout()` 用的是 **unref'd** 定时器 —— 某个进程里如果只剩它在等，
 * 事件循环会先空掉、那个 abort 永远不触发（看着像产品挂住，其实是门禁没保活）。
 * 产品里插件始终有回环服务与调度在跑，不受影响；裸测试进程里必须自己拿一个 ref'd 定时器撑着。
 */
const keepAlive = () => {
  const t = setInterval(() => {}, 250)
  return () => clearInterval(t)
}

/** 临时改环境（用完恢复）—— 用于证明「旋钮调用时才读」。 */
const withEnv = async (patch, fn) => {
  const saved = {}
  for (const k of Object.keys(patch)) saved[k] = process.env[k]
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  try { return await fn() } finally {
    for (const k of Object.keys(patch)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

// ===========================================================================
section('一、上界旋钮：可配 + 上下限钳制 + 调用时才读')
// ===========================================================================

const mod = await import(PLUGIN_URL + '?env=netbounds-knob')
check(typeof mod.ghNetTimeoutMs === 'function', 'ghNetTimeoutMs 是导出的接缝（门禁直接钉钳制，不靠猜）')

await withEnv({ DSH_GH_NET_TIMEOUT_MS: undefined }, () => {
  check(mod.ghNetTimeoutMs() === 20000, '未设旋钮 → 默认 20s（实得 ' + mod.ghNetTimeoutMs() + '）')
  process.env.DSH_GH_NET_TIMEOUT_MS = '500'   // 同一个模块实例里改环境
  check(mod.ghNetTimeoutMs() === 500, '同一实例里改环境立刻生效 = **调用时才读**（不是 import 期定型）')
  delete process.env.DSH_GH_NET_TIMEOUT_MS
})
await withEnv({ DSH_GH_NET_TIMEOUT_MS: '1' }, () => {
  check(mod.ghNetTimeoutMs() === 100, '设 1ms → 钳到下限 100ms（不许出现「上界比一次往返还短」的假超时）')
})
await withEnv({ DSH_GH_NET_TIMEOUT_MS: String(999999999) }, () => {
  check(mod.ghNetTimeoutMs() === 120000, '设超大 → 钳到上限 120s')
})
for (const bad of ['abc', '0', '-5', '']) {
  await withEnv({ DSH_GH_NET_TIMEOUT_MS: bad }, () => {
    check(mod.ghNetTimeoutMs() === 20000, '坏值 ' + JSON.stringify(bad) + ' → 回默认（不许被当成「无上界」）')
  })
}

// ===========================================================================
section('二、api()：不回话的目标不许把整条路挂住（经 gh_resident_status 实跑）')
// ===========================================================================

const hA = fixture('net-api', { token: TOKEN_FAKE, login: LOGIN })
await withPlugin(hA.home, { path: hA.path, dataDir: hA.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  await withEnv({ DSH_GH_NET_TIMEOUT_MS: BOUND }, async () => {
    const calls = []
    const restore = hangFetch(calls)
    const stopKeepAlive = keepAlive()
    const t0 = Date.now()
    let r = null
    try { r = await tool('gh_resident_status').execute({}, {}) } finally { stopKeepAlive(); restore() }
    const ms = Date.now() - t0
    check(calls.some((c) => c.url.includes('api.github.com/user')), '确实打到 /user（桩记到 ' + JSON.stringify(calls) + '）')
    check(calls.length > 0 && calls.every((c) => c.hasSignal), '每次调用都带上了上界 signal（没 signal = 又回到「永远等下去」）')
    check(ms >= 200 && ms < 5000, '在设定上界内返回（实测 ' + ms + 'ms，上界 ' + BOUND + 'ms）')
    check(Boolean(r && r.identity), '回执里 identity 那格还在（超时也照回形状）')
    check(r && r.identity && r.identity.error === 'timeout', '如实标 timeout（不许写成「HTTP null」）')
    const msg = String((r && r.identity && r.identity.message) || '')
    check(/超时/.test(msg) && /未知/.test(msg), '措辞说得清「超时 / 未知」：' + msg.slice(0, 60))
    check(!JSON.stringify(r).includes(TOKEN_FAKE), '超时回执里同样不出现 token 原文')
  })
})
hA.cleanup()

// ===========================================================================
section('三、releaseMeta()：版本探测也不许挂住（经 gh_cli_version force 实跑）')
// ===========================================================================

const hB = fixture('net-release', { token: TOKEN_FAKE, login: LOGIN })
await withPlugin(hB.home, { path: hB.path, dataDir: hB.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  await withEnv({ DSH_GH_NET_TIMEOUT_MS: BOUND }, async () => {
    const calls = []
    const restore = hangFetch(calls)
    const stopKeepAlive = keepAlive()
    const t0 = Date.now()
    let r = null
    try { r = await tool('gh_cli_version').execute({ force: true }, {}) } finally { stopKeepAlive(); restore() }
    const ms = Date.now() - t0
    check(calls.some((c) => c.url.includes('releases/latest')), '确实打到 release API（桩记到 ' + JSON.stringify(calls.slice(0, 3)) + '）')
    check(calls.length > 0 && calls.every((c) => c.hasSignal), '每次调用都带上了上界 signal')
    check(ms >= 200 && ms < 5000, '在设定上界内返回（实测 ' + ms + 'ms，上界 ' + BOUND + 'ms）')
    const err = String((r && r.error) || (r && r.updates && r.updates.error) || (r && r.latest && r.latest.error) || '')
    check(/超时/.test(err) && /未知/.test(err), '如实报「超时 / 未知」（实得 ' + JSON.stringify(err).slice(0, 90) + '）')
  })
})
hB.cleanup()

// ===========================================================================
section('四、撤销 token：也要有上界，且不许把「未知」说成「没撤成」（经 gh_cli_logout 只撤那一档实跑）')
// ===========================================================================

const hC = fixture('net-revoke', { token: TOKEN_FAKE, login: LOGIN })
await withPlugin(hC.home, { path: hC.path, dataDir: hC.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  await withEnv({ DSH_GH_NET_TIMEOUT_MS: BOUND }, async () => {
    const calls = []
    const restore = hangFetch(calls)
    const stopKeepAlive = keepAlive()
    const t0 = Date.now()
    let r = null
    try {
      // 只走「撤销」：卸 gh / 删状态 / 清凭据 / 清缓存 / 清 gh 配置**全部显式关掉**（门禁不碰宿主级动作）。
      r = await tool('gh_cli_logout').execute({
        confirm: true, revoke: true,
        uninstall_gh: false, remove_gh_cache: false, purge_git: false, reset_state: false, remove_gh_config: false,
      }, {})
    } finally { stopKeepAlive(); restore() }
    const ms = Date.now() - t0
    check(calls.some((c) => c.url.includes('/applications/')), '确实打到撤销那个端点（桩记到 ' + JSON.stringify(calls.slice(0, 3)) + '）')
    check(calls.length > 0 && calls.every((c) => c.hasSignal), '每次调用都带上了上界 signal')
    check(ms >= 200 && ms < 5000, '在设定上界内返回（实测 ' + ms + 'ms，上界 ' + BOUND + 'ms）')
    const step = ((r && r.steps) || []).find((s) => s.step === 'revoke') || null
    check(Boolean(step), '回执里 revoke 那一步在（实得 ' + JSON.stringify(((r && r.steps) || []).map((s) => s.step)) + '）')
    check(Boolean(step) && step.timedOut === true, 'revoke 那步如实标 timedOut（请求可能已经到 GitHub —— 不许说成「没撤成」）')
    const err = String((step && step.error) || '')
    check(/超时/.test(err) && /未知/.test(err), '措辞说得清「超时 / 未知」：' + err.slice(0, 60))
  })
})
hC.cleanup()

// ===========================================================================
section('五、源码级：三处走的是同一支 fetchBounded；下载那条的上界没被顺手改（tripwire）')
// ===========================================================================

{
  const src = readText('plugin.js')
  check(src.includes('await fetchBounded(`https://api.github.com${urlPath}`'), 'api() 走 fetchBounded')
  check(src.includes('await fetchBounded(RELEASE_API'), 'releaseMeta() 走 fetchBounded')
  check(src.includes("await fetchBounded('https://api.github.com/applications/'"), '撤销 token 走 fetchBounded')
  check(!src.includes('await fetch(`https://api.github.com${urlPath}`'), 'api() 里那处裸 fetch 已消失（防回潮）')
  check(!src.includes('await fetch(RELEASE_API'), 'releaseMeta() 里那处裸 fetch 已消失（防回潮）')
  check(src.includes('signal: AbortSignal.timeout(300_000)'),
    '下载那条的 300s 上界**原样没动**（票 55 / #38 只给它加「退避重试一次」，不加别的）')
  check(readText('README.md').includes('DSH_GH_NET_TIMEOUT_MS'), '旋钮在 README 的环境变量表里登记过（协议与代码对得上）')
  note('本件只钉「有上界」这一件事；重试 / 退避 / 分档口径在 net-policy.test.mjs（票 55 / #38）')
}

summary()
