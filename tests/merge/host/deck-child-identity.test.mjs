#!/usr/bin/env node
/**
 * tests/merge/host/deck-child-identity.test.mjs ——
 * 票《Deck 半边接消费面（执行环境由消费面供给）》的判据。
 *
 * 它要钉死的是**消费这件事**（产出侧那一支已由 subprocess-env.test.mjs 钉住）：
 *   1) **静态红灯**：Deck 的每个 `subprocess.spawn` 都显式声明 `env`（探活那处写明 `env: undefined`）；
 *      并且 Deck 的源码里**没有第二套配置读取路径**（不读 hosts.yml、不读 state、不自己拼 GH_TOKEN）。
 *   2) **规则表**：谁戴哪一组（gh 除探活外都戴；git 只在 commit/push/pull/fetch 戴；glab 不戴）。
 *   3) **行为**：三个执行出口（gh 主干 `runGh`、通用 `execProc`、隧道 `detectionExec`、git 写出口）
 *      真的把**对应的那一组**交给了 spawn；探活与 git 读数不戴；**两组不混**（两个方向都断言）。
 *   4) **不缓存**：连续执行 → 消费面被问多次（调用计数取证）。
 *   5) **两半答案一致**：同一合成环境里，Resident 的 `resolve()` / `identityEnv()` 与 Deck 侧取到的
 *      是同一个答案；**没有服务位时不许回落第二套解析**。
 *   6) **端到端（真 git + 真桩）**：把 Deck 出口记下的那份 env 交给真 git ——
 *      全局配置指向不存在也提交成功（注入身份生效）、凭据助手被调用并答对；夹具 gh 桩**看得见** GH_TOKEN。
 *   7) **不落盘到宿主**：宿主那三份文件逐字节未变、不多出文件；token 原文不落在盘上。
 *
 * 边界（写清楚，不假装）：
 *   - 「DSH 子进程服务把凭据形状的父环境擦掉、再把显式 env 合上去」这一步是**宿主服务**的契约，
 *     由 subprocess-env.test.mjs 实测钉着。本文件证明的是 Deck 这一侧：交给 spawn 的就是那一组**本身**
 *     （不含 PATH/HOME 的快照），所以擦除之后它仍在。真进程那一段（真 git / 真 gh 桩）用的是同一份值。
 *   - 本文件自己造 gh 桩与真源 state，不看跑门禁这台机器有什么（因此进合成环境矩阵）。
 *
 * 用法：node tests/merge/host/deck-child-identity.test.mjs
 */
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import nodePath from 'node:path'
import { check, importRel, note, readText, REPO_ROOT, section, skip, summary, tmpDir } from './_check.mjs'
import { exists, listingOf, makeHome, readGhEnv, REAL, withPlugin } from './_env-harness.mjs'

const TOKEN = 'ghp_deckChildIdentity000000000000000000000000'
const LOGIN = 'deck-tester'
const HOSTS_STALE = [
  'github.com:',
  '    user: stale-host-user',
  '    oauth_token: stale-host-token',
  '    git_protocol: https',
  '',
].join('\n')
const GITCONFIG_STALE = '[credential]\n\thelper = store\n'
const CREDS_STALE = 'https://stale-user:stale-token@github.com\n'

const homes = []
function home(tag, opts) {
  const h = makeHome(tag, opts)
  homes.push(h)
  return h
}
const cleanup = () => { for (const h of homes) h.cleanup() }

// ---------------------------------------------------------------------------
// 只读源码的小工具（判据不许看环境，只看仓库里的源码文本）
// ---------------------------------------------------------------------------

/** 去掉行注释与块注释（**保留字符串字面量**）：「源码里有没有某个读法」不能在注释上判绿。 */
function stripComments(src) {
  let out = ''
  let i = 0
  let inLine = false
  let inBlock = false
  let quote = ''
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (inLine) { if (c === '\n') { inLine = false; out += c } i += 1; continue }
    if (inBlock) { if (c === '*' && d === '/') { inBlock = false; i += 2; continue } i += 1; continue }
    if (quote) {
      out += c
      if (c === '\\') { out += (d || ''); i += 2; continue }
      if (c === quote) quote = ''
      i += 1
      continue
    }
    if (c === '/' && d === '/') { inLine = true; i += 2; continue }
    if (c === '/' && d === '*') { inBlock = true; i += 2; continue }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i += 1; continue }
    out += c
    i += 1
  }
  return out
}

/** 递归收集 deck/src 下的 .js（相对仓库根的路径）。 */
function walkJs(rel) {
  const out = []
  for (const name of readdirSync(join(REPO_ROOT, rel)).sort()) {
    const childRel = rel + '/' + name
    if (statSync(join(REPO_ROOT, childRel)).isDirectory()) out.push(...walkJs(childRel))
    else if (name.endsWith('.js')) out.push(childRel)
  }
  return out
}

/** 取出 `subprocess.spawn(` 的选项对象文本（括号配平；在去注释后的源码上跑）。 */
function spawnBlocks(src) {
  const out = []
  const needle = 'subprocess.spawn('
  let idx = 0
  while ((idx = src.indexOf(needle, idx)) >= 0) {
    const start = idx + needle.length
    let depth = 1
    let i = start
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1
      else if (src[i] === ')') depth -= 1
      i += 1
    }
    out.push({ at: idx, text: src.slice(start, Math.max(start, i - 1)) })
    idx = i
  }
  return out
}

/** 走一个目录里的大小受限的普通文件（跳过软链与二进制大件），给「token 有没有落在盘上」用。 */
function filesUnder(root, acc = []) {
  for (const name of readdirSync(root)) {
    const p = join(root, name)
    let st = null
    try { st = lstatSync(p) } catch { continue }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) { filesUnder(p, acc); continue }
    if (st.isFile() && st.size < 256 * 1024) acc.push(p)
  }
  return acc
}

/** 交给真进程的 env：墓碑（undefined）是 DSH 的机制，child_process 不认，落盘前摘掉。 */
function liveEnvOf(env) {
  const out = {}
  for (const [k, v] of Object.entries(env || {})) if (v !== undefined) out[k] = v
  return out
}

// ---------------------------------------------------------------------------
section('1) 静态红灯：Deck 的每个 spawn 都显式声明 env；没有第二套配置读取路径')

const deckFiles = walkJs('deck/src')
const blocks = []
for (const f of deckFiles) for (const b of spawnBlocks(stripComments(readText(f)))) blocks.push({ file: f, text: b.text })
check(blocks.length >= 5, '扫到 Deck 的 spawn 点（实得 ' + blocks.length + ' 个；抓不到说明判据失配，不是"没问题"）')
const missingEnv = blocks.filter((b) => !/(^|[{,\s])env\s*:/.test(b.text))
check(missingEnv.length === 0, '每个 spawn 的选项对象里都有 env 键（漏的：' + (missingEnv.map((b) => b.file).join(', ') || '无') + '）')

const inFile = (f) => blocks.filter((b) => b.file === f)
check(inFile('deck/src/host/repoKeys.js').length === 3, 'repoKeys 的三个 spawn 点都在判据里（探活 / gh 主干 / 通用出口）')
check(inFile('deck/src/host/versionControl.js').length === 1, 'versionControl 的 git 出口在判据里')
check(inFile('deck/src/host/platformChannel.js').length === 1, 'platformChannel 的隧道出口在判据里')
check(inFile('deck/src/host/platform/index.js').length === 1, 'platform 的调起口（打开目录/文件）在判据里')

const probeBlock = inFile('deck/src/host/repoKeys.js').filter((b) => b.text.includes("'gh', '--version'"))
check(probeBlock.length === 1 && /env:\s*undefined/.test(probeBlock[0].text), '探活那一条（gh --version）显式 env: undefined —— 探活不戴工牌')
check(probeBlock.length === 1 && /探活/.test(readText('deck/src/host/repoKeys.js').slice(0, readText('deck/src/host/repoKeys.js').indexOf("'gh', '--version'") + 400)), '探活那处的理由写在源码里（不是漏写）')
const runGhBlock = inFile('deck/src/host/repoKeys.js').filter((b) => b.text.includes("identityEnvFor('gh'"))
check(runGhBlock.length === 1, "gh 主干出口戴着 gh 组（identityEnvFor('gh', args)）")
const execBlock = inFile('deck/src/host/repoKeys.js').filter((b) => b.text.includes('identityEnvFor(xpProg'))
check(execBlock.length === 1, '通用出口按程序名与子命令查表（identityEnvFor(xpProg, xpArgs)）')
check(inFile('deck/src/host/platformChannel.js')[0].text.includes('identityEnvFor(cmdBase'), '隧道出口按程序名与子命令查表')
check(inFile('deck/src/host/versionControl.js')[0].text.includes('opts.env'), 'git 出口沿用既有的 opts.env 透传口（不另起一套）')
check(readText('deck/src/host/gitCredentialExec.js').includes("identityEnvFor('git'"), 'git 写那一族把工牌合在非交互底座上（identityEnvFor(\'git\', args, …)）')

const deckCode = deckFiles.map((f) => stripComments(readText(f))).join('\n')
check(!/hosts\.yml/.test(deckCode), 'Deck 源码里没有任何一处读 hosts.yml（值只能经消费面来）')
check(!/github-resident\.json/.test(deckCode), '也没有自己去读插件的 state（那是 Resident 的真源）')
check(!/GH_TOKEN\s*[:=]/.test(deckCode), '没有自己拼 GH_TOKEN 的地方（token 只从服务位那一支来）')
const childIdentitySrc = stripComments(readText('deck/src/shared/child-identity.js'))
check(!/process\.env|node:fs|require\(/.test(childIdentitySrc), '规则表自己不读任何配置（不碰 process.env、不碰 fs）')

const idxSrc = readText('deck/src/host/index.js')
check(idxSrc.includes("ctx.get('ghResolver')"), 'index.js 是服务位的唯一取用点')
check(idxSrc.includes("import('../shared/child-identity.js')"), 'index.js 经 shared/child-identity.js 取身份环境（唯一入口）')
check((idxSrc.match(/identityEnvFor: identityEnvFor/g) || []).length === 3, '三个出口都拿到了同一个 identityEnvFor（实得 ' + (idxSrc.match(/identityEnvFor: identityEnvFor/g) || []).length + ' 个）')

// ---------------------------------------------------------------------------
section('2) 规则表：谁戴哪一组（纯函数，直接测）')

const ciMod = await importRel('deck/src/shared/child-identity.js')
const group = ciMod.identityGroupFor
check(typeof group === 'function', 'identityGroupFor 导出来了')
check(group('gh', ['api', 'user']) === 'gh', 'gh api user → gh 组（以身份做事）')
check(group('/opt/gh/bin/gh', ['issue', 'list']) === 'gh', '带路径的 gh 也认（按基名）')
check(group('gh', ['--version']) === null, 'gh --version → 不戴（探活）')
check(group('gh.exe', ['--version']) === null, 'Windows 的 gh.exe 同样认得出探活')
check(group('git', ['commit', '-m', 'x']) === 'git', 'git commit → git 组（要 user.name/email）')
check(group('/usr/bin/git', ['push', 'origin', 'main']) === 'git', 'git push → git 组（要凭据）')
check(group('git', ['--no-optional-locks', '--literal-pathspecs', '-c', 'push.default=nothing', 'push', 'origin']) === 'git', '固定前缀在子命令之前也认得出')
check(group('git', ['-C', '/tmp/ws', 'commit', '-m', 'x']) === 'git', '-C 之后的子命令也认得出')
check(group('git', ['status', '--porcelain=v2']) === null, 'git status → 不戴（读数）')
check(group('git', ['config', '--get', 'credential.helper']) === null, 'git config --get → 不戴（问盘上的：戴上会把宿主那条读成我们的助手）')
check(group('glab', ['auth', 'status']) === null, 'glab → 不戴（另一个站点，与 GitHub 身份无关）')
check(group('', []) === null && group('sh', ['-c', 'true']) === null, '别的命令一律不戴')

// ---------------------------------------------------------------------------
section('3) 三个执行出口：真的把对应那一组交给了 spawn')

const stubLogDir = tmpDir('deck-ci-stub')
const h = home('deck-ci', {
  withGh: true,
  // 桩的两本账落到 HOME 之外的临时目录：否则本用例自己的日志会被第 6 节的「不多出文件 / token 不落在盘上」
  //   判据抓到 —— 那两条要证明的是**插件**没往宿主写东西，不是用例自己不写。
  gh: { log: join(stubLogDir, 'gh-argv.log'), envLog: join(stubLogDir, 'gh-env.log'), recordEnv: ['GH_TOKEN', 'GIT_CONFIG_COUNT', 'GH_PROMPT_DISABLED'] },
  files: {
    '.dsh/github-resident.json': JSON.stringify({ token: TOKEN, login: LOGIN, user_email: LOGIN + '@users.noreply.github.com' }),
    // 宿主「配过但过期」的样子：这三份是**边界证人** —— 跑完必须逐字节未变（第 7 节）。
    '.config/gh/hosts.yml': HOSTS_STALE,
    '.gitconfig': GITCONFIG_STALE,
    '.git-credentials': CREDS_STALE,
  },
})
const homeListingBefore = listingOf(h.home)

/** 假 subprocess：只记 env，不起进程（真进程那一段在 6 节）。 */
function makeSubprocess(stdoutFor) {
  const calls = []
  return {
    calls,
    spawn(opts) {
      calls.push({ argv: (opts.argv || []).slice(), cwd: opts.cwd, env: opts.env, hasEnvKey: Object.prototype.hasOwnProperty.call(opts, 'env') })
      const text = stdoutFor ? String(stdoutFor(opts) || '') : ''
      return {
        done: Promise.resolve({ exitCode: 0 }),
        collected: { stdout: { readFrom: () => ({ text }) }, stderr: { readFrom: () => ({ text: '' }) } },
        terminate: () => {},
      }
    },
  }
}
const neverTimer = { timeout: () => new Promise(() => {}) }

let asked = 0
let svcResolve = null
let svcGhEnv = null
let svcGitEnv = null
let ghEnvOnRunGh = null
let ghEnvOnExecProc = null
let ghEnvOnTunnel = null
let gitEnvOnExecProc = null
let probeEnv = 'missing'
let gitStatusEnv = 'missing'
let gitCommitEnv = null
let ghStubEnvSeen = null

await withPlugin(h.home, { path: h.pathWithReal, dataDir: join(h.home, '.dsh', 'gh-cli') }, async ({ provided }) => {
  const svc = provided.ghResolver
  check(!!svc && typeof svc.identityEnv === 'function', '消费面的服务位在（产出侧那一支已就位）')
  const surface = {
    resolve: () => svc.resolve(),
    identityEnv: async (o) => { asked += 1; return await svc.identityEnv(o) },
  }
  const counted = ciMod.createChildIdentity({ getService: () => surface })
  const envFor = (program, args, base) => counted.envFor(program, args, base)
  svcResolve = await svc.resolve()
  svcGhEnv = (await svc.identityEnv({ groups: ['gh'] })).gh
  svcGitEnv = (await svc.identityEnv({ groups: ['git'] })).git

  // ---- gh 主干出口（runGh）----
  const sub = makeSubprocess()
  const repoMod = await importRel('deck/src/host/repoKeys.js')
  const rk = repoMod.createRepoKeys({
    subprocess: sub, timer: neverTimer, fs: null, DEFAULT_CWD: '/tmp/ws', TIMEOUT_MS: 30000,
    identityEnvFor: envFor, repoKeys: {}, repoRoots: {},
    getGhPath: () => '/fixture/bin/gh', setGhPath: () => {}, getGhLastError: () => null, setGhLastError: () => {},
    getPlatform: async () => ({ resolveExecutable: async () => null }),
    getWorkspaceStore: async () => ({ get: () => null, set: () => {}, has: () => false, clear: () => {}, invalidate: () => {} }),
    setCache: () => {}, clearWorkspaceStore: () => {}, namingSweepSoon: () => {}, getChainBackoff: async () => null,
    parseGithubRepo: () => null, logCtx: null, gate: null, getGate: () => null,
  })
  const rGh = await rk.runGh(['api', 'user', '-q', '.login'], '/tmp/ws')
  check(rGh.ok === true && sub.calls.length === 1, 'gh 主干出口真的起了一次（实起 ' + sub.calls.length + '）')
  ghEnvOnRunGh = sub.calls[0] && sub.calls[0].env
  check(!!ghEnvOnRunGh && ghEnvOnRunGh.GH_TOKEN === TOKEN, 'gh 主干出口戴的是 gh 组：GH_TOKEN 到了 spawn（实得 ' + String(ghEnvOnRunGh && ghEnvOnRunGh.GH_TOKEN && '有') + '）')
  check(!!ghEnvOnRunGh && !('GIT_CONFIG_COUNT' in ghEnvOnRunGh), '两个方向之一：gh 子进程**拿不到** git 组')
  check(!!ghEnvOnRunGh && Object.keys(ghEnvOnRunGh).sort().join(',') === Object.keys(svcGhEnv).sort().join(','), '交给 spawn 的就是服务位那一组本身（键集逐项相同，不是 PATH/HOME 的快照）')

  // ---- 探活：gh --version 不戴 ----
  const subProbe = makeSubprocess((opts) => (opts.argv[1] === '--version' ? 'gh version 9.9.9 (PROBE)\n' : 'ok'))
  const rkProbe = repoMod.createRepoKeys({
    subprocess: subProbe, timer: neverTimer, fs: null, DEFAULT_CWD: '/tmp/ws', TIMEOUT_MS: 30000,
    identityEnvFor: envFor, repoKeys: {}, repoRoots: {},
    getGhPath: () => null, setGhPath: () => {}, getGhLastError: () => 'gh 不可用', setGhLastError: () => {},
    getPlatform: async () => ({ resolveExecutable: async () => null }),
    getWorkspaceStore: async () => ({ get: () => null, set: () => {}, has: () => false, clear: () => {}, invalidate: () => {} }),
    setCache: () => {}, clearWorkspaceStore: () => {}, namingSweepSoon: () => {}, getChainBackoff: async () => null,
    parseGithubRepo: () => null, logCtx: null, gate: null, getGate: () => null,
  })
  await rkProbe.runGh(['api', 'user'], '/tmp/ws')
  const probeCall = subProbe.calls.find((c) => c.argv[1] === '--version')
  check(!!probeCall, '解析不到路径时先起了探活（gh --version）')
  probeEnv = probeCall ? probeCall.env : 'missing'
  check(probeCall && probeCall.hasEnvKey && probeCall.env === undefined, '探活**不带** env（显式 undefined，不是漏写）')
  const realCall = subProbe.calls.find((c) => c.argv[1] === 'api')
  check(!!realCall && !!realCall.env && realCall.env.GH_TOKEN === TOKEN, '探活之后那一条真命令照样戴上（探活把自己摘出去，不影响别人）')

  // ---- 通用出口（execProc）：gh / git / glab 三条 ----
  const subX = makeSubprocess()
  const rkX = repoMod.createRepoKeys({
    subprocess: subX, timer: neverTimer, fs: null, DEFAULT_CWD: '/tmp/ws', TIMEOUT_MS: 30000,
    identityEnvFor: envFor, repoKeys: {}, repoRoots: {},
    getGhPath: () => '/fixture/bin/gh', setGhPath: () => {}, getGhLastError: () => null, setGhLastError: () => {},
    getPlatform: async () => ({ resolveExecutable: async () => null }),
    getWorkspaceStore: async () => ({ get: () => null, set: () => {}, has: () => false, clear: () => {}, invalidate: () => {} }),
    setCache: () => {}, clearWorkspaceStore: () => {}, namingSweepSoon: () => {}, getChainBackoff: async () => null,
    parseGithubRepo: () => null, logCtx: null, gate: null, getGate: () => null,
  })
  await rkX.execProc(['/fixture/bin/gh', 'api', 'user'], '/tmp/ws', 'test')
  ghEnvOnExecProc = subX.calls[0] && subX.calls[0].env
  await rkX.execProc(['/fixture/bin/git', '-C', '/tmp/ws', 'commit', '-m', 'x'], '/tmp/ws', 'test')
  gitEnvOnExecProc = subX.calls[1] && subX.calls[1].env
  await rkX.execProc(['/fixture/bin/git', 'remote', 'get-url', 'origin'], '/tmp/ws', 'test')
  gitStatusEnv = subX.calls[2] && subX.calls[2].env
  await rkX.execProc(['/fixture/bin/glab', 'auth', 'status'], '/tmp/ws', 'test')
  const glabEnv = subX.calls[3] && subX.calls[3].env
  check(!!ghEnvOnExecProc && ghEnvOnExecProc.GH_TOKEN === TOKEN && !('GIT_CONFIG_COUNT' in ghEnvOnExecProc), '通用出口里的 gh：戴 gh 组、不混 git 组')
  check(!!gitEnvOnExecProc && Number(gitEnvOnExecProc.GIT_CONFIG_COUNT) === 4 && !('GH_TOKEN' in gitEnvOnExecProc), '通用出口里的 git commit：戴 git 组（GIT_CONFIG_COUNT=' + String(gitEnvOnExecProc && gitEnvOnExecProc.GIT_CONFIG_COUNT) + '）、**拿不到 GH_TOKEN**（两个方向之二）')
  check(gitStatusEnv === undefined, '通用出口里的 git 读数（remote get-url）：不戴（问盘上的不戴）')
  check(glabEnv === undefined, '通用出口里的 glab：不戴（不是我们的身份）')

  // ---- 隧道出口（detectionExec）----
  const platChMod = await importRel('deck/src/host/platformChannel.js')
  const chCalls = []
  const subCh = {
    spawn(opts) {
      chCalls.push({ argv: (opts.argv || []).slice(), env: opts.env })
      return {
        done: Promise.resolve({ exitCode: 0 }),
        collected: { stdout: { readFrom: () => ({ text: '[]' }) }, stderr: { readFrom: () => ({ text: '' }) } },
        terminate: () => {},
      }
    },
  }
  const fakeCtx = { get: (k) => (k === 'trackerRegistry' ? { select: async () => null, modules: () => [] } : undefined), set: () => {} }
  const pc = platChMod.createPlatformChannel({
    ctx: fakeCtx, subprocess: subCh, timer: neverTimer, fs: null, DEFAULT_CWD: '/tmp/ws', TIMEOUT_MS: 30000,
    ghResolver: () => '/fixture/bin/gh', identityEnvFor: envFor,
    getMattSkillProbeNames: async () => [], getChainSkillNames: async () => [], probeSkill: async () => ({}),
    getChoiceStore: () => null, logCtx: null, getGate: () => null,
  })
  await pc.detectionExec('gh', ['api', 'user'], { cwd: '/tmp/ws' }, 'test')
  ghEnvOnTunnel = chCalls[0] && chCalls[0].env
  await pc.detectionExec('glab', ['auth', 'status'], { cwd: '/tmp/ws' }, 'test')
  const tunnelGlabEnv = chCalls[1] && chCalls[1].env
  check(!!ghEnvOnTunnel && ghEnvOnTunnel.GH_TOKEN === TOKEN, '隧道出口（操作上下文的 exec）里的 gh：戴 gh 组')
  check(!!ghEnvOnTunnel && !('GIT_CONFIG_COUNT' in ghEnvOnTunnel), '隧道出口里的 gh 也不混 git 组')
  check(tunnelGlabEnv === undefined, '隧道出口里的 glab：不戴')

  // ---- git 写出口（safeGit：提交/推送那一族）----
  const gitCredMod = await importRel('deck/src/host/gitCredentialExec.js')
  const seen = []
  const fakeRunGit = async (exe, dir, args, opts) => {
    seen.push({ exe, dir, args: args.slice(), env: opts && opts.env })
    return { kind: 'ok', stdout: '', truncated: false }
  }
  const sg = gitCredMod.createCredentialSafeGit({
    runGit: fakeRunGit, getPlatform: async () => ({ resolveExecutable: async () => '/fixture/bin/git' }),
    getEnv: () => undefined, DEFAULT_CWD: '/tmp/ws', identityEnvFor: envFor,
  })
  await sg.startCall({ totalBudgetMs: 60000 }).run({ args: ['commit', '-m', 'x'], cwd: '/tmp/ws' })
  gitCommitEnv = seen[0] && seen[0].env
  check(!!gitCommitEnv && Number(gitCommitEnv.GIT_CONFIG_COUNT) === 4, 'git 写出口（commit）：戴上 git 组（注入身份与凭据助手；GIT_CONFIG_COUNT=' + String(gitCommitEnv && gitCommitEnv.GIT_CONFIG_COUNT) + '）')
  check(!!gitCommitEnv && !('GH_TOKEN' in gitCommitEnv), 'git 子进程里**没有** GH_TOKEN（token 不进 git 的环境：同屋共享的 commit hook 也读不到）')
  check(!!gitCommitEnv && gitCommitEnv.GIT_TERMINAL_PROMPT === '0', 'git 写出口的非交互口径还在（底座没被工牌挤掉）')
  check(!!gitCommitEnv && 'GIT_ASKPASS' in gitCommitEnv && gitCommitEnv.GIT_ASKPASS === undefined, '底座的墓碑（GIT_ASKPASS: undefined）原样保留')
  await sg.startCall({ totalBudgetMs: 60000 }).run({ args: ['status', '--porcelain=v2'], cwd: '/tmp/ws' })
  const statusEnv = seen[1] && seen[1].env
  check(!!statusEnv && !('GIT_CONFIG_COUNT' in statusEnv), '同一个出口上的只读命令（status）：不戴 git 组（读数不戴）')

  asked = 0
  await rk.runGh(['api', 'user'], '/tmp/ws')
  await rk.runGh(['api', 'user'], '/tmp/ws')
  check(asked >= 2, '不缓存：两次执行 → 消费面被问了 ' + asked + ' 次（每次现算，Deck 侧不存副本）')

  // 夹具 gh 桩：把入口记下的那份 env 真的交给桩，看桩自己记的 env 账。
  const stubRun = spawnSync(join(h.bin, 'gh'), ['api', 'user', '-q', '.login'], { env: { ...process.env, ...liveEnvOf(ghEnvOnRunGh) }, encoding: 'utf8' })
  check(stubRun.status === 0, '夹具 gh 桩用那份 env 跑起来了（退出码 ' + stubRun.status + '）')
  const seenByStub = readGhEnv(h.ghEnvLog)
  ghStubEnvSeen = seenByStub.length ? seenByStub[seenByStub.length - 1] : null
  check(!!ghStubEnvSeen && ghStubEnvSeen.GH_TOKEN === TOKEN, '桩自己记的 env 里看得到 GH_TOKEN（子进程边界上的证据）')
  check(!!ghStubEnvSeen && ghStubEnvSeen.GIT_CONFIG_COUNT === '<unset>', '桩自己记的 env 里没有 git 组（到进程边界上仍不混）')
})

// ---------------------------------------------------------------------------
section('4) 两半答案一致：同一份答案，且没有第二套解析')

check(!!svcResolve, 'Resident 半边给出了「gh 在哪」（' + String(svcResolve) + '）')
let svcAnswer = svcResolve    // 可切换：用来演「解析落空」那一路
let bootstrapped = 0
const hostCtx = {
  get: (k) => (k === 'ghResolver' ? {
    resolve: async () => svcAnswer,
    bootstrap: () => { bootstrapped += 1; return { started: true } },
    identityEnv: async (o) => ({ gh: svcGhEnv, git: svcGitEnv, ...o && {} }),
  } : undefined),
}
// 与 deck/src/host/index.js 里那张「晚绑定取值口」同形。2026-10-15 起它还差一件事：
//   解析落空**不是终局** —— 顺手催一次消费面的 bootstrap（非阻塞），这一次仍如实回 null。
//   本机现场就是缺这一支：加载期落地失败 → Deck 永久判死 → 面板只回"先跑 gh_cli_install"。
const deckResolver = async function () {
  let svc = null
  try { svc = hostCtx.get('ghResolver') } catch (eSvc) { svc = null }
  if (!svc || typeof svc.resolve !== 'function') return null
  let hit = null
  try { hit = await svc.resolve() } catch (eR) { hit = null }
  if (hit) return hit
  try { if (typeof svc.bootstrap === 'function') svc.bootstrap() } catch (eB) {}
  return null
}
const platMod = await importRel('deck/src/host/platform/index.js')
const plat = await platMod.composePlatform({ get: () => undefined }, 'linux', () => ({
  os: 'linux', pathImpl: nodePath, getHome: async () => '/tmp',
  resolveExecutable: async () => { throw new Error('不该问底座：消费面必须回答') },
}), { ghResolver: deckResolver })
const deckSays = await plat.resolveExecutable('gh')
check(deckSays === svcResolve, '两半对「gh 在哪」给同一个答案（Resident ' + String(svcResolve) + ' / Deck ' + String(deckSays) + '）')

// 解析落空那一路：催一次 bootstrap、**不阻塞**、这一次仍如实回 null；催过之后拿得到就回路径。
svcAnswer = null
const miss1 = await deckResolver()
check(miss1 === null, '解析落空时这一次如实回 null（不等下载）', miss1)
check(bootstrapped === 1, '解析落空时恰好催了一次消费面 bootstrap（实得 ' + bootstrapped + '）')
svcAnswer = svcResolve
const back = await deckResolver()
check(back === svcResolve && bootstrapped === 1, '催过之后下一次解析直接拿到路径，不再催（实得 ' + bootstrapped + '）', back)

const deckEnvFor = ciMod.createChildIdentity({ getService: () => hostCtx.get('ghResolver') })
const deckGh = await deckEnvFor.envFor('gh', ['api', 'user'])
check(JSON.stringify(deckGh) === JSON.stringify(svcGhEnv), '两半对「用谁的身份」给同一个答案（Deck 拿到的就是服务位那一组）')
const deckGit = await deckEnvFor.envFor('git', ['push', 'origin', 'main'])
check(JSON.stringify(deckGit) === JSON.stringify(svcGitEnv), 'git 那一组同理')

const noSurface = ciMod.createChildIdentity({ getService: () => null })
check(await noSurface.envFor('gh', ['api', 'user']) === undefined, '没有服务位时不戴，也**不回落第二套解析**（回 undefined）')
const baseProbe = { KEEP: '1' }
check((await noSurface.envFor('git', ['commit'], baseProbe)) === baseProbe, '没有服务位时底座原样返回（不凭空造环境）')
const emptySurface = ciMod.createChildIdentity({ getService: () => ({ identityEnv: async () => ({ gh: {}, git: {} }) }) })
check(await emptySurface.envFor('gh', ['api', 'user']) === undefined, '服务位答"这一组是空的"时也不戴（宁可什么都不给，也不给假环境）')
const throwing = ciMod.createChildIdentity({ getService: () => { throw new Error('resident 还没起来') } })
check(await throwing.envFor('gh', ['api', 'user'], baseProbe) === baseProbe, '服务位取用抛错时如实回底座（不把调用炸掉）')

// ---------------------------------------------------------------------------
section('5) 端到端：把那份 env 交给真 git（全局配置指向不存在也照样干活）')

const globalCfgMissing = join(h.home, 'no-such-gitconfig')
const gitBaseEnv = { ...process.env, HOME: h.home, PATH: h.pathWithReal + ':' + dirname(process.execPath), GIT_CONFIG_GLOBAL: globalCfgMissing }
const commitEnv = { ...gitBaseEnv, ...liveEnvOf(gitCommitEnv) }
const repoDir = tmpDir('deck-ci-repo')
if (!REAL.git) {
  skip('这台机器没有真 git（夹具给的是 exit 127 的桩）—— 端到端那一段跳过，其余判据照跑')
} else {
  // 每一条都用 spawnSync（不抛）：门禁要把失败**报出来**，而不是自己炸掉、后面的判据一条不跑。
  const gitIn = (args, extra) => spawnSync(REAL.git, args, Object.assign({ cwd: repoDir, env: commitEnv, encoding: 'utf8' }, extra || {}))
  const init = gitIn(['init', '-q', '-b', 'main'])
  check(init.status === 0, '在临时仓库里 init 成功（实得 ' + init.status + '）')
  writeFileSync(join(repoDir, 'a.txt'), 'hello\n')
  gitIn(['add', 'a.txt'])
  const commit = gitIn(['commit', '-m', 'first'])
  check(commit.status === 0, '提交成功（宿主没有全局 git 配置，身份全靠注入；' + String(commit.stderr || '').split('\n')[0] + '）')
  const who = String(gitIn(['log', '-1', '--format=%an|%ae']).stdout || '').trim()
  check(who === LOGIN + '|' + LOGIN + '@users.noreply.github.com', '提交身份 = 消费面给的那一个（实得 ' + who + '）')
  const cfgName = gitIn(['config', '--get', 'user.name'])
  check(String(cfgName.stdout || '').trim() === LOGIN, '身份来自**注入的那份 env**：`git config --get user.name` 答的就是注入值')
  const repoCfg = readFileSync(join(repoDir, '.git', 'config'), 'utf8')
  check(!/user/i.test(repoCfg) && !exists(globalCfgMissing), '盘上没写一个字：仓库配置里没有 user.*、全局那份配置压根没被创建')
  const fill = gitIn(['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n' })
  const fillOut = String(fill.stdout || '')
  check(/^username=deck-tester$/m.test(fillOut), '凭据助手被调用并答对：username = 插件身份（实得 ' + (fillOut.match(/^username=.*$/m) || ['(无)'])[0] + '）')
  check(/^password=/m.test(fillOut) && fillOut.includes('password=' + TOKEN), '凭据是插件真源里那一份（助手现读 state 回答，不是第二份存储）')
}
check(!!ghStubEnvSeen, '第 3 节的 gh 桩 env 账读回来了（端到端那半有据可依）')

// ---------------------------------------------------------------------------
section('6) 不落盘到宿主：宿主那三份文件逐字节未变、不多出文件、token 不落在盘上')

check(readFileSync(join(h.home, '.config', 'gh', 'hosts.yml'), 'utf8') === HOSTS_STALE, '宿主 hosts.yml 逐字节未变（只读边界）')
check(readFileSync(join(h.home, '.gitconfig'), 'utf8') === GITCONFIG_STALE, '宿主全局 gitconfig 逐字节未变（不写宿主配置）')
check(readFileSync(join(h.home, '.git-credentials'), 'utf8') === CREDS_STALE, '宿主 ~/.git-credentials 逐字节未变（不写第二份凭据）')
const after = listingOf(h.home)
check(after.names === homeListingBefore.names, 'HOME 顶层没多出文件（跑前 ' + homeListingBefore.names + ' / 跑后 ' + after.names + '）')
const helper = join(h.home, '.dsh', 'github-resident', 'runtime', 'git-credential-helper')
if (exists(helper)) {
  check(!readFileSync(helper, 'utf8').includes(TOKEN), '插件自有目录里落的助手文件不含 token 原文（它是读 state 回答的脚本，不是凭据副本）')
  note('助手落在插件自己的运行期目录（与接线目录分开，Q8=(ii) 的口径）')
} else {
  note('这一轮没有落助手文件（服务位那一支按需才落）—— 上面的判据不依赖它')
}
const offenders = filesUnder(h.home).filter((p) => !p.endsWith('github-resident.json') && readFileSync(p, 'utf8').includes(TOKEN))
check(offenders.length === 0, 'HOME 里除真源 state 外没有第二处出现 token 原文（实得 ' + offenders.length + ' 处）')

// ---------------------------------------------------------------------------
note('本用例覆盖：静态红灯（每个 spawn 显式 env / 无第二套配置读取路径）、规则表、三个出口的戴与不戴、'
  + '两组不混（两个方向 + 进程边界）、不缓存（调用计数）、两半答案一致（含无服务位时不回落）、'
  + '真 git 端到端（提交身份 + 凭据助手）、宿主三份文件逐字节未变。')
note('没覆盖（写清楚，不假装）：真 GitHub / 真网络；DSH 子进程服务「擦除后合并」那一步本身'
  + '（那是宿主契约，由 subprocess-env.test.mjs 实测钉着；本文件证明 Deck 交出去的就是那一组本身）。')

cleanup()
summary()
