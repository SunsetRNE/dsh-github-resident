/**
 * tests/merge/host/deck-params-surface.test.mjs —— 9 个 deck 工具的参数面纪律：顶层必填不许被**同名**的嵌套必填污染。
 *
 * 为什么需要它（2026-10-14 实测，合并包 1.8.2）：deck_map_link 的真实契约是「key 或 edges 二选一」
 * （见 deck/src/host/tools/deckMapLink.js 的 run：两者都没有才回 BAD_ARGS）。它的定义面顶层**没有** required，
 * 唯一那条 required: ['key'] 嵌在 edges.items 里（每一项边必须写 key）。可是渲染给模型的参数面把**同名**的
 * 嵌套必填合并到了顶层，实测模型侧看到的是：
 *     "required": ["key"]        ← 顶层凭空多出必填，纯 edges 的批量模式被误判成「必须给 key」
 * 同一份定义里 deck_map_plan_create 也有嵌套 required（children/edges 项里的 title/from/to），但它与顶层
 * 属性名一个都不撞 → 顶层没被污染。**这正是「按名字合并」而不是「整体上提」的证据**，也是本用例判据的形状。
 *
 * 根因在渲染层（不在本仓，改不到），所以这里钉住本仓能守的那一半：定义面不许出现
 * 「顶层属性名 ∩ 任意嵌套 required 名」的非空交集 —— 一撞名，模型侧就多出一条必填。
 * 撞名场景的必填语义写进描述，运行期由工具自己拒绝（deck_map_link 那条 BAD_ARGS 文案仍在，见第 3 节）。
 *
 * 隔离：只读本仓文件、不连网、不碰 HOME、不起进程。
 * 用法：node tests/merge/host/deck-params-surface.test.mjs
 */
import { check, note, section, summary, importRel, readText } from './_check.mjs'

const TOOL_FILES = [
  'deckContext', 'deckIssueGet', 'deckMapSnapshot', 'deckIssueList', 'deckIssueCreate',
  'deckMapPlanCreate', 'deckMapLink', 'deckIssuePatch', 'deckIssueReport',
]

/** 顶层属性名（模型侧那一层的直接子属性）。 */
function topLevelProps(parameters) {
  return Object.keys((parameters && parameters.properties) || {})
}

/** 收集**顶层以下**任意层的 required 名字（顶层自己的 required 不算「嵌套」）。 */
function nestedRequiredNames(node, isRoot, out) {
  if (!node || typeof node !== 'object') return out
  if (!isRoot && Array.isArray(node.required)) for (const k of node.required) out.push(String(k))
  if (node.properties) for (const k of Object.keys(node.properties)) nestedRequiredNames(node.properties[k], false, out)
  if (node.items) nestedRequiredNames(node.items, false, out)
  return out
}

section('1) 九件工具：不许出现「顶层凭空多出必填」（嵌套同名 required 把没这回事的属性标成必填）')
const defs = {}
for (const f of TOOL_FILES) {
  const mod = await importRel('deck/src/host/tools/' + f + '.js')
  defs[mod.definition.name] = mod.definition
}
check(Object.keys(defs).length === TOOL_FILES.length, `九件定义都读到了（实得 ${Object.keys(defs).length} 件）`)

const latent = []
for (const name of Object.keys(defs)) {
  const params = defs[name].parameters || {}
  const top = topLevelProps(params)
  const topRequired = Array.isArray(params.required) ? params.required.map(String) : []
  const nested = [...new Set(nestedRequiredNames(params, true, []))]
  const collide = nested.filter((k) => top.indexOf(k) >= 0)
  // 危害形态 = 撞名 **且** 该名字在顶层本来不是必填 —— 合并后顶层才会多出一条必填。
  const harmful = collide.filter((k) => topRequired.indexOf(k) < 0)
  if (collide.length && !harmful.length) latent.push(`${name}（${collide.join(',')}：顶层本来就必填，合并后无变化）`)
  check(harmful.length === 0,
    `${name}：不新增顶层必填` + (harmful.length
      ? `（会凭空多出：${harmful.join(', ')} —— 嵌套同名 required 被合并到顶层）`
      : `（撞名：${collide.length ? collide.join(',') + '（顶层已必填）' : '无'}；嵌套 required：${nested.length ? nested.join(',') : '无'}）`))
}
if (latent.length) note('潜在撞名（当前无害，改顶层必填或改嵌套字段名时会变成真缺陷，届时本用例会红）：' + latent.join('；'))

section('2) deck_map_link：参数面任何一层都不写 required（撞名场景的处置纪律）')
const link = defs.deck_map_link
check(Boolean(link), 'deck_map_link 定义在')
const linkTop = link.parameters.required
const linkNested = nestedRequiredNames(link.parameters, true, [])
check(linkTop === undefined || (Array.isArray(linkTop) && linkTop.length === 0), '顶层不声明 required')
check(linkNested.length === 0, `全树不出现 required（实得 ${linkNested.length} 条：${linkNested.join(',') || '无'}）`)
check(topLevelProps(link.parameters).indexOf('key') >= 0 && topLevelProps(link.parameters).indexOf('edges') >= 0, 'key 与 edges 两个入口都还在（删的是必填标记，不是参数）')
// 描述要替 required 把话说完，否则模型不知道每项边得写 key。
const edgesDesc = String(((link.parameters.properties || {}).edges || {}).description || '')
check(edgesDesc.indexOf('key') >= 0, 'edges 的描述里点明了「每项要写 key」')

section('3) 运行期契约仍在：两个入口都不给时才拒绝')
const src = readText('deck/src/host/tools/deckMapLink.js')
check(src.indexOf('要改哪张票的边') >= 0, 'BAD_ARGS 的说明文案仍在（缺 key 与 edges 时的拒绝理由）')
check(/Array\.isArray\(a\.edges\)\s*&&\s*a\.edges\.length\s*\?\s*a\.edges\s*:\s*\(a\.key\s*\?\s*\[a\]\s*:\s*\[\]\)/.test(src),
  '取值口径仍是「edges 清单 → 否则 key 单票 → 都没有则拒绝」')

note('判据形状来自实测：按名字合并（plan_create 有嵌套 required 但不撞名 → 顶层未被污染）；')
note('根因在渲染层，本用例只守定义面这一半；改动 deckMapLink 的参数面时请连描述一起改。')

summary()
