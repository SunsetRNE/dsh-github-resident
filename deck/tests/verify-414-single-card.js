/**
 * verify-414-single-card — 回归：single 卡片可点切换 public/private
 * 断言：single 分支含 onClick/onKeyDown/role=radio/aria-checked，且 isWizard 场景同步 valuesByStep。并验证 client 产物已同步。
 *
 * 2026-10-14（票《deck 门禁红：#414 single-card 的四条判据》）：**读的文件清单过期了**，不是源码丢了修复。
 * single 分支为过「文件粒度 ≤350 行」那道门禁被抽成了独立内核模块 `src/client/kernel/modal-fields.js`
 * （见该文件头与 `scripts/build.mjs` 的 KERNEL_MODULES），而这支判据只跟着「slotRenderer.js 拆三文件」
 * 更新过一次，没跟上后来的抽取 —— 于是四条判据在三个旧文件里找 single 分支，永远找不到。
 * 证据：`modal-fields.js` 里四样齐全；`package/lib/client.js` 与它**逐字一致**（重建后仍在）。
 * 故本次把清单补到分支的现居地（**已有七条一条不动**，只加），并补两条接线判据 —— 分支再搬家时这里会红。
 *
 * 行为面的判据在 `verify-414-single-card-keyboard.js`（真调 onKeyDown，不是 grep 字形）。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function check(cond, msg){ if(!cond){ console.error('FAIL', msg); process.exitCode=1; } else console.log('PASS', msg); }
const SR_FILES = ['src/client/kernel/slotRenderer-queue.js', 'src/client/kernel/slotRenderer-repo-sync.js', 'src/client/kernel/slotRenderer-modal-view.js', 'src/client/kernel/modal-fields.js']; // 原 slotRenderer.js 已消除 → 读三文件拼合；single 分支现居 modal-fields.js（内核模块），一并读
/** 分支的**现居地**：单列出来，好让「它又搬家了」这件事在这里就红，而不是靠拼合碰巧命中。 */
const BRANCH_FILE = 'src/client/kernel/modal-fields.js';
const src = SR_FILES.map((f) => readFileSync(resolve(ROOT, f), 'utf8')).join('\n');
const pkg = readFileSync(resolve(ROOT, 'package/lib/client.js'), 'utf8');
check(src.includes("role: 'radio'") || src.includes('role: "radio"') || src.includes("role: 'radio'"), 'src single 含 role radio');
check(src.includes('onClick') && src.includes("vals[f.name]"), 'src single 含 onClick 更新 vals');
check(src.includes('onKeyDown'), 'src single 含 onKeyDown 键盘可达');
check(src.includes('aria-checked'), 'src single 含 aria-checked');
check(src.includes('valuesByStep[stepIndex]'), 'src single 同步 valuesByStep（向导按步隔离）');
check(src.includes('m.pending ? -1 : 0'), 'src single pending 时 tabIndex -1');
check(pkg.includes("role: 'radio'"), 'package/lib/client.js 已同步 single 修复');
// ---- 2026-10-14 新增（只增不减）：分支的现居地 + 它真的会被拼进产物 ----
const branchSrc = readFileSync(resolve(ROOT, BRANCH_FILE), 'utf8');
check(branchSrc.includes("role: 'radio'") && branchSrc.includes('onKeyDown') && branchSrc.includes('aria-checked') && branchSrc.includes('m.pending ? -1 : 0'),
  'single 分支的现居地（' + BRANCH_FILE + '）四样齐全 —— 不是在别的文件里碰巧命中');
const buildSrc = readFileSync(resolve(ROOT, 'scripts/build.mjs'), 'utf8');
check(buildSrc.includes("file: 'src/client/kernel/modal-fields.js'"), 'build.mjs 的 KERNEL_MODULES 注册了这个文件（否则它不会进产物）');
const indexSrc = readFileSync(resolve(ROOT, 'src/client/index.js'), 'utf8');
check(indexSrc.includes('kernel:modalFields'), 'src/client/index.js 里留着拼接 marker（构建期按它把该模块拼回闭包）');
console.log('done');
