# 2026-10-12 合并交付核查

## 结论

合并源码在 `feat/merge-skills-deck`，包名 `@local/dsh-github-resident-v2`，版本 `1.7.0`。本轮已补齐构建、修正一个实际 React Hooks 缺陷并生成本地试装产物。仓库仍是未提交的工作副本；未 push、未发布到互联网，也未修改运行 profile。

当前运行环境仍为 Resident 1.6.4 + 独立 Deck 1.7.51。合并使用既有导入的 Deck 1.8.0-rc.7 源码，不是只把当前运行的 1.7.51 换包装。

## 接续时的问题与本轮修复

1. 上次共享工具表的 `exec-cell` 与宿主 `refresh/wiring` 修复已写进源文件，但发布镜像没有更新。全量链的逐文件哈希检查真实失败；本轮重建后，该检查已通过。
2. 合并界面测试多处 `check(label, result)` 参数颠倒，字符串被当作结果，出现 `PASS false`。本轮统一参数并给公共断言加入类型守卫。修正后先真实复现了 4 项夹具失败，再改为从 React Provider 渲染参数观察上下文，并在首次提交之后等待双帧挂载。
3. 测试不再漏检后，发现实际 `FormModalSeat` 在关闭、布局卡、表单之间切换时改变 Hooks 顺序。直接调用 `SetupLayoutCard(...)` 混入子组件 Hooks，且表单 Hooks 位于可变条件返回之后。本轮改为 React 子组件渲染，表单有独立 `FormModalContent`；新增 Hooks 错误捕获断言，已先红后绿。
4. Resident 的 gh 安装测试硬编码系统必须有 `/usr/bin/gh` 与 dpkg 记录。本机使用插件缓存层，因此错误失败。本轮改为比较系统与真实缓存的测试前后状态；没有安装或卸载真实 gh。
5. 更新中英文包显示名称、说明和升级次序，避免用户把合并包误认成旧 Resident。

## 本轮执行证据

| 检查 | 结果 |
|---|---|
| `npm run build` | 退出 0，包含全部内置 TypeScript 核检查与产物生成 |
| `npm run check:entries` | 退出 0，入口与源重算一致，27 个技能副本一致 |
| `npm run verify:merge` | 16 组通过，失败 0，阻塞 0 |
| 合并完整客户端挂载与交互 | 62 项通过，包括菜单、表单、工作区/会话隔离、收起展开、右栏卸载重开、Hooks 稳定性 |
| 打包契约 | 真实 tgz 解包、导出解析和 import 均通过；225 文件的 Deck 宿主导入图可达，旧包不是运行依赖 |
| Resident 体检、退出清理、登记库、界面接线 | 已通过；后续 bootstrap 初次因环境假设失败，修正后 31 项通过 |
| Resident update/gc 与官方真实压缩包 | 退出 0；GitHub CLI 2.102.0 linux_arm64 可执行 |
| `npm run verify:deck:smoke` | 6 个脚本均退出 0；源叶子直引有非阻断 WARN，完整合并客户端另有实际挂载检查 |
| `npm run verify:deck` | 中止于 `verify-958-label-name-visible.js`：缺 Playwright Chromium 可执行文件，之后的检查未跑，不能宣称全量 237 项全绿 |
| `git diff --check` | 通过 |

尚有 React 列表 key 提示；本轮已经清除可复现的 Hooks 顺序错误。没有做真机安装、深浅色视觉检查或现有用户数据的实际升级验证，不能据此确认用户此前那次崩溃的完整原因。

## 独立核查

使用用户指定的 `deepseek-official/deepseek-flash` 进行了只读交叉核查。确认包内入口、技能目录、运行依赖足够独立使用；指出新旧 Deck 同时启用会发生同名工具、技能 provider 和槽位冲突。该审查基于当时 tgz，最终交付以本轮重建后的产物为准。

## 安装顺序与交付

先停用独立的 `dsh-mattpocock-skills-deck` 整包及其 tools 组件，再导入 1.7.0 升级 Resident，完成后重启 DSH。确认功能正常，再由插件管理器卸载旧 Deck，保留共享数据。不要先手工删除被 profile 通过 link 引用的旧目录。

最终产物、校验文件和中文安装说明位于工作区 `merge-release-validation/delivery-20261012/`。原两个回退包仍在 `merge-release-validation/dsv41-prep/rollback/`。

DSHA `/app/export` 已成功导出至手机公共下载区（按桥协议为 Download/DSHA）：

- 安装包：`local-dsh-github-resident-v2-1.7.0.tgz`，2,780,422 字节，781 个文件；回执 `content://media/external/downloads/500`。
- 试装说明：`INSTALL-1.7.0-zh.md`；回执 `content://media/external/downloads/501`。
- 校验文件：`SHA256SUMS-1.7.0.txt`；回执 `content://media/external/downloads/502`。
- 安装包 SHA-256：`02b7b4a35a70e170d1bad393652eb1310a985a97af9afa5246934a1208d48998`。

最终 tgz 的 781 个文件与当前源码/构建产物逐字节一致，`sha256sum -c` 通过。公共目录枚举被设备桥拒绝，未改用其他通道枚举；设备侧交付依据为三个明确的导出成功回执。