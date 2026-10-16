// verify-b3-done-color.js — dsh-waystation v1.5 B3（#457）：map 列表行完成态「新会话」按钮与「完成」同色
// 用法: node tests/verify-b3-done-color.js（在插件根目录；无需 gh / 网络）
// 验证：
//   1) map 完成态（mapDone）时列表行「新会话」按钮 background=#3fb950、文字=#0c1a10（与「完成」同色）
//   2) 非完成态回退 actionColorOf(x, colorOf)（维持按 label 配色，不受影响）
//   3) 「完成」按钮本身保持 #3fb950 / #0c1a10
//   4) 范围守卫：仅列表行（openInNewSession(st, x)）带 mapDone 配色；详情面板（st, t）与 map 详情（st, m）的
//      新会话按钮不得带 mapDone 配色（D9/6A：只改 map 列表行，其余状态不变）
//   5) 双源镜像一致性（client.js ↔ package/lib/client.js 关键特征逐字等价）
//
// 2026-10-16（#64 收口）：判据锚点对齐源码现状 —— 列表行那段现在是**单行**文本（src/client/views/ListTabRow.js:125
//   一行里就是整个动作组），按「行号区间」切片会切在同一个字符串里（旧实现要求「完成按钮」在「新会话」上一行，
//   于是取不到组块）；同时行内逗号后没有空格（openInNewSession(st,x) vs 旧锚 openInNewSession(st, x)）。
//   两者都是排版形态、不是语义变化：完成态上色逻辑在源码里逐字还在。断言一条没删、一个字面量没放宽，
//   只是把「按行切」换成「按字符锚点切」、把字面量比较换成空白无关比较（先去空白再比同样的字面量）。
import fs from 'node:fs'
const files = ['client.js', 'package/lib/client.js']
let failed = false
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('B3: 完成态「新会话」同色（#457）')

const norm = function (s) { return String(s).replace(/\s+/g, '') }

// 列表行动作组块 = 完成按钮 + 新会话按钮所在的连续区间（互相比邻）。
// 2026-10-16：源码里整个动作组落在同一行，改成字符锚点切片：
//   起点 = 「新会话」调用之前最近的一处 tr('map.doneTitle')（即「完成」按钮），
//   终点 = 该「新会话」按钮的子节点锚点 tr('list.newSessionLabel')（props/style 都在它之前）。
const actionGroup = function (src) {
  const call = /openInNewSession\(\s*st\s*,\s*x\s*\)/.exec(src)
  if (!call) return ''
  const callIdx = call.index
  const doneIdx = src.lastIndexOf("tr('map.doneTitle')", callIdx)
  if (doneIdx < 0) return ''
  const tail = src.indexOf('list.newSessionLabel', callIdx)
  const end = tail > 0 ? tail + 'list.newSessionLabel'.length : callIdx + 1200
  return src.slice(doneIdx, end)
}

const collected = {}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const block = actionGroup(src)
  const tag = f.indexOf('package/') >= 0 ? 'pkg' : 'cli'
  collected[tag] = block

  check(block.length > 0, f + ' 列表行动作组块（完成+新会话）提取成功')
  if (!block.length) { failed = true; continue }
  const n = norm(block)
  // 完成按钮 = 绿底深字
  check(n.includes("background:'#3fb950'"), f + ' 完成按钮 background #3fb950')
  check(n.includes("color:'#0c1a10'"), f + ' 完成按钮 color #0c1a10')
  // 新会话按钮完成态同色
  // #457 之后列表行又加了「map 空态」前置分支（mapEmpty → 琥珀 #f59e0b / 深字 #140a1e，
  //   见 src/client/views/ListTabRow.js:125 的 inspect 分支）——完成态那两档逐字仍在，只是不再是三元的第一个分支。
  check(n.includes("background:mapEmpty?'#f59e0b':mapDone?'#3fb950':actionColorOf(x,colorOf)"), f + ' 新会话完成态 background=#3fb950（空态 #f59e0b 前置，非完成态回退 actionColorOf）')
  check(n.includes("color:mapEmpty?'#140a1e':mapDone?'#0c1a10':(isLightHex(actionColorOf(x,colorOf))"), f + ' 新会话完成态 color=#0c1a10（空态 #140a1e 前置）')
  // 非完成态文字色逻辑保留（isLightHex 分支未删）
  check(n.includes("(isLightHex(actionColorOf(x,colorOf))"), f + ' 非完成态文字色仍按 isLightHex')
  // 范围守卫：详情面板(st, t) 与 map 详情(st, m) 的新会话按钮不得引用 mapDone
  const otherLines = src.split('\n').filter(l => /openInNewSession\(\s*st\s*,\s*[tm]\s*\)/.test(l) && l.includes('mapDone'))
  check(otherLines.length === 0, f + ' 详情面板/map 详情新会话按钮未带 mapDone 配色（范围=仅列表行）')
  // 列表行新会话按钮仅 1 处（无双写漂移）
  const rowCount = (src.match(/openInNewSession\(\s*st\s*,\s*x\s*\)/g) || []).length
  check(rowCount === 1, f + ' 列表行新会话按钮仅 1 处（无双写漂移）')
}

// 双源一致性已移除（T5 #98：一源两物，build 保证同构）
// 保留对单产物（_dev/_pkg 各自）的完成态同色校验；双源逐字一致由构建保证

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
