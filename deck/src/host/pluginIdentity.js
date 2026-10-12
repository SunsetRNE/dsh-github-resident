/**
 * host/pluginIdentity.js — “我现在装着的这一份是哪个包、什么版本、哪个仓库”（2026-10-12 身份融合）。
 *
 * 为什么有它：界面上那两处身份显示（右栏版本号、设置页的版本 / 仓库链接）过去读的是**客户端构建期字面量**
 * —— 说的是"构建那一刻的版本"，而用户要看的是"现在跑着的这一份"。文件级安装只换代码、不换已装目录的
 * package.json 时，这两者会不一致（宿主侧 __syncInstalledManifest 就是为这类场景准备的）。
 * 所以这里给客户端一条**只读**电话：回已装目录 package.json 的 name / version / repository。
 *
 * 一条纪律：**不许**在这里编造身份。找不到已装包根（源码态、门禁夹具、被解包的子树）就如实回
 * `found:false`，由客户端保留构建期字面量 —— 绝不回一个猜出来的版本号。
 *
 * 接线：由 host/index.js 注册为 `wf.pluginIdentity`；本文件零副作用，可重复调用。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MERGED_PACKAGE_NAME } from '../shared/plugin-identity.js'

/** 已装包的根：从本文件所在目录逐级向上找 name === 合并包名的 package.json（最多 8 层）。 */
function findInstalledRoot() {
  try {
    let cur = dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 8; i++) {
      try {
        const pkg = JSON.parse(readFileSync(join(cur, 'package.json'), 'utf8'))
        if (pkg && pkg.name === MERGED_PACKAGE_NAME) return { root: cur, pkg: pkg }
      } catch (eRead) { /* 这一层没有 / 读不动，继续往上 */ }
      const parent = dirname(cur)
      if (!parent || parent === cur) break
      cur = parent
    }
    return null
  } catch (e) {
    return null
  }
}

/** `repository` 字段的两种形态都认（string / { url }），去掉 git+ 前缀与 .git 后缀。 */
function repoUrlOf(pkg) {
  try {
    const r = pkg && pkg.repository
    const raw = typeof r === 'string' ? r : (r && r.url) || ''
    return String(raw).replace(/^git\+/, '').replace(/\.git$/, '')
  } catch (e) {
    return ''
  }
}

/**
 * 只读出口。返回形态：
 *   { ok:true, found:true, name, version, repoUrl, dir }  —— 找到已装包根
 *   { ok:true, found:false }                              —— 源码态 / 夹具：客户端保留构建期值
 * 永不抛错：这条电话只服务显示，不该成为任何流程的闸。
 */
export function handlePluginIdentity() {
  try {
    const hit = findInstalledRoot()
    if (!hit) return { ok: true, found: false }
    return {
      ok: true,
      found: true,
      name: String(hit.pkg.name || ''),
      version: String(hit.pkg.version || ''),
      repoUrl: repoUrlOf(hit.pkg),
      dir: hit.root,
    }
  } catch (e) {
    return { ok: true, found: false }
  }
}

export default handlePluginIdentity
