/**
 * tests/merge/host/identity-audit.test.mjs —— `gh_identity` 只读体检：四个消费点的结论 + 补救命令 + 不泄漏 + 只读。
 *
 * 为什么需要它（2026-10-14，票「新工具 gh_identity（只读体检 + 准确补救命令）」）：
 * 在本票之前，问「我的身份接好了没」要人肉拼 `gh_resident_status` + `gh_cli_status` + `gh_cli_resolve`，
 * 拼完仍答不出四问：git helper 接了没（全局为空 vs host 作用域有值，谁对？）、子进程环境有没有 token、
 * PATH 落点算不算接好、缺什么补什么命令。本用例把「体检该给出的结论」按形状钉死。
 *
 * 判据（对抗式，逐条可证伪）：
 *   ① 三个合成环境下，四个消费点（git / gh-cli / env / path）各给出 pass·drift·missing 之一的**结论**，
 *      并附判定依据字段 —— 不许以「不明」收场；
 *   ② 形状统一：point = {point,state,verdict,checks}，check = {name,state,detail,fix}；
 *   ③ 每个非 pass 的 check 都带一条可复制的补救命令，pass 的 fix 必须是 null（不塞废话）；
 *   ④ `summary` 的计数与 points 一致，`fixes` = 所有非空 fix（含配置面的 reposRoot 缺口）去重；
 *   ⑤ 不泄漏：整份回执搜不到 token 原文与中段；
 *   ⑥ 只读：跑完一圈后 hosts.yml / state / git 配置逐字节未变，HOME 里不多出文件；
 *   ⑦ 不联网：源码级断言 gh_identity 那段既不调 `api(`，也不跑 `gh auth status`（那次会打网）；
 *      并且它确实复用身份接缝（`resolveIdentity(` / `maskIdentity(`），没有另写一套。
 *
 * 隔离：自造假 HOME + 假 PATH + `GIT_CONFIG_GLOBAL` 指向临时 gitconfig（**绝不碰真全局配置**）；
 * 不起网络、不读真实 HOME。三个环境各用一个模块实例（HOME 是加载期求值的）。
 * 用法：node tests/merge/host/identity-audit.test.mjs
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { check, note, section, summary, readText, tmpDir, REPO_ROOT } from './_check.mjs'

const PLUGIN_URL = pathToFileURL(join(REPO_ROOT, 'plugin.js')).href
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const STATES = ['pass', 'drift', 'missing']

const TOKEN_FAKE = 'gho_AUDITFIXTURE_abcdefghijklmnop'
const HOSTS_FIXTURE = [
  'github.com:',
  '    users:',
  '        SunsetRNE:',
  '            oauth_token: ' + TOKEN_FAKE,
  '    git_protocol: https',
  '    oauth_token: ' + TOKEN_FAKE,
  '    user: SunsetRNE',
  '',
].join('\n')

/** 造一个假 HOME，返回 { home, bin }：bin 里放一个「能跑」的 gh 占位（打印版本）。 */
function fakeHome(tag, { withGhStub = false, files = {} } = {}) {
  const home = tmpDir('idaudit-' + tag)
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(home, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body, { mode: 0o600 })
  }
  if (withGhStub) {
    const bin = join(home, '.fakebin')
    mkdirSync(bin, { recursive: true })
    const stub = join(bin, 'gh')
    writeFileSync(stub, '#!/bin/sh\necho "gh version 9.9.9 (AUDIT-STUB)"\n', { mode: 0o755 })
    chmodSync(stub, 0o755)
  }
  return home
}

/**
 * 在指定环境下**跑一次**体检：环境（HOME / PATH / GIT_CONFIG_GLOBAL / GH_TOKEN）在执行期生效。
 *
 * 为什么要这样（2026-10-14 本用例第一版踩的坑）：只在 `import` 之前设、`finally` 里就恢复，
 * 会让工具执行时读回真环境 —— 那时体检报的是「真全局配置 + 真 gh」，夹具形同虚设，
 * 于是 B/C 两个场景静默失真（被本用例自己抓出来）。
 */
async function withScenario(home, opts, fn) {
  const saved = { home: process.env.HOME, path: process.env.PATH, gc: process.env.GIT_CONFIG_GLOBAL, gh: process.env.GH_TOKEN, gt: process.env.GITHUB_TOKEN }
  process.env.HOME = home
  if (opts.path !== undefined) process.env.PATH = opts.path
  if (opts.gitConfig !== undefined) process.env.GIT_CONFIG_GLOBAL = opts.gitConfig
  else delete process.env.GIT_CONFIG_GLOBAL
  delete process.env.GH_TOKEN
  delete process.env.GITHUB_TOKEN
  for (const [k, v] of Object.entries(opts.env || {})) process.env[k] = v
  try {
    const mod = await import(PLUGIN_URL + '?audit=' + encodeURIComponent(home))
    const tools = new Map()
    mod.apply({ tools: { register: (t) => tools.set(t.name, t) }, provide: () => {}, effect: () => {} })
    return await fn(tools.get('gh_identity'))
  } finally {
    if (saved.home === undefined) delete process.env.HOME; else process.env.HOME = saved.home
    if (saved.path === undefined) delete process.env.PATH; else process.env.PATH = saved.path
    if (saved.gc === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.gc
    if (saved.gh === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = saved.gh
    if (saved.gt === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = saved.gt
  }
}

const pointOf = (r, name) => (r.points || []).find((p) => p.point === name)
const checkOf = (p, name) => (p && p.checks || []).find((c) => c.name === name)

// ================================================================ 环境 A：gh CLI 有身份，其余没接
section('环境 A：gh CLI 有身份；全局 git 身份空、无 helper、无 env、reposRoot 指向不存在目录')
const homeA = fakeHome('a', { withGhStub: true, files: { '.config/gh/hosts.yml': HOSTS_FIXTURE } })
const gitCfgA = join(homeA, 'gitconfig-a')
// 环境 A 刻意复刻真机的形状：**只有 host 作用域**那条凭据助手（gh 的 setup-git 就写这里）、
// 全局 credential.helper 为空、全局 git 身份没设。
writeFileSync(gitCfgA, [
  '[credential "https://github.com"]',
  '\thelper = !' + join(homeA, '.fakebin', 'gh') + ' auth git-credential',
  '',
].join('\n'), { mode: 0o600 })
const optsA = { path: join(homeA, '.fakebin') + ':' + process.env.PATH, gitConfig: gitCfgA }
const rA = await withScenario(homeA, optsA, (tool) => tool.execute({}, {}))
const auditA = { execute: () => withScenario(homeA, optsA, (tool) => tool.execute({}, {})) }

check(rA.identity.source === 'gh-cli:~/.config/gh/hosts.yml', 'A 身份来源 = gh-cli（实得 ' + rA.identity.source + '）')
check(rA.identity.login === 'SunsetRNE' && rA.identity.present === true, 'A 身份带 login 与 present')
check((rA.points || []).length === 4, 'A 四个消费点都在（实得 ' + (rA.points || []).length + '）')
check((rA.points || []).every((p) => STATES.includes(p.state)), 'A 每个消费点都给了 pass/drift/missing 结论')
check((rA.points || []).every((p) => typeof p.verdict === 'string' && p.verdict.length > 0), 'A 每个消费点都有人话结论（不许「不明」收场）')
check(pointOf(rA, 'git').state === 'drift', 'A git 消费点 = drift（助手接了、身份没设）')
check(checkOf(pointOf(rA, 'git'), 'credential-helper').state === 'pass', 'A 凭据助手单点 = pass（host 作用域有值）')
check(checkOf(pointOf(rA, 'git'), 'credential-helper').detail.global === null, 'A detail 如实报「全局为空」')
check(checkOf(pointOf(rA, 'git'), 'credential-helper').detail.hostScope.indexOf('auth git-credential') > 0, 'A detail 报出 host 作用域那条')
check(checkOf(pointOf(rA, 'git'), 'identity').state === 'missing', 'A 全局 git 身份 = missing')
check(checkOf(pointOf(rA, 'git'), 'identity').fix.indexOf('git config --global user.name') === 0, 'A 身份补救命令是可直接复制的 git config')
check(pointOf(rA, 'gh-cli').state === 'pass', 'A gh CLI 消费点 = pass')
check(pointOf(rA, 'env').state === 'missing' && pointOf(rA, 'env').verdict.indexOf('不是必须') > 0, 'A env 消费点 = missing，且结论写明「不是必须」')
check(pointOf(rA, 'path').state === 'pass', 'A PATH 落点 = pass（假 gh 能跑）')

// ================================================================ 环境 B：全部接好
section('环境 B：四个消费点全接好')
const homeB = fakeHome('b', { withGhStub: true, files: { '.config/gh/hosts.yml': HOSTS_FIXTURE } })
mkdirSync(join(homeB, 'GitHub'), { recursive: true })   // 默认 reposRoot 也要存在，才是真的「全绿」
const gitCfgB = join(homeB, 'gitconfig-b')
writeFileSync(gitCfgB, [
  '[user]',
  '\tname = Fixture User',
  '\temail = fixture@example.invalid',
  '[credential "https://github.com"]',
  '\thelper = !' + join(homeB, '.fakebin', 'gh') + ' auth git-credential',
  '',
].join('\n'), { mode: 0o600 })
const rB = await withScenario(homeB, {
  path: join(homeB, '.fakebin') + ':' + process.env.PATH,
  gitConfig: gitCfgB,
  env: { GH_TOKEN: 'gho_ENV_OVERRIDE_0123456789abcdef' },
}, (tool) => tool.execute({}, {}))
check(pointOf(rB, 'git').state === 'pass', 'B git 消费点 = pass（助手可跑 + 身份已设）')
check(checkOf(pointOf(rB, 'git'), 'credential-helper').detail.hostHelperRunnable === true, 'B 助手指向的 gh 真跑得起来（不是只看字符串）')
check(pointOf(rB, 'gh-cli').state === 'pass' && pointOf(rB, 'env').state === 'pass' && pointOf(rB, 'path').state === 'pass', 'B 其余三个消费点都 pass')
check(rB.summary.pass === 4 && rB.summary.drift === 0 && rB.summary.missing === 0, 'B summary 计数 = 4/0/0')
check(rB.summary.fixes.length === 0, 'B 全 pass 时不给任何补救命令（不塞废话）')

// ================================================================ 环境 C：什么都没有
section('环境 C：什么都没有（无 gh、无 hosts、无 state、无 env、无 PATH）')
const homeC = fakeHome('c', {})
const rC = await withScenario(homeC, { path: join(homeC, '.emptypath'), gitConfig: join(homeC, 'gitconfig-c') }, (tool) => tool.execute({}, {}))
check(rC.identity.source === '(none)', 'C 身份来源 = (none)（不编造）')
check(pointOf(rC, 'git').state === 'missing', 'C git 消费点 = missing')
check(pointOf(rC, 'gh-cli').state === 'missing', 'C gh CLI 消费点 = missing')
check(pointOf(rC, 'path').state === 'missing', 'C PATH 落点 = missing')
check(pointOf(rC, 'path').checks[0].fix.indexOf('gh_cli_install') >= 0, 'C 缺 gh 时给出的补救命令指向本插件工具')

// ================================================================ 形状与摘要（统一判据）
section('形状与摘要：三个环境统一适用')
for (const [label, r] of [['A', rA], ['B', rB], ['C', rC]]) {
  const points = r.points || []
  const shapeOk = points.every((p) => typeof p.point === 'string' && STATES.includes(p.state)
    && typeof p.verdict === 'string' && Array.isArray(p.checks) && p.checks.length > 0
    && p.checks.every((c) => typeof c.name === 'string' && STATES.includes(c.state) && typeof c.detail === 'object' && (c.fix === null || typeof c.fix === 'string')))
  check(shapeOk, label + ' 形状统一（point/state/verdict/checks + check/name/state/detail/fix）')
  const nonPass = points.flatMap((p) => p.checks).filter((c) => c.state !== 'pass')
  const passWithFix = points.flatMap((p) => p.checks).filter((c) => c.state === 'pass' && c.fix !== null)
  check(nonPass.every((c) => typeof c.fix === 'string' && c.fix.length > 0), label + ' 每个非 pass 的 check 都带补救命令')
  check(passWithFix.length === 0, label + ' pass 的 check 不带 fix')
  const expected = points.filter((p) => p.state === 'pass').length
  check(r.summary.pass === expected, label + ' summary.pass 与 points 一致')
  const allFixes = [...new Set([...points.flatMap((p) => p.checks).map((c) => c.fix), r.config.reposRoot.fix].filter(Boolean))]
  check(JSON.stringify(r.summary.fixes) === JSON.stringify(allFixes), label + ' summary.fixes = 全部非空 fix（含配置面）去重')
  check(typeof r.config.reposRoot.exists === 'boolean' && r.config.stateFile.path && r.config.hostsFile.path, label + ' 配置面三段都在')
  check(r.config.reposRoot.exists ? r.config.reposRoot.fix === null : typeof r.config.reposRoot.fix === 'string', label + ' reposRoot 不存在时必须给补救说明')
}

// ================================================================ 不泄漏 + 只读
section('不泄漏与只读（用环境 A 的夹具，含真 token 的 hosts.yml）')
const dump = JSON.stringify(rA) + JSON.stringify(rB) + JSON.stringify(rC)
check(dump.indexOf(TOKEN_FAKE) < 0, '整份回执没有 token 原文')
check(dump.indexOf(TOKEN_FAKE.slice(4, -4)) < 0, '整份回执没有 token 中段')
check(dump.indexOf('gho_…') > 0, '回执里出的是掩码（可辨认，不可用）')

const hostsPathA = join(homeA, '.config/gh/hosts.yml')
const before = { hosts: sha(hostsPathA), gitcfg: sha(gitCfgA), listing: readdirSync(homeA).sort().join(',') }
await auditA.execute({}, {})
await auditA.execute({}, {})
const after = { hosts: sha(hostsPathA), gitcfg: sha(gitCfgA), listing: readdirSync(homeA).sort().join(',') }
check(before.hosts === after.hosts, 'hosts.yml 逐字节未变')
check(before.gitcfg === after.gitcfg, 'git 配置逐字节未变（体检不写配置）')
check(before.listing === after.listing, 'HOME 里没有多出文件（不落盘）')

// ================================================================ 不联网 + 复用接缝（源码级）
section('不联网与复用接缝（源码这一格写的是什么）')
const src = readText('plugin.js')
const start = src.indexOf("toolName: 'gh_identity'")
const end = src.indexOf("toolName: 'gh_protocol'")
const block = (start >= 0 && end > start) ? src.slice(start, end) : ''
check(block.length > 0, 'gh_identity 的注册段定位到了')
check(block.indexOf('api(') < 0, '体检段不调 api(（REST 会打网）')
// 判据按**调用形态**走：要跑 `gh auth status` 必然出现 'status' 这个参数，或者 run( 里带 'auth'。
// （第一版直接搜字面 'auth status'，把我自己注释里那句「不调 gh auth status」也算成了调用 —— 假红。）
check(block.indexOf("'status'") < 0 && !/run\([^)]*'auth'/.test(block), '体检段不跑 gh auth status（那次会打网）')
check(block.indexOf('resolveIdentity(') > 0 && block.indexOf('maskIdentity(') > 0 && block.indexOf('readHostsEntry(') > 0, '体检段复用三支身份接缝（没另写一套）')
const protoRow = src.indexOf("{ name: 'gh_identity'")
check(protoRow > 0, '协议表里有 gh_identity 一行（工具面与协议同源）')
const protoLine = src.slice(protoRow, src.indexOf('\n', protoRow))
check(protoLine.indexOf("kind: 'read'") > 0 && protoLine.indexOf('required: []') > 0, '协议行声明为只读、无必填参数')

note('夹具用 GIT_CONFIG_GLOBAL 指向临时 gitconfig：git config --global 的读写都落在临时文件，绝不碰真全局配置。')
note('本用例覆盖的形状（identity/points/config/summary）按票面约定同时服务《启动自述》与协议 identity 段，改字段属接口变更。')

for (const d of [homeA, homeB, homeC]) {
  try { rmSync(d, { recursive: true, force: true }) } catch { /* tmpDir 退出时兜底 */ }
}

summary()
