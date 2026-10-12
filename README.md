# dsh-github-resident · 自托管分发包（GitHub Pages）

机器读 `index.json`；当前版本以它为准。

## 当前

- **v1.7.3** · `sunsetrne-dsh-github-resident-v2-1.7.3.tgz`
- 装法：`npm i https://sunsetrne.github.io/dsh-github-resident/sunsetrne-dsh-github-resident-v2-1.7.3.tgz`
- 装前判据：解包后 `node --input-type=module -e "import('./dist/host.js').then(()=>console.log('LOADED-OK'))"`
  **必须打印 `LOADED-OK`** —— 这条是 v1.7.2 事故后加的发布门禁。

## 已废弃（勿装）

| 版本 | 为什么 |
| --- | --- |
| v1.7.2 | 宿主入口桩 `dist/host.js` 期望旧包名 `@local/…`，而包的 `name` 已是 `@sunsetrne/…` → 加载期抛「找不到合并包根」→ 插件宿主半边不加载（工具栏/侧边栏消失、回环 31790 不监听） |
| v1.7.0 | 包名与身份仍是旧名 `@local/…`；只作通道自检样本，不当更新源用 |

两份旧包文件仍留在本分支上（便于比对与回滚），但**不要安装**。
