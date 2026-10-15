/**
 * tests/merge/host/work-ledger.test.mjs —— 票 55 / #31「只读的并发账：谁在动什么」的门禁。
 *
 * 它要回答的是票面钉死的几件事，缺一件这本账就是纸糊的：
 *   ① **看得见**：announce 之后 list 看得到，字段齐全、alive 为真；
 *   ② **陈旧认得出来**：pid 查不到（alive=false）或心跳超过 TTL → 进 stale；pid 判不出来（alive=null）单列 missing；
 *   ③ **release 只认自己**：标完不在 active 里，别人的条目一条不动；
 *   ④ **两个不同 sessionId 的条目能同时看见**（这正是本票要的「下一个来的人看得见」）；
 *   ⑤ **list 一个字节都不写**：账文件 sha256 逐字节不变、HOME 里不多出文件；
 *   ⑥ **不阻塞**：别人的条目占着同一条路径，announce 照样成功（**没有互斥**）；
 *   ⑦ **形状同源**：工具回执的键 == 协议 `work` 段声明的视图（同一处声明派生，不是手抄第二份）。
 *
 * 并发写选型（票面要求写清）：数据文件是**追加式 JSONL**、读时折叠 —— 不是「读-改-写整份 JSON」，
 * 因为后者有两个会话同时 announce 时「后 rename 把先写者整条吃掉」的丢更新窗口。说明写在 plugin.js 里
 *（WORK_LEDGER_VIEWS 旁边那一段），本用例只钉「两条都看得见」这个可观测的结果。
 *
 * 隔离：全程用 _env-harness 的合成环境（假 HOME + 夹具 PATH + 假数据目录）；不碰真 HOME、不联网。
 * 用法：node tests/merge/host/work-ledger.test.mjs
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { check, note, section, summary } from './_check.mjs'
import { listingOf, makeHome, sha256File, withPlugin } from './_env-harness.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 双向漂移：declaredOnly = 协议写了但工具没有；actualOnly = 工具有了协议没写。 */
const drift = (declared, actual) => ({
  declaredOnly: declared.filter((k) => !actual.includes(k)),
  actualOnly: actual.filter((k) => !declared.includes(k)),
})

const homes = []
const home = (tag, opts) => { const h = makeHome(tag, opts); homes.push(h); return h }
const cleanup = () => { for (const h of homes) h.cleanup() }

const h = home('work-ledger', { withGh: true })
const dataDir = join(h.home, '.dsh', 'gh-cli')
const ledgerFile = join(dataDir, 'work-ledger.json')

const savedSession = process.env.DSH_SESSION_ID
const savedTtl = process.env.DSH_GH_WORK_TTL_MS

try {
  await withPlugin(h.home, { path: h.bin, dataDir }, async ({ tool }) => {
    const t = (args) => tool('gh_work_ledger').execute(args, {})
    const proto = await tool('gh_protocol').execute({}, {})
    const exists = tool('gh_work_ledger')

    // -------------------------------------------------------------------
    section('一、空账与只读：list 缺省、不建文件、不写盘')

    check(!!exists, '工具 gh_work_ledger 真的注册出来了')
    process.env.DSH_SESSION_ID = 'session-A'

    const empty = await t({})
    check(empty.ok === true && empty.action === 'list', '不带 action 时缺省是 list（只读）')
    check(empty.exists === false && Array.isArray(empty.entries) && empty.entries.length === 0
      && empty.active.length === 0 && empty.stale.length === 0 && empty.missing.length === 0,
      '还没有账时 list 如实回空（exists=false），不报错')
    check(empty.file === ledgerFile, '回执写明账文件落点（' + empty.file + '）')
    check(!existsSync(ledgerFile), 'list 不把账文件建出来（只读动作一个字节都不写）')

    // -------------------------------------------------------------------
    section('二、announce → list：字段齐全、alive 为真、upsert 不堆条目')

    const a1 = await t({ action: 'announce', targets: [{ kind: 'path', value: '/repo/x' }, { kind: 'ticket', value: '#31' }], note: '在改 plugin.js' })
    check(a1.ok === true && a1.action === 'announce' && a1.entries.length === 2, '一次 announce 两个 target：两条都登记上了')
    const e1 = a1.entries.find((x) => x.target.kind === 'path')
    check(e1.sessionId === 'session-A' && e1.pid === process.pid && typeof e1.actor === 'string' && e1.actor.length > 0,
      '条目带齐「谁」（actor / sessionId / pid）')
    check(e1.target.kind === 'path' && e1.target.value === '/repo/x', '条目带齐「在哪个路径 / 票」（target）')
    check(e1.note === '在改 plugin.js' && typeof e1.startedAt === 'string' && typeof e1.heartbeatAt === 'string',
      '条目带齐 note / startedAt / heartbeatAt')
    check(e1.alive === true && e1.stale === false && e1.released === false && e1.releasedAt === null,
      '刚登记：alive 为真、不陈旧、未释放')
    check(typeof e1.ageMs === 'number' && e1.ageMs >= 0, 'ageMs 是现算的（' + e1.ageMs + 'ms）')
    check(typeof e1.id === 'string' && e1.id.startsWith('work-'), '每条有稳定 id（' + e1.id + '）')

    const l1 = await t({})
    check(l1.exists === true && l1.entries.length === 2, 'announce 之后 list 看得到（2 条）')
    check(l1.active.length === 2 && l1.entries.every((x) => x.alive === true), '两条都在 active 里、alive 都为真')
    check(JSON.stringify(l1.entries.map((x) => x.id).sort()) === JSON.stringify(a1.entries.map((x) => x.id).sort()),
      'list 与 announce 看到的是同一批 id')

    await sleep(20)
    const a2 = await t({ action: 'announce', targets: [{ kind: 'path', value: '/repo/x' }] })   // 不给 note = 纯心跳
    const e2 = a2.entries[0]
    check(e2.id === e1.id && e2.startedAt === e1.startedAt && e2.heartbeatAt > e1.heartbeatAt,
      '同一条路径再 announce：id / startedAt 不变、心跳前进（按 sessionId + target upsert）')
    check(e2.note === '在改 plugin.js', '这次没给 note，保留上一条（心跳不该把备注抹掉）')
    const l1b = await t({})
    check(l1b.entries.filter((x) => x.target.kind === 'path' && x.target.value === '/repo/x').length === 1,
      'upsert 不会堆出第二条同 id 的账')

    // -------------------------------------------------------------------
    section('三、只读动作不写盘：sha256 逐字节不变、HOME 里不多出文件')

    const shaBefore = sha256File(ledgerFile)
    const dataBefore = listingOf(dataDir)
    const homeBefore = listingOf(h.home)
    await t({})
    await t({ action: 'list' })
    check(sha256File(ledgerFile) === shaBefore, 'list 前后账文件 sha256 逐字节不变')
    const dataAfter = listingOf(dataDir)
    check(dataAfter.names === dataBefore.names && dataAfter.mtimes === dataBefore.mtimes,
      'list 不往数据目录里多写文件、也不改 mtime')
    const homeAfter = listingOf(h.home)
    check(homeAfter.names === homeBefore.names && homeAfter.mtimes === homeBefore.mtimes,
      'list 之后 HOME 里不多出文件')

    // -------------------------------------------------------------------
    section('四、不阻塞（没有互斥）：别人占着同一条路径，announce 照样成功')

    process.env.DSH_SESSION_ID = 'session-B'
    const b1 = await t({ action: 'announce', targets: [{ kind: 'path', value: '/repo/x' }], note: '我也在这条路径上' })
    check(b1.ok === true && b1.error === undefined, '别人的条目已经在同一条路径上，announce 照样成功（**不报「已被占用」**）')
    const l2 = await t({})
    check(l2.entries.filter((x) => x.target.kind === 'path' && x.target.value === '/repo/x').length === 2,
      '两个不同 sessionId 的条目能同时看见（本票要的「下一个来的人看得见」）')
    check(new Set(l2.entries.map((x) => x.sessionId)).size === 2
      && l2.active.length === l2.entries.length
      && l2.active.filter((x) => x.target.value === '/repo/x').length === 2,
      '同一条路径上的两个会话同时活着（active），各自独立')

    // -------------------------------------------------------------------
    section('五、release 只认自己：不替别人放')

    const rb = await t({ action: 'release' })
    check(rb.ok === true && rb.released === 1 && rb.entries.length === 1, 'release 只把自己那条标掉（released=1）')
    const l3 = await t({})
    check(!l3.active.some((x) => x.sessionId === 'session-B'), 'release 之后自己不在 active 里')
    check(l3.active.some((x) => x.sessionId === 'session-A'), '别人的条目原样还在 active 里（不替别人放）')
    check(l3.entries.find((x) => x.sessionId === 'session-B').releasedAt !== null, 'releasedAt 真的落上了')

    // -------------------------------------------------------------------
    section('六、陈旧判据：pid 查不到 → stale；pid 判不出来 → missing')

    const dead = spawn(process.execPath, ['-e', 'process.exit(0)'])
    const deadPid = dead.pid
    await new Promise((r) => dead.on('close', r))
    // 账文件就是追加式 JSONL：手写一行即可造出「上一轮被杀掉的会话」这种真实形状。
    const at = new Date(Date.now() - 1000).toISOString()
    appendFileSync(ledgerFile, JSON.stringify({
      v: 1, type: 'announce', id: 'work-aaaaaaaaaaaa', actor: 'session-dead', sessionId: 'session-dead',
      pid: deadPid, target: { kind: 'ticket', value: '#31' }, note: null, at,
    }) + '\n')
    appendFileSync(ledgerFile, JSON.stringify({
      v: 1, type: 'announce', id: 'work-bbbbbbbbbbbb', actor: 'session-nopid', sessionId: 'session-nopid',
      pid: null, target: { kind: 'other', value: '不知道进程在哪' }, note: null, at,
    }) + '\n')

    const l4 = await t({})
    const deadView = l4.entries.find((x) => x.sessionId === 'session-dead')
    check(!!deadView && deadView.alive === false && deadView.stale === true,
      '换一个不存在的 pid（或 kill 掉那个 pid）：alive 为假、stale 为真')
    check(l4.stale.some((x) => x.sessionId === 'session-dead'), '它在 stale 那一档里')
    const noPidView = l4.entries.find((x) => x.sessionId === 'session-nopid')
    check(!!noPidView && noPidView.alive === null && noPidView.stale === false,
      'pid 判不出来时 alive=null（「不知道」不等于「不在」）')
    check(l4.missing.some((x) => x.sessionId === 'session-nopid'),
      '它单独进 missing 那一档（不折成 active 或 stale）')
    check(l4.malformed === 0, '账文件每一行都解析得动（malformed=0）')

    // -------------------------------------------------------------------
    section('七、心跳超过 TTL 也算陈旧（DSH_GH_WORK_TTL_MS）')

    process.env.DSH_GH_WORK_TTL_MS = '1'
    await sleep(10)
    const l5 = await t({})
    check(l5.ttlMs === 1, 'TTL 从环境读得到（' + l5.ttlMs + 'ms）')
    check(l5.stale.some((x) => x.sessionId === 'session-A'),
      '心跳超过 TTL：本来 active 的条目进了 stale（pid 还活着也一样）')
    delete process.env.DSH_GH_WORK_TTL_MS
    const l6 = await t({})
    check(l6.stale.every((x) => x.sessionId === 'session-dead'),
      'TTL 收回默认值之后，心跳没超时的又回到 active（只有 pid 不在的那条还 stale）')

    // -------------------------------------------------------------------
    section('八、形状同源：工具回执的键 == 协议 work 段声明的视图')

    const seg = proto.work
    check(!!seg, '协议里有 work 段')
    check(seg.tool === 'gh_work_ledger' && seg.fieldsFrom === 'gh_work_ledger', 'work 段指向工具 gh_work_ledger')
    check(String(seg.ledgerFile).endsWith('work-ledger.json'), 'work 段写清了账文件落点（' + seg.ledgerFile + '）')
    check(String(seg.boundary).includes('不做互斥') && String(seg.boundary).includes('不阻塞任何人'),
      'boundary 写死了「不做互斥、不阻塞任何人」')
    check(/DSH_SESSION_ID/.test(JSON.stringify(seg.env)) && /DSH_GH_WORK_TTL_MS/.test(JSON.stringify(seg.env)),
      'work 段写明了 sessionId 与 TTL 的环境变量来源')

    const row = (proto.tools || []).find((x) => x.name === 'gh_work_ledger')
    check(!!row, '协议表里有 gh_work_ledger 那一行')
    const views = seg.views || {}
    const viewUnion = [...new Set(Object.values(views).flat())].sort()
    check(viewUnion.length > 0 && JSON.stringify(viewUnion) === JSON.stringify([...new Set(row.returns)].sort()),
      '协议表那一行 == 三个动作视图的**并集**（同一处声明派生，不是手抄）')

    // 信封（ok / protocol）与失败回执的通用键 error 不算业务字段 —— 与 tool-surface-contract 同一个口径。
    const ENVELOPE = ['ok', 'protocol']
    const business = (r) => Object.keys(r || {}).filter((k) => !ENVELOPE.includes(k) && k !== 'error')
    for (const [act, receipt] of [['list', l4], ['announce', b1], ['release', rb]]) {
      const declared = (views[act] || []).filter((k) => !ENVELOPE.includes(k) && k !== 'error').sort()
      const actual = business(receipt).sort()
      const d = drift(declared, actual)
      check(declared.length > 0 && d.declaredOnly.length === 0 && d.actualOnly.length === 0,
        'action:' + act + ' 的真回执键 == 协议声明的视图'
        + (d.declaredOnly.length || d.actualOnly.length
          ? '（声明独有 ' + JSON.stringify(d.declaredOnly) + '，实际独有 ' + JSON.stringify(d.actualOnly) + '）'
          : ''))
    }
    // 判据自证：同一支 drift 对纯合成样本也必须在两个方向各自报红（不带真数据 —— 真数据漂了时这两条不该跟着红）。
    check(drift(['A_FIELD', 'B_FIELD'], ['A_FIELD', 'C_FIELD']).declaredOnly.join() === 'B_FIELD',
      '判据自证：能抓到「协议写了但工具没有」')
    check(drift(['A_FIELD', 'B_FIELD'], ['A_FIELD', 'C_FIELD']).actualOnly.join() === 'C_FIELD',
      '判据自证：能抓到「工具有了协议没写」')

    // 条目形状同样同源：协议 work.entry 的键 == 真条目的键 − 读时派生键。
    const entryDeclared = Object.keys(seg.entry || {})
    const DERIVED = ['alive', 'ageMs', 'stale', 'released']
    const realKeys = Object.keys(l4.entries[0] || {})
    check(entryDeclared.length > 0, 'work 段带条目字段清单（抓不到说明判据失配，不是「没问题」）')
    check(entryDeclared.every((k) => realKeys.includes(k)), 'work.entry 的每个字段都真的在条目里')
    check(realKeys.filter((k) => !entryDeclared.includes(k)).every((k) => DERIVED.includes(k)),
      '条目的真键 == work.entry 的键 + 读时派生键（alive / ageMs / stale / released）')

    check(proto.version === 9 && proto.spec === 'dsh-github-resident/9',
      '协议号 bump 到 /9（实得 ' + proto.spec + '）')
    check(Object.prototype.hasOwnProperty.call(proto, 'work') === true, '协议顶层真的有 work 段（不是只写进注释）')
  })
} finally {
  if (savedSession === undefined) delete process.env.DSH_SESSION_ID
  else process.env.DSH_SESSION_ID = savedSession
  if (savedTtl === undefined) delete process.env.DSH_GH_WORK_TTL_MS
  else process.env.DSH_GH_WORK_TTL_MS = savedTtl
}

note('账文件是**追加式 JSONL**、读时折叠（见 plugin.js 里 WORK_LEDGER_VIEWS 旁边的选型说明）：')
note('并发 announce 谁都不会覆盖谁；唯一的残窗是「写一半的残行」—— 折叠时计入 malformed 如实报出，不静默。')
note('本用例不跑任何重活、不联网：全是合成环境里的工具调用与账文件比对。')

cleanup()
summary()
