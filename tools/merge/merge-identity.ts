/**
 * tools/merge/merge-identity.ts —— 合并包的身份与装配面常量（**单一真源**）
 *
 * 为什么单独一个文件：包名 / 客户端模块 id / 两层 inject 并集这几件事，在
 * deck 构建脚本、合并后处理脚本、门禁断言与文档里都要被引用。写成多处字面量必然漂移，
 * 而「id 不一致」的失败方式是**静默的**（客户端脚本加载不上、技能发现目录全丢），
 * 排查成本极高。所以这里定死一次，别处只许引用。
 *
 * 改名纪律（评估 §3.4 已定）：本包沿用 Resident 主体身份 `@sunsetrne/dsh-github-resident-v2`，
 * 但**包名与槽位/存储键解耦**——下面这几个串**不跟着改**：
 *   - dock 槽位 id          'dsh-mattpocock-skills-deck'（conversation.input.dock）
 *   - 右栏 tab 类型 id/kind 'dsh-mattpocock-skills-deck/deck:map' / '...:deck-map'
 *   - choices.json 的 workspace 键、localStorage 的 dsws.* 键
 * 改它们等于让用户已有的布局、后端选择与 UI 偏好一起失效。
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 合并后的 npm 包名，同时是客户端模块 id 与 bundle patch 里的 name。 */
export const MERGED_PACKAGE_NAME = '@sunsetrne/dsh-github-resident-v2'

const IDENTITY_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 合并包版本（**单一真源：根 package.json 的 version**）。
 *
 * 为什么单独定这一条：合并后的客户端里，Deck 半边的 `DSW_VERSION` 本来是 deck 构建按
 * `deck/package/package.json` 注入的 `v1.8.0-rc.7`。那是**上游 Deck 的版本**，把它显示在
 * 合并包（Resident 主体，根 package.json）的版本位上，等于用一个没发生过的版本身份冒充本包
 * ——自更新面板与「安装副本版本同步」都会跟着错。所以构建期把 Deck 那半边的版本字面量
 * 改写成这里的值（见 client-factory.ts 的 `rewriteVersionLiteral`）。
 *
 * 形状要求 `x.y.z`：宿主 `updateFromPackage.js` 的横幅解析正则只认它。
 */
export const MERGED_VERSION: string = (() => {
  try {
    const raw = JSON.parse(readFileSync(resolve(IDENTITY_REPO_ROOT, 'package.json'), 'utf8')) as { version?: unknown }
    const v = typeof raw.version === 'string' ? raw.version.trim() : ''
    if (!/^\d+\.\d+\.\d+/.test(v)) throw new Error('根 package.json 的 version 形状不合法：' + JSON.stringify(v))
    return v
  } catch (e) {
    throw new Error('[merge-identity] 无法从根 package.json 读取合并包版本：' + String((e as Error)?.message || e))
  }
})()

/** 客户端展示用的版本字面量，与 deck 构建注入的 `'v<version>'` 同形（去 v 前缀显示在设置页）。 */
export const MERGED_VERSION_LITERAL = `'v${MERGED_VERSION}'`

/**
 * 合并包自己的仓库地址（**单一真源 = 根 package.json 的 repository.url**）。
 *
 * 为什么要有它：Deck 半边原来的 `DSW_REPO_URL` 由 deck 自己的构建从 *deck/package/package.json* 注入，
 * 指向的是**上游 Deck 仓库**。合并后界面上那几个"点版本号开门"的链接会把人带去另一个插件的主页，
 * 与 Resident 侧的仓库登记库页并列出现时尤其容易误读成"版本认的不是主插件"。这里定死一次，
 * deck 构建（合并模式下）与合并改写层都读它，两处不许各写一份 URL 字面量。
 */
export const MERGED_REPO_URL: string = (() => {
  try {
    const raw = JSON.parse(readFileSync(resolve(IDENTITY_REPO_ROOT, 'package.json'), 'utf8')) as {
      repository?: { url?: unknown } | string
    }
    const field = raw.repository
    const url = typeof field === 'string' ? field : (field && typeof field.url === 'string' ? field.url : '')
    const cleaned = url.trim().replace(/^git\+/, '').replace(/\.git$/, '')
    if (!/^https?:\/\//.test(cleaned)) throw new Error('根 package.json 的 repository.url 不是 http(s)：' + JSON.stringify(url))
    return cleaned
  } catch (e) {
    throw new Error('[merge-identity] 无法从根 package.json 读取合并包仓库地址：' + String((e as Error)?.message || e))
  }
})()

/** 客户端展示用的仓库地址字面量（注入形态，含引号）。 */
export const MERGED_REPO_URL_LITERAL = `'${MERGED_REPO_URL}'`

/** deck 快照在合并包里的相对根（构建脚本据此定位 deck 的 src / package / scripts）。 */
export const DECK_SUBDIR = 'deck'

/**
 * 客户端模块依赖（导出对象的 `inject`）：
 *   Resident 半边需要 slots；Deck 半边需要 connection / slots / locale / workspaces / sessions。
 * 取并集。这三层 inject **不合并成一组**（包级 dsh.client.inject 是包名依赖，见根 package.json）：
 *   - 包级 dsh.client.inject  → ['@deepseek-ai/dsh-client-ui-settings-general']（settings.section 声明方先就位）
 *   - 客户端导出 inject        → 本常量
 *   - 宿主级 inject            → HOST_INJECT（见下）
 */
export const MERGED_CLIENT_INJECT = ['connection', 'slots', 'locale', 'workspaces', 'sessions']

/**
 * 宿主插件的服务依赖（Host 插件定义对象的 `inject`）：
 *   Resident 半边需要 tools；Deck 宿主半边需要 connection / llm / sessionQuery
 *（Deck 自身还会在 apply 里等 subprocess 与 timer，那属于运行时门，不是声明依赖）。
 */
export const MERGED_HOST_INJECT = ['tools', 'connection', 'llm', 'sessionQuery']

/** 客户端脚本里的唯一加载点特征：宿主按包名注册客户端图行，重复 load 会抛错。 */
export const MODULE_LOADER_MARKER = 'window.__ModuleLoader__.load('

/** deck 的 `/tools` 行模块在 deck 快照里的相对路径（包 exports["./tools"] 指向构建产物）。 */
export const DECK_TOOLS_ROW_SOURCE = `${DECK_SUBDIR}/src/host/platform/deckToolsRow.js`

/**
 * 合并后的**运行时身份串**（槽位 id、右栏 tab kind/id、样式表 data-plugin、控制台前缀、日志命名空间）。
 *
 * 为什么与包名分开写：包名是 npm 身份（`@sunsetrne/dsh-github-resident-v2`），身份串是**界面与状态里的名字**。
 * 两者过去都借用了上游 Deck 的名字（`dsh-mattpocock-skills-deck`），于是合并后界面上到处是"另一个插件"
 * 的痕迹 —— 这正是"彻底融为一个插件"要收掉的东西。
 *
 * ⚠️ 它与**持久化状态**有关，改动必须带迁移，不许直接换字面量：
 *   - dock 槽位 id 进 DSH 的会话槽位视图；
 *   - 右栏 tab 的 `kind` / `contentId` 进 `dsh.sidebar-right.v1.<sessionId>` 的 `layout.tabs[]`。
 * 客户端启动时会跑一次身份迁移（见 `deck/src/client/kernel/identityMigration.js`），
 * 把旧串改写成这个值，因此**老会话的右栏那一格不会丢**。
 *
 * 取值来源 = 根 package.json 的 `dsh.identity.merge`：deck 构建（scripts/build.mjs）读同一个字段，
 * 于是"构建期注入的身份"与"合并改写层认定的身份"不可能各说各话。
 */
export const MERGED_IDENTITY: string = (() => {
  try {
    const raw = JSON.parse(readFileSync(resolve(IDENTITY_REPO_ROOT, 'package.json'), 'utf8')) as {
      dsh?: { identity?: { merge?: unknown } }
    }
    const v = raw?.dsh?.identity?.merge
    if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(v)) {
      throw new Error('dsh.identity.merge 形状不合法：' + JSON.stringify(v))
    }
    return v
  } catch (e) {
    throw new Error('[merge-identity] 无法从根 package.json 读取 dsh.identity.merge：' + String((e as Error)?.message || e))
  }
})()

/**
 * 被融掉的旧 Deck 运行时身份串（**只读**，只用于两件事：状态迁移与漂移守卫）。
 * 任何新代码都不许再拿它当"本插件的名字"用 —— 那是身份回退。
 * 取值来源 = 根 package.json 的 `dsh.identity.legacy`（同上，与 deck 构建同源）。
 */
export const LEGACY_DECK_IDENTITY: string = (() => {
  try {
    const raw = JSON.parse(readFileSync(resolve(IDENTITY_REPO_ROOT, 'package.json'), 'utf8')) as {
      dsh?: { identity?: { legacy?: unknown } }
    }
    const v = raw?.dsh?.identity?.legacy
    if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(v)) {
      throw new Error('dsh.identity.legacy 形状不合法：' + JSON.stringify(v))
    }
    return v
  } catch (e) {
    throw new Error('[merge-identity] 无法从根 package.json 读取 dsh.identity.legacy：' + String((e as Error)?.message || e))
  }
})()

/** 合并后客户端脚本的落地路径（相对仓库根）。 */
export const MERGED_CLIENT_OUT = 'dist/client.js'

/** 合并后宿主入口的落地路径（相对仓库根）。 */
export const MERGED_HOST_OUT = 'dist/host.js'

/** 合并后宿主入口的作者态 TypeScript 源（构建输入）。 */
export const MERGED_HOST_SRC = 'tools/merge/host-assembly.ts'

/**
 * 合并客户端的两份**真实输入**（相对仓库根）。构建必须两份都传：
 *   - deck 半边：`deck/package/lib/client.js`，deck 构建（deck/scripts/build.mjs）的产物，**未改写**原样；
 *   - Resident 半边：根 `client.js`，作者态源码（id 已是合并身份）。
 * 少任何一份都只能得到「假合并」（产物里只剩半边），装配层会抛错，见 tools/merge/client-factory.ts。
 */
export const DECK_CLIENT_SRC = `${DECK_SUBDIR}/package/lib/client.js`
export const RESIDENT_CLIENT_SRC = 'client.js'

/**
 * 随包技能的**发布位置**：包根 `bundled-skills/`。
 *
 * 为什么不是 deck 快照里的 `deck/package/bundled-skills/`：合并后宿主按
 * `<包名>/bundled-skills` 找随包技能（候选根写死包名，见 deck/src/host/bootstrap.js 与 skillDoc.js），
 * 装到 profile 后本包根就是 `node_modules/@sunsetrne/dsh-github-resident-v2/`，
 * 因此技能必须落在**包根**。源快照仍在 `deck/package/bundled-skills/`（deck 自己的构建与门禁按它认路径），
 * 构建时逐字复制到包根，两份不一致由 `--check` 拦住。
 */
export const BUNDLED_SKILLS_SRC = `${DECK_SUBDIR}/package/bundled-skills`
export const BUNDLED_SKILLS_OUT = 'bundled-skills'
/** 随包技能目录数（不含 VERSION / LICENSE / README.md 这些文件）。 */
export const BUNDLED_SKILLS_EXPECTED = 27

/**
 * 客户端改写的结果。
 * 带上两处替换的完成标记与改写前后字节数：调用方据此打一行可核对的日志，
 * 也便于门禁在「改写成功但内容没变」时察觉锚点其实已经漂移（字节数不变就是可疑信号）。
 */
export interface RewriteResult {
  text: string
  idReplaced: boolean
  injectReplaced: boolean
  bytesBefore: number
  bytesAfter: number
}

