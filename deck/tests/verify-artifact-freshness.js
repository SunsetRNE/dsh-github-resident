// verify-artifact-freshness.js — 产物是不是比源码旧（票 #3 后续：真机「改了看不到」的根因）
//
// 为什么要有这一道（2026-10-13 真机踩到）：
//   宿主加载的是**合并包产物** `dist/client.js`（根 package.json 的 exports → ./dist/host.js / ./dist/client.js），
//   而 `npm run build:deck` 只重建 `deck/client.js`。于是改了 deck/src/** 之后再跑 build:deck，
//   真机上永远是旧的那一版 —— 看起来就是「改了没生效 / 启用后又被禁用」。
//   判据只有一条：dist/client.js 必须比 deck/src/** 与 deck/client.js 新；否则红。
// 用法：node tests/verify-artifact-freshness.js   （exit 0 = 产物是新的）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 本文件住在 deck/tests/：上一级是 deck/，再上一级才是仓库根（dist 与合并包清单都在根上）
const DECK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(DECK_DIR, '..');
const DIST = path.join(ROOT, 'dist/client.js');
const DIST_HOST = path.join(ROOT, 'dist/host.js');
const DECK = path.join(DECK_DIR, 'client.js');

const newestUnder = function (dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) newestUnder(p, acc);
    else if (/\.(js|mjs|json|css)$/.test(name)) acc.max = Math.max(acc.max, st.mtimeMs);
  }
  return acc;
};
const mtime = function (p) { try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; } };

let ok = true;
const check = function (cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };

const src = newestUnder(path.join(DECK_DIR, 'src'), { max: 0 }).max;
const distT = Math.max(mtime(DIST), mtime(DIST_HOST));
check(fs.existsSync(DIST) && fs.existsSync(DIST_HOST), '合并包产物在：dist/client.js + dist/host.js');
check(distT > 0 && src > 0, '两侧时间都读得到（源码 ' + new Date(src).toISOString() + '）');
check(distT >= src, 'dist 不比 deck/src 旧（dist ' + new Date(distT).toISOString() + ' vs 最新源 ' + new Date(src).toISOString() + '）');
check(distT >= mtime(DECK), 'dist 不比 deck/client.js 旧（避免只跑 build:deck 就以为完事）');
const client = fs.readFileSync(DIST, 'utf8');
check(/dsws-bar-scroll/.test(client) || src < mtime(DIST) - 60000, 'dist 里能看到最近那批改动（dsws-bar-scroll）或有明确证据说明它早于本次改动');
console.log(ok ? '产物新鲜度：全部通过' : '产物新鲜度：存在过期项 —— 跑 `npm run build`（不是 build:deck）重装配 dist');
process.exit(ok ? 0 : 1);
