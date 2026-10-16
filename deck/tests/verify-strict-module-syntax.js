#!/usr/bin/env node
// verify-strict-module-syntax.js —— src 全员严格模块解析门禁（#471）。
//
// 背景：2026-09-04 执行 #448 期间，新文件 sessionSnapshot.js 缺了一个 try 开头，
//   src 侧 node --check 全程放行（退出码 0），同一字节在 package/package.json（含 type module）
//   语境下被判为非法（catch 无匹配 try），构建门禁才拦下。同一字节在两种语境下判定结果相反，
//   本地快速检查全绿这个信号被高估了。
// 规则：对 src/ 下每一个 .js 文件，用仓库已有 esbuild 依赖做严格模块解析
//   （transformSync，loader js，format esm；比 scripts/build.mjs 的 gateSyntax 更严：
//   gateSyntax 对不含 export 的文件走 vm.Script 脚本语境，本门禁按票面要求对全员走 ESM），
//   失败即红。根 package.json 不加 type module（ tests 下几十个 require 脚本会连锁炸掉，否决）。
//
// #67 补记 —— 解析语境按**实际加载形态**分两档（判据只增不减：多解析一档，不多放过一处）：
//   · 默认档：src/ 下没有登记为拼接片段的文件，一律按严格 ESM 模块解析（上面那条规则不变）。
//   · 片段档：src/client 下有一批复用叶子**不是模块**，而是被 scripts/build.mjs 按登记表
//     （KERNEL_MODULES / LEAF_MODULES / SHARED_SPLICE）剥掉行首 export、原样拼进
//     src/client/index.js 的 apply 闭包里的**片段**。对登记过的文件改按「apply 函数体」语境解析：
//     与构建产物同形，也仍然拦得住真语法错（下面自检里两条互相咬：非法字节在片段语境照样红，
//     而顶层 return 在片段语境合法）。为什么要有这一档：40ebd3a（2026-10-12 身份融合现状快照）
//     带进来的合并装配里，panelAssembly.js 片段末尾就是一句 `return { mergeEmbed: … }` ——
//     那是 apply 的返回值，tools/merge 的客户端工厂要消费它；同一句在模块语境里非法、在片段语境里
//     正是本意（git log -S mergeEmbed 查得到：本仓历史上这一句随导入起就在这个文件里）。
//     登记表只读文本不 import（import build.mjs 会当场跑构建）。
// 用法：node tests/verify-strict-module-syntax.js（在插件根目录）
import fs from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

let failed = false
function ok(msg) { console.log('  PASS ' + msg) }
function bad(msg) { failed = true; console.log('  FAIL ' + msg) }
function info(msg) { console.log('  INFO ' + msg) }

/** 与 build.mjs 的 extractModuleBlock 同一手法：剥掉每行行首的 export，再包回 apply 的函数体。 */
const stripExports = (code) => code.split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
const asFragment = (code) => 'function __spliced(){\n' + stripExports(code) + '\n}'

console.log('严格模块解析门禁：src/ 全员 esbuild ESM 解析（#471）')

// ---- 自检内存夹具：证明门禁本身能分辨合法与非法 ----
function selfCheck(cond, msg, detail) {
  if (cond) console.log('  PASS 自检：' + msg)
  else { failed = true; console.log('  FAIL 自检：' + msg + (detail ? '（' + detail + '）' : '')) }
}
{
  const valid = "export function foo() {\n  try { console.log(1) } catch {} \n}\n"
  let validOk = true
  try {
    esbuild.transformSync(valid, { loader: 'js', format: 'esm' })
  } catch (e) { validOk = false }
  selfCheck(validOk, '合法模块能过（try 配 catch 的导出函数）')

  // #448 实证形态：缺 try 开头，多一个 } catch（与 src/ 同字节在宽松侧放行，在严格侧必挂）
  const invalid = "export function foo(deps) {\n  async function bar() {\n    const x = 1\n      console.log(x)\n    } catch (e) {\n      console.log(e)\n    }\n  }\n}\n"
  let invalidCaught = false
  try {
    esbuild.transformSync(invalid, { loader: 'js', format: 'esm' })
  } catch (e) { invalidCaught = true }
  selfCheck(invalidCaught, '非法模块能红（缺 try 开头的 catch 块）')

  // 片段档不是免检通道：同一份非法字节拼进 apply 函数体仍然要红
  let fragCaught = false
  try {
    esbuild.transformSync(asFragment(invalid), { loader: 'js', format: 'esm' })
  } catch (e) { fragCaught = true }
  selfCheck(fragCaught, '拼接片段语境下的非法字节照样红（片段档不是免检通道）')

  // 而顶层 return（apply 的返回值）在片段语境里合法 —— 这正是本门禁要放行的那一处
  let fragReturnOk = true
  try {
    esbuild.transformSync(asFragment('export const api = function () {}\nreturn { mergeEmbed: api }\n'), { loader: 'js', format: 'esm' })
  } catch (e) { fragReturnOk = false }
  selfCheck(fragReturnOk, '拼接片段语境允许顶层 return（apply 的返回值）')
}
if (failed) {
  console.log('\n自检失败 —— 门禁实现未通过内存夹具')
  process.exit(1)
}
console.log('  PASS 自检内存夹具全部通过')

// ---- 真实仓库扫描 ----
function listJsFiles() {
  if (!fs.existsSync(SRC)) return []
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) out.push(full)
    }
  }
  walk(SRC)
  return out.sort()
}

// ---- 拼接片段名单：从 scripts/build.mjs 的登记表读出来（只读文本，不 import）----
function spliceRegistryBlock(name) {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build.mjs'), 'utf8')
  const start = src.indexOf('const ' + name + ' = [')
  if (start < 0) return ''
  const end = src.indexOf('\n]', start)
  return end < 0 ? src.slice(start) : src.slice(start, end)
}
const SPLICED = new Set()
for (const name of ['KERNEL_MODULES', 'LEAF_MODULES', 'SHARED_SPLICE']) {
  for (const m of spliceRegistryBlock(name).matchAll(/\bfile:\s*'([^']+)'/g)) SPLICED.add(m[1])
}
if (SPLICED.size === 0) bad('拼接片段名单一个都没读出来（build.mjs 的登记表漂移了？）—— 那批片段会被按模块解析，本门禁会误红')

const files = listJsFiles()
if (files.length === 0) {
  bad('src/ 下一个 .js 文件都没扫到（目录缺失或口径漂移），请检查扫描范围')
  console.log('\n存在失败')
  process.exit(1)
}
let passCount = 0
let fragmentCount = 0
for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  let code
  try {
    code = fs.readFileSync(abs, 'utf8')
  } catch (e) {
    bad(rel + ' 读取失败：' + e.message)
    continue
  }
  try {
    esbuild.transformSync(code, { loader: 'js', format: 'esm' })
    passCount++
  } catch (e) {
    const lines = String((e && e.message) || e).split('\n').slice(0, 3).join(' | ')
    if (!SPLICED.has(rel)) {
      bad(rel + ' 严格解析失败：' + lines)
      continue
    }
    // 登记过的拼接片段：改按它被拼进去的那个函数体语境解析（同一条字节，换成语境对的那把尺子）
    try {
      esbuild.transformSync(asFragment(code), { loader: 'js', format: 'esm' })
      fragmentCount++
      passCount++
    } catch (e2) {
      const lines2 = String((e2 && e2.message) || e2).split('\n').slice(0, 3).join(' | ')
      bad(rel + ' 拼接片段解析失败（apply 函数体语境）：' + lines2 + '（模块语境下是：' + lines + '）')
    }
  }
}
if (fragmentCount > 0) info('其中 ' + fragmentCount + ' 个是拼接片段，按 apply 函数体语境解析（模块语境下不成立，见文件头 #67 补记）')

if (!failed) {
  ok('真实仓库全绿：' + passCount + ' 个 src/ 文件严格解析零失败（共扫 ' + files.length + ' 个；片段档 ' + fragmentCount + ' 个）')
} else {
  info('已扫 ' + files.length + ' 个，通过 ' + passCount + ' 个')
}

if (failed) console.log('\n存在失败')
else console.log('\n全部通过')
process.exit(failed ? 1 : 0)
