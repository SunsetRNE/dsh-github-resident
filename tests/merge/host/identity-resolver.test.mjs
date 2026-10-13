/**
 * tests/merge/host/identity-resolver.test.mjs —— 统一身份解析器：三后端、优先级、掩码、只读。
 *
 * 为什么需要它（2026-10-14，ADR 0001 / 票「统一身份解析器：env → state → gh CLI（只读）」）：
 * 本包融合了两个插件，融合只做完「gh 在哪」，没做「gh 是谁」—— Resident 半边按
 * `GH_TOKEN → GITHUB_TOKEN → 自有 state` 取值，Deck 半边一律经 gh 执行、吃 gh CLI 的 hosts.yml。
 * 实测代价：本机 gh CLI 已认证、git 能推拉，而 `gh_pr` 走 REST 必然 401（它只认自有 token）。
 * 本用例把**唯一真源口径**钉死：`env → state（0600） → hosts.yml（只读）`，改顺序必须走新 ADR。
 *
 * 判据形状（对抗式，逐条都能证伪）：
 *   ① 三个后端各自能**单独**命中，`source` 如实标出来源（不含糊成「有 token」）；
 *   ② 优先级固定：三者同时在 → env 赢；去掉 env → state 赢；去掉 state → hosts.yml 赢；
 *   ③ hosts.yml **跨 host 不许串**（gitlab.com 的令牌绝不能出现在 github.com 的结果里）；
 *   ④ 回执侧只出掩码：`maskIdentity()` 的 JSON 里搜不到 token 原文与其中段；
 *   ⑤ hosts.yml / state 都是**只读**：跑一圈解析后逐字节不变、不多出文件；
 *   ⑥ 畸形输入不抛：垃圾 YAML、带引号的值、CRLF；解析不出来就如实回 `(none)`；
 *   ⑦ 接线钉住：`tokenOf(` 已删净、两处消费点都走解析器、hosts.yml 解析只有一处正则。
 *
 * 隔离：自造假 HOME（每个后端一个），**不联网**（不经工具，避免 `gh_resident_status` 那次 /user 探测）、
 * 不读真实 HOME、不写仓库。
 * 用法：node tests/merge/host/identity-resolver.test.mjs
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { check, note, section, summary, readText, tmpDir, REPO_ROOT } from './_check.mjs'

const PLUGIN_URL = pathToFileURL(join(REPO_ROOT, 'plugin.js')).href
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

/** 造一个假 HOME。`files` 是「相对 HOME 的路径 → 内容」。 */
function fakeHome(tag, files = {}) {
  const home = tmpDir('idres-' + tag)
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(home, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body, { mode: 0o600 })
  }
  return home
}

/**
 * 用指定假 HOME 重新求值一份 plugin.js（模块顶部的 HOME 是**加载期**求值的，
 * 所以每个 HOME 必须拿到自己的模块实例；查询串只是用来换一个模块 URL）。
 *
 * 为什么既改 `os.homedir` 又改 `process.env.HOME`（2026-10-14 实测）：plugin.js 用的是
 * `import * as os from 'node:os'`，而 Node 内置模块的**命名空间绑定不跟随属性改写** ——
 * 在 default 导出上写 `os.homedir = fn` 对命名空间里那个 `homedir` 无效；真正生效的是
 * `os.homedir()` 内部实时读的 `process.env.HOME`。两个都设，才不会出现「以为在用假 HOME、
 * 实际读的是真 HOME」这种静默假绿（本用例第一版就踩了这个坑，门禁自己把自己抓出来了）。
 */
async function loadPlugin(home, tag) {
  const realHomedir = os.homedir
  const realEnvHome = process.env.HOME
  os.homedir = () => home
  process.env.HOME = home
  try {
    return await import(PLUGIN_URL + '?home=' + encodeURIComponent(tag))
  } finally {
    os.homedir = realHomedir
    if (realEnvHome === undefined) delete process.env.HOME
    else process.env.HOME = realEnvHome
  }
}

/** 清掉环境里的两种 env 令牌，保证用例之间互不污染。 */
function clearEnvToken() {
  delete process.env.GH_TOKEN
  delete process.env.GITHUB_TOKEN
}

const GITHUB_TOKEN_FAKE = 'gho_HOSTS_GITHUB_abcdefghijklmnop'
const GITLAB_TOKEN_FAKE = 'glpat-LEAKME_0123456789'
const STATE_TOKEN_FAKE = 'gho_STATE_zyxwvutsrqponmlk'
const ENV_TOKEN_FAKE = 'gho_ENV_0123456789abcdefgh'
const GT_ENV_TOKEN_FAKE = 'gho_GITHUBTOKEN_fedcba9876543210'
const QUOTED_TOKEN_FAKE = 'gho_QUOTED_abcdefghijklmnop'

const HOSTS_REALISTIC = [
  'github.com:',
  '    users:',
  '        SunsetRNE:',
  '            oauth_token: ' + GITHUB_TOKEN_FAKE,
  '    git_protocol: https',
  '    oauth_token: ' + GITHUB_TOKEN_FAKE,
  '    user: SunsetRNE',
  'gitlab.com:',
  '    oauth_token: ' + GITLAB_TOKEN_FAKE,
  '    user: someone-else',
  '',
].join('\n')

const STATE_JSON = JSON.stringify({ token: STATE_TOKEN_FAKE, login: 'state-user', reposRoot: '/tmp/x' })

// ---------------------------------------------------------------- ① 三后端单独命中
section('① 三个后端各自能单独命中')
clearEnvToken()

const homeHosts = fakeHome('hosts', { '.config/gh/hosts.yml': HOSTS_REALISTIC })
const pHosts = await loadPlugin(homeHosts, 'hosts')
const rHosts = await pHosts.resolveIdentity()
check(rHosts.source === 'gh-cli:~/.config/gh/hosts.yml', 'hosts.yml 后端：source 如实（实得 ' + rHosts.source + '）')
check(rHosts.token === GITHUB_TOKEN_FAKE, 'hosts.yml 后端：取到的是 github.com 的令牌')
check(rHosts.login === 'SunsetRNE', 'hosts.yml 后端：登录名从 user: 读到（实得 ' + String(rHosts.login) + '）')

const homeState = fakeHome('state', { '.dsh/github-resident.json': STATE_JSON })
const pState = await loadPlugin(homeState, 'state')
const rState = await pState.resolveIdentity()
check(rState.source === 'state:~/.dsh/github-resident.json', 'state 后端：source 如实（实得 ' + rState.source + '）')
check(rState.token === STATE_TOKEN_FAKE && rState.login === 'state-user', 'state 后端：token 与 login 都对')

const homeNone = fakeHome('none', {})
const pNone = await loadPlugin(homeNone, 'none')
process.env.GH_TOKEN = ENV_TOKEN_FAKE
const rEnv = await pNone.resolveIdentity()
check(rEnv.source === 'env:GH_TOKEN' && rEnv.token === ENV_TOKEN_FAKE, 'env 后端：GH_TOKEN 命中且 source 如实')
check(rEnv.login === null, 'env 后端：登录名**不猜**（回 null，等调用方自己去问）')
delete process.env.GH_TOKEN
process.env.GITHUB_TOKEN = GT_ENV_TOKEN_FAKE
const rEnv2 = await pNone.resolveIdentity()
check(rEnv2.source === 'env:GITHUB_TOKEN' && rEnv2.token === GT_ENV_TOKEN_FAKE, 'env 后端：GITHUB_TOKEN 兜底命中')
clearEnvToken()

const rEmpty = await pNone.resolveIdentity()
check(rEmpty.ok === false && rEmpty.source === '(none)' && rEmpty.token === '', '三处都没有：ok=false、source=(none)，不编造')

// ---------------------------------------------------------------- ② 优先级
section('② 优先级：env → state → hosts.yml')
const homeAll = fakeHome('all', {
  '.dsh/github-resident.json': STATE_JSON,
  '.config/gh/hosts.yml': HOSTS_REALISTIC,
})
const pAll = await loadPlugin(homeAll, 'all')
process.env.GH_TOKEN = ENV_TOKEN_FAKE
check((await pAll.resolveIdentity()).source === 'env:GH_TOKEN', '三者同时在 → env 赢')
delete process.env.GH_TOKEN
check((await pAll.resolveIdentity()).source === 'state:~/.dsh/github-resident.json', '去掉 env → state 赢')
writeFileSync(join(homeAll, '.dsh/github-resident.json'), '{}\n', { mode: 0o600 })
check((await pAll.resolveIdentity()).source === 'gh-cli:~/.config/gh/hosts.yml', '去掉 state → hosts.yml 赢')
clearEnvToken()

// ---------------------------------------------------------------- ③ 跨 host 不串
section('③ hosts.yml 跨 host 不许串')
const dumpHosts = JSON.stringify(rHosts) + JSON.stringify(pHosts.maskIdentity(rHosts))
check(dumpHosts.indexOf(GITLAB_TOKEN_FAKE) < 0, 'gitlab.com 的令牌没有出现在 github.com 的解析结果里')
check((await pHosts.readHostsEntry('gitlab.com')).token === GITLAB_TOKEN_FAKE, '反向对照：要 gitlab.com 时取到的确实是它自己那条')

// ---------------------------------------------------------------- ④ 回执只出掩码
section('④ 回执侧只出掩码（token 原文与其中段都搜不到）')
for (const [label, mod, resolved] of [['hosts', pHosts, rHosts], ['state', pState, rState], ['env', pNone, rEnv]]) {
  const masked = mod.maskIdentity(resolved)
  const line = JSON.stringify(masked)
  const raw = resolved.token
  const middle = raw.slice(4, -4)
  check(line.indexOf(raw) < 0, label + '：掩码回执里没有 token 原文')
  check(line.indexOf(middle) < 0, label + '：掩码回执里没有 token 中段')
  check(masked.masked.indexOf(raw.slice(0, 4)) === 0 && masked.masked.indexOf(raw.slice(-4)) > 0, label + '：掩码保留了首尾各四位便于辨认')
  check(masked.present === true && masked.source === resolved.source, label + '：掩码回执带来源与 present')
}
check(JSON.stringify(pNone.maskIdentity(rEmpty)).indexOf('"(none)"') > 0, '无身份时掩码回执如实写 (none)')

// ---------------------------------------------------------------- ⑤ 只读
section('⑤ hosts.yml 与 state 都是只读（跑一圈后逐字节不变、不多出文件）')
const hostsFile = join(homeHosts, '.config', 'gh', 'hosts.yml')
const before = { sha: sha(hostsFile), listing: readdirSync(join(homeHosts, '.config', 'gh')).join(','), mtime: statSync(hostsFile).mtimeMs }
await pHosts.resolveIdentity()
await pHosts.readHostsEntry('github.com')
await pHosts.readHostsEntry('gitlab.com')
const after = { sha: sha(hostsFile), listing: readdirSync(join(homeHosts, '.config', 'gh')).join(','), mtime: statSync(hostsFile).mtimeMs }
check(before.sha === after.sha, 'hosts.yml 内容逐字节未变')
check(before.listing === after.listing, 'hosts.yml 所在目录没有多出文件（没写临时文件）')
check(before.mtime === after.mtime, 'hosts.yml mtime 未变（没有被当成写目标）')
const stateFile = join(homeState, '.dsh/github-resident.json')
const stateBefore = sha(stateFile)
await pState.resolveIdentity()
check(sha(stateFile) === stateBefore, 'state 文件在只读解析后逐字节未变')

// ---------------------------------------------------------------- ⑥ 畸形输入
section('⑥ 畸形输入不抛，解析不出来就如实回 (none)')
const homeBad = fakeHome('bad', { '.config/gh/hosts.yml': 'not: [valid\n  yaml:: ::\n' })
const pBad = await loadPlugin(homeBad, 'bad')
let threw = null
let rBad = null
try { rBad = await pBad.resolveIdentity() } catch (e) { threw = e }
check(!threw, '垃圾 hosts.yml 不抛（实得 ' + (threw ? String(threw).slice(0, 60) : 'ok') + '）')
check(rBad && rBad.source === '(none)', '垃圾 hosts.yml 如实回 (none)，不假装有身份')

const homeQuoted = fakeHome('quoted', {
  '.config/gh/hosts.yml': 'github.com:\r\n    user: "quoted-user"\r\n    oauth_token: "' + QUOTED_TOKEN_FAKE + '"\r\n',
})
const pQuoted = await loadPlugin(homeQuoted, 'quoted')
const rQuoted = await pQuoted.resolveIdentity()
check(rQuoted.token === QUOTED_TOKEN_FAKE, '带引号的值能解出来（引号被剥掉）')
check(rQuoted.login === 'quoted-user', '带引号的登录名同样解出来')
check(rQuoted.source === 'gh-cli:~/.config/gh/hosts.yml', 'CRLF 行尾不影响识别')

const homeEmptyHosts = fakeHome('emptyhosts', { '.config/gh/hosts.yml': 'github.com:\n    git_protocol: https\n' })
const pEmptyHosts = await loadPlugin(homeEmptyHosts, 'emptyhosts')
check((await pEmptyHosts.resolveIdentity()).source === '(none)', 'host 块在但没有 oauth_token → 如实回 (none)')

const homeDirAsFile = fakeHome('isdir', {})
mkdirSync(join(homeDirAsFile, '.config/gh/hosts.yml'), { recursive: true })
const pDir = await loadPlugin(homeDirAsFile, 'isdir')
let threw2 = null
try { await pDir.resolveIdentity() } catch (e) { threw2 = e }
check(!threw2, 'hosts.yml 位置是目录（读不动）也不抛')

// ---------------------------------------------------------------- ⑦ 接线钉住
section('⑦ 接线钉住（源码这一格写的是什么）')
const src = readText('plugin.js')
check(!/tokenOf\(/.test(src), 'tokenOf( 已删净：身份只有一个口径，防回潮')
const resolverCalls = (src.match(/resolveIdentity\(/g) || []).length
check(resolverCalls >= 3, '解析器：一处定义 + 两处消费（gh_resident_status / gh_pr），实得 ' + resolverCalls + ' 处')
check(/token: maskIdentity\(resolvedToken\)/.test(src), 'gh_resident_status 的 token 字段走掩码投影（带 source/login）')
check(/authSource: resolvedToken\.source/.test(src), 'gh_pr 回执写明这次用的是哪条身份路径')
const hostsParsers = (src.match(/oauth_token:\\s\*/g) || []).length
check(hostsParsers === 1, 'hosts.yml 的解析正则只有一处（全插件一份），实得 ' + hostsParsers + ' 处')
const hostsPathDefs = (src.match(/const HOSTS_FILE = path\.join/g) || []).length
check(hostsPathDefs === 1, 'hosts.yml 路径只定义一次，实得 ' + hostsPathDefs + ' 处')

note('判据 ①–⑥ 全部经导出的接缝直接驱动，不经工具 —— 走 gh_resident_status 会触发它那次 /user 联网探测。')
note('导出的三支（readHostsEntry / resolveIdentity / maskIdentity）是身份接缝：#23 的体检工具与 #19/#20 的消费面复用它们，不另写一份。')

// 清理
for (const d of [homeHosts, homeState, homeNone, homeAll, homeBad, homeQuoted, homeEmptyHosts, homeDirAsFile]) {
  try { rmSync(d, { recursive: true, force: true }) } catch { /* tmpDir 已在退出时兜底 */ }
}

summary()
