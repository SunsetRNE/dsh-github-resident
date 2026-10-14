/**
 * tests/merge/host/tool-surface-contract.test.mjs —— 工具面与协议**同源**契约
 *
 * 为什么需要它：「本包有哪些工具、各带什么参数、对外协议怎么写」这件事，在合并包里曾经散在
 * 多份**手写副本**里，副本之间没有任何机器判据 —— 于是实际漂移过（都不是猜的，是实测）：
 *   - `TOOL_PROTOCOL` 说 `gh_protocol` 返回里有 `host` 键（真键是 `service`，且漏了 spec/envelope/registry/guarantees）；
 *   - `gh_cli_logout.optional` 漏了 `remove_gh_cache`（工具 schema 与实现里都真有）；
 *   - `service.methods[status].returns` 写的是**工具** gh_resident_status 的形状，而服务方法走 statePayload；
 *   - `serviceApi` 里 `version` 键写了两次（对象字面量后写者胜，协议号那行被静默丢掉）；
 *   - `http.base` 写死 31790，而真实端口读 `DSH_GH_API_PORT`；
 *   - 第二个服务 `ghResolver` 已在被 deck 半边消费，却从没登记进 `service.alsoProvided`；
 *   - 错误码表 9 条里 7 条从未出现，而真实出现的 3 条（E_ORIGIN 族）没登记；
 *   - deck 侧工具清单有 4 份副本（`DECK_TOOL_FILES`、行模块的 import、行模块的 `SEVEN` 常量、
 *     门禁里的 `SEVEN_NAMES`），其中两个常量名叫「七」而实际装了九个。
 *
 * 本文件把**副本**钉到**真源**上。真源各占一边，互不重复：
 *   gh 侧   = `plugin.js` 里 `textTool({ toolName, parameters })` 的**实际注册**（跑 apply 抓，不看源码文本）；
 *   deck 侧 = `deck/src/host/tools/*.js` 各自的 `definition`（跑行模块 apply 抓）。
 * 副本：`TOOL_PROTOCOL`、`PROTOCOL.service`、`ERROR_CODES`、`DECK_TOOL_FILES`、行模块的名字清单。
 *
 * 2026-10-14 追加（协议 `identity` / `environment` 两段）：两段的字段清单**从 `TOOL_PROTOCOL` 派生**，
 * 第四段再把这条链钉死 —— `段.fields == 表行.returns == 工具真实回执键`（最后一环在合成环境里**离线跑工具**取到），
 * 并且判据自带两个方向的合成样本（协议多写 / 工具多回），证明它抓得住漂移。
 *
 * 隔离：一~三段只读本仓文件、不起真进程；第四段在 `_env-harness` 的**合成环境**里跑三个只读工具
 * （假 HOME、夹具 bin、探针目标列表清空），全程**不起真实外网请求、不读真实 HOME**。
 * 用法：node tests/merge/host/tool-surface-contract.test.mjs
 */
import { check, note, section, summary, importRel, readText } from './_check.mjs'
import { makeHome, withPlugin } from './_env-harness.mjs'

const MERGED_PACKAGE_NAME = '@sunsetrne/dsh-github-resident-v2'

// ---------------------------------------------------------------------------
// 一、gh 侧：协议表 vs 真实注册
// ---------------------------------------------------------------------------
section('一、gh 侧：TOOL_PROTOCOL 与真实注册同源')

/** 跑 plugin.js 的 apply，抓注册面 + Host Service + 自描述协议。假 ctx 只具备注册所必需的能力。 */
async function captureResident() {
  const mod = await importRel('plugin.js')
  const tools = []
  const provided = new Map()
  const ctx = {
    tools: { register: (t) => { tools.push(t); return () => {} } },
    get: () => undefined,
    effect: () => {},
    inject: () => {},
    provide: (key, api) => { provided.set(key, api) },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }
  await mod.apply(ctx)
  const protoTool = tools.find((t) => t.name === 'gh_protocol')
  const protocol = protoTool ? await protoTool.execute({}, {}) : null
  return { mod, tools, provided, protocol }
}

let resident = null
try {
  resident = await captureResident()
} catch (e) {
  check(false, 'plugin.js 的 apply 可跑（' + String((e && e.message) || e).slice(0, 160) + '）')
}
if (resident) {
  const { tools, provided, protocol } = resident
  check(!!protocol, 'gh_protocol 可调用（协议文档拿得到）')
  const decl = protocol && Array.isArray(protocol.tools) ? protocol.tools : []
  const regNames = tools.map((t) => t.name).sort()
  const declNames = decl.map((t) => t.name).sort()

  check(new Set(regNames).size === regNames.length, '注册面没有重名工具（' + regNames.length + ' 个）')
  check(JSON.stringify(declNames) === JSON.stringify(regNames),
    '协议表的名字集合 == 真实注册的名字集合'
    + (JSON.stringify(declNames) === JSON.stringify(regNames) ? '' : '（协议独有 ' + declNames.filter((n) => !regNames.includes(n)) + '，注册独有 ' + regNames.filter((n) => !declNames.includes(n)) + '）'))

  // 每个工具的 required/optional：以 parameters 为真源，协议表是副本
  let shapeDrift = 0
  for (const d of decl) {
    const t = tools.find((x) => x.name === d.name)
    if (!t) { shapeDrift += 1; continue }
    const props = (t.parameters && t.parameters.properties) || {}
    const reqReal = ((t.parameters && t.parameters.required) || []).slice().sort()
    const optReal = Object.keys(props).filter((k) => !reqReal.includes(k)).sort()
    const reqDecl = (d.required || []).slice().sort()
    const optDecl = (d.optional || []).slice().sort()
    const same = JSON.stringify(reqReal) === JSON.stringify(reqDecl) && JSON.stringify(optReal) === JSON.stringify(optDecl)
    if (!same) {
      shapeDrift += 1
      note(d.name + ' 参数漂移：协议 required=' + JSON.stringify(reqDecl) + ' 实际=' + JSON.stringify(reqReal)
        + ' ｜协议 optional=' + JSON.stringify(optDecl) + ' 实际=' + JSON.stringify(optReal))
    }
  }
  check(shapeDrift === 0, '每个工具的 required/optional 与声明一致（漂移 ' + shapeDrift + ' 个）')

  // gh_protocol 自己的 returns 不能少报（信封另外加的 protocol/ok 不算）
  const envelopeKeys = ['protocol', 'ok']
  const actualProtoKeys = Object.keys(protocol || {}).filter((k) => !envelopeKeys.includes(k)).sort()
  const selfDecl = decl.find((d) => d.name === 'gh_protocol')
  const declaredReturns = selfDecl ? (selfDecl.returns || []).slice().sort() : []
  check(declaredReturns.length > 0 && actualProtoKeys.every((k) => declaredReturns.includes(k)),
    'gh_protocol 声明的 returns 覆盖它真实返回的每个键（缺 ' + actualProtoKeys.filter((k) => !declaredReturns.includes(k)) + '）')

  // -------------------------------------------------------------------------
  // 二、Host Service 与 http 面
  // -------------------------------------------------------------------------
  section('二、Host Service 与回环面：声明 == 实现')

  const svc = protocol && protocol.service ? protocol.service : {}
  const methods = Array.isArray(svc.methods) ? svc.methods.map((m) => m.name).sort() : []
  const api = provided.get('githubResident')
  check(!!api, '本插件提供了 githubResident 服务')
  if (api) {
    // id / protocolVersion 是元数据，不是可调方法
    const META_KEYS = ['id', 'protocolVersion']
    const realMethods = Object.keys(api).filter((k) => !META_KEYS.includes(k)).sort()
    check(JSON.stringify(methods) === JSON.stringify(realMethods),
      'service.methods 的方法集合 == 服务对象的可调键集合'
      + (JSON.stringify(methods) === JSON.stringify(realMethods) ? '' : '（声明 ' + methods + '，实际 ' + realMethods + '）'))
    check(typeof api.protocolVersion === 'number', '服务暴露 protocolVersion（协议号不再被同名方法挤掉）')
    check(typeof api.version === 'function', '服务上的 version 仍是版本体检方法（原语义未丢）')
  }
  const providedKeys = [...provided.keys()].sort()
  const declaredKeys = [svc.key].concat((svc.alsoProvided || []).map((x) => x.key)).sort()
  check(JSON.stringify(providedKeys) === JSON.stringify(declaredKeys),
    'ctx 上真实 provide 的服务集合 == 协议声明的集合（真实 ' + JSON.stringify(providedKeys) + '）')

  check(typeof svc.consume === 'string' && svc.consume.indexOf(MERGED_PACKAGE_NAME) < 0, 'consume 示例不写死机器路径')
  const base = (protocol && protocol.http && protocol.http.base) || ''
  check(base.indexOf('127.0.0.1') >= 0, 'http.base 指向回环（' + base + '）')
  const portFromEnv = String((protocol && protocol.http && protocol.http.base || '').split(':').pop())
  check(/^\d+$/.test(portFromEnv), 'http.base 报的是端口数字（不是写死的字面量）')

  // 错误码：真实出现在源码里的码都要在表里。
  // 判据只认**带引号的**码（'E_X' 或 'E_X：文案'）—— 不加这个边界，"PROBE_TTL_MS" 这类
  // 长标识符的子串也会被当成码抓进来（实测误报过 E_TTL_MS / E_DIR / E_URL 一串）。
  const src = readText('plugin.js')
  const tableCodes = Object.keys((protocol && protocol.errors) || {}).sort()
  const usedCodes = [...new Set([...src.matchAll(/['"](E_[A-Z][A-Z_]*)['"：:]/g)].map((m) => m[1]))].sort()
  const missing = usedCodes.filter((c) => !tableCodes.includes(c))
  check(missing.length === 0, '源码里出现的错误码都在协议表里（缺 ' + JSON.stringify(missing) + '）')
}

// ---------------------------------------------------------------------------
// 三、deck 侧：四份清单副本钉到 definition 真源
// ---------------------------------------------------------------------------
section('三、deck 侧：DECK_TOOL_FILES / 行模块 / 门禁清单同源')

const assembly = await importRel('deck/src/host/platform/deckToolsAssembly.js')
const files = (assembly.DECK_TOOL_FILES || []).slice()
check(files.length > 0, 'DECK_TOOL_FILES 拿得到（' + files.length + ' 个文件）')
check(new Set(files).size === files.length, 'DECK_TOOL_FILES 无重复条目')

// 每条都真实存在，且各自导出一个 definition
const defs = []
for (const rel of files) {
  const m = await importRel('deck/' + rel)
  if (m && m.definition && m.definition.name) defs.push(m.definition)
  else note(rel + ' 没有导出可用的 definition')
}
check(defs.length === files.length, 'DECK_TOOL_FILES 的每个文件都导出 definition（' + defs.length + '/' + files.length + '）')

// 行模块实际注册的名字（真源：apply 的输出）
const row = await importRel('deck/src/host/platform/deckToolsRow.js')
const registered = []
const rowSvc = { register: (t) => { registered.push(t); return () => {} } }
let rowError = null
try { row.apply({ tools: rowSvc, get: () => undefined, effect: () => {} }) } catch (e) { rowError = e }
check(!rowError, '行模块可 apply（' + String((rowError && rowError.message) || '').slice(0, 120) + '）')

const rowNames = registered.map((t) => t.name).sort()
const defNames = defs.map((d) => d.name).sort()
check(JSON.stringify(rowNames) === JSON.stringify(defNames.concat(['deck_probe']).sort()),
  '行模块注册的名字 == definition 真源 + 探针'
  + (JSON.stringify(rowNames) === JSON.stringify(defNames.concat(['deck_probe']).sort()) ? '' : '（行 ' + rowNames + '，真源 ' + defNames + '）'))

// 门禁里的名字清单（第四份副本）必须与真源一致。
// 判据**不依赖变量名**：那份清单改过名（SEVEN_NAMES → DECK_TOOL_NAMES，因为「七」而实装九个），
// 绑变量名的正则会在改名时静默失配、把空集合当成「一致」。这里只认「文件里提到的 deck_* 名字」。
const zeroDepSrc = readText('deck/tests/verify-deck-tools-row-zero-dep.js')
const gateNames = [...new Set([...zeroDepSrc.matchAll(/'(deck_[a-z_]+)'/g)].map((m) => m[1]))].sort()
const expectGate = defNames.concat(['deck_probe']).sort()
check(gateNames.length > 0, '门禁里的名字清单抓得到（' + gateNames.length + ' 个，0 个说明判据失配而不是一致）')
check(JSON.stringify(gateNames) === JSON.stringify(expectGate),
  'verify-deck-tools-row-zero-dep 提到的名字集合 == definition 真源 + 探针（' + gateNames.length + ' vs ' + expectGate.length + '）')

// 行模块的 import 条数 == 清单条数（结构性：多一条少一条都会在这里露出来）
const rowSrc = readText('deck/src/host/platform/deckToolsRow.js')
const rowImports = [...rowSrc.matchAll(/import \{ definition as \w+ \} from '\.\.\/tools\/(\w+)\.js'/g)].map((m) => m[1])
check(rowImports.length === files.length,
  '行模块 import 的工具文件数 == DECK_TOOL_FILES 条数（' + rowImports.length + ' vs ' + files.length + '）')

// ---------------------------------------------------------------------------
// 四、协议 identity / environment 两段 ↔ 工具真返回（合成环境里离线跑，双向可抓）
// ---------------------------------------------------------------------------
section('四、identity / environment 两段 ↔ 工具真返回（合成环境里离线跑）')

// 判据变更要写明理由（票「协议号 bump：新增 `load` 段后 `dsh-github-resident/7 → /8`（票 30 已裁未做）」）：
// 本仓的协议增量规矩是「给已有段加字段＝兼容（不动 version），**新增段才 bump**」（同一句写在
// `guarantees.protocolIncrements` 里）。票「重活租约：同一台机器上的全量门禁一次只许一份（协议 + 工具 +
// runner 自锁）」给协议**新增了 `load` 段**，按这条规矩协议号就该从 `/7` 涨到 `/8` —— 上一步漏了，
// 本行跟着 `plugin.js` 的 `PROTOCOL_VERSION` 一起补上。
// 说清这条字面量**管什么、不管什么**：它管的是**两份副本彼此一致**（`plugin.js` 的号 ↔ 这里钉的号），
// 只改一处会红；它**抓不到**「加了段忘了 bump」—— 那次两份副本一起停在 `/7`，这条判据照样绿，正是本票的来由。
// 后一种判据另有其人：《协议「新增段忘了 bump」要有一条机器判据（本轮靠人肉才发现）》，不在本票边界内。
const EXPECT_SPEC = 'dsh-github-resident/8'

/** 双向漂移：declaredOnly = 协议写了但工具没有；actualOnly = 工具有了协议没写。 */
const drift = (declared, actual) => ({
  declaredOnly: declared.filter((k) => !actual.includes(k)),
  actualOnly: actual.filter((k) => !declared.includes(k)),
})

// 信封（ok / protocol）不算业务字段：比的是「工具自己那几段」。
const ENVELOPE_KEYS = ['ok', 'protocol']
const businessKeys = (receipt) => Object.keys(receipt || {}).filter((k) => !ENVELOPE_KEYS.includes(k))

// 两段只允许**描述性**键：谁要是把 login / masked / token 这类**取值**键塞进协议，这条会挡住 ——
// 协议是描述，不是「跑这份协议这台机器」的快照。
const DESCRIPTIVE_KEYS = ['what', 'sourceOfTruth', 'priority', 'points', 'pointsNote', 'subprocessIdentity', 'fieldsFrom', 'fields', 'readers', 'tool', 'boundsNote', 'boundary', 'actions', 'views']  // subprocessIdentity：票 #37 加的「子进程身份能说到哪」那句（描述性，如实登记）

const surfaceHome = makeHome('surface', { withGh: true })
let surface = null
try {
  surface = await withPlugin(surfaceHome.home, { path: surfaceHome.path, dataDir: surfaceHome.home + '/.dsh/gh-cli' }, async ({ tool }) => {
    const protocol = await tool('gh_protocol').execute({}, {})
    const identity = await tool('gh_identity').execute({}, {})
    // 探针：**目标列表清空 + 小上界** —— 这条判据只取形状、不取结论，所以不起任何真实外网请求。
    const environment = await tool('gh_env_probe').execute({ network_targets: [], attempts: 1, timeout_ms: 500 }, {})
    // gh_identity 是动作式工具（2026-10-14 起）：写/读动作也各取一份真回执 —— 形状判据要覆盖它们。
    // 动作都在**夹具的假 HOME** 里跑：wire 改的是假 gitconfig、写的是假数据目录，碰不到真宿主。
    // email 取的是**不带 email 的只读那一档**（报现在存的是什么），因此在夹具里也一个字节都不写。
    const actions = {
      wire: await tool('gh_identity').execute({ action: 'wire', consent: true }, {}),
      verify: await tool('gh_identity').execute({ action: 'verify' }, {}),
      unwire: await tool('gh_identity').execute({ action: 'unwire', consent: true }, {}),
      email: await tool('gh_identity').execute({ action: 'email' }, {}),
    }
    return { protocol, identity, environment, actions }
  })
} catch (e) {
  check(false, '合成环境里跑只读工具与接线动作（' + String((e && e.message) || e).slice(0, 160) + '）')
} finally {
  surfaceHome.cleanup()
}

if (surface) {
  const { protocol: p, identity, environment, actions } = surface
  const rowOf = (name) => ((p.tools || []).find((t) => t.name === name) || {}).returns || []
  const sorted = (a) => a.slice().sort()

  check(p.spec === EXPECT_SPEC, '协议 spec 是本次增量后的字面量（期望 ' + EXPECT_SPEC + '，实得 ' + p.spec + '）')
  check(!!p.identity && !!p.environment, '协议里有 identity / environment 两段')
  check(rowOf('gh_protocol').includes('identity') && rowOf('gh_protocol').includes('environment'),
    '协议表里 gh_protocol 那行声明了这两段（否则「声明的 returns 覆盖真实返回键」那条会红）')

  for (const { seg, tool, receipt, singleView } of [
    { seg: 'identity', tool: 'gh_identity', receipt: identity, singleView: false },
    { seg: 'environment', tool: 'gh_env_probe', receipt: environment, singleView: true },
  ]) {
    const segment = p[seg] || {}
    const fields = Array.isArray(segment.fields) ? segment.fields : []
    const declared = rowOf(tool)
    const actual = businessKeys(receipt)

    check(fields.length > 0, seg + ' 段带字段清单（形状 A：列顶层段名，不递归到子字段）')
    check(JSON.stringify(sorted(fields)) === JSON.stringify(sorted(actual)),
      seg + ' 段的字段清单 == ' + tool + ' **该动作**的真返回键（两个方向都能抓）')
    if (singleView) {
      check(JSON.stringify(sorted(fields)) === JSON.stringify(sorted(declared)),
        seg + ' 段的字段清单 == 协议表里 ' + tool + ' 那行（同一真源派生，不是手抄的第二份）')
    } else {
      check(fields.every((k) => declared.includes(k)),
        seg + ' 段的字段清单 ⊆ 协议表里 ' + tool + ' 那行（那行是**动作视图的并集**，见下）')
    }
    const d = drift(fields, actual)
    check(d.declaredOnly.length === 0 && d.actualOnly.length === 0,
      seg + ' 段 ↔ ' + tool + ' 真返回：两个方向都无漂移'
      + (d.declaredOnly.length || d.actualOnly.length
        ? '（协议独有 ' + JSON.stringify(d.declaredOnly) + '，工具独有 ' + JSON.stringify(d.actualOnly) + '）'
        : ''))
    // 判据自证：同一支 drift 对**纯合成样本**也必须在两个方向各自报红。
    // 样本刻意不带真数据 —— 真数据漂了的时候，这两条不该跟着红（那会淹掉真正的信号）。
    const SAMPLE_A = ['A_FIELD', 'B_FIELD']
    const SAMPLE_B = ['A_FIELD', 'C_FIELD']
    check(drift(SAMPLE_A, SAMPLE_B).declaredOnly.join() === 'B_FIELD',
      seg + '：判据能抓到「协议写了但工具没有」')
    check(drift(SAMPLE_A, SAMPLE_B).actualOnly.join() === 'C_FIELD',
      seg + '：判据能抓到「工具有了协议没写」')

    const stray = Object.keys(segment).filter((k) => !DESCRIPTIVE_KEYS.includes(k))
    check(stray.length === 0, seg + ' 段的键都是描述性的（越界键 ' + JSON.stringify(stray) + '）')
    const readers = segment.readers || {}
    const readerNames = Object.keys(readers)
    check(readerNames.length >= 4 && readerNames.every((k) => typeof readers[k] === 'string' && readers[k].length >= 8),
      seg + ' 段写清了谁该读、读了干什么（' + readerNames.length + ' 类读者）')
  }

  // identity 段列的四个消费点 == gh_identity 真回执里的 point 名（同一事实，两处说法要对得上）
  const segPoints = (p.identity && p.identity.points) || []
  const realPoints = (identity.points || []).map((x) => x.point)
  check(JSON.stringify(sorted(segPoints)) === JSON.stringify(sorted(realPoints)),
    'identity 段的 points == gh_identity 真返回的 points[].point（' + JSON.stringify(segPoints) + '）')

  // ---- 动作式工具的那一层：每个动作各自的字段清单，同样一处声明、同样钉到真回执上 ----
  const views = (p.identity && p.identity.views) || {}
  const actionNames = (p.identity && p.identity.actions) || []
  check(JSON.stringify(sorted(actionNames)) === JSON.stringify(['audit', 'email', 'unwire', 'verify', 'wire']),
    'identity 段列出五个动作（' + JSON.stringify(actionNames) + '）')
  const viewUnion = [...new Set(Object.values(views).flat())]
  check(JSON.stringify(sorted(viewUnion)) === JSON.stringify(sorted(rowOf('gh_identity'))),
    '协议表 gh_identity 那行 == 五个动作视图的**并集**（同一处声明派生，不是手抄）')
  check(JSON.stringify(sorted(views.audit || [])) === JSON.stringify(sorted(businessKeys(identity))),
    'views.audit == 默认动作（体检）的真返回键')

  for (const act of ['wire', 'verify', 'unwire', 'email']) {
    const receipt = actions[act]
    const actual = businessKeys(receipt)
    const declared = views[act] || []
    // `error` 是失败回执的通用键（信封级），不计入视图比对。
    const d = drift(declared, actual.filter((k) => k !== 'error'))
    check(declared.length > 0 && d.declaredOnly.length === 0 && d.actualOnly.length === 0,
      'action:' + act + ' 的真返回键 == 协议里声明的视图'
      + (d.declaredOnly.length || d.actualOnly.length
        ? '（声明独有 ' + JSON.stringify(d.declaredOnly) + '，实际独有 ' + JSON.stringify(d.actualOnly) + '）'
        : ''))
  }

  note('本段只覆盖**能在合成环境里离线跑**的工具与动作（gh_protocol / gh_identity 五动作 / gh_env_probe）：')
  note('需要出网的工具跑不了离线，这条判据不覆盖它们 —— 不假装覆盖。')
  note('gh_pr 自《gh_pr 共用解析器 + 回落 gh pr create》起两条路都能离线实跑（REST 换掉 fetch、回落走 gh 桩），'
    + '它的「协议表那行 == 真回执键并集」由 tests/merge/host/pr-fallback.test.mjs 钉住，不在这里重复。')
}

summary()
