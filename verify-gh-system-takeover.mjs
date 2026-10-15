/**
 * verify-gh-system-takeover.mjs —— 证明「接管系统层 gh」这条新路真的按声明行事：
 *
 *   ① 系统层 gh 低于插件要求（2.40.0）时，会被判为 system-outdated；
 *   ② **没同意**时绝不动系统层（不跑包管理器），如实回 consent-required，并改用自带副本；
 *   ③ 同意之后仍要过权限这一关：不是 root、sudo -n 拿不到 → no-permission，**还是不跑包管理器**；
 *   ④ 策略 read-only 时连尝试都不尝试；
 *   ⑤ 全程 **apt-get 一次都没被调用**（假 PATH 里的 shim 只要被调用就落一个标记文件）。
 *
 * 隔离：伪 HOME + 伪 PATH（把真 gh/dpkg/id/sudo/apt-get 全挡住）+ 本地假 release 端点。
 * 用法: node verify-gh-system-takeover.mjs
 */
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REAL_HOME = os.homedir();
const REAL_PATH = process.env.PATH;
const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'ghsys-home-'));
const BIN = await fs.mkdtemp(path.join(os.tmpdir(), 'ghsys-bin-'));
const DATA_DIR = path.join(HOME, '.dsh', 'gh-cli');
const FAKE_GH_BIN = path.join(DATA_DIR, 'bin', 'gh');
const APT_MARK = path.join(BIN, 'apt-was-called');

os.homedir = () => HOME;                 // 必须在 import 插件之前
process.env.HOME = HOME;
process.env.DSH_GH_DATA_DIR = DATA_DIR;
process.env.PATH = BIN + ':' + REAL_PATH;

const steps = [];
const check = (label, cond, detail) => steps.push({ label, pass: Boolean(cond), detail });

const shim = async (name, body) => {
  await fs.writeFile(path.join(BIN, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
};
// 系统层那份 gh：**跑得起来，但版本低于要求**（这就是要被接管的那种现场）。
await shim('gh', 'if [ "$1" = "--version" ]; then echo "gh version 1.0.0 (SYSTEM-FIXTURE)"; exit 0; fi\necho "system gh $*"\nexit 0');
await shim('dpkg', 'echo "/usr/bin/gh"; exit 0');      // 认出来源 = apt
await shim('id', 'echo 1000');                          // 非 root
await shim('sudo', 'exit 1');                           // sudo -n 也拿不到
await shim('apt-get', 'echo called >> ' + APT_MARK + '\nexit 1');

// ---- 本地假 release 端点（自带副本要能落地，才能证明「改用自带副本」不是空话）----
const FAKE_VERSION = 'gh version 9.9.9 (FIXTURE)';
const FAKE_SCRIPT = '#!/bin/sh\ncase "$1" in --version) echo "' + FAKE_VERSION + '" ;; *) echo "fake gh $*" ;; esac\nexit 0\n';
function ustarEntry(name, data, mode = '0000755') {
  const hdr = Buffer.alloc(512);
  hdr.write(name, 0, 'utf8');
  hdr.write(mode.padStart(7, '0'), 100, 'ascii');
  hdr.write('0000000', 108, 'ascii'); hdr.write('0000000', 116, 'ascii');
  hdr.write(data.length.toString(8).padStart(11, '0'), 124, 'ascii');
  hdr.write('00000000000', 136, 'ascii');
  hdr.write('        ', 148, 'ascii');
  hdr.write('0', 156, 'ascii');
  hdr.write('ustar', 257, 'ascii'); hdr.write('00', 263, 'ascii');
  let sum = 0; for (const b of hdr) sum += b;
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const body = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(body, 0);
  return Buffer.concat([hdr, body]);
}
const TARBALL = 'gh_9.9.9_linux_arm64.tar.gz';
const tarGz = zlib.gzipSync(Buffer.concat([ustarEntry('gh_9.9.9_linux_arm64/bin/gh', Buffer.from(FAKE_SCRIPT, 'utf8')), Buffer.alloc(1024)]));
let server = null;
let DL = '';
{
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/repos/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tag_name: 'v9.9.9', assets: [{ name: TARBALL, browser_download_url: DL + TARBALL }] }));
      return;
    }
    if (req.url.startsWith('/dl/')) { res.writeHead(200); res.end(tarGz); return; }
    res.writeHead(404); res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;
  DL = 'http://127.0.0.1:' + PORT + '/dl/';
  process.env.DSH_GH_RELEASE_API = 'http://127.0.0.1:' + PORT + '/repos/cli/cli/releases/latest';
  process.env.DSH_GH_DOWNLOAD_BASE = 'http://127.0.0.1:' + PORT + '/dl';
}

const mod = await import(new URL('./plugin.js', import.meta.url).href);
const tools = new Map();
mod.apply({ tools: { register: (t) => tools.set(t.name, t) }, provide: () => {}, effect: () => {} });
const installTool = tools.get('gh_cli_install');
const resolveTool = tools.get('gh_cli_resolve');
check('gh_cli_install / gh_cli_resolve 已注册', Boolean(installTool && resolveTool));

const aptCalled = async () => { try { await fs.stat(APT_MARK); return true; } catch { return false; } };

// ---- A. 没同意：不许碰系统层 ----
const a = await installTool.execute({}, {});
check('A 系统层低于期望被识别出来', a.systemOutdated === true, a.note);
check('A 没同意时如实回 consent-required', (a.systemUpgrade || {}).reason === 'consent-required', a.systemUpgrade);
check('A 改用自带副本落地成功', a.installed === true && a.layer === 'plugin-cache', { installed: a.installed, layer: a.layer });
check('A **包管理器一次都没被调用**', (await aptCalled()) === false);
check('A 台账里记下了这次没动的理由（失败也留痕）', ((a.systemGh || {}).last || {}).reason === 'consent-required', a.systemGh);

// ---- B. 同意之后：仍要过权限关 ----
const b0 = await installTool.execute({ system: 'manage' }, {});
check('B 同意落进插件 state（可撤）', Boolean((b0.systemGh || {}).consent), b0.systemGh && b0.systemGh.consent);
const b = await installTool.execute({ force: true }, {});
check('B 不是 root、sudo -n 拿不到 → no-permission', (b.systemUpgrade || {}).reason === 'no-permission', b.systemUpgrade);
check('B **仍然没有调用包管理器**', (await aptCalled()) === false);
check('B 台账落盘（失败原因也留痕）', Boolean((b.systemGh || {}).last) && (b.systemGh.last.reason === 'no-permission'), b.systemGh && b.systemGh.last);
check('B 本次仍用自带副本', b.installed === true && b.layer === 'plugin-cache', { layer: b.layer, version: b.version });

// ---- C. 撤销同意：回只读 ----
const c = await installTool.execute({ system: 'read-only' }, {});
check('C 撤销同意后不再有 consent', !(c.systemGh || {}).consent, c.systemGh);

// ---- D. 策略 read-only：连尝试都不尝试（子进程，因为策略在 apply 时读）----
const childFile = path.join(BIN, 'child.mjs');
await fs.writeFile(childFile, [
  "import os from 'node:os';",
  'os.homedir = () => process.env.HOME;',
  'const mod = await import(process.env.PLUGIN_URL);',
  'const tools = new Map();',
  'mod.apply({ tools: { register: (t) => tools.set(t.name, t) }, provide: () => {}, effect: () => {} });',
  'const r = await tools.get("gh_cli_resolve").execute({}, {});',
  'const i = await tools.get("gh_cli_install").execute({}, {});',
  'console.log(JSON.stringify({ resolve: r, install: i }));',
].join('\n'));
const pluginUrl = new URL('./plugin.js', import.meta.url).href;
const runChild = (env) => new Promise((r) => execFile(process.execPath, [childFile], {
  env: { ...process.env, ...env, HOME, DSH_GH_DATA_DIR: DATA_DIR + '-ro', PATH: BIN + ':' + REAL_PATH, PLUGIN_URL: pluginUrl },
}, (e, out, err) => r({ code: e ? 1 : 0, out: (out || '').trim(), err: (err || '').trim() })));
await fs.rm(DATA_DIR + '-ro', { recursive: true, force: true });
const d = await runChild({ DSH_GH_SYSTEM_POLICY: 'read-only' });
let parsed = null;
try { parsed = JSON.parse(d.out); } catch { /* 留空 */ }
check('D 子进程跑通（read-only 策略）', d.code === 0 && Boolean(parsed), { code: d.code, err: d.err.slice(0, 200) });
if (parsed) {
  check('D 报出系统层低于期望', parsed.install.systemOutdated === true, parsed.install.note);
  check('D 没动它（reason/say 里有 read-only）', /read-only/.test(String(parsed.install.note || '')), parsed.install.note);
  check('D 没同意时不会去碰系统层（无 systemUpgrade.ok）', !(parsed.install.systemUpgrade || {}).ok);
}
check('D 全程包管理器仍未被调用', (await aptCalled()) === false);

// ---- E. 真 HOME 未被触碰 ----
const realCacheExistedBefore = await fs.stat(path.join(REAL_HOME, '.dsh', 'gh-cli')).then(() => true, () => false);
check('E 真 HOME 的 gh 缓存存在状态未变', (await fs.stat(path.join(REAL_HOME, '.dsh', 'gh-cli')).then(() => true, () => false)) === realCacheExistedBefore);

if (server) server.close();
const failed = steps.filter((s) => !s.pass);
console.log(JSON.stringify({ checks: steps.length, failed: failed.length, steps }, null, 2));
process.exit(failed.length ? 1 : 0);
