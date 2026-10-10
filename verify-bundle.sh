#!/usr/bin/env bash
# verify-bundle.sh — 安装/改名后的一次性体检（只读，不改任何东西）
#
# 用法:
#   bash verify-bundle.sh [BUNDLE_DIR] [PROFILE_DIR]
# 默认:
#   BUNDLE_DIR  = 本脚本所在目录
#   PROFILE_DIR = $DSH_PROFILE_DIR（默认 /root/.dsh/profiles/web）
#
# 退出码: 0 = 全部 PASS；1 = 有 FAIL（每条 FAIL 都附修复提示）

set -uo pipefail

BUNDLE_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
PROFILE_DIR="${2:-${DSH_PROFILE_DIR:-/root/.dsh/profiles/web}}"
API="http://127.0.0.1:31790"

pass=0; fail=0
ok()   { printf 'PASS  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf 'FAIL  %s\n      修: %s\n' "$1" "$2"; fail=$((fail+1)); }

echo "== 1. 三处标识必须逐字相同（package.name / patch.name / client id）=="
node - "$BUNDLE_DIR" <<'NODE'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const patch = fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8');
const client = fs.readFileSync(path.join(dir, 'client.js'), 'utf8');
const patchName = (patch.match(/name:\s*'([^']+)'/) || [])[1];
const patchId = (patch.match(/id:\s*([^\s]+)/) || [])[1];
const clientId = (client.match(/id:\s*'([^']+)'/) || [])[1];
console.log('pkg.name       =', pkg.name);
console.log('patch entry id =', patchId);
console.log('patch name     =', patchName);
console.log('client module  =', clientId);
console.log('entry file     =', pkg.exports && pkg.exports['.']);
const allSame = pkg.name === patchName && pkg.name === clientId;
console.log(allSame ? 'IDENTITY_SAME=yes' : 'IDENTITY_SAME=no');
process.exit(allSame ? 0 : 2);
NODE
case $? in
  0) ok "三处标识一致" ;;
  2) bad "三处标识不一致（漏改 client.js 的 id 会让 web boot 报 'loaded without registering'）" "把 package.json 的 name 原样抄到 cordis.patch.yml 的 name 和 client.js 的 load({id})" ;;
  *) bad "标识检查无法执行" "确认这三个文件存在且可读" ;;
esac

echo "== 2. 语法 =="
for f in "$BUNDLE_DIR"/plugin.js "$BUNDLE_DIR"/index.js "$BUNDLE_DIR"/client.js; do
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
  ok "profile 依赖含本包"
else
  bad "profile 依赖不含本包" "plugin_manager install_bundle $BUNDLE_DIR（本 profile 重启后会摘掉第三方 bundle）"
fi

echo "== 5. 回环接口（插件进程活着才有；/state 内部要跑 gh 子进程，偏慢，重试两次）=="
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

echo

echo "== 6. 宿主半边唯一 + locale 口径 =="
if [ -f "$BUNDLE_DIR/index.js" ]; then
  if cmp -s "$BUNDLE_DIR/index.js" "$BUNDLE_DIR/plugin.js"; then
    bad "存在逐字节重复的 index.js（R1：两份副本会漂移）" "rm '$BUNDLE_DIR/index.js'；只保留 exports 指向的 plugin.js"
  fi
fi
ok "宿主半边唯一（只有 plugin.js）"
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
