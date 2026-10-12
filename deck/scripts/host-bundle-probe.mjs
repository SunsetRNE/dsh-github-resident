// host-bundle-probe.mjs — 「宿主原文产物在哪」这一件事只写在这里（#3）
//
// 谁在用：scripts/gen-fixture-640.js（抠宿主输入卡的算式当外部量尺）、以及任何以后要读宿主原文的门禁。
// 为什么单独一个文件：这条探测原先散在 gen-fixture-640.js 的候选表里，只有两条 2026-10-04 手写的
//   Windows 路径 + 一条 asar 解包缓存，本机（Linux 容器）两条都不存在，于是 verify-640 常年 SKIP ——
//   「该红的时候不红」和「找不到就跳过」在日志里长得一模一样，门禁就假绿了。
//
// 探测顺序（越靠前越硬，第一个命中的即为结果）：
//   1. DSH_CONVERSATION_BUNDLE           —— 人显式指定，最高优先（换机器、跑 CI 都靠它）
//   2. DSH_INSTALL_ROOT                  —— 人显式给出 DSH 安装根，按安装布局拼
//   3. 从「本仓已装的 DSH 包」反推安装根  —— require.resolve('@deepseek-ai/dsh/package.json')，跟着本机实际布局走
//      （dsh 的依赖装在自己内层 node_modules 里，所以再往 <dsh>/node_modules 里解析一次该 UI 包）
//   4. 全局 node_modules 的三条候选根      —— npm root -g / NODE_PATH / node 可执行文件所在前缀
//   5. 历史遗留的写死路径与 asar 解包缓存  —— 见 hostBundleCandidates() 里带 legacy / cache 标记的那几条
// 全都拿不到时**不抛错**：调用方按「明确跳过 + 打印试过哪些根与路径」处理（量尺必须是外部的，宁可不跑也不自证）。
//
// 边界（写清楚，免得下一次又以为它在骗人）：
//   - 桌面版把宿主原文封在 app.asar 里，本文件不开 asar；那一路仍归 scripts/asar-extract.js（用 DSWS_640_NO_ASAR=1 关掉）。
//   - 本文件只回答「哪个路径存在」，不判断内容合不合用；内容哨兵在 gen-fixture-640.js（算式不对就报错，不是静默降级）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

const HOST_PKG = '@deepseek-ai/dsh-client-ui-conversation';
const HOST_ENTRY_REL = 'lib/client.js';
const DSH_PKG = '@deepseek-ai/dsh';

// 同一个包的两种安装布局：本机全局装法是 dsh 自己再嵌一层 node_modules（1），npm 普通装法是并排（2）。
const HOST_SUBPATHS = [
  ['node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', HOST_ENTRY_REL],
  ['node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', HOST_ENTRY_REL],
];

// 历史遗留两条：写死的 Windows 安装路径、以及 asar 解包落点。它们在本机不存在，但换机器可能正好命中，
//   所以留着，只降级到候选表末尾（改的是优先级，不是把别人的路砍掉）。
const LEGACY_WINDOWS = 'D:\\0Tools\\DSH Desktop\\resources\\app\\node_modules\\@deepseek-ai\\dsh-client-ui-conversation\\lib\\client.js';

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function tried(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

// 候选根 = 可能含 node_modules/@deepseek-ai/... 的那几个目录。
function candidateRoots(rootDir) {
  const out = [];
  const push = (label, p) => { if (p && !out.some((x) => x.p === p)) out.push({ label, p: path.resolve(p) }); };

  if (process.env.DSH_INSTALL_ROOT) push('DSH_INSTALL_ROOT（人指定）', process.env.DSH_INSTALL_ROOT);
  // 「本仓已装的 DSH 包」反推出的根：跟着 dsh 包自己的位置走，不猜盘符。
  try {
    const dshPkg = require.resolve(DSH_PKG + '/package.json');
    push('require.resolve(\'' + DSH_PKG + '/package.json\') 反推', path.dirname(dshPkg));
  } catch { /* 本仓没装 DSH：正常，继续用别的根 */ }
  // npm root -g 本身就**是**那个 node_modules（/usr/local/lib/node_modules），所以先脱一层再去拼，
  //   否则拼出 .../node_modules/node_modules/...（第一次实现就踩了这个坑，探针自己把它打印出来了）。
  push('npm root -g', stripNodeModules(npmRootG()));
  for (const np of String(process.env.NODE_PATH || '').split(path.delimiter)) {
    if (np) push('NODE_PATH', stripNodeModules(np));
  }
  // node 可执行文件所在前缀：本机 node 是 /usr/local/bin/node，全局包就在 /usr/local/lib/node_modules。
  try {
    const exeDir = path.dirname(fs.realpathSync(process.execPath));
    push('node 前缀', path.resolve(exeDir, '..', 'lib'));
    push('node 前缀（同目录）', exeDir);
  } catch { /* 拿不到就跳过 */ }
  if (rootDir) push('本仓 deck/ 根', rootDir);
  return out;
}

let npmRootCache;
function npmRootG() {
  if (npmRootCache !== undefined) return npmRootCache;
  npmRootCache = '';
  try {
    const out = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    const first = String(out).split('\n').map((s) => s.trim()).filter(Boolean)[0];
    if (first) npmRootCache = first;
  } catch { /* npm 不在 PATH、或超时：不是错误，少一条候选而已 */ }
  return npmRootCache;
}

// 候选根统一表示成「那个 node_modules 的父目录」：这样下面拼 node_modules/... 时不会叠成 node_modules/node_modules。
function stripNodeModules(p) {
  if (!p) return '';
  const base = path.basename(p);
  return base === 'node_modules' ? path.dirname(p) : p;
}

/**
 * 候选路径表：每项带来源说明，调用方把它原样打印出来，人一眼能看出「为什么这台机器没找到」。
 * @param {{rootDir?: string, cacheBundle?: string}} opts
 */
export function hostBundleCandidates(opts = {}) {
  const out = [];
  const push = (label, kind, p) => { if (p) out.push({ p, label, kind }); };

  push('DSH_CONVERSATION_BUNDLE（人指定）', 'env', process.env.DSH_CONVERSATION_BUNDLE);

  const roots = candidateRoots(opts.rootDir);
  for (const r of roots) {
    for (const sub of HOST_SUBPATHS) push(r.label, 'install-root', path.join(r.p, ...sub));
  }

  push('历史遗留：写死的 Windows 安装路径', 'legacy', LEGACY_WINDOWS);
  push('asar 解包落点', 'cache', opts.cacheBundle);

  // 去重但保序：同一路径可能同时从「安装根」和「遗留」两条路进来，先到的那个来源更硬。
  const seen = new Set();
  return out.filter((x) => {
    const key = x.p;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 第一个存在的候选；一个都没有就返回 null（调用方打印 tried 自己决定 SKIP 还是红）。
 * @param {{rootDir?: string, cacheBundle?: string}} opts
 */
export function findHostBundle(opts = {}) {
  const all = hostBundleCandidates(opts);
  for (const c of all) {
    if (isFile(c.p)) return { path: c.p, from: c.label, kind: c.kind, tried: all.map((x) => x.p), triedDetail: all };
  }
  return null;
}

export default { hostBundleCandidates, findHostBundle };

// 直接跑：打印这一次探测的完整过程（排障用，不改任何文件）
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const hit = findHostBundle({ rootDir: path.resolve(import.meta.dirname, '..') });
  const all = hostBundleCandidates({ rootDir: path.resolve(import.meta.dirname, '..') });
  for (const c of all) {
    console.log((isFile(c.p) ? 'HIT   ' : 'miss  ') + '[' + c.kind + '] ' + c.p + '  ← ' + c.label);
  }
  console.log(hit ? '选中：' + hit.path + '（来源：' + hit.from + '）' : '一个都没找到');
  process.exit(hit ? 0 : 1);
}
