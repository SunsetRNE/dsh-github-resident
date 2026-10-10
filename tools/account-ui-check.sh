#!/usr/bin/env bash
# account-ui-check.sh — 「GitHub 账号登录页 / 仓库登记库页还在不在」的机器判据。
#
# 一条命令把三件互相独立的事分开报：插件半边、账号登录态、GUI 会话凭据那一代。
# 这样「登录 UI 没了」到底卡在哪一层，不用猜。
#
# 判读（实测口径）：
#   插件半边 READY + 账号 已登录 + GUI 会话为当前代  → 页面问题在浏览器侧（旧页面/旧 URL/缓存）
#   插件半边 DOWN                                    → 宿主没起或插件没加载（看 /root/dsh-web.log）
#   账号 未登录                                      → 走 gh_cli_auth_web / 设置页里的「生成一次性码」
#   GUI 会话「非当前代」                              → 宿主重启过，token 已轮换：旧页面失效，
#                                                      入口 URL 只在宿主日志里且 **token 被掩码成 *** ，
#                                                      容器内没有任何文件能还原它 —— 要从 App 的重开入口拿。
#
# 用法: bash tools/account-ui-check.sh
set -uo pipefail

API="${DSH_GH_API:-http://127.0.0.1:31790}"
GUI="${DSH_GUI:-http://127.0.0.1:3080}"
LOG="${DSH_WEB_LOG:-/root/dsh-web.log}"
PIDFILE="${DSH_WEB_PIDFILE:-/root/.dsha-web.pid}"
IDENTITY="${DSH_WEB_IDENTITY:-/root/.dsha-web.identity}"
ACTIVITY="${DSH_WEB_ACTIVITY:-/root/.dsha-web-activity.json}"

jq_get() { # jq_get <json> <点路径>，不依赖 jq
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const p=process.argv[1].split(".");let v=j;for(const k of p)v=v?.[k];console.log(typeof v==="object"?JSON.stringify(v):String(v));}catch{console.log("(解析失败)")}})' "$2" <<<"$1" 2>/dev/null
}

echo "── 1. 宿主进程 ──"
pid="$(cat "$PIDFILE" 2>/dev/null || echo '')"
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  echo "dsh web 存活   : pid $pid，起于 $(ps -o lstart= -p "$pid" | sed 's/^ *//')"
else
  echo "dsh web        : 不在（pid 文件 ${pid:-空}）—— 宿主没起时任何页面都是死的"
fi

echo "── 2. 插件半边（回环口 $API）──"
proto="$(curl -s -m 8 "$API/protocol" 2>/dev/null || echo '')"
if [ -n "$proto" ]; then
  echo "协议           : $(jq_get "$proto" version) 版，工具 $(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).tools.length)}catch{console.log("?")}})' <<<"$proto") 个"
  echo "registry 路由  : $(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((j.http?.endpoints||[]).filter(e=>String(e.path).startsWith("/registry")).map(e=>e.method+" "+e.path).join("  "))}catch{console.log("?")}})' <<<"$proto")"
  echo "插件半边       : READY"
else
  echo "插件半边       : DOWN（回环口不可达：插件没加载或宿主没起）"
fi

echo "── 3. 账号登录态（这就是那一页要显示的东西）──"
state="$(curl -s -m 12 "$API/state" 2>/dev/null || echo '')"
if [ -n "$state" ]; then
  echo "已登录         : $(jq_get "$state" authenticated)"
  echo "账号           : $(jq_get "$state" account)"
  echo "gh 层 / 助手   : $(jq_get "$state" gh.layer) / $(jq_get "$state" credHelper)"
  echo "快照时间       : $(jq_get "$state" snapshotAt)"
else
  echo "状态           : 取不到（插件半边 DOWN）"
fi

echo "── 4. GUI 会话凭据那一代 ──"
echo "identity 文件  : $(wc -c < "$IDENTITY" 2>/dev/null || echo 0) 字节，mtime $(date -r "$IDENTITY" '+%F %T' 2>/dev/null || echo '—')"
if [ -f "$ACTIVITY" ]; then
  act="$(cat "$ACTIVITY")"
  echo "页面心跳       : generation=$(jq_get "$act" generation) idle=$(jq_get "$act" idle) plugins=$(jq_get "$act" plugins)"
else
  echo "页面心跳       : 无（还没有页面连过这个宿主实例）"
fi
last="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/\?token=[^[:space:]"]*' "$LOG" 2>/dev/null | tail -1)"
if [ -n "$last" ]; then
  echo "日志入口基址   : ${last%%\?*}"
  case "$last" in *'token=***') echo "日志里的 token : 掩码（***）—— 容器内无法还原；重开 GUI 要从 App 的入口拿 URL" ;; esac
else
  echo "日志入口基址   : $LOG 里没有 'dsh web: http://…' 这一行"
fi
echo "未带凭据访问   : HTTP $(curl -s -o /dev/null -m 8 -w '%{http_code}' "$GUI/" 2>/dev/null)（401 = 凭据必需，正常）"

echo
echo "结论口径：宿主 ✅ + 插件半边 READY + 已登录 true + 心跳存在 → 页面本身是活的；"
echo "          此时若设置里看不到 GitHub 页，问题在浏览器那一侧的旧页面/旧 URL/缓存，重开 App 的 GUI 入口即可。"
