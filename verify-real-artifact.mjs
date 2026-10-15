/**
 * verify-real-artifact.mjs — 拿官方 release 的真实 tar.gz 验抽取器（不是夹具）。
 *
 * 拉一次 https://api.github.com/repos/cli/cli/releases/latest 的元数据，
 * 下载本架构资产，按主件同构的口径只抽 bin/gh 到临时目录，跑 --version，再删掉。
 * 不写进 ~/.dsh、不动 /usr/bin/gh。
 *
 * 用法: node verify-real-artifact.mjs            # 默认严格：拿不到真包即失败（「没验」不许报成「通过」）
 *       DSH_GH_TAG=v2.102.0 node verify-real-artifact.mjs
 *       DSH_GH_STRICT=0 node verify-real-artifact.mjs   # 显式放宽：断网时 SKIP 并以 0 退出（本机开发用）
 *
 * 上界与重试（2026-10-13 补）：两条网络调用都带 AbortSignal 超时；资产下载重试至多 3 次，
 * 用了几次写进回执的 downloadAttempts。抖动不该报成「抽取器坏了」，但三次都拿不到仍然判红。 */
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { holdLoadLease } from './tests/merge/_load-lease.mjs';

// 重活租约（票 61）：resident 这一族与 verify:merge / verify:deck 共用**同一把锁**（引同一支
// tests/merge/_load-lease.mjs，不抄第二份）；拿不到就 exit 2 + BLOCKED-LOAD-LEASE，本件一条判据都不跑。
holdLoadLease({
  holder: 'verify:resident/verify-real-artifact.mjs@' + (process.env.DSH_SESSION_ID || ('pid' + process.pid)),
  purpose: 'verify:resident（verify-real-artifact.mjs）',
})

// 默认严格。原来默认宽松（`=== '1'` 才算严格），而它被挂在 verify:resident 尾部、
// 又从来没人设过 DSH_GH_STRICT —— 于是「断网 → SKIP → exit 0」被当成了通过，
// 这条本该打公网验证真包的门禁可以天长日久一次都没真跑过。要放宽必须显式写 0。
const STRICT = process.env.DSH_GH_STRICT !== '0';
const ARCH = ({ x64: 'amd64', arm64: 'arm64', arm: 'armv6', ia32: '386' })[process.arch] || process.arch;
const UA = { 'user-agent': 'dsh-github-resident-verify', accept: 'application/vnd.github+json' };
// 两条上界。元数据那次 fetch 原来**没有超时**（整条门禁里唯一可能无上界的等待）；
// 资产下载原来一次定生死，而它在本机实测会抖（三次里红两次，12 秒即 fetch failed）。
// 抖动是网络的性质，不是「抽取器坏了」的证据：给有界重试，并把跑了几次如实写进回执；
// 全部失败仍然判红（strict 时 exit 1），不静默跳过。
const API_TIMEOUT_MS = 30_000;
const DL_TIMEOUT_MS = 180_000;
const DL_ATTEMPTS = 3;
const skip = (why) => { console.log(JSON.stringify({ skipped: true, why })); process.exit(STRICT ? 1 : 0); };

let tag = process.env.DSH_GH_TAG || '';
let assetName = '';
let url = '';
let apiDown = '';
try {
  if (tag) {
    const info = await (await fetch(`https://api.github.com/repos/cli/cli/releases/tags/${tag}`, { headers: UA, signal: AbortSignal.timeout(API_TIMEOUT_MS) })).json();
    assetName = (info.assets || []).map((a) => a.name).find((n) => n.endsWith(`linux_${ARCH}.tar.gz`)) || '';
    url = ((info.assets || []).find((a) => a.name === assetName) || {}).browser_download_url || '';
    tag = info.tag_name || tag;
  } else {
    const meta = await (await fetch('https://api.github.com/repos/cli/cli/releases/latest', { headers: UA, signal: AbortSignal.timeout(API_TIMEOUT_MS) })).json();
    tag = meta.tag_name;
    assetName = (meta.assets || []).map((a) => a.name).find((n) => n.endsWith(`linux_${ARCH}.tar.gz`)) || '';
    url = ((meta.assets || []).find((a) => a.name === assetName) || {}).browser_download_url || '';
  }
} catch (e) {
  apiDown = String(e).slice(0, 120);
  skip('release API 不可达: ' + apiDown);
}
if (!assetName || !url) skip(`release ${tag} 里没有 linux_${ARCH}.tar.gz`);

let buf = null;
let dlAttempts = 0;
let dlWhy = '';
while (!buf && dlAttempts < DL_ATTEMPTS) {
  dlAttempts += 1;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(DL_TIMEOUT_MS) });
    if (!res.ok) { dlWhy = 'HTTP ' + res.status; continue; }
    const got = Buffer.from(await res.arrayBuffer());
    if (got.length === 0) { dlWhy = '响应体为空'; continue; }
    buf = got;
  } catch (e) {
    dlWhy = String(e).slice(0, 140);
  }
}
if (!buf) skip(`资产下载不可达（试了 ${dlAttempts} 次）: ${dlWhy}`);
const gz = zlib.gunzipSync(buf);

const magic = gz.subarray(257, 263).toString('latin1');
let off = 0;
let hit = null;
while (off + 512 <= gz.length) {
  const nm = gz.subarray(off, off + 100).toString('utf8').replace(/\0.*$/, '');
  if (!nm) break;
  const size = parseInt(gz.subarray(off + 124, off + 136).toString('ascii').replace(/\0.*$/, '').trim(), 8) || 0;
  const type = String.fromCharCode(gz[off + 156]);
  const mode = parseInt(gz.subarray(off + 100, off + 108).toString('ascii').replace(/\0.*$/, '').trim(), 8) || 0;
  if ((type === '0' || type === '\0') && /(^|\/)bin\/gh$/.test(nm) && size > 0) { hit = { nm, size, mode, at: off }; break; }
  off = off + 512 + Math.ceil(size / 512) * 512;
}
if (!hit) { console.log(JSON.stringify({ ok: false, why: 'tar 里没找到 bin/gh', tag, assetName })); process.exit(1); }

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gh-real-'));
const dest = path.join(dir, 'gh');
const mode = (hit.mode & 0o777) || 0o755;
await fs.writeFile(dest, gz.subarray(hit.at + 512, hit.at + 512 + hit.size), { mode });
await fs.chmod(dest, mode);
const run = await new Promise((r) => execFile(dest, ['--version'], (e, o) => r({ code: e ? 1 : 0, out: (o || '').trim() })));
await fs.rm(dir, { recursive: true, force: true });

const report = {
  tag,
  asset: assetName,
  downloadBytes: buf.length,
  downloadAttempts: dlAttempts,
  ustarMagic: JSON.stringify(magic),
  entry: hit.nm,
  entryBytes: hit.size,
  mode: '0' + mode.toString(8),
  runs: run.code === 0,
  version: run.out.split('\n')[0] || null,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.runs && mode === 0o755 ? 0 : 1);
