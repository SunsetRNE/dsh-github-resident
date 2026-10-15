#!/usr/bin/env bash
# account-ui-check.sh — 只读诊断宿主、Resident RPC、账号缓存态与 GUI 会话元数据。
# 用法: DSH_GUI_HEADERS_FILE=/path/to/headers bash tools/account-ui-check.sh
# DSH_GUI 默认 http://127.0.0.1:3080；header 文件每行 Header: value。
# 不从日志或 identity 文件提取凭据，不把凭据放 URL/argv，也不刷新/写入真实身份。
# READY 只表示 protocol/state 的 RPC 回执通过校验；无凭据/端点失败如实报未就绪并退出 1。
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
RPC_HELPER="$SCRIPT_DIR/resident-rpc.mjs"
LOG="${DSH_WEB_LOG:-/root/dsh-web.log}"
PIDFILE="${DSH_WEB_PIDFILE:-/root/.dsha-web.pid}"
IDENTITY="${DSH_WEB_IDENTITY:-/root/.dsha-web.identity}"
ACTIVITY="${DSH_WEB_ACTIVITY:-/root/.dsha-web-activity.json}"

printf '%s\n' '── 1. 宿主进程 ──'
pid=""
if [ -r "$PIDFILE" ]; then IFS= read -r pid < "$PIDFILE" || true; fi
if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null; then
  echo "dsh web 存活   : pid $pid，起于 $(ps -o lstart= -p "$pid" | sed 's/^ *//')"
else
  echo "dsh web        : PID 文件未确认存活进程；以宿主 RPC 的实际回执为准"
fi

rpc_status=0
receipt="$(node "$RPC_HELPER" --live)" || rpc_status=$?
node -e '
let raw = "";
process.stdin.on("data", (part) => raw += part).on("end", () => {
  let result;
  try { result = JSON.parse(raw); } catch { result = { ok: false, message: "诊断 helper 未返回有效 JSON。" }; }
  console.log("── 2. 插件半边（现有宿主同源 /api/dsws）──");
  if (result.ok === true) {
    console.log("宿主来源       :", result.origin);
    console.log("协议           :", result.protocol.version, "版，工具", result.protocol.tools.length, "个");
    console.log("registry 端点  :", result.protocol.http.endpoints.filter((e) => e.path.startsWith("ghr.registry")).map((e) => e.method + " " + e.path).join("  "));
    console.log("插件半边       : READY（protocol/state RPC 已校验）");
  } else {
    console.log("插件半边       : NOT_READY —", result.message || "诊断失败");
    console.log("工具诊断路径   : gh_protocol / gh_cli_status");
    console.log("在线凭据入口   : DSH_GUI_HEADERS_FILE，显式 header 文件；不读日志或 identity 内容");
  }
  console.log("── 3. 账号登录态（缓存视图，不请求强制刷新/写入）──");
  if (result.ok === true) {
    const s = result.state;
    console.log("已登录         :", s.authenticated === null ? "未知（尚无快照）" : s.authenticated);
    console.log("账号           :", s.account === null ? "未知" : JSON.stringify(s.account));
    console.log("gh 层 / 助手   :", s.gh.layer, "/", s.credHelper ? "已配置（内容不回显）" : "未配置或尚无快照");
    console.log("快照时间       :", s.snapshotAt || s.probe.snapshotAt || "无");
    console.log("快照检查阶段   :", s.probe.state, "，cached=", s.cached);
  } else {
    console.log("状态           : 未取得有效 RPC 快照，不能据此判断是否登录");
    process.exitCode = 1;
  }
});
' <<< "$receipt" || rpc_status=1

printf '%s\n' '── 4. GUI 会话凭据元数据 ──'
node - "$IDENTITY" "$ACTIVITY" "$LOG" <<'NODE'
const fs = require('fs');
const [identity, activity, log] = process.argv.slice(2);
try {
  const st = fs.statSync(identity);
  console.log('identity 文件  :', st.size, '字节，mtime', st.mtime.toISOString(), '（不读内容）');
} catch { console.log('identity 文件  : 不存在或不可读'); }
try {
  const act = JSON.parse(fs.readFileSync(activity, 'utf8'));
  console.log('页面心跳       : generation=' + JSON.stringify(act.generation) + ' idle=' + JSON.stringify(act.idle) + ' plugins=' + JSON.stringify(act.plugins));
} catch { console.log('页面心跳       : 无或不可读（不能确认当前页面连接）'); }
try {
  // 仅提取基址，不捕获 token；日志绝不用作 RPC 的认证来源。
  const text = fs.readFileSync(log, 'utf8');
  const bases = [...text.matchAll(/http:\/\/127\.0\.0\.1:[0-9]+\/(?=\?token=)/g)];
  console.log('日志入口基址   :', bases.length ? bases.at(-1)[0] : '未找到 GUI 入口记录');
  console.log('日志凭据       : 不读取或复用；请使用显式 header 文件');
} catch { console.log('日志入口基址   : 日志不存在或不可读'); }
NODE

# 保留匿名 HTTP 状态诊断：先校验 URL，再只读现有 GUI；不跟随跳转、不发送认证头。
node --input-type=module - "$RPC_HELPER" <<'NODE'
import { pathToFileURL } from 'node:url';
const { guiOrigin } = await import(pathToFileURL(process.argv[2]));
try {
  const response = await fetch(guiOrigin() + '/', { redirect: 'manual', signal: AbortSignal.timeout(8000) });
  console.log('未带凭据访问   : HTTP', response.status, '（401 = 凭据必需，正常）');
  await response.body?.cancel();
} catch { console.log('未带凭据访问   : 未完成（GUI 地址无效、不可达或超时）'); }
NODE

printf '\n%s\n' '结论口径：RPC READY 证明插件能够响应；已登录 true 只描述缓存快照。'
printf '%s\n' '页面心跳和 identity 元数据不能独自证明当前浏览器会话有效；页面异常时再核对 App 的 GUI 入口。'
exit "$rpc_status"
