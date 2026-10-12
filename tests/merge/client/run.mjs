/**
 * tests/merge/client/run.mjs —— 合并客户端装配的测试入口
 *
 * 用法：node tests/merge/client/run.mjs
 * 只跑本目录（受控夹具，无 jsdom / 无真 React / 无网络 / 不写生成物）。
 * 真产物装配（deck/package/lib/client.js + dist/client.js）与全量门禁属于集成人那一步。
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(HERE, f))
if (files.length === 0) {
  console.error('tests/merge/client: 没找到 *.test.mjs')
  process.exit(1)
}
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(result.status === null ? 1 : result.status)
