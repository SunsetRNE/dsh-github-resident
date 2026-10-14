/**
 * tests/merge/host/subprocess-env.test.mjs —— 票「子进程环境：插件启动的 gh / git 子进程按需带上真源 token」的门禁。
 *
 * 这张票的交付是**产出侧**：服务位 `ghResolver` 多一支返回「身份环境」（`{ gh, git }` 两组分开），
 * Resident 自己 spawn 的 gh / git 子进程在**真正要以插件身份做事**时戴上它。所以判据分成三块：
 *
 *   ① **那一支本身**：两组分开、gh 组不含 GH_CONFIG_DIR、真源没 token 就是空组、值现算不缓存、
 *      助手落在插件自己的运行期目录（与接线目录 `WIRE_DIR` 分开、源码同源）；
 *   ② **戴上真的有用**（实跑，全离线）：目标环境＝「宿主没配 gh 凭据、也没全局 git 配置，真源 state 有 token」——
 *      gh 桩只在**看见 GH_TOKEN** 时才答；于是「注入 → gh 子进程成功 / 不注入 → 如实失败」两条都实跑得到。
 *      另有一条真 `git credential fill`：宿主已经接好线（`credential.helper=store` 压着过期凭据）时，
 *      **工牌仍然要赢**（实测过的坑：不先把这一组继承的助手清掉，拿到的是宿主那条过期凭据）；
 *      同时别的 host（gitlab）的宿主凭据**不许被误伤**；
 *   ③ **谁戴谁不戴**（漏一个或错戴一个即红）：行为判据（桩/包装脚本记下子进程 env）＋ 静态清单
 *      （每个 gh 的 fork 点必须显式写明「戴」或「不戴」，`badge.opts` 只许出现在两个声明过的位置）。
 *
 *   ④ **「戴了」≠「赢了」（票 #37 已裁：经验判据 + 措辞收窄）**：git 组回执多一个 `gitCredential`
 *      （`plugin-helper` / `none`），没指路时必须附一句 note；经验判据把「我们答的」钉在**实测**上 ——
 *      宿主是 **host 作用域** 的 stale 助手（`gh auth setup-git` 写的就是那条）时仍回插件凭据，
 *      并用**真 gh** 实测 `GH_TOKEN` 对 hosts.yml 的优先权（没有真 gh 就如实跳过，不假装）。
 *      这条**不宣称**证到「整条链路就是用这份凭据认证成功的」（ssh 远端 / URL 内嵌凭据 / extraheader 与本注入无关）。
 *
 * 隔离（沿用合成环境矩阵的规矩）：假 HOME + 只含夹具 bin 的 PATH + **自造的真源与 gh 桩**；
 * 不读真实 HOME、不碰宿主 git 配置、不起真实外网请求。用法：node tests/merge/host/subprocess-env.test.mjs
 */
import { dirname, join } from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { check, note, readText, section, skip, summary } from './_check.mjs'
import { makeHome, readGhEnv, readGhCalls, REAL, withPlugin } from './_env-harness.mjs'

const TOKEN = 'ghp_subprocessEnvFake00000000000000000000'
const TOKEN2 = 'ghp_subprocessEnvFake22222222222222222222'
const LOGIN = 'tester'
const CRED_KEY = 'credential.https://github.com.helper'
const RUNTIME_REL = join('.dsh', 'github-resident', 'runtime', 'git-credential-helper')

const homes = []
function home(tag, opts) {
  const h = makeHome(tag, opts)
  homes.push(h)
  return h
}
const cleanup = () => { for (const h of homes) h.cleanup() }

/** 夹具 HOME 里放一份真源（0600，和线上那份同一个位置）。 */
const stateFile = (h, obj) => {
  mkdirSync(join(h.home, '.dsh'), { recursive: true })
  writeFileSync(join(h.home, '.dsh', 'github-resident.json'), JSON.stringify(obj), { mode: 0o600 })
}

/**
 * 目标环境的 gh 桩：**只有看见 GH_TOKEN 才认账**（`auth setup-git` / `api user` 都这样），
 * `--version` 永远答（不然连解析都过不去，测的就不是"身份"这件事了）。记 argv 与 env 两本账。
 */
function identityAwareGh() {
  const script = `#!/bin/sh
{
  printf '%s\\n' "---CALL---"
  for a in "$@"; do printf '%s\\n' "$a"; done
  printf '%s\\n' "---ENV---"
  printf 'GH_TOKEN=%s\\n' "\${GH_TOKEN-<unset>}"
  printf 'GIT_CONFIG_COUNT=%s\\n' "\${GIT_CONFIG_COUNT-<unset>}"
  printf 'GH_CONFIG_DIR=%s\\n' "\${GH_CONFIG_DIR-<unset>}"
  printf 'GH_PROMPT_DISABLED=%s\\n' "\${GH_PROMPT_DISABLED-<unset>}"
} >> "$GH_STUB_LOG"
case "$1" in
  --version) echo "gh version 9.9.9 (HARNESS-STUB)"; exit 0 ;;
esac
if [ -z "\${GH_TOKEN-}" ]; then
  echo "gh: To get started with GitHub CLI, please run: gh auth login" 1>&2
  exit 1
fi
case "$1 $2" in
  "auth setup-git") exit 0 ;;
  "api user") echo "${LOGIN}"; exit 0 ;;
esac
exit 1
`
  return script
}

/** 把夹具 bin 里的 git 换成「记一笔 env 再 exec 真 git」的包装脚本（argv 与 env 同本账）。 */
function recordGit(h) {
  const log = join(h.home, 'git-env.log')
  const stub = join(h.bin, 'git')
  rmSync(stub, { force: true })   // ⚠️ 先断开软链：直接写会**穿过软链**改到真 git 二进制上（这里是夹具 bin，也不许）
  // 逐键显式写（不 loop、不 eval、不借外部命令）：夹具 bin 里只有夹具自己那几个名字，PATH 里没有 printenv/env。
  writeFileSync(stub, `#!/bin/sh
{
  printf '%s\\n' "---ENV---"
  printf 'argv=%s\\n' "$*"
  printf 'GH_TOKEN=%s\\n' "\${GH_TOKEN-<unset>}"
  printf 'GIT_CONFIG_COUNT=%s\\n' "\${GIT_CONFIG_COUNT-<unset>}"
  printf 'GIT_CONFIG_KEY_0=%s\\n' "\${GIT_CONFIG_KEY_0-<unset>}"
  printf 'GIT_CONFIG_VALUE_0=%s\\n' "\${GIT_CONFIG_VALUE_0-<unset>}"
  printf 'GIT_CONFIG_KEY_2=%s\\n' "\${GIT_CONFIG_KEY_2-<unset>}"
  printf 'GIT_CONFIG_VALUE_2=%s\\n' "\${GIT_CONFIG_VALUE_2-<unset>}"
  printf 'GIT_TERMINAL_PROMPT=%s\\n' "\${GIT_TERMINAL_PROMPT-<unset>}"
} >> ${JSON.stringify(log)}
exec ${JSON.stringify(REAL.git)} "$@"
`, { mode: 0o755 })
  chmodSync(stub, 0o755)
  return log
}

/** 读包装脚本记下的 git 调用：每次一条 `{ argv, KEY: value }`（`<unset>` 保留原样）。 */
/** `git()` 造的是 `-C <dir> <verb> …`，所以动词在第 3 个 token 上（夹具路径没有空格，按空格切就够）。 */
const verbOf = (c) => String(c.argv || '').split(' ')[2] || ''
function readGitLog(log) {
  let raw = ''
  try { raw = readFileSync(log, 'utf8') } catch { return [] }
  const calls = []
  let cur = null
  for (const line of raw.split('\n')) {
    if (!line) continue
    if (line === '---ENV---') { cur = {}; calls.push(cur); continue }
    if (!cur) continue
    const i = line.indexOf('=')
    if (i > 0) cur[line.slice(0, i)] = line.slice(i + 1)
  }
  return calls
}

/** 从源码里取那份「插件自有凭据助手」的运行时文本（与 wire 那份**同源**，所以要比对的就是它）。 */
function helperSourceFromPlugin() {
  const m = readText('plugin.js').match(/const GIT_CREDENTIAL_HELPER_SRC = (`[\s\S]*?`);/)
  if (!m) return null
  try { return new Function('return ' + m[1])() } catch { return null }
}

/** 真跑一次 `git credential fill`（用真 git，喂一条 loopback 无关的凭据请求）。 */
function gitCredentialFill(env, host) {
  const script = `printf 'protocol=https\\nhost=${host}\\n\\n' | ${JSON.stringify(REAL.git)} credential fill`
  return new Promise((resolve) => {
    execFile(REAL.sh, ['-c', script], { env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = String(stdout || '')
      resolve({
        code: err ? 1 : 0,
        username: (out.match(/^username=(.*)$/m) || [])[1] || null,
        out, err: String(stderr || ''),
      })
    })
  })
}

/** 造一个真仓库（本地 bare 当 origin：本地路径不走凭据，所以这里判的是"工牌在不在"，不是"能不能认证"）。 */
function makeRepo(h, name) {
  const repo = join(h.home, name)
  const bare = join(h.home, name + '-origin.git')
  mkdirSync(repo, { recursive: true })
  const env = { ...process.env, PATH: h.pathWithReal }
  const g = (args, cwd) => execFileSync(REAL.git, args, { cwd, env, stdio: 'pipe' })
  g(['init', '-q', '--bare', '-b', 'main', bare])
  g(['init', '-q', '-b', 'main', repo])
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  g(['remote', 'add', 'origin', bare], repo)
  // 先把 upstream 建起来：插件的推送是裸 `git push`（没有 upstream 只会得到 fatal，测的就不是工牌了）。
  // 这一步用临时的夹具身份（与后面「靠注入提交」那一步无关）。
  g(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'add', '-A'], repo)
  g(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '-m', 'init'], repo)
  g(['push', '-q', '-u', 'origin', 'main'], repo)
  return { repo, bare }
}

if (!REAL.git || !REAL.sh) {
  section('零、前提')
  skip('夹具里没有真的 git / sh（' + JSON.stringify({ git: REAL.git, sh: REAL.sh }) + '）：本票的真跑与凭据链判据全都依赖它们，如实跳过而不是假装绿')
}

// ---------------------------------------------------------------------------
section('一、服务位那一支：两组分开、值现算、助手落在自己的运行期目录')

const hA = home('se-a', { withGh: true, gh: { log: true, envLog: true } })
writeFileSync(hA.bin + '/gh', identityAwareGh(), { mode: 0o755 })
chmodSync(hA.bin + '/gh', 0o755)
const logA = join(hA.home, 'gh-stub.log')
writeFileSync(logA, '')
stateFile(hA, { token: TOKEN, login: LOGIN })

let firstEnv = null
await withPlugin(hA.home, {
  path: hA.bin, dataDir: join(hA.home, '.dsh', 'gh-cli'),
  env: { GH_STUB_LOG: logA },
}, async ({ provided }) => {
  const svc = provided.ghResolver
  check(!!svc, '服务位 ghResolver 提供出来了')
  check(typeof svc.resolve === 'function', 'resolve() 还在（既有语义与调用方不许动）')
  check(typeof svc.identityEnv === 'function', '服务位多了一支 identityEnv（供给身份环境的唯一入口）')

  firstEnv = await svc.identityEnv()
  const ghKeys = Object.keys(firstEnv.gh).sort()
  check(JSON.stringify(ghKeys) === JSON.stringify(['GH_PAGER', 'GH_PROMPT_DISABLED', 'GH_TOKEN', 'NO_COLOR']),
    'gh 组＝GH_TOKEN + 非交互三件套（实得 ' + JSON.stringify(ghKeys) + '）')
  check(firstEnv.gh.GH_TOKEN === TOKEN, 'gh 组的 GH_TOKEN 就是真源那一份')
  check(!('GH_CONFIG_DIR' in firstEnv.gh), 'gh 组**不含** GH_CONFIG_DIR（那是 gh 自己的家，动它就读不出"它自己登没登录"）')
  check(firstEnv.source === 'state:~/.dsh/github-resident.json', '如实报身份来源（' + firstEnv.source + '）')

  const gitEnv = firstEnv.git
  check(!('GH_TOKEN' in gitEnv), 'git 组**不含** GH_TOKEN（git 的环境"同屋共享"：hook / 子模块 / 兄弟进程都读得到）')
  check(gitEnv.GIT_TERMINAL_PROMPT === '0', 'git 组带 GIT_TERMINAL_PROMPT=0（不许它问人）')
  check(Number(gitEnv.GIT_CONFIG_COUNT) === 4, 'git 组注入 4 条配置（实得 ' + gitEnv.GIT_CONFIG_COUNT + '）')
  check(gitEnv.GIT_CONFIG_KEY_0 === CRED_KEY && gitEnv.GIT_CONFIG_VALUE_0 === '',
    '第一条是**空的**同一个 helper 键（先把这一组继承来的助手清掉）—— 顺序错了工牌就赢不了')
  check(gitEnv.GIT_CONFIG_KEY_1 === CRED_KEY && /^!.+git-credential-helper$/.test(gitEnv.GIT_CONFIG_VALUE_1 || ''),
    '第二条才指插件自有助手（' + gitEnv.GIT_CONFIG_VALUE_1 + '）')
  check(gitEnv.GIT_CONFIG_KEY_2 === 'user.name' && gitEnv.GIT_CONFIG_VALUE_2 === LOGIN, 'user.name 取真源里的登录名')
  check(gitEnv.GIT_CONFIG_KEY_3 === 'user.email' && gitEnv.GIT_CONFIG_VALUE_3 === LOGIN + '@users.noreply.github.com',
    'user.email 没填时用隐私邮箱（与 wire 现有默认同源）')

  // 助手落点：插件自己的运行期目录，与接线目录分开；0755；内容与源码那份同源。
  const helperFile = join(hA.home, RUNTIME_REL)
  let helperText = null
  let helperMode = null
  try { helperText = readFileSync(helperFile, 'utf8'); helperMode = statSync(helperFile).mode & 0o777 } catch { /* 没落盘 */ }
  const srcText = helperSourceFromPlugin()
  check(!!srcText, '从源码里取到了那份助手的运行时文本（判据 ① 成立，往下才有意义）')
  check(helperText !== null, '运行期助手真的落盘了（' + RUNTIME_REL + '）')
  check(helperText === srcText, '落盘内容与会话里那一份**逐字同源**')
  check(helperMode === 0o755, '助手是 0755（实得 ' + (helperMode === null ? '未落盘' : helperMode.toString(8)) + '）')
  check(!readFileSync(join(hA.home, '.dsh', 'github-resident.json'), 'utf8').includes('runtime'),
    '真源文件里没有被顺手改出别的东西（助手落点与 state 无关）')

  // 值现算不缓存：改掉 state 里的 token，第二次问必须变。
  stateFile(hA, { token: TOKEN2, login: LOGIN })
  const second = await svc.identityEnv()
  check(second.gh.GH_TOKEN === TOKEN2, '值**现算不缓存**：改了真源，第二次问立刻变')
  stateFile(hA, { token: TOKEN, login: LOGIN })

  // 只点名 gh 组时：不落助手（写盘只发生在真要 git 身份的那一刻）。
  const hNoGit = home('se-nogit', { withGh: true })
  stateFile(hNoGit, { token: TOKEN, login: LOGIN })
  await withPlugin(hNoGit.home, { path: hNoGit.bin, dataDir: join(hNoGit.home, '.dsh', 'gh-cli') }, async ({ provided: p2 }) => {
    const onlyGh = await p2.ghResolver.identityEnv({ groups: ['gh'] })
    check(Object.keys(onlyGh.git).length === 0, '只点名 gh 组时 git 组是空的（不无脑给）')
    let landed = true
    try { readFileSync(join(hNoGit.home, RUNTIME_REL), 'utf8') } catch { landed = false }
    check(!landed, '只点名 gh 组时**不落**助手文件（只读/只问的路径不该凭空多出一个文件）')
  })

  // 落盘失败要**如实降级**，不许把工具整个炸掉（HOME 只读这类环境是真实存在的）：
  // 用「运行时目录的位置上蹲着一个普通文件」来制造 mkdir 失败 —— root 也绕不过 ENOTDIR，比 chmod 可靠。
  const hRo = home('se-ro', { withGh: true })
  stateFile(hRo, { token: TOKEN, login: LOGIN })
  mkdirSync(join(hRo.home, '.dsh', 'github-resident'), { recursive: true })
  writeFileSync(join(hRo.home, '.dsh', 'github-resident', 'runtime'), 'not a directory\n')
  await withPlugin(hRo.home, { path: hRo.bin, dataDir: join(hRo.home, '.dsh', 'gh-cli') }, async ({ provided: p3 }) => {
    let envRo = null
    let threw = null
    try { envRo = await p3.ghResolver.identityEnv() } catch (e) { threw = String(e && e.message) }
    check(!threw, '落助手失败时 identityEnv **不抛**（实得 ' + (threw || '没抛') + '）')
    check(!!envRo && Array.isArray(envRo.degraded) && envRo.degraded.includes('git-helper'),
      '如实标出降级（degraded=' + JSON.stringify(envRo && envRo.degraded) + '）')
    const pairsOf = (g) => {
      const n = Number(g.GIT_CONFIG_COUNT || 0)
      return Array.from({ length: n }, (_, i) => [g['GIT_CONFIG_KEY_' + i], g['GIT_CONFIG_VALUE_' + i]])
    }
    const pairsRo = envRo ? pairsOf(envRo.git) : []
    check(!pairsRo.some(([, v]) => String(v).includes('git-credential-helper')),
      '降级时不给「指了个不存在的助手」那种假指路（没有指向助手的条目）')
    check(pairsRo.some(([k, v]) => k === 'user.name' && v === LOGIN),
      '但身份那一半照给（提交身份仍靠注入生效；实得 ' + JSON.stringify(pairsRo) + '）')
    check(!!envRo && envRo.gh.GH_TOKEN === TOKEN, 'gh 组不受影响（那是另一条路）')
  })
})

// ---------------------------------------------------------------------------
section('二、实跑：真源有 token、宿主什么都没有 —— 注入就成，不注入就如实失败')

// 目标环境：state 有 token/login、没有 hosts.yml、env 里也没有 GH_TOKEN。
let injectedResult = null
await withPlugin(hA.home, {
  path: hA.bin, dataDir: join(hA.home, '.dsh', 'gh-cli'),
  env: { GH_STUB_LOG: logA },
}, async ({ tool }) => {
  injectedResult = await tool('gh_cli_setup_git').execute({}, {})
})
check(injectedResult && injectedResult.exitCode === 0,
  '注入路径下 gh 子进程**实跑成功**（桩只在看见 GH_TOKEN 时才认账；实得 exitCode=' + (injectedResult && injectedResult.exitCode) + '）')
check(injectedResult && injectedResult.identityEnv && injectedResult.identityEnv.applied.includes('gh'),
  '回执如实报「这次戴了哪张工牌」（' + JSON.stringify(injectedResult && injectedResult.identityEnv) + '）')

// 取证：桩记下的 env 里，**这次调用**到底看没看见工牌（跑完才读，别把顺序写反了）。
const envCalls = readGhEnv(logA)
const argvCalls = readGhCalls(logA)
const setupCalls = envCalls.filter((_, i) => (argvCalls[i] || []).join(' ').startsWith('auth setup-git'))
check(setupCalls.length > 0 && setupCalls.every((c) => c.GH_TOKEN === TOKEN),
  '戴工牌的那次 gh 调用：子进程 env 里真的看到了 GH_TOKEN（桩记的 env 取证，共 ' + setupCalls.length + ' 次）')
const probeCalls = argvCalls.filter((a) => a[0] === '--version').length
check(probeCalls > 0, '解析 gh 的那些探活调用也真的发生了（否则下面的"实跑"是空的）')

// 反过来说明「不注入就失败」不是空话：**真源什么都没有**的合成环境里，同一条调用如实失败。
const hB = home('se-b', { withGh: true, gh: { log: true, envLog: true } })
writeFileSync(hB.bin + '/gh', identityAwareGh(), { mode: 0o755 })
chmodSync(hB.bin + '/gh', 0o755)
const logB = join(hB.home, 'gh-stub.log')
writeFileSync(logB, '')
let bareResult = null
await withPlugin(hB.home, {
  path: hB.bin, dataDir: join(hB.home, '.dsh', 'gh-cli'),
  env: { GH_STUB_LOG: logB },
}, async ({ tool }) => {
  bareResult = await tool('gh_cli_setup_git').execute({}, {})
})
check(bareResult && bareResult.exitCode !== 0,
  '真源没有 token 时：同一条 gh 调用**如实失败**（实得 exitCode=' + (bareResult && bareResult.exitCode) + '）')
check(bareResult && bareResult.identityEnv && bareResult.identityEnv.applied.length === 0,
  '且回执如实说「这次没戴上」（不是假装戴了）')
check(readGhEnv(logB).every((c) => c.GH_TOKEN === '<unset>'),
  '那种环境里子进程 env 里确实没有 GH_TOKEN（桩记 env 取证）')

// ---------------------------------------------------------------------------
section('三、谁戴谁不戴：行为判据 + 静态清单（漏一个或错戴一个即红）')

const hC = home('se-c', { withGh: true, gh: { log: true, envLog: true } })
writeFileSync(hC.bin + '/gh', identityAwareGh(), { mode: 0o755 })
chmodSync(hC.bin + '/gh', 0o755)
const logC = join(hC.home, 'gh-stub.log')
const gitLogC = recordGit(hC)
writeFileSync(logC, '')
stateFile(hC, { token: TOKEN, login: LOGIN })
const { repo } = makeRepo(hC, 'repo')

let commitResult = null
let statusResult = null
let resolveResult = null
let auditResult = null
await withPlugin(hC.home, {
  path: hC.bin, dataDir: join(hC.home, '.dsh', 'gh-cli'),
  env: { GH_STUB_LOG: logC },
}, async ({ tool }) => {
  // 先弄脏工作区：没东西可提交时 commitRepo 会如实回「no staged changes」，那测的就不是工牌了。
  writeFileSync(join(repo, 'c.txt'), 'c\n')
  auditResult = await tool('gh_identity').execute({}, {})
  statusResult = await tool('gh_cli_status').execute({}, {})
  resolveResult = await tool('gh_cli_resolve').execute({}, {})
  commitResult = await tool('gh_commit').execute({ repo, message: 't', push: false }, {})
})

check(commitResult && commitResult.ok === true,
  '提交**实跑成功**（宿主没有全局 git 配置，靠注入的身份；' + JSON.stringify(commitResult && commitResult.ok) + '）')
check(commitResult && commitResult.identityEnv && commitResult.identityEnv.applied.includes('git'),
  '提交回执如实报「戴了 git 组」（' + JSON.stringify(commitResult && commitResult.identityEnv) + '）')

const gitCalls = readGitLog(gitLogC)
const commitCalls = gitCalls.filter((c) => verbOf(c) === 'commit')
const pushCalls = gitCalls.filter((c) => verbOf(c) === 'push')
const configCalls = gitCalls.filter((c) => verbOf(c) === 'config')
check(commitCalls.length > 0 && commitCalls.every((c) => c.GIT_CONFIG_COUNT === '4' && c.GIT_CONFIG_VALUE_2 === LOGIN),
  'git 的提交调用戴着工牌（GIT_CONFIG_COUNT=4、user.name 到得了子进程；共 ' + commitCalls.length + ' 次）')
check(commitCalls.every((c) => c.GH_TOKEN === '<unset>'), 'git 子进程**拿不到** GH_TOKEN（两组不混）')
check(configCalls.length > 0 && configCalls.every((c) => c.GIT_CONFIG_COUNT === '<unset>'),
  '问盘上是什么的 `git config --global …` 调用**没戴**（戴了会把盘上真值读成注入值；共 ' + configCalls.length + ' 次）')
check(pushCalls.length === 0, '这次没推送，所以没有 push 调用（下面单独跑一次带推送的）')

const ghEnvC = readGhEnv(logC)
const ghArgvC = readGhCalls(logC)
const isProbe = (argv) => argv[0] === '--version'
check(ghEnvC.length > 0 && isProbe(ghArgvC[0] || []), '记录到了 gh 的探活调用（下面按它判"不戴"）')
check(ghEnvC.every((c, i) => isProbe(ghArgvC[i] || []) ? c.GH_TOKEN === '<unset>' : true),
  '探活（`gh --version`）**没戴**工牌')
check(ghEnvC.every((c, i) => (ghArgvC[i] || [])[0] === 'auth' ? c.GH_TOKEN === '<unset>' : true),
  '`gh auth status` 那些**读数**没戴（戴上会把"宿主自己登没登录"读成"插件有身份"）')
check(!JSON.stringify(auditResult).includes(TOKEN), '体检回执里没有 token 原文（只有"能不能注入 / 落没落"这些事实）')
const envPoint = (auditResult.points || []).find((p) => p.point === 'env')
const envDetail = envPoint && envPoint.checks && envPoint.checks[0] && envPoint.checks[0].detail
check(!!(envDetail && envDetail.injection && envDetail.injection.canInjectGh === true),
  '体检的那个消费点如实报「子进程身份由插件按需供给」（' + JSON.stringify(envDetail && envDetail.injection) + '）')
check(envPoint && envPoint.verdict.includes('gh 组'), '体检结论点明哪几组能供给身份（' + (envPoint && envPoint.verdict) + '）')
check(statusResult && typeof statusResult.authenticated === 'boolean' && resolveResult && resolveResult.resolved,
  '两张只读工具照常出结论（没被这次改动弄坏）')

// 带推送的一次：远端是本地 bare（本地路径不走凭据），判据是"push 这一步戴没戴"。
let pushResult = null
await withPlugin(hC.home, {
  path: hC.bin, dataDir: join(hC.home, '.dsh', 'gh-cli'),
  env: { GH_STUB_LOG: logC },
}, async ({ tool }) => {
  writeFileSync(join(repo, 'b.txt'), 'b\n')
  pushResult = await tool('gh_commit').execute({ repo, message: 't2', push: true }, {})
})
const pushCalls2 = readGitLog(gitLogC).filter((c) => verbOf(c) === 'push')
check(pushCalls2.length > 0 && pushCalls2.every((c) => c.GIT_CONFIG_COUNT === '4'),
  '推送调用也戴着 git 组（' + pushCalls2.length + ' 次）')
check(pushResult && pushResult.push === 'ok', '推送本身也真的成了（本地远端；实得 ' + (pushResult && pushResult.push) + '）')

// ---- 静态清单：每个 gh 的 fork 点都要显式写明「戴」或「不戴」 ----
const src = readText('plugin.js')
const GH_SITES = [/run\(activeBin,/, /run\(ghBin,/, /run\(g\.path,/, /run\(bin, \['--version'\]/, /runBounded\(gh\.path,/]
let undeclared = 0
let declared = 0
for (const re of GH_SITES) {
  const rx = new RegExp(re.source, 'g')
  let m = null
  while ((m = rx.exec(src)) !== null) {
    const before = src.slice(Math.max(0, m.index - 600), m.index)
    const after = src.slice(m.index, m.index + 240)
    const wears = after.includes('badge.opts') || after.includes('badge')
    const refuses = before.includes('不戴工牌')
    if (wears || refuses) declared += 1
    else { undeclared += 1; note('没声明戴/不戴的 gh fork 点：…' + src.slice(m.index, m.index + 60).split('\n')[0]) }
  }
}
check(declared > 0, '静态扫抓得到 gh 的 fork 点（抓不到说明判据失配，不是"没问题"）')
check(undeclared === 0, '每个 gh 的 fork 点都显式写了「戴」或「不戴」（没声明的 ' + undeclared + ' 个）')

// `badge.opts` 只许出现在两个**声明过**的位置：commitRepo（git 组）与 gh_cli_setup_git（gh 组）。
const rangeOf = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  return (a < 0 || b < 0) ? null : [a, b]
}
const rCommit = rangeOf('async function commitRepo(', '\n}\n')
const rSetup = rangeOf("toolName: 'gh_cli_setup_git'", '}));')
const badgeIdx = [...src.matchAll(/badge\.opts/g)].map((m) => m.index)
const inside = (i) => (rCommit && i >= rCommit[0] && i <= rCommit[1]) || (rSetup && i >= rSetup[0] && i <= rSetup[1])
check(!!rCommit && !!rSetup, '两个「戴工牌」的位置都定位到了（判据才立得住）')
check(badgeIdx.length > 0 && badgeIdx.every(inside),
  '`badge.opts` 只出现在 commitRepo（git 组）与 gh_cli_setup_git（gh 组）里 —— 别处戴上会盖过宿主状态/盘上真值')
check(rCommit && /withBadge\('git'\)/.test(src.slice(rCommit[0], rCommit[1])), 'commitRepo 里 git 组来自 withBadge(\'git\')')
check(rSetup && /withBadge\('gh'\)/.test(src.slice(rSetup[0], rSetup[1])), 'gh_cli_setup_git 里 gh 组来自 withBadge(\'gh\')')
const commitPushBadged = [...src.slice(rCommit[0], rCommit[1]).matchAll(/git\(repo, \['(commit|push)'/g)]
  .every((m) => src.slice(rCommit[0] + m.index, rCommit[0] + m.index + 160).includes('badge.opts'))
check(commitPushBadged, '提交与推送这两步**都**把 opts 传下去了（漏一个就是"写了没戴"）')

// ---------------------------------------------------------------------------
section('四、已接线的宿主上，工牌仍然要赢（且不误伤别的 host）')

const hD = home('se-d', { withGh: true })
stateFile(hD, { token: TOKEN, login: LOGIN })
// 宿主「接过线」的样子：全局 helper=store + 一份过期凭据（这正是本插件自己写下的那套投影）。
const hostGlobal = join(hD.home, 'host-global.gitconfig')
writeFileSync(hostGlobal, '[credential]\n\thelper = store\n')
writeFileSync(join(hD.home, '.git-credentials'),
  'https://stale-user:stale-token@github.com\nhttps://stale-gitlab:stale-token@gitlab.com\n', { mode: 0o600 })

let dEnv = null
await withPlugin(hD.home, { path: hD.pathWithReal, dataDir: join(hD.home, '.dsh', 'gh-cli') }, async ({ provided }) => {
  dEnv = await provided.ghResolver.identityEnv({ groups: ['git'] })
})
// 这份 env 要复刻**生产里插件 fork 的 git 拿到的那份 PATH**：夹具 bin + 真实 PATH + **node 所在目录**。
// 为什么要显式加 node（矩阵抓出来的）：那份助手是 node 脚本（`#!/usr/bin/env node`），而矩阵那格的 PATH
// 只有夹具 bin —— 不补 node 就等于要求「跑门禁这台机器的 PATH 里恰好有 node」，正是矩阵要消灭的那类依赖。
// `process.execPath` 就是此刻跑门禁的 node，生产里插件也是它 fork 子进程的，两边同一个事实。
const baseEnv = { ...process.env, PATH: hD.pathWithReal + ':' + dirname(process.execPath), HOME: hD.home }
const withBadgeEnv = { ...baseEnv, ...dEnv.git, GIT_CONFIG_GLOBAL: hostGlobal, GIT_TERMINAL_PROMPT: '0' }
const ghFill = await gitCredentialFill(withBadgeEnv, 'github.com')
check(ghFill.username === LOGIN,
  'github.com 走的是**插件身份**（挂着 store 的老凭据也抢不走：' + ghFill.username + '）')
const labFill = await gitCredentialFill(withBadgeEnv, 'gitlab.com')
check(labFill.username === 'stale-gitlab',
  '别的 host（gitlab.com）的宿主凭据**不受影响**（' + labFill.username + '）')
const noBadgeEnv = { ...baseEnv, GIT_CONFIG_GLOBAL: hostGlobal, GIT_TERMINAL_PROMPT: '0' }
const staleFill = await gitCredentialFill(noBadgeEnv, 'github.com')
check(staleFill.username === 'stale-user',
  '不戴工牌时拿到的仍是宿主那条（对照组成立，说明上面那条不是碰巧）')

// ---------------------------------------------------------------------------
section('六、票 #37（已裁：经验判据 + 措辞收窄）：把「戴了」与「指没指路」分开')

// 6a. **host 作用域**的 stale 助手（`gh auth setup-git` 写的就是这一条 —— 本机最常见的那种形状，
//     旧判据只覆盖了全局 `credential.helper`）：注入下仍必须是我们答的。
const hE = home('se-e', { withGh: true })
stateFile(hE, { token: TOKEN, login: LOGIN })
const hostScopedCfg = join(hE.home, 'host-scoped.gitconfig')
writeFileSync(hostScopedCfg, '[credential "https://github.com"]\n\thelper = store\n')
writeFileSync(join(hE.home, '.git-credentials'), 'https://stale-user:stale-token@github.com\n', { mode: 0o600 })

let eEnv = null
await withPlugin(hE.home, { path: hE.pathWithReal, dataDir: join(hE.home, '.dsh', 'gh-cli') }, async ({ provided }) => {
  eEnv = await provided.ghResolver.identityEnv({ groups: ['git'] })
})
const eBase = { ...process.env, PATH: hE.pathWithReal + ':' + dirname(process.execPath), HOME: hE.home }
const eBadge = { ...eBase, ...eEnv.git, GIT_CONFIG_GLOBAL: hostScopedCfg, GIT_TERMINAL_PROMPT: '0' }
const eFill = await gitCredentialFill(eBadge, 'github.com')
check(eFill.username === LOGIN,
  '宿主是 **host 作用域** 的 stale 助手时，winning 的仍是插件身份（' + eFill.username + '）')
const eStale = await gitCredentialFill({ ...eBase, GIT_CONFIG_GLOBAL: hostScopedCfg, GIT_TERMINAL_PROMPT: '0' }, 'github.com')
check(eStale.username === 'stale-user',
  '对照：不戴工牌时那条 host 作用域助手照旧赢（说明上一条不是碰巧）')

// 6b. 真源**没有 token** 时：git 组不许指路（不给「有助手但永远不答」的假接线），且回执必须如实说「没指路」。
const hF = home('se-f', { withGh: true })
stateFile(hF, { login: LOGIN, user_email: 'tester@example.com' })   // 有登录名、没 token
const { repo: repoF } = makeRepo(hF, 'repo-f')
let fEnv = null
let fCommit = null
await withPlugin(hF.home, { path: hF.pathWithReal, dataDir: join(hF.home, '.dsh', 'gh-cli') }, async ({ tool, provided }) => {
  fEnv = await provided.ghResolver.identityEnv({ groups: ['git'] })
  writeFileSync(join(repoF, 'f.txt'), 'f\n')
  fCommit = await tool('gh_commit').execute({ repo: repoF, message: 't', push: false }, {})
})
const credEntriesOf = (gitEnv) => Object.keys(gitEnv)
  .filter((k) => /^GIT_CONFIG_KEY_\d+$/.test(k) && gitEnv[k] === CRED_KEY)
  .map((k) => gitEnv['GIT_CONFIG_VALUE_' + k.slice('GIT_CONFIG_KEY_'.length)])
check(credEntriesOf(fEnv.git).length === 0,
  '真源没 token → git 组**不指路**（不塞一个永远不答的助手）')
check(fEnv.git.GIT_TERMINAL_PROMPT === '0' && Object.keys(fEnv.git).length > 0,
  '但这一组照样戴（不许问人 + 身份两项）：applied 仍为真')
const fBadge = fCommit && fCommit.identityEnv
check(fBadge && fBadge.applied.includes('git') && fBadge.gitCredential === 'none',
  '回执如实说「没指路」（gitCredential=none）：' + JSON.stringify(fBadge))
check(fBadge && typeof fBadge.note === 'string' && /没有指路|不等于「赢了」/.test(fBadge.note),
  '并附一句人话把「戴了 ≠ 赢了」说清：' + JSON.stringify(fBadge && fBadge.note))

// 6c. 有 token 时：回执说「已指向插件自有助手」（这条路上实测是我们答的）。
const hG = home('se-g', { withGh: true })
stateFile(hG, { token: TOKEN, login: LOGIN })
const { repo: repoG } = makeRepo(hG, 'repo-g')
let gBadge = null
let gEnvOfG = null
await withPlugin(hG.home, { path: hG.pathWithReal, dataDir: join(hG.home, '.dsh', 'gh-cli') }, async ({ tool, provided }) => {
  gEnvOfG = await provided.ghResolver.identityEnv({ groups: ['git'] })
  writeFileSync(join(repoG, 'g.txt'), 'g\n')
  const r = await tool('gh_commit').execute({ repo: repoG, message: 't', push: false }, {})
  gBadge = r && r.identityEnv
})
check(gBadge && gBadge.gitCredential === 'plugin-helper',
  '有 token → 回执说 plugin-helper（与 6a 的实测对得上）：' + JSON.stringify(gBadge))
const gCreds = credEntriesOf(gEnvOfG.git)
check(gCreds.length === 2 && gCreds[0] === '' && /^!/.test(gCreds[1] || ''),
  '而且真的指路了：先空值清场、再指向插件助手（' + JSON.stringify(gCreds.map((v) => v.slice(0, 28))) + '）')
check(gBadge && gBadge.note === undefined, '一切正常时不啰嗦（没指路那句 note 不出现）')

// 6d. gh 那条：`GH_TOKEN` 对 hosts.yml 的优先权 —— 用**真 gh** 实测（没有真 gh 就如实跳过）。
//
// 真 gh **只按固定绝对路径找，绝不扫 PATH**：合成环境矩阵把子进程的 PATH 设成「只有夹具 bin」，
// 而那里放的是 gh **桩** —— 扫 PATH 会拿到桩，于是「真 gh 优先权」这条在矩阵三格里红
// （2026-07-15 CI 抓出来的；本地直跑/走运行器都绿，正是矩阵要消灭的那类「看这台机器长什么样」）。
const realGh = ['/usr/local/bin/gh', '/usr/bin/gh', '/bin/gh'].find((p) => {
  try { accessSync(p, constants.X_OK); return true } catch { return false }
}) || null
if (!realGh) {
  skip('本机没有真 gh：`GH_TOKEN` 优先权这条实测跳过（CI 上有 gh，会真断）')
} else {
  const hH = home('se-h', { withGh: true })
  stateFile(hH, { token: TOKEN, login: LOGIN })
  mkdirSync(join(hH.home, '.config', 'gh'), { recursive: true })
  writeFileSync(join(hH.home, '.config', 'gh', 'hosts.yml'),
    'github.com:\n    oauth_token: stale-gh-token\n    user: stale-user\n    git_protocol: https\n', { mode: 0o600 })
  let ghEnv = null
  await withPlugin(hH.home, { path: hH.pathWithReal, dataDir: join(hH.home, '.dsh', 'gh-cli') }, async ({ provided }) => {
    ghEnv = await provided.ghResolver.identityEnv({ groups: ['gh'] })
  })
  check(ghEnv.gh.GH_TOKEN === TOKEN, 'gh 组注入的是真源 token（不是 hosts.yml 那条）')
  // 显式指定夹具的 gh 配置目录：运行器把 GH_CONFIG_DIR 指向它自己的临时目录，
  // 不指定的话「对照」那条读不到夹具 hosts.yml（走运行器才暴露的坑）。
  const fixtureCfg = join(hH.home, '.config', 'gh')
  const authEnv = { ...process.env, HOME: hH.home, GH_CONFIG_DIR: fixtureCfg, ...ghEnv.gh, NO_COLOR: '1' }
  const withTok = await new Promise((resolve) => {
    execFile(realGh, ['auth', 'token'], { env: authEnv, maxBuffer: 1024 * 1024 }, (err, stdout) => resolve(String(stdout || '').trim()))
  })
  check(withTok === TOKEN, '真 gh 在注入环境下取到的就是我们的 token（' + withTok.slice(0, 12) + '…）')
  const noTok = await new Promise((resolve) => {
    execFile(realGh, ['auth', 'token'], { env: { ...process.env, HOME: hH.home, GH_CONFIG_DIR: fixtureCfg, NO_COLOR: '1' }, maxBuffer: 1024 * 1024 }, (err, stdout) => resolve(String(stdout || '').trim()))
  })
  check(noTok === 'stale-gh-token', '对照：不带 GH_TOKEN 时真 gh 取的是 hosts.yml 那条（说明上一条不是碰巧）')
}

// ---------------------------------------------------------------------------
section('五、跑完一圈：宿主配置面逐字节未变、不多出文件；token 不进回执')

let gitConfigExists = true
try { readFileSync(join(hC.home, '.gitconfig'), 'utf8') } catch { gitConfigExists = false }
check(!gitConfigExists, '跑完这一圈宿主 HOME 里**没有**多出 .gitconfig（不往宿主写）')
let credFileExists = true
try { readFileSync(join(hC.home, '.git-credentials'), 'utf8') } catch { credFileExists = false }
check(!credFileExists, '也没有多出 .git-credentials')
let hostsExists = true
try { readFileSync(join(hC.home, '.config', 'gh', 'hosts.yml'), 'utf8') } catch { hostsExists = false }
check(!hostsExists, '也没有替 gh 写 hosts.yml（只读边界）')
const receipts = JSON.stringify([injectedResult, bareResult, commitResult, pushResult, auditResult, statusResult, resolveResult])
check(!receipts.includes(TOKEN) && !receipts.includes(TOKEN2), 'token 原文不出现在任何回执里（掩码判据沿用）')

// 落盘的东西里也不许有 token 原文：那份助手是**读 state 回答**的脚本，不是凭据副本。
const landed = readFileSync(join(hA.home, RUNTIME_REL), 'utf8')
check(!landed.includes(TOKEN) && !landed.includes(TOKEN2), '落盘的助手文件里没有 token 原文（它不是第二份凭据存储）')

// 「宿主已接线」那一格的宿主侧文件：跑完逐字节未变（不是"没多出文件"，是"没被改过"）。
check(readFileSync(join(hD.home, '.git-credentials'), 'utf8')
  === 'https://stale-user:stale-token@github.com\nhttps://stale-gitlab:stale-token@gitlab.com\n',
  '宿主的 ~/.git-credentials 逐字节未变')
check(readFileSync(hostGlobal, 'utf8') === '[credential]\n\thelper = store\n', '宿主的全局 git 配置逐字节未变')

note('本用例覆盖：服务位那一支（两组 / 空重置 / 现值 / 落点 / 同源）、实跑两条（注入成、不注入败）、'
  + '真 git credential fill 四条（工牌赢 / host 作用域形状也赢 / 不误伤别的 host / 对照）、戴与不戴的行为 + 静态清单、'
  + '回执的 gitCredential 两态与「没指路」那句 note、真 gh 的 GH_TOKEN 优先权（含对照）、宿主不留痕。')
note('没覆盖（写清楚，不假装）：真 GitHub 上的认证（这里全是桩与本地远端）；Deck 半边怎么消费这一支'
  + '（那是《Deck 半边接消费面（执行环境由消费面供给）》的事，它有自己的合成环境格）。')
note('票 #37 的边界也写清楚：「谁赢了不可知」不是含糊话 —— 本用例证明的是**凭据助手这条路我们答的、gh 那条赢在优先权**；'
  + '若真源没 token（gitCredential=none）则压根没指路，凭据由宿主自己的助手决定。')

cleanup()
summary()
