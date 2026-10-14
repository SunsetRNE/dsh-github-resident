/**
 * tests/merge/host/identity-wire.test.mjs —— `gh_identity` 的写半边：wire / verify / unwire。
 *
 * 为什么需要它（2026-10-14，票「gh_identity {wire|verify|unwire}：投影接线 + 对账 + 可撤」）：
 * 这是本仓**第一次真正改宿主全局状态**的动作（以前只有登记库写自己的目录）。三件事必须有机器判据，
 * 否则「幂等」「可对账」「可撤」都只是文案：
 *   ① 默认动作（audit）与三个动作**没拿到同意时**，一个字节都不许写；
 *   ② 写了什么、写的时候是什么、什么时候写的，必须落在台账里 —— verify 才有得对；
 *   ③ unwire 要**逐项**回到接线前，而且**只撤现在仍是我们写的值**（强度见 ⑨：先归一化再比对）：被别人改过的不动（不拿旧值盖新值）。
 *
 * 判据（对抗式，逐条可证伪）：
 *   ① audit：回执形状不变，跑完 .gitconfig / hosts.yml / state **逐字节未变**、HOME 不多文件；
 *   ② wire 无 consent：不写一个字节，只回 `{consentRequired:true, ask}`，ask 里逐项是**具体值**的 before → after；
 *   ③ wire 有 consent：**host 作用域**的 helper 指到插件自有助手（不再依赖 gh 绝对路径）、全局身份写上、台账 0600、
 *      助手文件 0755 —— 且这些写入**只落在夹具的假 HOME 里**；
 *   ④ 幂等：连跑两次，第二次 `wrote:false`、台账不新增、两次 `plan` 一致；
 *   ⑤ verify：逐项给「现在的值 / 本插件写入的值 / 写入时间 / **还算不算我们写的**」—— 按**归属口径**
 *      （票 41 已裁：与 unwire 同一支判定，只报不做）：`state` 四词 ours / not-ours / back-to-before / unknown，
 *      首尾空白/引号不算差异且 `note` 点出，逐字值仍并排报出；台账态另在 `retired` 一列（已撤销的项也照判盘上那一问）；
 *   ⑥ unwire：无 consent 不写；有 consent 后逐项还原（原本为空的**删键**），被别人改过的那项**跳过**并说明；
 *   ⑦ PATH 落点：**只在 PATH 上没有能跑的 gh 时**才落软链；已有系统 gh 时什么都不做；
 *   ⑧ 不泄漏：token 原文不出现在任何回执、台账、助手文件、gitconfig 里；hosts.yml 全程逐字节未变。
 *   ⑨ 撤销判定**先归一化再比对**（2026-10-14 的裁决口径；票《unwire 的「先归一化再比对」补实施（票 19 已裁未做）》）：
 *     三种结果各有判据 —— 只差首尾空白/引号 → 撤（`revoked`）；归一化后确实不同 → 放手（`abandoned`）；
 *     判不出来（同一项被写成多行 / 已经回到接线前的样子）→ 跳过，且**一个字节都不写、台账也不下结论**。
 *     最狠的一条：同一项被写成多行、而**最后一行恰好等于我们写的值**时，老写法会 `--unset-all` 把别人的行一起抹掉。
 *   ⑩ verify 的**读**（票 41 的四条验收判据）：只差首尾空白/引号 → `ours` ＋ note 点出；
 *     同一项多行 → `unknown` ＋ `ours:null` ＋ `now` 放读到的全部行；git 读失败（退出码非 0/1）→ `unknown`（未知不当成没有）；
 *     PATH 落点不是软链 → `unknown`；已撤销／已放手的项也照判盘上那一问（`retired` 与 `state` 两列各说一件事）。
 *
 * 隔离：全部在 `_env-harness` 的合成环境里跑（假 HOME + 夹具 bin），**不碰真 HOME、不起网络**。
 * 用法：node tests/merge/host/identity-wire.test.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { check, note, section, summary } from './_check.mjs'
import { makeHome, withPlugin, listingOf, sha256File } from './_env-harness.mjs'

const TOKEN_FAKE = 'gho_WIREFIXTURE_abcdefghijklmnop'
const STATE_FIXTURE = JSON.stringify({ token: TOKEN_FAKE, login: 'octocat', updatedAt: '2026-10-14T00:00:00.000Z' })
const HELPER_REL = '.dsh/github-resident/wire/git-credential-helper'
const LEDGER_REL = '.dsh/github-resident/wire/ledger.json'

/** 该文件的 sha256；不存在回 '(absent)' —— 「一个字节都没写」就是靠这个比出来的。 */
const shaOrAbsent = (p) => (existsSync(p) ? sha256File(p) : '(absent)')
const modeOf = (p) => {
  try { return '0' + (statSync(p).mode & 0o777).toString(8) } catch { return '(absent)' }
}
const readOrEmpty = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const readJsonOr = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fallback } }

/** 夹具里的 git 全局配置（**假 HOME**）：读文件，不跑 git；需要手改时再用 git 写。 */
const gitConfigText = (home) => readOrEmpty(home + '/.gitconfig')
const gitSet = (home, key, value) => execFileSync('git', ['config', '--global', '--replace-all', key, value], {
  env: { ...process.env, HOME: home }, encoding: 'utf8',
})
const gitGet = (home, key) => {
  try {
    return execFileSync('git', ['config', '--global', '--get', key], { env: { ...process.env, HOME: home }, encoding: 'utf8' }).trim()
  } catch { return null }
}
/** 一个键**读出来的所有行**（`--get-all`）：用来证明「多行项撤销时没把别人的行一起抹掉」。 */
const gitGetAll = (home, key) => {
  try {
    return execFileSync('git', ['config', '--global', '--get-all', key], { env: { ...process.env, HOME: home }, encoding: 'utf8' }).trim()
  } catch { return null }
}

/** 一个装好「真源身份」的夹具：state 里有 token + login。 */
const fixture = (tag, opts = {}) => makeHome(tag, {
  withGh: opts.withGh !== false,
  withGit: opts.withGit !== false,
  files: { '.dsh/github-resident.json': STATE_FIXTURE, ...(opts.files || {}) },
})

// ===========================================================================
section('一、默认动作（audit）与「没同意就不写」：一个字节都不许写')
// ===========================================================================
const hA = fixture('wire-a')
try {
  await withPlugin(hA.home, { path: hA.path, dataDir: hA.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    const before = {
      gitcfg: shaOrAbsent(hA.home + '/.gitconfig'),
      hosts: shaOrAbsent(hA.home + '/.config/gh/hosts.yml'),
      state: shaOrAbsent(hA.home + '/.dsh/github-resident.json'),
      home: listingOf(hA.home).names,
    }
    const audit = await tool('gh_identity').execute({}, {})
    check(JSON.stringify(Object.keys(audit).filter((k) => k !== 'ok' && k !== 'protocol').sort())
      === JSON.stringify(['config', 'identity', 'points', 'summary']),
      '默认动作回执形状不变（identity / points / config / summary）')

    const wireAsk = await tool('gh_identity').execute({ action: 'wire' }, {})
    check(wireAsk.ok === false && wireAsk.consentRequired === true && wireAsk.wrote === false,
      'wire 无 consent：ok=false、consentRequired=true、wrote=false')
    const wireAskFields = Object.keys(wireAsk).filter((k) => k !== 'ok' && k !== 'protocol').sort()
    check(JSON.stringify(wireAskFields) === JSON.stringify(['action', 'ask', 'consent', 'consentRequired', 'ledger', 'plan', 'results', 'wrote']),
      'wire 无 consent 的回执键 == 协议里声明的 wire 视图（' + wireAskFields.join(',') + '）')
    const plan = wireAsk.plan || []
    const helperItem = plan.find((i) => i.point === 'git-helper')
    const nameItem = plan.find((i) => i.key === 'user.name')
    check(Boolean(helperItem && helperItem.before === null && String(helperItem.after).startsWith('!')),
      'ask 的 plan 里给出具体值：helper 从「未设置」到「!<插件自有助手>」（' + (helperItem && helperItem.after) + '）')
    check(Boolean(nameItem && nameItem.after === 'octocat'),
      'ask 的 plan 里给出具体值：user.name → octocat')
    check(String(wireAsk.ask && wireAsk.ask.question).includes('octocat') && String(wireAsk.ask && wireAsk.ask.question).includes('git-credential-helper'),
      'ask.question 把要改的具体值原样列出来（模型可照读给用户）')
    check(String(wireAsk.ask && wireAsk.ask.onAgree).includes('consent:true'),
      'ask 里给了「同意后怎么调」的准确写法（onAgree）')

    const unwireAsk = await tool('gh_identity').execute({ action: 'unwire' }, {})
    check(unwireAsk.consentRequired !== true, 'unwire 在台账为空时不需要同意（没有可撤的东西，也就没有写）')

    check(shaOrAbsent(hA.home + '/.gitconfig') === before.gitcfg, 'git 配置逐字节未变（audit + 两次无 consent 调用之后）')
    check(shaOrAbsent(hA.home + '/.config/gh/hosts.yml') === before.hosts, 'hosts.yml 逐字节未变')
    check(shaOrAbsent(hA.home + '/.dsh/github-resident.json') === before.state, 'state 逐字节未变（没同意就不动真源）')
    check(listingOf(hA.home).names === before.home, 'HOME 里没多出文件（无 consent 时连助手文件都不落）')
    check(!existsSync(hA.home + '/' + HELPER_REL), '助手文件没有被写出来')
  })
} finally { hA.cleanup() }

// ===========================================================================
section('二、wire：有同意后写对、可重复（幂等）')
// ===========================================================================
const hB = fixture('wire-b')
try {
  await withPlugin(hB.home, { path: hB.path, dataDir: hB.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    const w1 = await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    check(w1.ok === true && w1.wrote === true, 'wire 有 consent：ok=true、wrote=true')
    check(w1.consent && w1.consent.grantedBy === 'call', '回执写明这次授权来自本次调用（grantedBy=call）')
    const helperAbs = hB.home + '/' + HELPER_REL
    check(existsSync(helperAbs) && modeOf(helperAbs) === '0755', '插件自有助手落盘且 0755（' + modeOf(helperAbs) + '）')
    check(gitGet(hB.home, 'credential.https://github.com.helper') === '!' + helperAbs,
      'host 作用域的 helper 指到插件自有助手（不看 gh 的绝对路径）')
    check(!String(gitConfigText(hB.home)).includes('/usr/'), 'gitconfig 里没有系统 gh 的路径（不再依赖它）')
    check(gitGet(hB.home, 'user.name') === 'octocat', '全局 user.name 写成解析出的 login')
    check(gitGet(hB.home, 'user.email') === 'octocat@users.noreply.github.com',
      '全局 user.email 写成 GitHub 的 noreply 形式（state 里没有 email）')
    const ledgerRaw = readOrEmpty(hB.home + '/' + LEDGER_REL)
    check(modeOf(hB.home + '/' + LEDGER_REL) === '0600', '台账落盘且 0600（' + modeOf(hB.home + '/' + LEDGER_REL) + '）')
    const ledger = readJsonOr(hB.home + '/' + LEDGER_REL, { items: [] })
    check(ledger.items.length === 3 && ledger.items.every((i) => i.before === null && i.after && i.at && i.writer === 'gh_identity.wire'),
      '台账逐项记了 before / after / at / writer（' + ledger.items.length + ' 项）')
    check(!ledgerRaw.includes(TOKEN_FAKE) && !readOrEmpty(helperAbs).includes(TOKEN_FAKE) && !gitConfigText(hB.home).includes(TOKEN_FAKE),
      'token 原文不进台账、不进助手文件、不进 gitconfig')
    check(JSON.stringify(w1).includes(TOKEN_FAKE) === false, '回执里搜不到 token 原文')
    check(helperAbs.startsWith(hB.home + '/') && String(w1.ledger.file).startsWith(hB.home + '/'),
      '助手与台账都落在**夹具 HOME 之内**（没写到夹具外面去）')

    const l1 = ledger.items.length
    const w2 = await tool('gh_identity').execute({ action: 'wire' }, {})
    check(w2.ok === true && w2.wrote === false && w2.consentRequired === false,
      '第二次 wire：wrote=false、不再问同意（已经是目标值）')
    const targets = (r) => JSON.stringify((r.plan || []).map((i) => [i.point, i.key, i.after]).sort())
    check(targets(w2) === targets(w1), '两次 wire 的**目标值**一致（只差 before —— 世界变了，意图没变）')
    check((w2.plan || []).every((i) => i.changed !== true), '第二次 wire 没有任何要改的项（空操作）')
    check(readJsonOr(hB.home + '/' + LEDGER_REL, { items: [] }).items.length === l1, '第二次 wire 不往台账里新增行')
  })
} finally { hB.cleanup() }

// ===========================================================================
section('三、verify：现在的值 / 本插件写入的值 / 写入时间 / 还算不算我们写的（票 41 的归属词表）')
// ===========================================================================
const hC = fixture('wire-c')
try {
  await withPlugin(hC.home, { path: hC.path, dataDir: hC.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    const v0 = await tool('gh_identity').execute({ action: 'verify' }, {})
    const keys0 = Object.keys(v0).filter((k) => k !== 'ok' && k !== 'protocol').sort()
    check(JSON.stringify(keys0) === JSON.stringify(['action', 'disk', 'items', 'ledger', 'notes', 'summary']),
      'verify 的回执键 == 协议里声明的 verify 视图（' + keys0.join(',') + '）')
    check(v0.items.length === 0 && v0.notes.some((n) => n.includes('台账还是空的')),
      '还没接线时 verify 如实说「台账是空的」，不假装对过账')
    check(v0.notes.some((n) => n.includes('不注入子进程环境')) && v0.notes.some((n) => n.includes('不搬迁 state')),
      'verify 如实报「不注入子进程环境 / 不搬迁 state」两条边界')

    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    const v1 = await tool('gh_identity').execute({ action: 'verify' }, {})
    check(v1.summary.ours === 3 && v1.summary.notOurs === 0 && v1.summary.unknown === 0 && v1.summary.backToBefore === 0,
      '刚接完：三项都算 ours（票 41 的四词表；' + JSON.stringify(v1.summary) + '）')
    check(v1.items.every((i) => i.state === 'ours' && i.ours === true && i.retired === null),
      '每项 state=ours、ours=true、retired=null（盘上归属与台账态分两列）')

    gitSet(hC.home, 'credential.https://github.com.helper', '!echo hand-edited')
    const v2 = await tool('gh_identity').execute({ action: 'verify' }, {})
    const drifted = v2.items.filter((i) => i.state === 'not-ours')
    check(v2.summary.notOurs === 1 && drifted.length === 1,
      '手改一处后：如实报一项 not-ours（' + JSON.stringify(v2.summary) + '）')
    const item = drifted[0]
    check(item.now === '!echo hand-edited', '报「现在是什么值」（' + item.now + '）')
    check(String(item.written).startsWith('!') && item.written !== item.now, '报「本插件写的是什么值」')
    check(typeof item.writtenAt === 'string' && item.writtenAt.length >= 20, '报「本插件什么时候写的」（' + item.writtenAt + '）')
    check(item.ours === false && String(item.note).includes('不是本插件写的'), '明确说「这个值不是本插件改的」（不猜是谁）')
    check(item.writer === 'gh_identity.wire', '报「写入者」（' + item.writer + '）')

    // 已撤销的项**也照判盘上那一问**（票 41 已裁）：台账态进 `retired` 列，`state` 仍说盘上归属。
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    check(u.wrote === true, '前置：先撤一次（能撤的两项还原；上面手改过的那项判放手）')
    const v3 = await tool('gh_identity').execute({ action: 'verify' }, {})
    const retiredOf = (k) => (v3.items.find((i) => i.key === k) || {}).retired
    check(retiredOf('user.name') === 'revoked' && retiredOf('user.email') === 'revoked'
      && retiredOf('credential.https://github.com.helper') === 'abandoned',
      'retired 列如实分开两种台账态（实得 ' + JSON.stringify([
        retiredOf('user.name'), retiredOf('user.email'), retiredOf('credential.https://github.com.helper'),
      ]) + '）')
    check(v3.summary.backToBefore === 2 && v3.summary.notOurs === 1 && v3.summary.unknown === 0,
      '已撤销的项照判盘上那一问：两项 back-to-before、一项仍是别人的值 not-ours（' + JSON.stringify(v3.summary) + '）')
    check(v3.items.filter((i) => i.state === 'back-to-before').every((i) => i.ours === null && String(i.note).includes('接线前')),
      'back-to-before 的项：ours=null，note 点出「已回到接线前的样子」')
  })
} finally { hC.cleanup() }

// ===========================================================================
section('四、unwire：逐项还原；被别人改过的不动')
// ===========================================================================
const hD = fixture('wire-d')
try {
  await withPlugin(hD.home, { path: hD.path, dataDir: hD.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    const cfgBefore = shaOrAbsent(hD.home + '/.gitconfig')
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    gitSet(hD.home, 'user.name', 'someone-else')

    const askReceipt = await tool('gh_identity').execute({ action: 'unwire' }, {})
    check(askReceipt.consentRequired === true && askReceipt.wrote === false,
      'unwire 无 consent：只说要撤什么，不写一个字节')
    const askKeys = Object.keys(askReceipt).filter((k) => k !== 'ok' && k !== 'protocol').sort()
    check(JSON.stringify(askKeys) === JSON.stringify(['action', 'ask', 'consent', 'consentRequired', 'ledger', 'results', 'wrote']),
      'unwire 无 consent 的回执键 == 协议里声明的 unwire 视图（' + askKeys.join(',') + '）')

    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    check(u.ok === true && u.wrote === true, 'unwire 有 consent：执行了还原')
    const byKey = Object.fromEntries(u.results.map((r) => [r.key, r]))
    check(byKey['user.name'] && byKey['user.name'].skipped === true && String(byKey['user.name'].why).includes('被别人改过'),
      '被别人改过的项（user.name）跳过，并说明为什么不动它')
    check(byKey['user.email'] && byKey['user.email'].ok === true, '没被动过的项正常还原（user.email）')
    check(gitGet(hD.home, 'user.name') === 'someone-else', '用户自己改的值还在（没被我们盖掉）')
    check(gitGet(hD.home, 'user.name') !== null && gitGet(hD.home, 'user.email') === null,
      '原本为空的项被**删键**（user.email 回到不存在，而不是留一个空串）')
    check(u.results.every((r) => typeof r.ok === 'boolean'), '逐项回执带 ok（不是只回一个总的 ok）')

    const ledger = readJsonOr(hD.home + '/' + LEDGER_REL, { items: [] })
    const revoked = ledger.items.filter((i) => i.revokedAt)
    check(revoked.length === 2 && revoked.every((i) => i.revokedBy === 'gh_identity.unwire'),
      '撤掉的两项在台账里标记为已撤（保留历史，' + revoked.length + ' 项）')
    check(readJsonOr(hD.home + '/' + LEDGER_REL, { items: [] }).items.length === 3, '台账不删行（历史留着）')
    check(cfgBefore === '(absent)', '前置：接线前假 HOME 里本来没有 .gitconfig')

    // 再撤一次：没有可撤的项了，不该再问同意
    const u2 = await tool('gh_identity').execute({ action: 'unwire' }, {})
    check(u2.consentRequired === false && u2.wrote === false, '第二次 unwire：没有可撤的项，不问同意也不写')
  })
} finally { hD.cleanup() }

// ===========================================================================
section('五、PATH 落点：只在 PATH 上没有能跑的 gh 时才落')
// ===========================================================================
const hE = fixture('wire-e', { withGh: false })
mkdirSync(hE.home + '/.dsh/gh-cli/bin', { recursive: true })
writeFileSync(hE.home + '/.dsh/gh-cli/bin/gh', '#!/bin/sh\necho "gh version 9.9.9 (CACHE-STUB)"\n', { mode: 0o755 })
try {
  await withPlugin(hE.home, { path: hE.path, dataDir: hE.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    const w = await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    const landing = (w.plan || []).find((i) => i.point === 'path-landing')
    check(Boolean(landing && landing.writable === true && String(landing.after).includes('.dsh/gh-cli/bin/gh')),
      'PATH 上没有 gh 时：计划里出现「把自带 gh 软链上去」（' + (landing && landing.key) + '）')
    check(existsSync(hE.bin + '/gh') && readlinkSync(hE.bin + '/gh').includes('.dsh/gh-cli/bin/gh'),
      '软链真的落了，指向插件自带的那份')
    const v = await tool('gh_identity').execute({ action: 'verify' }, {})
    check(v.summary.ours === 4, 'verify 把这一项也算进 ours（四人项：' + JSON.stringify(v.summary) + '）')
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    check(u.results.some((r) => r.point === 'path-landing' && r.ok === true) && !existsSync(hE.bin + '/gh'),
      'unwire 把软链删掉（宿主回到接线前）')
  })
} finally { hE.cleanup() }

section('六、已有系统 gh 时：什么都不做，只如实报告')
const hF = fixture('wire-f')
try {
  await withPlugin(hF.home, { path: hF.path, dataDir: hF.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    const w = await tool('gh_identity').execute({ action: 'wire' }, {})
    const landing = (w.plan || []).find((i) => i.point === 'path-landing')
    check(Boolean(landing && landing.writable === false && String(landing.why).includes('已经有能跑的 gh')),
      'PARH 上已有能跑的 gh → 计划里标成写不了并说明「不抢系统的」')
    const w2 = await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    check(!((w2.results || []).some((r) => r.point === 'path-landing')), '因此这条也不会出现在写结果里')
    check(shaOrAbsent(hF.home + '/.config/gh/hosts.yml') === '(absent)', 'hosts.yml 从头到尾没被建出来（只读边界）')
  })
} finally { hF.cleanup() }

// ===========================================================================
section('七、撤销判定：先归一化再比对（票 36）—— 三种结果各一条判据')
// ===========================================================================
/** 台账里一项的两笔结论：有没有被撤、有没有被放手。 */
const marksOf = (home, key) => {
  const e = readJsonOr(home + '/' + LEDGER_REL, { items: [] }).items.find((i) => i.key === key) || {}
  return { revoked: Boolean(e.revokedAt), abandoned: Boolean(e.abandonedAt) }
}
const verdictOf = (u, key) => (u.results.find((r) => r.key === key) || {})

// ---- ① 只差首尾引号 / 空白 → 撤（老写法把这种当成「被别人改过」而记 abandoned）----
const hG = fixture('wire-g')
try {
  await withPlugin(hG.home, { path: hG.path, dataDir: hG.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    gitSet(hG.home, 'user.name', '"octocat"') // 用户手改：值只多了一对引号（git 把引号当值的一部分存下来）
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    const r = verdictOf(u, 'user.name')
    check(r.verdict === 'revoked' && r.ok === true && r.skipped === false,
      '只差首尾引号 → 判成 revoked（不再是 abandoned；实得 ' + JSON.stringify(r.verdict) + '）')
    check(r.now === '"octocat"' && String(r.why).includes('归一化'),
      '回执如实说清「现在是什么值」与「为什么仍算本插件写的」')
    check(gitGet(hG.home, 'user.name') === null, '撤回去了：原本为空的项被**删键**（不是留空串）')
    const m = marksOf(hG.home, 'user.name')
    check(m.revoked && !m.abandoned, '台账那项标 revoked、不再标 abandoned')
  })
} finally { hG.cleanup() }

// ---- ② 空白与引号叠在一起（`"  octocat  "`）→ 仍是我们写的值：钉住「反复剥」那一轮 ----
const hH = fixture('wire-h')
try {
  await withPlugin(hH.home, { path: hH.path, dataDir: hH.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    gitSet(hH.home, 'user.name', '"  octocat  "')
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    const r = verdictOf(u, 'user.name')
    check(r.verdict === 'revoked' && gitGet(hH.home, 'user.name') === null,
      '引号里还裹着首尾空白 → 归一化后仍相同，照样撤（实得 ' + JSON.stringify(r.verdict) + '）')
  })
} finally { hH.cleanup() }

// ---- ③ 归一化后确实不同 → 放手（abandoned），且不拿旧值盖新值 ----
const hI = fixture('wire-i')
try {
  await withPlugin(hI.home, { path: hI.path, dataDir: hI.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    gitSet(hI.home, 'user.name', 'someone-else')
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    const r = verdictOf(u, 'user.name')
    check(r.verdict === 'abandoned' && r.skipped === true && String(r.why).includes('不是本插件写的'),
      '真不同 → abandoned，并如实报「不是本插件写的」（实得 ' + JSON.stringify(r.verdict) + '）')
    check(gitGet(hI.home, 'user.name') === 'someone-else', '别人写的值原样留着（没被接线前的旧值盖掉）')
    const m = marksOf(hI.home, 'user.name')
    check(m.abandoned && !m.revoked, '台账那项标 abandoned')
  })
} finally { hI.cleanup() }

// ---- ④ 判不出来（多行）：同一项被写成多行，而**最后一行恰好等于我们写的值** ----
// 这一条同时是最狠的回归判据：老写法在这里会 `--unset-all`，把 `somebody-else` 那行一起抹掉。
const hJ = fixture('wire-j')
try {
  await withPlugin(hJ.home, { path: hJ.path, dataDir: hJ.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    gitSet(hJ.home, 'user.name', 'somebody-else')
    execFileSync('git', ['config', '--global', '--add', 'user.name', 'octocat'], { env: { ...process.env, HOME: hJ.home } })
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    const r = verdictOf(u, 'user.name')
    check(r.verdict === 'undecidable' && r.skipped === true && r.ok === false,
      '多行项 → 判不出来：跳过（实得 ' + JSON.stringify(r.verdict) + '）')
    check(gitGetAll(hJ.home, 'user.name') === 'somebody-else\noctocat',
      '别人的那一行**还在**（没有拿单值读法去整键撤销）')
    const m = marksOf(hJ.home, 'user.name')
    check(!m.revoked && !m.abandoned, '台账里也不下结论（既不记 revoked，也不猜成 abandoned）')
  })
} finally { hJ.cleanup() }

// ---- ⑤ 判不出来（又被改回原样）：接线前「不存在」→ 现在又「不存在」 ----
const hK = fixture('wire-k')
try {
  await withPlugin(hK.home, { path: hK.path, dataDir: hK.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    execFileSync('git', ['config', '--global', '--unset-all', 'user.name'], { env: { ...process.env, HOME: hK.home } })
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    const r = verdictOf(u, 'user.name')
    check(r.verdict === 'undecidable' && r.skipped === true && String(r.why).includes('接线前一样'),
      '值已经回到接线前的样子 → 判不出来，如实报（实得 ' + JSON.stringify(r.verdict) + '）')
    check(gitGet(hK.home, 'user.name') === null, '没被写（不硬撤，也不盖）')
    const m = marksOf(hK.home, 'user.name')
    check(!m.revoked && !m.abandoned, '台账里不下结论（「我们撤的」还是「别人改回来的」无从判断）')
    const u2 = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    check(verdictOf(u2, 'user.name').verdict === 'undecidable',
      '第二次 unwire 仍如实报出来（宁可反复报，也不替用户记一笔不实的账）')
  })
} finally { hK.cleanup() }

// ---- ⑥ 判不出来（PATH 落点被换成真实文件）：读不出归属，更不能去删它 ----
const hO = fixture('wire-o', { withGh: false })
mkdirSync(hO.home + '/.dsh/gh-cli/bin', { recursive: true })
writeFileSync(hO.home + '/.dsh/gh-cli/bin/gh', '#!/bin/sh\necho "gh version 9.9.9 (CACHE-STUB)"\n', { mode: 0o755 })
try {
  await withPlugin(hO.home, { path: hO.path, dataDir: hO.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    // 用户把那个软链换成了自己的真实文件
    rmSync(hO.bin + '/gh')
    writeFileSync(hO.bin + '/gh', '#!/bin/sh\necho mine\n', { mode: 0o755 })
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    const r = (u.results.find((x) => x.point === 'path-landing') || {})
    check(r.verdict === 'undecidable' && r.skipped === true,
      'PATH 落点被换成真实文件 → 判不出来：跳过（实得 ' + JSON.stringify(r.verdict) + '）')
    check(String(r.why).includes('不是软链'), '回执说清它看到的是什么（不是软链），不是笼统一句「判不出来」')
    check(existsSync(hO.bin + '/gh') && readFileSync(hO.bin + '/gh', 'utf8').includes('echo mine'),
      '用户那个真实文件**没被删**（不拿 readlink 的 null 去 rm）')
  })
} finally { hO.cleanup() }

// ---- ⑩ 归一化命中、而 `before` **非空**：写回的是台账里 `before` 的**原文**（归一化只用于判断，绝不拿去写） ----
const hS = fixture('wire-s', {
  files: {
    '.dsh/github-resident/wire/ledger.json': JSON.stringify({
      schema: 'dsh-github-resident/wire-ledger', schemaVersion: 1, updatedAt: '2026-10-14T00:00:00.000Z',
      items: [{
        point: 'git-identity', key: 'user.name', scope: 'git global',
        before: 'old-name', after: 'octocat', at: '2026-10-14T00:00:00.000Z',
        writer: 'gh_identity.wire', revokedAt: null,
      }],
    }),
  },
})
try {
  await withPlugin(hS.home, { path: hS.path, dataDir: hS.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    gitSet(hS.home, 'user.name', '"octocat"') // 归一化后 == after（接线前是 old-name，非空）
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    const r = verdictOf(u, 'user.name')
    check(r.verdict === 'revoked' && r.restored === 'old-name',
      '归一化命中 → 撤（实得 ' + JSON.stringify(r.verdict) + '）')
    check(gitGet(hS.home, 'user.name') === 'old-name',
      '写回的是台账里 before 的**原文**（不是归一化后的值，也不是空）')
  })
} finally { hS.cleanup() }

// ---- ⑧ 被改成**空值**：全仓的读法把空值折成「未设置」（与 `--get` + trim 一致）→ 判不出来，不写 ----
const hQ = fixture('wire-q')
try {
  await withPlugin(hQ.home, { path: hQ.path, dataDir: hQ.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    gitSet(hQ.home, 'user.name', '') // 键还在，值被清空
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    const r = verdictOf(u, 'user.name')
    check(r.verdict === 'undecidable' && r.skipped === true,
      '空值 = 读法里的「未设置」（与接线前一样）→ 判不出来、跳过（实得 ' + JSON.stringify(r.verdict) + '）')
    check(gitGet(hQ.home, 'user.name') === '', '那个空值原样留着（没被写、也没被删键）')
    const m = marksOf(hQ.home, 'user.name')
    check(!m.revoked && !m.abandoned, '台账里不下结论')
  })
} finally { hQ.cleanup() }

// ---- ⑨ 读不出来（git 跑不动）→ 未知不当成没有：跳过，别把「读不到」记成「被别人改过」 ----
// 这一项刻意让 before **非空**：否则「已经和接线前一样」那条会先把结论吃掉，这条判据就测不到读失败那条路。
const hR = fixture('wire-r', {
  withGit: false,
  files: {
    '.dsh/github-resident/wire/ledger.json': JSON.stringify({
      schema: 'dsh-github-resident/wire-ledger', schemaVersion: 1, updatedAt: '2026-10-14T00:00:00.000Z',
      items: [{
        point: 'git-identity', key: 'user.name', scope: 'git global',
        before: 'old-name', after: 'octocat', at: '2026-10-14T00:00:00.000Z',
        writer: 'gh_identity.wire', revokedAt: null,
      }],
    }),
  },
})
try {
  writeFileSync(hR.bin + '/git', '#!/bin/sh\nexit 2\n', { mode: 0o755 }) // git 在，但每次调用都失败
  await withPlugin(hR.home, { path: hR.path, dataDir: hR.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    const shaLedger = shaOrAbsent(hR.home + '/' + LEDGER_REL)
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    const r = verdictOf(u, 'user.name')
    check(r.verdict === 'undecidable' && r.skipped === true,
      'git 读失败（未知）→ 跳过，不判「被别人改过」（实得 ' + JSON.stringify(r.verdict) + '）')
    check(String(r.why).includes('读不出来'), '回执说清是「读不出来」，不是猜成被别人改过')
    check(shaOrAbsent(hR.home + '/' + LEDGER_REL) === shaLedger,
      '台账不下结论（读不到就永久记一笔 abandoned 才是真坑）')
  })
} finally { hR.cleanup() }

// ---- ⑦ 归一化对**两侧**都生效（台账那侧也归一化）：台账里记的值带首尾空白，宿主上是它的去空白形式 ----
const hL = fixture('wire-l', {
  files: {
    '.dsh/github-resident/wire/ledger.json': JSON.stringify({
      schema: 'dsh-github-resident/wire-ledger', schemaVersion: 1, updatedAt: '2026-10-14T00:00:00.000Z',
      items: [{
        point: 'git-identity', key: 'user.name', scope: 'git global',
        before: null, after: '  octocat  ', at: '2026-10-14T00:00:00.000Z',
        writer: 'gh_identity.wire', revokedAt: null,
      }],
    }),
  },
})
try {
  await withPlugin(hL.home, { path: hL.path, dataDir: hL.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    // 宿主的改动必须在 withPlugin **之内**做：隔离运行器把 GIT_CONFIG_GLOBAL 指向它自己的临时文件，
    // 而合成环境会把它清掉（`--global` 于是落在夹具 HOME 上）—— 在外面写会写进另一个文件，
    // 判据看着绿、其实测的不是这条路径（本仓踩过这类「夹具把环境悄悄换掉」的坑）。
    gitSet(hL.home, 'user.name', 'octocat') // 宿主上的值 = 台账那个值去掉首尾空白
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    const r = verdictOf(u, 'user.name')
    check(r.verdict === 'revoked' && gitGet(hL.home, 'user.name') === null,
      '台账那侧的首尾空白也算「同一个值」→ 撤（实得 ' + JSON.stringify(r.verdict) + '）')
  })
} finally { hL.cleanup() }

section('八、撤销的边界：判不出来时连授权都不动（没改动就不写盘）')
const hM = fixture('wire-m', {
  files: {
    '.dsh/github-resident/wire/ledger.json': JSON.stringify({
      schema: 'dsh-github-resident/wire-ledger', schemaVersion: 1, updatedAt: '2026-10-14T00:00:00.000Z',
      items: [{
        point: 'git-identity', key: 'user.name', scope: 'git global',
        before: null, after: 'octocat', at: '2026-10-14T00:00:00.000Z',
        writer: 'gh_identity.wire', revokedAt: null,
      }],
    }),
    '.dsh/github-resident/wire/consent.json': JSON.stringify({ schema: 'dsh-github-resident/wire-consent', granted: true, at: '2026-10-14T00:00:00.000Z', fingerprint: 'deadbeef', items: ['user.name'], tool: 'gh_identity' }),
  },
})
try {
  const shaConsent = shaOrAbsent(hM.home + '/.dsh/github-resident/wire/consent.json')
  await withPlugin(hM.home, { path: hM.path, dataDir: hM.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    // 这一项「已经回到接线前的样子」（本来就没设置过）→ 判不出来 → 不写、也不该动已记录的授权。
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    check(verdictOf(u, 'user.name').verdict === 'undecidable' && u.wrote === false, '没有可撤的项 → wrote=false')
    check(shaOrAbsent(hM.home + '/.dsh/github-resident/wire/consent.json') === shaConsent,
      '判不出来时不动已记录的授权（计划没变，授权就还有效）')
  })
} finally { hM.cleanup() }

// 同一件事的第二面：**多行项**单独存在时，判不出来 = 连 gitconfig / 台账 / 授权三个文件都不动。
// 单一项的夹具是刻意的 —— 有别的项在场时「文件变了」可能只是别的项被撤，证不出「什么都没写」。
const hN = fixture('wire-n', {
  files: {
    '.dsh/github-resident/wire/ledger.json': JSON.stringify({
      schema: 'dsh-github-resident/wire-ledger', schemaVersion: 1, updatedAt: '2026-10-14T00:00:00.000Z',
      items: [{
        point: 'git-identity', key: 'user.name', scope: 'git global',
        before: null, after: 'octocat', at: '2026-10-14T00:00:00.000Z',
        writer: 'gh_identity.wire', revokedAt: null,
      }],
    }),
    '.dsh/github-resident/wire/consent.json': JSON.stringify({ schema: 'dsh-github-resident/wire-consent', granted: true, at: '2026-10-14T00:00:00.000Z', fingerprint: 'deadbeef', items: ['user.name'], tool: 'gh_identity' }),
  },
})
try {
  await withPlugin(hN.home, { path: hN.path, dataDir: hN.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    // 同样的道理：宿主的改动（以及「改动前」的快照）都放在合成环境**之内**，
    // 否则隔离运行器下写的是另一个全局配置文件，这条判据就测不到它要测的多行路径了。
    gitSet(hN.home, 'user.name', 'somebody-else')
    execFileSync('git', ['config', '--global', '--add', 'user.name', 'octocat'], { env: { ...process.env, HOME: hN.home } })
    const before = {
      cfg: shaOrAbsent(hN.home + '/.gitconfig'),
      ledger: shaOrAbsent(hN.home + '/' + LEDGER_REL),
      consent: shaOrAbsent(hN.home + '/.dsh/github-resident/wire/consent.json'),
    }
    const u = await tool('gh_identity').execute({ action: 'unwire', consent: true }, {})
    check(verdictOf(u, 'user.name').verdict === 'undecidable' && u.wrote === false,
      '多行项单独存在：判不出来 → 跳过、wrote=false')
    check(shaOrAbsent(hN.home + '/.gitconfig') === before.cfg && gitGetAll(hN.home, 'user.name') === 'somebody-else\noctocat',
      '一个字节都没写：gitconfig 逐字节未变、两行都还在')
    check(shaOrAbsent(hN.home + '/' + LEDGER_REL) === before.ledger, '台账逐字节未变（没下任何结论）')
    check(shaOrAbsent(hN.home + '/.dsh/github-resident/wire/consent.json') === before.consent, '已记录的授权也原样（计划没变）')
  })
} finally { hN.cleanup() }

// ===========================================================================
section('九、verify 的读与归属词表：只差引号 / 多行 / git 读失败 / 落点不是软链 / 已放手（票 41 的验收判据）')
// ===========================================================================

// ---- ① 只差首尾空白/引号 → 仍算我们写的（老写法：drift ＋「不是本插件写的」）----
const hT = fixture('verify-t')
try {
  await withPlugin(hT.home, { path: hT.path, dataDir: hT.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    gitSet(hT.home, 'user.name', '"  octocat  "') // 引号里还裹着首尾空白：归一化要反复剥才归得掉
    const v = await tool('gh_identity').execute({ action: 'verify' }, {})
    const r = v.items.find((i) => i.key === 'user.name')
    check(r.state === 'ours' && r.ours === true && v.summary.ours === 3,
      '只差首尾空白/引号 → state=ours、ours=true（实得 ' + JSON.stringify(r.state) + '）')
    check(r.now === '"  octocat  "' && r.written === 'octocat',
      '逐字值仍并排报出（now=' + JSON.stringify(r.now) + ' / written=' + JSON.stringify(r.written) + '）')
    check(String(r.note).includes('只差首尾空白/引号'), 'note 如实点出「只差首尾空白/引号」（' + r.note + '）')
  })
} finally { hT.cleanup() }

// ---- ② 同一项被写成多行 → 读不准：state=unknown ＋ ours=null ＋ now 放全部行（老写法：match 假绿）----
const hU = fixture('verify-u')
try {
  await withPlugin(hU.home, { path: hU.path, dataDir: hU.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    gitSet(hU.home, 'user.name', 'somebody-else')
    execFileSync('git', ['config', '--global', '--add', 'user.name', 'octocat'], { env: { ...process.env, HOME: hU.home } })
    const v = await tool('gh_identity').execute({ action: 'verify' }, {})
    const r = v.items.find((i) => i.key === 'user.name')
    check(r.state === 'unknown' && r.ours === null && v.summary.unknown === 1,
      '多行 → state=unknown、ours=null，不再说「都对」（实得 ' + JSON.stringify(r.state) + '）')
    check(String(r.now).includes('somebody-else') && String(r.now).includes('octocat'),
      'now 照实放读到的**全部行**（' + JSON.stringify(r.now) + '）')
    check(String(r.note).includes('多行'), 'note 说清是哪一种读不准（' + r.note + '）')
    check(v.summary.ours === 2, '另外两项照常算 ours（不整张回执一起降级）')
  })
} finally { hU.cleanup() }

// ---- ③ git 读失败（退出码既非 0 也非 1）→ 未知 ≠ 没有：state=unknown，不折成「不是我们的」----
// 台账里 `before` **非空**：否则「已经回到接线前」那条会先把结论吃掉，这条就测不到读失败那条路。
const hV = fixture('verify-v', {
  withGit: false,
  files: {
    '.dsh/github-resident/wire/ledger.json': JSON.stringify({
      schema: 'dsh-github-resident/wire-ledger', schemaVersion: 1, updatedAt: '2026-10-14T00:00:00.000Z',
      items: [{
        point: 'git-identity', key: 'user.name', scope: 'git global',
        before: 'old-name', after: 'octocat', at: '2026-10-14T00:00:00.000Z',
        writer: 'gh_identity.wire', revokedAt: null,
      }],
    }),
  },
})
try {
  writeFileSync(hV.bin + '/git', '#!/bin/sh\nexit 2\n', { mode: 0o755 }) // git 在，但每次调用都失败
  await withPlugin(hV.home, { path: hV.path, dataDir: hV.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    const v = await tool('gh_identity').execute({ action: 'verify' }, {})
    const r = v.items[0]
    check(r.state === 'unknown' && r.ours === null,
      'git 读失败 → state=unknown、ours=null（不写成 not-ours；实得 ' + JSON.stringify(r.state) + '）')
    check(String(r.note).includes('读不出来'), 'note 说清是「读不出来」，不是猜成被别人改过')
  })
} finally { hV.cleanup() }

// ---- ④ PATH 落点不是软链（读不出归属）→ state=unknown（老写法折成「不是我们写的」）----
// 真正的 `readlink` 失败（权限 / IO）与这里走的是**同一条** `readable:false` 路径；能在夹具里稳定造出来的
// 是「那个位置不是软链」这一种，所以判据落在它上面。
const hW = fixture('verify-w', { withGh: false })
mkdirSync(hW.home + '/.dsh/gh-cli/bin', { recursive: true })
writeFileSync(hW.home + '/.dsh/gh-cli/bin/gh', '#!/bin/sh\necho "gh version 9.9.9 (CACHE-STUB)"\n', { mode: 0o755 })
try {
  await withPlugin(hW.home, { path: hW.path, dataDir: hW.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    rmSync(hW.bin + '/gh')                                    // 用户把那个软链换成了自己的真实文件
    writeFileSync(hW.bin + '/gh', '#!/bin/sh\necho mine\n', { mode: 0o755 })
    const v = await tool('gh_identity').execute({ action: 'verify' }, {})
    const r = v.items.find((i) => i.point === 'path-landing')
    check(r.state === 'unknown' && r.ours === null,
      '落点不是软链 → state=unknown、ours=null（实得 ' + JSON.stringify(r.state) + '）')
    check(String(r.note).includes('不是软链'), 'note 说清它看到的是什么（不是笼统一句「读不准」）')
  })
} finally { hW.cleanup() }

// ---- ⑤ 已放手（abandoned）的项：台账态与盘上归属**各说一件事** ----
const hX = fixture('verify-x')
try {
  await withPlugin(hX.home, { path: hX.path, dataDir: hX.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    await tool('gh_identity').execute({ action: 'wire', consent: true }, {})
    gitSet(hX.home, 'user.name', 'someone-else')
    await tool('gh_identity').execute({ action: 'unwire', consent: true }, {}) // → 判 abandoned，记进台账
    const v = await tool('gh_identity').execute({ action: 'verify' }, {})
    const r = v.items.find((i) => i.key === 'user.name')
    check(r.retired === 'abandoned' && r.state === 'not-ours' && r.ours === false,
      '已放手的项：retired=abandoned、state=not-ours（两列各说一件事；实得 ' + JSON.stringify([r.retired, r.state]) + '）')
    check(String(r.note).includes('已放手') && String(r.note).includes('不是本插件写的'),
      'note 把「已放手」与「不是我们写的」都说出来（' + r.note + '）')
    check(v.summary.notOurs === 1 && v.summary.backToBefore === 2,
      '计数按盘上归属：1 项 not-ours ＋ 2 项 back-to-before（' + JSON.stringify(v.summary) + '）')
  })
} finally { hX.cleanup() }

note('全流程都在合成环境的假 HOME 里跑：真宿主的 git 全局配置、gh hosts.yml、~/.dsh 一个字节都没碰。')
note('闸门与真源的分工：本文件管行为（写没写 / 撤销对不对），tool-surface-contract 管形状（协议与回执同源）。')

summary()
