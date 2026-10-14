/**
 * verify-414-single-card — 回归：single 卡片可点切换 public/private
 * 断言：single 分支含 onClick/onKeyDown/role=radio/aria-checked，且 isWizard 场景同步 valuesByStep。并验证 client 产物已同步。
 *
 * 2026-10-14（票 #39《deck 门禁红：#414 single-card 的四条判据》）：**读的文件清单过期了**，不是源码丢了修复。
 * single 分支为过「文件粒度 ≤350 行」那道门禁被抽成了独立内核模块 `src/client/kernel/modal-fields.js`
 * （见该文件头与 `scripts/build.mjs` 的 KERNEL_MODULES），而这支判据只跟着「slotRenderer.js 拆三文件」
 * 更新过一次，没跟上后来的抽取 —— 于是四条判据在三个旧文件里找 single 分支，永远找不到。
 * 证据：`modal-fields.js` 里四样齐全；`package/lib/client.js` 与它**逐字一致**（重建后仍在）。
 * 故本次把清单补到分支的现居地（**已有七条一条不动**，只加），并补两条接线判据 —— 分支再搬家时这里会红。
 *
 * 行为面的判据在 `verify-414-single-card-keyboard.js`（真调 onKeyDown，不是 grep 字形）。
 *
 * 关于「产物已同步」那几条：`package/lib/client.js` 是**本地产物**（`deck/.gitignore` 忽略、不入库），
 * 所以它们只在「刚构建过」的机器上成立，进不了提交、也当不了证据 —— 它们的意义是「重建之后源与产物说法一致」。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function check(cond, msg){ if(!cond){ console.error('FAIL', msg); process.exitCode=1; } else console.log('PASS', msg); }
// 拼合读面：这几个文件里**可能**住着 single 分支（它搬过家：slotRenderer.js → 拆三文件 → 抽成内核模块）。
const BRANCH_SOURCES = ['src/client/kernel/slotRenderer-queue.js', 'src/client/kernel/slotRenderer-repo-sync.js', 'src/client/kernel/slotRenderer-modal-view.js', 'src/client/kernel/modal-fields.js'];
/** 分支的**现居地**：单列出来，好让「它又搬家了」这件事在这里就红，而不是靠拼合碰巧命中。 */
const BRANCH_FILE = 'src/client/kernel/modal-fields.js';
/** 分支的**调用点**：真实渲染处必须把 ctx 那几个键给全，否则「行为判据」证明的东西落不到 UI 上。 */
const CALL_SITE = 'src/client/kernel/slotRenderer-modal-view.js';
const src = BRANCH_SOURCES.map((f) => readFileSync(resolve(ROOT, f), 'utf8')).join('\n');
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
check(["role: 'radio'", 'onKeyDown', 'aria-checked', 'm.pending ? -1 : 0', 'onClick', 'valuesByStep[stepIndex]'].every((t) => branchSrc.includes(t)),
  'single 分支的现居地（' + BRANCH_FILE + '）六样齐全 —— 不是在别的文件里碰巧命中');
// 接线（语义匹配，不锁字面：重排 KERNEL_MODULES 或换引号不该误红）
const buildSrc = readFileSync(resolve(ROOT, 'scripts/build.mjs'), 'utf8');
const escaped = BRANCH_FILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
check(new RegExp('file:\\s*[\'"]' + escaped + '[\'"]').test(buildSrc),
  'build.mjs 的 KERNEL_MODULES 注册了这个文件（否则它不会进产物）');
const indexSrc = readFileSync(resolve(ROOT, 'src/client/index.js'), 'utf8');
check(indexSrc.includes('kernel:modalFields'), 'src/client/index.js 里留着拼接 marker（构建期按它把该模块拼回闭包）');
// 调用点：真实渲染处把 ctx 给全 —— 少了哪个键，行为判据证明的东西都落不到 UI 上
const callSrc = readFileSync(resolve(ROOT, CALL_SITE), 'utf8');
const callMatch = callSrc.match(/modalFormFields\([^)]*\{([^}]*)\}/);
const callCtx = callMatch ? callMatch[1] : '';
check(Boolean(callMatch) && ['m', 'isWizard', 'stepIndex', 'vals', 'setVals', 'onPick', 'h'].every((k) => new RegExp('\\b' + k + '\\s*:').test(callCtx)),
  '调用点（' + CALL_SITE + '）把 ctx 七个键都给全了');
// 产物侧：四样**逐一**在（原来只查了 role 一样）
check(["role: 'radio'", 'onKeyDown', 'aria-checked', 'm.pending ? -1 : 0'].every((t) => pkg.includes(t)),
  'package/lib/client.js 里四样逐一也在（本地产物；重建后应与源逐字一致）');
console.log('done');
