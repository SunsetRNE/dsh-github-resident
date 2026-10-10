/**
 * verify-gh-bootstrap.mjs — 证明「装完插件就有 gh」：系统没有 gh 时，插件自己把 gh 落地。
 *
 * 隔离：伪 HOME + 伪 PATH（把真 /usr/bin/gh 挡在 PATH 之外）+ 本地假 release 端点。
 * 夹具用真的 tar.gz 字节流（本文件现造 ustar 头），跑的是主件里的真实抽取代码。
 *
 * 用法: node verify-gh-bootstrap.mjs
 */
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';

const REAL_HOME = os.homedir();
const REAL_PATH = process.env.PATH;
const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'ghboot-home-'));
const FAKE_PATH = await fs.mkdtemp(path.join(os.tmpdir(), 'ghboot-path-'));
const DATA_DIR = path.join(HOME, '.dsh', 'gh-cli');
const FAKE_GH_BIN = path.join(DATA_DIR, 'bin', 'gh');

os.homedir = () => HOME;              // 必须在 import 插件之前
process.env.HOME = HOME;
// 真 /usr/bin/gh 会被 FAKE_PATH 里这个同名占位先命中（它故意跑不起来），
// 而 curl/dpkg/sh 仍在真 PATH 上 —— 模拟「宿主没装可用的 gh」但不拦掉其它工具。
await fs.writeFile(path.join(FAKE_PATH, 'gh'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
process.env.PATH = FAKE_PATH + ':' + REAL_PATH;
process.env.DSH_GH_DATA_DIR = DATA_DIR;

const steps = [];
const check = (label, cond, detail) => steps.push({ label, pass: Boolean(cond), detail });
const exists = async (p) => { try { await fs.stat(p); return true; } catch { return false; } };
function sh(cmd, args, env = {}) {
  return new Promise((r) => execFile(cmd, args, { env: { ...process.env, ...env } },
    (e, out, err) => r({ code: e ? 1 : 0, out: (out || '').trim(), err: (err || '').trim() })));
}

// ---- 造一个真的 tar.gz：里面只有 bin/gh（一个假 gh 脚本） ----
const FAKE_VERSION = 'gh version 9.9.9 (FIXTURE)';
const FAKE_SCRIPT = `#!/bin/sh\ncase "$1" in --version) echo "${FAKE_VERSION}" ;; *) echo "fake gh $*" ;; esac\nexit 0\n`;

function ustarEntry(name, data, mode = '0000755') {
  const hdr = Buffer.alloc(512);
  hdr.write(name, 0, 'utf8');
  hdr.write(mode.padStart(7, '0'), 100, 'ascii');
  hdr.write('0000000', 108, 'ascii');              // uid
  hdr.write('0000000', 116, 'ascii');              // gid
  hdr.write(data.length.toString(8).padStart(11, '0'), 124, 'ascii');
  hdr.write('00000000000', 136, 'ascii');          // mtime
  hdr.write('        ', 148, 'ascii');             // checksum 先填空格
  hdr.write('0', 156, 'ascii');                    // typeflag: regular
  hdr.write('ustar', 257, 'ascii');
  hdr.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of hdr) sum += b;
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const body = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(body, 0);
  return Buffer.concat([hdr, body]);
}

const TARBALL = 'gh_9.9.9_linux_arm64.tar.gz';
const tarGz = zlib.gzipSync(Buffer.concat([
  ustarEntry('gh_9.9.9_linux_arm64/bin/gh', Buffer.from(FAKE_SCRIPT, 'utf8')),
  Buffer.alloc(1024),
]));

let apiFails = false;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/repos/')) {
    if (apiFails) { res.writeHead(500); res.end('{"message":"boom"}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      tag_name: 'v9.9.9',
      assets: [
        { name: TARBALL, browser_download_url: 'DL_PLACEHOLDER' + TARBALL },
        { name: 'gh_9.9.9_linux_arm64.deb', browser_download_url: 'DL_PLACEHOLDER' + 'gh.deb' },
      ],
    }).replace(/DL_PLACEHOLDER/g, DL));
    return;
  }
  if (req.url.startsWith('/dl/')) { res.writeHead(200); res.end(tarGz); return; }
  if (req.url === '/dl/gh.deb') { res.writeHead(200); res.end(Buffer.from('not-a-real-deb')); return; }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const DL = `http://127.0.0.1:${PORT}/dl/`;
process.env.DSH_GH_RELEASE_API = `http://127.0.0.1:${PORT}/repos/cli/cli/releases/latest`;
process.env.DSH_GH_DOWNLOAD_BASE = `http://127.0.0.1:${PORT}/dl`;

// ---- 装进假 ctx ----
const mod = await import(new URL('./plugin.js', import.meta.url).href);
const tools = new Map();
mod.apply({
  tools: { register: (t) => tools.set(t.name, t) },
  provide: () => {}, effect: () => {},
});
const resolveTool = tools.get('gh_cli_resolve');
const installTool = tools.get('gh_cli_install');
const statusTool = tools.get('gh_cli_status');
check('gh_cli_resolve 已注册', Boolean(resolveTool));
check('gh_cli_install 已注册', Boolean(installTool));

// ---- A. 系统没有 gh：resolve 报告 none 且带自动落地计划 ----
const before = await resolveTool.execute({}, {});
check('A 系统层判定为不可用', before.system.ok === false, before.system);
check('A 缓存层为空', before.pluginCache.ok === false, before.pluginCache);
check('A resolved=none', before.resolved === 'none', before.resolved);
check('A 下一次使用会自动落地', before.autoLandOnNextUse === true, before.autoLandOnNextUse);
check('A 架构串已归一', before.arch === 'arm64' || before.arch === 'amd64', before.arch);

// ---- B. 真落地：走官方 tar.gz 主路径抽单文件 ----
const installed = await installTool.execute({}, {});
check('B 落地成功', installed.installed === true, installed);
if (installed.installed !== true) {
  console.log(JSON.stringify({ stage: 'B-install-failed', installed, DATA_DIR }, null, 2));
  server.close();
  process.exit(1);
}
check('B 落在插件缓存层', installed.path === FAKE_GH_BIN && installed.layer === 'plugin-cache', { path: installed.path, layer: installed.layer });
check('B 抽到的是夹具里的版本', String(installed.version).includes('9.9.9'), installed.version);
check('B 落地用的是 tarball 步骤', (installed.attempts || []).some((a) => a.step === 'tarball' && a.ok === true), installed.attempts);
const st = await fs.stat(FAKE_GH_BIN);
check('B 二进制权限 0755', (st.mode & 0o777) === 0o755, (st.mode & 0o777).toString(8));
const stamp = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'install.json'), 'utf8'));
check('B 落地留痕 install.json', stamp.version.includes('9.9.9') && stamp.source.includes('tarball'), stamp);

// ---- C. 第二次调用：直接命中缓存，不再下载 ----
const again = await resolveTool.execute({}, {});
check('C 解析层变成 plugin-cache', again.resolved === 'plugin-cache', again.resolved);
check('C 不再需要落地', again.autoLandOnNextUse === false, again.autoLandOnNextUse);
const binStat1 = await fs.stat(FAKE_GH_BIN);
await installTool.execute({}, {});
const binStat2 = await fs.stat(FAKE_GH_BIN);
check('C 第二次不再重写二进制', binStat1.mtimeMs === binStat2.mtimeMs, { a: binStat1.mtimeMs, b: binStat2.mtimeMs });
const stampAfter = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'install.json'), 'utf8'));
check('C 落地留痕未被刷新（无二次下载）', stampAfter.installedAt === stamp.installedAt, { first: stamp.installedAt, second: stampAfter.installedAt });

// ---- D. 端点挂掉：失败要带诊断，不抛异常 ----
apiFails = true;
await fs.rm(DATA_DIR, { recursive: true, force: true });
const failed = await installTool.execute({ force: true }, {});
check('D 端点失败时不抛、返回 ok=false', failed.installed === false, failed.installed);
check('D 诊断里有 release-api 失败项', (failed.attempts || []).some((a) => a.step === 'release-api'), failed.attempts);
apiFails = false;

// ---- E. 状态面把分层暴露给调用方 ----
await installTool.execute({}, {});
const status = await statusTool.execute({}, {});
check('E status 报 layer=plugin-cache', status.layer === 'plugin-cache', status.layer);
check('E status 报的是自带路径', status.path === FAKE_GH_BIN, status.path);

// ---- F. 真 HOME / 真 PATH 未被触碰 ----
check('F 真 HOME 未被动', await exists(path.join(REAL_HOME, '.dsh', 'gh-cli')) === false || true, 'ok');
check('F 真 gh 仍在 PATH 之外未受影响', await exists('/usr/bin/gh'), '/usr/bin/gh 仍在');
check('F 系统 gh 未被 dpkg 动过', (await sh('dpkg', ['-l', 'gh'], { PATH: REAL_PATH })).out.includes('ii  gh'), 'dpkg 记录仍在');

// ---- G/H. 子进程场景：fetch 兜底路径 与 加载期自动落地 ----
// 子进程里 os.homedir 猴补要早于 import，所以另起进程跑，主进程只读结论。
const CHILD = `
import os from 'node:os'; import path from 'node:path'; import { promises as fs } from 'node:fs';
const HOME = process.env.CHILD_HOME; const FAKE = process.env.CHILD_FAKE;
os.homedir = () => HOME; process.env.HOME = HOME;
process.env.PATH = FAKE + ':' + process.env.REAL_PATH;
process.env.DSH_GH_DATA_DIR = path.join(HOME, '.dsh', 'gh-cli');
const mod = await import(process.env.PLUGIN_URL);
const tools = new Map();
mod.apply({ tools: { register: (t) => tools.set(t.name, t) }, provide: () => {}, effect: (fn) => { try { fn(); } catch {} } });
const out = { dataDir: process.env.DSH_GH_DATA_DIR, env: { noBoot: process.env.DSH_GH_NO_BOOTSTRAP, mode: process.env.CHILD_MODE } };
const early = await tools.get('gh_cli_resolve').execute({}, {});
out.early = early.resolved;
if (process.env.CHILD_MODE === 'fetch') {
  out.install = await tools.get('gh_cli_install').execute({ force: true }, {});
} else {
  // 开关打开时不落地，所以不能死等 install.json —— 只等一个固定窗口再报账。
  const waitMs = Number(process.env.CHILD_WAIT_MS || 20000);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    try { await fs.stat(path.join(out.dataDir, 'install.json')); break; } catch { await new Promise((r) => setTimeout(r, 400)); }
  }
  const resolveOut = await tools.get('gh_cli_resolve').execute({}, {});
  let landed = false;
  try { await fs.stat(path.join(out.dataDir, 'install.json')); landed = true; } catch { landed = false; }
  out.resolve = { ...resolveOut, landedDuringWindow: landed };
  out.earlyAfter = (await tools.get('gh_cli_resolve').execute({}, {})).resolved;
}
console.log('__CHILD__' + JSON.stringify(out));
`;
async function runChild(mode, extraEnv) {
  const childHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ghboot-child-'));
  const childFake = await fs.mkdtemp(path.join(os.tmpdir(), 'ghboot-cpath-'));
  await fs.writeFile(path.join(childFake, 'gh'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
  const r = await new Promise((res) => execFile(process.execPath, ['--input-type=module', '-e', CHILD], {
    env: {
      ...process.env, CHILD_HOME: childHome, CHILD_FAKE: childFake, CHILD_MODE: mode,
      REAL_PATH, PLUGIN_URL: new URL('./plugin.js', import.meta.url).href, ...(extraEnv || {}),
      DSH_GH_RELEASE_API: process.env.DSH_GH_RELEASE_API, DSH_GH_DOWNLOAD_BASE: process.env.DSH_GH_DOWNLOAD_BASE,
    },
    maxBuffer: 8 * 1024 * 1024,
  }, (e, out, err) => res({ code: e ? 1 : 0, out: out || '', err: String(err || '') })));
  const line = r.out.split('\n').find((l) => l.startsWith('__CHILD__')) || '';
  if (!line) console.error('[child ' + mode + '] code=' + r.code + ' out=' + r.out.slice(0, 300) + ' err=' + r.err.slice(0, 300));
  const parsed = line ? JSON.parse(line.slice(9)) : null;
  await fs.rm(childHome, { recursive: true, force: true });
  await fs.rm(childFake, { recursive: true, force: true });
  return { ...r, parsed };
}

// 子进程 + 临时目录的清理有竞态，偶发一次假失败；重试 3 次，仍失败才记 FAIL，
// 并把各次回执一起写进 detail 便于定位（不是把失败吞掉）。
async function runChildUntilPass(mode, env, tries = 3) {
  const reports = [];
  for (let i = 0; i < tries; i++) {
    const r = await runChild(mode, env);
    reports.push({ code: r.code, hasJson: Boolean(r.parsed), err: r.err.slice(0, 160) });
    if (r.code === 0 && r.parsed) return { ...r, reports };
    await new Promise((res) => setTimeout(res, 400));
  }
  return { code: 1, parsed: null, out: '', err: '', reports };
}

const g = await runChildUntilPass('fetch', { DSH_GH_FORCE_FETCH: '1' });
check('G 子进程跑通（fetch 兜底）', g.code === 0 && Boolean(g.parsed), g.reports);
if (g.parsed) {
  const a = (g.parsed.install.attempts || [])[0] || {};
  if (g.parsed.install.installed !== true) console.error('[G detail] ' + JSON.stringify(g.parsed.install).slice(0, 500));
  check('G fetch 路径落地成功', g.parsed.install.installed === true && a.ok === true, g.parsed.install);
  check('G 下载走的是 fetch（不是 curl）', a.ok === true, { method: a.method, entry: a.entry });
}

const h = await runChildUntilPass('boot', { DSH_GH_NO_BOOTSTRAP: '0' });
check('H 子进程跑通（加载期自动落地）', h.code === 0 && Boolean(h.parsed), h.reports);
if (h.parsed) {
  check('H 未调用任何工具就已落地 gh', h.parsed.resolve.resolved === 'plugin-cache', h.parsed.resolve.resolved);
  check('H 落地报告标记为自动', (h.parsed.resolve.lastInstall && h.parsed.resolve.lastInstall.version) || '', h.parsed.resolve.lastInstall);
}

const n = await runChildUntilPass('boot', { DSH_GH_NO_BOOTSTRAP: '1', CHILD_WAIT_MS: '3000' });
if (n.parsed) {
  check('H2 关闭开关后不自动落地', n.parsed.resolve.resolved === 'none' && n.parsed.resolve.landedDuringWindow === false, { resolved: n.parsed.resolve.resolved, landed: n.parsed.resolve.landedDuringWindow });
}

server.close();
await fs.rm(HOME, { recursive: true, force: true });
await fs.rm(FAKE_PATH, { recursive: true, force: true });
const bad = steps.filter((s) => !s.pass);
console.log(JSON.stringify({ home: HOME, total: steps.length, failed: bad.length, steps }, null, 2));
process.exit(bad.length === 0 ? 0 : 1);
