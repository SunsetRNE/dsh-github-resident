// verify-probe-since.js — dsh-mattpocock-skills-deck · v1.5 R2（#2 MVP · 2026-08-18）
// 用法: node tests/verify-probe-since.js（在插件根目录；无需 gh / 网络）
//
// 背景：probe 从仅检测 open issue 的 `since=<ISO>` 增量查询升级为全量轻量索引，覆盖新增、修改、关闭、重开和删除。
//   此前实现漏检子票变化与删除事件，导致旧磁盘快照中的 issue 永久残留。
//
// 【#64 判据锚点变更 · 判据过期】probe 的实现（全量索引 URL / 分页 / 基线推进 / changed 失效缓存）已不在入口
//   电话体里 —— H2 #446 把「列表与索引」从 host/index.js 搬进 src/host/issueList.js、H5 #449 把「评论与探测」
//   搬进 src/host/commentThreads.js（拆分账本 docs/design/837-host-index-wiring-ledger.md §3 / §5），零打包构建
//   逐字节复制成 package/lib/issueList.js 与 package/lib/commentThreads.js；两个入口只剩模块级状态声明
//   （`let lastProbeAtByRepo = {}` / `let lastIssueIndexByRepo = {}`）与 _issueList()/_comments() 的接线。
//   证据：`git log --oneline -- src/host/commentThreads.js` / `-- src/host/issueList.js` → 40ebd3a
//   （2026-10-12「身份融合前的现状快照」，两个模块整块带入，此后未再改动）。故实现侧断言改锚到模块产物、
//   入口只断言接线；断言语义一条未减，只是每条改打在它真正的承载文件上。
//
// 验证五件事：
//   1) host 侧 `lastProbeAtByRepo` 模块级状态存在 + 按 repoKey 隔离（多仓库会话并发不互串）
//   2) host 侧 probe handler 存在，且用全量索引（issues?state=all&per_page=100 + --paginate）覆盖删除事件
//   3) probe handler 内不再用 `labels=wayfinder:map`（旧漏检逻辑）
//   4) probe 每轮推进 `lastProbeAtByRepo[rk1]`，changed 时失效内存快照缓存（#696 起是 setCache 按根失效）；
//      入口/build 路径不得初始化这份基线（R2-fix-6：baseline 只由 probe 推进）
//   5) client 侧 `PROBE_MS = 60000`（不再 5min），双源逐字一致
import fs from 'node:fs'
let failed = false
let passed = 0
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (ok) passed++; else failed = true }

console.log('R2: probe since 时间戳探测（#2 MVP · 子票漏检修复）')

const entries = ['host.js', 'package/lib/index.js']
const clientFiles = ['client.js', 'package/lib/client.js']
// 承载实现的模块产物（产物侧；零打包 = src/host/*.js 逐字节复制过来）。
const ISSUE_LIST = 'package/lib/issueList.js'        // 全量索引 URL + --paginate + 手动分页兜底（H2 #446 搬出）
const COMMENT_THREADS = 'package/lib/commentThreads.js' // probe handler：基线推进 + changed 失效缓存（H5 #449 搬出）

// ---- host 侧 · 入口（接线 + 模块级状态；实现侧在下面按承载文件打） ----
for (const f of entries) {
  const src = fs.readFileSync(f, 'utf8')

  // 1) lastProbeAtByRepo 存在 + 按 repoKey 隔离
  check(/let lastProbeAtByRepo\s*=\s*\{\}/.test(src), f + ' 模块级 lastProbeAtByRepo 存在（按 repoKey 隔离）')
  check(!/let lastProbeAt\s*=\s*null/.test(src), f + ' 无裸 lastProbeAt 单例（多仓库并发不互串）')

  // 2) probe handler 存在（双形态：package/lib 用 case 'probe'，host.js 用 harness.handle('wf.probe', ...)）
  const hasProbeCase = /case 'probe'/.test(src)
  const hasProbeHandle = /harness\.handle\('wf\.probe'/.test(src)
  check(hasProbeCase || hasProbeHandle, f + ' 存在 probe handler（case ' + "'probe'" + ' 或 harness.handle wf.probe）')
  check(src.includes('fetchIssueIndex'), f + ' probe 使用全量 issue 索引（覆盖删除事件）')
  check(src.includes('issueIndexChanged'), f + ' probe 比较前后 issue 索引（可发现条目消失）')
  check(src.includes('lastIssueIndexByRepo'), f + ' 删除检测基线按 repoKey 隔离')
  check(src.includes('cacheSnapshotIsCurrent'), f + ' 磁盘快照命中时校验 issue 索引，避免新页面展示已删除条目')

  // 3) 入口的 probe 块内也不再用 labels=wayfinder:map（旧漏检逻辑）
  const probeBlockMatch = src.match(/probe[\s\S]{0,3000}/)
  const probeHandlerSrc = probeBlockMatch ? probeBlockMatch[0].slice(0, 2500) : ''
  check(!probeHandlerSrc.includes('labels=wayfinder:map'), f + ' probe handler 内不再用 labels=wayfinder:map（旧漏检子票逻辑已移除）')

  // 4) buildSnapshot 末尾**不得**初始化 lastProbeAtByRepo[rk0] —— R2-fix-6（#2 MVP E2E 实证 2026-08-18）：
  //    build 完成 ≠ client 已渲染该快照，若 build 发生在某次编辑之后会把基线推到编辑之后 → 编辑被永久吞掉
  //    基线只能由 probe 自己推进（changed 时置为本次探测时刻）
  check(!/lastProbeAtByRepo\[rk0\]\s*=/.test(src), f + ' buildSnapshot 末尾不再初始化 lastProbeAtByRepo（R2-fix-6：避免 build 吞掉同窗口编辑）')
  check(/lastProbeAtByRepo\[rk0\]/.test(src) === false || /lastProbeAtByRepo\[rk0\]\s*=\s*new Date\(\)\.toISOString\(\)/.test(src) === false, f + ' buildSnapshot 内无 lastProbeAtByRepo[rk0] 赋值（基线仅由 probe 推进）')

  // 接线：wf.probe 端点委派给承载模块的动态实例
  check(/harness\.handle\('wf\.probe'/.test(src) && src.includes("await import('./commentThreads.js')") && src.includes('h.handleProbe'),
    f + ' 入口把 wf.probe 委派给承载模块（./commentThreads.js + handleProbe）')
}

// ---- host 侧 · 承载实现的模块产物（实现侧断言打在这里，入口只有接线） ----
//   全量索引 URL / 分页：H2 #446 从 host/index.js 246–455 搬进 issueList.js（账本 §3）。
//   changed 失效缓存：#696 把内存快照缓存从全局变量改成按根隔离的 setCache({...cwd})，
//   旧写法 `if (changed) cache = { ts: 0, snapshot: null` 已不存在；语义同一条，锚点跟现形走。
//   证据：`git log --oneline -- src/host/issueList.js` / `-- src/host/commentThreads.js` → 40ebd3a。
console.log('-- 承载实现的模块产物（零打包自 src/host/*.js，逐字节） --')
const issueListSrc = fs.readFileSync(ISSUE_LIST, 'utf8')
check(issueListSrc.includes('issues?state=all&per_page=100'), ISSUE_LIST + ' 索引 REST URL 覆盖 open + closed issue')
check(issueListSrc.includes("'--paginate'"), ISSUE_LIST + ' 索引 REST 支持分页，避免 >100 issue 漏检')
check(issueListSrc.includes('cacheSnapshotIsCurrent'), ISSUE_LIST + ' 磁盘快照命中时校验 issue 索引，避免新页面展示已删除条目')

const commentSrc = fs.readFileSync(COMMENT_THREADS, 'utf8')
check(commentSrc.includes('fetchIssueIndex'), COMMENT_THREADS + ' probe 使用全量 issue 索引（覆盖删除事件）')
check(commentSrc.includes('issueIndexChanged'), COMMENT_THREADS + ' probe 比较前后 issue 索引（可发现条目消失）')
check(commentSrc.includes('lastIssueIndexByRepo'), COMMENT_THREADS + ' 删除检测基线按 repoKey 隔离')
check(/lastProbeAtByRepo\[rk1\]\s*=\s*new Date\(\)\.toISOString\(\)/.test(commentSrc), COMMENT_THREADS + ' probe 每轮记录 lastProbeAtByRepo 探测时间')
check(/if \(changed\) setCache\(\{ ts: 0, snapshot: null/.test(commentSrc), COMMENT_THREADS + ' 删除/状态变化时失效内存快照缓存（#696 起为 setCache 按根失效）')
// probe 实现块（handleProbe 本体）内不得再用 labels=wayfinder:map；先从函数头切片，空切片也算失败（防止改名后静默放行）
const probeImplMatch = commentSrc.match(/async function handleProbe[\s\S]{0,4000}/)
const probeImplSrc = probeImplMatch ? probeImplMatch[0] : ''
check(probeImplSrc.length > 0 && !probeImplSrc.includes('labels=wayfinder:map'), COMMENT_THREADS + ' probe handler 内不再用 labels=wayfinder:map（旧漏检子票逻辑已移除）')

// ---- client 侧 ----
for (const f of clientFiles) {
  const src = fs.readFileSync(f, 'utf8')

  // 5) PROBE_MS = 60000（不再是 5min）
  check(src.includes('SYNC.FALLBACK_PROBE_MS') && /\|\| 60000\)/.test(src), f + ' PROBE_MS 默认 60s（#232 节拍单源 · FALLBACK_PROBE_MS 兜底 60000）')
  check(!src.includes('PROBE_MS = 300000'), f + ' 无残留 5min 默认值')
}

// ---- 双源等价已移除（T5 #98：一源两物，build 保证同构，不再断言双源逐字一致）----

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过：' + passed + ' 项检查')
