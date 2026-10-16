// verify-bug-366-refresh.js — Regression guard for #366 (refreshAll visual not updating)
// Run: node tests/verify-bug-366-refresh.js
import fs from 'node:fs'
let failed = false;
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true; };
const probe = ['src/client/kernel/probe-chain.js','src/client/kernel/probe-snapshot.js','src/client/kernel/probe-auto.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n'); // 456 收尾：probe.js 已拆为三文件，读三文件拼起来的内容断言
// 2026-10-16 合并整改：在途复用那一段搬进 kernel/probe-stale.js，写法也换成了单点函数
//   （_snapReuseInFlight(st, force) 里那句「force 不复用非 force 的在途请求」）。判据跟着实现走，意图不变。
const staleSrc = fs.readFileSync('src/client/kernel/probe-stale.js', 'utf8');
check(staleSrc.includes('_snapReuseInFlight = function (st, force)') && staleSrc.includes('if (force && pend.force !== true) return null'), 'probe dedup distinguishes force');
check(probe.includes('force: !!force'), 'pending entry stores force flag');
check(probe.includes('cur && cur.promise===p'), 'pending delete is safe');
check(probe.includes('#366'), 'probe contains #366 marker');
check(probe.includes('强制刷新后扇出到同工作区全组'), 'refreshAll contains fan-out');
check(probe.includes('diffSnapshots(st2.snapshot, newSnap)'), 'fan-out computes diff');
check(probe.includes('st2.snapshot = newSnap') && probe.includes('emit(st2)'), 'fan-out copies snapshot');
// H5/H6：快照那条链的实现已搬进 sessionSnapshot.js / sessionRefresh.js（index.js 只剩注册与转发）。
// 2026-10-16 合并整改：把承载模块并进「host 文本」再量，断言与阈值一字未改。
const host = fs.readFileSync('src/host/index.js', 'utf8') + '\n'
  + fs.readFileSync('src/host/sessionSnapshot.js', 'utf8') + '\n'
  + fs.readFileSync('src/host/sessionRefresh.js', 'utf8');
const pattern = 'const diskb = await readDiskCache(repo0b)';
const count = (host.match(new RegExp(pattern.replace(/[.*+?^$\{|}()[\]]/g, '\\$&'), 'g')) || []).length;
check(count === 1, 'host disk cache check appears once, found ' + count);
check(host.includes('#366 fix: wf.refresh must bypass disk cache'), 'host contains #366 bypass');
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
