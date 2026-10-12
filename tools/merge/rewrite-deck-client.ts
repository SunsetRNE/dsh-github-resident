/**
 * tools/merge/rewrite-deck-client.ts —— 合并包客户端产物的生成入口（**两半装配**）
 *
 * 这个模块是对外唯一入口：构建脚本只调 `rewriteDeckClient(deckSource, residentSource)`。
 * 真正的装配课在 [`./client-factory.ts`](./client-factory.ts)：把两个半边各自的 factory 原文
 * 装进**一个** `window.__ModuleLoader__.load`，两半独立词法作用域，`exports.inject` 取并集，
 * `apply` 先 Deck 后 Resident。
 *
 * 为什么签名从「一个输入」变成「两个输入」：
 *   只传 deck 产物时，产物里始终只有 Deck 半边——Resident 的两个设置页根本不存在，
 *   那不是合并。少任何一个输入都必须**失败**，不许静默省半边。
 *
 * **不改**的东西（改了就等于让用户既有状态失效，见 merge-identity.ts 的改名纪律）：
 *   - `conversation.input.dock` 槽位 id（与模块 id 同串，但是槽位标识不是包标识）
 *   - 右栏 tab 类型 id/kind、`data-plugin` 属性、作者外链、地方化键
 *
 * 用法（构建脚本）：
 *   const deckSource = readFileSync('deck/package/lib/client.js', 'utf8')
 *   const residentSource = readFileSync('client.js', 'utf8')   // 根 client.js
 *   const result = rewriteDeckClient(deckSource, residentSource)
 *   writeFileSync('dist/client.js', result.text)
 */

import type { RewriteResult } from './merge-identity.ts'
import { composeMergedClient, type ComposedClient } from './client-factory.ts'

export { DECK_INJECT_ANCHOR, DOCK_SLOT_ANCHOR, DECK_MODULE_ID } from './client-factory.ts'

/**
 * 合并产物与既有 `RewriteResult` 的兼容视图：
 * 原字段（idReplaced / injectReplaced / bytesBefore / bytesAfter）一个不少，
 * 额外字段供门禁与构建日志核对两半都到齐了。
 */
export type ComposedRewriteResult = RewriteResult & ComposedClient

/**
 * 把 Deck 产物与 Resident 作者态装配成合并包唯一的客户端脚本。
 *
 * @param deckSource     `deck/package/lib/client.js`（deck 构建产物，未改写）
 * @param residentSource 根 `client.js`（Resident 半边作者态）
 * @throws 任一输入缺失/为空、锚点漂移、半边声明了未登记的 inject、装配后自检不通过
 */
export function rewriteDeckClient(deckSource: string, residentSource: string): ComposedRewriteResult {
  const composed = composeMergedClient(deckSource, residentSource)
  return {
    text: composed.text,
    // 合并产物里 id 与 inject 都由本模块写入：两处都算「已重置成合并值」。
    idReplaced: true,
    injectReplaced: true,
    bytesBefore: composed.bytesBefore,
    bytesAfter: composed.bytesAfter,
    moduleId: composed.moduleId,
    inject: composed.inject,
    deckInject: composed.deckInject,
    residentInject: composed.residentInject,
    version: composed.version,
  }
}
