// verify-issue-comment.js — #255 四缝验证：契约缝 + UI 缝 + 集成差异冒烟（宿主透传冒烟见 smoke-comment-passthrough）
// - 契约缝：canComment 显隐谓词对三形状（MISSING / EMPTY 数组 / EMPTY nodes）的行为断言（从构建产物提取真源表达式求值）
// - UI 缝：输入区受控交互 / ⌘+Enter / 分流文案 / 只读提示替换 / 无乐观证据闪烁的源码特征
// - 集成差异冒烟：diffSnapshots 对「纯评论变化（updatedAt bump）」产出行闪烁——根票（孤儿票）补口 + 子票元组扩展
// - 门禁自检：UI 层零 backendId 字面量（贪婪后端分支红线）+ locale 中英键完整
// 用法: node tests/verify-issue-comment.js
import fs from 'node:fs'
import { compileFn } from './lib/eval-probe.js'
// #65：下面求值切出的 diffSnapshots 依赖同闭包邻居 idOf；喂这里的真源，而不是门禁里另写一份副本。
import { idOf } from '../src/shared/tracker/constants.js'
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const cli = fs.readFileSync('client.js', 'utf8')
const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
const host = fs.readFileSync('host.js', 'utf8')
const phost = fs.readFileSync('package/lib/index.js', 'utf8')
const hostComments = fs.readFileSync('src/host/commentThreads.js', 'utf8') // H5 #449：评论通路搬到评论电话文件，拼合断言意图不变
const hostSide = host + hostComments
const phostComments = fs.readFileSync('package/lib/commentThreads.js', 'utf8')
const phostSide = phost + phostComments
const detailSrc = ['src/client/views/IssueDetail.js', 'src/client/views/IssueDetailComments.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n') // V3 #463：评论区搬到评论文件，拼合断言意图不变（输入区与提交逻辑在评论文件）
const apiSrc = ['src/client/kernel/api-naming.js', 'src/client/kernel/api-new-session.js', 'src/client/kernel/api-io.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n') // 原 api.js 已消除，读三文件拼合断言（评论提交在输入输出文件）
const probeSrc = ['src/client/kernel/probe-chain.js','src/client/kernel/probe-snapshot.js','src/client/kernel/probe-auto.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n') // 456 收尾：probe.js 已拆为三文件，读三文件拼起来的内容断言（本变量仅作源存在性 tripwire，行为断言走构建产物）
const localeSrc = ['src/client/kernel/locale-panel.js', 'src/client/kernel/locale-flow.js', 'src/client/kernel/locale-word.js', 'src/client/kernel/locale.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n') // 原 locale.js 已瘦身为合并器（无键仅合并逻辑），读四文件拼合断言（评论键在流程文案文件）

// ============ host 透传存在性（唯一宿主改动）============
check(host.includes("harness.handle('wf.commentIssue'"), 'host 含 wf.commentIssue handle')
check(phost.includes("wf.commentIssue"), 'package host 镜像含 wf.commentIssue')
check(hostSide.includes('.comment(repoRef'), 'host 经 tracker.comment（契约 op）转发，不走私 gh 直调')
check(/r.ok[sS]{0,80}cache = { ts: 0, snapshot: null/.test(phostSide.replace(/\n/g, ' ')) || phostSide.includes('#213 同语义') || phostSide.includes('#213 白名单同语义'), '成功路径含面板快照缓存失效（#213 同语义）')

// ============ client api 层 ============
check(apiSrc.includes("host.call('wf.commentIssue'"), 'api.submitIssueComment 调 wf.commentIssue')
check(apiSrc.includes("'rate-limit'") || apiSrc.includes('rate.?limit'), 'api 错误归一化覆盖 rate-limit（双拼写兼容）')

// ============ UI 缝：受控输入区特征 ============
check(detailSrc.includes('submitIssueComment'), 'IssueDetail 调 submitIssueComment')
check(detailSrc.includes('metaKey || ev.ctrlKey') || detailSrc.includes('metaKey||ev.ctrlKey'), '支持 ⌘+Enter / Ctrl+Enter 快捷发送')
check(detailSrc.includes('disabled: !(st.cmtDraft'), '空内容发送按钮 disabled')
check(detailSrc.includes("st.cmtSending = true"), '提交态置位（防重复提交）')
// #65 判据改写理由：原判据把条件渲染写死成字面量 `readOnlyKnown ? h('span'`。产品 #763 把底部只读提示
//   从单个 span 换成容器 div（里面仍是同一句 tr('detail.readOnlyHint')），条件与提示都没丢 ——
//   钉死 DOM 标签的是判据，不是产品漂移。改为断言「同一条件分支里渲染同一句提示键」：条件不在就不渲染，
//   且提示键必须落在这个受条件保护的分支内（判据不减弱，只把无关的标签形状摘掉）。
{
  const roIdx = detailSrc.indexOf('readOnlyKnown ? h(')
  const roBranch = roIdx >= 0 ? detailSrc.slice(roIdx, roIdx + 600) : ''
  check(roIdx >= 0 && roBranch.includes("tr('detail.readOnlyHint')"), '只读提示条件化（只在确实不能评论时才提示；#693 起「还没拿到评论」不再冒充「只读」）')
}
check(detailSrc.includes("placeholder: tr('detail.cmtPlaceholder')"), 'Markdown 提示占位符接入 locale')
;['detail.cmtAuthFail', 'detail.cmtRateLimit', 'detail.cmtGeneric'].forEach(k => check(detailSrc.includes("'" + k + "'"), '分流文案键 ' + k))

// —— 契约缝 A：显隐谓词行为（从构建产物提取真源比较式直接求值，杜绝测试私有副本漂移）
const predM = pcli.match(/canComment = !!rawComments && \((.+?)\)\s*\r?\n/)
let predOk = false
if (predM) {
  try {
    // 内部表达式原样求值（含 typeof / Array.isArray），不做任何改写
    // 产物里那截比较式原样求值（含 typeof / Array.isArray），改走共用入口 compileFn，不做任何改写。
    const evaluator = compileFn(['rawComments'], '"use strict"; return !!rawComments && (' + predM[1] + ')')
    const hidden = evaluator(undefined) === false                       // MISSING：字段省略 → 不渲染
    const emptyArr = evaluator([]) === true                             // EMPTY：契约 Comment[] 空 → 渲染
    const emptyNodes = evaluator({ nodes: [], pageInfo: {} }) === true  // EMPTY：GraphQL 形状空 → 渲染
    const notArrNodes = evaluator({ nodes: null }) === false            // 异形（nodes 非数组）→ 不渲染
    predOk = hidden && emptyArr && emptyNodes && notArrNodes
  } catch (e) { predOk = false }
}
check(predOk, '谓词行为：MISSING 隐 / EMPTY([]) 显 / EMPTY(nodes) 显 / 异形隐')

// —— 契约缝 B：OpResult 错误分流（auth/rate-limit/其他 三路文案选择函数）
check(detailSrc.includes("k === 'auth'") && detailSrc.includes("k === 'rate-limit'"), '路由按 kind 分流（鉴权/限流/通用）')

// —— 门禁自检：UI 层零 backendId 字面量（贪婪后端分支红线 · G5）
const branchHits = (detailSrc.match(/backendId/g) || []).length
check(branchHits === 0, 'IssueDetail 零 backendId 字面量（命中 ' + branchHits + ' 处）')

// —— 无乐观假设：闪烁必须依赖服务端重取证据；提交函数不做本地评论节点注入
check(detailSrc.includes('st.cmtConfirm') && detailSrc.includes('__cb'), '确认闪烁仅由服务端重取证据驱动')
{
  const si = apiSrc.indexOf('submitIssueComment')
  const fnTxt = si >= 0 ? apiSrc.slice(si, apiSrc.indexOf('export', si + 10) > 0 ? apiSrc.indexOf('export', si + 10) : undefined) : ''
  check(fnTxt.length > 200 && fnTxt.indexOf('issueDetail =') < 0 && fnTxt.indexOf('.push(') < 0, 'submitIssueComment 不做本地评论注入')
}

// ============ 集成差异冒烟：从产物提取 diffSnapshots 真源求值 ============
const dStart = pcli.indexOf('const diffSnapshots = function')
const dEnd = pcli.indexOf('// R5', dStart)
let diffBehavior = false, orphans = false, ticketUpd = false, shortCircuit = false
if (dStart > 0 && dEnd > dStart) {
  try {
    const fnText = pcli.slice(dStart, dEnd).replace('export ', '').replace('const diffSnapshots', 'diffSnapshots')
    // 从产物里切出的整段 diffSnapshots 求值：改走共用入口 compileFn。
    // #65：这段源码**不是**自足的 —— 它按票身份建索引（m[idOf(x)] / ix[idOf(i)] / ia[idOf(i)]），
    //   而 idOf 是同一闭包里的邻居函数（产物自己的注释：「hexA / emit / timer / idOf 都是同一个闭包里的邻居」），
    //   单独切出这一段后闭包没了 → 求值当场 ReferenceError: idOf is not defined，下面四条断言全部落空。
    //   这是**门禁切片边界漏了依赖**，不是产品坏。补法：喂真源函数（shared/tracker/constants.js 的 idOf，
    //   与产物闭包内那一份同源），不在门禁里另写私有副本（本文件前面那条纪律：杜绝测试私有副本漂移）。
    const sandboxFn = compileFn(['idOf'], fnText + '\nreturn diffSnapshots;')
    const diffSnapshots = sandboxFn(idOf)
    // #65：真实快照行逐行带身份字段 key（宿主快照见 src/host/tracker/snapshot.js 的 poolIdOf：effortOf + key；
    //   夹具原来只手写 number，idOf 取不到 key 会把所有行折成同一个空身份）。这里把夹具补齐成真实形状，
    //   四个断言一字未改 —— 补的是数据形状，不是判据。
    const base = { ok: true, version: 'v1', generatedMs: 1,
      maps: [{ number: 248, key: '248', title: 'Map', state: 'OPEN', labels: ['wayfinder:map'], tickets: [{ number: 253, key: '253', state: 'CLOSED', progress: '100%', claimedBy: 'me', labels: [], updatedAt: 't1' }] }],
      issues: [{ number: 255, key: '255', title: 'Spec', state: 'OPEN', labels: ['ready-for-agent'], updatedAt: 'u1' }] }
    // 真实快照的 version 为内容哈希：任何字段变化 ⇒ 版本必变，否则短路合法吞掉差异。
    // ① 子票纯评论变化（updatedAt bump + 版本推进）→ issueFlash.changed
    const tick = JSON.parse(JSON.stringify(base))
    tick.generatedMs = 2
    tick.version = 'v2'
    tick.maps[0].tickets[0].updatedAt = 't2'
    const r1 = diffSnapshots(base, tick)
    ticketUpd = !!(r1.issueFlash && r1.issueFlash[253] === 'changed')
    // ② 根票（孤儿票）updatedAt bump → changed 含 255（右侧主列表行闪烁的数据源）
    const r2base = JSON.parse(JSON.stringify(base)); const r2new = JSON.parse(JSON.stringify(base))
    r2new.generatedMs = 3; r2new.version = 'v3'; r2new.issues[0].updatedAt = 'u9'
    const r2 = diffSnapshots(r2base, r2new)
    // #65：changed 装的是索引键（idOf 产出、进对象后即字符串），不是数字票据号 ——
    //   消费侧 probe-select.js 直接 st.rowFlash[n] = 'changed'，对象索引下 '255' 与 255 等价。
    //   原判据拿数字 indexOf(255) 比字符串数组，恒为 -1。改成按产出侧的键空间比，身份仍限定为「255 那张根票」。
    orphans = Array.isArray(r2.changed) && r2.changed.map(String).indexOf('255') >= 0
    // ③ 内容全同但版本推进 → 空差异（不误闪）
    const r3base = JSON.parse(JSON.stringify(base)); const r3new = JSON.parse(JSON.stringify(base))
    r3new.generatedMs = 4; r3new.version = 'v4'
    const r3 = diffSnapshots(r3base, r3new)
    diffBehavior = r3.added.length === 0 && r3.changed.length === 0 && r3.removed.length === 0
    // ④ 同版本短路
    const r4 = diffSnapshots(base, JSON.parse(JSON.stringify(base)))
    shortCircuit = r4.skipped === true
  } catch (e) {
    console.log('  (diff 求值异常: ' + e.message.slice(0, 120) + ')')
  }
}
check(ticketUpd, '子票 updatedAt bump → issueFlash changed')
check(orphans, '根票（孤儿票）updatedAt bump → 行闪烁数据源产出')
check(diffBehavior !== false, '内容同版本异 → 空差异（不误闪）')
check(shortCircuit, '同版本短路 skipped=true（304 零扰动语义保留）')

// ============ locale 双语完整门禁 ============
;['detail.cmtPlaceholder', 'detail.cmtSend', 'detail.cmtSending', 'detail.cmtAuthFail', 'detail.cmtRateLimit', 'detail.cmtGeneric'].forEach(k => {
  const hits = localeSrc.split("'" + k + "'").length - 1
  check(hits >= 2, 'locale 键双语齐全 ' + k + '（拼合出现 ' + hits + ' 次，中英各一）')
})

// ============ 双产物一致性 ============
check(cli.includes('wf.commentIssue') && pcli.includes('wf.commentIssue'), '双产物 client 含 wf.commentIssue')
check(cli.includes('cmtDraft') && pcli.includes('cmtDraft'), '双产物 client 含受控草稿状态')
check(host.includes('wf.commentIssue') && phost.includes('wf.commentIssue'), '双产物 host 含 wf.commentIssue')

console.log(failed ? '\n#255 四缝验证失败' : '\n#255 四缝验证全部通过')
process.exit(failed ? 1 : 0)