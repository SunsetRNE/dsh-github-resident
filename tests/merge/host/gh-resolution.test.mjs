/**
 * tests/merge/host/gh-resolution.test.mjs —— gh 解析点归一：一个插件只有一个"gh 在哪"的答案。
 *
 * 为什么需要它（这是合并后暴露出来的真缺口）：合并前两个插件各有一套 gh 解析 ——
 *   - Resident：系统 gh → 插件自带缓存 `~/.dsh/gh-cli/bin/gh` → 自动落地（能跑，登录也就落在 `~/.config/gh`）；
 *   - Deck：只看宿主 PATH 与 `DSH_GH_PATH`。
 * 本机实测（2026-10-12）：PATH 里没有 gh、`DSH_GH_PATH` 也没设，于是 Deck 半边把"没找到 gh"报成
 * `gh.resolve.fail`，引导链第 2 步 `gh:installed` 判 fail，横幅写「数据源前置条件未就绪」——而用户其实已登录。
 *
 * 归一之后的契约（本文件钉住三条）：
 *   ① 合并宿主注入的解析器是**唯一**来源：它给了路径就用它，不再回落到 PATH / DSH_GH_PATH；
 *   ② 它说没有（null）就**如实没有**：不许偷偷退回第二套解析（那正是"两半各认一个 gh"的老毛病）；
 *   ③ 没注入时（单独运行 Deck 半边、源码态、门禁夹具）行为与从前逐字一致：走 PATH → DSH_GH_PATH。
 *
 * 隔离：不起真进程、不读真实 HOME、不碰网络；全程只调纯逻辑层 composePlatform。
 *
 * 用法：node tests/merge/host/gh-resolution.test.mjs
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT, check, note, section, summary } from './_check.mjs'

/** 让 PATH 那一侧"找得到 gh"的假底座：captured 记下每次被问到什么。 */
function makeAdapter(captured, foundPath) {
  return () => ({
    os: 'linux',
    pathImpl: {
      join: (...a) => a.join('/'), sep: '/', dirname: (p) => String(p).replace(/\/[^/]*$/, ''),
      basename: (p) => String(p).split('/').pop(), resolve: (...a) => a.join('/'),
      normalize: (p) => p, isAbsolute: (p) => String(p).startsWith('/'),
      relative: (a, b) => String(b).replace(String(a), '').replace(/^\//, ''),
    },
    getHome: async () => '/tmp/gh-resolution-home',
    resolveExecutable: async (name) => {
      captured.push(name)
      return name === 'gh' ? foundPath : '/usr/bin/' + name
    },
  })
}

function makeCtx() {
  return {
    get(name) {
      if (name === 'fs') {
        return {
          lstat: async () => ({ isFile: () => true }),
          readText: async () => '',
          writeText: async () => {},
          resolve: (p) => p,
          listDir: async () => [],
          stat: async () => null,
        }
      }
      if (name === 'subprocess') return { spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), collected: {} }) }
      return undefined
    },
  }
}

section('1) 平台层可被加载（源码真源，不是产物）')
const platMod = await import(pathToFileURL(join(REPO_ROOT, 'deck', 'src', 'host', 'platform', 'index.js')).href)
check(typeof platMod.composePlatform === 'function', '平台层导出 composePlatform')

section('2) 注入了解析器：它说了算，且不再问 PATH')
{
  const captured = []
  const adapter = makeAdapter(captured, '/usr/bin/gh-from-path')
  const plat = await platMod.composePlatform(makeCtx(), 'linux', adapter, {
    ghResolver: async () => '/root/.dsh/gh-cli/bin/gh',
  })
  const hit = await plat.resolveExecutable('gh')
  check(hit === '/root/.dsh/gh-cli/bin/gh', 'gh 走注入的解析器（实得 ' + hit + '）')
  check(captured.length === 0, '注入解析器命中后不再问 PATH（实问 ' + JSON.stringify(captured) + '）')
  const other = await plat.resolveExecutable('git')
  check(other === '/usr/bin/git', '非 gh 命令仍走底座（实得 ' + other + '）')
  check(captured.length === 1 && captured[0] === 'git', '只有 git 问过底座（实问 ' + JSON.stringify(captured) + '）')
}

section('3) 解析器说"没有"：如实没有，不偷偷退回 PATH')
{
  const captured = []
  const adapter = makeAdapter(captured, '/usr/bin/gh-from-path')
  const plat = await platMod.composePlatform(makeCtx(), 'linux', adapter, { ghResolver: async () => null })
  const hit = await plat.resolveExecutable('gh')
  check(hit === null, 'gh 回 null（实得 ' + String(hit) + '）')
  check(captured.indexOf('gh') < 0, 'gh 一次都没问 PATH（这正是"两半各认一个 gh"的复发点）')
  note('调用方（ghClient / preflight / repoKeys）据此如实报 env 失败，不撒谎说"已安装"')
}

section('4) 解析器抛错：按"没有"处理，仍不回退')
{
  const captured = []
  const adapter = makeAdapter(captured, '/usr/bin/gh-from-path')
  const plat = await platMod.composePlatform(makeCtx(), 'linux', adapter, {
    ghResolver: async () => { throw new Error('resident 半边还没起来') },
  })
  const hit = await plat.resolveExecutable('gh')
  check(hit === null, '解析器抛错 → null（实得 ' + String(hit) + '）')
  check(captured.indexOf('gh') < 0, '抛错也不回退 PATH')
}

section('5) 没注入（单独运行 / 源码态 / 夹具）：行为与从前逐字一致')
{
  const captured = []
  const adapter = makeAdapter(captured, '/usr/bin/gh-from-path')
  const plat = await platMod.composePlatform(makeCtx(), 'linux', adapter, {})
  const hit = await plat.resolveExecutable('gh')
  check(hit === '/usr/bin/gh-from-path', '无注入时仍走 PATH（实得 ' + hit + '）')
  check(captured.indexOf('gh') >= 0, '无注入时确实问了 PATH')
}

section('6) 源码接线三处都在（防"改了平台层却忘了接线"）')
{
  const platSrc = await (await import('node:fs/promises')).readFile(join(REPO_ROOT, 'deck', 'src', 'host', 'platform', 'index.js'), 'utf8')
  check(platSrc.includes('injectedGh'), 'platform/index.js 认 opts.ghResolver')
  const chSrc = await (await import('node:fs/promises')).readFile(join(REPO_ROOT, 'deck', 'src', 'host', 'platformChannel.js'), 'utf8')
  check(chSrc.includes('ghResolver'), 'platformChannel.js 把解析器透传进平台层')
  const hostSrc = await (await import('node:fs/promises')).readFile(join(REPO_ROOT, 'deck', 'src', 'host', 'index.js'), 'utf8')
  check(hostSrc.includes("ctx.get('ghResolver')"), 'deck 宿主从 ctx 晚绑定取 ghResolver 服务')
  const resSrc = await (await import('node:fs/promises')).readFile(join(REPO_ROOT, 'plugin.js'), 'utf8')
  check(resSrc.includes("ctx.provide('ghResolver'"), 'Resident 半边把唯一解析器 provide 成 ghResolver 服务')
}

summary()
