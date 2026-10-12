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
