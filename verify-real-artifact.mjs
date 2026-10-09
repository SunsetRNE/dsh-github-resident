/**
 * verify-real-artifact.mjs — 拿官方 release 的真实 tar.gz 验抽取器（不是夹具）。
 *
 * 拉一次 https://api.github.com/repos/cli/cli/releases/latest 的元数据，
 * 下载本架构资产，按主件同构的口径只抽 bin/gh 到临时目录，跑 --version，再删掉。
 * 不写进 ~/.dsh、不动 /usr/bin/gh。
 *
 * 用法: node verify-real-artifact.mjs            # 断网时 SKIP 并以 0 退出
 *       DSH_GH_TAG=v2.102.0 node verify-real-artifact.mjs
 *       DSH_GH_STRICT=1 node verify-real-artifact.mjs   # 断网即失败
 */
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';

const STRICT = process.env.DSH_GH_STRICT === '1';
const ARCH = ({ x64: 'amd64', arm64: 'arm64', arm: 'armv6', ia32: '386' })[process.arch] || process.arch;
const UA = { 'user-agent': 'dsh-github-resident-verify', accept: 'application/vnd.github+json' };
const skip = (why) => { console.log(JSON.stringify({ skipped: true, why })); process.exit(STRICT ? 1 : 0); };

let tag = process.env.DSH_GH_TAG || '';
let assetName = '';
let url = '';
let apiDown = '';
try {
  if (tag) {
    const info = await (await fetch(`https://api.github.com/repos/cli/cli/releases/tags/${tag}`, { headers: UA })).json();
    assetName = (info.assets || []).map((a) => a.name).find((n) => n.endsWith(`linux_${ARCH}.tar.gz`)) || '';
    url = ((info.assets || []).find((a) => a.name === assetName) || {}).browser_download_url || '';
    tag = info.tag_name || tag;
  } else {
    const meta = await (await fetch('https://api.github.com/repos/cli/cli/releases/latest', { headers: UA })).json();
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
try {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
  if (!res.ok) skip('下载失败 HTTP ' + res.status);
  buf = Buffer.from(await res.arrayBuffer());
} catch (e) {
  // 网络抖动不应把整个 npm run verify 变成红的：SKIP 并说明原因。
  skip('资产下载不可达: ' + String(e).slice(0, 140));
}
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
  ustarMagic: JSON.stringify(magic),
  entry: hit.nm,
  entryBytes: hit.size,
  mode: '0' + mode.toString(8),
  runs: run.code === 0,
  version: run.out.split('\n')[0] || null,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.runs && mode === 0o755 ? 0 : 1);
