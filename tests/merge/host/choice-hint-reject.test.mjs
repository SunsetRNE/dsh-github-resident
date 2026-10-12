/**
 * tests/merge/host/choice-hint-reject.test.mjs —— `choiceStore.hint.reject` 落点的行为回归（合并期补回）。
 *
 * 为什么有它：`verify-log-fields.js` / `verify-log-count.js` 都把这条按需事件登记在册，
 * 但 #1003 删掉「客户端上报选择优先」那套判定之后，落点也一起没了，两个门禁因此长期为红
 * （在只读参考源仓 `3b25cd3f` 上同样红，属合并前既有红，不是合并回归）。
 * 诊断结论是「正确的新语义 + 登记没跟上」，处置是**把落点补回附录指定的位置**
 * （`src/host/tracker/detection/detectionService.js` 的 detect），而不是删掉登记：
 * 「客户端手里那版比宿主记的旧、因此被顶回」是排查「刚选完怎么又变回去了」的唯一轨迹。
 *
 * 这里真调 createDetectionService（无 decideBackend / 无 platform / 无 fs 的诚实空环境），断言：
 *   1. 上报的 baseRev 比宿主记的 rev 旧 → 记一条 choiceStore.hint.reject，三字段恰好 keyHash/baseRev/rev；
 *   2. 上报的 baseRev 与宿主相同或更新 → 不记；
 *   3. 没带上报（模型/调用方没给 hint）→ 不记；
 *   4. 调试开关关着 → 不记，而且**不读那份记忆文件**（热路径零额外开销）；
 *   5. 输出里不含工作区路径原文（只记散列）。
 *
 * 隔离：不读真实 HOME、不连网、不写盘、不绑端口。fake choiceStore 只为本次调用服务。
 *
 * 用法：node tests/merge/host/choice-hint-reject.test.mjs
 */
import { check, importRel, note, section, summary } from './_check.mjs'

const mod = await importRel('deck/src/host/tracker/detection/detectionService.js')
const createDetectionService = mod.createDetectionService || mod.default

section('1) 装配一个诚实空环境（无 platform / fs / 判定出口）')
check(typeof createDetectionService === 'function', 'createDetectionService 可导入且是函数')

const CWD = '/tmp/merge-hint-workspace'
const STORED_REV = 5
const KEY_HASH = 'a'.repeat(24)

function makeLogCtx(enabled) {
  const events = []
  return {
    events,
    enabled,
    isEnabled: (level) => enabled === true && level === 'debug',
    fire: (level, name, fields) => { events.push({ level, name, fields }) },
  }
}

function makeChoiceStore(log) {
  const state = { reads: 0 }
  return {
    state,
    store: {
      async getWorkspace() {
        state.reads += 1
        return { ok: true, found: true, backendId: 'github', rev: STORED_REV, pickedAt: 1, keyHash: KEY_HASH }
      },
      async getLayout() { return { ok: true, found: false, reason: 'miss' } },
    },
  }
}

const registry = {
  has: () => true,
  get: () => null,
  describe: () => null,
  select: async () => null,
}

async function runDetect(opts, log) {
  const cs = makeChoiceStore(log)
  const svc = createDetectionService({
    registry,
    getChoiceStore: async () => cs.store,
    logCtx: log,
    // 刻意不给 getPlatform / getFs / decideBackend：与「工作区还没就绪」的诚实空环境一致。
  })
  const result = await svc.detect({ cwd: CWD }, opts)
  return { result, cs, hints: log.events.filter((e) => e.name === 'choiceStore.hint.reject') }
}

section('2) 旧 hint 被顶回 → 记一条（三字段）')
{
  const log = makeLogCtx(true)
  const { hints, cs } = await runDetect({ backendId: 'github', baseRev: 3 }, log)
  check(hints.length === 1, '记了恰好一条 choiceStore.hint.reject（实际 ' + hints.length + '）')
  const f = hints[0] && hints[0].fields
  check(!!f && JSON.stringify(Object.keys(f).sort()) === JSON.stringify(['baseRev', 'keyHash', 'rev']), '字段恰好 keyHash/baseRev/rev（实际 ' + JSON.stringify(f && Object.keys(f).sort()) + '）')
  check(!!f && f.baseRev === 3 && f.rev === STORED_REV, 'baseRev=3 / rev=' + STORED_REV + '（实际 ' + JSON.stringify([f && f.baseRev, f && f.rev]) + '）')
  check(!!f && f.keyHash === KEY_HASH, 'keyHash 用的是 choiceStore 交回的工作区散列')
  check(hints[0].level === 'debug', '级别是调试级（按需事件，不常年在场）')
  check(cs.state.reads === 1, '这一次只读了一次记忆（readChoiceNow 记忆化）')
  check(!JSON.stringify(hints).includes(CWD), '事件里不含工作区路径原文（只记散列）')
}

section('3) 老客户端没带修订号但宿主记着 → 同样记一条')
{
  const log = makeLogCtx(true)
  const { hints } = await runDetect({ backendId: 'github' }, log)
  check(hints.length === 1 && hints[0].fields.baseRev === 0 && hints[0].fields.rev === STORED_REV, 'baseRev 缺失按 0 记（旧客户端那一档）')
}

section('4) 不旧 / 没上报 → 不记')
{
  const log = makeLogCtx(true)
  const same = await runDetect({ backendId: 'github', baseRev: STORED_REV }, log)
  check(same.hints.length === 0, '上报的 rev 与宿主相同 → 不记（实际 ' + same.hints.length + '）')
  const newer = await runDetect({ backendId: 'github', baseRev: STORED_REV + 1 }, log)
  check(newer.hints.length === 0, '上报的 rev 比宿主新 → 不记（实际 ' + newer.hints.length + '）')
  const none = await runDetect({}, log)
  check(none.hints.length === 0, '完全没有 hint → 不记（实际 ' + none.hints.length + '）')
}

section('5) 调试开关关着 → 不记，且不读记忆文件（热路径零额外开销）')
{
  const log = makeLogCtx(false)
  const { hints, cs } = await runDetect({ backendId: 'github', baseRev: 1 }, log)
  check(hints.length === 0, '调试关着不记（实际 ' + hints.length + '）')
  check(cs.state.reads === 0, '调试关着时不读那份记忆（实际读 ' + cs.state.reads + ' 次）')
}

section('6) 宿主没有这条记忆 → 不记')
{
  const log = makeLogCtx(true)
  const svc = createDetectionService({
    registry,
    getChoiceStore: async () => ({ async getWorkspace() { return { ok: true, found: false, reason: 'miss' } } }),
    logCtx: log,
  })
  await svc.detect({ cwd: CWD }, { backendId: 'github', baseRev: 1 })
  check(log.events.filter((e) => e.name === 'choiceStore.hint.reject').length === 0, '没有记忆可顶回 → 不记')
}

note('落点文件：deck/src/host/tracker/detection/detectionService.js 的 detect（与 489 附录 #72 的落点一致）')
summary()
