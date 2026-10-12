#!/usr/bin/env node
/**
 * verify-setup-matt-pocock-skills.mjs —— /setup-matt-pocock-skills 初始化产物的一键核验（只读，不改任何文件）。
 *
 * 为什么要有它：这次初始化落了四份东西（docs/agents/ 三份 + AGENTS.md 的 ## Agent skills 块），
 *   它们平时没有门禁盯着。以后谁改了 issue-tracker.md 的首行标题、或把 domain.md 里那句布局结论改了，
 *   肉眼看不出来，但技能会按新内容走。所以把「初始化该有的形状」固化成一条可复跑的判据。
 *
 * 判据（与插件自身口径同源，不另起第二套）：
 *   1) 后端主锚：docs/agents/issue-tracker.md 经插件自己的解析器 parseIssueTracker 解析出 github、且置信为 high
 *      —— 同一份判据插件面板的「工作区已初始化」检查（tracker:initialized = 该文件存在）也在用。
 *   2) 三份文档齐 + 各自首行标题对；domain.md 写明 single-context；AGENTS.md 的 ## Agent skills 块三个子块齐。
 *   3) 标签齐：triage 五角色 + wayfinder 五枚（走后端真源 gh label list；没有 gh 或没登录时标 WARN，不当失败）。
 *
 * 用法：node tools/verify-setup-matt-pocock-skills.mjs
 * 退出码：0 全过（WARN 不算失败）；1 有 FAIL。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const root = resolve(HERE, '..')

const results = []
const ok = (name, detail) => results.push({ st: 'OK', name, detail: detail || '' })
const fail = (name, detail) => results.push({ st: 'FAIL', name, detail: detail || '' })
const warn = (name, detail) => results.push({ st: 'WARN', name, detail: detail || '' })

const readRel = (rel) => {
  const p = resolve(root, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

// ---- 1) 后端主锚：用插件自己的解析器 ----
const trackerText = readRel('docs/agents/issue-tracker.md')
if (trackerText == null) {
  fail('主锚存在', 'docs/agents/issue-tracker.md 不存在 —— 插件面板的「工作区已初始化」检查（tracker:initialized）会一直红')
} else {
  ok('主锚存在', 'docs/agents/issue-tracker.md')
  const parserPath = 'file://' + resolve(root, 'deck/src/host/tracker/detection/parseIssueTracker.js')
  try {
    const mod = await import(parserPath)
    const parseIssueTracker = mod.parseIssueTracker || mod.default
    const r = parseIssueTracker(trackerText)
    if (r.explicitBackendId === 'github' && r.confidence === 'high') {
      ok('主锚解析', 'backend=' + r.explicitBackendId + ' confidence=' + r.confidence + ' reason=' + r.reason)
    } else {
      fail('主锚解析', 'backend=' + r.explicitBackendId + ' confidence=' + r.confidence + ' reason=' + r.reason + ' —— 首行标题须逐字是「# Issue tracker: GitHub」')
    }
  } catch (e) {
    warn('主锚解析', '插件解析器导入失败，退化为标题正则：' + String(e.message).slice(0, 80))
    if (/^#\s*issue\s*tracker\s*:\s*github/im.test(trackerText)) ok('主锚解析（正则兜底）', 'first line matches')
    else fail('主锚解析（正则兜底）', 'first line is not "# Issue tracker: GitHub"')
  }
}

// ---- 2) 三份文档 + AGENTS.md ----
const docs = [
  ['docs/agents/triage-labels.md', /^#\s*Triage Labels\s*$/im, '标签映射'],
  ['docs/agents/domain.md', /^#\s*Domain Docs\s*$/im, '域文档消费规则'],
]
const domainText = readRel('docs/agents/domain.md')
if (domainText == null) fail('域文档存在', 'docs/agents/domain.md 不存在')
else if (!/single-context/i.test(domainText)) fail('域文档布局结论', 'domain.md 里找不到 single-context')
else ok('域文档布局结论', 'domain.md 写明 single-context')

for (const [rel, re, label] of docs) {
  const t = readRel(rel)
  if (t == null) fail(label + '：文件存在', rel + ' 不存在')
  else if (re.test(t)) ok(label + '：首行标题', rel)
  else fail(label + '：首行标题', rel + ' 的首行标题不符')
}

const agentsText = readRel('AGENTS.md')
if (agentsText == null) fail('AGENTS.md 存在', 'AGENTS.md 不存在')
else {
  const misses = []
  if (!/^##\s+Agent skills\s*$/m.test(agentsText)) misses.push('## Agent skills')
  if (!/^###\s+Issue tracker\s*$/m.test(agentsText)) misses.push('### Issue tracker')
  if (!/^###\s+Triage labels\s*$/m.test(agentsText)) misses.push('### Triage labels')
  if (!/^###\s+Domain docs\s*$/m.test(agentsText)) misses.push('### Domain docs')
  if (!/docs\/agents\/domain\.md/.test(agentsText)) misses.push('Domain docs 行里的 docs/agents/domain.md')
  if (!/single-context/i.test(agentsText)) misses.push('Domain docs 行里的 single-context')
  if (misses.length) fail('AGENTS.md 结构', '缺：' + misses.join('、'))
  else ok('AGENTS.md 结构', '## Agent skills 三子块齐 + Domain docs 行含 single-context')
}

// ---- 3) 标签齐（真源 = 后端）----
const wanted = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix', 'wayfinder:map', 'wayfinder:research', 'wayfinder:prototype', 'wayfinder:grilling', 'wayfinder:task']
let live = null
try {
  const out = execFileSync('gh', ['label', 'list', '--limit', '200', '--json', 'name', '--jq', '.[].name'], { encoding: 'utf8' })
  live = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
} catch (e) {
  warn('标签齐（未核）', 'gh 不可用或未登录，跳过：' + String(e.message).slice(0, 80))
}
if (live) {
  const missing = wanted.filter((l) => live.indexOf(l) < 0)
  if (missing.length) fail('标签齐', '缺：' + missing.join('、'))
  else ok('标签齐', wanted.length + ' 枚全在（triage 五角色 + wayfinder 五枚）')
}

// ---- 汇总 ----
const width = results.reduce((m, r) => Math.max(m, r.name.length), 0)
for (const r of results) console.log(r.st.padEnd(5) + r.name.padEnd(width + 2) + r.detail)
const bad = results.filter((r) => r.st === 'FAIL').length
console.log('—'.repeat(40))
console.log('结论：' + (bad ? bad + ' 项 FAIL' : '全过') + '（WARN ' + results.filter((r) => r.st === 'WARN').length + ' 项）')
console.log('注：插件面板那两行的最终颜色由面板自己重算；本脚本核的是同一批文件与同一份后端真源。')
process.exit(bad ? 1 : 0)
