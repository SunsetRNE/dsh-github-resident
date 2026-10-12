# tests/merge/build —— 构建与发布形态契约（构建负责人）

跑法（先构建，再跑）：

```bash
npm run build            # = node tools/merge/build-merge-entries.ts --build-all
npm run verify:merge     # = node tests/merge/run.mjs（隔离运行 tests/merge/build|host|client）
# 也可以单跑某一支
node tests/merge/build/manifest-contract.test.mjs
node tests/merge/build/client-union.test.mjs
node tests/merge/build/pack-contract.test.mjs
```

## 这三个文件各管什么

| 文件 | 管的退化 | 关键手法 |
|---|---|---|
| `manifest-contract.test.mjs` | 身份漂移（package/patch/client 三处不一致）、exports/files 漏配、运行时依赖多一个少一个、engines 说谎、偷偷给根加 `prepare` | 直接读根清单 + 扫随包源码（含动态 import 字面量）求真实依赖集 |
| `client-union.test.mjs` | 「改名 Deck」冒充合并：只剩半边 UI、dock/右栏/RunPanel 注册丢失、inject 不是并集 | jsdom 里真跑 `dist/client.js`，用记账式 `slots` stub 收注册，逐条核对 7 条注册 |
| `pack-contract.test.mjs` | 作者态路径偶然成功：`npm pack` 后 exports 解析不到、`plugin.js`/技能文件没进包、相对导入指向包外 | `npm pack` → 解包装进临时 fixture 的 `node_modules` → 真 `import()` + 62 项文件/导入图断言 |

## 纪律（改这些测试的人先读）

- **不打折**：包根 `bundled-skills/` 的 27 个技能、`plugin.js`、`dist/` 三样少一个就是发布事故，不做「环境不支持就跳过」。
- **不借旁边的源码**：`pack-contract` 只在 tarball 解出的目录 + 显式补的运行时依赖里解析；任何相对导入走到仓库根都算失败（见该文件第 7 节的「不许出现作者态仓库路径」）。
- **不碰真实环境**：`tests/merge/run.mjs` 给每个子进程一份临时 `HOME`/`TMPDIR`/`XDG_*`，清空 `GH_TOKEN`/`GH_CONFIG_DIR` 并把 `DSH_GH_*` 指到临时目录；`verify-bundle.sh` 默认也只打临时 fixture profile。
- **环境限制**：`deck/tests/*-browser.js` 需要 Chromium，本容器没装（`playwright` 以 `--ignore-scripts` 安装），相关门禁在屏障后由集成人在有浏览器的环境跑。详见 `docs/merge-work-build.md`。
