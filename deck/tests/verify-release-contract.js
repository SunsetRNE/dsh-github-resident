#!/usr/bin/env node
/**
 * tests/verify-release-contract.js — 单一高层的发布契约校验（#356；2026-10-16 #66 改钉合并身份）
 *
 * 定位：以单一 high-level gate 覆盖发布契约，任一失败即阻断发布，不为每项各起低层测试。
 *
 * 2026-10-16 改钉（#66 裁决）：身份融合后真正发布的是**仓库根** @sunsetrne/dsh-github-resident-v2，
 * 目标版本与清单断言一律读仓库根 package.json；原来只服务 deck 独立发布的几组判据按下表处理：
 *   A. 版本同源 —— 改成「根清单版本 == 目标」+「身份投影到产物」：构建生成的 package/README.md
 *      banner、client.js 与 package/lib/client.js 的版本注入都等于目标。原「README 三处锁定 /
 *      英文文档 / 包说明首段」那一组**退役**：合并仓不在 deck/README.md 与 docs/README.en.md
 *      里钉版本（实测 0 处），变更历史的出口是 GitHub Release（见 C）。
 *   B. 说明锁定 —— 改读**根清单**的 description / keywords（human-first 可检索）。
 *   C. 变更历史 —— 保留「CHANGELOG.md 存在 + 日期+版本标准节头 + 最新节是里程碑形态」；原
 *      「CHANGELOG 最新节版本 == 目标」**退役**：deck/CHANGELOG.md 追的是「合并包 1.8.x」里程碑，
 *      与根版本不同源；合并仓的发布说明由根 workflow 的 `gh release create --generate-notes` 生成，
 *      这一条改钉那个出口。
 *   D. 包白名单 —— 改读**根清单**的 files 白名单（在仓库根跑 `npm pack --dry-run` 实测约 60 秒，
 *      超过门禁链每道 65 秒的预算；解包与装载的真验证在根侧 verify-bundle.sh 与
 *      verify-real-artifact.mjs 里），deck 侧发货清单的 files 一并钉住。
 *   E. 模板与网页卡同源 —— 网页卡已按 #66 裁决退役；改钉「模板真源仍在 + 对话脚本读它 + 卡确实不在」。
 *   F. 向导契约 —— 不动（deck 侧发布向导仍按原判据钉住）。
 *
 * 用法：
 *   node tests/verify-release-contract.js
 *   node tests/verify-release-contract.js --version v1.11.0
 *   node tests/verify-release-contract.js --version 1.11.0   # 自动补 v
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");   // deck/
const REPO = resolve(ROOT, "..");                                      // 合并仓根

function read(p) {
  try { return readFileSync(resolve(ROOT, p), "utf8"); } catch { return null; }
}
function exists(p) { return existsSync(resolve(ROOT, p)); }
function readRepo(p) {
  try { return readFileSync(resolve(REPO, p), "utf8"); } catch { return null; }
}
function existsRepo(p) { return existsSync(resolve(REPO, p)); }
function jsonRepo(p) {
  try { return JSON.parse(readRepo(p) || "null"); } catch { return null; }
}

/**
 * 找一把真能跑 shell 脚本的 bash（#845）：先按候选路径找 Git Bash —— Windows 自带的
 *   C:\\Windows\\System32\\bash.exe 是 WSL 的入口，没装发行版时直接失败（实测 stderr 是
 *   「适用于 Linux 的 Windows 子系统没有已安装的分发」），而 Git Bash 随 Git 一起装。
 *   候选都不在时才退回 PATH 上的 bash（Linux / macOS / 配好的 CI 走这一支）。
 *   拿到绝对路径后调用处不再加 shell: true —— 路径里的空格会被 cmd.exe 拆坏（实测报
 *   「'C:/Program' is not recognized」）。
 */
function resolveBash() {
  const candidates = [
    "C:/Program Files/Git/bin/bash.exe",
    "C:/Program Files/Git/usr/bin/bash.exe",
    "C:/Program Files (x86)/Git/bin/bash.exe",
    resolve(process.env.LOCALAPPDATA || "", "Programs/Git/bin/bash.exe"),
  ];
  for (const c of candidates) { try { if (c && existsSync(c)) return c } catch { /* 继续找下一个 */ } }
  return "bash";
}

let passes = 0;
let failures = [];
function assert(cond, msg) {
  if (cond) { passes++; console.log(`  ✓ ${msg}`); }
  else { failures.push(msg); console.log(`  ✗ ${msg}`); }
}

// 解析 --version
let targetRaw = null;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--version" && process.argv[i+1]) { targetRaw = process.argv[i+1]; i++; }
  else if (/^v?\d+\.\d+\.\d+$/.test(a) && !a.startsWith("-")) { targetRaw = a; }
}
function normalizeVersion(input) {
  if (!input) return null;
  let v = input.trim();
  if (!v) return null;
  if (!v.startsWith("v")) v = "v" + v;
  // 预发布号（如 v1.8.0-beta.1）也收：它是 npm 上先行测试版的正式写法，但不算对外宣布的稳定版。
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)) return null;
  return v;
}

let targetVersion = null;
let targetNum = null;
if (targetRaw) {
  targetVersion = normalizeVersion(targetRaw);
  if (!targetVersion) {
    console.error(`版本号形态错误：${targetRaw}，期望 vX.Y.Z，例如 v1.11.0`);
    process.exit(2);
  }
} else {
  // 未显式传参则用**仓库根** package.json 的版本作为目标（合并身份的唯一真源，#66）
  const rootPkg = jsonRepo("package.json");
  if (rootPkg && rootPkg.version) targetVersion = "v" + rootPkg.version;
}
if (!targetVersion) {
  console.error("无法确定目标版本：请传 --version vX.Y.Z 或确保仓库根 package.json 含 version");
  process.exit(2);
}
targetNum = targetVersion.slice(1);
// 预发布与稳定版走不同断言：预发布不签产物里那几处版本锁定（它们跟的是当前构建的稳定版）。
const isPrerelease = targetNum.includes('-');

console.log("verify-release-contract — 单一高层的发布契约校验（合并仓：目标版本取自仓库根 package.json）");
console.log(`目标版本：${targetVersion}（数字：${targetNum}）`);
console.log(`生效规范：docs/releases/RELEASE-RUNBOOK.md（2026-08-31，以更新日期者为准）`);
console.log("");

// ── A. 版本同源（根清单 + 身份投影）────────────────────
console.log("[A] 版本同源（根清单 ↔ 身份投影）");
const rootPkg = jsonRepo("package.json") || {};
assert(rootPkg.version === targetNum, `仓库根 package.json 版本 == ${targetNum}（实际 ${rootPkg?.version || "缺失"}）`);

const pkgReadme = read("package/README.md") || "";
if (isPrerelease) {
  assert(true, `预发布 ${targetNum}：身份投影（构建 banner / 产物注入）跟的是当前构建的版本，跳过`);
} else {
  const banner = (pkgReadme.split("\n")[0] || "");
  assert(banner.includes("@ " + targetVersion), `package/README.md 的构建 banner 含目标 ${targetVersion}（身份投影）`);
  for (const f of ["client.js", "package/lib/client.js"]) {
    const src = read(f) || "";
    assert(src.includes(targetVersion) || src.includes(targetNum), `${f} 含 ${targetVersion}（或 ${targetNum}）版本注入`);
  }
  assert(true, `README 三处版本锁定 / 英文文档 / 包说明首段的版本锁定已退役（#66）：合并仓不在 deck/README.md 与 docs/README.en.md 里钉版本，变更历史出口见 C`);
}
console.log("");

// ── B. 说明锁定（读合并包清单的 description / keywords）────────────────
console.log("[B] 说明锁定（description / keywords · 读仓库根清单）");
const desc = rootPkg.description || "";
assert(desc.length > 20, `合并包 description 非空且长度 >20（实际 ${desc.length}）`);
// 2026-09-21 放宽（维护者裁决）：这条原先要求介绍文字里必须出现 DSH/DeepSeek 字样。市场条目全在
// DSH 语境里，介绍不必再重复一次；改成「介绍里出现，或包自己带 dsh 身份（包名 / keywords）」即为通过。
const descNamesHost = desc.includes("DeepSeek") || desc.includes("DSH");
const pkgNamesHost = String(rootPkg.name || "").includes("dsh")
  || (Array.isArray(rootPkg.keywords) && (rootPkg.keywords.includes("dsh") || rootPkg.keywords.includes("dsh-plugin")));
assert(descNamesHost || pkgNamesHost, `description 或包自身（name/keywords）含 DSH/DeepSeek 标识（human-first 可检索）`);
assert(desc.includes("Matt Pocock") || desc.includes("mattpocock") || desc.includes("技能"), `description 含 Matt Pocock/技能 标识`);
const kws = Array.isArray(rootPkg.keywords) ? rootPkg.keywords : [];
assert(kws.includes("dsh") || kws.includes("dsh-plugin"), `合并包 keywords 含 dsh 或 dsh-plugin（实际 [${kws.join(", ")}]）`);
if (!kws.includes("dsh-plugin")) {
  console.log("    提示：建议 keywords 同时包含 dsh-plugin 以提升市场可发现性（当前仅含 dsh）");
}
// human-first 的软性约束：description 里的小数字优先能在 README 里检索到；未命中只提示、不阻断。
const readmeRepo = readRepo("README.md") || "";
const numbersInDesc = desc.match(/\d+/g) || [];
let numbersDetail = "";
for (const n of numbersInDesc) {
  if (n.length >= 4) continue;
  if (n === "25" || n === "18" || n === "7") {
    if (!readmeRepo.includes(n) && !pkgReadme.includes(n)) numbersDetail += ` ${n}`;
  }
}
if (numbersDetail) console.log(`    提示：description 中的数字${numbersDetail} 未在 README 中直接检索到（human-first）`);
assert(true, `description 数字可检索性已提示（${numbersDetail ? "未命中" + numbersDetail + "（仅提示）" : "均命中或无关键数字"}）`);
console.log("");

// ── C. 变更历史出口（CHANGELOG 形态 + Release notes）────────────────
console.log("[C] 变更历史出口（CHANGELOG 形态 + Release notes）");
const changelog = read("CHANGELOG.md") || "";
assert(changelog.length > 0, `CHANGELOG.md 存在`);
if (changelog) {
  const hasHeader = /##\s+\d{4}-\d{2}-\d{2}/.test(changelog);
  assert(hasHeader, `CHANGELOG.md 含日期+版本的标准节头（统一模板）`);
  const firstHeader = (changelog.match(/^##\s+\d{4}-\d{2}-\d{2}[^\n]*/m) || [""])[0];
  assert(/^##\s+\d{4}-\d{2}-\d{2}\s*·\s*(?:合并包\s*)?v?\d+\.\d+\.\d+/.test(firstHeader), `CHANGELOG.md 最新节是里程碑形态（日期 · [合并包] 版本）—— 实际「${firstHeader.slice(0, 60)}」`);
  const rootWorkflow = readRepo(".github/workflows/release.yml") || "";
  assert(rootWorkflow.includes("--generate-notes"), "合并仓的发布说明出口：根 workflow 用 gh release create --generate-notes 生成");
  assert(true, `「CHANGELOG 最新节版本 == 目标 ${targetVersion}」已退役（#66）：deck/CHANGELOG.md 追的是合并里程碑，与根版本不同源；改钉上面那个 Release 出口`);
}

// 模板中是否要求 CHANGELOG 与 Release 同文（本地仅校验模板存在）
const templateMd = read("docs/releases/release-issue-template.md") || "";
assert(templateMd.includes("CHANGELOG") || templateMd.includes("变更历史"), `发布模板含 CHANGELOG/变更历史清单项`);
console.log("");

// ── D. 包白名单（根清单 files + deck 发货清单）────────────────
console.log("[D] 包白名单（根清单 files 白名单 + deck 发货清单）");
const rootFiles = Array.isArray(rootPkg.files) ? rootPkg.files : [];
for (const need of ["dist/", "plugin.js", "cordis.patch.yml"]) {
  assert(rootFiles.includes(need), `根清单 files 白名单含 ${need}`);
}
assert(rootFiles.some(f => String(f).indexOf("deck/src/") === 0), "根清单 files 白名单含 deck/src/（deck 核源码随包）");
const badDeclared = rootFiles.filter(f => String(f).includes(".env") || String(f).includes("node_modules") || String(f).includes(".git"));
assert(badDeclared.length === 0, `根清单 files 白名单不含密钥与多余目录（${badDeclared.length ? "发现：" + badDeclared.join(", ") : "干净"}）`);
const shipPkg = JSON.parse(read("package/package.json") || "{}");
const shipFiles = Array.isArray(shipPkg.files) ? shipPkg.files : [];
assert(shipFiles.includes("lib") && shipFiles.includes("shared") && shipFiles.includes("cordis.patch.yml"), `deck 发货清单 files 含 lib / shared / cordis.patch.yml（实际 [${shipFiles.join(", ")}]）`);
console.log("    注：在仓库根跑 npm pack --dry-run 实测约 60 秒，超过门禁链每道 65 秒的预算；解包与装载的真验证在根侧 verify-bundle.sh 与 verify-real-artifact.mjs。");
console.log("");

// ── E. 模板真源与网页卡退役（#66）────────────────
console.log("[E] 模板真源与网页卡退役（#66）");
assert(templateMd.length > 0, `docs/releases/release-issue-template.md 存在（发布议题的唯一真源）`);
assert(!existsRepo(".github/ISSUE_TEMPLATE/release.yml"), "上游那张发布网页卡不在本仓（退役是裁决，不是漏补）");
const script = read("scripts/create-release-issue.mjs") || "";
assert(script.includes("release-issue-template.md"), `对话脚本读取模板真源`);
const miss = spawnSync("node", [resolve(ROOT, "scripts/create-release-issue.mjs")], { encoding: "utf8" });
assert(miss.status === 2, `对话脚本未给版本时退出码 2（追问）`);
console.log("");

// ── F. 向导契约（wizard/template.sh 与 wizard-release.sh）────────────────
console.log("[F] 向导契约（基于 wizard/template.sh 的只扫码旅程）");
const wizardLib = read("wizard/template.sh") || "";
assert(wizardLib.length > 0, `wizard/template.sh 存在`);
if (wizardLib) {
  assert(wizardLib.includes("_clear") && wizardLib.includes("stage()"), `向导库含分段清屏（_clear / stage）`);
  assert(wizardLib.includes("open_url"), `向导库含显式打开链接（open_url）`);
  assert(wizardLib.includes("pause") && wizardLib.includes("confirm"), `向导库含确认（pause / confirm）`);
  assert(wizardLib.includes("write_env") && wizardLib.includes("ENV_FILE"), `向导库含落盘与收尾（write_env / ENV_FILE）`);
  assert(wizardLib.includes("finish"), `向导库含收尾（finish）`);
  assert(wizardLib.includes("TOTAL_STAGES") && wizardLib.includes("Stage"), `向导库含进度（TOTAL_STAGES / Stage X/Y）`);
  assert(wizardLib.includes("poll_npm_version") || wizardLib.includes("poll"), `向导库含轮询辅助（poll_npm_version）`);
}

const wizardRelease = read("scripts/wizard-release.sh") || "";
assert(wizardRelease.length > 0, `scripts/wizard-release.sh 存在`);
if (wizardRelease) {
  assert(wizardRelease.includes("wizard/template.sh"), `发布向导基于 wizard/template.sh（source 引用）`);
  assert(wizardRelease.includes("stage") && wizardRelease.includes("TOTAL_STAGES=6"), `发布向导含分段清屏与进度（TOTAL_STAGES=6）`);
  assert(wizardRelease.includes("open_url"), `发布向导含显式打开链接（open_url）`);
  assert(wizardRelease.includes("pause") || wizardRelease.includes("confirm"), `发布向导含确认（pause/confirm）`);
  assert(wizardRelease.includes("write_env") && wizardRelease.includes("ENV_FILE"), `发布向导可中断重跑且已落盘值被记住（write_env / ENV_FILE）`);
  assert(wizardRelease.includes("_existing") || wizardRelease.includes("WIZARD_RELEASE_VERSION"), `发布向导重跑时回填已落盘值（_existing / WIZARD_RELEASE_VERSION）`);
  // 旅程覆盖
  assert(wizardRelease.includes("工作区干净") || wizardRelease.includes("git status"), `发布向导旅程覆盖：确认提交已推送与工作区干净`);
  assert(wizardRelease.includes("npm publish") && wizardRelease.includes("--registry"), `发布向导旅程覆盖：发布并弹浏览器（npm publish --registry）`);
  assert(wizardRelease.includes("--auth-type=web") || wizardRelease.includes("2FA") || wizardRelease.includes("auth-type"), `发布向导使用网页 2FA（--auth-type=web）`);
  assert(wizardRelease.includes("poll_npm_version") || wizardRelease.includes("官方源验证"), `发布向导旅程覆盖：官方源验证（轮询）`);
  assert(wizardRelease.includes("已装形态验证") || wizardRelease.includes("dsh plugin"), `发布向导旅程覆盖：已装形态验证`);
  // 只扫码体验
  assert(wizardRelease.includes("open_url") && wizardRelease.includes("浏览器"), `发布向导在需要浏览器授权时弹出可见窗口并打开链接`);
  assert(wizardRelease.includes("扫码") || wizardRelease.includes("一次"), `发布向导用户仅需扫码一次`);
  assert(wizardRelease.includes("轮询") || wizardRelease.includes("poll"), `发布向导其余轮询与验证由工具在后台完成`);
  assert(wizardRelease.includes("可见") && wizardRelease.includes("窗口"), `发布向导显式处理可见窗口与后台无链接时的回退`);
  // 契约阻断
  assert(wizardRelease.includes("verify-release-contract.js"), `发布向导调用单一高层校验（verify-release-contract.js）`);
  assert(wizardRelease.includes("阻断") || wizardRelease.includes("exit 1"), `发布向导在校验失败时阻断后续步骤`);
  // 语法检查
  // bash -n 语法检查（Windows 上使用相对路径 + cwd，避免 D:/ 绝对路径在 Git Bash 中不被识别）
  const BASH = resolveBash();
  const shellCheck = spawnSync(BASH, ["-n", "scripts/wizard-release.sh"], { cwd: ROOT, encoding: "utf8" });
  if (shellCheck.status !== 0) console.log("    bash -n wizard-release stderr:", (shellCheck.stderr || "").slice(0,500), "status", shellCheck.status);
  assert(shellCheck.status === 0, `发布向导通过 bash -n 语法检查`);
  const tplCheck = spawnSync(BASH, ["-n", "wizard/template.sh"], { cwd: ROOT, encoding: "utf8" });
  if (tplCheck.status !== 0) console.log("    bash -n template stderr:", (tplCheck.stderr || "").slice(0,500), "status", tplCheck.status);
  assert(tplCheck.status === 0, `向导库通过 bash -n 语法检查`);
}
console.log("");

// ── 汇总与待改清单 ────────────────────────────────
console.log(`结果：${passes} 通过，${failures.length} 失败`);
if (failures.length > 0) {
  console.log("\n待改清单（请逐项修复后重跑本校验与向导）：");
  failures.forEach((msg, idx) => console.log(`  ${idx+1}. ${msg}`));
  console.log("\n提示：本校验为单一高层 gate，任一失败即阻断发布（不为每项各起低层测试）。");
  console.log(`下一步：按清单修复 → 同步仓库根 package.json 与产物版本 → 重跑 node tests/verify-release-contract.js --version ${targetVersion}`);
  if (targetVersion !== "v" + ((jsonRepo("package.json") || {}).version || "")) {
    console.log(`当前仓库根 package.json 版本为 v${(jsonRepo("package.json") || {}).version}，与目标 ${targetVersion} 不一致，需先同步。`);
  }
  process.exit(1);
} else {
  console.log(`\n全部通过 — 合并身份下的发布契约成立（目标版本取自仓库根清单，产物与生成物都已投影该身份）。`);
  console.log(`目标 ${targetVersion} 已就绪。`);
}
