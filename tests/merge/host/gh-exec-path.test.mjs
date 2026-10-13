/**
 * tests/merge/host/gh-exec-path.test.mjs —— #15：gh 的**执行**必须用解析出的路径，不许回落到裸名。
 *
 * 为什么需要它（这是 identity 融合之后剩下的另一半）：`tests/merge/host/gh-resolution.test.mjs` 钉住了
 * 「gh 在哪」只有一个答案（合并宿主注入的解析器说了算），但没有覆盖「拿到了这个答案，起进程时用不用它」——
 * 实测（2026-10-13，本机）执行世界 PATH 里没有 gh 时，deck 半边的 deck_* 工具与面板取数一律失败：
 * 解析成功、解析结果被丢掉、`exec('gh')` 按 PATH 找裸名 → ENOENT → 空输出 + 退出码 -1 → 归 ENV 档，
 * 报「gh 这一次没拿到退出码（命令可能被中断，或者根本没起来）」，工具按 backend-unsupported 收场。
 *
 * 契约（本文件钉住四条）：
 *   ① 解析器给了绝对路径 → exec 收到的就是它（PATH 里有没有 gh 都不影响），全程不出现裸名；
 *   ② 解析器说没有、探针验过裸名能用 → 真命令走同一个裸名（探针验什么就用什么，口径一致）；
 *   ③ 两条路都没有 gh → 如实 env 失败，且**不**起真命令（不许拿真命令去撞第二次）；
 *   ④ `ctx.exec` 不可用 → 如实 env 失败（现状，防回归）。
 *
 * 隔离：不起真进程、不读真实 HOME、不碰网络 —— ctx.exec / ctx.platform 全是夹具。
 * 假执行器刻意复刻现场那台机器的形状：裸名 → `{stdout:'',stderr:'',code:-1}`（spawn ENOENT 的归一结果），
 * 绝对路径 → 正常回执。于是「PATH 无 gh 时这一笔会不会失败」在测试里就是可判定的。
 *
 * 用法：node tests/merge/host/gh-exec-path.test.mjs
 */
import { check, note, section, summary, importRel, readText } from './_check.mjs'

const CLIENT_REL = 'deck/src/host/tracker/backends/github/client.js'
const PLUGIN_GH = '/root/.dsh/gh-cli/bin/gh'

const mod = await importRel(CLIENT_REL)
const ghClient = mod.ghClient || mod.default
check(typeof ghClient === 'function', 'client.js 导出 ghClient（源码真源，不是产物）')

/**
 * 造一个「执行世界」夹具。
 * pathHasGh=false 时模拟现场那台机器：裸名 gh 起不来，绝对路径正常。
 * 起不来的形状有两种（现场都算数）：执行器把 spawn 失败做成返回值（code -1 + 空输出），或直接抛。
 */
function makeWorld(opts = {}) {
  const pathHasGh = opts.pathHasGh === true
  const throwOnBare = opts.throwOnBare === true
  const calls = []
  const exec = async function (cmd, args) {
    const argv = Array.isArray(args) ? args.slice() : []
    calls.push({ cmd, args: argv })
    if (cmd === 'gh' && !pathHasGh) {
      if (throwOnBare) throw new Error('spawn gh ENOENT')
      return { stdout: '', stderr: '', code: -1 }
    }
    if (argv[0] === '--version') return { stdout: 'gh version 2.102.0 (2026-09-30)\n', stderr: '', code: 0 }
    return { stdout: '[]', stderr: '', code: 0 }
  }
  return {
    calls,
    exec,
    realCalls: () => calls.filter((c) => !(c.args && c.args[0] === '--version')),
    probeCalls: () => calls.filter((c) => c.args && c.args[0] === '--version'),
  }
}

/** 造一个只认 gh 的平台层（其余命令回 null），与真实注入形态一致。 */
function makePlatform(ghPath) {
  return {
    resolveExecutable: async (name) => (name === 'gh' ? ghPath : null),
  }
}

section('1) 解析成功（绝对路径）：exec 收到它，PATH 里没有 gh 也照跑 —— #15 正题')
{
  const w = makeWorld() // PATH 无 gh
  const c = ghClient({ cwd: '/tmp/ws', platform: makePlatform(PLUGIN_GH), exec: w.exec })
  const r = await c.execGh(['issue', 'list', '--json', 'number'])

  check(w.calls.length === 1, '只起了一次进程（实起 ' + w.calls.length + '）')
  check(!!w.calls[0] && w.calls[0].cmd === PLUGIN_GH, 'exec 收到解析出的绝对路径（实得 ' + String(w.calls[0] && w.calls[0].cmd) + '）')
  check(w.calls.every((x) => x.cmd !== 'gh'), '全程没有裸名 gh 出站（现场坏就坏在这一格）')
  check(r.ok === true, 'PATH 无 gh 时这一笔照样成功（实得 ok=' + r.ok + (r.ok ? '' : ' / ' + String(r.error && r.error.message)) + '）')
  check(!!r.ok && r.data && r.data.code === 0, '回执形状仍是 OpResult{stdout,stderr,code}')
}

section('1b) 同一现场的另一半形状：执行器对裸名直接抛（ENOENT → reject）也不许踩')
{
  const w = makeWorld({ throwOnBare: true })
  const c = ghClient({ cwd: '/tmp/ws', platform: makePlatform(PLUGIN_GH), exec: w.exec })
  const r = await c.execGh(['issue', 'list'])

  check(w.calls.every((x) => x.cmd !== 'gh'), '没有裸名出站（这一档裸名会直接抛）')
  check(r.ok === true, '照常成功（实得 ok=' + r.ok + (r.ok ? '' : ' / ' + String(r.error && r.error.message)) + '）')
}

section('2) 解析器说没有：探针验过裸名能用 → 真命令走同一个裸名（口径一致）')
{
  const w = makeWorld({ pathHasGh: true })
  const c = ghClient({ cwd: '/tmp/ws', platform: makePlatform(null), exec: w.exec })
  const r = await c.execGh(['issue', 'list'])

  const probes = w.probeCalls()
  const real = w.realCalls()
  check(probes.length === 1 && probes[0].cmd === 'gh', '起过一次裸名 --version 探针（实起 ' + probes.length + '）')
  check(real.length === 1 && real[0].cmd === 'gh', '真命令走探针验过的那条路（实得 ' + String(real[0] && real[0].cmd) + '）')
  check(r.ok === true, '探针通过后这一笔成功（实得 ok=' + r.ok + '）')
  note('探针的活就是「裸名在这个执行世界里能不能跑」，所以它自己必须是裸名；本用例钉的是「它验什么，真命令就用什么」')
}

section('3) 两条路都没有 gh：如实 env 失败，且不拿真命令去撞第二次')
{
  const w = makeWorld() // PATH 无 gh，探针也会回 -1
  const c = ghClient({ cwd: '/tmp/ws', platform: makePlatform(null), exec: w.exec })
  const r = await c.execGh(['issue', 'list'])

  check(r.ok === false && r.error && r.error.kind === 'env', '归 env 档（实得 ' + String(r.ok ? 'ok' : r.error && r.error.kind) + '）')
  check(r.error && r.error.code === -1, '失败形状带 code:-1（实得 ' + String(r.error && r.error.code) + '）')
  check(w.realCalls().length === 0, '没有起过真命令（实起 ' + w.realCalls().length + '）')
}

section('4) 解析器抛错：如实 env 失败，不起进程')
{
  const w = makeWorld()
  const c = ghClient({
    cwd: '/tmp/ws',
    platform: { resolveExecutable: async () => { throw new Error('resident 半边还没起来') } },
    exec: w.exec,
  })
  const r = await c.execGh(['issue', 'list'])

  check(r.ok === false && r.error && r.error.kind === 'env', '归 env 档（实得 ' + String(r.ok ? 'ok' : r.error && r.error.kind) + '）')
  check(w.calls.length === 0, '一次都没起（实起 ' + w.calls.length + '）')
  note('解析器抛错时不许偷偷退回 PATH —— 那是「两半各认一个 gh」的复发点，gh-resolution 测试也钉着它')
}

section('5) ctx.exec 不可用：如实 env 失败（现状，防回归）')
{
  const c = ghClient({ cwd: '/tmp/ws', platform: makePlatform(PLUGIN_GH) })
  const r = await c.execGh(['issue', 'list'])

  check(r.ok === false && r.error && r.error.kind === 'env', '归 env 档（实得 ' + String(r.ok ? 'ok' : r.error && r.error.kind) + '）')
  check(!!r.error && /exec unavailable/.test(String(r.error.message)), '文案点名 ctx.exec（实得 ' + String(r.error && r.error.message) + '）')
}

section('6) 源码口径：执行点用解析结果，且不再出现裸名（防「测试绿了、源码又写回裸名」）')
{
  const src = readText(CLIENT_REL)
  check(src.includes('exec(ghExe, args'), 'execGh 的执行点把解析结果交出去（找 exec(ghExe, args）')
  check(!src.includes("exec('gh', args"), '执行点里没有裸名 gh 的字面量（找 exec(\'gh\', args）')
  note('主判据是第 1 / 1b 节的行为断言；本节只是把「源码这一格写的是什么」也钉住，来源 ' + CLIENT_REL)
}

summary()
