/**
 * tools/merge/host-assembly.ts —— 合并包的宿主入口（作者态真源）
 *
 * 本文件由 `node tools/merge/build-merge-entries.ts` 用 esbuild 擦类型后生成到 `dist/host.js`，
 * 根 `package.json` 的 `exports["."]` 指向那份产物。
 *
 * 为什么是这样一层很薄的装配，而不是把两边揉成一个文件：
 *   1) 宿主按**包名** `import()` 本包的 `exports["."]`，一个包只能有一个宿主入口；
 *   2) Resident 半边的 127 KB 实现留在 [`../../plugin.js`](../../plugin.js)，Deck 半边的实现留在
 *      [`../../deck/src/host/index.js`](../../deck/src/host/index.js)，两边都是**已有的原样供应源码**，
 *      本文件不复制它们一行——压缩成单文件会让依赖「源文件布局」的门禁失去对象；
 *   3) 真正需要合并的只有一件事：两边的 `inject` 声明并集。Cordis 在 `apply` **之前**读
 *      `inject`，所以装配层必须显式声明合并后的并集，不能指望在 `apply` 里补。
 *
 * —— 为什么两半用**运行期路径**而不是相对 import（2026-10-11 实测修正）——
 * 静态 `import '../../plugin.js'` 是相对**作者态**位置（`tools/merge/`）写下的；本文件经
 * `esbuild bundle:false` 原样转译到 `dist/host.js` 后，同一个 `'../../plugin.js'` 会被解析成
 * 仓库**上一级**（`<repo>/../plugin.js`），`'./merge-identity.ts'` 会被解析成 `dist/merge-identity.ts`
 * （不存在）——产物一装载就死，而且死在「工具全没了」这种查不出原因的症状上。所以这里从
 * `import.meta.url` 出发向上找**合并包自己的 package.json**（按 name 认，不按层数猜），
 * 再用 `pathToFileURL` 动态导入两半。开发检出（`tools/merge/`）与构建产物（`dist/`）落在同一套
 * 规则下，打包解压后（`<pkg>/dist/host.js`）也一样成立。
 *
 * —— 导出形态（**单一一种**）——
 * 只用 Cordis 的正规具名形态：`export const name` / `export const inject` / `export function apply`。
 * 不再同时给 default 对象：加载器 `unwrapExports()` 会把 `{name,inject,apply}` 的 default 与
 * 具名命名空间看成两个不同的插件对象，而 `registry.resolve()` 拿 `plugin.apply` 的**函数身份**
 * 当运行记录键——两条路各挂一次就等于同一套注册可能重复、卸载只摘掉一半。
 *
 * 严禁事项（改这个文件的人先读）：
 *   - 不要在 `apply` 里做 `try/catch` 静默吞掉半边失败：两边失败的症状完全不同
 *     （Resident 失败 = 17 个 gh_* 全没；Deck 失败 = 27 个工具与右栏全没），吞掉之后
 *     现场只剩「工具不见了」，无从定位。两半都**先调用**，第一个异常在两边都试过之后原样抛出。
 *   - 不要在这里改包名 / 槽位 id：身份常量在 [`./merge-identity.ts`](./merge-identity.ts) 里定死。
 *     （本文件**不能**在运行期 import 那个 .ts——理由见上。所以这里只有一份「字面锚点」，
 *     由 [`../../tests/merge/host/identity-parity.test.mjs`](../../tests/merge/host/identity-parity.test.mjs)
 *     与真源逐项比对，漂移会被门禁抓住。）
 *   - 不要加第二份 `client.js`：客户端永远只有 `dist/client.js` 一份（宿主契约）。
 *
 * 语法约束：本文件由 Node 的原生类型擦除执行/编译，只许写**可擦除**语法
 * （类型注解、`import type`、`satisfies` 之外的纯类型构造）。禁止 `enum`、`namespace`、
 * 构造函数参数属性、`import x = require()`——它们在擦除模式下直接报错。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 合并包名（构建产物里必须出现这个字面量：`build-merge-entries.ts --check` 按它找锚）。
 * 真源是 [`./merge-identity.ts`](./merge-identity.ts) 的 `MERGED_PACKAGE_NAME`；
 * 运行期真正生效的是**实测**到的那份 package.json 的 name，这里只做形状锚点与漂移断言。
 */
const EXPECTED_PACKAGE_NAME = '@local/dsh-github-resident-v2'

/**
 * 宿主插件的服务依赖（两半并集，真源 [`./merge-identity.ts`](./merge-identity.ts) 的 `MERGED_HOST_INJECT`）。
 * 必须在 `apply` 之前被加载器读到，所以只能是字面量数组，不能等运行期算。
 * 顺序也有意义（`Inject.resolve` 按数组顺序建立注入表），由身份门禁逐项 + 顺序断言。
 */
export const inject: readonly string[] = ['tools', 'connection', 'llm', 'sessionQuery']

/** Cordis 宿主插件可注册的工具定义（只声明本装配层真正用到的形状）。 */
export interface HostToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: unknown, exec: unknown) => Promise<unknown> | unknown
  [extra: string]: unknown
}

/** `ctx.tools` 只用到 register。 */
export interface HostToolsService {
  register: (definition: HostToolDefinition) => unknown
}

/**
 * 宿主上下文里本装配层真正触到的能力。
 * 刻意写窄：写宽会把「其实没用到的服务」变成隐性依赖，日后框架删服务时这里看不出来。
 */
export interface HostContext {
  get: (key: string) => unknown
  inject: (keys: readonly string[], callback: () => void) => void
  effect: (callback: () => void | (() => void), name?: string) => unknown
  provide?: (key: string, value: unknown) => void
  tools?: HostToolsService
}

/** 半边插件的最小形状：一个 `apply`，可选 `name`。 */
export interface HostHalf {
  label: string
  apply: (ctx: HostContext, config: unknown) => unknown
}

/** 找到合并包根（按 package.json 的 name 认）。找不到就抛，绝不退回「猜层数」。 */
function findPackageRoot(startDir: string): { root: string; name: string } {
  let cur = resolvePath(startDir)
  for (let i = 0; i < 8; i += 1) {
    const manifestPath = join(cur, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
        if (pkg && pkg.name === EXPECTED_PACKAGE_NAME) return { root: cur, name: String(pkg.name) }
      } catch {
        // 读不动就继续往上找；最终找不到会抛明确的错，不静默用错根。
      }
    }
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  throw new Error(
    '[host-assembly] 找不到合并包根：从 ' +
      resolvePath(startDir) +
      ' 向上没有 name === ' +
      EXPECTED_PACKAGE_NAME +
      ' 的 package.json。产物 dist/host.js 必须与根 package.json 同包发布（见根 package.json 的 files）。',
  )
}

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = findPackageRoot(HERE)

/** 两半的落地位置（相对包根）。都是**原样供应**的既有源码，本文件不复制它们。 */
const RESIDENT_HALF_REL = 'plugin.js'
const DECK_HALF_REL = join('deck', 'src', 'host', 'index.js')

function requireHalfFile(rel: string): string {
  const abs = join(PACKAGE.root, rel)
  if (!existsSync(abs)) {
    throw new Error(
      '[host-assembly] 半边入口缺失：' +
        abs +
        '（包根 ' +
        PACKAGE.root +
        '）。发布包的 files 白名单必须包含 ' +
        rel +
        '，否则合并包装出来只有一半工具。',
    )
  }
  return abs
}

/** Resident 半边以具名导出提供插件契约（不是 default 对象）。 */
const residentModule = (await import(pathToFileURL(requireHalfFile(RESIDENT_HALF_REL)).href)) as {
  apply?: (ctx: HostContext, config: unknown) => unknown
}
/** Deck 半边以 default 对象提供插件契约（`{ name, inject, apply }`）。 */
const deckModule = (await import(pathToFileURL(requireHalfFile(DECK_HALF_REL)).href)) as {
  default?: { apply?: (ctx: HostContext, config: unknown) => unknown }
  apply?: (ctx: HostContext, config: unknown) => unknown
}

function pickHalfApply(
  moduleExports: { apply?: unknown; default?: { apply?: unknown } },
  label: string,
): (ctx: HostContext, config: unknown) => unknown {
  // 半边可以是具名 apply（Resident）或 default 对象上的 apply（Deck）；两种都只取一个函数，
  // 取不到就抛——半个插件「静默不装载」的症状比抛错难查一百倍。
  const fn = typeof moduleExports.apply === 'function' ? moduleExports.apply : moduleExports.default?.apply
  if (typeof fn !== 'function') {
    throw new Error('[host-assembly] ' + label + ' 半边没有可用的 apply（既不是具名导出，也不是 default.apply）')
  }
  return fn as (ctx: HostContext, config: unknown) => unknown
}

/**
 * 两半的装配顺序：Resident 先、Deck 后。
 * 顺序是**有意的**，别随手调换：Resident 的 apply 同步注册 17 个工具与一个回环 HTTP 服务，
 * 没有服务间等待；Deck 的 apply 会先试 subprocess/timer，不齐就挂到框架依赖门上等，
 * 属于「晚到也不丢」的那一类。先让同步的那半边就位，Deck 无论立即还是延后启动都看得到完整环境。
 */
const HALVES: readonly HostHalf[] = [
  { label: 'resident', apply: pickHalfApply(residentModule, 'resident') },
  { label: 'deck', apply: pickHalfApply(deckModule, 'deck') },
]

/**
 * 合并后的宿主插件名：取**实测**的包名（根 package.json 的 name）。
 * 不写死半边原来的名字——行模块与客户端都按合并包名归户。
 */
export const name: string = PACKAGE.name

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * 一次 `apply` 的返回值该怎么收场。Cordis 的 `Fiber.execute()` 只把返回值当**可等待的 task**
 * （`@deepseek-ai/cordis/lib/index.js` 的 `execute: () => runtime.callback(ctx, config)`），
 * **不**把返回的函数当销毁器。所以：
 *   - 返回 Promise —— 原样交回，让 fiber 等它（丢了就是「插件还没起来就以为起来了」）；
 *   - 返回函数 —— 半边用了旧的「返回即销毁器」写法，必须显式挂到 `ctx.effect` 上，
 *     否则卸载时这段清理永远不会跑（静默泄漏）；上下文没有 effect 就抛，不静默丢弃；
 *   - 返回别的（含 undefined / false / true）—— 不当成功判据，也不把它当返回值回给框架。
 */
function collectHalfResult(ctx: HostContext, value: unknown, label: string): unknown {
  if (typeof value !== 'function') return value
  if (typeof ctx.effect !== 'function') {
    throw new Error(
      '[host-assembly] ' + label + ' 半边的 apply 返回了清理函数，但上下文没有 ctx.effect 可托管；拒绝静默丢弃',
    )
  }
  ctx.effect(() => value as () => unknown, label + ': apply() 返回值清理')
  return undefined
}

/**
 * 依次调用每一半，收集返回值并归一。
 *
 * 可判定语义（测试直接调它，见 tests/merge/host/assembly-lifecycle.test.mjs）：
 *   1) **每一半都会被调用**，前一半抛错不阻止后一半被尝试；
 *   2) 有错就抛（第一个错误原样抛出，不包装、不吞），错误可见；
 *   3) 任一半返回 Promise 时返回 `Promise.all`，让 fiber 等到所有半边落定；
 *   4) 函数返回值转成 `ctx.effect` 清理登记，不丢 disposer；
 *   5) 返回值**不**被当成「功能是否成功」的布尔判据（旧实现的 `Boolean(apply())` 就是那个 bug）。
 */
export function __applyHalves(ctx: HostContext, halves: readonly HostHalf[], config?: unknown): unknown {
  const results: unknown[] = []
  let failure: unknown
  let failed = false
  for (const half of halves) {
    try {
      results.push(collectHalfResult(ctx, half.apply(ctx, config), half.label))
    } catch (error) {
      results.push(undefined)
      if (!failed) {
        failed = true
        failure = error
      }
    }
  }
  if (failed) throw failure
  const pending = results.filter(isThenable)
  if (pending.length > 0) return Promise.all(pending).then(() => undefined)
  return undefined
}

/**
 * 依次装配两半。返回值语义见 `__applyHalves`：两半都是同步的（今天的事实）时返回 undefined，
 * 有半边返回 Promise 时返回那个 Promise；任何一半抛错都会在两边都试过之后原样抛给加载器。
 */
export function apply(ctx: HostContext, config?: unknown): unknown {
  return __applyHalves(ctx, HALVES, config)
}
