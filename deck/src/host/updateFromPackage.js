// src/host/updateFromPackage.js —— 宿主更新接线（地图 #873 薄接线：只留上游 README 基本用法）。
//
// 本文件只做三件事：按包名引用已安装的更新包建更新能力，
// 把电话处理器按键交给调用方（电话名从包自己拼的 phoneNames 读，不另拼字符串）。
// 自己的更新实现已删（旧三件套、旧派生目录、旧共享核心、update-core 源码树，见 #875）；
// 旧实现回退分支已删，包缺失时直接抛错，不静默降级。
//
// 唯一的例外是装完身份证验明正身（__syncInstalledManifest）：上游 0.9.0 的已装版本
// 只读身份证，而文件级安装不换身份证；删掉它会重现 2026-10-01 面板版本不更新的故障。
// 它平时无操作，只写身份证的 version 一个字段，永不抛错。包侧一旦补上同等逻辑，这里连它一起删。
//
// 用词：电话指宿主对外提供的方法；身份证指已装目录的 package.json；横幅指客户端产物里的版本标记。
//
// —— 合并后的两条实际改动（2026-10-11，见 docs/merge-work-host.md）——
//   a) 更新目标从旧 Deck 改成合并包自己（DEFAULT_TARGET_PACKAGE = MERGED_PACKAGE_NAME）：
//      不显式传 targetPackageName 时会落到更新包自带的旧 Deck 默认值 —— 那是「装回旧 Deck」的根因。
//   b) 身份证验明正身按**合并包的布局**找根与横幅：根从本文件向上按包名认（不是取上一层），
//      横幅读 dist/client.js（旧 Deck 才是 lib/client.js）。否则合并包里这一步永远 skip:banner-mismatch。

import {
  createHostUpdate,
  resolveUpdateConfig,
  __resetSharedUpdateReaderForTests as resetPackageReader,
} from 'dsh-plugin-update'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本插件在更新包里的三个注册参数：插件标识（必填）、电话名前缀与版本通道。
// 按规格，前缀取包里的默认值即等于旧值 wf，所以这里从头两个电话名的字面一眼可校对，
// 不另写第二份「期望值」常量去和包里的默认值各说各话。
//
// —— 合并后的身份（2026-10-11）——
// 目标包（要检查/安装的那个包）**必须**是合并包自己：更新包对 `pluginId` 有硬约束
// （assertPluginId 拒绝含 '/' 的值，见 dsh-plugin-update/dist/config.js），所以合并包名
// `@local/dsh-github-resident-v2` 当 pluginId 会在**模块加载期**直接抛错。这里把两件事拆开：
//   - pluginId（本地状态命名空间，用去 scope 的合法标识）
//   - targetPackageName / manifest 名字（真正的包身份，用完整的合并包名）
// 旧 Deck 的包名只留作「漂移守卫」的对照值，**任何一条读/装路径都不再指向它**。
// 2026-10-12 身份融合：三个身份改从共享真源取（`src/shared/plugin-identity.js`）**并在本地绑定**，
// 免得包名 / 本地标识 / 旧名在宿主侧各写一份。对外导出名保持不变（门禁与别的调用点按这些名字引用）。
import {
  MERGED_PACKAGE_NAME,
  LEGACY_DECK_PACKAGE_NAME,
  UPDATE_PLUGIN_ID,
} from '../shared/plugin-identity.js'
export { MERGED_PACKAGE_NAME, LEGACY_DECK_PACKAGE_NAME, UPDATE_PLUGIN_ID }
export const UPDATE_PHONE_PREFIX = 'wf'
// 版本通道取预发布档（2026-10-10 维护者拍板）：跑着测试版、候选版的人也能正常查更新，
// 不会再被报「使用范围或插件位置认不出」。代价是跑稳定版的人也可能收到预发布推送——
// 这是拍板时已知并接受的，见 CHANGELOG 里 v1.8.0-rc.2 一节。
export const UPDATE_RELEASE_CHANNEL = 'prerelease'
// 本地 private 包的事实（面板文案与失败路径要如实说，不许伪称 npm 可更新）：
// 本包不发 npm，`private: true`，更新只能走源码/重新安装。
export const UPDATE_LOCAL_PRIVATE = true
export const UPDATE_LOCAL_PRIVATE_HINT =
  '本包为本地 private 包（' + MERGED_PACKAGE_NAME + '）：更新走源码重新安装，不通过 npm 安装。'
// 更新包自报的默认目标包名（要检查更新的那个包是谁）与官方源与默认前缀，
// 供门禁核对「默认值与旧字面一致」。取值只从已安装包的配置面算出来，不在本文件另写字面。
// targetPackageName 必须显式传——不传就落到更新包自带的旧 Deck 默认值，那是「装回旧 Deck」的根因。
const __pkgDefaults = resolveUpdateConfig({
  pluginId: UPDATE_PLUGIN_ID,
  releaseChannel: UPDATE_RELEASE_CHANNEL,
  targetPackageName: MERGED_PACKAGE_NAME,
})
export const DEFAULT_TARGET_PACKAGE = __pkgDefaults.targetPackageName
export const DEFAULT_REGISTRY = __pkgDefaults.registryUrl
export const DEFAULT_PREFIX = __pkgDefaults.prefix

/**
 * 漂移守卫：一份更新配置是不是又指回了旧 Deck。
 * 指向旧 Deck 的后果是「合并包去 npm 上检查/安装旧包」，属于必须拦住的退化；
 * 门禁直接调这个纯函数断言（见 tests/merge/host/update-target.test.mjs）。
 */
export function __updateTargetsLegacyDeck(config) {
  const name = config && typeof config === 'object' ? config.targetPackageName : undefined
  return name === LEGACY_DECK_PACKAGE_NAME
}

let phones = null
let phonesKey = ''

// 三段式版本号比较的最小实现（只认 x.y.z 全数字形，其余一律视为不可比）。
// 放这里而不引包里的比较函数：包里那份没对外导出，为三行逻辑多一层依赖不值。
const RELEASE_TRIPLE = /^(\d+)\.(\d+)\.(\d+)$/
export function __parseReleaseTriple(version) {
  const m = typeof version === 'string' ? RELEASE_TRIPLE.exec(version.trim()) : null
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
// 门禁与单测共用：current 是否真比 target 旧（任一不可比都算不旧，永不降级）。
export function __manifestOlderThan(current, target) {
  const a = __parseReleaseTriple(current)
  const b = __parseReleaseTriple(target)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}
// 门禁与单测共用：从客户端产物文本里读出构建时注入的版本号（读不到为 null）。
export function __bannerVersionOf(clientText) {
  const m = /DSW_VERSION\s*=\s*'v?(\d+\.\d+\.\d+)'/.exec(typeof clientText === 'string' ? clientText : '')
  return m ? m[1] : null
}
/** 客户端产物的候选位置（相对包根）：合并包是 dist/client.js，旧 Deck 是 lib/client.js，老 Resident 是 client.js。 */
export const BANNER_CLIENT_CANDIDATES = ['dist/client.js', 'lib/client.js', 'client.js']

/**
 * 找**已装那一份合并包**的根：从本文件所在目录向上问，谁的 package.json 名字是合并包名谁就是根。
 * 为什么不是 `dirname(moduleDir)`：本文件在合并包里落在 `<包根>/deck/src/host/`（源码形态随包发布），
 * 旧的「上一层就是包根」只对旧 Deck 的 lib/*.js 扁平布局成立。找不到回 null，由调用方如实 skip。
 */
export async function __findInstalledRoot(io, moduleDir) {
  try {
    const { dirname: dirName, join: joinPath } = await import('node:path')
    let cur = String(moduleDir || '')
    for (let i = 0; i < 8; i++) {
      if (!cur) return null
      try {
        const manifest = JSON.parse(await io.readFile(joinPath(cur, 'package.json'), 'utf8'))
        if (manifest && manifest.name === MERGED_PACKAGE_NAME) return cur
      } catch {
        // 这一层没有/读不动 package.json，继续往上
      }
      const parent = dirName(cur)
      if (parent === cur) return null
      cur = parent
    }
    return null
  } catch {
    return null
  }
}

/**
 * 装完验明正身（2026-10-01 面板装完版本显示修复，无单直修）。
 *
 * 为什么需要它：文件级安装只换代码文件、不换身份证（已装目录的 package.json），
 * 而已装版本与待重启判据都读那张身份证。装完不补，面板永远报旧版本、重启提示也永远不冒，
 * 用户会反复点安装。根因在宿主安装器不在本仓库，这里只做无害的真相恢复。
 *
 * 触发条件（缺一不可，任一不满足都原样返回，绝不掩盖一次真正的失败）：
 * 1) 本次安装回包里带合法的目标版本；
 * 2) 本文件跑在已安装的包里（路径含 node_modules；源码仓与门禁里永远走不进来）；
 * 3) 身份证上的名字就是本插件，且写明的版本真比目标旧（永不降级、不重写相等）；
 * 4) 已装代码横幅里的版本恰好等于目标版本（文件确实是新版，安装不是半截子）。
 * 只写身份证的 version 一个字段；配置文件的依赖声明是宿主的东西，一个字不动。
 * 绝不复位共享读取器：运行版本必须冻结在启动时，身份证新、运行旧，待重启才会正常冒出来。
 *
 * @returns 'synced' | 'skip:<原因>'，永不抛错（修不好就原样放过，不挡安装回包）。
 */
export async function __syncInstalledManifest({ moduleDir, targetVersion, io, log }) {
  try {
    if (!__parseReleaseTriple(targetVersion)) return 'skip:no-target'
    if (typeof moduleDir !== 'string' || moduleDir.toLowerCase().indexOf('node_modules') < 0) return 'skip:not-installed-copy'
    const root = await __findInstalledRoot(io, moduleDir)
    if (!root) return 'skip:no-manifest'
    const manifestPath = join(root, 'package.json')
    const manifest = JSON.parse(await io.readFile(manifestPath, 'utf8'))
    if (!manifest || manifest.name !== MERGED_PACKAGE_NAME) return 'skip:name-mismatch'
    const current = manifest.version
    if (current === targetVersion) return 'skip:already'
    if (!__manifestOlderThan(current, targetVersion)) return 'skip:not-older'
    let banner = null
    for (const rel of BANNER_CLIENT_CANDIDATES) {
      try {
        banner = __bannerVersionOf(await io.readFile(join(root, rel), 'utf8'))
      } catch {
        banner = null
      }
      if (banner) break
    }
    if (banner !== targetVersion) return 'skip:banner-mismatch'
    manifest.version = targetVersion
    await io.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    try {
      if (log && typeof log.fire === 'function') log.fire('info', 'update.install.manifestSync', { pluginId: UPDATE_PLUGIN_ID, fromVersion: current, toVersion: targetVersion })
    } catch {
      // 日志写不进去不影响修复本身
    }
    return 'synced'
  } catch {
    return 'skip:error'
  }
}

/**
 * 建四个电话的处理器（查状态 / 查新版 / 装更新 / 取更新日志）。
 * 入参与旧形状同名（deps.logCtx、deps.ctx、deps.readerOverrides），调用方与门禁都不用改；
 * 内部只是更新包的建能力入口，不传自定义安装执行，不挡包路由。
 * 装更新那条包一层验明正身（见 __syncInstalledManifest）：文件级安装不换身份证时，
 * 把身份证补成代码横幅里那个已装好的版本；平时无操作直通，安装回包原样返回。
 * 取更新日志那条原样直通，给面板日志章用（面板票 #876）。
 */
export function createUpdatePhoneHandlers(deps = {}) {
  const ctx = deps.ctx ?? null
  const key = `${ctx ? 'ctx' : 'noctx'}\0${deps.logCtx ? 'log' : 'nolog'}`
  if (phones && phonesKey === key) return phones
  const holder = createHostUpdate(
    {
      ctx,
      logCtx: deps.logCtx ?? null,
      readerOverrides: deps.readerOverrides ?? {},
    },
    {
      pluginId: UPDATE_PLUGIN_ID,
      prefix: UPDATE_PHONE_PREFIX,
      releaseChannel: UPDATE_RELEASE_CHANNEL,
      // 必须显式传：更新包的建能力入口不带 targetPackageName 时会落到它自带的旧 Deck 默认值，
      // 于是「查新版/装更新」整条路又指回旧包 —— 这是本文件最容易漏的一处（2026-10-11 被门禁实测抓到：
      // 拦截到的请求是 https://registry.npmjs.org/dsh-mattpocock-skills-deck/latest）。
      // DEFAULT_TARGET_PACKAGE 与这里必须同源，由 tests/merge/host/update-target.test.mjs 逐条断言。
      targetPackageName: DEFAULT_TARGET_PACKAGE,
    }
  )
  // 更新包给的是「电话名 → 处理器」的表；调用方要的是四个具名入口，
  // 这里按键取出来，键名取自包自己拼的电话名，不另拼字符串。
  const rawInstall = holder.handlers[holder.phoneNames.updateInstall]
  const hereDir = dirname(fileURLToPath(import.meta.url))
  const syncLog = deps.logCtx ?? null
  phones = {
    phoneNames: holder.phoneNames,
    handleUpdateStatus: holder.handlers[holder.phoneNames.updateStatus],
    handleUpdateCheck: holder.handlers[holder.phoneNames.updateCheck],
    handleUpdateInstall: async function (args) {
      const result = await rawInstall(args)
      const target = result && result.snapshot && result.snapshot.job && result.snapshot.job.targetVersion
      await __syncInstalledManifest({ moduleDir: hereDir, targetVersion: target, io: { readFile, writeFile }, log: syncLog })
      return result
    },
    handleUpdateChangelog: holder.handlers[holder.phoneNames.updateChangelog],
  }
  phonesKey = key
  return phones
}

/** 测试与门禁复位单例（正常运行不调用）。
 *  要复位两处：本文件缓存的四个处理器，以及更新包内部缓存的那个读取器。
 *  只复位前者会留下一个隐患——换了假机器之后，包里的旧读取器还在，下一次调用仍复用它，
 *  于是「换一台机器重查」这种用例会拿到上一台的缓存结果（门禁实测踩到过：断网用例却回了成功）。 */
export function __resetSharedUpdateReaderForTests() {
  phones = null
  phonesKey = ''
  resetPackageReader()
}
