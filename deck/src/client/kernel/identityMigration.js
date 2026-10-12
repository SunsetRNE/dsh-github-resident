/**
 * client/kernel/identityMigration.js — 一次性身份迁移（2026-10-12 身份融合）。
 *
 * 为什么需要它：面板在 DSH 里留下的**两处持久化状态**带着身份串，而这次身份从
 * 被融掉的上游 Deck 旧名（读作 `dsh-mattpocock`+`-skills-deck`；构建期以占位符注入，见 LEGACY_IDENTITY 常量）
 * 换成了本包自己的名字（`dsh-github-resident-v2`，同样构建期注入）。
 *   1) dock 槽位 id —— 输入框上方那条功能栏按槽位 id 认领自己的位置；
 *   2) 右栏标签 —— DSH 原生右栏把标签写进 `dsh.sidebar-right.v1.<sessionId>` 的 `layout.tabs[]`，
 *      每格带 `kind` 与 `contentId`（**都是身份串**，见 DSH 的 readSidebarLayout / validateReferences）。
 *
 * 不迁的后果不是报错，而是**静默少东西**：老会话打开右栏时那一格找不到已注册的类型，
 * 用户会以为面板坏了；功能栏也会从已保存的布局里掉出去。所以这里做"读旧写新"。
 *
 * 三条纪律：
 *   - **只碰身份串**：整串包含旧身份（或旧身份 + 冒号 / 斜杠变体）才改写，其余一个字不动；
 *     `dsws.*` 那些用户偏好键（折叠状态、列表偏好……）**永远不碰** —— 那是用户的设置，不是身份。
 *   - **幂等**：新身份已出现就直接返回；重复执行不会产生第二次改写。
 *   - **永不抛**：localStorage 不可用、内容不是 JSON、结构不是预期形状，一律静默跳过（迁移不是主流程的闸）。
 *
 * 为什么用"扫全量 localStorage 键"而不是写死两个键名：
 *   右栏那个键名（`dsh.sidebar-right.v1.<sessionId>`）是**宿主侧的**，写死它等于把宿主的实现细节抄进来；
 *   dock 那处也还没有稳定契约。判据只有一条 —— **这个值里带着旧身份串** —— 所以按判据扫，比按位置扫耐用。
 */
export const LEGACY_IDENTITY = '__DSW_LEGACY_IDENTITY__'

/** 旧身份在该字符串里出现的全部形态（整串 / 前缀 + 分隔符）。 */
function replaceLegacyIdentity(text) {
  let out = text
  // 前缀形态：`<old>:deck-map`、`<old>/deck:map`、`<old>: styles` 等（冒号/斜杠后还有内容）
  out = out.split(LEGACY_IDENTITY + ':').join('__DSW_IDENTITY__:')
  out = out.split(LEGACY_IDENTITY + '/').join('__DSW_IDENTITY__/')
  // 整串形态：槽位 id、data-plugin、effect 名等
  out = out.split(LEGACY_IDENTITY).join('__DSW_IDENTITY__')
  return out.split('__DSW_IDENTITY__').join(DSW_IDENTITY)
}

/**
 * 把这份存储里所有带旧身份的取值改写成当前身份。
 * @param {Storage} storage localStorage 兼容对象
 * @returns {{scanned:number, changed:number, fields:string[]}} 统计（日志用，不含键名原文）
 */
export function migrateStoredIdentity(storage) {
  const stat = { scanned: 0, changed: 0, fields: [] }
  try {
    if (!storage || typeof storage.length !== 'number') return stat
    const keys = []
    for (let i = 0; i < storage.length; i++) {
      try {
        const k = storage.key(i)
        if (k) keys.push(k)
      } catch (eKey) { /* 单个键读不动就跳过 */ }
    }
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      stat.scanned++
      let raw = null
      try { raw = storage.getItem(key) } catch (eGet) { continue }
      if (typeof raw !== 'string' || raw.indexOf(LEGACY_IDENTITY) < 0) continue
      const next = replaceLegacyIdentity(raw)
      if (next === raw) continue
      try {
        storage.setItem(key, next)
        stat.changed++
        // 只记字段类别，不记键名（键名里有 sessionId）
        if (stat.fields.indexOf('sidebar/dock') < 0) stat.fields.push('sidebar/dock')
      } catch (eSet) { /* 写失败就当没迁过，下一次启动再试 */ }
    }
    return stat
  } catch (e) {
    return stat
  }
}

/** 把这次迁移的结果记进客户端日志（静默失败，不进主流程）。 */
export function runIdentityMigration(storage) {
  try {
    const st = migrateStoredIdentity(storage)
    if (st.changed > 0 && typeof log === 'function') {
      try { log('info', 'identity.migrate', { changed: st.changed, scanned: st.scanned, fields: st.fields.join(',') }) } catch (eLog) {}
    }
    return st
  } catch (e) {
    return { scanned: 0, changed: 0, fields: [] }
  }
}
