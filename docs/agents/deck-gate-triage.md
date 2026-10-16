# deck 门禁链存量红分流（issue #42）

> 只做「量 + 定性 + 落清单」：本次没有改任何门禁源码，没有建 issue，没有 commit/push。

## 怎么量的

- **日期 / 环境**：2026-10-15，容器内（Linux）。devDeps 已装齐，但**装在仓库根 `node_modules/`**（jsdom / react / react-dom / esbuild / typescript / typescript-ast / dsh-plugin-update / dsh-log / @deepseek-ai/dsh-tools 都在这里）；`deck/node_modules/` **根本不存在**（pnpm 提升布局）。
- **Chromium**：`~/.cache/ms-playwright/` 只有 `chromium-1208/chrome-linux/chrome`；门禁默认解析要 `chromium_headless_shell-1248`，不一致 → 所有真渲染门禁起不来。系统 Chrome（`/opt/google/chrome/chrome`）也没装。
- **重活租约**：先 `gh_load_lease {action:acquire, holder:"verify:deck@issue42", purpose:"#42 deck 链存量红分流"}` 拿到（2026-10-15T19:44:18Z，TTL 30min，pid 存活）；全程没跑 `tests/merge/run.mjs`、没跑 `npm run verify`；量完 release。
- **名单**：311 道，取自 `deck/package.json` → `scripts.verify`（`&&` 拆开后去掉 `node `），与 `deck/tests/verify-*.js` 派生一致。
- **逐道怎么跑**：驱动脚本 `/tmp/deck-gates-runner.mjs`，每道 `cd deck && timeout 65 node tests/<file>`（进程级 78s 兜底），**不遇到红就停**。
- **日志**：每道落 `/tmp/deck-gates/<name>.log`（`FILE/EXIT/DURATION` + 输出尾部 40 行 + 线索行），全量另存 `<name>.full.log`；`/tmp/deck-gates/progress.json` 是总账。
- **节奏**：每道之间 sleep 0.2s；逐道读 `/proc/meminfo` 的 MemAvailable，全程在 9.4–10.4 GB，从未低于 1.5 GB 阈值，无需等待。

## 总量表

| 项 | 数 |
| --- | --- |
| 门禁总数（scripts.verify） | 311 |
| 绿 | 221 |
| 红 | 90 |
| 红 · 环境依赖 | 27 |
| 红 · 真漂移 | 60 |
| 红 · 待定 | 3 |

对比 2026-10-14 基线（口径：跳过 5 道浏览器依赖后的 299 道 214 绿 / 85 红）：本轮 311 道全跑，绿 221 / 红 90。**两者口径不同，不能直接相减**（本轮把 15 道真渲染门禁全部计入红）；但可以定性说：当年那批「环境依赖红」确实没消失（Chromium 仍缺），而今天 90 道红里有 60 道能定位到具体的「源码/门禁对不上」，占三分之二 —— 存量红的主体已经从环境问题变成了门禁欠账。

> 说明：名字带 `-browser.js` 的只有 5 道（423-title-clamp / 640-dock-width / 997-vc-sight / bar-scroll / cap-fold），但实测**要真渲染的共 15 道**（另有 10 道没这个后缀）；另有 2 道要系统 Chrome 通道。

## 红名单表

### 环境依赖（27）

| 门禁文件 | 类别 | 一行理由 | 关键证据 |
| --- | --- | --- | --- |
| `deck/tests/verify-423-title-clamp-browser.js` | 环境依赖（缺 Chromium） | playwright 默认解析找不到浏览器：本机只有 chromium-1208，门禁要 chromium_headless_shell-1248 | browserType.launch: Executable doesn't exist at ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell（补：npx playwright install chromium；或把 tests/lib/chromium-channel.js 的候选指向 ~/.cache/ms-playwright/chromium-1208/chrome-linux/chrome + --disable-dev-shm-usage） |
| `deck/tests/verify-640-dock-width-browser.js` | 环境依赖（缺 Chromium） | 同上，且本门禁自己的候选表已实测写出「本机可用通道」 | Error: 真渲染通道起不来…Executable doesn't exist…（本机可用通道（实测）：~/.cache/ms-playwright/chromium-1208/chrome-linux/chrome + --disable-dev-shm-usage） |
| `deck/tests/verify-667-dock-header-no-brand.js` | 环境依赖（缺 Chromium） | 直连 playwright 起 chromium，版本对不上 | browserType.launch: Executable doesn't exist at …/chromium_headless_shell-1248/… |
| `deck/tests/verify-669-collapsed-recoverable.js` | 环境依赖（缺 Chromium） | 同上 | browserType.launch: Executable doesn't exist at …/chromium_headless_shell-1248/… |
| `deck/tests/verify-670-panel-first-frame.js` | 环境依赖（缺 Chromium） | 同上 | browserType.launch: Executable doesn't exist at …/chromium_headless_shell-1248/… |
| `deck/tests/verify-958-label-name-visible.js` | 环境依赖（缺 Chromium） | 同上 | browserType.launch: Executable doesn't exist at …/chromium_headless_shell-1248/… |
| `deck/tests/verify-997-vc-sight-browser.js` | 环境依赖（缺 Chromium） | 门禁把它记成「门禁自身抛错」，根因仍是缺浏览器 | FAIL 门禁自身抛错：browserType.launch: Executable doesn't exist at …/chromium_headless_shell-1248/… |
| `deck/tests/verify-chain-view-ui.js` | 环境依赖（缺 Chromium） | 同上 | browserType.launch: Executable doesn't exist at …/chromium_headless_shell-1248/… |
| `deck/tests/verify-banner-narrow.js` | 环境依赖（缺 Chromium） | 走 tests/lib/chromium-channel.js，候选 0 个 | Error: 真渲染通道起不来，试过 1 个候选：…Executable doesn't exist…（本机可用通道（实测）：chromium-1208/…） |
| `deck/tests/verify-bar-scroll-browser.js` | 环境依赖（缺 Chromium） | 同上 | Error: 真渲染通道起不来…Executable doesn't exist… |
| `deck/tests/verify-cap-fold-browser.js` | 环境依赖（缺 Chromium） | 同上 | Error: 真渲染通道起不来…Executable doesn't exist… |
| `deck/tests/verify-cap-fold.js` | 环境依赖（缺 Chromium） | 名字不带 -browser，但同样要真渲染通道 | Error: 真渲染通道起不来…Executable doesn't exist… |
| `deck/tests/verify-capsule-layout.js` | 环境依赖（缺 Chromium） | 同上 | Error: 真渲染通道起不来…Executable doesn't exist… |
| `deck/tests/verify-issue22-ui.js` | 环境依赖（缺系统 Chrome） | 要 Chromium 通道 'chrome'，本机没装 /opt/google/chrome/chrome | browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome（补：装系统 Chrome 或 npx playwright install chrome） |
| `deck/tests/verify-t2-repokey-ui.js` | 环境依赖（缺系统 Chrome） | 同上 | SCRIPT ERROR browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome |
| `deck/tests/verify-587-update-live.js` | 环境依赖（依赖安装位置） | 找「装在本机使用范围里、且包完好的」dsh-plugin-update；该包只在仓库根 node_modules，deck 侧解析不到 | FAIL 找得到装在本机使用范围里、且包完好的那份插件（真宿主判据的输入） |
| `deck/tests/verify-587-update-restart.js` | 环境依赖（依赖安装位置） | 读 deck/node_modules/dsh-plugin-update/dist/reader.js；文件实际在仓库根 node_modules | ENOENT: no such file or directory, open '…/deck/node_modules/dsh-plugin-update/dist/reader.js' |
| `deck/tests/verify-731-resident.js` | 环境依赖（依赖安装位置） | 读 deck/node_modules/dsh-log/dist/store.js；实际在仓库根 | ENOENT: …/deck/node_modules/dsh-log/dist/store.js |
| `deck/tests/verify-update-migration.js` | 环境依赖（依赖安装位置） | 读 deck/node_modules/dsh-plugin-update/package.json；实际在仓库根 | 门禁异常：ENOENT: …/deck/node_modules/dsh-plugin-update/package.json |
| `deck/tests/verify-update-mirror-hint.js` | 环境依赖（依赖安装位置） | 读 deck/node_modules/dsh-plugin-update/dist/commands.js；实际在仓库根 | FAIL ENOENT: …/deck/node_modules/dsh-plugin-update/dist/commands.js |
| `deck/tests/verify-update-panel.js` | 环境依赖（依赖安装位置） | 同上 | 门禁执行异常：ENOENT: …/deck/node_modules/dsh-plugin-update/package.json |
| `deck/tests/verify-deck-tools-agent-register.js` | 环境依赖（依赖安装位置） | import deck/node_modules/@deepseek-ai/dsh-tools/lib/index.js；实际在仓库根 | ERR_MODULE_NOT_FOUND: Cannot find module '…/deck/node_modules/@deepseek-ai/dsh-tools/lib/index.js' |
| `deck/tests/verify-deck-tools-row-zero-dep.js` | 环境依赖（依赖安装位置） | imp('node_modules/@deepseek-ai/dsh-tools/lib/index.js')（ROOT=deck），deck/node_modules 不存在 | FAIL 真原生判定可加载（开发依赖与线上同版本） |
| `deck/tests/verify-config-store-freshness.js` | 环境依赖（依赖安装位置） | 门禁按 ROOT(=deck)/node_modules/typescript/bin/tsc 找；typescript 只在仓库根 | FAIL typescript 已安装（node_modules/typescript 缺失，请跑 pnpm install） |
| `deck/tests/verify-label-color-freshness.js` | 环境依赖（依赖安装位置） | 同上 | FAIL typescript 已安装（node_modules/typescript 缺失，请跑 pnpm install） |
| `deck/tests/verify-refresh-freshness.js` | 环境依赖（依赖安装位置） | 同上 | FAIL typescript 已安装（node_modules/typescript 缺失，请跑 pnpm install） |
| `deck/tests/verify-version-control-freshness.js` | 环境依赖（依赖安装位置） | 同上 | FAIL typescript 已安装（node_modules/typescript 缺失，请跑 pnpm install） |

**环境类怎么补 / 怎么跳过**

- **缺 Chromium（13 道 + 2 道走 `chromium-channel.js` 的）**：补法是 `npx playwright install chromium`（装 `chromium_headless_shell-1248`）。不想下载就走本机已有那份：`tests/lib/chromium-channel.js` 的候选表加一条 `~/.cache/ms-playwright/chromium-1208/chrome-linux/chrome` + `--disable-dev-shm-usage`（640/banner/bar-scroll/cap-fold/capsule 几道自己已经把这条实测写进错误里了）。本次**没下 Chromium**（重活，超出本任务）。
- **缺系统 Chrome（2 道：issue22-ui / t2-repokey-ui）**：要 `chromium` 通道 `chrome`，即 `/opt/google/chrome/chrome`。补法是装系统 Chrome，或 `npx playwright install chrome`；跳过条件写成「无 chrome 通道即 skip 且不计红」。
- **依赖安装位置（12 道）**：门禁按 `deck/node_modules/...` 找包/构建产物，而依赖被提升到了仓库根 `node_modules/`。补法是二选一：① 在 `deck/` 下 `pnpm install`（造出 deck 局部 `node_modules`）；② 把门禁改成按 Node 解析（`import.meta.resolve` / 从 `deck/` 向上找），而不是硬拼 `path.join(ROOT,'node_modules',...)`。跳过条件：`deck/node_modules` 不存在时这 12 道应显式 skip，不要算红。

### 真漂移（60）

| 门禁文件 | 类别 | 一行理由 | 关键证据 |
| --- | --- | --- | --- |
| `deck/tests/verify-927-gate-injection.js` | 真漂移 | 门禁直连 createPlatformChannel 时没传新依赖 identityEnvFor；平台层出站 exec 现在必须经它取身份 env（platformChannel.js:256 无条件调用），夹具第 64 行触雷 | 断言「③ 真件：闸晚一步就位也接得上」→ exec spawn failed: identityEnvFor is not a function |
| `deck/tests/verify-log-exec-606.js` | 真漂移 | 同一构造缺 identityEnvFor（platformChannel.js:256） | 断言「经 ctx.exec 起的外部命令留计数与耗时」→ 门禁执行异常：Error: exec spawn failed: identityEnvFor is not a function |
| `deck/tests/verify-963-log-order.js` | 真漂移 | 同一构造缺 identityEnvFor，超时分档三条断言随之全空 | 断言「探活超时归网络档（未知稍后，不说没登录）」→ {"ok":false,"kind":"spawn","error":"identityEnvFor is not a function"} |
| `deck/tests/verify-deck-tools.js` | 真漂移 | 门禁自建 deps 未注入 decideBackend；#1003 单出口后它是 shell.pickBackend 的必需依赖，缺了如实回 unsupported（shell.js:179） | 断言「deck_context 正例：回 ok」→ 实得 unsupported |
| `deck/tests/verify-deck-no-hang.js` | 真漂移 | 同上（deps 无 decideBackend） | 断言「超时判成可重试的执行失败」→ 实得「判定出口这次没装上，我没往下做…」 |
| `deck/tests/verify-deck-tools-matrix.js` | 真漂移 | 同上（deps 无 decideBackend） | 断言「[github] 建票：回 ok」→ 实得 unsupported；reason=判定出口这次没装上… |
| `deck/tests/verify-790-parent-edge.js` | 真漂移 | 同上（deps 无 decideBackend，工具在选后端这步就退） | 断言「E1 票建成、边没挂上 → partial」→ 实得 unsupported |
| `deck/tests/verify-829-parent-reread.js` | 真漂移 | 同上（deps 无 decideBackend） | 断言「G3 写成功但读票失败 → 逐条 failed」→ 实得 undefined |
| `deck/tests/verify-895-bulk-deadline.js` | 真漂移 | 同上（deps 无 decideBackend） | 断言「预算打满 → 部分成功」→ 实得 unsupported |
| `deck/tests/verify-898-block-merge.js` | 真漂移 | 同上（deps 无 decideBackend） | 断言「A1 两条阻塞边明细都成功」→ 实得 [] |
| `deck/tests/verify-929-batch-cycle.js` | 真漂移 | 同上（deps 无 decideBackend） | 断言「③ 两条不相干且不成环的边都建成」→ 实得 status=unsupported [] |
| `deck/tests/verify-971-markdown-parent.js` | 真漂移 | 同上（deps 无 decideBackend） | 断言「快照回 ok」→ 实得 unsupported |
| `deck/tests/verify-992-readonly-labels.js` | 真漂移 | 同上（deps 无 decideBackend） | 断言「E1 标签没挂上 → partial」→ 实得 unsupported |
| `deck/tests/verify-784-effortId.js` | 真漂移 | 同上（deps 无 decideBackend） | 断言「读票 alpha 落在 alpha」→ 实得落空（工具回 unsupported） |
| `deck/tests/verify-deck-thin-reads.js` | 真漂移 | 同上（工具回 unsupported，没有 relations 可读） | 断言「缺省取反向边（调了依赖接口）」→ 门禁抛错：TypeError: Cannot read properties of undefined (reading 'relations') |
| `deck/tests/verify-deck-parallel.js` | 真漂移 | 同上（deps 无 decideBackend） | 断言「同票并发改标签两笔都成」→ 实得 unsupported/unsupported |
| `deck/tests/verify-panel.js` | 真漂移 | 宿主 apply 已改成经 ctx.inject/bootBody 内自建 harness + dswEndpoints 交付电话表，入参 harness 被遮蔽；门禁仍按入参 harness.handle 捕获 → handlers=0（探针复现） | 断言「快照 ok + repo 解析」→ SCRIPT ERROR TypeError: h.wf.refresh is not a function |
| `deck/tests/verify-detail-fog.js` | 真漂移 | 同 verify-panel | 断言「折叠雾化详情」→ ERROR TypeError: h.wf.refresh is not a function |
| `deck/tests/verify-detail-levels.js` | 真漂移 | 同 verify-panel | 断言「详情分级」→ ERROR TypeError: h.wf.refresh is not a function |
| `deck/tests/verify-496b-inject-guard.js` | 真漂移 | 这三处日志点确不在现实现里（或已改名） | 断言「决策/执行/补发三处日志」→ 实 0 |
| `deck/tests/verify-656-subworkspace-acceptance.js` | 真漂移 | 工作区根解析把 d:\ 判成了 relative，不变式当场破 | 断言「盘符根与 UNC 共享根都是上溯的终点：到顶就停」→ drive={"root":"d:\\","source":"relative"} unc={"root":"//srv/share","source":"self"} |
| `deck/tests/verify-666-subws-mark-root.js` | 真漂移 | 路径归一没做大小写无关比较 | 断言「C10 大小写与斜杠写法不同，仍然算在根下面，照样切出干净尾巴」→ relOf('D:\\ilife','d:/ILIFE/packages/skill-calorie') 切不出来 |
| `deck/tests/verify-669-switch-visible.js` | 真漂移 | 产物里已没有 data-repo-switch 这个钩子，门禁选择器过期 | 断言「等 [data-repo-switch] 出现再点」→ 崩了 TypeError: Cannot read properties of null (reading 'dispatchEvent')（60 轮没等到） |
| `deck/tests/verify-671-modal-global-overlay.js` | 真漂移 | 门禁从产物文本里切的组件段落与现产物对不上 | 断言「座位里按「卡开着」分派到那张卡」→ FAIL 从产物里抽到了弹窗组件那一段；B 组跑不起来：FormModalContent is not defined |
| `deck/tests/verify-698-switch-asks-layout.js` | 真漂移 | 判据单源被破坏：客户端多了一处实现 | 断言「弹窗座位按「卡开着」分派到它；客户端里没有第二处在抄这个判据」→ 实得 1 处：src/client/kernel/prompts-setup.js |
| `deck/tests/verify-709-no-self-continuing-timers.js` | 真漂移 | 评估轮里一条 REST 都没发，门禁与实现口径不一致 | 断言「一次评估的 REST 条数 = 3（票面口径：5 条降到 3 条）」→ 实得 0 条：[] |
| `deck/tests/verify-842-version-control-write-view.js` | 真漂移 | 门禁自身在 ESM 里用 require（门禁缺陷，非源码漂移） | 断言「版本管理写操作界面 A–M 组」→ ReferenceError: require is not defined（脚本 1183 行） |
| `deck/tests/verify-926-capfold-gate.js` | 真漂移 | 折叠档位换代没接进新机器 | 断言「换代从旧档起步（flex 写 72 次，至多两次放下判断）」→ 仍写 72 次 |
| `deck/tests/verify-b3-done-color.js` | 真漂移 | 门禁的产物文本切片过期 | 断言「client.js 列表行动作组块（完成+新会话）提取成功」→ FAIL（client.js 与 package/lib/client.js 双缺） |
| `deck/tests/verify-b5-quota.js` | 真漂移 | 实现里确实没有这两点 | 断言「host.js probe 返回 repo 字段；buildSnapshot 透传 fallback 标记」→ FAIL（host.js 与 package/lib/index.js 双缺） |
| `deck/tests/verify-bug-366-refresh.js` | 真漂移 | #366 的旁路与去重没落到 host | 断言「probe dedup distinguishes force；host contains #366 bypass」→ FAIL（host 里找不到 #366 绕过；disk cache check 出现 0 次） |
| `deck/tests/verify-chain-renderer.js` | 真漂移 | 源码里这四处确实不在（静态文本判据） | 断言「host chain 使用 resolveGenericChain；ChainForm 含 required 校验；host chain 注册通用谓词；ghAuthLogin 含 gh auth login 文案」→ 65 项 4 红 |
| `deck/tests/verify-config-store-package.js` | 真漂移 | 根 package.json 没有 yaml 依赖 | 断言「仓库 package.json 生产依赖里有 yaml」→ 实得 undefined（两处版本比对 undefined / ^2.9.1） |
| `deck/tests/verify-delta-patch.js` | 真漂移 | 门禁 import 的旧路径已搬家：模块现住 deck/src/shared/tracker/indexWindow.js | 断言「（import 期就断）」→ ERR_MODULE_NOT_FOUND: …/deck/src/tracker/indexWindow.js |
| `deck/tests/verify-file-granularity.js` | 真漂移 | 文件粒度红线被真实突破 | 断言「新增超标：381 行（上限 350）等」→ src/host/index.js 381、src/host/updateFromPackage.js 385、src/host/platformChannel.js 356 等 5 个文件超标 |
| `deck/tests/verify-gate-dialect.js` | 真漂移 | ESM 产物里残留 require() | 断言「仍有欠账文件」→ FAIL ② 仍有 1 个欠账文件：src/client/kernel/portal.js[require()] |
| `deck/tests/verify-handoff-latest-sort.js` | 真漂移 | 交接时间解析的助手指令在产物里找不到 | 断言「parseHandoffMtime helper 定义（dyn 与 npm 双产物）」→ FAIL ×2 |
| `deck/tests/verify-issue-comment.js` | 真漂移 | 门禁自身引用了未定义标识符 idOf（门禁缺陷） | 断言「只读提示条件化 / updatedAt bump 闪烁数据源」→ #255 四缝验证失败；（diff 求值异常: idOf is not defined） |
| `deck/tests/verify-issue179-workspace-switch.js` | 真漂移 | #179 的兜底被 #1003 改造带走了 | 断言「非判定电话保留 DEFAULT_CWD 兜底；host.js 保留 DEFAULT_CWD 兜底」→ FAIL ×2 |
| `deck/tests/verify-issue212-213-214.js` | 真漂移 | #212/#213/#214 的三条不变式在实现里已不成立 | 断言「#214 buildSnapshot must define let backendModules = null；#213 probe must invalidate cache on changed」→ FAIL ×4 |
| `deck/tests/verify-issue58-cache-first.js` | 真漂移 | 缓存优先改造没落进产物 | 断言「loadSnapshot 拆 doLoad；openPagePanel 三分支；probeNow 按 cwd 归一键分组隔离」→ FAIL（client.js 与 package/lib/client.js 双缺） |
| `deck/tests/verify-leaves.js` | 真漂移 | 冻结基线被突破 55 行 | 断言「src/client/statusbar/StatusBar.js ≤359 行（零增长基线冻结值）」→ 实际 414 |
| `deck/tests/verify-log-coverage.js` | 真漂移 | 日志电话注册表与实现清单对不上 | 断言「注册总数恰为现役数；清单里没有 wf.pluginIdentity」→ 实得 56；wf.updateStatus/updateCheck/updateInstall 没有方法可识行 |
| `deck/tests/verify-log-fields.js` | 真漂移 | 埋点事件名与附录白名单不同步 | 断言「事件有埋点落点 update.install.exec（全仓未找到）」→ FAIL；另有未知事件 identity.migrate |
| `deck/tests/verify-log-switch-597.js` | 真漂移 | 配置页调试开关的提示分类整段取不到 | 断言「超时/未知端点/没接上宿主的提示都要分类」→ 实际全部取到「」（9 项红） |
| `deck/tests/verify-map-subissues-352.js` | 真漂移 | 已知真漂移：prompts.js 未做 v14 解耦 | 断言「PROMPTS version 14」→ FAIL: prompts.js 未满足 352 v14 解耦要求 |
| `deck/tests/verify-markdown.js` | 真漂移 | 被测源码引用了 Tip，门禁求值探针只喂了 h，没给 Tip 桩 | 断言「mdToHtml 里 inlineWith 走 Tip 分支」→ ReferenceError: Tip is not defined（mdInline → Tip） |
| `deck/tests/verify-market-tarball.js` | 真漂移 | 工作流文件不在仓库 | 断言「.github/workflows/release-tarball.yml 存在；workflow 里的资产名 NAME 等于包名」→ ✗ ×2（文件不存在） |
| `deck/tests/verify-naming-isolation-315.js` | 真漂移 | #315 的宽限与裸档保留规则未落实现 | 断言「A 未过宽限且无 hint 不产单；无 hint 冲突时裸档保留」→ 23 checks, some failed |
| `deck/tests/verify-probe-since.js` | 真漂移 | 探测基线推进的代码确实不在产物里 | 断言「probe 每轮记录 lastProbeAtByRepo 探测时间；删除/状态变化时失效内存快照缓存」→ FAIL（src 与 package 双产物） |
| `deck/tests/verify-readme-sync.js` | 真漂移 | 生成物过期（改根 README 后没跑 scripts/build.mjs） | 断言「发布目录 README.md 与源头一致」→ 差异字节数=104 |
| `deck/tests/verify-refresh-414.js` | 真漂移 | #414 的 isForce 守卫在 host 里找不到 | 断言「src host 含 isForce；wf.snapshot 受 isForce 守卫；pkg host 含 isForce」→ FAIL ×3 |
| `deck/tests/verify-release-contract.js` | 真漂移 | CHANGELOG/产物版本落后于目标版本 | 断言「CHANGELOG 最新节版本 == 目标 v1.8.0-rc.13；构建产物含版本注入」→ 实际 v1.7.1（并本轮 65s 超时被杀） |
| `deck/tests/verify-release-template.js` | 真漂移 | 发布模板文件不在仓库 | 断言「.github/ISSUE_TEMPLATE/release.yml 存在」→ ✗（前置文件缺失，双入口一致性检查跳过） |
| `deck/tests/verify-repo-jump.js` | 真漂移 | 仓库 URL 注入占位没落进产物 | 断言「index 注入占位声明；pkg/dev 产物注入仓库 URL」→ FAIL（19/22） |
| `deck/tests/verify-skill-probe-redcard-and-waiting.js` | 真漂移 | 红牌/等待链的常量与分支不在实现里（末段夹具也抛错） | 断言「src/host/index.js 含 SKILL_PENDING_MAX 等 5 条」→ FAIL；另有 TypeError: dispatch is not a function |
| `deck/tests/verify-strict-module-syntax.js` | 真漂移 | 源码里有模块顶层 return | 断言「src/client/panelAssembly.js 严格解析」→ Transform failed：<stdin>:209:4 Top-level return cannot be used inside an ECMAScript module |
| `deck/tests/verify-t1-getrepokey.js` | 真漂移 | 上游降级路径不再生效 | 断言「场景4 snapshot.repo 降级到 gh mock（upstream）」→ 实得 null |
| `deck/tests/verify-t14-detail-badge.js` | 真漂移 | T14 徽章渲染块在产物里切片失败 | 断言「client.js / package/lib/client.js 提取 T14 渲染块成功」→ FAIL ×2 |
| `deck/tests/verify-tabs-narrow.js` | 真漂移 | tabsRef 的使用点数量与判据不符 | 断言「tabsRef 出现 2 次（dock + overlay）」→ FAIL（dyn 与 npm 双产物） |

### 待定（3）

| 门禁文件 | 类别 | 一行理由 | 关键证据 |
| --- | --- | --- | --- |
| `deck/tests/verify-839-credential-exec.js` | 待定 | 65s 上限被杀；被杀前 13 项全 PASS，没有失败断言 | 输出尾部停在「⑥ 总预算用完：下一步直接 budget-exhausted」，疑似末尾用例挂住未返回 |
| `deck/tests/verify-wire-subissues-script.js` | 待定 | 65s 上限被杀；被杀前 17.x 全 PASS，没有失败断言 | 输出停在 17.5d，疑似后面某场景挂住 |
| `deck/tests/verify-bundled-discovery.js` | 待定 | 103 项只此 1 红：[FAIL] host apply 已调用 registerProvider（mock 捕获） | 未定位：可能是宿主装配（bootBody 经 ctx.inject/dswEndpoints）与夹具 mockCtx 不匹配，也可能是 400ms 等待窗口不够；证据不足以归前两类 |

## 真漂移逐条

每条：文件 / 断言原话 / 实得 / 初步根因猜测。

1. **`deck/tests/verify-927-gate-injection.js`**
   - 断言原话：「③ 真件：闸晚一步就位也接得上」
   - 实得：exec spawn failed: identityEnvFor is not a function
   - 初步根因猜测：门禁直连 createPlatformChannel 时没传新依赖 identityEnvFor；平台层出站 exec 现在必须经它取身份 env（platformChannel.js:256 无条件调用），夹具第 64 行触雷
2. **`deck/tests/verify-log-exec-606.js`**
   - 断言原话：「经 ctx.exec 起的外部命令留计数与耗时」
   - 实得：门禁执行异常：Error: exec spawn failed: identityEnvFor is not a function
   - 初步根因猜测：同一构造缺 identityEnvFor（platformChannel.js:256）
3. **`deck/tests/verify-963-log-order.js`**
   - 断言原话：「探活超时归网络档（未知稍后，不说没登录）」
   - 实得：{"ok":false,"kind":"spawn","error":"identityEnvFor is not a function"}
   - 初步根因猜测：同一构造缺 identityEnvFor，超时分档三条断言随之全空
4. **`deck/tests/verify-deck-tools.js`**
   - 断言原话：「deck_context 正例：回 ok」
   - 实得：实得 unsupported
   - 初步根因猜测：门禁自建 deps 未注入 decideBackend；#1003 单出口后它是 shell.pickBackend 的必需依赖，缺了如实回 unsupported（shell.js:179）
5. **`deck/tests/verify-deck-no-hang.js`**
   - 断言原话：「超时判成可重试的执行失败」
   - 实得：实得「判定出口这次没装上，我没往下做…」
   - 初步根因猜测：同上（deps 无 decideBackend）
6. **`deck/tests/verify-deck-tools-matrix.js`**
   - 断言原话：「[github] 建票：回 ok」
   - 实得：实得 unsupported；reason=判定出口这次没装上…
   - 初步根因猜测：同上（deps 无 decideBackend）
7. **`deck/tests/verify-790-parent-edge.js`**
   - 断言原话：「E1 票建成、边没挂上 → partial」
   - 实得：实得 unsupported
   - 初步根因猜测：同上（deps 无 decideBackend，工具在选后端这步就退）
8. **`deck/tests/verify-829-parent-reread.js`**
   - 断言原话：「G3 写成功但读票失败 → 逐条 failed」
   - 实得：实得 undefined
   - 初步根因猜测：同上（deps 无 decideBackend）
9. **`deck/tests/verify-895-bulk-deadline.js`**
   - 断言原话：「预算打满 → 部分成功」
   - 实得：实得 unsupported
   - 初步根因猜测：同上（deps 无 decideBackend）
10. **`deck/tests/verify-898-block-merge.js`**
   - 断言原话：「A1 两条阻塞边明细都成功」
   - 实得：实得 []
   - 初步根因猜测：同上（deps 无 decideBackend）
11. **`deck/tests/verify-929-batch-cycle.js`**
   - 断言原话：「③ 两条不相干且不成环的边都建成」
   - 实得：实得 status=unsupported []
   - 初步根因猜测：同上（deps 无 decideBackend）
12. **`deck/tests/verify-971-markdown-parent.js`**
   - 断言原话：「快照回 ok」
   - 实得：实得 unsupported
   - 初步根因猜测：同上（deps 无 decideBackend）
13. **`deck/tests/verify-992-readonly-labels.js`**
   - 断言原话：「E1 标签没挂上 → partial」
   - 实得：实得 unsupported
   - 初步根因猜测：同上（deps 无 decideBackend）
14. **`deck/tests/verify-784-effortId.js`**
   - 断言原话：「读票 alpha 落在 alpha」
   - 实得：实得落空（工具回 unsupported）
   - 初步根因猜测：同上（deps 无 decideBackend）
15. **`deck/tests/verify-deck-thin-reads.js`**
   - 断言原话：「缺省取反向边（调了依赖接口）」
   - 实得：门禁抛错：TypeError: Cannot read properties of undefined (reading 'relations')
   - 初步根因猜测：同上（工具回 unsupported，没有 relations 可读）
16. **`deck/tests/verify-deck-parallel.js`**
   - 断言原话：「同票并发改标签两笔都成」
   - 实得：实得 unsupported/unsupported
   - 初步根因猜测：同上（deps 无 decideBackend）
17. **`deck/tests/verify-panel.js`**
   - 断言原话：「快照 ok + repo 解析」
   - 实得：SCRIPT ERROR TypeError: h.wf.refresh is not a function
   - 初步根因猜测：宿主 apply 已改成经 ctx.inject/bootBody 内自建 harness + dswEndpoints 交付电话表，入参 harness 被遮蔽；门禁仍按入参 harness.handle 捕获 → handlers=0（探针复现）
18. **`deck/tests/verify-detail-fog.js`**
   - 断言原话：「折叠雾化详情」
   - 实得：ERROR TypeError: h.wf.refresh is not a function
   - 初步根因猜测：同 verify-panel
19. **`deck/tests/verify-detail-levels.js`**
   - 断言原话：「详情分级」
   - 实得：ERROR TypeError: h.wf.refresh is not a function
   - 初步根因猜测：同 verify-panel
20. **`deck/tests/verify-496b-inject-guard.js`**
   - 断言原话：「决策/执行/补发三处日志」
   - 实得：实 0
   - 初步根因猜测：这三处日志点确不在现实现里（或已改名）
21. **`deck/tests/verify-656-subworkspace-acceptance.js`**
   - 断言原话：「盘符根与 UNC 共享根都是上溯的终点：到顶就停」
   - 实得：drive={"root":"d:\\","source":"relative"} unc={"root":"//srv/share","source":"self"}
   - 初步根因猜测：工作区根解析把 d:\ 判成了 relative，不变式当场破
22. **`deck/tests/verify-666-subws-mark-root.js`**
   - 断言原话：「C10 大小写与斜杠写法不同，仍然算在根下面，照样切出干净尾巴」
   - 实得：relOf('D:\\ilife','d:/ILIFE/packages/skill-calorie') 切不出来
   - 初步根因猜测：路径归一没做大小写无关比较
23. **`deck/tests/verify-669-switch-visible.js`**
   - 断言原话：「等 [data-repo-switch] 出现再点」
   - 实得：崩了 TypeError: Cannot read properties of null (reading 'dispatchEvent')（60 轮没等到）
   - 初步根因猜测：产物里已没有 data-repo-switch 这个钩子，门禁选择器过期
24. **`deck/tests/verify-671-modal-global-overlay.js`**
   - 断言原话：「座位里按「卡开着」分派到那张卡」
   - 实得：FAIL 从产物里抽到了弹窗组件那一段；B 组跑不起来：FormModalContent is not defined
   - 初步根因猜测：门禁从产物文本里切的组件段落与现产物对不上
25. **`deck/tests/verify-698-switch-asks-layout.js`**
   - 断言原话：「弹窗座位按「卡开着」分派到它；客户端里没有第二处在抄这个判据」
   - 实得：实得 1 处：src/client/kernel/prompts-setup.js
   - 初步根因猜测：判据单源被破坏：客户端多了一处实现
26. **`deck/tests/verify-709-no-self-continuing-timers.js`**
   - 断言原话：「一次评估的 REST 条数 = 3（票面口径：5 条降到 3 条）」
   - 实得：实得 0 条：[]
   - 初步根因猜测：评估轮里一条 REST 都没发，门禁与实现口径不一致
27. **`deck/tests/verify-842-version-control-write-view.js`**
   - 断言原话：「版本管理写操作界面 A–M 组」
   - 实得：ReferenceError: require is not defined（脚本 1183 行）
   - 初步根因猜测：门禁自身在 ESM 里用 require（门禁缺陷，非源码漂移）
28. **`deck/tests/verify-926-capfold-gate.js`**
   - 断言原话：「换代从旧档起步（flex 写 72 次，至多两次放下判断）」
   - 实得：仍写 72 次
   - 初步根因猜测：折叠档位换代没接进新机器
29. **`deck/tests/verify-b3-done-color.js`**
   - 断言原话：「client.js 列表行动作组块（完成+新会话）提取成功」
   - 实得：FAIL（client.js 与 package/lib/client.js 双缺）
   - 初步根因猜测：门禁的产物文本切片过期
30. **`deck/tests/verify-b5-quota.js`**
   - 断言原话：「host.js probe 返回 repo 字段；buildSnapshot 透传 fallback 标记」
   - 实得：FAIL（host.js 与 package/lib/index.js 双缺）
   - 初步根因猜测：实现里确实没有这两点
31. **`deck/tests/verify-bug-366-refresh.js`**
   - 断言原话：「probe dedup distinguishes force；host contains #366 bypass」
   - 实得：FAIL（host 里找不到 #366 绕过；disk cache check 出现 0 次）
   - 初步根因猜测：#366 的旁路与去重没落到 host
32. **`deck/tests/verify-chain-renderer.js`**
   - 断言原话：「host chain 使用 resolveGenericChain；ChainForm 含 required 校验；host chain 注册通用谓词；ghAuthLogin 含 gh auth login 文案」
   - 实得：65 项 4 红
   - 初步根因猜测：源码里这四处确实不在（静态文本判据）
33. **`deck/tests/verify-config-store-package.js`**
   - 断言原话：「仓库 package.json 生产依赖里有 yaml」
   - 实得：实得 undefined（两处版本比对 undefined / ^2.9.1）
   - 初步根因猜测：根 package.json 没有 yaml 依赖
34. **`deck/tests/verify-delta-patch.js`**
   - 断言原话：「（import 期就断）」
   - 实得：ERR_MODULE_NOT_FOUND: …/deck/src/tracker/indexWindow.js
   - 初步根因猜测：门禁 import 的旧路径已搬家：模块现住 deck/src/shared/tracker/indexWindow.js
35. **`deck/tests/verify-file-granularity.js`**
   - 断言原话：「新增超标：381 行（上限 350）等」
   - 实得：src/host/index.js 381、src/host/updateFromPackage.js 385、src/host/platformChannel.js 356 等 5 个文件超标
   - 初步根因猜测：文件粒度红线被真实突破
36. **`deck/tests/verify-gate-dialect.js`**
   - 断言原话：「仍有欠账文件」
   - 实得：FAIL ② 仍有 1 个欠账文件：src/client/kernel/portal.js[require()]
   - 初步根因猜测：ESM 产物里残留 require()
37. **`deck/tests/verify-handoff-latest-sort.js`**
   - 断言原话：「parseHandoffMtime helper 定义（dyn 与 npm 双产物）」
   - 实得：FAIL ×2
   - 初步根因猜测：交接时间解析的助手指令在产物里找不到
38. **`deck/tests/verify-issue-comment.js`**
   - 断言原话：「只读提示条件化 / updatedAt bump 闪烁数据源」
   - 实得：#255 四缝验证失败；（diff 求值异常: idOf is not defined）
   - 初步根因猜测：门禁自身引用了未定义标识符 idOf（门禁缺陷）
39. **`deck/tests/verify-issue179-workspace-switch.js`**
   - 断言原话：「非判定电话保留 DEFAULT_CWD 兜底；host.js 保留 DEFAULT_CWD 兜底」
   - 实得：FAIL ×2
   - 初步根因猜测：#179 的兜底被 #1003 改造带走了
40. **`deck/tests/verify-issue212-213-214.js`**
   - 断言原话：「#214 buildSnapshot must define let backendModules = null；#213 probe must invalidate cache on changed」
   - 实得：FAIL ×4
   - 初步根因猜测：#212/#213/#214 的三条不变式在实现里已不成立
41. **`deck/tests/verify-issue58-cache-first.js`**
   - 断言原话：「loadSnapshot 拆 doLoad；openPagePanel 三分支；probeNow 按 cwd 归一键分组隔离」
   - 实得：FAIL（client.js 与 package/lib/client.js 双缺）
   - 初步根因猜测：缓存优先改造没落进产物
42. **`deck/tests/verify-leaves.js`**
   - 断言原话：「src/client/statusbar/StatusBar.js ≤359 行（零增长基线冻结值）」
   - 实得：实际 414
   - 初步根因猜测：冻结基线被突破 55 行
43. **`deck/tests/verify-log-coverage.js`**
   - 断言原话：「注册总数恰为现役数；清单里没有 wf.pluginIdentity」
   - 实得：实得 56；wf.updateStatus/updateCheck/updateInstall 没有方法可识行
   - 初步根因猜测：日志电话注册表与实现清单对不上
44. **`deck/tests/verify-log-fields.js`**
   - 断言原话：「事件有埋点落点 update.install.exec（全仓未找到）」
   - 实得：FAIL；另有未知事件 identity.migrate
   - 初步根因猜测：埋点事件名与附录白名单不同步
45. **`deck/tests/verify-log-switch-597.js`**
   - 断言原话：「超时/未知端点/没接上宿主的提示都要分类」
   - 实得：实际全部取到「」（9 项红）
   - 初步根因猜测：配置页调试开关的提示分类整段取不到
46. **`deck/tests/verify-map-subissues-352.js`**
   - 断言原话：「PROMPTS version 14」
   - 实得：FAIL: prompts.js 未满足 352 v14 解耦要求
   - 初步根因猜测：已知真漂移：prompts.js 未做 v14 解耦
47. **`deck/tests/verify-markdown.js`**
   - 断言原话：「mdToHtml 里 inlineWith 走 Tip 分支」
   - 实得：ReferenceError: Tip is not defined（mdInline → Tip）
   - 初步根因猜测：被测源码引用了 Tip，门禁求值探针只喂了 h，没给 Tip 桩
48. **`deck/tests/verify-market-tarball.js`**
   - 断言原话：「.github/workflows/release-tarball.yml 存在；workflow 里的资产名 NAME 等于包名」
   - 实得：✗ ×2（文件不存在）
   - 初步根因猜测：工作流文件不在仓库
49. **`deck/tests/verify-naming-isolation-315.js`**
   - 断言原话：「A 未过宽限且无 hint 不产单；无 hint 冲突时裸档保留」
   - 实得：23 checks, some failed
   - 初步根因猜测：#315 的宽限与裸档保留规则未落实现
50. **`deck/tests/verify-probe-since.js`**
   - 断言原话：「probe 每轮记录 lastProbeAtByRepo 探测时间；删除/状态变化时失效内存快照缓存」
   - 实得：FAIL（src 与 package 双产物）
   - 初步根因猜测：探测基线推进的代码确实不在产物里
51. **`deck/tests/verify-readme-sync.js`**
   - 断言原话：「发布目录 README.md 与源头一致」
   - 实得：差异字节数=104
   - 初步根因猜测：生成物过期（改根 README 后没跑 scripts/build.mjs）
52. **`deck/tests/verify-refresh-414.js`**
   - 断言原话：「src host 含 isForce；wf.snapshot 受 isForce 守卫；pkg host 含 isForce」
   - 实得：FAIL ×3
   - 初步根因猜测：#414 的 isForce 守卫在 host 里找不到
53. **`deck/tests/verify-release-contract.js`**
   - 断言原话：「CHANGELOG 最新节版本 == 目标 v1.8.0-rc.13；构建产物含版本注入」
   - 实得：实际 v1.7.1（并本轮 65s 超时被杀）
   - 初步根因猜测：CHANGELOG/产物版本落后于目标版本
54. **`deck/tests/verify-release-template.js`**
   - 断言原话：「.github/ISSUE_TEMPLATE/release.yml 存在」
   - 实得：✗（前置文件缺失，双入口一致性检查跳过）
   - 初步根因猜测：发布模板文件不在仓库
55. **`deck/tests/verify-repo-jump.js`**
   - 断言原话：「index 注入占位声明；pkg/dev 产物注入仓库 URL」
   - 实得：FAIL（19/22）
   - 初步根因猜测：仓库 URL 注入占位没落进产物
56. **`deck/tests/verify-skill-probe-redcard-and-waiting.js`**
   - 断言原话：「src/host/index.js 含 SKILL_PENDING_MAX 等 5 条」
   - 实得：FAIL；另有 TypeError: dispatch is not a function
   - 初步根因猜测：红牌/等待链的常量与分支不在实现里（末段夹具也抛错）
57. **`deck/tests/verify-strict-module-syntax.js`**
   - 断言原话：「src/client/panelAssembly.js 严格解析」
   - 实得：Transform failed：<stdin>:209:4 Top-level return cannot be used inside an ECMAScript module
   - 初步根因猜测：源码里有模块顶层 return
58. **`deck/tests/verify-t1-getrepokey.js`**
   - 断言原话：「场景4 snapshot.repo 降级到 gh mock（upstream）」
   - 实得：实得 null
   - 初步根因猜测：上游降级路径不再生效
59. **`deck/tests/verify-t14-detail-badge.js`**
   - 断言原话：「client.js / package/lib/client.js 提取 T14 渲染块成功」
   - 实得：FAIL ×2
   - 初步根因猜测：T14 徽章渲染块在产物里切片失败
60. **`deck/tests/verify-tabs-narrow.js`**
   - 断言原话：「tabsRef 出现 2 次（dock + overlay）」
   - 实得：FAIL（dyn 与 npm 双产物）
   - 初步根因猜测：tabsRef 的使用点数量与判据不符

### 真漂移里成团的三处（占 19/60）

1. **deps 缺 `identityEnvFor`（3 道：927-gate-injection / log-exec-606 / 963-log-order）**：门禁直连 `createPlatformChannel({...})` 时没给这个新依赖，而 `src/host/platformChannel.js:256` 现在无条件 `await identityEnvFor(...)`。修法是门禁补一个桩（真实装配在 `src/host/index.js` 里是有的）。
2. **deps 缺 `decideBackend`（13 道：deck-tools / deck-no-hang / deck-tools-matrix / 790 / 829 / 895 / 898 / 929 / 971 / 992 / 784 / deck-thin-reads / deck-parallel）**：`#1003` 单出口之后 `src/shared/deck-tools/shell.js` 的 `pickBackend` 把 `decideBackend` 当必需依赖，缺了就如实回 `unsupported`，后面所有断言跟着空。新一批门禁（947 / 957 / 934-935 / 1003）都传了，这一批没传 —— 是门禁侧欠账。
3. **宿主装配改了交付口（3 道：panel / detail-fog / detail-levels）**：`deck/host.js` 的 `apply` 现在把电话注册进 `bootBody` 内**自建**的 harness，再经 `ctx.inject` / `ctx.get('dswEndpoints')` 交付；门禁仍按入参 `harness.handle` 捕获 → handlers 为空（本次用独立探针复现了 `handlers: 0`，再调 `h['wf.refresh']` 就是 `not a function`）。

## 接不接进 verify:deck 发版链

**暂不接**：90 道红里 60 道是真漂移（其中 19 道是同一处夹具欠账，可成批修），先清这批再谈接入；接入时应对 27 道环境类写显式前置/跳过（Chromium 通道与 deck 局部 node_modules），否则发版链会被机器环境卡死。

## 这份清单落成票了

分流之后真漂移**各自开票**（本文件是它们的证据来源）：

| 票 | 覆盖面 |
| --- | --- |
| [#56](https://github.com/SunsetRNE/dsh-github-resident/issues/56) | 成团·一：13 道夹具缺 `decideBackend` |
| [#57](https://github.com/SunsetRNE/dsh-github-resident/issues/57) | 成团·二：3 道夹具缺 `identityEnvFor` |
| [#58](https://github.com/SunsetRNE/dsh-github-resident/issues/58) | 成团·三：3 道按入参 harness 捕获，宿主已改 `bootBody + dswEndpoints` |
| [#59](https://github.com/SunsetRNE/dsh-github-resident/issues/59) | 其余 41 道 + 待定 3 道（逐条根因收口票） |

环境类 27 道**没有开票**：它们是「跑门禁这台机器缺什么」，归属是 feeder 侧的显式前置/跳过（上面「环境类怎么补 / 怎么跳过」一节），不是源码欠账 —— 开了票也没人接。

## 复测（2026-10-15，共四轮）

同一个名单、同一台机器、同一个逐道跑法，逐轮清票之后各量一遍（每轮跑之前先取重活租约，跑完放）：

| 轮次 | 绿 | 红 | 清掉了什么 |
| --- | --- | --- | --- |
| 首测 | 221 | 90 | —（只做分流） |
| 第二轮 | 237 | 74 | [#56](https://github.com/SunsetRNE/dsh-github-resident/issues/56) 13 道 + [#57](https://github.com/SunsetRNE/dsh-github-resident/issues/57) 2 道 + [#62](https://github.com/SunsetRNE/dsh-github-resident/issues/62)（963 的另一半） |
| 第三轮 | 239 | 72 | #58 的取件方式（detail-fog / detail-levels 转绿） |
| **第四轮（终）** | **240** | **71** | [#63](https://github.com/SunsetRNE/dsh-github-resident/issues/63) + #58 收尾的 gh 前置检查 + `verify-panel` 同款前置 |

四轮合起来看：

- **红→绿 19 道**：`verify-784-effortId` / `790-parent-edge` / `829-parent-reread` / `895-bulk-deadline` / `898-block-merge` / `927-gate-injection` / `929-batch-cycle` / `963-log-order` / `971-markdown-parent` / `992-readonly-labels` / `deck-no-hang` / `deck-parallel` / `deck-thin-reads` / `deck-tools-matrix` / `deck-tools` / `log-exec-606` / `detail-fog` / `detail-levels` / `panel`；
- **绿→红（回归）0 道**；
- **四轮里飘的 2 道**：
  - `verify-artifact-freshness` `[绿,绿,红,绿]` —— **门禁之间的相互作用**，不是产品漂移：有门禁运行时会刷新 `deck/src/**` 与 `deck/client.js` 的 mtime 而**不重建 `dist`**，于是它那条「dist 不比 deck/src 旧」就红。按它自己的提示跑一次 `npm run build` 即绿（本轮已跑，终轮实测绿）。
  - `verify-bundled-discovery` `[红,红,绿,红]` —— 同样的输入三次红一次绿，属**不确定**（它就是 [#71](https://github.com/SunsetRNE/dsh-github-resident/issues/71) 那三道待定之一）。
- **两道离 65s 上限只剩几秒**（`verify-895-bulk-deadline` 63.9s、`verify-898-block-merge` 60.5s）—— 它们是 #56 刚修绿的，**再慢一点就会被 timeout 杀掉**，是下一轮该看的隐患（属 [#64](https://github.com/SunsetRNE/dsh-github-resident/issues/64) 那类「产物/切片」之外的独立观察）。

⚠️ **复测的跑法**是用逐道 runner（每条 `cd deck && timeout 65 node tests/<file>`）跑的，**不是** `deck/scripts/verify-chain.js`；两边的 PATH 都是原样，所以数字可比。

⚠️ **终轮那 240 个绿里有 3 个是「前置缺失的出声 SKIP」**（`verify-panel` / `verify-detail-fog` / `verify-detail-levels`：这条机器 PATH 上没有可跑的 `gh`）—— 它们**不是真跑绿**。把 `gh` 放进 PATH 后三道都实测真绿（15/15、2/2、11/11）。

复测期间新开的票：

| 票 | 覆盖面 |
| --- | --- |
| [#61](https://github.com/SunsetRNE/dsh-github-resident/issues/61) | 重活租约扩到 `verify:deck` / `verify:resident` —— 已落地 |
| [#62](https://github.com/SunsetRNE/dsh-github-resident/issues/62) | `verify-963-log-order` 的 S4 分档判据停在 1.7.8 之前 —— 已修 |
| [#63](https://github.com/SunsetRNE/dsh-github-resident/issues/63) | `verify-panel` 的两条残留漂移（票级 `blocks` / 已关闭地图的现场比对）—— 已判已修 |
| [#64](https://github.com/SunsetRNE/dsh-github-resident/issues/64) – [#71](https://github.com/SunsetRNE/dsh-github-resident/issues/71) | [#59](https://github.com/SunsetRNE/dsh-github-resident/issues/59) 拆出来的 8 张根因族子票（产物/切片 · 门禁自身缺陷 · 发布链 · 结构红线 · 语义不变式 · 日志埋点 · 宿主行为 · 待定 3） |

**第五笔增量（2026-10-15 晚）**：[#65](https://github.com/SunsetRNE/dsh-github-resident/issues/65) 的三道（门禁自身缺陷）已修 —— `verify-842-version-control-write-view` / `verify-issue-comment` / `verify-markdown`，提交 `65ab947`，父 agent 实跑三道 `exit 0`；那一族 **44 → 41**。
**第六笔增量（2026-10-16 凌晨）**：[#67](https://github.com/SunsetRNE/dsh-github-resident/issues/67) 的六道（代码结构红线）已修 —— `verify-file-granularity` / `verify-leaves` / `verify-strict-module-syntax` / `verify-delta-patch` / `verify-gate-dialect` / `verify-698-switch-asks-layout`，提交 `26b5429`，逐道修前红 / 修后绿；那一族 **41 → 35**。

  判定类别（三处判据过期 · 一处解析语境 · 两处**红线抬到现状**）：抬红线那两处不是「只改数字」—— 越线提交逐条 `git log -S` 查证后写进 `deck/tests/file-granularity-baseline.json` 的 `reasons`，350 那条上限一个字没动。**它们要的两件真裁决（7 个文件要不要真拆 / `portal.js` 的 `require` 要不要归零）已单开** [#73](https://github.com/SunsetRNE/dsh-github-resident/issues/73)（`ready-for-human`），没有悬空。

**第七笔增量（2026-10-16）**：[#64](https://github.com/SunsetRNE/dsh-github-resident/issues/64) 的九道（产物/切片过期一族）已修 —— `verify-b3-done-color` / `verify-t14-detail-badge` / `verify-671-modal-global-overlay` / `verify-tabs-narrow` / `verify-handoff-latest-sort` / `verify-issue58-cache-first` / `verify-repo-jump` / `verify-probe-since` / `verify-readme-sync`，提交 `518f566`，逐道修前红 / 修后绿；那一族 **35 → 26**。

  判定类别：**九道全是「判据过期」**（源码/产物里语义都在，没有一道真回归）。三类来源：

  - **身份真源**（`verify-readme-sync` / `verify-repo-jump`）：身份融合（2026-10-12）后版本与仓库地址取主包（仓库根 `package.json`），门禁还按 `deck/package/package.json` 的 `v1.8.0-rc.13` / 上游地址算 → 判据与 `scripts/build.mjs` 的 `mergedPackageJson()/dswVersion()/dswRepoUrl()` 对齐（README 差 104 字节）；`src/client/index.js` 的 `DSW_REPO_URL` 声明已由 `const` 改 `let`（探测结果可改写），锚点跟着走。
  - **宿主拆分**（`verify-handoff-latest-sort` / `verify-probe-since` / `verify-671-modal-global-overlay`）：H6 #450 把 handoff 那一段搬进 `src/host/handoffClaim.js`、H2 #446 / H5 #449 把列表索引与评论探测搬进 `issueList.js` / `commentThreads.js`、#419/#425 把弹窗座位拆成 `FormModalSeat` + `FormModalContent`；两个入口只剩 `_handoff()/_issueList()/_comments()` 接线（`package/lib/index.js` 与 `src/host/index.js` 逐字节相同）。断言改锚到承载模块产物 `package/lib/<module>.js` + 入口接线，语义一条未减。
  - **客户端重构**（`verify-b3-done-color` / `verify-t14-detail-badge` / `verify-tabs-narrow` / `verify-issue58-cache-first`）：列表行动作组收成单行（改字符锚点切片 + 空白无关比较，mapEmpty 前置分支跟着现形）、#691 把 map 详情头部拆到 `views/MapDetailHead.js`（注释锚点消失、tooltip 由原生 `title` 改走 `Tip`）、页内浮窗退役后 tabs 容器收拢成 Dock 一处（上游 `0704e78b`）、`openPagePanel` 并入 `afterPanelOpened`（上游 `037b7642`，三分支按支断言）、`keyOf` → `wsKeyOf`（上游 `e560a127`）、`doLoad` 变 `async`（上游 `84c65943`）。deck/ 是上游快照（`deck/IMPORTED-FROM.md`：HEAD `3b25cd3f`），本仓 `git log -- <file>` 只有 `40ebd3a`，故上游提交号是查证来源，注释里已写明。

  第五轮全链复测（同一逐道 runner、跑前 `gh_load_lease` 取锁）：**311 道 221 绿 → 256 绿 / 55 红**；唯一新红是既有已知的 `verify-artifact-freshness` mtime 抖动（有门禁跑动会刷新 `deck/src/**` 的 mtime 而不重建 dist），跑一次根 `npm run build` 后转绿 —— 即 **257 绿 / 54 红**。`verify-671` 修好后 B 组仍真渲染出 `.dsws-modal`（父节点 `document.body`、一层壳、零面板容器），确认行为没丢。

**第八笔增量（2026-10-16）**：[#66](https://github.com/SunsetRNE/dsh-github-resident/issues/66) 的四道（发布链与仓库元文件）已修 —— `verify-market-tarball` / `verify-release-template` / `verify-config-store-package` / `verify-release-contract`，提交 `37ed8aa`，逐道修前红 / 修后绿；那一族 **26 → 22**。

  判定类别：**四道都是「判据过期」**（发布入口与清单口径在身份融合后换了真源），其中 `verify-release-contract` 顺带补齐了门禁暴露的**两处真实缺口**。逐道：

  - `verify-market-tarball` / `verify-release-template`：上游 deck 独立仓那套（`release-tarball.yml` 在 published 时附**固定名**资产、发布议题网页卡）在本仓既不存在也不该补 —— 合并仓的发布入口是**仓库根** `.github/workflows/release.yml`（tag/dispatch → `npm pack` → 建 Release 并 `gh release upload --clobber`），资产名是 npm pack 的 `<包名>-<版本>.tgz`，根 README 教的是**带版本**的 Release tgz 装法。当面裁决（本票评论）：**不保留固定资产名链接 / 不要网页卡**；两道门禁改钉根发布链与「退役是事实」。
  - `verify-config-store-package` / `verify-release-contract`：清单与版本断言一律改读**仓库根** `package.json`（真正发布的包）；`release-contract` 的目标版本、身份投影（生成的 `package/README.md` banner、两份产物的版本注入）改钉根身份，变更历史出口改钉根 workflow 的 `--generate-notes`（deck/CHANGELOG.md 追的是「合并包 1.8.x」里程碑，与根版本不同源）；包白名单改成读 `files` 声明 —— 在仓库根跑 `npm pack --dry-run` 实测 **60 秒**，超门禁链每道 65 秒预算（解包与装载的真验证在根侧 `verify-bundle.sh` / `verify-real-artifact.mjs`）。顺带补齐两处真实缺口：根 `package.json` 补 `keywords`、根 README 安装示例版本对齐现状（`1.8.2` → `1.11.0`）。
  - **零新增回归**：全链 311 道复测 **256 绿 → 258 绿 / 53 红**；`verify-898-block-merge` 单跑 60.5s 绿、`verify-847-stall-watch` 单跑 15s 绿（两道都是这轮扫出的抖动 / 临近 65s 上限，非本轮改动），`verify-artifact-freshness` 仍是既有 mtime 抖动（跑一次根 `npm run build` 即绿）。`node deck/scripts/verify-chain.js` 仍止于环境类 `verify-423-title-clamp-browser`，四道各自 `--only` 全部 `CHAIN_EXIT=0`；`node tests/merge/run.mjs` **41 通过 / 0 失败**。

**这次（#67 那批）没再跑一遍全链复测**，理由写在这里免得下次有人以为是漏了：改动只落在 3 个**彼此独立**的门禁文件（各自一个 node 进程、互不 import），全链复测不会给出新信息；要跑就用上面那套逐道 runner（跑之前自己 `gh_load_lease` 取锁）。

**第九笔增量（2026-10-16）**：[#69](https://github.com/SunsetRNE/dsh-github-resident/issues/69) 的五道（日志 / 埋点 / 探针一族）已修 —— `verify-496b-inject-guard` / `verify-709-no-self-continuing-timers` / `verify-log-coverage` / `verify-log-fields` / `verify-log-switch-597`，提交 [`227f565`](https://github.com/SunsetRNE/dsh-github-resident/commit/227f565)，逐道修前红 / 修后绿（判据一条没放宽）；本票那一族 **22 → 17**（#59 伞下剩：#68 六道 + #70 八道 + #71 三道）。

判定类别：**四处「判据过期」+ 一处「源码漂移」**，另同票补齐两处登记欠账与一处判据自身的括号缺陷。逐道：

- `verify-496b-inject-guard`（判据过期）：日志前缀已由身份融合 `233cb1f` 整份改成 `[GitHub 常驻]`（该提交自述「控制台前缀 `[MattSkillsDeck]` → `[GitHub 常驻]`」，全仓 5 处一起换），判据钉的旧字面量此后恒为 0 —— 三处日志点一直都在（改按新前缀量，实得 4，阈值仍 3）。
- `verify-log-switch-597`（判据过期）：夹具自己塞了 `sessionId` 渲染配置页，而宿主的渲染是 `renderSlot('settings.plugins.tab', {}, …)`（`dsh-client-ui-settings-plugins/lib/client.js` 第 68 / 124 行，入参空对象）；页面于是读「每会话 store」，而诊断分区把提示 `flash` 进 `shared` 那份 store —— 提示在这段夹具下永远渲染不出来（9 项红全出在这里）。按宿主真实入参渲染，判据一条未减（15 项全绿）。
- `verify-709-no-self-continuing-timers`（夹具过期 + **源码漂移**）：① 夹具直连 `createRepoKeys` 没给 `identityEnvFor`（2026-10-14《Deck 半边接消费面》起三个执行出口无条件 `await` 它），`spawn` 当场抛、被 `runGh` 收成 `kind=spawn`，于是这一轮链一条 REST 都没发出去；按 [#57](https://github.com/SunsetRNE/dsh-github-resident/issues/57) 先例共用 `tests/lib/identity-env-stub.js`。② 把夹具补齐之后才露出真问题：`src/host/tracker/detection/preflightScope.js` 的 `keyOf` 把程序名**原样**拼进身份键，而两条出站路带的名字不同 —— 探测级联那条（`ghClient.execGh`）传的是解析出来的完整路径（真机上是 `/usr/bin/gh` 那样的绝对路径），后端链谓词那条传裸名 `gh`（`detectChain.js` 两处 `ghAsk`），于是复用位永远命中不了：一次评估仍问两遍登录态（实测 4 条 REST，票面要 3 条）。程序名归一（`isGh(cmd) ? 'gh' : cmd`，与 `isPreflightCommand` 的「带路径也认」同口径；参数与工作目录照旧逐字比）后实测 **3 条**。这一处是**产品侧真缺陷**（不只是门禁）：修的是产线上那句「一次评估 5 条 REST 降到 3 条」的承诺。

- `verify-log-coverage`（判据过期两处）：① 注册实数 56 而清单 55 —— 身份融合新增的 `wf.pluginIdentity` 漏登记（同批漏记的 same-layer 扇入边已由 `0c0d4e7` 补上），按注册实数补进清单（现役 55 → 56）；该电话与它的客户端调用点从前**一条日志都没有**，在调用点按既有口径补一行常驻 #26 `host.call`（`method=wf.pluginIdentity`，`kind=plugin-identity`；宿主侧那条注册是裸 `harness.handle`，不为一个显示用探针另起一套）。② 四条更新电话的取件路径硬拼 `deck/node_modules` —— 本仓不建它（根 `pnpm-workspace.yaml` 明写「deck 需要的包由根 `devDependencies`/`dependencies` 提供，deck 内的 `createRequire` 会向上解析到根 `node_modules`」），`readFileSync` 抛、`catch` 成 `false`，四条恒红；改按 Node 的向上解析定位包（解析不到仍旧如实回 `false`，不静默放行）。
- `verify-log-fields`（判据过期两处 + 一处判据自身缺陷）：① `update.install.exec` 的「全仓未找到」同样是取件路径（#875 起发射器收进已安装的更新包，本仓 `src` 不再有落点），改按 Node 解析后包内落点与五个字段核对通过；② 「事件有埋点落点」那条循环被**错关在** `if (!found['update.install.exec'])` 的花括号里面 —— 包内找到落点的那一天，全部落点断言会一起被跳过（门禁悄悄变松）；花括号摆回原位，断言只增不减（196 项）。另补登记一处：身份融合新增的 `identity.migrate`（客户端一次性迁移，info 级跟着调试开关走）只落了发射、登记没跟上，照 2026-09-25 #709「登记收口」先例如实补进白名单（`changed` / `scanned` / `fields` 三键，按需 #98）；附录计数同步改**常驻 43 / 按需 47 / 自监控 5 / 总数 95**。

**全链复测（第九轮）**：同一个逐道 runner（`cd deck && node tests/<file>`），跑前自取重活租约、跑完释放 —— **311 道 266 绿 / 45 红**。两点提示：① 本轮 runner 每道给 **150s**（历轮是 65s），所以「临近上限」那几道读数更宽，绿数与历轮不能逐一对齐；② 45 道红里 **44 道**都在本文件原始三份名单（环境 27 / 真漂移 / 待定 3）之内，唯一例外是 `verify-artifact-freshness` 的 mtime 抖动（`build:deck` 刷新了 `deck/src/**` 与 `deck/client.js` 的 mtime 而不重建 `dist`）—— 跑一次根 `npm run build` 后实测转绿，属已知现象。**本次五道全绿，且没有任何一道原本绿的门禁因此转红。**

`node deck/scripts/verify-chain.js` 仍止于环境类 `verify-423-title-clamp-browser`（缺 Chromium，跑前它自己取了租约）；`node tests/merge/run.mjs` **41 通过 / 0 失败 / 0 被阻塞**（第一遍 40/1、原样重跑 41/0；那 1 例未复现、未定位，记作一次抖动，与历轮基线一致）。

旁支发现（**不属本票、未开票**）：`SettingsPage` 的提示读的是 `useStore(props.sessionId)`，而 `DeckDiagnosticsSection` 把提示 `flash` 进 `shared`；宿主从不给 `settings.plugins.tab` 传 `sessionId`（`renderSlot(name, {})`），所以产线上两者是同一份 store（行为正确）—— 只有在「有人给这一格塞 sessionId」时才会错位。本票只把夹具改成按宿主入参渲染，源码未动。

**第十笔增量（2026-10-16）**：`verify-issue179-workspace-switch` **按上游口径从门禁降级为复现器**（撤掉门禁、复现器留在链外）。依据是上游把同一条降级成了脚本 `tests/repro-issue179-workspace-switch.ts`（2026-10-17 转 TS，那笔提交的原话：「三个复现脚本（detailsdock 切画串台、issue179 工作区残留、issue58 缓存优先）」，转换前后「issue179/issue58 复现原来的红」）—— 也就是说它在上游**不是**一条必须为真的判据。同时核了上游 `src/host/commentThreads.js`：非判定电话同样是四条硬拒、同样**没有** `|| DEFAULT_CWD`，最新口径站在「空目录不冒充」（#1003）那一边，所以本票**不恢复**那层兜底（本节第九笔增量里把它记成「待裁决」的那半，至此有了上游口径的答案）。撤门禁时顺手修掉复现器自己的一处过期：Dock 的跟随逻辑 V4 #464 已搬进 `DockSync.js`，它却只读 `Dock.js`，多报四条假红；拼读之后余下三条同类红，全部关于 host 入口那层兜底 —— 那正是 #179 在当前口径下唯一还空着的地方。

**第十一笔增量（2026-10-16）**：[#75](https://github.com/SunsetRNE/dsh-github-resident/issues/75) 的两道（#68 / #70 关票时唯一还红的两项）已修 —— `verify-naming-isolation-315` / `verify-map-subissues-352`。**两道都是「判据过期」，deck 源码一行未动**（`git status` 只动这两个门禁文件）。

- **`verify-naming-isolation-315`（判据过期：本仓是上游的旧修订）**。红的两条是 `A 未过宽限且无 hint 不产单` 与 `无 hint 冲突时裸档保留` —— 不是产品回归：产品把 `NAMING_HINT_GRACE_MS` 定为 `0`（`src/shared/naming-tracking.js:90`；上游 `src/shared/naming-tracking.js:90` 同值），而旧判据把这个常量**照抄**进断言（`core.planOrderFor(sA, now, core.NAMING_HINT_GRACE_MS)`）。窗口恒为零时「1 秒前的裸档」当然产单，于是它量的是「常量现在等于几」，不是「宽限窗口这道机制」。上游 `0f1f576b`（2026-10-11，原话*删掉「读源码文本钉形状」这一类门禁：整份删 27 个，另 121 个只摘钉死断言*）已把这道门禁改成两处：① 宽限那一节**显式传** `GRACE_MS = 30000`（带注释写明为什么不照抄产品常量）；② 整节删掉 `#709` 那段读源码文本钉形状的守卫（`byRepoHasHint` / `o.kind === 'draft' && !o.hint` / `keepRelatedAssigned(` / 四个电话名 / `setInterval` 名单）。查证：本仓改动前那份与上游 `0f1f576b` 的父提交 `fdd0c73d` **逐字节相同**，即本仓落后上游一个修订 —— 按上游口径整份对齐（改后与 `0f1f576b` 逐字节相同），`13/13` 全绿。被删那一节的意图没有落空：自续定时器由链上的 `verify-709-no-self-continuing-timers` 负责，命名守护的电话与抑制逻辑由 `verify-naming-guardian` / `verify-kernel` / `verify-log-coverage` 负责，本票那道隔离修复仍由该文件的行为断言覆盖。

- **`verify-map-subissues-352`（判据过期：判据钉了一个会随正常升版移动的现值）**。唯一的红是版本闸门 `text.includes('"newWayfinder": { version: 14')`，而源码 `src/client/kernel/prompts.js` 已是 **v17**，且与上游 `src/client/kernel/prompts.ts` 同名同文案同占位（逐字同文）。v14→v17 是上游三次**有意升版**，每次都是模板正文的改动、升版写在提交里：`9e7e0c72`（落实 779 号票：给全部提示词补工具节）→ v15、`785c980a`（删全部 prompt 中文括号短语）→ v16、`7631eaa6`（对称删除英文收尾模糊授权并收口变体句）→ v17；`249847b0` 是 v14 本身。也就是说 #352 要的「占位式解耦」一直在，动的只有版本号。判据改成**门槛** `version ≥ 14`（正则解析，取不到即 0 判红），与本仓 `verify-prompts.js` 的 `V_MIN` 表同口径（那里对 `newWayfinder` 写的正是 `≥ 14`，错误文案也是「版本号未 bump …（期望 ≥ v？」）；其余六条解耦断言（`placeholders` 含 `subIssue`、`{subIssue}` 占位、`NEW_WAYFINDER_DEFAULT_WIRING` / `newWayfinderParamsFrom` / `newWayfinderPrompt`、无旧 3 分支硬编码）与后端声明 / router / 产物三条**一条未动**。修后 `EXIT=0`，含活体那一条：上游 `FeatherHunter/dsh-mattpocock-skills-deck#345` 的 `sub_issues` 计数实测 **6**（判据要的就是 6；不带 `gh` 进 PATH 时这条按既有约定跳过并出声）。

跑出来的数：两道各自 `EXIT=0`；`node deck/scripts/verify-chain.js` 仍止于环境类 `verify-423-title-clamp-browser`（本轮名单 310 条，前 3 道全绿后即止步；缺 Chromium headless shell —— 环境类，按 #59 的边界不入本票；链跑前自取重活租约、跑完释放），两道用 `--only` 在链里各跑一遍，各自 `verify-chain: 全绿（1 条）` / `CHAIN_EXIT=0`（链跑前自取重活租约、跑完释放）；`node tests/merge/run.mjs` **通过 41 · 失败 0 · 被阻塞 0**。**零源码改动、零新增回归**（本轮只动 `deck/tests/` 两个文件；它们各自一个 node 进程、互不 import，也不被别的门禁 import，故按第七笔增量立下的规矩不重复全链复测）。



