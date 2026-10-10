# dsh-github-resident

**中文** ｜ [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的常驻 GitHub 身份 bundle：装一次，当前 profile 里每个会话都有一组现成的 `gh_*` 工具 —— 提交、推送、开 PR、管理 gh CLI 与凭据，**不需要宿主机预装 gh，也不需要手动装一次**。

> 包名 `@local/dsh-github-resident-v2` ｜ 插件名 `github-resident` ｜ profile 行 id `include:github-resident-v2`

## 能力

### 1. 自带 gh：装完插件即可用

| 层 | 来源 | 位置 | 要 root 吗 |
|---|---|---|---|
| 1 `system` | 宿主已装的 gh | `PATH` 里的 `gh` | 不用（本来就有） |
| 2 `plugin-cache` | 插件自带 | `~/.dsh/gh-cli/bin/gh` | 不用 |
| 3 自动落地 | 官方 `tar.gz` 抽单文件；失败退回 `dpkg --force-not-root --extract` 抽 `.deb` | 同上 | 不用 |

- 任何 `gh_*` 工具调用都会经 `resolveGh()`：三层都没有就当场落地一份，调用不被打断。
- 插件**加载期**也会预置：只先探本地（毫秒级、不出网），确认缺 gh 才在后台落地，不阻塞加载。
- 落地的是用户级副本，**不进系统包库**；系统层 gh 永远不被修改。
- 下载优先 `curl`，宿主没有 `curl` 就用 Node 内建 `fetch`（`attempts[].method` 写明走的哪条）。

### 2. 凭据：只回掩码，可一键拆干净

「一个账号在这个环境里长期有效」是设计目标，所以凭据分散在几处；卸载插件**不会**替你清掉它们，得显式销毁。

| 副本 | 位置 | 写入方 |
|---|---|---|
| OAuth token（host 级 + user 级） | `~/.config/gh/hosts.yml`（0600） | gh 自己 |
| `credential.helper` | `git config --global`（host 作用域 + 全局） | `gh auth setup-git` |
| 明文 token | `~/.git-credentials`（0600） | `gh_resident_login` |
| 状态 | `~/.dsh/github-resident.json`（0600） | `gh_resident_login` |
| `gh` 二进制 | `/usr/bin/gh`（dpkg 包 `gh`，仅系统层） | `gh_cli_install` |

- 任何工具输出都只回掩码（`gho_…9KLh (len=40)`），不回明文。
- 销毁走 `gh_cli_logout`：不带 `confirm` 只勘察；`revoke:true` 才去 GitHub 撤 token（仅对 `gho_`/`ghu_` 有效，`ghp_`/`github_pat_` 必须去网页手删）。

### 3. gh 版本自更新 + 落地缓存 GC

- `gh_cli_version`：比对当前与最新版官方 release；`update:true` 才动手（只替换插件自带的那份，系统层只报告并给出去路）。同来源 24h 冷却；版本状态 30 分钟内直接复用，**过期由后台回源刷新**（读路径永不 fork 子进程 —— 审计 L2 修的就是这条）。
- `gh_cache_gc`：清理 `~/.dsh/gh-cli` 里的下载残留、`deb-extract` 临时目录、超出保留份数的旧版本（默认保最新 2 份，**下限 1** —— `keep_versions:0` 曾会删光所有版本目录）；与落地互斥，不会删掉正在下载的包。注意：`versions/` 这个多版本布局当前由外部产生（插件自身是覆盖 `bin/gh`），GC 只是支持它。

### 4. 设置面板：默认只读，不偷偷查账号

- `GET /state` **纯读**：只回内存里的快照，绝不 fork 子进程、绝不触发账号检查；没有快照时回骨架（`probing:true`、`authenticated:null`）。
- 检查只发生在两处：**插件加载期后台一次**、显式 `GET /state?refresh=1`（面板的「立即刷新」）。
- 面板显示：状态徽标、凭据助手、gh 凭据路径、gh 来源层、当前/最新版本、快照时间（过期会标「已过期 · 缓存」）。

### 5. 后台工具

`gh_resident_status` / `gh_repos` / `gh_commit` / `gh_sync`（多仓库一次性提交推送）/ `gh_pr`（REST 开 PR）/ `gh_cli_status` / `gh_cli_setup_git`。工具返回值统一带 `{ protocol, ok }` 信封，失败也保留原字段。

### 6. 仓库登记文件库：先问用户，再落盘

**一个 Git 仓库一个文件**：`~/.dsh/github-resident/registry/repos/<basename>-<sha1(路径)[:12]>.json`，
外加派生视图 `index.json` 与授权凭据 `consent.json`。目录本身就是契约 —— 其它插件 / 页面 / 脚本
**只读这个目录**就能回答「当前环境有哪些 Git 仓库、哪些绑了远端」，不必调本插件任何工具。

授权闸门（这是本节的要点）：

1. 第一次调 `gh_repo_registry {action:"build"}` 时，**一个字节都不写**，只回
   `{ consentRequired:true, wrote:false, ask:{ question, options, onAgree } }`，`ask.question` 是给用户看的问题原文，`ask.onAgree` 是同意后的调用式。
2. 用户明确同意后，带 `consent:true` 重调 → 落盘，并把这次同意记成一条 grant（`root` + `depth`）。
3. 之后同一 `root` 且不放大 `depth` 的 `rescan` 免问；换 root 或放大范围会**重新问一次**。
   `depth` 只有「扫描深度」一个含义：`0` 就是「只扫 root 这一层」，不等于不限；旧版留下的、**没有 `depth` 字段**的 grant 一律不覆盖任何请求（宁可再问一次，也不当作不限深度 —— 审计 L3）。
4. `revoke` 只撤授权（库保留可读）；`purge` 要 `confirm:true` 才删整棵目录。

三条硬不变量（门禁逐条验过）：

- 所有写入都在登记目录内，**绝不写进任何仓库** —— 登记前后工作树 `git status --porcelain` 行数不变；
- 远端 URL 落盘前剥掉 userinfo（`https://user:token@host/...` → `https://host/...`），token 永不进库；
- `index.json` 是派生视图，可由 `repos/*.json` 重建，不作为事实来源。
- 条目 `schemaVersion` 现在是 **2**：远端名（`remotes[].name`，如 origin/upstream）与 URL 里的仓库名（`remotes[].repoName`）拆成了两个字段。
  1.6.3 之前的条目仍能读（仓库名从 URL 反解），跑一次 `rescan` 即自动升到 2。
- 沿用已记录的授权时**不再回写** `consent.json` —— `grant.via` 是审计链，只有本次真拿到同意才更新。

`gh_repos` 与 `gh_repo_registry_list` 的回执里都带 `registry` / `ask` 字段，这就是「AI 用工具时主动问用户」的触发点：
库不存在时它会告诉你「把 ask.question 交给用户」，而不是猜。

### 7. 设置面板第二页：仓库登记库

设置 → **仓库登记库**（`settings.section`，id `github-repo-registry`，order 61，挨着 GitHub 页）。
它读 `GET /registry`（授权 + 计数 + 闸门问句）与 `GET /registry/list`（条目与远端绑定），按钮直接打同一套路由：

| 按钮 | 打的路由 | 语义 |
|---|---|---|
| 同意并建立 / 重建 | `POST /registry/build?consent=1` | 人自己点的同意 → 落成一条 grant（`via: ui:registry-panel`） |
| 先看计划 | `POST /registry/plan` | 只读：会登记谁、谁失效，不落盘 |
| 刷新快照 | `POST /registry/build?rescan=1&consent=1` | 重算分支 / HEAD / dirty / ahead-behind |
| 对账 | `POST /registry/verify` | 未登记 / 已消失 / 不再是仓库 / 越界四类漂移 |
| 撤销授权 | `POST /registry/revoke` | 删 grant，库保留可读 |
| 清空库… → 确认清空 | `POST /registry/purge?confirm=1` | 两步确认后删整棵目录 |

页内文案走「压缩预算」：`verify-ui.mjs` 卡可见汉字 ≤ 400（当前 332）与单句 ≤ 60 字，
量尺是 `node tools/copy-count.mjs client.js`。页内直接显示闸门问句原文（未建立时）与最近一次动作的结果（含被拦下的原话）。仓库行上写清
「绑定 github.com/OWNER/repo」或「无远端」，另有「只看无远端」筛选。

**两个「授权」是两件事**（这轮踩出来的）：GitHub 页的「已授权」指**账号凭据**；登记库页的「建库许可」指**要不要落盘这个文件库**。
为了不再混读：登记库页一律说「登记库未建立 / 已有建库许可 / 登记库已建立」，禁用「未授权 / 已授权」两个词；
账号状态在登记库页**只读同一份 `/state?cached=1` 快照**显示（不另存登录态，两页共用一份事实）；页内显式写明与账号登录无关。
`verify-ui.mjs` 的 D 段就是这条用词纪律的回归门禁。

**授权动作留在人手里**：`consent=1` / `confirm=1` 这两条路由要求请求带浏览器来源头（`Origin`/`Referer`），
没有来源头的机器调用一律被拒并回 `E_REGISTRY_CONSENT_ORIGIN` + 闸门问句 —— 用工具驱动机器这条路，
必须先拿到用户在会话里的明确同意。`grant.via` 记下授权从哪来（`ui:registry-panel` / `tool:consent:true` / `recorded-consent`），
`GET /registry` 与面板都会显示。

### 8. 宿主重启后 GUI 页面失效 / 「账号登录页没了」怎么判

宿主每次启动都会 `rm -f /root/.dsha-web.identity` 再 `exec dsh web --no-open …`：**GUI 的会话凭据每次都轮换，
而且不会自动打开浏览器**。旧页面当场失效（未带凭据访问 `http://127.0.0.1:3080/` 回 401），
新入口 URL 只在宿主日志里，而且那行 `dsh web: http://…/?token=***` 的 token **是掩码** ——
容器内没有任何文件能还原它，重开 GUI 只能走 App 自己的入口。

一条命令把这四层分开报（宿主进程 / 插件半边 / 账号登录态 / GUI 会话那一代）：

```bash
bash tools/account-ui-check.sh
```

判读口径：

| 输出 | 含义 | 下一步 |
|---|---|---|
| 插件半边 DOWN | 插件没加载或宿主没起 | 看 `/root/dsh-web.log` 的 `[DSHA_STARTUP]` 段 |
| 已登录 false | 账号确实掉了 | 回话里 `gh_cli_auth_web`，或设置页点「生成一次性码」 |
| 心跳缺失 / pid 不活 | 页面或宿主不在这一代 | 重开 App 的 GUI 入口 |
| 四层都正常但页面看不到 GitHub 页 | 浏览器侧还是旧页面 / 旧 URL / 缓存 | 重开 App 的 GUI 入口，别在旧标签页上硬刷 |

## 工具表

| 工具 | 作用 | 只读 |
|---|---|---|
| `gh_resident_status` | 身份 / 凭据 / helper / 网络 / 仓库总览 | 是 |
| `gh_resident_login` | 持久化 token（0600）+ 写 `~/.git-credentials` + 设 `credential.helper` + 设 git 身份 | 否 |
| `gh_repos` | 枚举根目录下的 git 仓库及分支 / 脏文件 / ahead-behind | 是 |
| `gh_repo_registry` | 建 / 刷 / 对账登记文件库（`status` `plan` `build` `rescan` `verify` `forget` `revoke` `purge`）；`build`/`rescan` 需用户同意 | 否 |
| `gh_repo_registry_list` | 读登记文件库：有哪些仓库、是否绑远端、host/owner、ahead-behind | 是 |
| `gh_commit` | 单仓库 `add -A` + `commit` + 可选 `push` | 否 |
| `gh_sync` | 根目录下**所有脏仓库**一次性提交 + 推送（支持 `dry_run`） | 否 |
| `gh_pr` | 走 REST API 开 PR | 否 |
| `gh_cli_install` | 让 gh 可用（系统层优先，否则自带落地） | 否 |
| `gh_cli_resolve` | 只读报告 gh 的分层来源与架构串 | 是 |
| `gh_cli_version` | 版本体检 + 自更新 | 否 |
| `gh_cache_gc` | 落地缓存 GC | 否 |
| `gh_cli_auth_web` | gh 设备码流程（PTY），抓一次性码并开授权页 | 否 |
| `gh_cli_status` | gh 版本 / 已认证账号 / 凭据助手 / `hosts.yml` 掩码 | 是 |
| `gh_cli_setup_git` | `gh auth setup-git`，可选写 git 身份 | 否 |
| `gh_cli_logout` | 凭据销毁（撤销 + 清副本 + 可选卸 gh） | 否 |
| `gh_protocol` | 机器可读的协议文档 | 是 |

HTTP（只监听 `127.0.0.1`）：`GET /state`、`GET /state?cached=1`、`GET /state?refresh=1`、`GET /gh/version`、`POST /gh/update`、`GET /protocol`、`GET /registry`、`GET /registry/list`、`POST /registry/plan`、`POST /registry/verify`、`POST /registry/revoke`、`POST /registry/purge?confirm=1`、`POST /registry/build?consent=1`、`POST /auth/start`、`POST /logout`。

## 安装

### 方式 A：从 Release 拿包（推荐）

```bash
# 1) 取运行时包与源码包
gh release download v1.6.4 --repo SunsetRNE/dsh-github-resident -D /tmp/ghr
ls /tmp/ghr     # local-dsh-github-resident-v2-1.6.4.tgz + dsh-github-resident-1.6.4-src.tar.gz + SHA256SUMS

# 2) 校验（源码包这一行必须与 SHA256SUMS 一致）
cd /tmp/ghr && sha256sum -c SHA256SUMS

# 3) 解开源码包，用 plugin_manager 以解出来的目录绝对路径执行 install_bundle
tar xzf dsh-github-resident-1.6.4-src.tar.gz
#   → install_bundle /tmp/ghr/dsh-github-resident-1.6.4

# 4) 装完自检
cd /tmp/ghr/dsh-github-resident-1.6.4 && npm run verify   # 期望全部 failed=0

两个包的分工：`*.tgz` 是 npm 打包产物（只含运行所需的 10 个文件）；`*-src.tar.gz` 是完整源码（含 5 个门禁脚本与 LESSONS.md）。

### 方式 B：从源码目录装

```bash
# 1) 检查
node --check plugin.js && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"

# 2) 用 plugin_manager 以本目录绝对路径执行 install_bundle
#    （profile 会把它写成 link:，之后改这里即改插件）

# 3) 门禁
npm run verify          # 期望：bundle pass=8 fail=0，三个验证件 failed=0，真包 runs=true
```

`npm run verify` 等价于：

```bash
bash verify-bundle.sh          # 标识一致 / 语法 / profile 链接 / 回环接口
node verify-logout.mjs         # 19 条：凭据销毁在伪 HOME 下清干净
node verify-registry.mjs       # 63 条：未授权不落盘 / 授权后一仓一文件 / 不污染工作树 / 凭据脱敏
node verify-ui.mjs             # 39 条：宿主真起回环服务打全套面板路由（含来源门）+ 客户端模块/slot 注册 + 两半路径对齐；不含视觉验证
node verify-gh-bootstrap.mjs   # 31 条：系统无 gh 时自带落地（含 fetch 兜底、加载期预置）
node verify-update-gc.mjs      # 34 条：版本自更新 / 缓存 GC / 零检查读
node verify-real-artifact.mjs  # 拿官方 release 真包验抽取器（断网自动 SKIP）
```

## 环境开关

| 变量 | 作用 | 默认 |
|---|---|---|
| `DSH_GH_DATA_DIR` | 自带 gh 与留痕的落盘目录 | `~/.dsh/gh-cli` |
| `DSH_GH_NO_BOOTSTRAP=1` | 关掉加载期自动落地 | 不设（即开） |
| `DSH_GH_NO_STATE_CHECK=1` | 关掉加载期账号检查 | 不设（即开） |
| `DSH_GH_NO_UPDATE=1` | 关掉加载期自更新 | 不设（即开） |
| `DSH_GH_FORCE_FETCH=1` | 跳过 curl，强制走 fetch | 不设 |
| `DSH_GH_UPDATE_TTL_MS` | 自动更新冷却窗口 | `86400000`（24h） |
| `DSH_GH_VERSION_PROBE_TTL_MS` | 版本探测缓存窗口 | `1800000`（30min） |
| `DSH_GH_SNAPSHOT_TTL_MS` | 账号快照有效期 | `90000` |
| `DSH_GH_SNAPSHOT_RETRY_MS` | 快照重建失败后的重试间隔 | `20000` |
| `DSH_GH_RELEASE_API` / `DSH_GH_DOWNLOAD_BASE` | release 元数据 / 下载基址（夹具与私有镜像用） | 官方 |
| `DSH_GH_OAUTH_CLIENT_ID` | 撤销 token 用的 OAuth client id | 占位常量 |
| `DSH_GH_API_PORT` | 插件回环接口端口（设置页/脚本都打它）。改端口要同时给页面注入 `window.__DSH_GITHUB_RESIDENT_API__`，否则面板失联（审计 L12） | `31790` |
| `DSH_GH_REGISTRY_DIR` | 登记文件库的数据根（含 `registry/consent.json`、`index.json`、`repos/`） | `~/.dsh/github-resident` |

## 目录

```
plugin.js                 宿主半边（唯一一份；index.js 逐字节副本已删，见「审计修复」）
client.js                 设置面板（settings.section）
cordis.patch.yml          插件行定义
locale/*.json             界面文案
verify-*.mjs / .sh        门禁（含 verify-registry.mjs）
registry/repos/*.json     仓库登记文件库：一仓一文件（运行期生成，不在仓里）
LESSONS.md                踩坑记录（27 条，含现象 / 真因 / 判据）
```

## 审计修复（1.6.4）

2026-10-10 的代码审计（`plugin-audit/AUDIT-2026-10-10.md`）逐条落实的修复：

| 条目 | 修复 |
|---|---|
| L1 | `findRepos` 按**名字**认 `.git`：worktree / submodule（`.git` 是文件）不再被整棵漏掉（原来 `gh_sync` 会静默跳过它们） |
| L2 | `versionStatus` 的 TTL 真正生效：读路径仍不 fork，过期改由后台回源（原来第二条 `if` 让 TTL 永不生效） |
| L3 | consent 的 `depth` 只保留「扫描深度」一个含义；缺 `depth` 的旧 grant 不覆盖任何请求 |
| L4 | 回环写路由（`/registry/revoke`、`/gh/update`、`/auth/start`、`/logout`）统一来源闸门；`Access-Control-Allow-Origin` 从 `*` 改为只回环来源回显 |
| L5 | `server.on('error')` 不再静默（`/state` 里能看到 `serverError`）；effect dispose 早于 listen 时也会关掉服务器 |
| L6 | `gh_resident_login` 按 host 更新 `~/.git-credentials`（不再整文件覆写）；已有非 `store` 的 helper 不覆盖 |
| L7 | `keep_versions` 下限 1（原来 `0` 会删光所有版本目录） |
| L8 | `run()` 保留 `errno` / `signal`，`ENOENT` 与「命令返回 1」可分辨 |
| L9 | 工具信封的计算值放到展开之后，`ok` 不再被 `out.ok` 覆盖 |
| L10 | `registryPlan` 的死写入删除；`/state` 增 `apiPort` 诊断 |
| L14 | `locale/*.json` 改成宿主口径 `{"meta":{"title","description"}}`（原来本地化从未生效） |
| R1 | 删掉逐字节重复的 `index.js`（门禁新增第 6 节：重复副本 / locale 口径） |
| R2 | 删掉零调用点的 `startDeviceFlow`（`script -qec` 版，54 行） |
| R3/R4 | `syncRepos` 与 `aheadBehind` 抽成单一实现（原来工具体与服务、`repoStatus` 与 `registryGitFacts` 各写一遍） |
| R5 | `client.js` 两页共用一份样式模板 + 一套组件工厂（原 23/31 条规则只差前缀） |
| N1 | 面板不再「只在挂载时读一次」：检查未就绪就 1.5s 自补读（最多 20 次），并在页面重新可见/聚焦时补读 |
| N2 | 账号快照的 TTL 真正生效：过期就在**后台**补查（读路径仍不 fork 子进程），`?cached=1` 回执带 `probe` 阶段 |
| N3 | `SNAPSHOT_RETRY_MS` / `snapshotTriedAt` 从死变量变成失败退避（失败后不立刻重试） |
| N4 | 回执里区分「进行中 / 已就绪 / 失败 / 未启动（`DSH_GH_NO_STATE_CHECK=1`）」，面板按阶段显示 |
| N5 | `resolveGh` 用 `command -v gh` 解析真实路径（原来写死 `/usr/bin/gh`，gh 装在别处就打到不存在的文件） |

## 已知边界

- `DSH_GH_NO_STATE_CHECK=1` 时，只有显式 `?refresh=1` 会去查账号，面板会一直显示「后台检查中…（未触发）」。
- 系统层 gh 由宿主包管理器管；要改成插件自带层，先 `gh_cli_logout {uninstall_gh:true}`。
- 客户端半边改动需刷新页面；宿主半边经 `patchReload: startup`，需重启宿主。
- 登记库只记路径与 git 元数据，不缓存仓库内容；库里的分支 / HEAD / dirty 是**上一次 rescan 时**的快照，要看实时值用 `gh_repos` 或 `verify`。
- 授权不是永久通行证：换 root、放大 depth 都会重新问；`revoke` 后下一次 `build`/`rescan` 也会重新问。
- 来源头只挡「无意中的机器调用」：同一个 uid 的裸 shell 仍能伪造 `Origin`。真正的门是工具路径 —— 它不落盘、只回 ask。
- 面板一页只读文件库，不扫磁盘：条目里的分支 / dirty 是上次 rescan 的快照；要实时值用 `gh_repos` 或点「刷新快照」。

## 文档

- [LESSONS.md](LESSONS.md)：27 条实战踩坑（tar mode 位、GC 与落地撞车、读路径副作用、假 ctx 的 effect 等）。

## 许可

[MIT](LICENSE) © 2026 SunsetRNE
