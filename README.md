# dsh-github-resident · 自托管分发包（GitHub Pages · 项目站）

机器读 `index.json`；当前版本以它为准。

## 当前

- **v1.7.5** · `sunsetrne-dsh-github-resident-v2-1.7.5.tgz`（2,834,107 字节 · 从 HEAD `b1a644d` 构建）
- 装法：`npm i https://sunsetrne.github.io/dsh-github-resident/sunsetrne-dsh-github-resident-v2-1.7.5.tgz`
- 装前判据：解包后 `node --input-type=module -e "import('./dist/host.js').then(()=>console.log('LOADED-OK'))"` 必须打印 `LOADED-OK`
- 这一版把 `26a009c` 的更新链路修复带进了运行副本（`__runningVersionOf`：宿主安装清单缺失时，按 `dist/client.js` 横幅如实报「这份代码自己的版本」）

## 已被取代 / 已废弃

| 版本 | 状态 | 为什么 |
| --- | --- | --- |
| v1.7.4 | 已被取代 | 不含 `26a009c` 的兜底探测；可作回滚件 |
| v1.7.3 | 已被取代 | 不含 WIP 界面修复（滚动工具栏等）；可作回滚件，不推荐日常用 |
| v1.7.2 | 勿装 | 宿主入口桩期望旧包名 `@local/…` → 加载期抛错，插件不加载（工具栏/侧边栏消失） |
| v1.7.0 | 勿装 | 包名仍是旧名 `@local/…`；仅作通道自检样本 |

> 本页是**项目站**（带 `/dsh-github-resident/` 前缀），只适合手动 `npm i` 安装。
> 插件面板的「自更新」走的是**用户站根** `https://sunsetrne.github.io/` 上那套 npm 形状源（见 `index.json` 的 `npmShapedSource`）。

## 附：自建「npm 形状」更新源的四条硬约束（2026-10-13 实测）

更新包（`dsh-plugin-update@0.13.0`）的取数是 `fetchNpmRelease(fetchImpl, timeoutMs, {registryUrl, targetPackageName})`，
它请求 `<registryUrl><encodeURIComponent(包名)>/latest` 并**强校验**返回。要让它认我们的通道：

1. **`registryUrl` 必须以 `/` 结尾** —— 不带尾斜杠时 URL 会拼成 `…:31899%40sunsetrne…`，请求根本没发出去（`check-failed`，源收到 0 个请求）。
2. 元数据 JSON 的 **`name` 必须等于目标包名**（`@sunsetrne/dsh-github-resident-v2`），**`version` 必须在该版本通道合法**（stable = 纯三段）。
3. **`dist.tarball` 必须与元数据同源**、无 query/hash，且 pathname 恰为 `/<包名>/-/<包名>-<版本>.tgz` —— **文件名段带完整 scope**。
   实测后果：盘上是**两层** `@sunsetrne/dsh-github-resident-v2/-/@sunsetrne/dsh-github-resident-v2-1.7.5.tgz`
   （`-` 目录里还要套一个 `@sunsetrne/`）。摆成一层时**形状校验照样通过、下载才 404** —— 形状只比 URL 字符串，**不下载**。
4. **`dist.integrity` 必须是 sha512 形式**（`^sha512-[A-Za-z0-9+/]{86}==$`）；`index.json` 现在同时给 sha256 与 sha512 两列。

另记一条与本通道相关的闸门：**`link:` 装法会被判 `sourceInstall: true`**，`blockedReason = 'source-install'`，
更新检查会直接跳过（不联网）；要让它真的查，装法得从 `link:` 切到 pack 形态（profile 依赖写版本区间、副本是真目录）。

参考请求形状（本机假源实测）：`GET /%40sunsetrne%2Fdsh-github-resident-v2/latest` → 200。

5. **`dist.tarball` 的 pathname 必须从「源 origin 的根」算起** —— 校验式是
   `pathname === '/<包名>/-/<包名>-<版本>.tgz'`，与 `registryUrl` 的**路径前缀无关**。
   实测后果：本页（项目站）上的 tarball 路径是 `/dsh-github-resident/@sunsetrne/…/-/…tgz` → 判 `invalid-release`。
   要满足它，只能让**源 origin 的根**归我们：用户站 `SunsetRNE.github.io` 的根／自定义域名指到 Pages／小中转服务；否则得自实现检查。

### 探针实测（2026-10-13）

| 路径写法 | 结果 |
| --- | --- |
| `/%40sunsetrne%2Fdsh-github-resident-v2/latest`（编码） | **200**（Pages 直接服务这种路径） |
| `/@sunsetrne/dsh-github-resident-v2/latest`（解码字面） | **200** |
| `--path-as-is` 再试编码路径 | **200** |
| 同一元数据喂 `fetchNpmRelease`（项目站前缀） | **`invalid-release`** —— 卡在第 5 条（origin 根路径规则），不是托管问题 |
| 同一元数据喂 `fetchNpmRelease`（**源根**，本地假源） | **`ok`** —— version 1.7.5、integrity 形状通过 |
| 源根上的包体下载回读 | 2,834,107 字节，sha256 与本地包一致 |
| 源根 URL `npm i` | 装成 1.7.5，`LOADED-OK` |
| 面板 check（合成 pack 形态 profile + 源根 registryUrl） | `latestVersion=1.7.5`、`canInstall=true`、`blockedReason=null` |
