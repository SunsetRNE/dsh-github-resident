# 合并收尾 · 界面与测试可信度（DeepSeek4.1 实施者）

> 本文件只记**我实际改的、实际跑过的、以及仍未验证的**。每条结论都对应一条可复现命令。
> 上一集成人未返回报告，但我**不重做**已落盘的三个模块（deck-bridge-shared / choice-hint-reject /
> merged-render 已存在），也**不把旧日志当最新结果**：下面所有数字都是本轮现跑的。

## 0. 接续范围（开始即记）

- 仓库：`/root/dsh-github-resident/dsh-github-resident`，分支 `feat/merge-skills-deck`，基线 `54a1a07`。
- 版本：根 `package.json` `1.7.0`（`private: true`），构建产物 `dist/client.js` 已由上一轮生成
  （`v1.7.0`，`const DSW_VERSION = 'v1.7.0'`，非 Deck 上游 `v1.8.0-rc.7`）——**版本已归位，不重做**。
- 我的 writeScopes（只写这些）：`tests/merge/client/**`、`tests/merge/build/merged-render.test.mjs`、
  `deck/tests/smoke-render.test.js`、`deck/tests/verify-slot-idempotency.js`、`deck/tests/verify-update-panel.js`、
  `deck/tests/verify-update-migration.js`、`deck/src/client/**`、`client.js`、`tools/merge/client-factory.ts`、
  `tools/merge/rewrite-deck-client.ts`、本文件。
- **不碰**：Host（`plugin.js`、`deck/src/host/**`）、`tools/merge/build-merge-entries.ts`、
  `package.json`、`cordis.patch.yml`、其他测试、公共产物 `dist/**`、`deck/package/**`；
  参考源仓 `/root/dsh-github-resident/dsh-mattpocock-skills-deck` 永久只读；不碰 DSH 安装、
  当前 profile、真实凭据、HOME、global git/gh、端口 31790；不安装/启停/发布/push。
- 测试只用临时存储、mock homedir、独立端口；证据日志落独占临时目录 `/tmp/dsh-ui-recover/`。

## 1. 本轮开始时实测到的真实红灯（旧日志不算）

命令与真实退出码（`/tmp/dsh-ui-recover/` 下有完整日志）：

| 命令 | 旧日志说法 | 本轮实测 |
|---|---|---|
| `node tests/merge/client/run.mjs` | 28/28 绿（`merge-work-client.md` M3） | **exit 1**：`tests 28 · pass 11 · fail 17` |
| `node tests/merge/build/merged-render.test.mjs` | 新测试已存在 | **崩溃**：`ReferenceError: window is not defined`（React DOM 在 Node 上下文渲染） |
| `cd deck && node tests/smoke-render.test.js` | `.merge-verify/02-smoke-render.log` 尾部「全部通过」 | **exit 0 但先打了 8 条 `FAIL`**（红字算绿） |
| `cd deck && node tests/verify-slot-idempotency.js` | — | exit 0（本轮复跑仍绿） |
| `cd deck && node tests/verify-update-panel.js` | — | exit 0；已断言新本地 ID |
| `cd deck && node tests/verify-update-migration.js` | — | exit 0；但夹具仍用旧 Deck ID |

三条根因（都在我的 writeScope 内）：

1. **A · 冒烟「红字算绿」**：`smoke-render.test.js` 的 `softRender()` 把失败计数回滚后只打 `WARN`；
   叶子直引段（`import('../src/client/views/ListTab.js')` 等）在没有构建拼接闭包时必然
   `DswsCtx is not defined`——这是**不完整闭包 eval 的假失败**，不是叶子真的坏了。
2. **B · 上一轮新加的版本改写让夹具过期**：`client-factory.ts` 新增 `rewriteVersionLiteral`（正确需求：
   合并包不许显示 Deck 上游版本），但 `tests/merge/client/harness.mjs` 的 Deck 夹具没带
   `const DSW_VERSION = '…'` 锚点 → 17 条连带失败。另外 `composeMergedClient` 在 `ensureNonEmpty`
   之前就做版本改写，缺输入时报的是 `TypeError` 而不是设计好的「源码缺失或为空」。
3. **C · 门禁夹具与新身份不一致**：`tests/merge/client/static-contract.test.mjs` 仍断言
   `pluginId: '@local/dsh-github-resident-v2'`，而客户端（已按更新包 `assertPluginId` 的要求）用的是
   去 scope 的本地标识 `dsh-github-resident-v2`（Host `UPDATE_PLUGIN_ID` 同值）；
   `deck/tests/verify-update-migration.js` 的电话夹具仍传旧 Deck ID。

## 2. 修法与结果

（随进度在本节追加；每条都写清「改了什么 / 命令 / 实测输出 / 退出码」。）

## 3. 仍未验证

- jsdom 不等于真机视觉，也不等于真实宽度扫描/深浅色与双语混排；本文件里的「真挂载」都只是
  jsdom + 桩宿主，**不是**真 Chromium 验收。
- 真实 tgz 包安装/升级与「必要保留数据的重装」属用户新增验收项，公开渠道未定，**本轮不动生产安装**。
