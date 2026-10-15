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
#   2) 第 5 段默认在假 HOME 中真 apply，再经 githubResident 服务验证 protocol/state，不联网。
#      显式 --live-api（或 LIVE_API=1）才走现有宿主同源 /api/dsws；DSH_GUI 指定 GUI 来源，
#      DSH_GUI_HEADERS_FILE 显式指定认证 header 文件（每行 Header: value，凭据不放 URL/argv）。
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
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

# 重活租约（票 61「重活租约扩到半重那一族」）：本脚本是 bash，引不了 JS 模块 —— 未持有记号时
# re-exec 到同一把锁的命令壳（tests/merge/_load-lease.mjs 那支）。壳取锁 → 带
# DSH_GH_LOAD_LEASE_HELD 跑本脚本（本脚本与它的孙进程见到记号就不再取）→ 退出时放锁、
# 透传退出码。拿不到锁就 exit 2 + BLOCKED-LOAD-LEASE，一条体检都不跑；**没有第二把锁**。
if [ -z "${DSH_GH_LOAD_LEASE_HELD:-}" ]; then
  exec node "$SCRIPT_DIR/tests/merge/_load-lease-cli.mjs" -- bash "$SCRIPT_DIR/verify-bundle.sh" "$@"
fi

BUNDLE_DIR="$(cd -- "${BUNDLE_DIR:-$SCRIPT_DIR}" && pwd -P)" || exit 1
RPC_HELPER="$SCRIPT_DIR/tools/resident-rpc.mjs"

FIXTURE_DIR=""
FIXTURE_ROOT="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)" || exit 1
cleanup() {
  [ -n "$FIXTURE_DIR" ] || return 0
  case "$FIXTURE_DIR" in
    "$FIXTURE_ROOT"/verify-bundle-fixture.*)
      [ "$(dirname -- "$FIXTURE_DIR")" = "$FIXTURE_ROOT" ] &&
        [ "$(realpath -- "$FIXTURE_DIR")" = "$FIXTURE_DIR" ] && rm -rf -- "${FIXTURE_DIR:?}"
      ;;
  esac
}
trap cleanup EXIT

if [ -z "$PROFILE_DIR" ]; then
  if [ "${VERIFY_REAL_PROFILE:-0}" = "1" ] && [ -n "${DSH_PROFILE_DIR:-}" ]; then
    PROFILE_DIR="$DSH_PROFILE_DIR"
    echo "!! 显式使用真实 profile：$PROFILE_DIR（VERIFY_REAL_PROFILE=1）"
  else
    FIXTURE_DIR="$(mktemp -d "$FIXTURE_ROOT/verify-bundle-fixture.XXXXXX")" || exit 1
    PKG_NAME="$(node -e 'process.stdout.write(require(process.argv[1]).name)' "$BUNDLE_DIR/package.json")" || exit 1
    mkdir -p "$FIXTURE_DIR/node_modules/@local"
    node -e 'process.stdout.write(JSON.stringify({ name: "verify-bundle-fixture", private: true, dependencies: { [process.argv[1]]: "*" } }))' "$PKG_NAME" > "$FIXTURE_DIR/package.json"
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
if node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const name = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).name;
process.exit(Object.keys(p.dependencies || {}).includes(name) ? 0 : 1);
' "$PROFILE_DIR/package.json" "$BUNDLE_DIR/package.json" 2>/dev/null; then
  ok "profile 依赖含本包（profile=$PROFILE_DIR）"
else
  bad "profile 依赖不含本包（profile=$PROFILE_DIR）" "plugin_manager install_bundle $BUNDLE_DIR（本 profile 重启后会摘掉第三方 bundle）"
fi

echo "== 5. protocol/state（默认假 HOME 服务位；--live-api 走现有宿主同源 RPC）=="
if [ "$LIVE_API" = "1" ]; then
  RPC_ARGS=(--live)
  CHECK_LABEL="宿主 /api/dsws"
else
  RPC_ARGS=(--offline --bundle-dir "$BUNDLE_DIR")
  CHECK_LABEL="假 HOME 真 apply 的 githubResident 服务（无网络）"
fi
if receipt="$(node "$RPC_HELPER" "${RPC_ARGS[@]}")"; then
  ok "$CHECK_LABEL：protocol /8 与 14 个 POST ghr.* 端点有效"
  ok "$CHECK_LABEL：state 缓存快照结构有效"
else
  printf '%s\n' "$receipt"
  bad "$CHECK_LABEL：protocol/state 未就绪" "检查上述诊断；在线可调用 gh_protocol / gh_cli_status，或显式设置 DSH_GUI_HEADERS_FILE 后重试 --live-api"
fi

echo

echo "== 6. 宿主半边唯一 + locale 口径 =="
# 判据要真的能失败：原来 ok 打在 if **外面**，根目录没有 index.js 时也照样打印「唯一」——
# 这一条从未失败过。现在两条路径各有各的真判据。
if [ -f "$BUNDLE_DIR/index.js" ]; then
  if cmp -s "$BUNDLE_DIR/index.js" "$BUNDLE_DIR/plugin.js"; then
    bad "存在逐字节重复的 index.js（R1：两份副本会漂移）" "rm '$BUNDLE_DIR/index.js'；只保留 exports 指向的 dist/host.js 与它引用的 plugin.js"
  else
    ok "宿主半边唯一（index.js 在，但与 plugin.js 不同字节）"
  fi
else
  ok "宿主半边唯一（没有重复的 index.js 副本；实现只有 plugin.js + deck/src/host/index.js）"
fi
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
