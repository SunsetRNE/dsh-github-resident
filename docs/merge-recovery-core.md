# 合并恢复核心（merge-recovery-core）—— 接续记录

本文件是 **DeepSeek4.1 实施者** 在 `feat/merge-skills-deck` 上接续上一集成人未回报的那一段
（合并包 v1.7.0，基线 `54a1a07d233e23037b847d3ac407b33851fe7284`）的进度文件。
只记两件事：同进程共享格（exec-cell）的生命周期与身份，评论透传/hint.reject 两条历史红的诊断与复验。
不重做三个模块，不扩到 237 全链。

## 0. 开工时记录的接续范围（不改写上一段结论）

- 现状（接手时实测，不引用旧日志当最新结果）：
  - `deck/src/shared/deck-tools/exec-cell.js` 已有 `state/promise/hostPid/owner` 与 `release()`，
    但 `then` 回调只看 `state === 'pending'`，`release` 只比 `owner`。
  - `deck/src/host/refresh/wiring.js` 在懒装函数里先 `publishDeckTable(deckToolsP, d.ctx)`，
    再补登记 `d.ctx.effect`。
  - `tests/merge/host/deck-bridge-shared.test.mjs` 已有落点同一性 + 正向 `deck_context` / `deck_issue_list` 断言，
    但缺「过期 promise / 过期 release 不污染新表」与「卸载再加载」的行为用例。
- 本轮只动这些文件（writeScopes）：
  `deck/src/shared/deck-tools/exec-cell.js`、`deck/src/host/refresh/wiring.js`、
  `deck/src/host/choiceStore.js`（按需）、Host 中与 comment 透传直接相关的必要叶子、
  `tests/merge/host/**`、`deck/tests/smoke-comment-passthrough.test.js`、
  `deck/tests/verify-log-fields.js`、`docs/merge-recovery-core.md`。
- 不碰：DSH 安装 / 当前 profile / 真实凭据 / HOME / global git / gh / 31790；
  不安装、不启停、不发布、不 push。参考源 `dsh-mattpocock-skills-deck` 永久只读。
- 不写公共生成物：`deck/package/**`、`dist/**`、`bundled-skills/**` 一律不写。
  `deck/src/shared/deck-tools/exec-cell.js` 有 `deck/package/shared/deck-tools/exec-cell.js` 同字节镜像，
  本轮改源后镜像需由集成人跑构建同步（见文末「未完成项」）。

## 1. A：共享格的身份与生命周期（问题与判据）

### 1.1 两个真实缺陷

1. **旧 promise 会把新表标成 ready。** 格子只有一格，但「谁放的」会变：
   P1 发布 → `release()` → 格子空 → P2 发布（pending）→ 此时 P1 那份 promise 才敲定。
   旧回调只看 `cell.state === 'pending'`，于是把**还没装好的 P2** 标成 ready；
   行侧 `peekDeckTable()` 会报 ready，`awaitDeckTable()` 却仍可能等超时。
2. **过期 release 会清新表。** P1 的 `release` 闭包只比 `owner`：
   - 相同 owner（同一 ctx 重载/重发）时，P1 的旧 release 会把 P2 清掉；
   - legacy `owner === null`（测试夹具/旧调用）时，`null === null` 恒真，同样误清。
   两者都会让「卸载后再加载」的那份表凭空消失，行侧退回 connection/fetch/fallback。

### 1.2 修法（只加身份，不改对外形状）

- 每次 `publishDeckTable` 分配一个单调递增的 `pub`（模块内序号），存进格子。
- `then` 的成功/失败回调只在 `cell.pub === 自己那次` 且 `state === 'pending'` 时才置 ready。
- `release()` 只在 `cell.pub === 自己那次` 且 `owner` 相符时才退格。
- `peekDeckTable()` / `awaitDeckTable()` 的返回形状与 `deck_probe` 读到的字段一个字不动。

### 1.3 wiring 的迟到初始化泄漏

`deckToolsForHost()` 是懒装的（第一次用到那九个工具才真建表）。那一刻 `ctx` 可能已经卸了：
先 `publishDeckTable` 会把格子占住，而 `ctx.effect` 在已卸的 ctx 上会抛 `INACTIVE_EFFECT`
（cordis `effect()` 第一行 `assertActive()`），释放登记不上，格子从此空不出来，重载后的插件再也放不进表。
修法：把 **publish 本身放进 `ctx.effect` 的 execute 里**（effect 会立刻执行 execute）——
ctx 活着才发布、卸时 release 随 effect 一起跑；ctx 已卸则 effect 先抛，这里一个字都不发。
老夹具（`ctx` 没有 `effect`）退回「发布但不登记释放」，与旧行为一致。

## 2. B：两条历史红的诊断

（诊断与复验结果见第 4 节；此处只记结论口径。）

- `smoke-comment-passthrough` 的 5 条历史红：不是实现回归，是**夹具过期**。
  #1003 之后写操作前面多了「空目录闸」，`args.cwd` 为空直接回字符串错误，
  根本走不到 parse / unsupported / auth 分支。修法是给夹具一个合法工作区 `cwd`（合法测试环境），
  并**新增**一条断言把这道闸钉住（无 cwd 必须被拒），判据一个字没放宽。
- `verify-log-fields` 的历史红 `choiceStore.hint.reject`：只读参考源 HEAD 两边都没有这个字面量，
  属合并期缺的埋点。合并包已把落点补回
  `deck/src/host/tracker/detection/detectionService.js` 的 `detect`（只记 keyHash/baseRev/rev，
  关着调试开关连盘都不读），并同步 `deck/tests/verify-log-count.js` 与 `research/489-appendix.md`。

## 3. 方法与隔离

- 文本只读 `read/grep/glob`；测试跑在仓库内 + 独占临时目录（`/tmp/dsh41-run1` 等），
  不绑端口、不联网、不读 HOME、不动真实 profile。
- 复验命令（在 `deck/` 下跑，与 `package.json` 的 `verify:deck:smoke` 口径一致）：
  `node tests/smoke-comment-passthrough.test.js`、`node tests/verify-log-fields.js`；
  合并期契约：`node tests/merge/host/choice-hint-reject.test.mjs`、
  `node tests/merge/host/deck-bridge-shared.test.mjs`（在仓库根跑）。

## 4. 结果（收尾回填）

见文末「收尾结果」。
