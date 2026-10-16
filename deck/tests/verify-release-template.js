#!/usr/bin/env node
/**
 * tests/verify-release-template.js — 发布 Runbook 与双入口模板的验收门禁
 *
 * 验收标准（来自 #355）：
 * - [ ] 存在一份带生效日期的发布 runbook 文档，以后所有发布议题首行即引用它，冲突时以更新日期者为准
 * - [x] 网页卡这一项**已在合并仓退役**（2026-10-16 · #66 裁决）：合并仓的发布入口是仓库根
 *       `.github/workflows/release.yml`（tag push / workflow_dispatch），不再走「GitHub 议题模板选择器」
 *       那套上游仪式；第 3 节因此改钉「退役是事实（卡确实不在）+ 发布入口在根 workflow」。
 * - [ ] 在对话中说“按发布规范发版 vX.Y.Z”可由 AI 代为创建同模板的发布议题，未给版本号时追问而非猜测
 * - [ ] 对话创建的议题正文与模板真源逐字一致且包含 8+4+2 清单（网页卡退役后只剩这一条入口）
 *
 * 用法：node tests/verify-release-template.js
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

console.log("verify-release-template — 发布 Runbook 与双入口模板门禁");
console.log("");

// 1. Runbook 存在性与生效日期
console.log("[1] Runbook 存在性与生效日期");
const runbookPath = resolve(ROOT, "docs/releases/RELEASE-RUNBOOK.md");
assert(existsSync(runbookPath), "docs/releases/RELEASE-RUNBOOK.md 存在");
let runbook = "";
if (existsSync(runbookPath)) {
  runbook = readFileSync(runbookPath, "utf8");
  assert(runbook.includes("生效日期：2026-08-31") || runbook.includes("生效日期: 2026-08-31"), "Runbook 包含生效日期 2026-08-31");
  assert(runbook.includes("以更新日期者为准"), "Runbook 声明“冲突时以更新日期者为准”");
  assert(runbook.includes("8 项对外展示清单"), "Runbook 锁死 8 项清单");
  assert(runbook.includes("语义化") || runbook.includes("语义化版本"), "Runbook 包含语义化口径");
  assert(runbook.includes("隔离门禁"), "Runbook 包含隔离门禁");
  assert(runbook.includes("文档同源") || runbook.includes("同源"), "Runbook 包含文档同源");
  assert(runbook.includes("无回滚") || runbook.includes("不回滚"), "Runbook 包含无回滚顺序");
} else {
  failures.push("Runbook 文件缺失，跳过内容检查");
}
console.log("");

// 2. 模板存在性与首行引用
console.log("[2] 发布议题模板存在性与首行引用");
const templatePath = resolve(ROOT, "docs/releases/release-issue-template.md");
assert(existsSync(templatePath), "docs/releases/release-issue-template.md 存在");
let template = "";
if (existsSync(templatePath)) {
  template = readFileSync(templatePath, "utf8");
  const firstLine = template.split("\n")[0] || "";
  assert(firstLine.includes("RELEASE-RUNBOOK.md"), "模板首行即引用 Runbook");
  assert(firstLine.includes("2026-08-31") || firstLine.includes("生效日期"), "模板首行包含生效日期");
  assert(firstLine.includes("以更新日期者为准"), "模板首行包含冲突规则");
  const checkboxCount = (template.match(/- \[ \] /g) || []).length;
  assert(checkboxCount === 14, `模板包含 8+4+2=14 个复选框（实际 ${checkboxCount}）`);
  assert(template.includes("8 项对外展示清单"), "模板包含 8 项清单分组");
  assert(template.includes("4 项隔离门禁"), "模板包含 4 项门禁分组");
  assert(template.includes("2 项发布验证"), "模板包含 2 项验证分组");
}
console.log("");

// 3. 发布入口：上游发布议题网页卡已退役（#66 裁决），发布入口在仓库根 workflow
console.log("[3] 发布入口（上游发布议题网页卡已退役 · #66）");
const ymlPath = resolve(ROOT, ".github/ISSUE_TEMPLATE/release.yml");
let yml = "";
assert(!existsSync(ymlPath), "上游那张发布网页卡不在本仓（退役是裁决，不是漏补）");
const rootWorkflowPath = resolve(ROOT, "..", ".github/workflows/release.yml");
assert(existsSync(rootWorkflowPath), "发布入口在仓库根 .github/workflows/release.yml");
if (existsSync(rootWorkflowPath)) {
  const wf = readFileSync(rootWorkflowPath, "utf8");
  assert(/tags:\s*\[[^\]]*'v\*'/.test(wf) || wf.includes("workflow_dispatch"), "根 workflow 以 tag / 手动 dispatch 发版");
  assert(!wf.includes("ISSUE_TEMPLATE/release.yml"), "根发布链里也不引用那张已退役的网页卡");
}
const rootConfigPath = resolve(ROOT, "..", ".github/ISSUE_TEMPLATE/config.yml");
assert(existsSync(rootConfigPath), "仓库根的议题模板 config.yml 仍在（网页卡退役不影响议题入口）");
console.log("");

// 4. 对话触发脚本
console.log("[4] 对话触发脚本（scripts/create-release-issue.mjs）");
const scriptPath = resolve(ROOT, "scripts/create-release-issue.mjs");
assert(existsSync(scriptPath), "scripts/create-release-issue.mjs 存在");
if (existsSync(scriptPath)) {
  const script = readFileSync(scriptPath, "utf8");
  assert(script.includes("按发布规范发版"), "脚本说明包含对话触发句式“按发布规范发版 vX.Y.Z”");
  assert(script.includes("release-issue-template.md"), "脚本读取模板真源");
  assert(script.includes("追问") || script.includes("未提供版本号"), "脚本在未给版本号时追问而非猜测");
  // 实际运行：缺失版本号应退出 2
  const miss = spawnSync("node", [scriptPath], { encoding: "utf8" });
  assert(miss.status === 2, "未给版本号时脚本退出码为 2（追问）");
  assert((miss.stderr + miss.stdout).includes("追问") || (miss.stderr + miss.stdout).includes("未提供版本号"), "缺失版本号时输出追问文案");
  // 正常版本应可 dry-run
  const dry = spawnSync("node", [scriptPath, "--dry-run", "v1.7.9"], { encoding: "utf8" });
  assert(dry.status === 0, "提供版本号时 dry-run 成功");
  assert(dry.stdout.includes("发布 v1.7.9"), "dry-run 输出标题为 发布 v1.7.9");
  assert(dry.stdout.includes("RELEASE-RUNBOOK.md"), "dry-run 正文首行引用 Runbook");
  assert(dry.stdout.includes("8 项对外展示清单"), "dry-run 包含 8 项清单");
  // 自动补 v 前缀
  const dry2 = spawnSync("node", [scriptPath, "--dry-run", "1.7.9"], { encoding: "utf8" });
  assert(dry2.status === 0 && dry2.stdout.includes("发布 v1.7.9"), "支持无 v 前缀的版本号，自动补全");
}
console.log("");

// 5. 单入口一致性（网页卡退役后只剩对话脚本这一条入口，正文须逐条来自模板真源）
console.log("[5] 单入口一致性（对话脚本 ↔ 模板真源）");
if (existsSync(templatePath) && existsSync(scriptPath)) {
  const dry = spawnSync("node", [scriptPath, "--dry-run", "v1.7.9"], { encoding: "utf8" });
  const dialogBody = dry.stdout.replace(/^=== 标题：.*===\n+/, "").replace(/\n--- dry-run：未创建议题 ---\s*$/, "").trim();
  const templateLabels = [...template.matchAll(/- \[ \] \d+\. (.+)/g)].map(m => m[1].trim());
  const dialogLabels = [...dialogBody.matchAll(/- \[ \] \d+\. (.+)/g)].map(m => m[1].trim());
  // 逐字比较前把「版本占位」归一：模板里是 vX.Y.Z，对话正文里已被替换成 v1.7.9（替换本身是脚本的职责）
  const normalize = s => s.replace(/^\d+\.\s*/, "").replace(/`/g, "").replace(/vX\.Y\.Z/g, "v<ver>").replace(/v1\.7\.9/g, "v<ver>").trim();
  assert(templateLabels.length === 14, `模板含 8+4+2=14 个复选框（实际 ${templateLabels.length}）`);
  assert(dialogLabels.length === 14, `对话正文含 14 个复选框（实际 ${dialogLabels.length}）`);
  const same = templateLabels.length === dialogLabels.length && templateLabels.every((v, i) => normalize(v) === normalize(dialogLabels[i]));
  assert(same, "对话正文的清单项与模板真源逐条一致");
  const dialogCheckboxCount = (dialogBody.match(/- \[ \] /g) || []).length;
  assert(dialogCheckboxCount === 14, `对话生成的正文包含 14 个复选框（实际 ${dialogCheckboxCount}）`);
  assert(dialogBody.includes("> 规范：[发布 Runbook"), "对话正文首行即引用 Runbook");
} else {
  assert(false, "单入口一致性检查跳过（前置文件缺失）");
}
console.log("");

// 汇总
console.log(`结果：${passes} 通过，${failures.length} 失败`);
if (failures.length > 0) {
  console.log("\n失败项：");
  failures.forEach(f => console.log("  - " + f));
  process.exit(1);
} else {
  console.log("\n全部通过 — Runbook 有效、对话可触发且未给版本时追问、对话正文与模板真源 8+4+2 逐条一致；网页卡一项已按 #66 裁决退役（发布入口改在仓库根 workflow）。");
}