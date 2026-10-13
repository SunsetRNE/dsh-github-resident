# dsh-github-resident · 自托管分发包（GitHub Pages）

机器读 `index.json`；当前版本以它为准。

## 当前

- **v1.7.4** · `sunsetrne-dsh-github-resident-v2-1.7.4.tgz`
- 装法：`npm i https://sunsetrne.github.io/dsh-github-resident/sunsetrne-dsh-github-resident-v2-1.7.4.tgz`
- 装前判据：解包后 `node --input-type=module -e "import('./dist/host.js').then(()=>console.log('LOADED-OK'))"` 必须打印 `LOADED-OK`
- 这一版含工作区 WIP 线：状态栏横条的横滑窗（`statusbar/barScroll.js`）、胶囊折叠配套、更新链路修复（profile 目录探测 + `main`）

## 已被取代 / 已废弃

| 版本 | 状态 | 为什么 |
| --- | --- | --- |
| v1.7.3 | 已被取代 | 不含 WIP 界面修复（滚动工具栏等）；可作回滚件，不推荐日常用 |
| v1.7.2 | 勿装 | 宿主入口桩期望旧包名 `@local/…` → 加载期抛错，插件不加载（工具栏/侧边栏消失） |
| v1.7.0 | 勿装 | 包名仍是旧名 `@local/…`；仅作通道自检样本 |

## 附：自建「npm 形状」更新源的四条硬约束（2026-10-13 实测）

更新包（`dsh-plugin-update@0.13.0`）的取数是 `fetchNpmRelease(fetchImpl, timeoutMs, {registryUrl, targetPackageName})`，
它请求 `<registryUrl><encodeURIComponent(包名)>/latest` 并**强校验**返回。要让它认我们的通道：

1. **`registryUrl` 必须以 `/` 结尾** —— 不带尾斜杠时 URL 会拼成 `…:31899%40sunsetrne…`，请求根本没发出去（`check-failed`，源收到 0 个请求）。
2. 元数据 JSON 的 **`name` 必须等于目标包名**（`@sunsetrne/dsh-github-resident-v2`），**`version` 必须在该版本通道合法**（stable = 纯三段）。
3. **`dist.tarball` 必须与元数据同源**、无 query/hash，且 pathname 恰为
   `/<包名>/-/<包名>-<版本>.tgz` —— **文件名带完整 scope**（去掉 scope 会判 `invalid-release`）。
4. **`dist.integrity` 必须是 sha512 形式**（npm 的 `sha512-<base64>`）；本通道清单里的 sha256(hex) 不够，要补这一列。

另记一条与本通道相关的闸门：**`link:` 装法会被判 `sourceInstall: true`**，`blockedReason = 'source-install'`，
更新检查会直接跳过（不联网）；要让它真的查，装法得从 `link:` 切到 pack 形态（profile 依赖写版本区间、副本是真目录）。

参考请求形状（本机假源实测）：`GET /%40sunsetrne%2Fdsh-github-resident-v2/latest` → 200。
