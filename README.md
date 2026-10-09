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

- `gh_cli_version`：比对当前与最新版官方 release；`update:true` 才动手（只替换插件自带的那份，系统层只报告并给出去路）。同来源 24h 冷却，版本探测结果缓存 30 分钟。
- `gh_cache_gc`：清理 `~/.dsh/gh-cli` 里的下载残留、`deb-extract` 临时目录、超出保留份数的旧版本（默认保最新 2 份）；与落地互斥，不会删掉正在下载的包。

### 4. 设置面板：默认只读，不偷偷查账号

- `GET /state` **纯读**：只回内存里的快照，绝不 fork 子进程、绝不触发账号检查；没有快照时回骨架（`probing:true`、`authenticated:null`）。
- 检查只发生在两处：**插件加载期后台一次**、显式 `GET /state?refresh=1`（面板的「立即刷新」）。
- 面板显示：状态徽标、凭据助手、gh 凭据路径、gh 来源层、当前/最新版本、快照时间（过期会标「已过期 · 缓存」）。

### 5. 后台工具

`gh_resident_status` / `gh_repos` / `gh_commit` / `gh_sync`（多仓库一次性提交推送）/ `gh_pr`（REST 开 PR）/ `gh_cli_status` / `gh_cli_setup_git`。工具返回值统一带 `{ protocol, ok }` 信封，失败也保留原字段。

## 工具表

| 工具 | 作用 | 只读 |
|---|---|---|
| `gh_resident_status` | 身份 / 凭据 / helper / 网络 / 仓库总览 | 是 |
| `gh_resident_login` | 持久化 token（0600）+ 写 `~/.git-credentials` + 设 `credential.helper` + 设 git 身份 | 否 |
| `gh_repos` | 枚举根目录下的 git 仓库及分支 / 脏文件 / ahead-behind | 是 |
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

HTTP（只监听 `127.0.0.1`）：`GET /state`、`GET /state?cached=1`、`GET /state?refresh=1`、`GET /gh/version`、`POST /gh/update`、`GET /protocol`、`POST /auth/start`、`POST /logout`。

## 安装

### 方式 A：从 Release 拿包（推荐）

```bash
# 1) 取运行时包与源码包
gh release download v1.4.0 --repo SunsetRNE/dsh-github-resident -D /tmp/ghr
ls /tmp/ghr     # local-dsh-github-resident-v2-1.4.0.tgz + dsh-github-resident-1.4.0-src.tar.gz + SHA256SUMS

# 2) 校验（源码包这一行必须与 SHA256SUMS 一致）
cd /tmp/ghr && sha256sum -c SHA256SUMS

# 3) 解开源码包，用 plugin_manager 以解出来的目录绝对路径执行 install_bundle
tar xzf dsh-github-resident-1.4.0-src.tar.gz
#   → install_bundle /tmp/ghr/dsh-github-resident-1.4.0

# 4) 装完自检
cd /tmp/ghr/dsh-github-resident-1.4.0 && npm run verify   # 期望全部 failed=0

两个包的分工：`*.tgz` 是 npm 打包产物（只含运行所需的 10 个文件）；`*-src.tar.gz` 是完整源码（含 5 个门禁脚本与 LESSONS.md）。

### 方式 B：从源码目录装

```bash
# 1) 检查
node --check index.js && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"

# 2) 用 plugin_manager 以本目录绝对路径执行 install_bundle
#    （profile 会把它写成 link:，之后改这里即改插件）

# 3) 门禁
npm run verify          # 期望：bundle pass=8 fail=0，三个验证件 failed=0，真包 runs=true
```

`npm run verify` 等价于：

```bash
bash verify-bundle.sh          # 标识一致 / 语法 / profile 链接 / 回环接口
node verify-logout.mjs         # 19 条：凭据销毁在伪 HOME 下清干净
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

## 目录

```
index.js / plugin.js      宿主半边（同一份内容，plugin.js 是入口）
client.js                 设置面板（settings.section）
cordis.patch.yml          插件行定义
locale/*.json             界面文案
verify-*.mjs / .sh        门禁
LESSONS.md                踩坑记录（23 条，含现象 / 真因 / 判据）
```

## 已知边界

- `DSH_GH_NO_STATE_CHECK=1` 时，只有显式 `?refresh=1` 会去查账号，面板会一直显示「后台检查中…（未触发）」。
- 系统层 gh 由宿主包管理器管；要改成插件自带层，先 `gh_cli_logout {uninstall_gh:true}`。
- 客户端半边改动需刷新页面；宿主半边经 `patchReload: startup`，需重启宿主。

## 文档

- [LESSONS.md](LESSONS.md)：23 条实战踩坑（tar mode 位、GC 与落地撞车、读路径副作用、假 ctx 的 effect 等）。

## 许可

[MIT](LICENSE) © 2026 SunsetRNE
