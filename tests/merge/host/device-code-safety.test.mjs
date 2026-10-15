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
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT, check, note, readText, section, summary } from './_check.mjs'

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
check(!/startLoopbackServer|server\.listen\s*\(/.test(src),
  '加载期不再创建端口，消除 import/listen 的悬空异步链')
const registration = sliceFn(src, 'registerResidentEndpoints')
check(registration.includes('throw error') && registration.includes('stop()'),
  'RPC 注册失败清理已注册端点并交给宿主报错，不静默吞掉')

// ===========================================================================
section('三、设备桥的回执诚实性：拒绝也是 200，结论在 body 里（2026-10-14 实测）')
// ===========================================================================
const { bridgeRefusalOf } = await import(pathToFileURL(join(REPO_ROOT, 'plugin.js')).href)
check(bridgeRefusalOf('{"result":"[UNAUTHORIZED]"}') === 'UNAUTHORIZED',
  '真回执样本（本机无凭据调 /app/open 的原文）→ 判成拒绝，不再当成功')
check(bridgeRefusalOf('{"result":"[POLICY_BLOCKED]"}') === 'POLICY_BLOCKED', '策略拦截也算拒绝')
check(bridgeRefusalOf('{"result":"opened in the browser"}') === null, '正常回执不算拒绝')
check(bridgeRefusalOf('') === null && bridgeRefusalOf(null) === null, '空 body / null 不误判成拒绝')
const openUrlSrc = sliceFn(src, 'openUrl')
check(openUrlSrc.length > 200 && openUrlSrc.includes('bridgeRefusalOf('),
  '切片自证且 openUrl 用 bridgeRefusalOf 判「桥到底做没做」（' + openUrlSrc.length + ' 字符）')
check(!/if \(res\.ok\) return \{ via: 'device-bridge'/.test(openUrlSrc),
  '不再只看 res.ok 就宣称 device-bridge（旧的谎报写法已消失）')

// ===========================================================================
section('四、判据自证：同一支判据对「坏样本」报红、对「好样本」报绿')
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

// ===========================================================================
section('五、取码这条路：只读不落地 ＋ 处处有界（票 47 的手机现场）')
// ===========================================================================
/** 切出两个标记之间的片段（标记缺失回空串 —— 由自证判据报红，不静默空转）。 */
function sliceBetween(src, from, to) {
  const a = src.indexOf(from)
  const b = to ? src.indexOf(to, a + 1) : src.length
  return a < 0 || b < 0 || b <= a ? '' : src.slice(a, b)
}
const authTool = sliceBetween(src, "toolName: 'gh_cli_auth_web'", "toolName: 'gh_cli_setup_git'")
check(authTool.length > 500, '切片自证：切到 gh_cli_auth_web 这个工具（' + authTool.length + ' 字符）')
check(/resolveGh\(\{ install: false \}\)/.test(authTool) && !/resolveGh\(\)/.test(authTool),
  '取码工具：resolveGh 只读（install:false）—— 取码不许顺手跑一次下载 ＋ 内存解包')
const routeSeg = sliceFn(src, 'authStart')
check(routeSeg.length > 200 && /ghVersion\(\{ install: false \}\)/.test(routeSeg),
  'RPC authStart：探测只读，服务与RPC共用同一支取码入口')
check(/resolveGh\(\{ install: false \}\)/.test(flow), 'startDeviceFlowPty 里的 resolveGh 也只读')
check(/timeout: 5000/.test(sliceFn(src, 'openUrl')), 'openUrl 的 xdg-open 有上界（5s）—— 它一挂，请求就永不返回')
const clientSrc = readText('client.js')
// 票 51 第 2 步：面板改走宿主 RPC 后，「上界」这件事从 fetch 的 AbortSignal 换成了宿主侧的有界（见本文件第五节）——
// 判据**等价换、不静默删**：断言取码走唯一出口 call('ghr.authStart')，且面板里再没有裸 fetch 打插件接口。
check(/call\('ghr\.authStart'/.test(clientSrc), "取码走宿主 RPC 的唯一出口 call('ghr.authStart')")
check(/rpc\.call/.test(clientSrc) && /45000/.test(clientSrc) && !/\bfetch\s*\(/.test(clientSrc), 'RPC 调用有45s上界，且不回落端口')
check(/flow && flow\.error \?/.test(clientSrc), '失败原因会渲染出来（原先 flow.error 没人用）')


summary()
