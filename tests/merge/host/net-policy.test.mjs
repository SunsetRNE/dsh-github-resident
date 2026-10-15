/**
 * tests/merge/host/net-policy.test.mjs —— 对 GitHub 的网络动作的**分档口径 + 一种记账形状**
 *（票 55 / #38；「上界」那一层由 net-bounds.test.mjs 钉着，本件接手「重试 / 退避 / 记账」）。
 *
 * 为什么需要它：上界只解决「不许永远等」，不解决「抖一下就判死」与「四个站点各记一本账」。
 * 维护者裁定的口径是一张**分档表**（PROTOCOL.guarantees.networkPolicy）＋ **一种记账形状**
 *（netAttempt：step / channel / attempt / ok / ms / httpCode / timedOut / error）。本件钉四件事：
 *   ① **一种形状**：netAttempt() 归一后的键集合就是唯一形状，四个站点回执里的每条记录都与之逐字相同；
 *   ② **档位**：GET（B 档）退避 300ms 重试一次、**非 GET（B' 档）一次都不重试**（挂死 fetch 桩数调用次数）；
 *      release 元数据（B 档）同样 2 次；下载（C 档）一档两次、1000ms 退避、不叠成 4 次；
 *   ③ **每次尝试都带 signal**，且 timedOut **只在真超时那次**为 true；
 *   ④ **probeGh 不适用**：它是本地子进程探测，源码里不许出现任何重试结构（tripwire）。
 *
 * 隔离：临时换 globalThis.fetch（挂死 / 挂一次再成功两种桩）、本地 stub / 挂死服务器；不连真实外网。
 * 用法：node tests/merge/host/net-policy.test.mjs
 */
import http from 'node:http'
import { check, note, section, summary, readText } from './_check.mjs'
import { makeHome, withPlugin, PLUGIN_URL, startStub, startBlackhole, urlOf, closeAll } from './_env-harness.mjs'

const TOKEN_FAKE = 'gho_NETPOLICY_fixture_abcdefghij'
const LOGIN = 'octocat'
const STATE_REL = '.dsh/github-resident.json'
const BOUND = '250'

const fixture = (tag, state, opts = {}) => makeHome(tag, {
  withGh: opts.withGh !== undefined ? opts.withGh : true,
  withGit: true,
  withCurl: true,
  files: { [STATE_REL]: JSON.stringify(state) },
})

/** 一个**永不回话**的 fetch：只有上界能救它；没 signal 就 5s 后自爆（免得把门禁挂住）。 */
const hangFetch = (calls) => {
  const real = globalThis.fetch
  globalThis.fetch = (url, init = {}) => new Promise((_, reject) => {
    const sig = init.signal
    calls.push({ url: String(url), hasSignal: Boolean(sig) })
    const bail = () => reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
    if (!sig) { setTimeout(() => reject(new Error('这一处没有上界 signal')), 5000); return }
    if (sig.aborted) return bail()
    sig.addEventListener('abort', bail, { once: true })
  })
  return () => { globalThis.fetch = real }
}

/** 第一次挂死（等 signal abort）、第二次回 200：证明「重试有收益」且账本只标超时那次。 */
const flakyOnceFetch = (calls, okBody) => {
  const real = globalThis.fetch
  let n = 0
  globalThis.fetch = (url, init = {}) => {
    n += 1
    calls.push({ url: String(url), hasSignal: Boolean(init.signal) })
    const sig = init.signal
    if (n === 1) {
      return new Promise((_, reject) => {
        const bail = () => reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
        if (!sig) { setTimeout(() => reject(new Error('这一处没有上界 signal')), 5000); return }
        if (sig.aborted) return bail()
        sig.addEventListener('abort', bail, { once: true })
      })
    }
    return Promise.resolve(new Response(JSON.stringify(okBody), { status: 200, headers: { 'content-type': 'application/json' } }))
  }
  return () => { globalThis.fetch = real }
}

/** 判据自己保活：AbortSignal.timeout() 用的是 unref 定时器，裸测试进程里必须拿 ref 定时器撑着。 */
const keepAlive = () => {
  const t = setInterval(() => {}, 250)
  return () => clearInterval(t)
}

const withEnv = async (patch, fn) => {
  const saved = {}
  for (const k of Object.keys(patch)) saved[k] = process.env[k]
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  try { return await fn() } finally {
    for (const k of Object.keys(patch)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const ARCH = ({ x64: 'amd64', arm64: 'arm64', arm: 'armv6', ia32: '386' })[process.arch] || process.arch

// ===========================================================================
section('一、唯一形状：netAttempt() 归一，四个站点共用一支')
// ===========================================================================

const mod = await import(PLUGIN_URL + '?env=netpolicy-shape')
check(typeof mod.netAttempt === 'function' && typeof mod.recordAttempt === 'function', 'netAttempt / recordAttempt 是导出的共享记账器（门禁直接钉，不靠猜）')
check(Array.isArray(mod.NET_ATTEMPT_FIELDS), 'NET_ATTEMPT_FIELDS 是导出的唯一字段表')
const FIELDS = (mod.NET_ATTEMPT_FIELDS || []).join(',')
check(FIELDS === 'step,channel,attempt,ok,ms,httpCode,timedOut,error', '字段表就是维护者裁定的那一串（实得 ' + FIELDS + '）')

if (typeof mod.netAttempt === 'function' && typeof mod.recordAttempt === 'function') {
  const rec = mod.netAttempt({ step: 'api GET /user', channel: 'curl', attempt: 2, ok: true, ms: 7, httpCode: 200, timedOut: false, error: null })
  check(Object.keys(rec).join(',') === FIELDS, '产出的键集合与顺序 = 唯一形状（实得 ' + Object.keys(rec).join(',') + '）')
  check(rec.httpCode === 200 && rec.ok === true && rec.timedOut === false && rec.error === null, '如实透传各字段')
  const blank = mod.netAttempt({})
  check(blank.attempt === 1 && blank.channel === 'fetch' && blank.ok === false && blank.ms === 0 && blank.httpCode === null && blank.timedOut === false && blank.error === null,
    '缺字段补默认：attempt 从 1 起、channel=fetch、timedOut=false、error=null')
  const weird = mod.netAttempt({ ok: true, timedOut: true, attempt: 0, ms: -5, httpCode: '500', error: 404 })
  check(weird.attempt === 1 && weird.ms === 0 && weird.httpCode === 500 && weird.error === '404' && weird.timedOut === true,
    '归一：attempt<1 → 1、负 ms → 0、httpCode 字符串 → 数字、error 非串 → 字符串')
  const arr = []
  mod.recordAttempt(arr, { step: 'x', channel: 'node', attempt: 1, ok: true, ms: 1 })
  check(arr.length === 1 && Object.keys(arr[0]).join(',') === FIELDS && arr[0].channel === 'node', 'recordAttempt 就地追加一条规范记录')
  check(Array.isArray(mod.recordAttempt(null, { step: 'y', channel: 'curl', attempt: 1, ok: false, ms: 2 })), 'recordAttempt 拿到非数组也回一份数组（不留半截账本）')
  note('唯一形状：' + FIELDS)
} else {
  check(false, 'netAttempt / recordAttempt 缺失 —— 四个站点就没有统一账本可谈')
}

// ===========================================================================
section('二、B 档：只读 REST（GET）首发 + 退避 300ms 重试一次')
// ===========================================================================

const hGet = fixture('policy-get', { token: TOKEN_FAKE, login: LOGIN })
await withPlugin(hGet.home, { path: hGet.path, dataDir: hGet.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  await withEnv({ DSH_GH_NET_TIMEOUT_MS: BOUND }, async () => {
    const calls = []
    const restore = hangFetch(calls)
    const stop = keepAlive()
    const t0 = Date.now()
    let r = null
    try { r = await tool('gh_resident_status').execute({}, {}) } finally { stop(); restore() }
    const ms = Date.now() - t0
    const userCalls = calls.filter((c) => c.url.includes('api.github.com/user'))
    check(userCalls.length === 2, 'GET /user 恰好发 2 次（首发 + 重试一次；实得 ' + userCalls.length + '）')
    check(ms >= 700, '两次之间真等了退避（实测 ' + ms + 'ms >= 250+300+250）')
    check(calls.length > 0 && calls.every((c) => c.hasSignal), '每一次尝试都带上界 signal')
    const at = (r && r.identity && r.identity.attempts) || null
    check(Array.isArray(at) && at.length === 2, 'api() 的 attempts 是数组且两次都在（实得 ' + JSON.stringify(at && at.length) + '）')
    check(Boolean(at) && at[0].attempt === 1 && at[1].attempt === 2 && at[0].step === 'api GET /user', 'attempt 序号从 1 起、step 说清站点动作')
    check(Boolean(at) && at.every((a) => Object.keys(a).join(',') === FIELDS), '每一条 attempt 的字段集合完全一致')
    check(Boolean(at) && at[0].timedOut === true && at[0].ok === false && at[1].timedOut === true && at[1].ok === false, '两次都挂死：逐次如实标 timedOut')
    check(Boolean(r && r.identity) && r.identity.error === 'timeout', '顶层仍如实标 timeout（不写成 HTTP null）')
  })
})
hGet.cleanup()

// ===========================================================================
section('三、B 档：第一次超时、第二次成功 —— 账本逐次如实、timedOut 只落在超时那次')
// ===========================================================================

const hMix = fixture('policy-mix', { token: TOKEN_FAKE, login: LOGIN })
await withPlugin(hMix.home, { path: hMix.path, dataDir: hMix.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  await withEnv({ DSH_GH_NET_TIMEOUT_MS: BOUND }, async () => {
    const calls = []
    const restore = flakyOnceFetch(calls, { login: LOGIN, name: 'Mona' })
    const stop = keepAlive()
    let r = null
    try { r = await tool('gh_resident_status').execute({}, {}) } finally { stop(); restore() }
    const at = (r && r.identity && r.identity.attempts) || []
    check(Boolean(r && r.identity) && r.identity.login === LOGIN, '第二次成了：identity 如实给出登录名（重试确有收益）')
    check(at.length === 2, '两次尝试各占一条（实得 ' + at.length + '）')
    check(at.length === 2 && at[0].timedOut === true && at[0].ok === false && at[1].timedOut === false && at[1].ok === true && at[1].httpCode === 200,
      'timedOut **只在超时那次**为 true；成功那次 ok/httpCode 如实')
    check(at.length === 2 && Object.keys(at[0]).join(',') === Object.keys(at[1]).join(','), '两次记录字段集合一致')
  })
})
hMix.cleanup()

// ===========================================================================
section("四、B' 档：写 REST（POST）一次都不重试 —— 不可幂等，绝不重放")
// ===========================================================================

const hPost = fixture('policy-post', { token: TOKEN_FAKE, login: LOGIN })
await withPlugin(hPost.home, { path: hPost.path, dataDir: hPost.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  await withEnv({ DSH_GH_NET_TIMEOUT_MS: BOUND }, async () => {
    const calls = []
    const restore = hangFetch(calls)
    const stop = keepAlive()
    let r = null
    try { r = await tool('gh_pr').execute({ repo: 'o/r', title: 'T', head: 'x', base: 'main' }, {}) } finally { stop(); restore() }
    const postCalls = calls.filter((c) => c.url.includes('/pulls'))
    check(postCalls.length === 1, 'POST /pulls 只发 1 次（写动作不重试；实得 ' + postCalls.length + '）')
    check(calls.length === postCalls.length, '没有别的 REST 调用混进来（base 已给，GET /repos 不该发；总调用 ' + calls.length + '）')
    check(calls.length > 0 && calls.every((c) => c.hasSignal), '这一次尝试也带上界 signal')
    check(Boolean(r) && r.ok === false, 'gh_pr 按失败回（有 token 时不改道回落 gh）')
  })
})
hPost.cleanup()

// ===========================================================================
section('五、A 档：gh_env_probe 每路也记同一形状（detail.attemptLog），老字段一个不少')
// ===========================================================================

const okSrv = await startStub('ok')
const hole = await startBlackhole()
const hEnv = fixture('policy-env', { token: TOKEN_FAKE, login: LOGIN })
await withPlugin(hEnv.home, { path: hEnv.path, dataDir: hEnv.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  const rA = await tool('gh_env_probe').execute({ network_targets: [{ name: 'ok-route', url: urlOf(okSrv, '/ok') }], attempts: 2, timeout_ms: 800 }, {})
  const a = (rA.network || [])[0] || {}
  const logA = (a.detail && a.detail.attemptLog) || []
  check(logA.length === 2, '两次尝试都进了 attemptLog（实得 ' + logA.length + '）')
  check(a.detail && a.detail.attempts === 2 && typeof a.detail.attempts === 'number', 'detail.attempts 仍是数字（历史字段语义不动）')
  check(a.detail && a.detail.attemptCount === logA.length, 'detail.attemptCount = attemptLog.length')
  check(a.detail && a.detail.via === 'fetch' && a.detail.okCount === 2 && a.detail.successRate === 1, '现有 detail 字段（via/okCount/successRate）一个不少')
  check(logA.every((x) => Object.keys(x).join(',') === FIELDS), '每路每次的字段集合与唯一形状完全一致')
  check(logA.every((x) => x.step === 'ok-route' && x.channel === 'fetch' && x.ok === true && x.timedOut === false), 'step/channel/ok/timedOut 如实')
  const rB = await tool('gh_env_probe').execute({ network_targets: [{ name: 'hole', url: urlOf(hole.server, '/') }], attempts: 1, timeout_ms: 500 }, {})
  const b = (rB.network || [])[0] || {}
  const logB = (b.detail && b.detail.attemptLog) || []
  check(b.detail && b.detail.attemptCount === logB.length && logB.length >= 2, 'attemptCount 覆盖两条通道的总次数（实得 ' + logB.length + '）')
  check(Boolean(logB.find((x) => x.channel === 'fetch')), 'fetch 那次在账本里')
  check(Boolean(logB.find((x) => x.channel === 'curl')), 'fetch 全失败后确实跑了 curl 通道（实得 ' + logB.map((x) => x.channel).join(',') + '）')
  check(logB.every((x) => Object.keys(x).join(',') === FIELDS), 'curl 那次与 fetch 那次同一形状')
  const fr = logB.find((x) => x.channel === 'fetch') || {}
  check(fr.timedOut === true && fr.ok === false, '挂死链路上 fetch 那次如实标 timedOut（不是「没有」）')
  check(!logB.some((x) => x.timedOut === true && x.ok === true), 'timedOut 不会落在成功的那次上')
})
closeAll([okSrv])
closeAll([hole.server])
hole.cleanup()
hEnv.cleanup()

// ===========================================================================
section('六、C 档：downloadTo 一档两次（curl 优先 / fetch 兜底），不叠成 4 次')
// ===========================================================================

{
  const hits = []
  const dlSrv = http.createServer((req, res) => { hits.push(Date.now()); res.writeHead(500); res.end('nope') })
  await new Promise((r) => dlSrv.listen(0, '127.0.0.1', r))
  const assetName = 'gh_9.9.9_linux_' + ARCH + '.tar.gz'
  const relSrv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ tag_name: 'v9.9.9', assets: [{ name: assetName, browser_download_url: 'http://127.0.0.1:' + dlSrv.address().port + '/dl/' + assetName }] }))
  })
  await new Promise((r) => relSrv.listen(0, '127.0.0.1', r))
  const h = fixture('policy-dl', { token: TOKEN_FAKE, login: LOGIN }, { withGh: false })
  await withPlugin(h.home, {
    path: h.path,
    dataDir: h.home + '/.dsh/gh-cli',
    env: {
      DSH_GH_RELEASE_API: 'http://127.0.0.1:' + relSrv.address().port + '/release',
      DSH_GH_FORCE_FETCH: '1',
      DSH_GH_NO_STATE_CHECK: '1', DSH_GH_NO_UPDATE: '1', DSH_GH_NO_BOOTSTRAP: '1',
    },
  }, async ({ tool }) => {
    const r = await tool('gh_cli_install').execute({ force: true, prefer: 'tarball' }, {})
    const ledger = Array.isArray(r.attempts) ? r.attempts : []
    const tb = ledger.find((x) => x.step === 'tarball') || null
    check(Boolean(tb), '落地账本里有 tarball 那一步（实得 ' + JSON.stringify(ledger.map((x) => x.step)) + '）')
    const dlat = (tb && tb.attempts) || []
    check(Array.isArray(dlat) && dlat.length === 2, '一次 downloadTo 恰好记 2 条（首发 + 重试一次；实得 ' + dlat.length + '）')
    check(dlat.every((x) => Object.keys(x).join(',') === FIELDS), '下载的每次尝试也是同一形状')
    check(dlat.length === 2 && dlat[0].attempt === 1 && dlat[1].attempt === 2 && dlat[0].ok === false && dlat[1].ok === false, '两次都失败且序号从 1 起')
    check(dlat.length === 2 && dlat[0].httpCode === 500 && dlat[1].httpCode === 500, 'httpCode 如实记 500')
    check(hits.length >= 2 && hits.length % 2 === 0, '每次 downloadTo 只打 2 发，没有叠成 4 发（服务器共收到 ' + hits.length + ' 发）')
    check(hits.length >= 2 && (hits[1] - hits[0]) >= 900, '第二发与第一发之间真等了 1000ms 退避（实得 ' + (hits[1] - hits[0]) + 'ms）')
  })
  await closeAll([dlSrv])
  await closeAll([relSrv])
  h.cleanup()
}

// ===========================================================================
section('七、B 档：release 元数据同样 2 次，账本随错带进回执')
// ===========================================================================

const hRel = fixture('policy-release', { token: TOKEN_FAKE, login: LOGIN })
await withPlugin(hRel.home, { path: hRel.path, dataDir: hRel.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  await withEnv({ DSH_GH_NET_TIMEOUT_MS: BOUND }, async () => {
    const calls = []
    const restore = hangFetch(calls)
    const stop = keepAlive()
    let r = null
    try { r = await tool('gh_cli_version').execute({ force: true }, {}) } finally { stop(); restore() }
    const relCalls = calls.filter((c) => c.url.includes('releases/latest'))
    check(relCalls.length === 2, 'release API 恰好 2 次（首发 + 退避重试一次；实得 ' + relCalls.length + '）')
    check(relCalls.length > 0 && relCalls.every((c) => c.hasSignal), '每次尝试都带上界 signal')
    const at = (r && r.attempts) || null
    check(Array.isArray(at) && at.length === 2 && at.every((x) => Object.keys(x).join(',') === FIELDS), '回执 attempts 是数组、两次同一形状')
    check(Boolean(at) && at.every((x) => x.step === 'release-api' && x.timedOut === true && x.ok === false), 'release 两次都超时：逐次如实标 timedOut')
    check(/超时/.test(String(r && r.error)) && /未知/.test(String(r && r.error)), '顶层措辞仍是「超时 / 未知」')
  })
})
hRel.cleanup()

// ===========================================================================
section('八、协议：分档表写在 PROTOCOL.guarantees.networkPolicy（不新增段、不动版本）')
// ===========================================================================

const hProto = fixture('policy-proto', { token: TOKEN_FAKE, login: LOGIN })
await withPlugin(hProto.home, { path: hProto.path, dataDir: hProto.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  const p = await tool('gh_protocol').execute({}, {})
  const np = p && p.guarantees && p.guarantees.networkPolicy
  check(Boolean(np && Array.isArray(np.tiers)), 'guarantees.networkPolicy 带分档表')
  const tiers = (np && np.tiers) || []
  const who = tiers.map((t) => t.who).join(' | ')
  check(/gh_env_probe/.test(who) && /api\(\)/.test(who) && /release/.test(who) && /downloadTo/.test(who) && /probeGh/.test(who), '五档都在表里（A / B / B prime / C / 不适用）')
  const b = tiers.find((t) => /只读 REST/.test(String(t.tier))) || {}
  check(String(b.tries).includes('2') && String(b.backoff).includes('300'), 'B 档写清 2 次 / 300ms')
  const w = tiers.find((t) => /写 REST/.test(String(t.tier))) || {}
  check(String(w.tries).includes('1') && /不重试/.test(String(w.tries)), "B' 档写清 1 次、不重试")
  const c = tiers.find((t) => /downloadTo/.test(String(t.who))) || {}
  check(String(c.tries).includes('2') && String(c.backoff).includes('1000'), 'C 档写清 2 次 / 1000ms')
  const na = tiers.find((t) => /probeGh/.test(String(t.who))) || {}
  check(/本地子进程探测/.test(String(na.giveUp)) && /重试一个卡死的本地进程/.test(String(na.giveUp)), 'probeGh 明确「不适用」并写下理由（本地子进程探测，重试没有意义）')
  check(/timedOut/.test(String(np && np.oneShape)) && /结果未知/.test(String(np && np.oneShape)), 'oneShape 写清 timedOut = 超时且结果未知，不许说成没有')
  check(/attemptLog/.test(String(np && np.counts)) && /attemptCount/.test(String(np && np.counts)), 'counts 写清 gh_env_probe 的 attempts（数字）/ attemptLog（数组）/ attemptCount 各是哪个')
})
hProto.cleanup()

// ===========================================================================
section('九、源码级 tripwire：档位与退避只在这几处、probeGh 一个重试都不加')
// ===========================================================================

{
  const src = readText('plugin.js')
  check(src.includes('NET_REST_RETRY_BACKOFF_MS = 300') && src.includes('NET_DOWNLOAD_RETRY_BACKOFF_MS = 1000'), '两档退避是导出常量（判据与代码对得上）')
  check(src.includes("const order = haveCurl ? ['curl', 'fetch'] : ['fetch', 'fetch']"), '下载一档两次、换通道，不叠成 4 次')
  check(src.includes('const maxAttempts = isRead ? 2 : 1'), 'api() 的档位写死在代码里（GET 2 / 非 GET 1）')
  check(src.includes('.attempts = attempts'), 'releaseMeta 的逐次记录随错抛出去（回执据此可见）')
  const i = src.indexOf('async function probeGh(')
  const j = src.indexOf('\n  }', i)
  const body = src.slice(i, j > i ? j : i + 4000)
  check(i > 0 && body.length > 200, 'probeGh 函数体定位到了（tripwire 有靶子）')
  check(!/for\s*\(|while\s*\(|sleep\s*\(|RELEASE_API_ATTEMPTS|NET_REST_RETRY|NET_DOWNLOAD_RETRY/.test(body),
    'probeGh 里没有任何重试结构（分档表「不适用」的 tripwire，防以后有人顺手给它加重试）')
  check((body.match(/--version/g) || []).length === 1, 'probeGh 只跑一次 --version')
}

summary()
