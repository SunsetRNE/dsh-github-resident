// src/shared/child-identity.js —— 「这个子进程要不要戴工牌、戴哪一组」的**唯一**规则表。
//
// 票《Deck 半边接消费面（执行环境由消费面供给）》：Deck 半边过去执行 gh / git **一个字节的 env 都不给**
// 子进程，而合并宿主的子进程服务默认把凭据形状的变量擦掉（只把**调用方显式给的** env 合并在擦除之后，
// 见 @deepseek-ai/dsh-subprocess 的 childEnv）——于是宿主没登录过 gh 时，Deck 就是「gh 在，但谁也不是」。
// 消费面（Resident 的服务位 `ghResolver`）现在除「在哪」（resolve）还答「用谁的身份」（identityEnv，
// **两组分开**给），本文件是 Deck 侧唯一的取用与合并口径。
//
// 三条硬规矩（与《子进程环境》那一轮的 C7 同一口径）：
//   ① **不读任何配置**：值只能经服务位来（词表：绕过消费面去读 hosts.yml、或自存一份 token，都算违规）。
//      本文件不 import node:fs、不碰 process.env —— 它只问注入进来的取值口。
//   ② **不缓存**：每次执行现问（票面验收「Deck 侧不许存副本」），因此这里没有 memo、没有模块级变量。
//   ③ **不无差别注入**：只有「以插件身份做事」的执行才戴。判据是**实测**过的，不是审美：
//      `GH_TOKEN` 一旦进了子进程会**盖过** gh 自己的登录态，读数就变成假绿（`gh auth status` 会把
//      「宿主自己登没登录」答成「插件有身份」）。所以探活（`gh --version`）与问盘上的 git 只读命令一律不戴。
//
// 谁戴（表）：
//   gh  → gh 组：除 `--version` 探活以外的每一条（议题 / 评论 / 认领 / 仓库可达 / `api user` …都算"以身份做事"）
//   git → git 组：只有真要以插件身份动的写动作（commit / push / pull / fetch）；
//         status / log / diff / `config --get …` 这些读数**不戴** —— 戴上会把「宿主配了什么」读成「插件是什么」。
//   glab → 不戴：那是另一个站点，跟 GitHub 身份无关；更不许"顺手"把 GH_TOKEN 发给它。

/** 需要 git 身份的写动作（commit 要 user.name/email，push/pull/fetch 要凭据助手）。只读命令不在表里。 */
export const GIT_IDENTITY_VERBS = Object.freeze(['commit', 'push', 'pull', 'fetch'])

/** 从 argv 里认出 git 子命令：跳过全局开关与它们吃掉的值（`-c k=v` / `-C dir` / `--git-dir=x`…）。 */
export function gitVerbOf(args) {
  const a = Array.isArray(args) ? args : []
  for (let i = 0; i < a.length; i += 1) {
    const t = String(a[i] == null ? '' : a[i])
    if (t === '') continue
    if (t === '-c' || t === '-C' || t === '--git-dir' || t === '--work-tree' || t === '--namespace' || t === '--exec-path') { i += 1; continue }
    if (t.startsWith('-')) continue
    return t
  }
  return ''
}

/** 程序名归一：带路径的给基名，Windows 的 `.exe` 去掉，大小写无关。 */
function programBase(program) {
  try {
    return String(program || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase()
  } catch (e) { return '' }
}

/**
 * 这一条执行该戴哪一组：`'gh'` / `'git'` / `null`（不戴）。
 * 纯函数 —— 门禁直接测它，接线处不再各写一份判据。
 */
export function identityGroupFor(program, args) {
  const p = programBase(program)
  if (p === 'gh') {
    // 探活只回答「这个程序跑不跑得起来」，不回答「我们是谁」。
    const first = Array.isArray(args) && args.length ? String(args[0] == null ? '' : args[0]) : ''
    return first === '--version' ? null : 'gh'
  }
  if (p === 'git') return GIT_IDENTITY_VERBS.indexOf(gitVerbOf(args)) >= 0 ? 'git' : null
  return null
}

/**
 * 造一个取值口：`envFor(program, args, base)` → 能直接交给 `subprocess.spawn({ env })` 的那一份。
 *
 * - `base` 是调用方自己的底座 env（git 那一路带非交互前缀与墓碑 `undefined`），**工牌合在它上面**，
 *   底座的键一个都不丢；底座为 `undefined` 时回的就是那一组本身（DSH 会把它合并在擦除后的父环境之上）。
 * - 消费面缺席、抛错、或那一组为空（真源没 token 时 gh 组就是空的）→ **原样回底座**：
 *   宁可什么都不给，也不给一套看起来"配好了"的假环境；更**不许**回落去读第二套配置。
 */
export function createChildIdentity(deps) {
  const d = deps || {}
  const getService = (typeof d.getService === 'function') ? d.getService : function () { return null }
  return {
    /** 只要组名（给门禁与日志用，不取服务）。 */
    groupFor: function (program, args) { return identityGroupFor(program, args) },
    envFor: async function (program, args, base) {
      const group = identityGroupFor(program, args)
      if (!group) return base
      let svc = null
      try { svc = await getService() } catch (e) { svc = null }
      if (!svc || typeof svc.identityEnv !== 'function') return base
      let answered = null
      try { answered = await svc.identityEnv({ groups: [group] }) } catch (e) { return base }
      const one = answered ? answered[group] : null
      if (!one || typeof one !== 'object' || Object.keys(one).length === 0) return base
      return Object.assign({}, base || undefined, one)
    },
  }
}
