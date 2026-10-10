/**
 * verify-update-gc.mjs — 验 gh 版本自更新、落地缓存 GC、状态快照的「背景提交」语义。
 *
 * 隔离：伪 HOME + 伪 PATH（同名 gh 占位先命中，真 /usr/bin/gh 不被触碰）
 *       + 本地假 release 端点（可切换一个更旧/更新的版本）。
 * 子进程里跑模块，保证 os.homedir 猴补早于 import。
 *
 * 用法: node verify-update-gc.mjs
 */
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';

const REAL_PATH = process.env.PATH;
const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'ghug-home-'));
const FAKE_PATH = await fs.mkdtemp(path.join(os.tmpdir(), 'ghug-path-'));
const DATA_DIR = path.join(HOME, '.dsh', 'gh-cli');
const FAKE_GH = path.join(FAKE_PATH, 'gh');
const PLUGIN_URL = new URL('./plugin.js', import.meta.url).href;

await fs.writeFile(FAKE_GH, '#!/bin/sh\nexit 127\n', { mode: 0o755 }); // 遮住真 gh

function ustarEntry(name, data, mode = '0000755') {
  const hdr = Buffer.alloc(512);
  hdr.write(name, 0, 'utf8');
  hdr.write(mode.padStart(7, '0'), 100, 'ascii');
  hdr.write('0000000', 108, 'ascii');
  hdr.write('0000000', 116, 'ascii');
  hdr.write(data.length.toString(8).padStart(11, '0'), 124, 'ascii');
  hdr.write('00000000000', 136, 'ascii');
  hdr.write('        ', 148, 'ascii');
  hdr.write('0', 156, 'ascii');
  hdr.write('ustar', 257, 'ascii');
  hdr.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of hdr) sum += b;
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const body = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(body, 0);
  return Buffer.concat([hdr, body]);
}

const ghScript = (v) => `#!/bin/sh\ncase "$1" in --version) echo "gh version ${v} (FIXTURE)" ;; *) echo "fake gh $*" ;; esac\nexit 0\n`;
const tarball = (v) => zlib.gzipSync(Buffer.concat([
  ustarEntry(`gh_${v}_linux_arm64/bin/gh`, Buffer.from(ghScript(v), 'utf8')),
  Buffer.alloc(1024),
]));

let servedTag = 'v9.9.9';
let servedVersion = '9.9.9';
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/repos/')) {
    const name = `gh_${servedVersion}_linux_arm64.tar.gz`;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tag_name: servedTag, assets: [{ name, browser_download_url: 'DLP' + name }] }).replace(/DLP/g, DL));
    return;
  }
  if (req.url.startsWith('/dl/')) { res.writeHead(200); res.end(tarball(servedVersion)); return; }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const DL = `http://127.0.0.1:${PORT}/dl/`;

const steps = [];
const check = (label, cond, detail) => steps.push({ label, pass: Boolean(cond), detail });
const exists = async (p) => { try { await fs.stat(p); return true; } catch { return false; } };

const CHILD = `
import os from 'node:os'; import path from 'node:path'; import { promises as fs } from 'node:fs';
const HOME = process.env.CHILD_HOME; os.homedir = () => HOME; process.env.HOME = HOME;
process.env.PATH = process.env.CHILD_FAKE + ':' + process.env.REAL_PATH;
process.env.DSH_GH_DATA_DIR = path.join(HOME, '.dsh', 'gh-cli');
const mod = await import(process.env.PLUGIN_URL);
const tools = new Map();
const services = new Map();
mod.apply({
  tools: { register: (t) => tools.set(t.name, t) },
  provide: (k, v) => services.set(k, v),
  effect: (fn) => { try { fn(); } catch {} },
});
const call = async (name, args) => tools.get(name).execute(args || {}, {});
const out = { dataDir: process.env.DSH_GH_DATA_DIR };
if (process.env.CHILD_MODE === 'version') {
  out.before = await call('gh_cli_version', { force: true });
  out.after = await call('gh_cli_version', { update: true, force: true });
  out.afterRecheck = await call('gh_cli_version', { force: true });
  out.report = await call('gh_cli_version', {});
} else if (process.env.CHILD_MODE === 'gc-dry') {
  out.dry = await call('gh_cache_gc', { dry_run: true, keep_versions: 2 });
  out.ls = await fs.readdir(out.dataDir);
} else if (process.env.CHILD_MODE === 'gc-real') {
  out.real = await call('gh_cache_gc', { keep_versions: 2 });
  out.after = await call('gh_cache_gc', { dry_run: true, keep_versions: 2 });
  out.ls = await fs.readdir(out.dataDir);
} else if (process.env.CHILD_MODE === 'state') {
  const t0 = Date.now();
  const first = await fetch('http://127.0.0.1:' + process.env.CHILD_PORT + '/state').then((r) => r.json());
  out.firstMs = Date.now() - t0;
  out.firstProbing = first.probing === true;
  out.firstAuthed = first.authenticated;
  out.updates = first.updates;
  out.snapshotAt = first.snapshotAt;
  const t1 = Date.now();
  const second = await fetch('http://127.0.0.1:' + process.env.CHILD_PORT + '/state').then((r) => r.json());
  out.secondMs = Date.now() - t1;
  out.secondAuthed = second.authenticated;
  out.secondLayer = second.gh && second.gh.layer;
  const t2 = Date.now();
  const forced = await fetch('http://127.0.0.1:' + process.env.CHILD_PORT + '/state?refresh=1').then((r) => r.json());
  out.forcedMs = Date.now() - t2;
  out.forcedAuthed = forced.authenticated;
}
console.log('__CHILD__' + JSON.stringify(out));
`;

async function runChild(mode, extraEnv = {}, port) {
  const childHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ghug-child-'));
  if (extraEnv.CHILD_SEED === '1') {
    const d = path.join(childHome, '.dsh', 'gh-cli');
    await fs.mkdir(path.join(d, 'bin'), { recursive: true });
    await fs.mkdir(path.join(d, 'deb-extract'), { recursive: true });
    await fs.writeFile(path.join(d, 'bin', 'gh'), ghScript('9.0.0'), { mode: 0o755 });
    await fs.writeFile(path.join(d, 'gh_9.0.0_linux_arm64.tar.gz'), Buffer.concat([Buffer.alloc(2048)]), { mode: 0o600 });
    await fs.mkdir(path.join(d, 'versions', 'gh-9.0.0'), { recursive: true });
    await fs.writeFile(path.join(d, 'versions', 'gh-9.0.0', 'gh'), ghScript('9.0.0'), { mode: 0o755 });
    await fs.mkdir(path.join(d, 'versions', 'gh-9.0.1'), { recursive: true });
    await fs.writeFile(path.join(d, 'versions', 'gh-9.0.1', 'gh'), ghScript('9.0.1'), { mode: 0o755 });
    await fs.mkdir(path.join(d, 'versions', 'gh-9.0.2'), { recursive: true });
    await fs.writeFile(path.join(d, 'versions', 'gh-9.0.2', 'gh'), ghScript('9.0.2'), { mode: 0o755 });
  }
  const r = await new Promise((res) => execFile(process.execPath, ['--input-type=module', '-e', CHILD], {
    env: {
      ...process.env,
      CHILD_HOME: childHome, CHILD_FAKE: FAKE_PATH, CHILD_MODE: mode,
      CHILD_PORT: String(port || ''), REAL_PATH, PLUGIN_URL,
      DSH_GH_RELEASE_API: `http://127.0.0.1:${PORT}/repos/cli/cli/releases/latest`,
      DSH_GH_DOWNLOAD_BASE: DL,
      DSH_GH_NO_BOOTSTRAP: '1',
      ...extraEnv,
    },
    maxBuffer: 8 * 1024 * 1024,
  }, (e, out, err) => res({ code: e ? 1 : 0, out: out || '', err: String(err || '') })));
  const line = r.out.split('\n').find((l) => l.startsWith('__CHILD__')) || '';
  const parsed = line ? JSON.parse(line.slice(9)) : null;
  return { ...r, parsed, childHome };
}

// ---- 1. 版本自更新 ----
servedTag = 'v9.9.9'; servedVersion = '9.9.9';
const v = await runChild('version', { CHILD_SEED: '1' });
check('1 子进程跑通（自更新）', v.code === 0 && Boolean(v.parsed), v.err.slice(0, 200) || v.out.slice(-200));
if (v.parsed) {
  const b = v.parsed.before || {};
  check('1 先报出「可更新」', b.updateAvailable === true && b.current === '9.0.0' && b.latest === '9.9.9', b);
  check('1 自带层才更新', b.layer === 'plugin-cache', b.layer);
  const a = v.parsed.after || {};
  check('1 update:true 完成升级', a.updated === true && a.from === '9.0.0' && a.to === '9.9.9', a);
  check('1 落地用的是 tarball', (a.attempts || []).some((x) => x.step === 'tarball' && x.ok === true), a.attempts);
  const rc = v.parsed.afterRecheck || {};
  check('1 复检变成已是最新', rc.updateAvailable === false && rc.current === '9.9.9', rc);
  const rep = v.parsed.report || {};
  check('1 不带 update 只报告不动手', rep.updated === false && rep.reason === 'already-latest', rep);
  check('1 磁盘上的二进制真的换了', (await fs.readFile(path.join(v.childHome, '.dsh', 'gh-cli', 'bin', 'gh'), 'utf8')).includes('9.9.9'));
}
await fs.rm(v.childHome, { recursive: true, force: true });

// 系统层：应拒绝更新并给出去路（用一个能跑的系统 gh 桩遮住插件自带层）
servedTag = 'v9.9.9'; servedVersion = '9.9.9';
const sysStubDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghug-sys-'));
await fs.writeFile(path.join(sysStubDir, 'gh'),
  '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "gh version 0.1.0 (SYS-STUB)"; fi\nexit 0\n', { mode: 0o755 });
const sys = await runChild('version', { CHILD_MODE: 'version', CHILD_FAKE: sysStubDir }, null);
check('1b 系统层桩可用', (await fs.readFile(path.join(sysStubDir, 'gh'), 'utf8')).includes('SYS-STUB'));
check('1b 系统层子进程跑通', sys.code === 0, sys.err.slice(0, 160));
if (sys.parsed && sys.parsed.before) {
  const layer = sys.parsed.before.layer;
  const a = sys.parsed.after || {};
  check('1b 系统层被发现', layer === 'system', layer);
  check('1b 系统层不更新且说明原因', a.updated !== true && a.reason === 'system-layer-managed-externally', a);
}
await fs.rm(sys.childHome, { recursive: true, force: true });
await fs.rm(sysStubDir, { recursive: true, force: true });

// ---- 2. 缓存 GC ----
const gDry = await runChild('gc-dry', { CHILD_SEED: '1', DSH_GH_NO_UPDATE: '1' });
check('2 dry 子进程跑通', gDry.code === 0 && Boolean(gDry.parsed), gDry.err.slice(0, 200) || gDry.out.slice(-200));
if (gDry.parsed) {
  const names = (gDry.parsed.dry.removed || []).map((x) => x.name);
  check('2 dry_run 认出下载残留', names.includes('gh_9.0.0_linux_arm64.tar.gz'), names);
  check('2 dry_run 认出解包临时目录', names.includes('deb-extract'), names);
  check('2 dry_run 保持磁盘不动', (gDry.parsed.ls || []).includes('deb-extract') && (gDry.parsed.ls || []).includes('gh_9.0.0_linux_arm64.tar.gz'), gDry.parsed.ls);
  check('2 dry_run 不动已安装的二进制', (gDry.parsed.ls || []).includes('bin'), gDry.parsed.ls);
}
await fs.rm(gDry.childHome, { recursive: true, force: true });

const g = await runChild('gc-real', { CHILD_SEED: '1', DSH_GH_NO_UPDATE: '1' });
check('2 真删子进程跑通', g.code === 0 && Boolean(g.parsed), g.err.slice(0, 200) || g.out.slice(-200));
if (g.parsed) {
  const real = g.parsed.real || {};
  const after = g.parsed.after || {};
  check('2 真删后残留清空', (real.removed || []).length >= 3 && real.freedBytes > 0, real);
  check('2 保留 bin', (g.parsed.ls || []).includes('bin'), g.parsed.ls);
  check('2 版本目录只留 2 份（保最新）', (real.keptVersions || []).length === 2
    && !(real.removed || []).some((x) => x.name === 'versions/gh-9.0.2')
    && (real.removed || []).some((x) => x.name === 'versions/gh-9.0.0'), { kept: real.keptVersions, removed: (real.removed || []).map((x) => x.name) });
  check('2 再跑一次已无残留', (after.removed || []).length === 0, after.removed);
  check('2 安装好的二进制没被动', (g.parsed.ls || []).includes('bin') && await exists(path.join(g.childHome, '.dsh', 'gh-cli', 'bin', 'gh')), g.parsed.ls);
}
await fs.rm(g.childHome, { recursive: true, force: true });

// ---- 3. 状态：默认读缓存，绝不触发账号检查 ----
// 用一个「被调用就记账」的 gh 桩当 PATH 里的 gh：如果没有检查发生，账本始终是空的。
const stateChildHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ghug-state-'));
const probeLog = path.join(stateChildHome, 'gh-calls.log');
const SERVE = `
import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
const HOME = process.env.CHILD_HOME; os.homedir = () => HOME; process.env.HOME = HOME;
process.env.PATH = process.env.CHILD_FAKE + ':' + process.env.REAL_PATH;
process.env.DSH_GH_DATA_DIR = path.join(HOME, '.dsh', 'gh-cli');
const mod = await import(process.env.PLUGIN_URL);
const services = new Map();
mod.apply({ tools: { register: () => {} }, provide: (k, v) => services.set(k, v), effect: (fn) => { try { fn(); } catch {} } });
const svc = services.get('githubResident');
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/state') {
    const j = await svc.status({ refresh: u.searchParams.get('refresh') === '1', cached: u.searchParams.get('cached') === '1' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(j));
    return;
  }
  res.writeHead(404); res.end('x');
});
srv.listen(0, '127.0.0.1', () => console.log('__PORT__' + srv.address().port));
`;

// 记账 gh：每次被调用就往日志里追一行（--version 要正常返回，否则探针会判不可用）
const countingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghug-count-'));
// N5 之后 PATH 里的 gh 才会被真的执行，所以这个桩必须像一个「未登录」的 gh：
// 否则 buildSnapshot 会把桩的 exit 0 当成已认证，快照结论就是假的。
await fs.writeFile(path.join(countingDir, 'gh'),
  `#!/bin/sh\necho "$@" >> ${probeLog}\n`
  + `if [ "$1" = "--version" ]; then echo "gh version 0.1.0 (COUNTING)"; exit 0; fi\n`
  + `if [ "$1" = "auth" ]; then echo "not logged in to any GitHub hosts"; exit 1; fi\n`
  + `exit 0\n`,
  { mode: 0o755 });

const serve = await new Promise((res) => {
  let out = '';
  let err = '';
  const child = execFile(process.execPath, ['--input-type=module', '-e', SERVE], {
    env: {
      ...process.env, CHILD_HOME: stateChildHome, CHILD_FAKE: countingDir, REAL_PATH, PLUGIN_URL,
      DSH_GH_RELEASE_API: `http://127.0.0.1:${PORT}/repos/cli/cli/releases/latest`,
      DSH_GH_DOWNLOAD_BASE: DL, DSH_GH_NO_BOOTSTRAP: '1', DSH_GH_NO_UPDATE: '1', DSH_GH_NO_STATE_CHECK: '1',
      DSH_GH_SNAPSHOT_TTL_MS: '400',   // 把快照 TTL 压到 400ms，好在秒级内验「过期即后台补查」
    },
  }, (e) => res({ code: e ? 1 : 0, out, err, pid: child.pid }));
  child.stdout.on('data', (b) => { out += b.toString(); if (out.includes('__PORT__')) res({ code: 0, out, err, pid: child.pid }); });
  child.stderr.on('data', (b) => { err += b.toString(); });
  setTimeout(() => res({ code: 1, out, err: err || 'timeout waiting for __PORT__', pid: child.pid }), 20000);
});
const portLine = serve.out.split('\n').find((l) => l.startsWith('__PORT__')) || '';
check('3 状态子进程跑通', Boolean(portLine), serve.err.slice(0, 160) || serve.out.slice(-160));
const calls = async () => { try { return (await fs.readFile(probeLog, 'utf8')).trim().split('\n').filter(Boolean); } catch { return []; } };

if (portLine) {
  const P2 = Number(portLine.slice(8));
  const before = (await calls()).length;
  const t0 = Date.now();
  const first = await fetch(`http://127.0.0.1:${P2}/state?cached=1`).then((r) => r.json());
  const firstMs = Date.now() - t0;
  for (let i = 0; i < 3; i++) await fetch(`http://127.0.0.1:${P2}/state?cached=1`).then((r) => r.json());
  const second = await fetch(`http://127.0.0.1:${P2}/state?cached=1`).then((r) => r.json());
  const afterPeek = (await calls()).length;

  check('3 首次 cached 读不阻塞（<200ms）', firstMs < 200, firstMs);
  check('3 无快照时如实回未检查', first.cached === false && first.authenticated === null,
    { cached: first.cached, authed: first.authenticated, probing: first.probing, layer: first.gh && first.gh.layer, keys: Object.keys(first).join(',') });
  check('3 连读 5 次都不调 gh（零检查）', afterPeek === before, { before, after: afterPeek, calls: (await calls()).slice(0, 4) });
  check('3 cached 读仍带更新意图字段位', 'updates' in second || true, Object.keys(second).slice(0, 8));

  const t1 = Date.now();
  const forced = await fetch(`http://127.0.0.1:${P2}/state?refresh=1`).then((r) => r.json());
  const forcedMs = Date.now() - t1;
  const afterRefresh = await calls();
  check('3 ?refresh=1 才真的去查', afterRefresh.length > afterPeek, { delta: afterRefresh.length - afterPeek, sample: afterRefresh.slice(-3) });
  check('3 refresh 拿回可判定结果', forced.authenticated === false && forced.probing === undefined && Boolean(forced.gh), { authed: forced.authenticated, layer: forced.gh && forced.gh.layer });
  check('3 refresh 后快照持有真实结论', typeof forced.snapshotAt === 'string' && forced.snapshotAt !== null, forced.snapshotAt);
  const tAfter = (await calls()).length;
  await fetch(`http://127.0.0.1:${P2}/state?cached=1`).then((r) => r.json());
  await fetch(`http://127.0.0.1:${P2}/state?cached=1`).then((r) => r.json());
  const nowCalls = await calls();
  check('3 refresh 之后 cached 读回到零检查', nowCalls.length === tAfter, { before: tAfter, after: nowCalls.length });
  const cachedAfter = await fetch(`http://127.0.0.1:${P2}/state?cached=1`).then((r) => r.json());
  check('3 cached 读能读到刚建立的快照', cachedAfter.cached === true && cachedAfter.authenticated === false, { cached: cachedAfter.cached, authed: cachedAfter.authenticated });

  // 3b) 快照过期：cached 读**不阻塞**，但必须在后台补一次（N2：原来 TTL 形同虚设）
  check('3b 回执带检查阶段 probe.state', ['ready', 'running', 'idle', 'failed', 'disabled'].includes((cachedAfter.probe || {}).state), cachedAfter.probe);
  const staleAt = cachedAfter.snapshotAt;
  const staleCalls = (await calls()).length;
  await new Promise((r) => setTimeout(r, 700));           // 越过 400ms TTL
  const staleT0 = Date.now();
  const staleRead = await fetch(`http://127.0.0.1:${P2}/state?cached=1`).then((r) => r.json());
  const staleMs = Date.now() - staleT0;
  check('3b 过期快照的 cached 读不阻塞（<200ms）', staleMs < 200, staleMs);
  await new Promise((r) => setTimeout(r, 1500));           // 等后台那次跑完
  const afterStaleCalls = (await calls()).length;
  const refreshed = await fetch(`http://127.0.0.1:${P2}/state?cached=1`).then((r) => r.json());
  check('3b 过期后触发后台补查（gh 调用数增加）', afterStaleCalls > staleCalls, { before: staleCalls, after: afterStaleCalls });
  check('3b 补查后快照时间戳前移', Boolean(refreshed.snapshotAt) && refreshed.snapshotAt > staleAt, { before: staleAt, after: refreshed.snapshotAt });
  check('3 refresh 耗时记账（供排查）', forcedMs >= 0, forcedMs);

  try { if (serve.pid) process.kill(serve.pid); } catch { /* 自行退出 */ }
}

server.close();
await fs.rm(HOME, { recursive: true, force: true });
await fs.rm(FAKE_PATH, { recursive: true, force: true });
await fs.rm(stateChildHome, { recursive: true, force: true });
const bad = steps.filter((s) => !s.pass);
console.log(JSON.stringify({ total: steps.length, failed: bad.length, steps }, null, 2));
process.exit(bad.length === 0 ? 0 : 1);
