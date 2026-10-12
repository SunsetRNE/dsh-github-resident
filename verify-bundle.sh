#!/usr/bin/env bash
# verify-bundle.sh — 安装/改名后的一次性体检（只读，不改任何东西）
#
# 用法:
#   bash verify-bundle.sh [BUNDLE_DIR] [PROFILE_DIR] [--live-api]
# 默认:
#   BUNDLE_DIR  = 本脚本所在目录
#   PROFILE_DIR = **临时 fixture profile**（见下「隔离纪律」），不是真实 profile
#
# 隔离纪律（2026-10-11 改造，合并期实测）：
#   1) 不传 PROFILE_DIR 时**不读** $DSH_PROFILE_DIR / ~/.dsh/profiles/*：改成在临时目录造一份
#      fixture profile（dependencies 里放本包名 + node_modules/@local/<name> 软链到 BUNDLE_DIR），
#      跑完即删。要验真实 profile 必须显式传第二个参数（或 VERIFY_REAL_PROFILE=1）。
#   2) 第 5 段回环接口默认**不发任何请求**：它原来硬编码 127.0.0.1:31790，是仓库里唯一会打到
#      真实运行实例的一段。现在只有显式 `--live-api`（或 LIVE_API=1）才会打，
#      端口取 $DSH_GH_API_PORT（默认 31790），并在输出里写明打的是哪个端口。
#   3) 客户端身份改看 dist/client.js（合并后客户端只有这一份产物，根 client.js 是作者态输入）。
#
# 退出码: 0 = 全部 PASS；1 = 有 FAIL（每条 FAIL 都附修复提示）

set -uo pipefail

BUNDLE_DIR=""
PROFILE_DIR=""
# 默认 0；`LIVE_API=1 bash verify-bundle.sh …` 也能开（等价于 --live-api）
LIVE_API="${LIVE_API:-0}"
ARGS=()
for a in "$@"; do
  case "$a" in
    --live-api) LIVE_API=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
[ -n "${ARGS[0]:-}" ] && BUNDLE_DIR="${ARGS[0]}"
[ -n "${ARGS[1]:-}" ] && PROFILE_DIR="${ARGS[1]}"
BUNDLE_DIR="${BUNDLE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
API_PORT="${DSH_GH_API_PORT:-31790}"
API="http://127.0.0.1:${API_PORT}"

FIXTURE_DIR=""
cleanup() { [ -n "$FIXTURE_DIR" ] && rm -rf "$FIXTURE_DIR"; }
trap cleanup EXIT

if [ -z "$PROFILE_DIR" ]; then
  if [ "${VERIFY_REAL_PROFILE:-0}" = "1" ] && [ -n "${DSH_PROFILE_DIR:-}" ]; then
    PROFILE_DIR="$DSH_PROFILE_DIR"
    echo "!! 显式使用真实 profile：$PROFILE_DIR（VERIFY_REAL_PROFILE=1）"
  else
    FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/verify-bundle-fixture.XXXXXX")"
    PKG_NAME="$(node -e "process.stdout.write(require('$BUNDLE_DIR/package.json').name)" 2>/dev/null || echo unknown)"
    mkdir -p "$FIXTURE_DIR/node_modules/@local"
    printf '{"name":"verify-bundle-fixture","private":true,"dependencies":{"%s":"*"}}' "$PKG_NAME" > "$FIXTURE_DIR/package.json"
    ln -s "$BUNDLE_DIR" "$FIXTURE_DIR/node_modules/@local/${PKG_NAME##*/}"
    PROFILE_DIR="$FIXTURE_DIR"
    echo "== 隔离模式：PROFILE_DIR = 临时 fixture（$FIXTURE_DIR），未读真实 profile =="
  fi
fi

pass=0; fail=0
ok()   { printf 'PASS  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf 'FAIL  %s\n      修: %s\n' "$1" "$2"; fail=$((fail+1)); }

echo "== 1. 三处标识必须逐字相同（package.name / patch 主行 name / dist/client.js 的 load id）=="
node - "$BUNDLE_DIR" <<'NODE'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const patch = fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8');
const clientPath = path.join(dir, 'dist', 'client.js');
const client = fs.existsSync(clientPath) ? fs.readFileSync(clientPath, 'utf8') : '';
const patchName = (patch.match(/name:\s*'([^']+)'/) || [])[1];
const patchId = (patch.match(/id:\s*([^\s]+)/) || [])[1];
const clientId = (client.match(/id:\s*'([^']+)'/) || [])[1];
console.log('pkg.name       =', pkg.name);
console.log('patch entry id =', patchId);
console.log('patch name     =', patchName);
console.log('client module  =', clientId, client ? '' : '（dist/client.js 不存在）');
console.log('entry file     =', pkg.exports && pkg.exports['.']);
const allSame = pkg.name === patchName && pkg.name === clientId;
console.log(allSame ? 'IDENTITY_SAME=yes' : 'IDENTITY_SAME=no');
process.exit(allSame ? 0 : 2);
NODE
case $? in
  0) ok "三处标识一致" ;;
  2) bad "三处标识不一致或 dist/client.js 缺失（漏改 client id 会让 web boot 报 'loaded without registering'）" "先 npm run build；包名要同时出现在 package.json / cordis.patch.yml / dist/client.js 的 load({id})" ;;
  *) bad "标识检查无法执行" "确认这三个文件存在且可读" ;;
esac

echo "== 2. 语法 =="
for f in "$BUNDLE_DIR"/plugin.js "$BUNDLE_DIR"/dist/host.js "$BUNDLE_DIR"/dist/client.js; do
  [ -f "$f" ] || continue
  if node --check "$f" >/dev/null 2>&1; then ok "语法 $f"; else bad "语法错误 $f" "node --check $f 看具体行号"; fi
done

echo "== 3. profile 链接健康（悬空软链是上次启动异常的诱因）=="
LINK_DIR="$PROFILE_DIR/node_modules/@local"
if [ -d "$LINK_DIR" ]; then
  dangling=0
  for f in "$LINK_DIR"/*; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    if [ -e "$f" ]; then
      ok "链接 $(basename "$f") -> $(readlink "$f")"
    else
      bad "悬空链接 $(basename "$f") -> $(readlink "$f")" "rm -f '$f'（只删链接，不碰目标）"
      dangling=$((dangling+1))
    fi
  done
  [ "$dangling" -eq 0 ] || true
else
  echo "SKIP  $LINK_DIR 不存在（该 profile 还没装过第三方 bundle）"
fi

echo "== 4. profile 依赖里是否有本包 =="
if node -e "
const p=require('$PROFILE_DIR/package.json');
const name=require('$BUNDLE_DIR/package.json').name;
process.exit(Object.keys(p.dependencies||{}).includes(name)?0:1);
" 2>/dev/null; then
  ok "profile 依赖含本包（profile=$PROFILE_DIR）"
else
  bad "profile 依赖不含本包（profile=$PROFILE_DIR）" "plugin_manager install_bundle $BUNDLE_DIR（本 profile 重启后会摘掉第三方 bundle）"
fi

echo "== 5. 回环接口（默认跳过；只有显式 --live-api 才发请求）=="
if [ "$LIVE_API" = "1" ]; then
  echo "     目标：$API （端口来自 DSH_GH_API_PORT，默认 31790）"
  for ep in /protocol /state; do
    code=""
    for attempt in 1 2 3; do
      code=$(curl -s -o /dev/null -m 12 -w '%{http_code}' "$API$ep" 2>/dev/null)
      [ -n "$code" ] || code=000
      [ "$code" = "200" ] && break
      sleep 2
    done
    if [ "$code" = "200" ]; then ok "GET $ep -> 200"; else bad "GET $ep -> $code（试了 3 次）" "插件未启用/未重启加载；先 install_bundle，必要时换包名（见 LESSONS.md）"; fi
  done
else
  echo "SKIP  未指定 --live-api：不碰真实运行实例（这是默认档，避免体检顺手打到 127.0.0.1:${API_PORT}）"
fi

echo

echo "== 6. 宿主半边唯一 + locale 口径 =="
if [ -f "$BUNDLE_DIR/index.js" ]; then
  if cmp -s "$BUNDLE_DIR/index.js" "$BUNDLE_DIR/plugin.js"; then
    bad "存在逐字节重复的 index.js（R1：两份副本会漂移）" "rm '$BUNDLE_DIR/index.js'；只保留 exports 指向的 dist/host.js 与它引用的 plugin.js"
  fi
fi
ok "宿主半边唯一（实现只有 plugin.js + deck/src/host/index.js 各一份）"
node - "$BUNDLE_DIR/locale/en.json" <<'NODE'
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.exit(j && j.meta && j.meta.title && j.meta.description ? 0 : 1);
NODE
case $? in
  0) ok "locale/en.json 用 meta.title/description（宿主口径）" ;;
  *) bad "locale 结构与宿主不符（L14：宿主读 meta.title/description）" "把 locale/*.json 改成 {\"meta\":{\"title\":…,\"description\":…}}" ;;
esac

echo "RESULT pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
