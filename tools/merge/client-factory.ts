/**
 * tools/merge/client-factory.ts —— 把 **两个客户端半边** 装进 **一个** `window.__ModuleLoader__.load` factory
 *
 * 为什么需要这一层（旧写法为什么不能交付）：
 *   旧 `rewrite-deck-client.ts` 只把 deck 产物的模块 id 与 inject 改成合并包的值，
 *   产物里始终**只有 Deck 半边**——Resident 的设置页根本不在里面。那不是合并，是换名。
 *   宿主按包名给一个包只建 **一个** 客户端图行，所以「两个 load 各挂一份」也不可能：
 *   第二次 load 会被判重复注册。唯一的落法是把两半的 factory 都塞进同一个 factory。
 *
 * 为什么必须「独立词法作用域」：
 *   两半各自都声明了 `h`、`React`、`ctx`、`StatusBar`… 直接拼进同一个函数体，
 *   后声明的那份会把前一份静默覆盖（就是 N4「闭包重名」那类退化，症状是页面某半边行为漂移）。
 *   这里把每半的 factory 原文各自保留在自己的函数里，两半只能通过 `require` 与返回值见面。
 *
 * 装配协议（两半都不许自己改的三条）：
 *   1. 模块 id = `MERGED_PACKAGE_NAME`；产物全文只能出现一次 `window.__ModuleLoader__.load(`。
 *   2. `exports.inject` = 两半 inject 的并集，顺序取 `MERGED_CLIENT_INJECT`；
 *      任一半声明了清单以外的服务 ⇒ 抛错（防「半边新增依赖、常量没跟上」静默丢服务）。
 *   3. `apply` 先跑 Deck、后跑 Resident，把 Deck 的返回值（`mergeEmbed`）作为第二参数交给 Resident：
 *      Resident 的「仓库登记库」页据此复用 Deck 的设置区块组件（同一份状态与 Host 业务），
 *      而不是在 Resident 里复制一套持久化逻辑。返回值取 Resident 的（没有就取 Deck 的）。
 *
 * 语法约束：本文件由 Node 原生类型擦除执行/编译，只许写**可擦除**语法
 * （类型注解、`import type`、`as` 断言之外的纯类型构造）。禁止 `enum`、`namespace`、
 * 构造函数参数属性、`import x = require()`——擦除模式下直接报错。
 */

import {
  LEGACY_DECK_IDENTITY,
  MERGED_CLIENT_INJECT,
  MERGED_IDENTITY,
  MERGED_PACKAGE_NAME,
  MERGED_REPO_URL,
  MERGED_REPO_URL_LITERAL,
  MERGED_VERSION,
  MERGED_VERSION_LITERAL,
  MODULE_LOADER_MARKER,
} from './merge-identity.ts'

/**
 * Deck 产物在**合并前**的模块 id / 运行时身份（改写前）。
 *
 * 合并后 Deck 快照里这一串已被换成 `MERGED_IDENTITY`（见 merge-identity.ts 的身份真源）；
 * 这个常量保留下来只做**漂移守卫**：合并产物里再出现它，就说明身份回退了，一律拒绝产出。
 */
export const DECK_MODULE_ID = LEGACY_DECK_IDENTITY

/** deck 产物里 inject 那一行（缩进与引号风格必须逐字一致，锚点要求唯一）。 */
export const DECK_INJECT_ANCHOR =
  "    exports.inject = ['connection', 'slots', 'locale', 'workspaces', 'sessions']"

/** dock 槽位 id：合并后必须仍然在——它是功能栏的门禁把手，与模块 id 只是同串不同义。 */
/**
 * dock 槽位锚点：身份融合后与 `MERGED_IDENTITY` 同串（真源在 merge-identity.ts），order 40 不变。
 *
 * 两种合法写法都要认：客户端源码里槽位 id 是**运行时身份常量派生**（`id: DSW_IDENTITY, order: 40`，
 * 身份由构建期注入），而历史上它是字面量。门禁要拦住的是"注册被打偏 / order 被改"，
 * 不是"必须写成字面量" —— 所以这里给出两个形态，合并装配按"命中任一"判过。
 */
export const DOCK_SLOT_ANCHOR = `id: '${MERGED_IDENTITY}', order: 40`
export const DOCK_SLOT_ANCHOR_ALTS = [DOCK_SLOT_ANCHOR, 'id: DSW_IDENTITY, order: 40']

/** Deck 产物里版本号那一行（deck/scripts/build.mjs 从 deck/package/package.json 注入 `v<version>`）。 */
/** 版本锚点：`const`（历史）与 `let`（身份融合后要能被宿主的运行时值覆盖）两种声明都要认。 */
export const DECK_VERSION_ANCHOR_RE = /(?:const|let) DSW_VERSION = '[^']*'/

/** Deck 产物里仓库地址那一行（同一处注入；历史上指向上游 Deck 仓库，合并后必须指向本包）。 */
export const DECK_REPO_URL_ANCHOR_RE = /(?:const|let) DSW_REPO_URL = '[^']*'/

/**
 * 把 Deck 半边注入的版本字面量改成**合并包自己的版本**（真源根 package.json，见 merge-identity.ts）。
 *
 * 不改它的话，合并包的设置页与更新面板会显示 Deck 上游版本（`v1.8.0-rc.7`），
 * 而宿主「安装副本版本同步」也会按那个横幅去写 package.json——两处都指向一个不是本包的版本。
 * 锚点要求唯一：读不到或读到多处一律抛，不猜。
 */
export function rewriteVersionLiteral(deckSource: string): { text: string; from: string; to: string } {
  const hits = deckSource.match(DECK_VERSION_ANCHOR_RE)
  if (!hits) {
    throw new Error(
      'Deck 客户端里找不到版本锚点 `const DSW_VERSION = \'…\'`：' +
        'deck 构建注入方式变了，先对齐锚点，不要在合并产物里留下上游版本号。',
    )
  }
  if (hits.length !== 1) {
    throw new Error('Deck 客户端里版本锚点出现 ' + hits.length + ' 次（期望 1 次）')
  }
  const from = hits[0]
  const kw = from.startsWith('let ') ? 'let ' : 'const '
  const want = kw + 'DSW_VERSION = ' + MERGED_VERSION_LITERAL
  // 幂等：身份融合后 deck 构建自己也读根 package.json（scripts/build.mjs），所以锚点往往**已经是**
  // 合并版本 —— 这时不改写，只核对；改了反而是把正确值"替换成同样的值"再被残留检查误判。
  if (from === want) return { text: deckSource, from, to: MERGED_VERSION_LITERAL }
  const text = deckSource.split(from).join(want)
  return { text, from, to: MERGED_VERSION_LITERAL }
}

/**
 * 把 Deck 半边注入的**仓库地址**改成合并包自己的仓库（真源 = 根 package.json 的 repository.url）。
 *
 * 为什么必须改：这个 URL 就是界面上"点版本号开门"的落点（右栏版本号与设置页那行）。
 * 不改的话，用户点开会到上游 Deck 仓库，而旁边就是 Resident 的登记库页 —— 看起来就像"版本认的不是主插件"。
 * 与版本锚点同样是唯一锚点：读不到或读到多处一律抛。
 */
export function rewriteRepoUrlLiteral(deckSource: string): { text: string; from: string; to: string } {
  const hits = deckSource.match(DECK_REPO_URL_ANCHOR_RE)
  if (!hits) {
    throw new Error(
      'Deck 客户端里找不到仓库地址锚点 `const DSW_REPO_URL = \'…\'`：' +
        'deck 构建注入方式变了，先对齐锚点，不要在合并产物里留下上游 Deck 仓库地址。',
    )
  }
  if (hits.length !== 1) {
    throw new Error('Deck 客户端里仓库地址锚点出现 ' + hits.length + ' 次（期望 1 次）')
  }
  const from = hits[0]
  const kw = from.startsWith('let ') ? 'let ' : 'const '
  const want = kw + 'DSW_REPO_URL = ' + MERGED_REPO_URL_LITERAL
  // 与版本同理：deck 构建已按合并包身份注入时，这里只核对不改写（幂等）。
  if (from === want) return { text: deckSource, from, to: MERGED_REPO_URL_LITERAL }
  const text = deckSource.split(from).join(want)
  return { text, from, to: MERGED_REPO_URL_LITERAL }
}

/** 合并产物里给注入顺序用的字面量（唯一真源：MERGED_CLIENT_INJECT）。 */
const INJECT_ORDER_LITERAL = '[' + MERGED_CLIENT_INJECT.map((s) => `'${s}'`).join(', ') + ']'

const DEFAULT_DEV_HEADER =
  '// 构建产物，不要手改。重新生成：node tools/merge/build-merge-entries.ts\n' +
  '// 作者态：根 client.js（Resident 半边）+ deck/src/client/**（Deck 半边）。\n'

/** 半边插件最小形状：inject 数组 + apply。 */
export interface HalfPlugin {
  inject?: unknown
  apply?: unknown
  [extra: string]: unknown
}

/** 从半边源码里捕获出来的模块声明。 */
export interface CapturedHalf {
  id: string
  /** factory 的原文（由 `Function.prototype.toString()` 取得，逐字保留）。 */
  factorySource: string
  factory: (...args: unknown[]) => unknown
}

/** 装配结果。字段保持与既有 RewriteResult 兼容，额外字段给门禁/日志用。 */
export interface ComposedClient {
  text: string
  moduleId: string
  /** 合并后的 inject（等于 MERGED_CLIENT_INJECT）。 */
  inject: readonly string[]
  deckInject: readonly string[]
  residentInject: readonly string[]
  /** 合并包版本（根 package.json；展示与安装副本同步都以它为准）。 */
  version: string
  bytesBefore: number
  bytesAfter: number
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function ensureNonEmpty(source: unknown, label: string): string {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error(
      `${label} 源码缺失或为空。两半都必须传入：合并包只有一个客户端产物，` +
        '少任何一半都只能得到「假合并」，本模块拒绝静默省半边。',
    )
  }
  return source
}

/**
 * 求值半边源码，捕获 `window.__ModuleLoader__.load({ id, factory })` 里的声明。
 *
 * 只求值、**不调用** factory：deck 半边的 factory 一行就要 `window`/`document`/宿主服务，
 * 构建期没有浏览器环境；捕获它的**原文**、等运行时再调用，才是正确的分工。
 */
export function captureHalf(source: string, label: string): CapturedHalf {
  const text = ensureNonEmpty(source, label)
  const loadCount = countOccurrences(text, MODULE_LOADER_MARKER)
  if (loadCount !== 1) {
    throw new Error(
      `${label} 里 ${MODULE_LOADER_MARKER} 出现 ${loadCount} 次（期望恰好 1 次）。` +
        '重复 load 会被宿主判为重复注册；本模块拒绝从多份声明里猜哪一份是真的。',
    )
  }
  const box: { spec: { id?: unknown; factory?: unknown } | null } = { spec: null }
  const windowStub = {
    __ModuleLoader__: {
      load(spec: { id?: unknown; factory?: unknown }): void {
        box.spec = spec
      },
    },
  }
  try {
    const run = new Function('window', text) as (w: unknown) => void
    run(windowStub)
  } catch (e) {
    throw new Error(
      `${label} 无法求值（期望是「注释头 + 一条 window.__ModuleLoader__.load(...)」的脚本）：` +
        String((e as Error)?.message || e),
    )
  }
  const spec = box.spec
  if (!spec) throw new Error(`${label} 没有调用 window.__ModuleLoader__.load(...)`)
  if (typeof spec.factory !== 'function') {
    throw new Error(`${label} 的 load 声明里没有 factory 函数`)
  }
  const id = typeof spec.id === 'string' ? spec.id : ''
  if (!id) throw new Error(`${label} 的 load 声明里没有字符串 id`)
  return { id, factory: spec.factory as CapturedHalf['factory'], factorySource: spec.factory.toString() }
}

/** 把方法简写/普通函数/箭头函数统一成可嵌入的表达式原文。 */
export function toExpressionSource(factorySource: string): string {
  const src = factorySource.trim()
  if (/^(async\s+)?function\b/.test(src)) return `(${src})`
  // 对象方法简写：`factory(require) { ... }` → `function factory(require) { ... }`
  if (/^[A-Za-z_$][\w$]*\s*\(/.test(src)) return `(function ${src})`
  return `(${src})`
}

/** 从 deck 产物里读出它声明的 inject 列表（锚点必须唯一）。 */
export function readDeckInject(deckSource: string): string[] {
  const count = countOccurrences(deckSource, DECK_INJECT_ANCHOR)
  if (count !== 1) {
    throw new Error(
      `deck 客户端里 inject 锚点出现 ${count} 次（期望 1 次）：${JSON.stringify(DECK_INJECT_ANCHOR)}。` +
        '锚点漂移说明 deck 的 pkg 壳变了——不要「尽量改」，先对齐锚点。',
    )
  }
  const inner = DECK_INJECT_ANCHOR.slice(DECK_INJECT_ANCHOR.indexOf('[') + 1, DECK_INJECT_ANCHOR.lastIndexOf(']'))
  const out: string[] = []
  for (const piece of inner.split(',')) {
    const m = piece.trim().match(/^(['"])(.*)\1$/)
    if (!m) throw new Error('无法解析 deck inject 锚点：' + JSON.stringify(DECK_INJECT_ANCHOR))
    out.push(m[2])
  }
  return out
}

/** 构建期核验 Resident 半边：用 stub require 真跑一次 factory，读它声明的 inject 与 apply。 */
export function loadResidentPlugin(half: CapturedHalf, label: string): HalfPlugin {
  const reactStub = {
    createElement: () => null,
    useState: (v: unknown) => [typeof v === 'function' ? (v as () => unknown)() : v, () => {}],
    useRef: (v: unknown) => ({ current: v }),
    useCallback: (f: unknown) => f,
    useEffect: () => {},
    useContext: () => null,
  }
  const requireStub = (name: string): unknown => {
    if (name === 'react') return reactStub
    throw new Error(`${label} 请求了未预期的模块：${name}`)
  }
  let plugin: unknown
  try {
    plugin = half.factory(requireStub)
  } catch (e) {
    throw new Error(`${label} 的 factory 在构建期跑不起来：` + String((e as Error)?.message || e))
  }
  if (!plugin || typeof plugin !== 'object') throw new Error(`${label} 的 factory 没有返回插件对象`)
  const p = plugin as HalfPlugin
  if (typeof p.apply !== 'function') throw new Error(`${label} 的插件对象没有 apply 函数`)
  if (!Array.isArray(p.inject)) throw new Error(`${label} 的插件对象没有 inject 数组`)
  for (const s of p.inject) {
    if (typeof s !== 'string') throw new Error(`${label} 的 inject 里有非字符串项`)
  }
  return p
}

/**
 * 并集覆盖面校验（导出给门禁直接单测两个分支）：
 *   - 任一半声明了 MERGED_CLIENT_INJECT 以外的服务 → 抛（防静默丢服务）；
 *   - 常量里有半边都没声明的服务 → 抛（防常量与真实依赖漂移）。
 */
export function assertInjectCoverage(deckInject: readonly string[], residentInject: readonly string[]): void {
  const union = new Set<string>([...deckInject, ...residentInject])
  const unknown = [...union].filter((s) => !(MERGED_CLIENT_INJECT as readonly string[]).includes(s))
  if (unknown.length) {
    throw new Error(
      `半边声明了 inject 清单以外的服务：${unknown.join(', ')}。` +
        '请把服务并进 tools/merge/merge-identity.ts 的 MERGED_CLIENT_INJECT，不要在这里静默丢掉。',
    )
  }
  const missing = (MERGED_CLIENT_INJECT as readonly string[]).filter((s) => !union.has(s))
  if (missing.length) {
    throw new Error(
      `MERGED_CLIENT_INJECT 里有半边都没声明的服务：${missing.join(', ')}。` +
        '常量与实际依赖已经漂移，请核对两半的 inject 后再改常量。',
    )
  }
}

/** 渲染合并后的客户端脚本。 */
function renderMergedClient(deck: CapturedHalf, resident: CapturedHalf): string {
  const deckExpr = toExpressionSource(deck.factorySource)
  const residentExpr = toExpressionSource(resident.factorySource)
  return (
    DEFAULT_DEV_HEADER +
    '\n' +
    MODULE_LOADER_MARKER +
    '{\n' +
    `  id: '${MERGED_PACKAGE_NAME}',\n` +
    '  // 两半各自独立词法作用域：各自的 h / ctx / React / 顶层标识符互不可见。\n' +
    '  factory: function (require) {\n' +
    '    var __dshModule = { exports: {} };\n' +
    '    var exports = __dshModule.exports;\n' +
    "    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });\n" +
    '\n' +
    '    // ---- Deck 半边（原 deck/package/lib/client.js 的 factory 原文）----\n' +
    `    var __dshDeck = ${deckExpr}(require);\n` +
    '    // ---- Resident 半边（根 client.js 的 factory 原文）----\n' +
    `    var __dshResident = ${residentExpr}(require);\n` +
    '\n' +
    '    // inject 并集：顺序取 merge-identity.ts 的常量；声明了清单以外的服务直接在加载期抛错。\n' +
    `    var __dshInjectOrder = ${INJECT_ORDER_LITERAL};\n` +
    '    var __dshHalves = [__dshDeck, __dshResident];\n' +
    '    var __dshDeclared = [];\n' +
    '    for (var __dshI = 0; __dshI < __dshHalves.length; __dshI++) {\n' +
    '      var __dshList = (__dshHalves[__dshI] && __dshHalves[__dshI].inject) || [];\n' +
    '      for (var __dshJ = 0; __dshJ < __dshList.length; __dshJ++) {\n' +
    '        if (__dshDeclared.indexOf(__dshList[__dshJ]) < 0) __dshDeclared.push(__dshList[__dshJ]);\n' +
    '      }\n' +
    '    }\n' +
    '    var __dshUnknown = __dshDeclared.filter(function (s) { return __dshInjectOrder.indexOf(s) < 0; });\n' +
    "    if (__dshUnknown.length) throw new Error('客户端服务依赖未登记（改 tools/merge/merge-identity.ts）：' + __dshUnknown.join(', '));\n" +
    '    exports.inject = __dshInjectOrder.filter(function (s) { return __dshDeclared.indexOf(s) >= 0; });\n' +
    '\n' +
    '    // apply：Deck 先跑（它的返回值把可复用的设置区块交给 Resident），Resident 后跑。\n' +
    '    // 不吞异常：两半失败的症状不同，吞掉之后现场只剩「页面空白」。\n' +
    '    exports.apply = function (ctx) {\n' +
    '      var __dshDeckRet = (__dshDeck && typeof __dshDeck.apply === "function") ? __dshDeck.apply(ctx) : undefined;\n' +
    '      var __dshEmbed = (__dshDeckRet && __dshDeckRet.mergeEmbed) ? __dshDeckRet.mergeEmbed : null;\n' +
    '      if (__dshResident && typeof __dshResident.apply === "function") return __dshResident.apply(ctx, __dshEmbed);\n' +
    '      return __dshDeckRet;\n' +
    '    };\n' +
    '\n' +
    '    return __dshModule.exports;\n' +
    '  },\n' +
    '});\n'
  )
}

/**
 * 装配两半，产出合并后的客户端脚本。
 *
 * @param deckSource     `deck/package/lib/client.js` 的完整文本（deck 构建产物，尚未改写）
 * @param residentSource 根 `client.js` 的完整文本（Resident 作者态，已是合并包身份）
 */
export function composeMergedClient(deckSource: string, residentSource: string): ComposedClient {
  // 先校验两半都在（缺任一半的拒绝理由必须是「源码缺失或为空」，不能是内部 TypeError），
  // 再把 Deck 注入的上游版本换成合并包自己的版本（唯一真源：根 package.json），最后捕获 factory 原文，
  // 这样产出里既不显示上游版本，也不会把改过的字符串漏在注释里。
  const deckText = ensureNonEmpty(deckSource, 'Deck 客户端（deck/package/lib/client.js）')
  const residentText = ensureNonEmpty(residentSource, 'Resident 客户端（根 client.js）')
  const versioned = rewriteVersionLiteral(deckText)
  const repourled = rewriteRepoUrlLiteral(versioned.text)
  const deck = captureHalf(repourled.text, 'Deck 客户端（deck/package/lib/client.js）')
  const resident = captureHalf(residentText, 'Resident 客户端（根 client.js）')

  if (deck.id !== MERGED_IDENTITY) {
    throw new Error(
      `Deck 产物模块 id 期望合并身份 '${MERGED_IDENTITY}'，实际 '${deck.id}'。` +
        '（身份融合后 deck 快照里的模块 id 必须已换成 MERGED_IDENTITY；发现旧串说明改漏了。）',
    )
  }
  if (resident.id !== MERGED_PACKAGE_NAME) {
    throw new Error(
      `Resident 客户端模块 id 期望合并身份 '${MERGED_PACKAGE_NAME}'，实际 '${resident.id}'。` +
        '身份真源见 tools/merge/merge-identity.ts。',
    )
  }

  const deckInject = readDeckInject(deckSource)
  const residentPlugin = loadResidentPlugin(resident, 'Resident 客户端（根 client.js）')
  const residentInject = residentPlugin.inject as string[]
  assertInjectCoverage(deckInject, residentInject)

  const text = renderMergedClient(deck, resident)

  const loadCount = countOccurrences(text, MODULE_LOADER_MARKER)
  if (loadCount !== 1) {
    throw new Error(
      `合并产物里 ${MODULE_LOADER_MARKER} 出现 ${loadCount} 次（期望 1 次）。` +
        '重复 load 会被宿主判为重复注册；出现在半边源码里的字面量也要先消掉。',
    )
  }
  if (!text.includes(`${MODULE_LOADER_MARKER}{\n  id: '${MERGED_PACKAGE_NAME}',`)) {
    throw new Error('合并产物缺少合并身份的 load 声明')
  }
  if (text.includes(`${MODULE_LOADER_MARKER}{\n  id: '${DECK_MODULE_ID}',`)) {
    throw new Error('合并产物里仍存在旧 Deck 模块 id，拒绝产出')
  }
  // 旧身份串**只许以客户端身份迁移的常量形态**出现（读旧写新要读旧值）。
  // 判据落在"出现的方式"而不是"出现几次"：迁移模块在就是那一处 `LEGACY_IDENTITY = '…'`，
  // 不在（例如夹具只装了半边）就该一处都没有 —— 两种都合法；除此之外出现即身份回退，拒绝产出。
  const legacyDecl = `LEGACY_IDENTITY = '${LEGACY_DECK_IDENTITY}'`
  const legacyHits = countOccurrences(text, `'${LEGACY_DECK_IDENTITY}'`)
  const declaredHits = countOccurrences(text, legacyDecl)
  if (legacyHits !== declaredHits) {
    throw new Error(
      `合并产物里旧 Deck 身份串出现 ${legacyHits} 次，其中只有 ${declaredHits} 次是身份迁移的常量声明。` +
        '其余出现＝身份回退（旧名字又跑回别处），拒绝产出。',
    )
  }
  if (legacyHits > 1) {
    throw new Error(`合并产物里身份迁移常量出现 ${legacyHits} 次（期望 ≤ 1 次，迁移模块只该有一份）`)
  }
  if (!DOCK_SLOT_ANCHOR_ALTS.some((alt) => text.includes(alt))) {
    throw new Error(
      '合并产物里 dock 槽位 id 不见了——功能栏注册被打偏，拒绝产出（认的形态：' + DOCK_SLOT_ANCHOR_ALTS.join(' 或 ') + '）',
    )
  }
  if (text.includes(`id: '${DECK_MODULE_ID}', order: 40`)) {
    throw new Error('合并产物里 dock 槽位仍是旧 Deck 身份，拒绝产出（身份回退）')
  }
  if (!text.includes('DSW_VERSION = ' + MERGED_VERSION_LITERAL)) {
    throw new Error(
      '合并产物里的版本号不是根 package.json 的 ' + MERGED_VERSION + '（版本改写没落地）。' +
        '自更新展示与安装副本同步都以合并包版本为准，不接受上游 Deck 版本冒充。',
    )
  }
  if (!/^(?:const|let) DSW_VERSION = 'v?1\.7\.0'$/.test(versioned.from) && text.includes(versioned.from)) {
    throw new Error('合并产物里仍残留 deck 上游版本字面量：' + versioned.from)
  }
  if (!text.includes('DSW_REPO_URL = ' + MERGED_REPO_URL_LITERAL)) {
    throw new Error(
      '合并产物里的仓库地址不是根 package.json 的 ' + MERGED_REPO_URL + '（仓库地址改写没落地）。' +
        '界面上点版本号要落在本包仓库，不许落到上游 Deck。',
    )
  }
  if (!repourled.from.includes(MERGED_REPO_URL) && text.includes(repourled.from)) {
    throw new Error('合并产物里仍残留 deck 上游仓库地址字面量：' + repourled.from)
  }

  const bytesBefore = Buffer.byteLength(deckText, 'utf8') + Buffer.byteLength(residentText, 'utf8')
  return {
    text,
    moduleId: MERGED_PACKAGE_NAME,
    inject: [...MERGED_CLIENT_INJECT],
    deckInject,
    residentInject,
    version: MERGED_VERSION,
    bytesBefore,
    bytesAfter: Buffer.byteLength(text, 'utf8'),
  }
}
