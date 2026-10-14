/**
 * tests/merge/host/env-probe.test.mjs —— `gh_env_probe` 环境能力矩阵：如实降级 + 每项带下一步 + 自身有界。
 *
 * 为什么需要它（2026-10-14，票「新工具 gh_env_probe（环境能力矩阵）」）：
 * 「换环境不靠 AI」的下游验收，就是这条读起来像人话的清单。它必须**如实**：断网 / 无 gh / HOME 不可写
 * 这三种环境里不许静默、不许假装通过；每一项都要给出「缺 → 怎么办」；而且探针自己不能挂住。
 *
 * 网络部分的设计前提（维护者给的域知识 + 本机实测）：到 GitHub 的可达性**本身就随机**（国内链路 / VPN 抖动），
 * 「测一次不通」不代表不能用。所以判据钉的是三件事，而不是一个二元结果：
 *   ① **冗余**：每路多次尝试，回执报成功次数 / 成功率 / 尝试次数，「时通时不通」是 degraded 不是 missing；
 *   ② **重定向**：跟随（真链路会 302 到 CDN），并把最终落点报出来 —— 判据里用 302 → 200 的 stub 验；
 *   ③ **双通道**：Node fetch 不读 HTTP(S)_PROXY、系统 curl 读 —— 「fetch 不通、curl 通」必须是 degraded
 *      并给出「设 HTTPS_PROXY」这一步，而不是把能干活的机器判死。
 *
 * 隔离：自造假 HOME / 假 PATH / 假数据目录 / 本地 stub（200、抖动、只认 curl、302）与挂死服务器；不起真实外网请求。
 * 用法：node tests/merge/host/env-probe.test.mjs
 */
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { check, note, section, skip, summary, readText, tmpDir } from './_check.mjs'
// 合成环境：全仓唯一夹具（票「合成环境矩阵门禁」）。本文件原来的 fakeHome / withScenario / 四个 stub
// 都是自己写的，那份已删除并改用它 —— 判据一条不减；顺带把 PATH 收成夹具的 bin，门禁不再看这台机器有什么。
import { makeHome, withPlugin, startStub, startBlackhole, urlOf, closeAll, listingOf, isRoot } from './_env-harness.mjs'
const STATES = ['ok', 'degraded', 'missing']
const PROXY_FIXTURE = 'http://user:SUPERSECRET_PROXY_PW@127.0.0.1:9'

/** 夹具薄封装：保持本文件原有的调用形状（`withScenario(home, opts, (tool) => …)`）。 */
const fakeHome = (tag, opts = {}) => makeHome(tag, { withGh: Boolean(opts.withGh), ghExits: opts.ghExits || 0, withCurl: opts.withCurl !== false, files: opts.files || {} })
const withScenario = (h, opts, fn) => withPlugin(typeof h === 'string' ? h : h.home, opts, ({ tool }) => fn(tool('gh_env_probe')))
const itemOf = (r, name) => (r.capabilities || []).find((c) => c.name === name)
const targetsOf = (server, names) => names.map((n) => ({ name: n, url: urlOf(server, '/' + n) }))

// ================================================================ 环境 A：健康
section('环境 A：gh 能跑 + curl 在 + HOME/数据目录都在 + 三路都通')
const okSrv = await startStub('ok')
const hA = fakeHome('a', { withGh: true })
const homeA = hA.home
const dataA = join(homeA, '.dsh', 'gh-cli')
mkdirSync(dataA, { recursive: true })
const rA = await withScenario(homeA, {
  path: hA.path,
  dataDir: dataA,
  env: { HTTP_PROXY: PROXY_FIXTURE },
}, (tool) => tool.execute({ network_targets: targetsOf(okSrv, ['one', 'two', 'three']) }, {}))

check(itemOf(rA, 'gh').state === 'ok', 'A gh = ok（假 gh 真跑得起来）')
check(/gh version/.test(String(itemOf(rA, 'gh').detail.version)) && itemOf(rA, 'gh').detail.runnable === true, 'A gh 如实报「能跑」与版本（实得 ' + itemOf(rA, 'gh').detail.version + '）')
check(itemOf(rA, 'curl').state === 'ok', 'A curl = ok')
check(itemOf(rA, 'node').state === 'ok' && (itemOf(rA, 'node').detail.version || '').indexOf('v') === 0, 'A node = ok 且带版本')
check(itemOf(rA, 'arch').state === 'ok' && typeof itemOf(rA, 'arch').detail.arch === 'string', 'A arch = ok 且带 arch/platform')
check(itemOf(rA, 'home-writable').state === 'ok' && itemOf(rA, 'home-writable').detail.writable === true, 'A HOME 可写 = ok')
check(rA.network.length === 3 && rA.network.every((n) => n.state === 'ok'), 'A 三路都通（stub 200）')
check(rA.network.every((n) => n.detail.okCount === 3 && n.detail.attempts === 3 && n.detail.successRate === 1), 'A 如实报 3/3 与成功率 1')
check(rA.network.every((n) => typeof n.detail.firstOkMs === 'number' && typeof n.detail.ms === 'number'), 'A 同时报「首次成功延迟」与「这一路总耗时」')
check(rA.network.every((n) => !('curl' in n.detail)), 'A fetch 全通时不去跑第二个通道（省时间，也没有多余字段）')
check(rA.dirs.every((d) => d.exists && d.writable), 'A 入口目录都存在且可写')
check(rA.summary.missing === 0 && rA.summary.degraded === 0, 'A 没有 missing/degraded')
check(rA.summary.next.length === 0, 'A 全通时不给任何下一步（不塞废话）')
check(rA.bounds.attempts === 3 && rA.bounds.networkMs === 4000 && rA.bounds.networkTotalMs === 15000, 'A bounds 如实报默认上界（单次 4s / 总 15s / 每路 3 次）')

// ================================================================ 环境 B：降级
section('环境 B：gh 跑不起来 + HOME 与数据目录不存在 + 三路都不通')
const hB = fakeHome('b', { withGh: true, ghExits: 1 })
const homeB = hB.home
const goneB = join(tmpDir('envprobe-b-gone'), 'never-created')
const deadTargets = ['one', 'two', 'three'].map((n) => ({ name: 'dead-' + n, url: 'http://127.0.0.1:1/' + n }))
const t0B = Date.now()
const rB = await withScenario(goneB, {
  path: hB.path,
  dataDir: goneB,
  tag: 'b',
}, (tool) => tool.execute({ network_targets: deadTargets, timeout_ms: 800 }, {}))
const elapsedB = Date.now() - t0B

check(itemOf(rB, 'gh').state === 'missing', 'B gh = missing（跑不起来且没有自带副本）')
check(!!itemOf(rB, 'gh').next && itemOf(rB, 'gh').next.indexOf('gh_cli_install') >= 0, 'B gh 缺 → 指向 gh_cli_install')
check(itemOf(rB, 'home-writable').state === 'degraded' && itemOf(rB, 'home-writable').detail.writable === false, 'B HOME 不可写 = degraded（不假装 ok）')
check(!!itemOf(rB, 'home-writable').next, 'B HOME 不可写 → 给下一步')
check(rB.network.every((n) => n.state === 'missing'), 'B 三路都不通 = 全 missing（fetch 与 curl 都不行）')
check(rB.network.every((n) => n.detail.via === null && n.detail.okCount === 0), 'B 如实报「哪个通道都没通」')
check(rB.network.every((n) => 'curl' in n.detail && n.detail.curl.ok === false), 'B fetch 不通时确实试了 curl 通道（并如实报它也不通）')
check(rB.network.every((n) => !!n.next && n.next.indexOf('不通') > 0), 'B 每一项不通都给「换网络/配代理」这类下一步')
check(rB.dirs.some((d) => d.name === 'home' && d.exists === false && !!d.next), 'B 不存在的 HOME 被明说（带下一步）')
check(rB.dirs.some((d) => d.name === 'data-dir' && d.exists === false), 'B 数据目录指向不存在的路径也明说')
check(elapsedB < 20000, 'B 整体有界（实测 ' + elapsedB + 'ms）')

// ================================================================ 环境 C：抖动
section('环境 C：目标前两条连接被掐断 —— 必须报「时通时不通」，不能二元判死')
const flakySrv = await startStub('flaky', { failFirst: 2 })
const rC = await withScenario(homeA, {
  path: hA.path,
  dataDir: dataA,
  tag: 'c',
}, (tool) => tool.execute({ network_targets: [{ name: 'flaky', url: urlOf(flakySrv, '/flaky') }], attempts: 3, timeout_ms: 1500 }, {}))
const cItem = rC.network[0]
check(cItem.state === 'degraded', 'C 3 次里只成 1 次 = degraded（实得 ' + cItem.state + '）')
check(cItem.detail.attempts === 3 && cItem.detail.okCount === 1, 'C 如实报 1/3（实得 ' + cItem.detail.okCount + '/' + cItem.detail.attempts + '）')
check(cItem.detail.successRate < 1 && cItem.detail.successRate > 0, 'C 成功率为分数（实得 ' + cItem.detail.successRate + '）')
check(/时通时不通/.test(cItem.next), 'C 下一步直说「时通时不通」')
check(/HTTPS_PROXY/.test(cItem.next), 'C 建议里点名 HTTPS_PROXY（VPN/代理场景的稳定通道）')

// ================================================================ 环境 D：fetch 被挡、curl 通
section('环境 D：UA=node 的 fetch 连接被掐断（fetch 通道不通）—— curl 通时必须 degraded 而不是 missing')
const curlOnlySrv = await startStub('curlOnly')
const rD = await withScenario(homeA, {
  path: hA.path,
  dataDir: dataA,
  tag: 'd',
}, (tool) => tool.execute({ network_targets: [{ name: 'curl-only', url: urlOf(curlOnlySrv, '/co') }], attempts: 2, timeout_ms: 1500 }, {}))
const dItem = rD.network[0]
check(dItem.state === 'degraded', 'D fetch 全败但 curl 通 = degraded（实得 ' + dItem.state + '）')
check(dItem.detail.via === 'curl', 'D via 如实报 curl（实得 ' + dItem.detail.via + '）')
check(dItem.detail.curl && dItem.detail.curl.ok === true, 'D curl 通道如实报 ok')
check(dItem.detail.okCount === 0, 'D fetch 通道如实报 0 次成功')
check(/HTTPS_PROXY/.test(dItem.next) && /curl/.test(dItem.next), 'D 下一步说明「fetch 不读代理、curl 读」')

// ================================================================ 环境 E：302
section('环境 E：目标回 302 —— 跟随重定向（真链路会 302 到 CDN），并报出最终落点')
const redirSrv = await startStub('redirect', { to: urlOf(okSrv, '/landed') })
const rE = await withScenario(homeA, {
  path: hA.path,
  dataDir: dataA,
  tag: 'e',
}, (tool) => tool.execute({ network_targets: [{ name: 'redirecting', url: urlOf(redirSrv, '/r') }], attempts: 1, timeout_ms: 3000 }, {}))
check(rE.network[0].state === 'ok', 'E 302 目标 = ok（跟随成功）')
check(rE.network[0].detail.redirects === true, 'E 如实标记发生过重定向')
check(rE.network[0].detail.finalUrl === urlOf(okSrv, '/landed'), 'E 最终落点如实报')

// ================================================================ 环境 F：挂死目标
section('环境 F：目标接受连接但永不回包 —— 必须按单次上界超时')
const hole = await startBlackhole()
const t0F = Date.now()
const rF = await withScenario(homeA, {
  path: hA.path,
  dataDir: dataA,
  tag: 'f',
}, (tool) => tool.execute({ network_targets: [{ name: 'blackhole', url: urlOf(hole.server, '/') }], attempts: 1, timeout_ms: 600 }, {}))
const elapsedF = Date.now() - t0F
const fItem = rF.network[0]
check(fItem.state === 'missing', 'F 挂死目标 = missing（不是 ok）')
check(/timeout/.test(String(fItem.detail.error)), 'F 如实标成 timeout（实得 ' + fItem.detail.error + '）')
check(fItem.detail.attempts === 1 && fItem.detail.boundMs === 600, 'F 回执写明尝试次数与单次上界（1 次 / 600ms）')
check(fItem.detail.ms >= 550 && fItem.detail.ms <= 3000, 'F 全失败时也有总耗时（= fetch 单次 600ms + curl 通道 ≤1200ms，实测 ' + fItem.detail.ms + 'ms）')
check(fItem.detail.curl && fItem.detail.curl.ms >= 1000 && fItem.detail.curl.ms <= 2300, 'F curl 通道也守自己的上界（=`单次上界×2`=1200ms，实测 ' + (fItem.detail.curl && fItem.detail.curl.ms) + 'ms）')
check(fItem.detail.firstOkMs === null, 'F 全失败 → firstOkMs 如实为 null（不编造延迟）')
check(elapsedF < 6000, 'F 整体也停在上界内（实测 ' + elapsedF + 'ms）')
check(!!fItem.next, 'F 超时项同样给下一步')
for (const s of hole.socks) { try { s.destroy() } catch { /* 收尾 */ } }

// ================================================================ 环境 G：总预算
section('环境 G：三个都挂死 —— 网络总预算封顶，最坏情况也能返回')
const t0G = Date.now()
const rG = await withScenario(homeA, {
  path: hA.path,
  dataDir: dataA,
  tag: 'g',
}, (tool) => tool.execute({ network_targets: ['a', 'b', 'c'].map((n) => ({ name: 'hole-' + n, url: urlOf(hole.server, '/' + n) })), attempts: 3, timeout_ms: 3000 }, {}))
const elapsedG = Date.now() - t0G
check(rG.network.every((n) => n.state === 'missing'), 'G 三个都如实报 missing')
check(rG.network.some((n) => /budget-exhausted/.test(String(n.detail.error || (n.detail.curl && n.detail.curl.error)))), 'G 预算用完后如实标 budget-exhausted（不假装试过）')
check(elapsedG < 20000, 'G 整体被总预算封顶（实测 ' + elapsedG + 'ms < 20000ms）')
check(rG.bounds.networkTotalMs === 15000, 'G 回执写明网络总预算 = 15000ms')

// ================================================================ 环境 H：HOME 只读 / 不存在
section('环境 H：HOME 不可写 —— 如实报 degraded 并给下一步（root 下无法真实模拟时如实标注）')
const hH = fakeHome('h', { withGh: true })
chmodSync(hH.home, 0o500)
const rH = await withScenario(hH, { path: hH.path, dataDir: join(hH.home, '.dsh', 'gh-cli'), tag: 'h' },
  (tool) => tool.execute({ network_targets: targetsOf(okSrv, ['one']) }, {}))
if (isRoot()) {
  skip('以 root 跑：chmod 500 拦不住写权限 —— 「只读 HOME」这条只能验「判定如实、不谎报」这一半')
  check(itemOf(rH, 'home-writable').state === 'ok' && itemOf(rH, 'home-writable').detail.writable === true,
    'H root 下如实报「可写」（不为迎合变体而谎报不可写）')
} else {
  check(itemOf(rH, 'home-writable').state === 'degraded' && itemOf(rH, 'home-writable').detail.writable === false,
    'H 只读 HOME = degraded（实得 ' + itemOf(rH, 'home-writable').state + '）')
  check(!!itemOf(rH, 'home-writable').next, 'H 只读 → 给下一步')
}
// 只读 HOME 是**故意**造的，用完立刻恢复：非 root 下删不动的目录会毒到运行器收尾
// （2026-10-15 v1.9.0 发版实测：判据全绿、运行器收尾 EACCES、Release 没发出去）。
chmodSync(hH.home, 0o700)

// 两种跑法都能验的等价物：HOME 指向不存在的路径
const goneH = join(tmpDir('envprobe-h-gone'), 'never-created')     // 真不存在的 HOME
const rH2 = await withScenario(goneH, { path: join(goneH, '.bin'), dataDir: join(goneH, '.dsh'), tag: 'h2' },
  (tool) => tool.execute({ network_targets: targetsOf(okSrv, ['one']) }, {}))
check(itemOf(rH2, 'home-writable').state === 'degraded' && itemOf(rH2, 'home-writable').detail.writable === false,
  'H 等价物（HOME 不存在）= degraded，root 与非 root 都验得到')
check(/不可写|不存在/.test(String(itemOf(rH2, 'home-writable').next)), 'H 等价物的下一步说清「不可写/不存在」')

// ================================================================ 环境 I：无 curl
section('环境 I：机器上没有 curl —— 必须如实报 missing 并给下一步（不许假装能跑）')
const hI = fakeHome('i', { withGh: true, withCurl: false })
const rI = await withScenario(hI, { path: hI.path, dataDir: join(hI.home, '.dsh', 'gh-cli'), tag: 'i' },
  (tool) => tool.execute({ network_targets: targetsOf(okSrv, ['one']) }, {}))
check(itemOf(rI, 'curl').state === 'missing', 'I 无 curl = missing（实得 ' + itemOf(rI, 'curl').state + '）')
check(itemOf(rI, 'curl').detail.path === null, 'I path 如实为 null（不编造一个路径）')
check(/装 curl|fetch 兜底/.test(String(itemOf(rI, 'curl').next)), 'I 下一步说清「装 curl」或「走 fetch 兜底」')
check(rI.summary.missing >= 1, 'I missing 计入 summary（不是只在明细里提一嘴）')

// ================================================================ 环境 J：坏代理
section('环境 J：代理变量指向死端口 —— 两条通道都必须如实失败（不许因为「配了代理」就假装通）')
const hJ = fakeHome('j', { withGh: true, withCurl: true })
// 目标必须**不可绕过代理**：实测 curl 对 loopback 目标会绕过 HTTP_PROXY（本机 127.0.0.1 照通），
// 所以这里用 RFC 2606 保证解析不到的 `.invalid` 主机名 —— 有代理时走代理，没代理时解析失败，两边都断。
const PROXY_ONLY_TARGET = 'http://proxy-required.invalid/'
const rJ = await withScenario(hJ, {
  path: hJ.path, dataDir: join(hJ.home, '.dsh', 'gh-cli'), tag: 'j',
  env: { HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1' },
}, (tool) => tool.execute({ network_targets: [{ name: 'proxy-required', url: PROXY_ONLY_TARGET }], attempts: 2, timeout_ms: 1200 }, {}))
const jItem = rJ.network[0]
check(jItem.state === 'missing', 'J 坏代理 = missing（实得 ' + jItem.state + '）')
check(jItem.detail.via === null && jItem.detail.okCount === 0, 'J 如实报「两条通道都没成」')
check(jItem.detail.curl && jItem.detail.curl.ok === false, 'J curl 通道如实报失败（没被「配了代理」糊弄过去）')
check(jItem.detail.curl.viaProxyEnv === true, 'J 如实记下「这次确实有代理环境变量」')
check(!!jItem.next && /不通|代理/.test(jItem.next), 'J 下一步提到「不通 / 代理」')

// ================================================================ 不泄漏 + 只读
section('不泄漏与只读（环境 A 的夹具，代理变量带凭据）')
const dump = JSON.stringify(rA) + JSON.stringify(rB) + JSON.stringify(rC) + JSON.stringify(rD) + JSON.stringify(rG)
check(dump.indexOf('SUPERSECRET_PROXY_PW') < 0, '回执里搜不到代理凭据')
check(dump.indexOf(PROXY_FIXTURE) < 0, '回执里搜不到代理 URL 原文')
check(rA.proxy.HTTP_PROXY === true, '代理变量只报「有」')
check(rA.proxy.HTTPS_PROXY === false, '没设的代理变量报 false（不编造）')
check(!!rD.network[0].detail.curl && rD.network[0].detail.curl.viaProxyEnv === false, 'curl 通道如实报「这次没有代理环境变量」（缺字段也算失败，不让用例崩）')

const before = listingOf(homeA)
await withScenario(homeA, { path: hA.path, dataDir: dataA, tag: 'ro' }, (tool) => tool.execute({ network_targets: targetsOf(okSrv, ['one']) }, {}))
const after = listingOf(homeA)
check(before.names === after.names, '跑一圈后 HOME 里不多出文件（不落探针文件）')
check(before.mtimes === after.mtimes, '跑一圈后 HOME 内容未变（mtime 逐项一致）')

// ================================================================ 形状 / 摘要 / 分工
section('形状、摘要与分工')
for (const [label, r] of [['A', rA], ['B', rB], ['C', rC], ['D', rD], ['F', rF], ['G', rG]]) {
  const caps = r.capabilities || []
  const shapeOk = caps.every((c) => typeof c.name === 'string' && STATES.includes(c.state) && typeof c.detail === 'object' && (c.next === null || typeof c.next === 'string'))
    && (r.network || []).every((n) => typeof n.name === 'string' && typeof n.url === 'string' && STATES.includes(n.state) && typeof n.detail === 'object' && typeof n.detail.attempts === 'number' && (n.next === null || typeof n.next === 'string'))
  check(shapeOk, label + ' 形状统一（capabilities/network 都有 name/state/detail/next，网络项带 attempts）')
  const nonOk = caps.concat(r.network).filter((i) => i.state !== 'ok')
  check(nonOk.every((i) => typeof i.next === 'string' && i.next.length > 0), label + ' 每个非 ok 项都带下一步')
  check(caps.concat(r.network).filter((i) => i.state === 'ok').every((i) => i.next === null), label + ' ok 项不带多余的下一步')
  const expectedOk = caps.concat(r.network).filter((i) => i.state === 'ok').length
  check(r.summary.ok === expectedOk, label + ' summary.ok 与各项一致')
  const dirNext = r.dirs.map((d) => d.next).filter(Boolean)
  const allNext = [...new Set(caps.concat(r.network).map((i) => i.next).concat(dirNext).filter(Boolean))]
  check(JSON.stringify(r.summary.next) === JSON.stringify(allNext), label + ' summary.next = 全部下一步去重')
  check(r.bounds && r.bounds.networkMs > 0 && r.bounds.networkTotalMs === 15000 && typeof r.bounds.elapsedMs === 'number', label + ' bounds 写明上界/总预算/实际耗时')
  check(r.bounds.targets === r.network.length, label + ' bounds.targets 与实际探测项数一致')
}
check(rA.notes.some((n) => n.indexOf('gh_identity.config') > 0), 'A notes 声明「配置类路径在 gh_identity.config」——同一事实不两处报')
check(rA.notes.some((n) => n.indexOf('随机') > 0), 'A notes 声明可达性按随机对待（多次尝试、不做二元判断）')
check(rA.notes.some((n) => n.indexOf('curl') > 0 && n.indexOf('代理') > 0), 'A notes 声明双通道与代理差异')

// ================================================================ 源码级
section('源码级：上界、重定向、双通道、不写文件')
const src = readText('plugin.js')
const start = src.indexOf("toolName: 'gh_env_probe'")
const end = src.indexOf("toolName: 'gh_protocol'")
const block = (start >= 0 && end > start) ? src.slice(start, end) : ''
check(block.length > 0, 'gh_env_probe 的注册段定位到了')
check(block.indexOf('AbortSignal.timeout') > 0, '网络探测用 AbortSignal.timeout 上界')
check(block.indexOf("redirect: 'follow'") > 0, '跟随重定向（真链路会 302 到 CDN）')
check(block.indexOf("'curl'") > 0 && block.indexOf('viaProxyEnv') > 0, '实现里有 curl 通道与「是否走了代理环境变量」的记录')
check(block.indexOf('budget-exhausted') > 0 && block.indexOf('netBudgetMs') > 0, '总预算写在代码里（不是口头承诺）')
check(/Math\.min\(5, Math\.max\(1/.test(block), '尝试次数有上下限（1..5）')
check(block.indexOf('canWriteDir(') > 0, '可写性走 canWriteDir（工具段不自己试写）')
const helperSrc = src.slice(src.indexOf('async function canWriteDir'), src.indexOf('async function canWriteDir') + 260)
check(helperSrc.indexOf('fs.access') > 0 && helperSrc.indexOf('writeFile') < 0, 'canWriteDir 用 fs.access 判、不写探针文件')
check(block.indexOf('writeFile') < 0 && block.indexOf('mkdir') < 0, '探针段不写任何文件/目录')
check(block.indexOf('api(') < 0, '探针段不调插件自己的 api(（它是「能不能用」的判断，不先用一遍）')
check(/timeoutMs: PROC_TIMEOUT_MS/.test(block), '子进程探测也注入上界')
const probeSig = src.slice(src.indexOf('async function probeGh'), src.indexOf('async function probeGh') + 200)
check(probeSig.indexOf('timeoutMs') > 0, 'probeGh 支持注入上界（0 = 维持原行为）')
const row = src.indexOf("{ name: 'gh_env_probe'")
check(row > 0, '协议表里有 gh_env_probe 一行')
const rowLine = src.slice(row, src.indexOf('\n', row))
check(rowLine.indexOf("kind: 'read'") > 0 && rowLine.indexOf("'attempts'") > 0 && rowLine.indexOf("'timeout_ms'") > 0, '协议行声明为只读、可选参数含 attempts / timeout_ms')

note('探针用本地 stub（200 / 抖动 / 只认 curl / 302）与挂死服务器做判据：不起真实外网请求，CI 上同样成立。')
note('「HOME 不可写」用**不存在**的路径表示：以 root 跑门禁时 chmod 拦不住写权限，用存在性才判得准。')
note('C/D 两个场景对应维护者给的前提：国内 / VPN 下可达性随机、「fetch 不读代理而 curl 读」—— 这两种状态必须能与「真不通」区分开。')

await closeAll([okSrv, flakySrv, curlOnlySrv, redirSrv, hole])
if (hole.cleanup) hole.cleanup()
for (const h of [hA, hB, hH, hI, hJ]) h.cleanup()

summary()
