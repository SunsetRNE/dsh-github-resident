// src/shared/plugin-identity.js —— 合并包的**宿主侧身份真源**（2026-10-12 身份融合）
//
// 为什么单独一份文件：宿主侧有几处必须说清"我是哪个插件"，而它们过去各写各的：
//   - 更新包按它做本地状态命名空间（`UPDATE_PLUGIN_ID`，去 scope 的合法标识）；
//   - 九个 deck_* 工具的 description 会进**所有会话的系统提示**，过去自称"dsh-mattpocock-skills-deck 插件"
//     —— 那是被融掉的上游 Deck 的名字，模型每轮都读到它；
//   - 宿主启动失败提示（index.js）过去把带 scope 的包名写死成字面量。
// 三处同源之后，改名只需要动这一个文件（外加 tools/merge/merge-identity.ts 的构建期身份）。
//
// 与另外两处身份的关系（**都指向同一件事，但用途不同，谁也别抄谁**）：
//   1. `tools/merge/merge-identity.ts`：构建期真源（包名 / 运行时身份串 / 版本 / 仓库地址）。
//   2. 本文件：**运行时**宿主侧真源（随包发布，客户端构建期注入的那份叫 DSW_IDENTITY，见 deck/scripts/build.mjs）。
//   3. 客户端界面上的名字（「GitHub 常驻」）是词条，不是身份：它住在 kernel/locale-panel.js 的 panel.title。
// 接线：零依赖，谁都能 import（客户端半边不会 import 它——客户端身份由构建期注入，客户端没有运行时 import）。
export const MERGED_PACKAGE_NAME = '@local/dsh-github-resident-v2'

/** 去 scope 的插件标识：更新包的本地状态命名空间（带 `/` 会被 assertPluginId 在加载期拒绝）。 */
export const UPDATE_PLUGIN_ID = MERGED_PACKAGE_NAME.replace(/^@[^/]+\//, '')

/** 被融掉的旧 Deck 包名（**只读**：漂移守卫用，别再拿它当本插件的名字）。 */
export const LEGACY_DECK_PACKAGE_NAME = 'dsh-mattpocock-skills-deck'

/** 面向模型的自我介绍用名（工具 description 里的那一个）。 */
export const PLUGIN_DISPLAY_NAME = 'GitHub 常驻'
