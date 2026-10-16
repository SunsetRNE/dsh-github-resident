import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function check(c,m){ if(!c){ console.error('FAIL',m); process.exitCode=1; } else console.log('PASS',m); }
const hostSrc = readFileSync(resolve(ROOT,'src/host/index.js'),'utf8');
// H2 #446：拉取函数已搬到 src/host/issueList.js（行为零变化），断言跟随位置，意图不变。
const hostList = readFileSync(resolve(ROOT,'src/host/issueList.js'),'utf8');
const hostPkg = readFileSync(resolve(ROOT,'package/lib/index.js'),'utf8');
// H5 #449：wf.snapshot 的实现在 src/host/sessionSnapshot.js（index.js 只剩注册）。2026-10-16 合并整改：
//   isForce 守卫跟着实现走，判据改读承载模块（pkg 侧同路径，两产物同构）；语义一字未改。
const snapSrc = readFileSync(resolve(ROOT,'src/host/sessionSnapshot.js'),'utf8');
const snapPkg = readFileSync(resolve(ROOT,'package/lib/sessionSnapshot.js'),'utf8');
// isForce guard
check(snapSrc.includes('isForce = !!(args && args.force)'), 'src host 含 isForce（承载模块 sessionSnapshot.js）');
check(snapSrc.includes('if (!isForce && cachedEntry.snapshot'), 'src host wf.snapshot 受 isForce 守卫');
check(snapPkg.includes('isForce'), 'pkg host 含 isForce（package/lib/sessionSnapshot.js）');
// fetchIssues fallback 100
check(hostSrc.includes("tryList(100)") || hostList.includes("tryList(100)"), 'src fetchIssues 使用 100 而非 500');
check(hostSrc.includes('unexpected eof') || hostList.includes('unexpected eof'), 'src 对 unexpected EOF 容错');
check(hostSrc.includes('tryParseIndex') || hostList.includes('tryParseIndex'), 'src fetchIssueIndex 对部分成功解析');
check(hostSrc.includes("runGh(['issue', 'list', '--state', 'open'") || hostList.includes("runGh(['issue', 'list', '--state', 'open'"), 'src 有 open 100 兜底');
console.log('done');
