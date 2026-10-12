// src/host/skillDoc.js —— 技能原文直读（888 落地：详情页读本地原文的电话 skill.readDoc）。
// 以后谁改它：改详情取数口径或原文定位的人。接线：由 index.js 动态 import 加载，依赖全显式传入；
// 不引用其他新文件（H4），定位走与 bootstrap.js 同一套候选目录（随包目录可信口径与它一致）。
// 只读随包原文目录：技能名只认字母数字与 - _（防跨目录），只拼 <dir>/<name>/SKILL.md，
// 读不到、非法名、超长一律回 {ok:false, missing:true}。
// 成功时把该文件的绝对路径一并回给界面：弹窗上那颗「复制路径」要复制的就是它（2026-10-10 人拍板）。
// 中文译文包（同目录的 SKILL.zh.md）有就一起回：弹窗上的「中文」按钮据此出现，没有译文就不出现。
// 英文原文照旧必回；译文缺失、读不动、超长都只是「没有译文」，不影响英文那一份。
// 注意分寸：路径可以给界面显示与复制，但**日志里永远不写路径原文**（日志纪律另有其要求，两件事不冲突）。
export function createSkillDoc(deps) {
  const MAX_BYTES = 200000
  function validName(n) { return typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(n) }
  function stripFrontmatter(raw) {
    const s = String(raw || '').replace(/^\uFEFF/, '')
    const m = s.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
    if (!m) return s
    return s.slice(m[0].length)
  }
  async function findCardPath(name) {
    const pathMod = await import('node:path')
    const fsSync = await import('node:fs')
    const osMod = await import('node:os')
    const urlMod = await import('node:url')
    const candidates = []
    // 合并后的单包身份与随包技能根（真源 tools/merge/merge-identity.ts 的 MERGED_PACKAGE_NAME；deck/ 内不能运行期
    // import 那份 .ts，字面由 tests/merge/host/identity-parity 逐项核对）。**不留旧包名候选**：合并的前提是旧组合已停用。
    const MERGED_PACKAGE_NAME = '@sunsetrne/dsh-github-resident-v2'
    // 1) 本模块自身位置优先：开发检出 <repo>/deck/src/host/、构建形态 <repo>/deck/package/lib/、打包解压后
    //    <pkg>/deck/src/host/。候选按**层**穷举而不是猜层数：每层都问 <层>/bundled-skills（构建负责人定下的
    //    发布位置，包根 bundled-skills/）与 <层>/package/bundled-skills（入库快照），再加两种 node_modules 形状。
    //    不再依赖 process.cwd() 与技能根有什么关系（2026-10-11 修）。候选语义与 bootstrap.js 保持同一套。
    try {
      const pushNodeModules = (base) => {
        candidates.push(pathMod.join(base, 'node_modules', MERGED_PACKAGE_NAME, 'bundled-skills'))
        candidates.push(pathMod.join(base, 'node_modules', MERGED_PACKAGE_NAME, 'deck', 'package', 'bundled-skills'))
      }
      let up = pathMod.dirname(urlMod.fileURLToPath(import.meta.url))
      for (let i = 0; i < 6; i++) {
        candidates.push(pathMod.join(up, 'bundled-skills'))
        candidates.push(pathMod.join(up, 'package', 'bundled-skills'))
        pushNodeModules(up)
        const parent = pathMod.dirname(up)
        if (parent === up) break
        up = parent
      }
    } catch {}
    // 2) 工作目录兜底（旧行为，保留）。
    try {
      const cwd = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? String(process.cwd() || '') : ''
      if (cwd) {
        candidates.push(pathMod.resolve(cwd, 'package/bundled-skills'))
        candidates.push(pathMod.resolve(cwd, '../package/bundled-skills'))
        candidates.push(pathMod.resolve(cwd, '../../package/bundled-skills'))
        candidates.push(pathMod.resolve(cwd, 'bundled-skills'))
        let cur = cwd
        for (let i = 0; i < 4; i++) {
          candidates.push(pathMod.join(cur, 'bundled-skills'))
          candidates.push(pathMod.join(cur, 'package', 'bundled-skills'))
          candidates.push(pathMod.join(cur, 'node_modules', MERGED_PACKAGE_NAME, 'bundled-skills'))
          candidates.push(pathMod.join(cur, 'node_modules', MERGED_PACKAGE_NAME, 'deck', 'package', 'bundled-skills'))
          cur = pathMod.dirname(cur)
        }
      }
    } catch {}
    // 3) 家目录下各 profile 的 node_modules（发布位置与随包快照两种形状都问）。
    try {
      const home = osMod.homedir()
      if (home) {
        for (const profileName of ['web', 'desktop']) {
          const base = pathMod.join(home, '.dsh', 'profiles', profileName, 'node_modules', MERGED_PACKAGE_NAME)
          candidates.push(pathMod.join(base, 'bundled-skills'))
          candidates.push(pathMod.join(base, 'deck', 'package', 'bundled-skills'))
        }
      }
    } catch {}
    const seen = new Set()
    for (const c of candidates) {
      const n = pathMod.normalize(c)
      if (seen.has(n)) continue
      seen.add(n)
      const file = pathMod.join(n, name, 'SKILL.md')
      try {
        const st = fsSync.statSync(file)
        if (st && st.isFile()) return file
      } catch {}
    }
    return null
  }
  async function readDoc(args) {
    const name = args && args.name
    if (!validName(name)) return { ok: false, missing: true }
    try {
      const file = await findCardPath(name)
      if (!file) return { ok: false, missing: true }
      const fsp = await import('node:fs/promises')
      const raw = await (fsp.default || fsp).readFile(file, 'utf8')
      if (raw == null || raw.length > MAX_BYTES) return { ok: false, missing: true }
      const md = stripFrontmatter(raw)
      if (!md || !md.trim()) return { ok: false, missing: true }
      let mdZh = null
      let pathZh = null
      try {
        const zhFile = file.replace(/SKILL\.md$/, 'SKILL.zh.md')
        const rawZh = await (fsp.default || fsp).readFile(zhFile, 'utf8')
        const z = stripFrontmatter(rawZh)
        if (z && z.trim() && z.length <= MAX_BYTES) { mdZh = z; pathZh = zhFile }
      } catch {}
      return { ok: true, md: md, path: file, mdZh: mdZh, pathZh: pathZh }
    } catch { return { ok: false, missing: true } }
  }
  return { readDoc }
}
