#!/usr/bin/env node
/**
 * 用户站根（面板自更新的源 origin）：元数据摆两条路径 + 包体摆进两层目录。
 * 用法：node tools/channel/update-origin-root.mjs --dir <站点根> --tgz <包路径> --version 1.7.6
 *        [--origin https://sunsetrne.github.io]
 *
 * 盘上形状（dsh-plugin-update 的强校验，别改名别挪位）：
 *   /<包名>/latest                                          元数据
 *   /%40sunsetrne%2F<包名>/latest                           同一份（请求走 encodeURIComponent(包名)）
 *   /<包名>/-/<包名>-<版本>.tgz                             包体；文件名段带 scope → 实际是 <包名>/-/@sunsetrne/<name>-<ver>.tgz
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt }
const PKG = '@sunsetrne/dsh-github-resident-v2'
const BARE = 'dsh-github-resident-v2'
const dir = resolve(opt('dir', '.'))
const tgz = resolve(opt('tgz', ''))
const version = opt('version', '')
const origin = String(opt('origin', 'https://sunsetrne.github.io')).replace(/\/+$/, '')
if (!version || !tgz) { console.error('用法：--dir <站点根> --tgz <包路径> --version <x.y.z>'); process.exit(2) }

const buf = readFileSync(tgz)
const sha256 = createHash('sha256').update(buf).digest('hex')
const sha512 = 'sha512-' + createHash('sha512').update(buf).digest('base64')

const body = JSON.stringify({
  name: PKG,
  version,
  engines: { node: '>=22.18.0' },
  dist: { tarball: `${origin}/${PKG}/-/${PKG}-${version}.tgz`, integrity: sha512 },
}, null, 2) + '\n'

mkdirSync(join(dir, PKG, '-', '@sunsetrne'), { recursive: true })
copyFileSync(tgz, join(dir, PKG, '-', '@sunsetrne', `${BARE}-${version}.tgz`))
writeFileSync(join(dir, PKG, 'latest'), body)
writeFileSync(join(dir, '%40sunsetrne%2F' + BARE, 'latest'), body)

// 页面文案里的版本号跟着走（只动「包名里的版本」与 <b>版本</b> 这两处，历史表格不去碰）
for (const f of ['index.html', 'README.md']) {
  const p = join(dir, f)
  if (!existsSync(p)) continue
  const text = readFileSync(p, 'utf8')
  const next = text
    .replace(/(dsh-github-resident-v2-)\d+\.\d+\.\d+(\.tgz)/g, `$1${version}$2`)
    .replace(/(<b>)\d+\.\d+\.\d+(<\/b>)/g, `$1${version}$2`)
  if (next !== text) writeFileSync(p, next)
}
console.log(JSON.stringify({ version, sha256: sha256.slice(0, 12), sha512: sha512.slice(0, 24), bytes: buf.length }))
