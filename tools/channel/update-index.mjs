#!/usr/bin/env node
/**
 * 项目站通道（gh-pages）：把一份 tgz 写成 index.json 里的「当前版本」，并摊平历史。
 * 用法：node tools/channel/update-index.mjs --dir <渠道目录> --tgz <包路径> --version 1.7.6
 *        [--origin https://sunsetrne.github.io] [--ref <来源说明>]
 * CI（.github/workflows/release.yml）与本地发布都走这一份，别在别处再写一遍。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt }
const dir = resolve(opt('dir', '.'))
const tgz = resolve(opt('tgz', ''))
const version = opt('version', '')
const origin = String(opt('origin', 'https://sunsetrne.github.io')).replace(/\/+$/, '')
const ref = opt('ref', '') || (process.env.GITHUB_SHA ? 'CI 构建 · ' + process.env.GITHUB_SHA.slice(0, 7) : '')
if (!version || !tgz) { console.error('用法：--dir <渠道目录> --tgz <包路径> --version <x.y.z>'); process.exit(2) }

const buf = readFileSync(tgz)
const sha256 = createHash('sha256').update(buf).digest('hex')
const sha512 = 'sha512-' + createHash('sha512').update(buf).digest('base64')
const bytes = buf.length
const file = basename(tgz)
copyFileSync(tgz, join(dir, file))

const indexFile = join(dir, 'index.json')
const j = existsSync(indexFile)
  ? JSON.parse(readFileSync(indexFile, 'utf8'))
  : { schema: 'dsh-github-resident/artifact-index', schemaVersion: 1, package: '@sunsetrne/dsh-github-resident-v2' }
const prevVersion = j.version
const prevTarball = j.tarball
const prevSha = j.sha256

Object.assign(j, {
  version,
  publishedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  sourceRef: ref,
  tarball: file,
  url: `${origin}/dsh-github-resident/${file}`,
  sha256,
  sha512,
  bytes,
  install: `npm i ${origin}/dsh-github-resident/${file}`,
})
if (prevVersion && prevVersion !== version) {
  j.previous = [...(j.previous || []).filter((x) => x.version !== prevVersion), { version: prevVersion, superseded: true }]
  j.superseded = [
    { version: prevVersion, tarball: prevTarball, sha256: prevSha, reason: '被新版本取代；可作回滚件' },
    ...(j.superseded || []).filter((x) => x.version !== prevVersion),
  ]
}
j.npmShapedSource = {
  origin: origin + '/',
  metadata: `${origin}/@sunsetrne/dsh-github-resident-v2/latest`,
  metadataEncoded: `${origin}/%40sunsetrne%2Fdsh-github-resident-v2/latest`,
  tarball: `${origin}/@sunsetrne/dsh-github-resident-v2/-/@sunsetrne/dsh-github-resident-v2-${version}.tgz`,
  note: '面板自更新（dsh-plugin-update）只认「源 origin 根」下的这个形状；项目站带 /dsh-github-resident/ 前缀会判 invalid-release',
}
writeFileSync(indexFile, JSON.stringify(j, null, 2) + '\n')
console.log(JSON.stringify({ version, file, sha256: sha256.slice(0, 12), sha512: sha512.slice(0, 24), bytes }))
