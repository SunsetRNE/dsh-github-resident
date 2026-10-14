/**
 * tests/merge/host/pr-fallback.test.mjs —— 票「gh_pr 共用解析器 + 回落 gh pr create」的门禁。
 *
 * 全离线，两条路都不出网：
 *   - REST 那条路：**门禁里临时替换 `globalThis.fetch`**（裁决 (a)：产品不加环境变量、不联网）；
 *   - gh 那条路：夹具的 gh 桩认 `pr create`（记 argv / 回 URL / 按 gh 的样子失败 / 可挂死）。
 *
 * 逐条对着票面验收标准：
 *   ①  有 token → 走 REST（authPath=token-rest），且**回落没有被触发**（gh 没被 fork 去开 PR）；
 *   ①b REST 自己失败（401）→ 也不改道（触发条件严格按票面：只有「三处都无 token」才回落）；
 *   ②  三处无 token + gh 能干活 → 回落成功（authPath=gh-cli-fallback、authSource 如实 (none)）；
 *   ③  两条路都没成 → 两边的原因分别可读，不吞成一句泛化错误；
 *   ④  回落有界：gh 挂死时按超时失败（含「孙进程攥着管道」那种形状 —— 本仓「子进程不退」的原形）；
 *   ⑤  没有能跑的 gh → 如实说，并给出补救命令；
 *   ⑥  gh 退出码 0 但没有 PR 链接 → 不当成功（挡住「exit 0 却没有 URL」这类假结论）；
 *   ⑦  协议表 gh_pr 那行 == 上面这些真回执的键并集（两个方向都抓）。
 *
 * 用法：node tests/merge/host/pr-fallback.test.mjs
 */
import { join } from 'node:path'
import { check, note, section, summary } from './_check.mjs'
import { makeHome, withPlugin, readGhCalls, orphanHoldsPipes } from './_env-harness.mjs'

const FAKE_TOKEN = 'ghp_prFallbackFake0000000000000000000000'
const REPO = 'SunsetRNE/dsh-github-resident'
const PR_URL = 'https://github.com/SunsetRNE/dsh-github-resident/pull/4242'
const GH_ERR = 'gh: To get started with GitHub CLI, please run: gh auth login'

// 信封键（协议层加的）与通用失败键（`error`）都不算业务字段 —— 与契约门禁同一口径。
const ENVELOPE_KEYS = ['protocol', 'ok']
const GENERIC_FAILURE_KEYS = ['error']

const homes = []
function home(tag, opts) {
  const h = makeHome(tag, opts)
  homes.push(h)
  return h
}

/** 「有 token」那一格：state 文件就是解析器的第二优先级（夹具按 0600 写）。 */
const STATE_WITH_TOKEN = {
  '.dsh/github-resident.json': JSON.stringify({ token: FAKE_TOKEN, login: 'tester' }),
}

const jsonRes = (status, obj) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(obj) })

/**
 * fetch 假身：记下每次请求再作答。**只活在这段用例里**（跑完必恢复）。
 * 换成 `poison`（599）就是「这一格不该发 REST 请求」的意思 —— 真发了会在下面被 `calls` 抓住，
 * 而不是把整条门禁炸掉（炸掉只会看见一句异常，看不出是哪条路串了）。
 */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const req = {
      url: String(url),
      method: (init && init.method) || 'GET',
      body: init && init.body ? JSON.parse(String(init.body)) : null,
    }
    calls.push(req)
    return handler(req)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}
const poison = () => jsonRes(599, { message: '这一格不该发任何 REST 请求' })
const prCreateCalls = (ghLog) => readGhCalls(ghLog).filter((a) => a[0] === 'pr' && a[1] === 'create')

// ---------------------------------------------------------------------------
section('① 有 token：走 REST（authPath=token-rest），回落没有被触发')
const hRest = home('pr-rest', { withGh: true, files: STATE_WITH_TOKEN, gh: { log: true } })
const fetchOk = stubFetch((req) => (req.method === 'POST'
  ? jsonRes(201, { number: 4242, html_url: PR_URL })
  : jsonRes(200, { default_branch: 'main' })))
let rRest = null
try {
  rRest = await withPlugin(hRest.home, { path: hRest.path, dataDir: join(hRest.home, '.dsh', 'gh-cli') }, ({ tool }) =>
    tool('gh_pr').execute({ repo: REPO, title: 'T', head: 'feat/x', body: 'B', draft: true }, {}))
} finally {
  fetchOk.restore()
}

check(rRest && rRest.ok === true, '有 token 时 REST 开 PR 成功（ok=' + (rRest && rRest.ok) + '）')
check(rRest && rRest.authPath === 'token-rest', "回执 authPath === 'token-rest'（实得 " + (rRest && rRest.authPath) + '）')
check(rRest && rRest.authSource === 'state:~/.dsh/github-resident.json', 'authSource 仍是身份来源（state），语义没变')
check(rRest && rRest.number === 4242 && rRest.url === PR_URL, 'PR 号与 URL 按 REST 那条路的形状回来')
check(rRest && rRest.base === 'main', 'base 没给时仍按仓库默认分支解析（GET /repos 那一步没被顺手砍掉）')
check(rRest && rRest.status === 201, 'HTTP 状态码照实回（201）')
check(Array.isArray(rRest && rRest.attempts) && rRest.attempts.length === 1
  && rRest.attempts[0].path === 'token-rest' && rRest.attempts[0].ok === true && rRest.attempts[0].reason === null,
  'attempts 只记走了的这一条路，且如实标 ok')
check(fetchOk.calls.length === 2 && fetchOk.calls[0].method === 'GET' && fetchOk.calls[1].method === 'POST',
  '只发了这两次 REST（先问默认分支、再开 PR），实得 ' + JSON.stringify(fetchOk.calls.map((c) => c.method + ' ' + c.url)))
check(JSON.stringify(fetchOk.calls[1] && fetchOk.calls[1].body) === JSON.stringify({ title: 'T', head: 'feat/x', base: 'main', body: 'B', draft: true }),
  '入参到 REST 请求体的映射与从前逐字一致（' + JSON.stringify(fetchOk.calls[1] && fetchOk.calls[1].body) + '）')
const ghCallsRest = readGhCalls(hRest.ghLog)
check(ghCallsRest.length === 0, '回落路径没有被触发：gh 一次都没被 fork（实得调用 ' + JSON.stringify(ghCallsRest) + '）')
check(JSON.stringify(rRest).indexOf(FAKE_TOKEN) < 0, '回执里搜不到 token 原文（沿用掩码判据）')

// ---------------------------------------------------------------------------
section('①b REST 自己失败（401）也不改道 —— 回落只在「三处都无 token」时发生')
const h401 = home('pr-401', { withGh: true, files: STATE_WITH_TOKEN, gh: { log: true } })
const fetch401 = stubFetch(() => jsonRes(401, { message: 'Bad credentials' }))
let r401 = null
try {
  r401 = await withPlugin(h401.home, { path: h401.path, dataDir: join(h401.home, '.dsh', 'gh-cli') }, ({ tool }) =>
    tool('gh_pr').execute({ repo: REPO, title: 'T', head: 'feat/x' }, {}))
} finally {
  fetch401.restore()
}
check(r401 && r401.ok === false && r401.authPath === 'token-rest',
  'REST 失败时 authPath 仍是 token-rest（这次确实走的是这条路）')
check(r401 && r401.status === 401 && r401.message === 'Bad credentials',
  '原有字段照旧（status / message 都还在）')
check(r401 && r401.attempts.length === 1 && /HTTP 401/.test(r401.attempts[0].reason) && /Bad credentials/.test(r401.attempts[0].reason),
  'REST 那次的原始原因（HTTP 401 + GitHub 的原话）留在 attempts 里，不吞成泛化错误：'
  + (r401 && r401.attempts[0].reason))
check(prCreateCalls(h401.ghLog).length === 0,
  'REST 失败后**没有**改走 gh CLI —— 免得拿另一个身份执行、把权限问题掩盖成路由问题')

// ---------------------------------------------------------------------------
section('② 三处都无 token + gh 能干活：走回落（authPath=gh-cli-fallback）')
const hFb = home('pr-fb', { withGh: true, gh: { log: true, prCreate: { url: PR_URL } } })
const fetchNone = stubFetch(poison)
let rFb = null
let rFbBare = null
let protoRow = []
try {
  const out = await withPlugin(hFb.home, { path: hFb.path, dataDir: join(hFb.home, '.dsh', 'gh-cli') }, async ({ tool }) => ({
    full: await tool('gh_pr').execute({ repo: REPO, title: 'T', head: 'feat/x', base: 'main', body: 'B', draft: true }, {}),
    // 第二次：可选参数一个都不给 —— 判据要能看见「--body 仍然显式给（空串）、--head/--base/--draft 一个不加」
    bare: await tool('gh_pr').execute({ repo: REPO, title: 'T2' }, {}),
    proto: await tool('gh_protocol').execute({}, {}),
  }))
  rFb = out.full
  rFbBare = out.bare
  protoRow = ((out.proto.tools || []).find((t) => t.name === 'gh_pr') || {}).returns || []
} finally {
  fetchNone.restore()
}

check(rFb && rFb.ok === true, '回落成功（ok=true，实得 ' + (rFb && rFb.ok) + '）')
check(rFb && rFb.authPath === 'gh-cli-fallback', "回执 authPath === 'gh-cli-fallback'（实得 " + (rFb && rFb.authPath) + '）')
check(rFb && rFb.authSource === '(none)', "回落路径 authSource 如实 (none)（不猜 gh 用的是谁，裁决 (a)）")
check(rFb && rFb.number === 4242 && rFb.url === PR_URL, 'PR 号与 URL 与 REST 那条路**同形状**（number / url）')
check(rFb && rFb.status === null && rFb.base === 'main' && rFb.message === null && rFb.errors === null,
  'REST 专有的字段如实留空/原样（status=null；给了 base 就原样回）')
check(Array.isArray(rFb && rFb.attempts) && rFb.attempts.length === 2
  && rFb.attempts[0].path === 'token-rest' && rFb.attempts[0].ok === false && /三处都没有可用身份/.test(rFb.attempts[0].reason)
  && rFb.attempts[1].path === 'gh-cli-fallback' && rFb.attempts[1].ok === true && rFb.attempts[1].reason === null,
  'attempts 逐路记：REST 侧如实写「没有身份」，回落侧 ok')
check(fetchNone.calls.length === 0, '「三处都无 token」时**一次 REST 都不发**（不拿空身份去撞 401）')

const fbCalls = prCreateCalls(hFb.ghLog)
check(fbCalls.length === 2, 'gh 被 fork 两次（两次调用各一次），实得 ' + fbCalls.length + ' 次')
check(JSON.stringify(fbCalls[0]) === JSON.stringify(['pr', 'create', '--repo', REPO, '--title', 'T', '--head', 'feat/x', '--base', 'main', '--body', 'B', '--draft']),
  '入参映射到 gh argv（repo/title/head/base/body/draft 一个不少）：' + JSON.stringify(fbCalls[0]))
check(JSON.stringify(fbCalls[1]) === JSON.stringify(['pr', 'create', '--repo', REPO, '--title', 'T2', '--body', '']),
  '不给可选参数时：head/base/draft 一个不加，但 --body **显式给空串**'
  + '（不给的话 gh 非交互下直接失败：must provide `--title` and `--body` … —— 真机实测 gh 2.102）：'
  + JSON.stringify(fbCalls[1]))
check(rFbBare && rFbBare.ok === true && rFbBare.base === null,
  '没给 base 就交给 gh 自己判定，回执里如实留 null（不为它再发一次 REST 请求）')

// ---------------------------------------------------------------------------
section('③ 两条路都没成：两边的失败原因分别可读')
const hBoth = home('pr-both', { withGh: true, gh: { log: true, prCreate: { exit: 1, stderr: GH_ERR } } })
const fetchBoth = stubFetch(poison)
let rBoth = null
try {
  rBoth = await withPlugin(hBoth.home, { path: hBoth.path, dataDir: join(hBoth.home, '.dsh', 'gh-cli') }, ({ tool }) =>
    tool('gh_pr').execute({ repo: REPO, title: 'T', head: 'feat/x' }, {}))
} finally {
  fetchBoth.restore()
}
check(rBoth && rBoth.ok === false && rBoth.authPath === 'gh-cli-fallback', '按失败回，且如实标出走的是回落')
check(rBoth && rBoth.attempts.length === 2, '两条路各占一条记录（实得 ' + (rBoth && rBoth.attempts.length) + '）')
check(rBoth && /三处都没有可用身份/.test(rBoth.attempts[0].reason),
  'REST 那侧的原因：没有可用身份（' + (rBoth && rBoth.attempts[0].reason) + '）')
check(rBoth && /退出码 1/.test(rBoth.attempts[1].reason) && rBoth.attempts[1].reason.includes(GH_ERR),
  'gh 那侧的原因：退出码 + gh 的原话（' + (rBoth && rBoth.attempts[1].reason) + '）')
check(rBoth && typeof rBoth.error === 'string'
  && rBoth.error.includes('三处都没有可用身份') && rBoth.error.includes(GH_ERR),
  '顶层 error 一句话里两边的失败都在，可分别读出（不是一句泛化错误）')
check(rBoth && rBoth.authSource === '(none)' && JSON.stringify(rBoth).indexOf(FAKE_TOKEN) < 0,
  '失败回执同样不夹带任何 token 原文')

// ---------------------------------------------------------------------------
section('④ 回落有界：gh 挂死时按超时失败（先证明这个形状真能挂住父进程，再看我们照样结算）')
const BOUND = 900
const hangCases = [
  ['gh 留下一个攥着 stdout 管道的孙进程（本仓「子进程不退」的现场形状）', false],
  ['gh 就是那个进程自己（shell 被 exec 替换掉，没有孙进程）', true],
]
// 先自证形状不是假的：**同一个桩**能让纯 spawn 的父进程等不到 'close'（孙进程攥着管道不放）。
// 工具调用随后照样在设定上界内结算 —— 两条合起来才是「有界」的意思。
const hProbe = home('pr-hang-probe', { withGh: true, gh: { log: true, prCreate: { hang: true, hangMs: 30000, exec: false } } })
const orphanHolds = await orphanHoldsPipes(join(hProbe.bin, 'gh'))
check(orphanHolds, '这一格的形状是**真的**：同一个 gh 桩能让纯 spawn 的父进程在 800ms 内等不到 close（孙进程攥着管道）')

let rHang = null
for (const [label, exec] of hangCases) {
  const h = home('pr-hang-' + (exec ? 'exec' : 'sh'), {
    withGh: true,
    gh: { log: true, prCreate: { hang: true, hangMs: 30000, exec } },
  })
  const t0 = Date.now()
  const r = await withPlugin(h.home, {
    path: h.path,
    dataDir: join(h.home, '.dsh', 'gh-cli'),
    env: { DSH_GH_PR_TIMEOUT_MS: String(BOUND) },
  }, ({ tool }) => tool('gh_pr').execute({ repo: REPO, title: 'T', head: 'feat/x' }, {}))
  const ms = Date.now() - t0
  if (!rHang) rHang = r
  check(r.ok === false && r.authPath === 'gh-cli-fallback', label + '：按失败回（不是挂住、也不是假装成功）')
  check(/超时/.test(r.attempts[1].reason) && r.attempts[1].reason.includes(String(BOUND)),
    label + '：如实报「超时」并带上界数字（' + r.attempts[1].reason.slice(0, 60) + '…）')
  check(/结果未知/.test(r.attempts[1].reason),
    label + '：明说「PR 可能已经开了也可能没有」—— 超时 != 没开成，别让调用方盲目重试')
  check(ms >= 600 && ms < BOUND + 1500, label + '：调用在设定上界内返回（实测 ' + ms + 'ms，上界 ' + BOUND + 'ms + 兜底）')
  check(prCreateCalls(h.ghLog).length === 1, label + '：回落确实执行过 gh（不是没试就报超时）')
}

// ---------------------------------------------------------------------------
section('⑤ 没有能跑的 gh：如实说，并给补救命令')
const hNoGh = home('pr-nogh', { withGh: false })
const fetchNoGh = stubFetch(poison)
let rNoGh = null
try {
  rNoGh = await withPlugin(hNoGh.home, { path: hNoGh.path, dataDir: join(hNoGh.home, '.dsh', 'gh-cli') }, ({ tool }) =>
    tool('gh_pr').execute({ repo: REPO, title: 'T', head: 'feat/x' }, {}))
} finally {
  fetchNoGh.restore()
}
check(rNoGh && rNoGh.ok === false && rNoGh.attempts.length === 2, '没 gh 时也是「两条路各报一条」的形状')
check(rNoGh && /gh_cli_install/.test(rNoGh.attempts[1].reason),
  '缺 gh 的原因里给出补救命令（' + (rNoGh && rNoGh.attempts[1].reason) + '）')
check(rNoGh && /三处都没有可用身份/.test(rNoGh.attempts[0].reason) && rNoGh.attempts[1].reason !== rNoGh.attempts[0].reason,
  '两条原因不是同一句话复制两遍（各自的缺口各自说）')

// ---------------------------------------------------------------------------
section('⑥ gh 退出码 0 但没有 PR 链接：不许当成功（挡住假结论）')
const hNoUrl = home('pr-nourl', { withGh: true, gh: { log: true, prCreate: { noUrl: true } } })
const fetchNoUrl = stubFetch(poison)
let rNoUrl = null
try {
  rNoUrl = await withPlugin(hNoUrl.home, { path: hNoUrl.path, dataDir: join(hNoUrl.home, '.dsh', 'gh-cli') }, ({ tool }) =>
    tool('gh_pr').execute({ repo: REPO, title: 'T', head: 'feat/x' }, {}))
} finally {
  fetchNoUrl.restore()
}
check(rNoUrl && rNoUrl.ok === false && rNoUrl.number === null && rNoUrl.url === null,
  'exit 0 但没有 URL → 不当成功（ok=false、number/url 都是 null）')
check(rNoUrl && /没有 PR 链接/.test(rNoUrl.attempts[1].reason) && /退出码 0/.test(rNoUrl.attempts[1].reason),
  '原因说得清是「退出码 0 但没有链接」这种形状（' + (rNoUrl && rNoUrl.attempts[1].reason) + '）')

// ---------------------------------------------------------------------------
section('⑦ 协议表 gh_pr 那行 == 这些真回执的键并集（两个方向都抓）')
const receipts = { rest: rRest, restFail: r401, fallback: rFb, fallbackBare: rFbBare, bothFail: rBoth, hang: rHang, noGh: rNoGh, noUrl: rNoUrl }
const business = (r) => Object.keys(r || {}).filter((k) => !ENVELOPE_KEYS.includes(k) && !GENERIC_FAILURE_KEYS.includes(k))
const actualKeys = [...new Set(Object.values(receipts).flatMap(business))].sort()
const declaredKeys = protoRow.filter((k) => !ENVELOPE_KEYS.includes(k)).sort()
const declaredOnly = declaredKeys.filter((k) => !actualKeys.includes(k))
const actualOnly = actualKeys.filter((k) => !declaredKeys.includes(k))
check(declaredKeys.includes('authPath'), '协议表那行登记了 authPath')
check(declaredKeys.includes('attempts'), '协议表那行登记了 attempts')
check(declaredOnly.length === 0 && actualOnly.length === 0,
  '协议表 == 真回执键并集，两个方向都无漂移（协议独有 ' + JSON.stringify(declaredOnly) + '，工具独有 ' + JSON.stringify(actualOnly) + '）')
check(actualKeys.length >= 9, '键并集确实来自真回执（' + actualKeys.length + ' 个：' + actualKeys.join(',') + '）')

// 判据自证：同一支逻辑对纯合成样本也要在两个方向各自报红（免得漂了却看不出来）。
const driftOf = (d, a) => ({ declaredOnly: d.filter((k) => !a.includes(k)), actualOnly: a.filter((k) => !d.includes(k)) })
check(driftOf(['A', 'B'], ['A', 'C']).declaredOnly.join() === 'B' && driftOf(['A', 'B'], ['A', 'C']).actualOnly.join() === 'C',
  '这条判据抓得住「协议写了但工具没有」与「工具有了协议没写」两个方向')

note('REST 那条路靠**门禁里临时替换 globalThis.fetch**（裁决 (a)：产品不加环境变量、不联网）；'
  + 'gh 那条路靠夹具的 gh 桩（`makeHome(..., { gh: {...} })`）—— 两条路都是**实跑**，不是读源码猜。')
note('回落的上界用 DSH_GH_PR_TIMEOUT_MS 压到 ' + BOUND + 'ms（默认 60s，真机上留给慢链路）。')
note('诚实边界：Node 24 上 execFile 自带的 timeout 已经会收场，所以工具里那层「到点自己结算 + 放掉管道」的兜底'
  + '**这条门禁触发不到**（从外部造不出「带了 timeout 还不收场」的形状）—— 它保的是别的 Node 版本与别的形状，'
  + '不是被这条门禁证过的路径；被证过的是「上界到了就返回、并如实报超时」。')
note('协议表那一行从前是手抄的（#21 顺手补过漏报的 authSource/message/errors）；从这个门禁起，'
  + '它被钉到 gh_pr 的真回执上 —— 两条路都能离线实跑，所以「不假装覆盖」的例外名单里可以划掉它了。')

for (const h of homes) h.cleanup()
summary()
