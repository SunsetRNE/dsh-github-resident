#!/usr/bin/env node
/**
 * tests/merge/host/map-tickets-level.test.mjs ——
 * 票《地图漏斗「票全挤进第一层」：按需取的子票行没带 level，与快照那条路不一致》的判据。
 *
 * 事故形状（2026-10-14 维护者报告 + 源码逐点核过）：面板漏斗按**每票自己的** `t.level` 摆放
 * （`deck/src/client/views/MapDetail.js` 的 byLevel：缺了就当第 0 层），而子票有**两条来路**：
 *   - 快照那条挂了层号（`snapshotBuild.js`：`tickets.forEach(t => t.level = lvInfo.byNumber[t.number])`）；
 *   - 按需取那条（宿主电话 `wf.mapTickets`）只回 `stats`、不回每票的层号。
 * 面板首选按需取那份 → 实时数据一到，全部票被当成第 0 层：第 1 层挤满、上面几层只剩空盒子。
 *
 * 本文件钉三件事：
 *   1) **每行都带层号**，且与 `stats.levelOf` 逐项一致；
 *   2) **两条来路一致**：同一份子票数据，快照那条路（`computeLevels`）与按需取那条路给出同一个层号；
 *   3) 自证「塌成一层」真的会被抓到（把层号摘掉，客户端的分桶就只剩一层）+ 边界（非数字键的行不硬套层号）。
 *
 * 全离线：后端、注册表、平台全是夹具，不起进程、不读 HOME、不看跑门禁这台机器有什么。
 *
 * 用法：node tests/merge/host/map-tickets-level.test.mjs
 */
import { check, importRel, note, readText, section, summary } from './_check.mjs'

/** 子票行：一张有依赖链的小地图（层 0/1/2/3 各有票）+ 一行没有数字键的（边界）。 */
const ROWS = [
  { key: '25', state: 'closed', blockedBy: [] },
  { key: '27', state: 'closed', blockedBy: [] },
  { key: '23', state: 'closed', blockedBy: [{ key: '25' }] },
  { key: '19', state: 'closed', blockedBy: [{ key: '25' }, { key: '23' }] },
  { key: '20', state: 'open', blockedBy: [{ key: '19' }, { key: '27' }] },
  { key: 'note-1', state: 'open', blockedBy: [] },
]
const EXPECT = { 25: 0, 27: 0, 23: 1, 19: 2, 20: 3 }

/** 面板那边的分桶口径（逐字照抄 MapDetail.js 的 byLevel）：缺层号一律当第 0 层。 */
function clientBuckets(tickets) {
  const byLevel = {}
  tickets.forEach(function (t) {
    const lv = (typeof t.level === 'number') ? t.level : 0
    ;(byLevel[lv] = byLevel[lv] || []).push(t.number)
  })
  return byLevel
}

const grouping = (await importRel('deck/src/host/ticketGrouping.js')).createTicketGrouping()
const mtMod = await importRel('deck/src/host/mapTickets.js')

/** 造一条电话：后端给固定那几行，其余依赖全用夹具。 */
async function callPhone(rows) {
  const phone = mtMod.createMapTickets({
    canonicalKey: async (p) => p,
    selectEarly: async () => ({ backendId: 'github' }),
    isComposerSelection: () => true,
    getTrackerRegistry: async () => ({
      get: () => ({ listSubIssues: async () => ({ ok: true, data: { items: rows.map((r) => Object.assign({}, r)), total: rows.length, fetched: rows.length } }) }),
      describe: () => ({ backend: 'github', refId: 'SunsetRNE/dsh-github-resident', name: 'dsh-github-resident', url: '' }),
    }),
    getPlatform: async () => ({}),
    ctx: { get: () => ({}) },
    DEFAULT_CWD: '/tmp/ws',
    logCtx: null,
    groupTickets: grouping.groupTickets,
    getMapBody: async () => ({ parseProgress: () => null }),
    detectionExec: async () => ({ stdout: '', stderr: '', code: 0 }),
  })
  return await phone.handleMapTickets({ cwd: '/tmp/ws', key: '16' })
}

// ---------------------------------------------------------------------------
section('1) 按需取那条路：每一行都带自己的层号，且与 stats.levelOf 一致')

const r = await callPhone(ROWS)
check(r && r.ok === true, '电话回 ok（实得 ' + String(r && r.ok) + '）')
const items = (r && Array.isArray(r.items)) ? r.items : []
const numeric = items.filter(function (t) { return t.number != null })
check(items.length === ROWS.length, '子票都带回来了（实得 ' + items.length + ' / ' + ROWS.length + '）')
check(numeric.length === 5, '其中 5 行有数字键（另一行是非数字键的边界样本）')
check(numeric.every(function (t) { return typeof t.level === 'number' }), '每一行都有数字层号（缺一个就是面板塌成一层的原样复发）')

const wrong = numeric.filter(function (t) { return t.level !== EXPECT[t.number] })
check(wrong.length === 0, '每行的层号都对（错的是：' + (wrong.map(function (t) { return '#' + t.number + '→' + t.level }).join(', ') || '无') + '）')

const levelOf = (r && r.stats && r.stats.levelOf) || {}
const mismatch = numeric.filter(function (t) { return t.level !== levelOf[t.number] })
check(mismatch.length === 0, '每行的层号与 stats.levelOf 逐项一致（不一致的行：' + (mismatch.map(function (t) { return '#' + t.number }).join(', ') || '无') + '）')
check(Array.isArray(r.stats && r.stats.levels) && r.stats.levels.length === 4, '层列表仍是 4 层（层列表本来就是对的，坏的是每行的层号）')

// ---------------------------------------------------------------------------
section('2) 两条来路一致：快照那条（computeLevels）与按需取那条给同一个答案')

const snapshotTickets = ROWS.map(function (row) {
  const t = Object.assign({}, row)
  t.number = parseInt(t.key, 10)
  t.state = String(t.state).toUpperCase()
  t.blockedBy = (t.blockedBy || []).map(function (b) { return (b && typeof b === 'object') ? String(b.key) : String(b) })
  return t
})
const lvInfo = grouping.computeLevels(snapshotTickets)
snapshotTickets.forEach(function (t) { t.level = lvInfo.byNumber[t.number] })
const snapshotLevels = {}
snapshotTickets.forEach(function (t) { if (t.number != null && !isNaN(t.number)) snapshotLevels[t.number] = t.level })
const crossWrong = Object.keys(snapshotLevels).filter(function (k) { return snapshotLevels[k] !== levelOf[k] })
check(crossWrong.length === 0, '快照那条路与按需取那条路逐项相同（不一致的编号：' + (crossWrong.join(', ') || '无') + '）')
check(levelOf[20] === 3 && levelOf[19] === 2 && levelOf[23] === 1 && levelOf[25] === 0, '依赖链的深度符合口径（25=0 / 23=1 / 19=2 / 20=3）')

// ---------------------------------------------------------------------------
section('3) 自证：塌成一层真的会被这条判据抓到（把层号摘掉，客户端分桶只剩一层）')

const withLevel = clientBuckets(items)
const stripped = items.map(function (t) { const c = Object.assign({}, t); delete c.level; return c })
const withoutLevel = clientBuckets(stripped)
check(Object.keys(withoutLevel).length === 1, '摘掉层号后，客户端的票全挤进第 1 层（分桶数 ' + Object.keys(withoutLevel).length + '）—— 这就是维护者看到的"三层被合成一层"')
check(Object.keys(withLevel).length === 4, '带上层号后，票分布在 4 层里（分桶数 ' + Object.keys(withLevel).length + '）')
check((withoutLevel[0] || []).length === items.length, '摘掉层号时第 1 层拿走了全部 ' + items.length + ' 张票')

// ---------------------------------------------------------------------------
section('4) 边界：非数字键的行不硬套层号（宁可没有，也不安一个错的）')

const odd = items.find(function (t) { return t.key === 'note-1' })
check(!!odd && odd.number == null, '非数字键那行没有被硬编出编号（key=' + String(odd && odd.key) + '）')
check(!!odd && typeof odd.level === 'undefined', '它保持没有层号（不凭空造一个错层号）')

// ---------------------------------------------------------------------------
section('5) 联动口径：界面确实按每票的 t.level 摆放（改了消费侧要回来改这条判据）')

const mapDetailSrc = readText('deck/src/client/views/MapDetail.js')
check(/typeof t\.level === 'number'\)?\s*\?\s*t\.level\s*:\s*0/.test(mapDetailSrc) && mapDetailSrc.includes('byLevel'), 'MapDetail 的 byLevel 仍以每票 t.level 为摆放依据（缺层号当第 0 层）')
check(readText('deck/src/host/snapshotBuild.js').includes('t.level = lvInfo.byNumber[t.number]'), '快照那条路仍挂层号（两条来路的口径都还在）')

note('本用例覆盖：每行带层号 / 与 stats.levelOf 一致 / 两条来路逐项相同 / 塌成一层的对照自证 / 非数字键边界 / 消费侧联动口径。')
note('没覆盖（写清楚，不假装）：真 GitHub 取子票那一段（本文件全用夹具）；面板的实际像素渲染。')

summary()
