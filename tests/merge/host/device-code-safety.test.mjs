/**
 * tests/merge/host/device-code-safety.test.mjs —— 设备码那条路（`gh_cli_auth_web` / `POST /auth/start`）
 * 与加载期「起服务」那一处，**不许出现未处理的 promise 拒绝**。
 *
 * 为什么这条要单独钉（票 47 的 H2，2026-10-14 真机复盘）：插件与宿主**同一个 node 进程** ——
 * 一个 `unhandledRejection` 就是**宿主进程结束**（面板随即白屏，见票 47 的取证）。而
 * `startDeviceFlowPty` 里那句 `resolveGh().then(...)` 原本**没有 catch**：`resolveGh` 会一路走到
 * `ensureGhOnce` 末尾的 `if (probe.ok) { await fs.mkdir(...); await fs.writeFile(...) }`
 * —— 那两处**不在 try/catch 里**，一抛就是进程级事故；而它本来只该让「这一次拿码」失败。
 *
 * 为什么是**源码形状**判据、不是行为判据（如实写明，别假装）：能离线造出「`ensureGh` 抛」的夹具**不存在** ——
 * 那两处 `fs` 只在**安装成功之后**才走到（`if (probe.ok)`，且安装要真网络：`releaseMeta` 走 fetch，夹具拦不住）。
 * 所以这里钉形状；行为那一半交给真机复现（票 47 的现场捕捉器 `/root/.dsh/forensics/watch.sh`）。
 * 切片判据自带「切片非空 + 看得到目标标识」的自证，免得源码一改、判据对着空切片空转。
 *
 * 用法：node tests/merge/host/device-code-safety.test.mjs
 */
import { check, note, readText, section, summary } from './_check.mjs'

/** 按花括号配平切出一个具名函数体；切不到回空串（由「切片自证」那条判据报红）。 */
function sliceFn(src, name) {
  const head = src.indexOf('function ' + name + '(')
  if (head < 0) return ''
  const open = src.indexOf('{', head)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    const c = src[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return src.slice(head, i + 1)
    }
  }
  return ''
}

const src = readText('plugin.js')

// ===========================================================================
section('一、设备码路径：resolveGh 的失败必须被结算成回执，不许冒到进程级')
// ===========================================================================
const flow = sliceFn(src, 'startDeviceFlowPty')
check(flow.length > 300 && flow.includes('resolveGh') && flow.includes('.then('),
  '切片自证：切到 startDeviceFlowPty 的函数体（' + flow.length + ' 字符），且里面看得到 resolveGh 与 .then(')
check(/\.catch\(/.test(flow),
  '这条链带拒绝处理（.catch）：resolveGh 抛出时结算成「这一次拿码失败」，而不是 unhandledRejection 杀宿主')
check((flow.match(/\.then\(/g) || []).length <= (flow.match(/\.catch\(/g) || []).length,
  '链上 .then( 个数 ≤ .catch( 个数（' + (flow.match(/\.then\(/g) || []).length + ' / ' + (flow.match(/\.catch\(/g) || []).length + '）')

// ===========================================================================
section('二、加载期「起服务」那一处：同样不许悬空')
// ===========================================================================
const at = src.indexOf('startLoopbackServer(API_PORT).then(')
const seg = at < 0 ? '' : src.slice(at, at + 700)
check(seg.length > 100 && seg.includes('startLoopbackServer(API_PORT)'),
  '切片自证：切到加载期起服务那一段（' + seg.length + ' 字符）')
check(seg.includes('.catch(') || /\(\s*err\s*\)\s*=>/.test(seg),
  '起服务那条链带拒绝去处（.catch 或双参 then）：import / 监听之前抛出的异常不该升级成宿主结束')

// ===========================================================================
section('三、判据自证：同一支判据对「坏样本」报红、对「好样本」报绿')
// ===========================================================================
const BAD = 'function startDeviceFlowPty(){ return new Promise((r)=>{ resolveGh().then((g)=>{ r(g) }) }) }'
const GOOD = 'function startDeviceFlowPty(){ return new Promise((r)=>{ resolveGh().then((g)=>{ r(g) }).catch((e)=>{ r(e) }) }) }'
const badSlice = sliceFn(BAD, 'startDeviceFlowPty')
const goodSlice = sliceFn(GOOD, 'startDeviceFlowPty')
check(badSlice.includes('resolveGh') && !/\.catch\(/.test(badSlice),
  '坏样本（赤裸 .then 链）：判据抓得到 —— 会红')
check(/\.catch\(/.test(goodSlice),
  '好样本（带 .catch 的链）：判据会绿')

note('行为那一半（真机上「安装分支抛 → 宿主是否活下来」）由票 47 的现场捕捉器覆盖：'
  + '/root/.dsh/forensics/watch.sh 每秒记宿主 pid / RSS / 内存 / 插件 API 可达性，换代时把上一份宿主日志尾巴存成 death-*.log')

summary()
