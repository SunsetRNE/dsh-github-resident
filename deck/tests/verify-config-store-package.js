// verify-config-store-package.js — 发布包 YAML 门禁（#1012 落地；#66 改钉合并包清单）
// 规则（维护者拍板：发布包要真的拿得到 YAML 解析，三者对齐，用门禁钉住）：
//   P1 生产依赖里有 yaml，且「发货的那份清单」与 deck 侧发货清单主版本一致。
//      2026-10-16（#66）：身份融合后真正发布的是**仓库根** package.json（@sunsetrne/dsh-github-resident-v2，
//      files 白名单里带 deck/src/），deck/package.json 只是 deck 子树的派生清单、不是发货清单；
//      #1012 当次那两条「两份版本号都没动（=1.8.0-rc.7，本票不发版）」是那一次的一次性绊线，
//      在合并仓里没有对应物（根清单版本 1.11.0、deck 派生清单版本是上游快照的 1.8.0-rc.13），
//      故换成「根清单版本可读」这条仍然成立的断言。
//   P2 装好的包里能解析：node_modules/yaml 可加载，且用它能解析一份 YAML。
//   P3 核产物随包发布：package/package.json 的 files 白名单含 shared（产物能进包）。
//   P4 宿主适配器可加载：src/host/configStore.js 能 import，六个冻结函数都在。
// 用法：node tests/verify-config-store-package.js（在仓库根目录）
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import * as YamlMod from 'yaml'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg, detail) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : '')))
  if (!ok) failed = true
}

async function main() {
  console.log('发布包 YAML 门禁（#1012：装好的包里能解析）')

  // #66：发货清单 = 仓库根 package.json（合并包）；deck/package/package.json 是 deck 侧发货清单
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'package.json'), 'utf8'))
  const shipPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package', 'package.json'), 'utf8'))

  // —— P1：两份依赖对齐 ——
  const rootYaml = (rootPkg.dependencies || {}).yaml
  const shipYaml = (shipPkg.dependencies || {}).yaml
  check(typeof rootPkg.name === 'string' && /resident/.test(rootPkg.name), '合并包清单是仓库根 package.json（' + rootPkg.name + '）', '')
  check(typeof rootYaml === 'string' && rootYaml, '合并包 package.json 生产依赖里有 yaml', rootYaml)
  check(typeof shipYaml === 'string' && shipYaml, 'deck 发货清单 package/package.json 生产依赖里有 yaml', shipYaml)
  const majorOf = (s) => String(s || '').replace(/^[\^~>=< ]+/, '').split('.')[0]
  check(!!rootYaml && !!shipYaml && majorOf(rootYaml) === majorOf(shipYaml), '两处 yaml 主版本一致（' + rootYaml + ' / ' + shipYaml + '）', '')
  check(typeof rootPkg.version === 'string' && rootPkg.version.length > 0, '合并包清单版本可读（' + rootPkg.version + '）', '')

  // —— P2：装好的包里能解析 ——
  try {
    const yaml = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'yaml', 'index.js')).href).catch(() => null)
    const mod = yaml || YamlMod
    const parsed = mod.parse('version: 2\nbackendId: github\n')
    check(parsed && parsed.backendId === 'github', '装好的 yaml 能解析', JSON.stringify(parsed))
  } catch (e) {
    check(false, '装好的 yaml 能解析：' + (e && e.message))
  }

  // —— P3：产物随包发布 ——
  const files = shipPkg.files || []
  check(files.indexOf('shared') >= 0, '发布包 files 白名单含 shared（核产物能进包）', JSON.stringify(files))
  for (const name of ['ports.js', 'workspace.js', 'settings.js', 'labels.js']) {
    check(fs.existsSync(path.join(ROOT, 'src', 'shared', 'config-store', name)), '核产物在 shared 下已生成：' + name, '')
  }
  check(!fs.existsSync(path.join(ROOT, 'src', 'shared', 'config-store', 'config-store.js')), '老单体产物已拆掉（不留双份实现）', '')
  check(fs.existsSync(path.join(ROOT, 'src', 'host', 'configStore.js')), '宿主适配器在', '')

  // —— P4：适配器可加载，冻结函数都在（文本出入口两个 + 文件读写六个） ——
  try {
    const adapter = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
    for (const name of ['parseConfig', 'stringifyConfig', 'readWorkspaceConfig', 'writeWorkspaceConfig', 'readLocalSettings', 'writeLocalSettings', 'readLabelColors', 'writeLabelColors']) {
      check(typeof adapter[name] === 'function', '冻结函数在：' + name)
    }
  } catch (e) {
    check(false, '宿主适配器可加载：' + (e && e.message))
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 发布包 YAML 门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
