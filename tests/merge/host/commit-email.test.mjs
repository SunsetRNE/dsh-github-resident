/**
 * tests/merge/host/commit-email.test.mjs —— 提交邮箱的**唯一来源**（票「登录后可选填提交邮箱（不填用隐私邮箱），
 * wire 优先用它」，2026-10-14）。
 *
 * 为什么需要它：这张票的起点是一次**真实的分叉**（不是设想）——同一份 state 下，插件启动的 git 子进程用
 * `state.user_email`，而 `wire` 写出去的全局 `user.email` 是硬编码的隐私邮箱。两条路各算一份，同一台机器
 * 出现两个提交身份；而且当时**没有任何路径**能把邮箱写进 state（登录工具收了 `user_email` 参数却不落盘），
 * 也就是说读到的那一支在生产里根本不可达。所以判据必须同时钉住四件事：
 *   ① **唯一口径**：读侧（子进程 git 组）与写侧（`wire` 的计划）在**任何** state 组合下都给同一个答案；
 *      并且那一处是唯一的算处（隐私邮箱字面量在 plugin.js 里只许出现一次）。
 *   ② **写侧真的用它**：`wire` 计划里的 `after` 就是它，落到假 HOME 的 `.gitconfig` 也是它；改了邮箱 →
 *      计划变 → **重新问一次同意**（沿用既有指纹机制，不新造）。
 *   ③ **能填**：`gh_identity {action:"email"}` 只写插件自己的 state（不用重填 token、不碰宿主 git 配置）；
 *      只读调用与坏值调用**逐字节不写**。
 *   ④ **只问一次**：登录成功后才问，可跳过；「填过」与「问过」都不再问 —— 跳过也不往宿主写任何东西。
 *
 * 隔离：全部在 `_env-harness` 的合成环境里跑（假 HOME + 夹具 bin）。登录那一段用**进程内 fetch 桩**接住
 * `https://api.github.com/user`，**不起真实外网请求**（这也把「回执里不许出现 token 原文」变成可判定）。
 * 用法：node tests/merge/host/commit-email.test.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { check, note, section, summary, readText } from './_check.mjs'
import { makeHome, withPlugin, sha256File } from './_env-harness.mjs'

const TOKEN_FAKE = 'gho_COMMITEMAIL_fixture_abcdefghijkl'
const LOGIN = 'octocat'
const CUSTOM = 'octo@real.example'
/** 回退值：由登录名生成的隐私邮箱形式（判据里要能一眼看出「这是回退」而不是「这是填的」）。 */
const FALLBACK = LOGIN + '@users.noreply.github.com'
const STATE_REL = '.dsh/github-resident.json'
const LEDGER_REL = '.dsh/github-resident/wire/ledger.json'

const readOrEmpty = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const shaOrAbsent = (p) => (existsSync(p) ? sha256File(p) : '(absent)')
const modeOf = (p) => { try { return '0' + (statSync(p).mode & 0o777).toString(8) } catch { return '(absent)' } }
const stateOf = (home) => JSON.parse(readOrEmpty(home + '/' + STATE_REL) || '{}')
const ledgerOf = (home) => JSON.parse(readOrEmpty(home + '/' + LEDGER_REL) || '{}')

/** 夹具里的 git 全局配置（**假 HOME**）：读文件、跑真 git，都只在夹具里。 */
const gitGet = (home, key) => {
  try {
    return execFileSync('git', ['config', '--global', '--get', key], { env: { ...process.env, HOME: home }, encoding: 'utf8' }).trim()
  } catch { return null }
}

/** 把 git 组那串 `GIT_CONFIG_KEY_n / VALUE_n` 还原成一张表。 */
const envPairs = (gitEnv) => {
  const out = {}
  const n = Number((gitEnv && gitEnv.GIT_CONFIG_COUNT) || 0)
  for (let i = 0; i < n; i += 1) out[gitEnv['GIT_CONFIG_KEY_' + i]] = gitEnv['GIT_CONFIG_VALUE_' + i]
  return out
}

/** 一个装好「真源身份」的夹具。 */
const fixture = (tag, state) => makeHome(tag, {
  withGh: true,
  withGit: true,
  files: { [STATE_REL]: JSON.stringify(state) },
})

// ===========================================================================
section('一、唯一口径：读侧（子进程 git 组）与写侧（wire 计划）必须给同一个答案')
// ===========================================================================

const COMBOS = [
  { tag: 'own-email', state: { token: TOKEN_FAKE, login: LOGIN, user_email: CUSTOM }, want: CUSTOM, why: 'state 里填过 → 用它' },
  { tag: 'no-email', state: { token: TOKEN_FAKE, login: LOGIN }, want: FALLBACK, why: '没填过 → 由登录名生成的隐私邮箱形式' },
  { tag: 'no-login-email', state: { token: TOKEN_FAKE, user_email: CUSTOM }, want: CUSTOM, why: '解析不出 login，但填过的邮箱照样戴得上' },
  { tag: 'no-login-no-email', state: { token: TOKEN_FAKE }, want: null, why: '两样都没有 → 这一项写不出来（不编值）' },
  { tag: 'empty-state', state: {}, want: null, why: '没有 state → 什么都没有' },
]

for (const c of COMBOS) {
  const h = fixture('ce-one-' + c.tag, c.state)
  await withPlugin(h.home, { path: h.path, dataDir: h.home + '/.dsh/gh-cli' }, async ({ tool, provided }) => {
    const gitEnv = (await provided.ghResolver.identityEnv()).git
    const readSide = envPairs(gitEnv)['user.email'] || null
    const ask = await tool('gh_identity').execute({ action: 'wire' }, {})
    const writeItem = (ask.plan || []).find((i) => i.key === 'user.email') || {}
    const writeSide = writeItem.after || null

    check(readSide === c.want,
      '[' + c.tag + '] 读侧 user.email = ' + JSON.stringify(c.want) + '（' + c.why + '；实得 ' + JSON.stringify(readSide) + '）')
    check(writeSide === c.want,
      '[' + c.tag + '] 写侧 wire 计划的 user.email = ' + JSON.stringify(c.want) + '（实得 ' + JSON.stringify(writeSide) + '）')
    check(readSide === writeSide,
      '[' + c.tag + '] 两侧**同一个答案**（2026-10-14 那次分叉就是这一条红）')
    check(writeItem.writable === Boolean(c.want),
      '[' + c.tag + '] writable 如实（' + Boolean(c.want) + '）——写不出来时不假装能写')
  })
  h.cleanup()
}

{
  const src = readText('plugin.js')
  const hits = (src.match(/@users\.noreply\.github\.com/g) || []).length
  check(hits === 1, '隐私邮箱字面量在 plugin.js 里只出现**一次**（唯一的算处；实得 ' + hits + ' 处 —— 多一处就是又分叉了）')
  check(src.includes('export function commitEmail'), '那一处是导出的 commitEmail()（别的半边与门禁都从它取，不另抄一份）')
  const askOf = (src.match(/export function emailQuestion/g) || []).length
  check(askOf === 1, '「要不要填」的文案也只有一处（' + askOf + ' 处）——问法与算法同源，别再各写一遍')
}

// ===========================================================================
section('二、wire：写侧真用填过的邮箱；改了邮箱 → 计划变 → 重新问一次同意')
// ===========================================================================

const hB = fixture('ce-wire-own', { token: TOKEN_FAKE, login: LOGIN, user_email: CUSTOM })
await withPlugin(hB.home, { path: hB.path, dataDir: hB.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  const w1 = await tool('gh_identity').execute({ action: 'wire' }, {})
  check(String(w1.ask && w1.ask.question).includes(CUSTOM),
    '同意框里给用户看的就是填过的那个值（不是隐私邮箱）')

  const done = await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
  check(done.ok === true && done.wrote === true, '带 consent 的 wire：ok=true、wrote=true')
  check(gitGet(hB.home, 'user.email') === CUSTOM, '假 HOME 的全局 user.email 落成填过的那个值')
  check(gitGet(hB.home, 'user.name') === LOGIN, 'user.name 仍是登录名（没被这次改动带偏）')

  const item = (ledgerOf(hB.home).items || []).find((i) => i.key === 'user.email')
  check(Boolean(item) && item.after === CUSTOM, '台账如实记下 after = 填过的邮箱（可对账、可撤）')

  // ---- 填一个新值：计划变了就该重新问 ----
  const set = await tool('gh_identity').execute({ action: 'email', email: 'new@real.example' }, {})
  check(set.ok === true && set.wrote === true && set.email === 'new@real.example', 'email 动作把新值写进 state')
  check(set.effective === 'new@real.example', '回执如实报「现在接线会用哪个」')

  const reAsk = await tool('gh_identity').execute({ action: 'wire' }, {})
  check(reAsk.consentRequired === true && reAsk.wrote === false, '计划变了 → 不带 consent 时重新问一次（wrote=false）')
  check((reAsk.plan || []).find((i) => i.key === 'user.email').after === 'new@real.example', '新计划里的 user.email 就是新值')
  check(gitGet(hB.home, 'user.email') === CUSTOM, '**问**同意的那一趟一个字节都没写（宿主里还是旧值）')

  const done2 = await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
  check(done2.wrote === true && gitGet(hB.home, 'user.email') === 'new@real.example', '同意之后才改成新值')
  const items = (ledgerOf(hB.home).items || []).filter((i) => i.key === 'user.email')
  check(items.length === 2 && items[0].after === CUSTOM && items[1].after === 'new@real.example',
    '台账逐次如实：旧值 → 新值都留着（不会被覆盖成一条）')
})
hB.cleanup()

// ===========================================================================
section('三、填写入口 gh_identity {action:"email"}：只写插件自己的 state，不用重填 token')
// ===========================================================================

const hC = fixture('ce-entry', { token: TOKEN_FAKE, login: LOGIN })
await withPlugin(hC.home, { path: hC.path, dataDir: hC.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  const gitBefore = shaOrAbsent(hC.home + '/.gitconfig')
  const r = await tool('gh_identity').execute({ action: 'email', email: '  me@real.example  ' }, {})
  check(r.ok === true && r.wrote === true && r.email === 'me@real.example', '不带 token 也能填，值被 trim（这就是「不用重填凭据」）')
  check(stateOf(hC.home).user_email === 'me@real.example', 'state 文件里真有这个字段（真源，不是第二份存储）')
  check(stateOf(hC.home).token === TOKEN_FAKE, '同一次改动没丢别的字段（token 还在）')
  check(modeOf(hC.home + '/' + STATE_REL) === '0600', 'state 仍是 0600')
  check(!JSON.stringify(r).includes(TOKEN_FAKE), '填写入口的回执里不出现 token 原文（邮箱可回显、token 一律掩码）')
  check(shaOrAbsent(hC.home + '/.gitconfig') === gitBefore, '填写入口**不碰宿主**（git 配置逐字节不变）')

  // ---- 不带 email = 只读地问「现在存的是什么」 ----
  const stateBefore = shaOrAbsent(hC.home + '/' + STATE_REL)
  const read = await tool('gh_identity').execute({ action: 'email' }, {})
  check(read.ok === true && read.wrote === false && read.email === 'me@real.example', '只读模式：报现在的值、wrote=false')
  check(read.effective === 'me@real.example', '只读模式也报「现在接线会用哪个」')
  check(shaOrAbsent(hC.home + '/' + STATE_REL) === stateBefore, '只读那一趟 state 逐字节不变')

  // ---- 坏值：拒绝得具体，且一个字节都不写 ----
  for (const bad of ['not-an-email', 'a b@c.com', 'x@y@z.com', 'a'.repeat(300) + '@x.com']) {
    const b = await tool('gh_identity').execute({ action: 'email', email: bad }, {})
    check(b.ok === false && typeof b.error === 'string' && b.error.length > 0,
      '坏值被拒且给出具体原因：' + JSON.stringify(bad.slice(0, 20)))
    check(b.email === 'me@real.example' && b.wrote === false, '坏值回执如实报「现在存的还是原来那个」、wrote=false')
  }
  check(shaOrAbsent(hC.home + '/' + STATE_REL) === stateBefore, '坏值一个字节都没写（state 逐字节不变）')
  check(shaOrAbsent(hC.home + '/.gitconfig') === gitBefore, '坏值也没碰宿主（git 配置逐字节不变）')
})
hC.cleanup()

// ===========================================================================
section('四、登录后问一次：可跳过；「填过」与「问过」都不再问')
// ===========================================================================

/**
 * 进程内 fetch 桩：把 `api()` 那次 `/user` 接住。
 * 用桩而不是真网的两个理由：门禁必须离线可跑；「回执里不许出现 token 原文」要有可判定的边界
 * （真网下这条只能靠断言的运气）。
 */
const stubApiFetch = (calls) => {
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' })
    return new Response(JSON.stringify({ login: LOGIN, name: 'Octo Cat' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  return () => { globalThis.fetch = real }
}

const hD = makeHome('ce-login-ask', { withGh: true, withGit: true })
await withPlugin(hD.home, { path: hD.path, dataDir: hD.home + '/.dsh/gh-cli' }, async ({ tool }) => {
  const calls = []
  const restore = stubApiFetch(calls)
  try {
    const r1 = await tool('gh_resident_login').execute({ token: TOKEN_FAKE, user_login: LOGIN }, {})
    check(r1.ok === true, '登录成功（本地桩接住了 /user，没打真网）')
    check(calls.length === 1 && calls[0].url === 'https://api.github.com/user',
      '只打了一次 /user（实得 ' + JSON.stringify(calls) + '）')

    check(Boolean(r1.ask) && typeof r1.ask.question === 'string', '首次登录：回执里带**一次**询问')
    check(String(r1.ask.question).includes(FALLBACK), '问的时候如实写出「不填会用哪个值」')
    check(String(r1.ask.onAgree).includes('action:"email"'), '同意的出路指向唯一的填写入口')
    check(String(r1.ask.onDecline).includes('不写') || String(r1.ask.onDecline).includes('不会'), '跳过的出路如实说「什么都不写」')
    check(r1.email === FALLBACK, '回执如实报「现在接线会用哪个」')
    check(!JSON.stringify(r1).includes(TOKEN_FAKE), '登录回执里不出现 token 原文')

    const st1 = stateOf(hD.home)
    check(typeof st1.emailAskedAt === 'string' && st1.emailAskedAt.length > 0, '「问过」这笔落在 state 里（可查）')
    check(!('user_email' in st1), '问一次**不写邮箱**：不填就不是一个值')
    check(gitGet(hD.home, 'user.email') === null && gitGet(hD.home, 'user.name') === null,
      '问一次不把邮箱/名字写到宿主 git 配置上（登录工具原有的直写行为没被这次改动牵动）')

    const r2 = await tool('gh_resident_login').execute({ token: TOKEN_FAKE, user_login: LOGIN }, {})
    check(r2.ask === null, '第二次登录**不再问**（跳过就是跳过，不反复弹）')
    check(!('user_email' in stateOf(hD.home)), '第二次也没写邮箱')

    const set = await tool('gh_identity').execute({ action: 'email', email: CUSTOM }, {})
    check(set.ok === true && set.wrote === true, '用户填了（走唯一的填写入口）')

    const r3 = await tool('gh_resident_login').execute({ token: TOKEN_FAKE, user_login: LOGIN }, {})
    check(r3.ask === null, '填过之后**不再问**（比「问过一次」更强的那条要求）')
    check(r3.email === CUSTOM, '回执报的就是填过的那个值')

    const wire = await tool('gh_identity').execute({ action: 'wire' }, {})
    check((wire.plan || []).find((i) => i.key === 'user.email').after === CUSTOM,
      '登录 + 填写之后，接线计划里就是那个值（整条路闭环）')
  } finally {
    restore()
  }
})
hD.cleanup()

// ===========================================================================
section('五、邮箱随 state 一起走（登出路径删的就是这份文件）')
// ===========================================================================

{
  // 不用真跑销毁：那条路里带着「卸系统 gh / 删 hosts 配置」这类宿主级动作，门禁不该碰它。
  // 判据取**同源事实**：邮箱与 token 在同一份 state 文件里（上面已证），而登出路径删的正是那份文件。
  const src = readText('plugin.js')
  check(src.includes('await fs.rm(STATE_FILE, { force: true })'), '销毁路径删的就是 STATE_FILE（邮箱与 token 一起走，不留半份）')
  const hE = fixture('ce-logout-shape', { token: TOKEN_FAKE, login: LOGIN, user_email: CUSTOM })
  const st = stateOf(hE.home)
  check(st.token === TOKEN_FAKE && st.user_email === CUSTOM && Object.keys(st).length >= 2,
    '邮箱与 token 确实在同一份 state 里（不是第二份存储 → 也就没有第二处要清理）')
  hE.cleanup()
  note('登出后邮箱消失这条走的是「同一份 state + 销毁路径删它」的同源判据，没有真跑 gh_cli_logout（那条路带宿主级动作）')
}

summary()
