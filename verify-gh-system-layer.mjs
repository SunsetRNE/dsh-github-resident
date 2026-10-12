/**
 * verify-gh-system-layer.mjs — 证明「宿主后装 gh 之后，插件立刻改用系统层」。
 *
 * 守着 resolveGh 的一个老毛病：ghMemo 只写不清，L1（系统层）在插件进程活着的时候才出现时，
 * install:false 那条读路径（面板 buildSnapshot / gh_cli_status / 版本探测）会一直吐 plugin-cache，
 * 于是同一个插件里 gh_cli_resolve 报 system、gh_cli_status 报 plugin-cache，口径互相打架。
 *
 * 隔离：伪 HOME + 伪 PATH；先用「跑不起来的 gh 占位」模拟宿主没装可用的 gh，
 * 落地一份夹具版自带 gh，再把一个能跑的系统层 gh 放进 PATH —— 全程不碰真 /usr/bin/gh。
 *
 * 用法: node verify-gh-system-layer.mjs
 */
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';

const REAL_HOME = os.homedir();
const REAL_PATH = process.env.PATH;
const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'ghsys-home-'));
const FAKE_PATH = await fs.mkdtemp(path.join(os.tmpdir(), 'ghsys-path-'));
const DATA_DIR = path.join(HOME, '.dsh', 'gh-cli');
const CACHE_BIN = path.join(DATA_DIR, 'bin', 'gh');
const SYSTEM_BIN = path.join(FAKE_PATH, 'gh');

os.homedir = () => HOME;                    // 必须在 import 插件之前
process.env.HOME = HOME;
process.env.PATH = FAKE_PATH + ':' + REAL_PATH;
process.env.DSH_GH_DATA_DIR = DATA_DIR;
process.env.DSH_GH_NO_BOOTSTRAP = '1';      // 本用例只观察解析口径，不让加载期自己去下载
process.env.DSH_GH_NO_STATE_CHECK = '1';    // 关掉加载期后台检查，避免与断言抢时间
process.env.DSH_GH_SYS_LAYER_TTL_MS = '1000'; // 把系统层保鲜期压到 1s，让"过期后重探"可在用例里观察
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const steps = [];
const check = (label, cond, detail) => steps.push({ label, pass: Boolean(cond), detail });
const exists = async (p) => { try { await fs.stat(p); return true; } catch { return false; } };

// ---- 造一个真的 tar.gz：里面只有 bin/gh（夹具版自带 gh） ----
const CACHE_VERSION = 'gh version 1.1.1 (CACHE-FIXTURE)';
const SYSTEM_VERSION = 'gh version 2.102.0 (SYSTEM-FIXTURE)';
const SYS_STUB = `#!/bin/sh\ncase "$1" in\n  --version) echo "${SYSTEM_VERSION}" ;;\n  auth) exit 0 ;;\n  api) echo fixture-system-user ;;\n  *) exit 0 ;;\nesac\nexit 0\n`;
const CACHE_SCRIPT = `#!/bin/sh\necho "${CACHE_VERSION}"\nexit 0\n`;

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
  let sum = 0; for (const b of hdr) sum += b;
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const body = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(body, 0);
  return Buffer.concat([hdr, body]);
}

const TARBALL = 'gh_1.1.1_linux_arm64.tar.gz';
const tarGz = zlib.gzipSync(Buffer.concat([
  ustarEntry('gh_1.1.1_linux_arm64/bin/gh', Buffer.from(CACHE_SCRIPT, 'utf8')),
  Buffer.alloc(1024),
]));

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/repos/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      tag_name: 'v1.1.1',
      assets: [{ name: TARBALL, browser_download_url: `http://127.0.0.1:${server.address().port}/dl/${TARBALL}` }],
    }));
    return;
  }
  if (req.url.startsWith('/dl/')) { res.writeHead(200); res.end(tarGz); return; }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
process.env.DSH_GH_RELEASE_API = `http://127.0.0.1:${PORT}/repos/cli/cli/releases/latest`;
process.env.DSH_GH_DOWNLOAD_BASE = `http://127.0.0.1:${PORT}/dl`;

// 宿主「没装可用的 gh」：PATH 里放一个同名占位，它对任何参数都退 127
await fs.writeFile(SYSTEM_BIN, '#!/bin/sh\nexit 127\n', { mode: 0o755 });

// ---- 装进假 ctx ----
const mod = await import(new URL('./plugin.js', import.meta.url).href);
const tools = new Map();
mod.apply({
  tools: { register: (t) => tools.set(t.name, t) },
  provide: () => {},
  effect: () => {},
});
const resolveTool = tools.get('gh_cli_resolve');
const installTool = tools.get('gh_cli_install');
const statusTool = tools.get('gh_cli_status');
check('三个工具都已注册', Boolean(resolveTool && installTool && statusTool));

// ---- A. 前置状态：L1 不可用，缓存层也没落地 ----
const a0 = await resolveTool.execute({}, {});
check('A L1 判定为不可用（占位跑不起来）', a0.system.ok === false, a0.system);
check('A 缓存层为空', a0.pluginCache.ok === false, a0.pluginCache);
check('A resolved=none', a0.resolved === 'none', a0.resolved);
const s0 = await statusTool.execute({}, {});
check('A 读路径此时报 none（没有 gh 可报）', s0.installed === false, s0);

// ---- B. 让插件自带层落地一份能跑的 ----
const installed = await installTool.execute({}, {});
check('B 自带层落地成功', installed.installed === true && installed.layer === 'plugin-cache', installed);
check('B 落在插件缓存路径', installed.path === CACHE_BIN, installed.path);

// ---- C. 此时读路径应当认缓存层（修复不能把这一步也顺手改错） ----
const s1 = await statusTool.execute({}, {});
check('C 读路径报 plugin-cache', s1.layer === 'plugin-cache', s1.layer);
check('C 读路径报的是自带路径', s1.path === CACHE_BIN, s1.path);
check('C 读路径报的是夹具自带版本', String(s1.version).includes('CACHE-FIXTURE'), s1.version);

// ---- D. L1 出现：把「跑不起来的占位」换成真能跑的系统层 gh ----
await fs.writeFile(SYSTEM_BIN, SYS_STUB, { mode: 0o755 });
const d = await resolveTool.execute({}, {});
check('D resolve 改判 system', d.resolved === 'system', d.resolved);
check('D resolve 的 system.ok 为真', d.system.ok === true, d.system);

// ---- E. 核心断言：同一进程、同一时刻，读路径必须跟 resolve 口径一致 ----
const s2 = await statusTool.execute({}, {});
check('E 读路径同步改判 system ← 缺陷回归点', s2.layer === 'system', { layer: s2.layer, path: s2.path });
check('E 读路径报的是系统层路径（不再是自带路径）', s2.path === SYSTEM_BIN, s2.path);
check('E 读路径版本来自系统层', String(s2.version).includes('SYSTEM-FIXTURE'), s2.version);
check('E 两条路径口径一致', (d.resolved === 'system') === (s2.layer === 'system'), { resolve: d.resolved, status: s2.layer });

// ---- F. TTL 内复用：不横跳，也不每次都 fork 一遍 ----
const s3 = await statusTool.execute({}, {});
const d3 = await resolveTool.execute({}, {});
check('F TTL 内读路径仍报 system（不横跳）', s3.layer === 'system' && d3.resolved === 'system', { status: s3.layer, resolve: d3.resolved });

// ---- G. 反向：系统层跑不起来、且过了保鲜期后要能退回缓存层（不是单向粘死） ----
await fs.writeFile(SYSTEM_BIN, '#!/bin/sh\nexit 127\n', { mode: 0o755 });
const s4 = await statusTool.execute({}, {});
check('G TTL 内仍复用 system（保鲜期语义正确）', s4.layer === 'system', s4.layer);
await sleep(1200);
const s5 = await statusTool.execute({}, {});
check('G 保鲜期过后退回 plugin-cache', s5.layer === 'plugin-cache', s5.layer);
check('G 退回后报的是自带路径', s5.path === CACHE_BIN, s5.path);

// ---- H. 不碰真实环境（改动前后取快照比对，不是自我比较） ----
const realCacheExistedBefore = await exists(path.join(REAL_HOME, '.dsh', 'gh-cli'));
const realSystemGhBefore = await exists('/usr/bin/gh');
check('H 真 HOME 的 gh 缓存目录未被本用例改动', await exists(path.join(REAL_HOME, '.dsh', 'gh-cli')) === realCacheExistedBefore, path.join(REAL_HOME, '.dsh', 'gh-cli'));
check('H 真 /usr/bin/gh 的存在状态未被本用例改动', await exists('/usr/bin/gh') === realSystemGhBefore, { existedBefore: realSystemGhBefore });
check('H 夹具用的是伪 PATH，不是真 PATH', process.env.PATH.startsWith(FAKE_PATH), process.env.PATH.slice(0, 60));

// ---- I. 凭据助手的读取口径（同一个缺陷家族：报告口径必须一致） ----
// `gh auth setup-git` 写的是 host 作用域 credential.https://github.com.helper，git 先问 host 作用域
// 再回落全局；只读全局会读到空 —— 凭据明明能用、报告却说没接线（实测 git ls-remote 成功但报 null）。
const { execFile } = await import('node:child_process');
const gitCfg = (args) => new Promise((r) => execFile('git', args, { env: { ...process.env, HOME } },
  (e, out) => r({ code: e ? 1 : 0, out: (out || '').trim() })));

await gitCfg(['config', '--global', 'credential.https://github.com.helper', '!/usr/bin/gh auth git-credential']);
const s6 = await statusTool.execute({}, {});
check('I host 作用域装了 helper 时 status 必须报出来（不是 null）',
  String(s6.gitCredentialHelper || '').includes('/usr/bin/gh'), { got: s6.gitCredentialHelper });

const setupGit = tools.get('gh_cli_setup_git');
check('I gh_cli_setup_git 已注册', Boolean(setupGit));
if (setupGit) {
  const sg = await setupGit.execute({ set_identity: false }, {});
  check('I gh_cli_setup_git 与 status 同一个口径（不是 null）',
    String(sg.credentialHelper || '').includes('/usr/bin/gh'), { got: sg.credentialHelper });
}

// 撤掉 host 作用域后要能回落读全局，而不是死认一处
await gitCfg(['config', '--global', '--unset-all', 'credential.https://github.com.helper']);
await gitCfg(['config', '--global', 'credential.helper', 'store']);
const s7 = await statusTool.execute({}, {});
check('I host 作用域没有时回落读全局 helper', s7.gitCredentialHelper === 'store', { got: s7.gitCredentialHelper });

server.close();
await fs.rm(HOME, { recursive: true, force: true });
await fs.rm(FAKE_PATH, { recursive: true, force: true });
const bad = steps.filter((s) => !s.pass);
console.log(JSON.stringify({ home: HOME, total: steps.length, failed: bad.length, steps }, null, 2));
process.exit(bad.length === 0 ? 0 : 1);
