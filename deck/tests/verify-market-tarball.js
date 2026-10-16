#!/usr/bin/env node
/**
 * verify-market-tarball.js — 合并仓「发 Release 附预构建包」的门禁
 * （2026-10-16 改钉仓库根发布链 · #66 裁决：不保留固定资产名的最新版链接）
 *
 * 上游 deck 独立仓时代的契约：`.github/workflows/release-tarball.yml` 在 Release published 时
 * 把 npm 上那一版的原样产物以固定文件名附到 Release，市场条目用
 * `releases/latest/download/<固定名>.tgz` 这种「不会过期」的链接。
 *
 * 合并仓（身份融合之后）的现状：真正发布的是仓库根 `@sunsetrne/dsh-github-resident-v2`，
 * 发布入口是根 `.github/workflows/release.yml`（tag push / workflow_dispatch → 构建 → 门禁 →
 * `npm pack` → 建 Release 并把**当版** tgz `gh release upload --clobber` 附上去）。
 * 资产名是 npm pack 的 `<包名>-<版本>.tgz`（带版本号），本仓**不承诺**固定资产名的
 * latest/download 链接；根 README「安装 · 方式 A」给的是带版本的 Release tgz URL。
 *
 * 所以本门禁钉这条真实契约：
 *   1. 发 Release 的那条 workflow 确实把当版产物附上去（触发、权限、npm pack、gh release upload --clobber）；
 *   2. 附上去的资产名与根 README 那条安装 URL 对得上（npm pack 命名 = <包名去 scope>-<版本>.tgz）；
 *   3. 上游那份固定名附着 workflow 与固定名链接都不在本仓（退役是裁决，不是漏补）；
 *   4. 本门禁自己还挂在 verify 链里。
 *
 * 用法：node tests/verify-market-tarball.js（在 deck 目录下；读的是仓库根的发布链）
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");   // deck/
const REPO = resolve(ROOT, "..");                                      // 合并仓根
let failures = [];
let passes = 0;

function assert(cond, msg) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

console.log("verify-market-tarball — 发 Release 附预构建包门禁（合并仓：钉仓库根发布链）");
console.log("");

const workflowPath = resolve(REPO, ".github/workflows/release.yml");
const retiredWorkflowPath = resolve(ROOT, ".github/workflows/release-tarball.yml");
const rootPackageJsonPath = resolve(REPO, "package.json");
const readmePath = resolve(REPO, "README.md");
const deckManifestPath = resolve(ROOT, "package.json");

// 1. 发 Release 的 workflow 在仓库根，且确实附着当版产物
console.log("[1] 发布入口：仓库根 .github/workflows/release.yml");
let workflow = "";
if (existsSync(workflowPath)) {
  workflow = readFileSync(workflowPath, "utf8");
  assert(true, ".github/workflows/release.yml 存在（合并仓的发布入口）");
  assert(/tags:\s*\[[^\]]*'v\*'/.test(workflow), "tag push v* 触发发布");
  assert(workflow.includes("workflow_dispatch"), "支持手动 dispatch 发布");
  assert(/permissions:[\s\S]*?contents:\s*write/.test(workflow), "申请 contents: write（否则上传资产会失败）");
  assert(workflow.includes("npm pack"), "用 npm pack 产出当版 tgz");
  assert(workflow.includes("gh release create"), "用 gh release create 建 Release");
  assert(workflow.includes("gh release upload") && workflow.includes("--clobber"), "用 gh release upload --clobber 附着/覆盖资产");
} else {
  assert(false, ".github/workflows/release.yml 存在（合并仓的发布入口）");
}
console.log("");

// 2. 资产名与根 README 的安装 URL 对得上（npm pack 命名）
console.log("[2] 资产名与 README 安装 URL 对得上");
const rootPkg = existsSync(rootPackageJsonPath) ? JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) : null;
const pkgName = rootPkg?.name ?? "";
const pkgVersion = rootPkg?.version ?? "";
assert(Boolean(pkgName && pkgVersion), `仓库根 package.json 读到了包名与版本（${pkgName || "读不到"}@${pkgVersion || "读不到"}）`);
// npm pack 的资产名：去 scope，<name>-<version>.tgz
const assetBase = String(pkgName).replace(/^@[^/]+\//, "");
if (assetBase && pkgVersion) {
  assert(workflow.includes("TGZ=$(ls *.tgz | head -1)"), "Release 附的是 npm pack 出来的那一个 tgz");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
  assert(readme.includes(`${assetBase}-$VER.tgz`), `README 安装 URL 用 npm pack 的资产名形态 ${assetBase}-<版本>.tgz`);
  assert(readme.includes("releases/download/v$VER/"), "README 安装 URL 是带版本的 Release 资产路径（releases/download/v$VER/）");
  const repoRaw = typeof rootPkg.repository === "string" ? rootPkg.repository : (rootPkg.repository && rootPkg.repository.url) || "";
  const slug = String(repoRaw).replace(/^git\+/, "").replace(/\.git$/, "").replace(/^https:\/\/github\.com\//, "");
  assert(Boolean(slug) && readme.includes(`github.com/${slug}/releases/download/`), `README 安装 URL 指向本仓（github.com/${slug}/releases/download/）`);
}
console.log("");

// 3. 上游那套固定名契约不在本仓（退役是裁决，不是漏补）
console.log("[3] 固定资产名的旧契约不在本仓（#66 裁决：不保留）");
assert(!existsSync(retiredWorkflowPath), "上游的 .github/workflows/release-tarball.yml 不在本仓");
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, "utf8");
  assert(!readme.includes("latest/download"), "README 不承诺 latest/download 的固定资产名链接（装法用带版本的 Release tgz）");
}
console.log("");

// 4. 本门禁自己确认已挂进 verify 链（仓库惯例：免得哪天被摘掉还没人发现）
console.log("[4] 本门禁已挂进 npm run verify 链");
const deckManifest = existsSync(deckManifestPath) ? JSON.parse(readFileSync(deckManifestPath, "utf8")) : null;
assert(
  String(deckManifest?.scripts?.verify || "").includes("verify-market-tarball.js"),
  "package.json 的 scripts.verify 里有 verify-market-tarball.js",
);
console.log("");

// 汇总
console.log(`结果：${passes} 通过，${failures.length} 失败`);
if (failures.length > 0) {
  console.log("\n失败项：");
  failures.forEach((f) => console.log("  - " + f));
  console.log("\n修哪里：");
  console.log("  - 发布入口或附着资产的行为变了：改仓库根 .github/workflows/release.yml（或改回它的判据）。");
  console.log("  - 资产名与 README 安装 URL 对不上：改根 README「安装 · 方式 A」里那条 URL，或改 npm pack 的命名来源。");
  process.exit(1);
} else {
  console.log("\n全部通过 — 发 Release 时会把当版 npm pack 产物附上去，根 README 的安装 URL 与它逐字对得上。");
}
