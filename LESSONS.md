# 踩坑记录：给 DSH 写第三方 bundle（以 github-resident 为例）

记录时间：2026-10-09（Asia/Shanghai）。范围：本机 profile `web`、DSH 0.2.0-rc.2、Node v24.19.0、gh 2.102.0。
每条的「判据」都是可以直接跑一条命令看到的，不靠记忆。

配套自检脚本：`bash verify-bundle.sh`（本目录），装/改名/重启后跑一次，`pass=8 fail=0` 才算干净。

---

## 坑 1（最狠）：client.js 里的模块 id 必须**逐字等于包名**

- **现象**：重启后整页挂掉，横幅写着
  `Failed to load plugins / @local/dsh-github-resident-live / web boot: 1 entry did not activate`，
  并附带 `.../client.js: loaded without registering "@local/dsh-github-resident-live" via __ModuleLoader__.load`。
- **真因**：改了包名（`…-gh` → `…-live`），却没改 `client.js` 里 `window.__ModuleLoader__.load({ id })`。注册 id 与包名不符 = 等于没注册，整个 bundle 在 web boot 阶段失败。
- **判据**：`grep -n "id: '@local" client.js` 与 `node -e "console.log(require('./package.json').name)"` 对比，必须一模一样。
- **正确做法**：改包名时**同一批**改三处（见坑 2）。

## 坑 2：三处标识是一个整体，漏一处就炸

| 位置 | 字段 |
|---|---|
| `package.json` | `name` |
| `cordis.patch.yml` | `name:`（模块名）与 `id:`（entry id，可不同但建议同源） |
| `client.js` | `__ModuleLoader__.load({ id })` |

`verify-bundle.sh` 第 1 节自动比对这三处，输出 `IDENTITY_SAME=`。

## 坑 3：改了宿主半边代码，**换文件名 / 换 entry id 都不生效**

- **现象**：改了 `index.js` 后 `remove_bundle` + `install_bundle`，新加的 `GET /protocol` 依然 404，老逻辑照跑。
- **实测三次**：
  1. 同名同目录只改内容 → 仍旧代码；
  2. 把入口拆成 `plugin.js` 并改 `exports` → 仍旧代码（404 依旧）；
  3. 只把 entry id 改成 `github-resident-v2` → 仍旧代码（404 依旧）；
  4. **改包名 `…-live` → `…-v2`（并同步坑 2 三处 + 目录改名）→ 立刻生效**（`/protocol` 200）。
- **结论**：这个宿主的模块缓存按**包名**（bare specifier）走；要让新代码进内存，必须换包名。没有重启权限时，这就是唯一可靠路径。
- **正确做法（无重启）**：
  ```bash
  mv <dir> <dir>-vN                                   # 目录顺手也换，避免残留链接
  sed -i 's/老包名/新包名/' package.json cordis.patch.yml
  sed -i "s/id: '老包名'/id: '新包名'/" client.js      # 别忘这一处
  # 然后：remove_bundle 老包名 → install_bundle 新目录
  ```
- **有重启权限时更简单**：先 `remove_bundle` → 重启 → `install_bundle`，不用改名。

## 坑 4：`ctx.tools.register` 要「注册表就绪」的 schema，别照抄简写

- **现象**：`JsonSchemaError: unsupported JSON schema: schema.type must be one of object/array/…`，entry 不激活。
- **真因**：内置插件写 `parameters: { field: { type:'string', required:true } }` 和 `output.schema: { type:'json' }` 能过，是因为它们经 `defineTool()` 归一化了；**第三方 bundle 里 `@deepseek-ai/dsh-tools` 解析不到**（实测 `ERR_MODULE_NOT_FOUND`），只能手写完整 JSON Schema。
- **正确做法**：
  - `parameters` → `{ type:'object', properties:{…}, required:[…], additionalProperties:false }`；
  - 字段级的 `required: true` 要提升到对象级 `required` 数组，字段节点里不能留；
  - `output.schema` 用 `{ type:'object' }`（`{type:'json'}` 非法）。

## 坑 5：目录改名会留下**悬空软链**，一定要清

- **现象**：`node_modules/@local/` 里堆了三四个指向已被改名/删除目录的断链；重启期出现异常。
- **判据**：
  ```bash
  L=/root/.dsh/profiles/web/node_modules/@local
  for f in "$L"/*; do [ -e "$f" ] && echo "OK $(basename $f)" || echo "悬空 $(basename $f) -> $(readlink $f)"; done
  ```
- **正确做法**：`rm -f "$L/<悬空名>"`——只删链接，不碰目标。`verify-bundle.sh` 第 3 节会替你查。
- **注意**：本次启动异常的直接触发点最终定位到的是坑 1（模块 id），断链是并行存在的第二问题；两者都要清。

## 坑 6：**重启会摘掉第三方 bundle**（本 profile 观测两次）

- **现象**：重启后 `profiles/web/package.json` 的 dependencies 回到内置集，插件消失、回环接口 000。
- **判据**：`node -e "console.log(Object.keys(require('/root/.dsh/profiles/web/package.json').dependencies))"`。
- **正确做法**：每次重启后重跑一次 `plugin_manager install_bundle <绝对目录>`；客户端半边另需刷新页面。

## 坑 7：gh 的设备码流程有三个坑，缺一个都拿不到 token

1. **必须真 TTY**：`script -qec` 转发非终端 stdin 不可靠；用 `python3 pty.fork()`。
2. **必须应答 `ESC[6n`**：gh 的 survey 会查光标位置，不回就一直卡；回 `\x1b[1;1R`。
3. **必须持续补回车**：打印一次性码之后 gh 停在 `Press Enter to open … in your browser`，**只补一次不够**（落在它开始读输入之前就白喂），结果永远不会进入轮询 → 你在浏览器点了 Authorize，也没有任何进程去换 token，`~/.config/gh/` 一直是空的。
   - **判据**：授权后 `ls ~/.config/gh/hosts.yml`；没有就是没轮询成功。
   - **正确做法**：拿到码之后每秒补一个 `\n`，并把轮询窗口放宽到 900 秒；检测到 `hosts.yml` 出现就能判定结束。

## 坑 8：`gh auth setup-git` 写的是 **host 作用域** 的 helper

- **现象**：`git config --global credential.helper` 是空的，页面「凭据助手」永远显示"未设置"。
- **真相**：它写的是 `credential.https://github.com.helper = !/usr/bin/gh auth git-credential`。
- **判据**：`git config --global --get-all 'credential.https://github.com.helper'`；
  端到端验证：`GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/<user>/<repo>.git HEAD`。

## 坑 9：回环接口里的重活会让短超时的调用看起来"挂了"

- **现象**：`curl -m 5 /state` 偶尔 `HTTP 000`，重试就好。
- **真因**：`/state` 内部要跑 `gh auth status` + `gh api user` 两个子进程（要出网），响应要 1–3 秒，偶发超过 5 秒。
- **正确做法**：调用方给 ≥12 秒并重试；服务端加 30 秒 TTL 缓存（本项目尚未加）。

## 坑 10：`pkill -f "<关键词>"` 会把自己的命令行一起杀了

- **现象**：`pkill -f "script -qec"` 之后，**执行这条命令的 shell 自己被 SIGTERM**。
- **真因**：`-f` 匹配整条命令行，而我自己这条命令里就含那个字符串。
- **正确做法**：先 `ps -eo pid,args | awk '/关键词/ && !/awk/ {print $1}'` 拿 PID 再按 PID kill。

## 坑 11：Token 有 5 份副本，其中 4 份不在插件目录里 → 卸载不销毁凭据

- **现象**：`remove_bundle` 只做「停插件 + pnpm remove」，宿主侧的凭据一个都不动。
- **实测（2026-10-10，本机）**：
  | 副本 | 位置 | 归谁写 | 卸载后 |
  |---|---|---|---|
  | OAuth token（host 级 + user 级各一条） | `~/.config/gh/hosts.yml`（0600） | gh 自己 | 留下 |
  | `credential.helper` | `git config --global` | `gh auth setup-git` | 留下 |
  | 明文 token | `~/.git-credentials`（0600） | `gh_resident_login` | 留下 |
  | token | `~/.dsh/github-resident.json`（0600） | `gh_resident_login` | 留下 |
  | `gh` 二进制 39 MB | `/usr/bin/gh`（dpkg 包 `gh`） | `gh_cli_install` 的 `dpkg -i` | 留下 |
- **正确做法**：卸载前先跑 `gh_cli_logout`（`confirm:true` + 需要的开关），再 `remove_bundle`。
  不给 `confirm` 时它只回勘察报告，不动任何东西。
- **判据**：`curl -s http://127.0.0.1:31790/protocol | grep gh_cli_logout`；拆除后 `leftover` 必须为空数组。

## 坑 12：测试脚本先 import 插件再改 HOME = 打到真 HOME

- **现象**：`verify-logout.mjs` 第一版把 `HOME` 指向 mktemp 目录，`leftover` 却报 `hosts.yml`、`/usr/bin/gh` 还在，同时**真 `~/.git-credentials` 和 `~/.dsh/github-resident.json` 被删掉了**。
- **真因**：插件的 `HOME = os.homedir()` 是**模块加载期**求值的；`import` 完再设 `process.env.HOME` 已经晚了。
  另外 `execFile` 要给 git 显式传 `HOME` + `GIT_CONFIG_GLOBAL`，否则子进程写的是真全局配置。
- **正确做法**：`os.homedir = () => FAKE_HOME` 必须在 `await import(plugin)` **之前**，同时改 `process.env.HOME`。
- **判据**：脚本最后一条断言「真 HOME hosts.yml 未被触碰」必须 PASS。

---

## 坑 13：插件装完不等于 gh 可用 —— 宿主没装 gh 时整条链是死的

- **现象**：`gh_cli_auth_web` / `gh_cli_status` / `gh_resident_*` 全部报「先跑 gh_cli_install」，用户还得自己装一次。
- **真因**：旧实现只在**显式调用** `gh_cli_install` 且系统没有 gh 时才走 `dpkg -i`（要 root、动系统包库）；插件本身不携带 gh。
- **正确做法（本轮）**：`resolveGh()` 成为全插件唯一入口，三层：
  1. `system` — PATH 里有能跑的 gh 就用，不抢用户的；
  2. `plugin-cache` — 自带一份在 `~/.dsh/gh-cli/bin/gh`（0600/0755，**不动系统包库、不需要 root**）；
  3. 都没有且没禁自动落地 → 下载官方 `tar.gz`，用内置 ustar 解析器只抽 `bin/gh` 写盘；失败退回 `dpkg --force-not-root --extract` 抽 `.deb`。
- **判据**：`node verify-gh-bootstrap.mjs`（伪 PATH 里放一个跑不起来的同名 gh，走真实 tar.gz 字节流）必须 `failed=0`；
  线上看 `gh_cli_resolve` 的 `resolved` 字段与 `~/.dsh/gh-cli/install.json`。

## 坑 14：`verify-logout.mjs` 里「真实路径」不进 PATH 时 curl 也没了

- **现象**：把 `PATH` 清空来模拟「宿主没装 gh」，结果落地全报「下载失败 httpCode=""」。
- **真因**：`curl`、`dpkg` 也在 `PATH` 里；清空 PATH 等于把这些也一起挡掉，测的是假失败。
- **正确做法**：在 `FAKE_PATH` 里放一个 `exit 127` 的同名 `gh` 占位，然后把**真 PATH 接在后面** —— 只有 gh 被遮蔽，其它工具照旧。
- **判据**：同一脚本里 `A 系统层判定为不可用` 与 `B 落地用的是 tarball 步骤` 两条同时 PASS。

## 坑 15：下载地址别手拼

- **现象**：夹具端点上 `http://…/dl/<tag>/<asset>` 404，而 API 明明给了 `browser_download_url`。
- **正确做法**：优先用 release API 返回的 `browser_download_url`，拼串只作兜底（`assetUrl()`）；`curl` 加 `-w %{http_code}` 把状态码带进诊断，失败信息里同时给 `httpCode`。

## 坑 16：假 ctx 里 `effect: () => {}` 会让加载期逻辑根本不执行

- **现象**：`gh_cli_resolve` 报 `resolved:"none"`，明明刚加了「加载期预置」。
- **真因**：测试用的假 ctx 把 `effect` 写成空函数，插件注册的 effect 回调从没被调用过。
- **正确做法**：假 ctx 里执行一次回调 —— `effect: (fn) => { try { fn(); } catch {} }`。
- **判据**：`H 未调用任何工具就已落地 gh` 与 `H2 关闭开关后不自动落地` 必须同时 PASS（一正一反才说明开关真的生效）。

## 坑 17：子进程测试的等待窗口不能用「开关」反推

- **现象**：`DSH_GH_NO_BOOTSTRAP=1` 的场景照样报「已落地」。
- **真因**：等待窗口写成「开关是 1 就等 3 秒」，而子进程里判断的是**自己的** env；父进程的开关没跟着改，窗口仍是 20 秒，结果前一个场景的 20 秒等待把结论污染了。
- **正确做法**：把等待窗口作为显式参数（`CHILD_WAIT_MS`）传进子进程，并从 `env` 里读；负向场景断言「窗口内没有写出 install.json」，不只看最终 `resolved`。

## 坑 18：tar 里 mode 字段带 setuid 位，别当成 0700 之类

- **现象**：真实 `gh_2.102.0_linux_arm64.tar.gz` 中 `bin/gh` 的 mode 字段是 `0100755`。
- **真因**：tar 头 100–108 是 mode，常把文件类型位一起写进去；直接 `parseInt(...,8)` 会拿到 0o100755。
- **正确做法**：`mode & 0o777` 再落盘（主件 `readUstarPath` 已做）；`verify-real-artifact.mjs` 断言最终磁盘权限是 `0755`。
- **顺带确认**：官方包 magic 是 ustar 0（`"ustar\u0000"` 六字节），不是 GNU 长名那版 —— 纯 Node 的 ustar 解析器够用。

## 坑 19：加载期预置和手动落地会撞车，GC 会删掉正在用的包

- **现象**：`gh_cli_version {update:true}` 报 `抽取失败: ENOENT ... gh_9.9.9_linux_arm64.tar.gz`，同时磁盘上的二进制确实被换新了。
- **真因**：加载期后台落地跑完会 `gcCache()` 清残留；并发的第二次落地正好在下同一个包，被前一个 GC 删了。
- **正确做法**：`ensureGh` 与 `gcCache` 各自加单飞（in-flight promise）互斥；`ensureGh` 进入前先 `await gcInFlight`。
- **判据**：`verify-update-gc.mjs` 的 `1 update:true 完成升级` + `1 落地用的是 tarball` 同时 PASS。

## 坑 20：改完文件立刻 probe，mtime 缓存会说「还是旧版本」

- **现象**：自更新报 `to: 9.9.9`，紧接着 `gh_cli_version` 仍回 `current: 9.0.0`、`updateAvailable: true`。
- **真因**：`ghMemo` / `probeCache` 以 mtime+size 做键，而同一秒内重写文件时 mtime 可能没变（或变化粒度不足）。
- **正确做法**：升级后 `versionState = null`、`ghMemo = null`，并用 `probeGh(GH_BIN, {fresh:true})` 直接读盘判定 `after`。
- **判据**：`1 复检变成已是最新` 与 `1 不带 update 只报告不动手` 必须同时 PASS。

## 坑 21：把「读状态」做成同步检查，设置页一开就卡

- **现象**：`GET /state` 要跑 `gh auth status` + `gh api user` 两个出网子进程，首次打开设置页 1–3 秒白屏。
- **正确做法**：`/state` 默认只回快照（TTL 90s），过期就在后台重建；首访回骨架（`probing:true`）并让 UI 静默补两次；只有 `?refresh=1` 才同步重建。
- **判据**：`verify-update-gc.mjs` 的 `3 第二次读走快照（<300ms）`、`3 骨架态明确标注未检查`、`3 ?refresh=1 同步重建出真实结果` 三条同时 PASS。

## 坑 22：`status: () => statePayload()` 把 options 吃掉了

- **现象**：`svc.status({ refresh: true })` 调了却什么都不重建，回的还是骨架；`cached` 读反而偶尔触发一次检查。
- **真因**：服务层写成 `status: () => statePayload()`，调用方传的 `{refresh, cached}` 全被吞掉，一律按默认分支走。
- **正确做法**：`status: (opts = {}) => statePayload(opts)`；并且 `statePayload` 的两个分支都要显式写 `cached` 标志，别让调用方靠猜。

## 坑 23：把「读」当检查触发器，UI 一开就跑 gh

- **现象**：用户反馈「点开设置页还是会检查账号状态」。
- **真因**：读路径里内嵌了 `refreshSnapshot()` 副作用，加上设置页首屏那个「静默补两次」的轮询，等于每次打开面板都在跑 `gh auth status` + `gh api user`。
- **正确做法**：读路径彻底纯化（`readSnapshot` 只回内存里的快照）；检查只留加载期一次 + 显式 `?refresh=1`；UI 首屏只发一次 `?cached=1`，删掉轮询。
- **判据**：用一个「被调用就记账」的 gh 桩量调用次数 —— `verify-update-gc.mjs` 的 `3 连读 5 次都不调 gh（零检查）` 与 `3 ?refresh=1 才真的去查` 必须同时 PASS。

---

## 安装 / 改名 SOP（照这个顺序做，不会炸）

0. 要连带销毁凭据：先 `gh_cli_logout`（`confirm:true, revoke:true, purge_git:true, reset_state:true, uninstall_gh:true`），再往下走。
1. 改代码。
2. `node --check` 每个 JS 文件。
3. 若改了包名：同步 `package.json` / `cordis.patch.yml` / `client.js` 三处 → `mv` 目录。
4. `plugin_manager remove_bundle <旧包名>`（有就删，会顺手清链接）。
5. `plugin_manager install_bundle <新目录绝对路径>`。
6. `npm run verify` → `verify-bundle.sh` 必须 `fail=0`，四个 node 验证件都必须 `failed=0`（`verify-real-artifact.mjs` 断网时 SKIP 不算失败）。
7. 客户端半边改动：**刷新页面**（非 `dev:web` 模式没有热更新）。
8. 每次宿主重启后：回到第 5 步。

## 一条命令看全貌

```bash
cd /root/GitHub/gh-resident-v2 && bash verify-bundle.sh
```
