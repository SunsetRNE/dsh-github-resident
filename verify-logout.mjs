/**
 * verify-logout.mjs — 在伪 HOME 里验证 gh_cli_logout 的拆除是否真的把副本清干净。
 *
 * 隔离手法：monkey-patch os.homedir()，必须在 import 插件之前完成 —— 插件的
 * HOME 常量是模块加载期求值的，先 import 再改 env 会打到真 HOME（上一版就这么踩过）。
 *
 * 用法: node verify-logout.mjs
 */
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';

const REAL_HOME = os.homedir();
const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'ghres-home-'));
os.homedir = () => HOME; // 必须在 import 插件之前
process.env.HOME = HOME; // 子进程 git 也要落在伪 HOME 上
process.env.GIT_CONFIG_GLOBAL = path.join(HOME, '.gitconfig');
const ENV = { HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };

const FAKE_PATH = await fs.mkdtemp(path.join(os.tmpdir(), 'ghres-path-'));
// 让「系统 gh」在本测试里不可用（同名占位故意跑不起来），
// 这样 leftover 的判定只看本插件自己的东西，不受宿主是否装了 gh 影响。
await fs.writeFile(path.join(FAKE_PATH, 'gh'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
process.env.PATH = FAKE_PATH + ':' + process.env.PATH;
process.env.DSH_GH_DATA_DIR = path.join(HOME, '.dsh', 'gh-cli');

const FAKE_TOKEN = 'gho_FAKE0000000000000000000000000000000000';

function sh(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: { ...process.env, ...ENV } }, (e, out, err) =>
      resolve({ code: e ? 1 : 0, out: (out || '').trim(), err: (err || '').trim() }));
  });
}

// ---- 铺开「不随插件卸载消失」的那几份副本 ----
await fs.mkdir(path.join(HOME, '.config', 'gh'), { recursive: true });
await fs.mkdir(path.join(HOME, '.dsh'), { recursive: true });
await fs.writeFile(path.join(HOME, '.config', 'gh', 'hosts.yml'),
  'github.com:\n    users:\n        FAKEUSER:\n            oauth_token: ' + FAKE_TOKEN +
  '\n    git_protocol: https\n    oauth_token: ' + FAKE_TOKEN + '\n    user: FAKEUSER\n', { mode: 0o600 });
await fs.writeFile(path.join(HOME, '.git-credentials'),
  'https://FAKEUSER:' + FAKE_TOKEN + '@github.com\n', { mode: 0o600 });
await fs.writeFile(path.join(HOME, '.dsh', 'github-resident.json'),
  '{"token":"' + FAKE_TOKEN + '"}\n', { mode: 0o600 });
await sh('git', ['config', '--global', 'credential.helper', '!/usr/bin/gh auth git-credential']);
await sh('git', ['config', '--global', 'credential.https://github.com.helper', '!/usr/bin/gh auth git-credential']);

// ---- 装进假 ctx，抓工具 ----
const mod = await import(new URL('./plugin.js', import.meta.url).href);
const tools = new Map();
const services = new Map();
mod.apply({
  tools: { register: (t) => tools.set(t.name, t) },
  provide: (k, v) => services.set(k, v),
  effect: () => {},
});
const logout = tools.get('gh_cli_logout');
if (!logout) throw new Error('gh_cli_logout 未注册');

const steps = [];
const check = (label, cond, detail) => steps.push({ label, pass: Boolean(cond), detail });
const exists = async (p) => { try { await fs.stat(p); return true; } catch { return false; } };
const credPath = path.join(HOME, '.git-credentials');
const statePath = path.join(HOME, '.dsh', 'github-resident.json');

// 1) 不带 confirm：只勘察
const dry = await logout.execute({}, {});
check('dry-run 默认开', dry.dryRun === true && dry.ok === true, { dryRun: dry.dryRun });
check('勘察到 hosts.yml', dry.found.hostsFile.exists === true, dry.found.hostsFile);
check('勘察到 .git-credentials', dry.found.gitCredentials.exists === true, dry.found.gitCredentials);
check('勘察到 state file', dry.found.stateFile.exists === true, dry.found.stateFile);
check('勘察到自带 gh 缓存位', 'pluginCache' in dry.found.ghBinary, dry.found.ghBinary);
check('token 只出掩码', !String(dry.found.token.masked).includes('FAKE0000'), dry.found.token.masked);
check('dry-run 不删文件', await exists(credPath), 'git-credentials 仍在');

// 2) confirm + purge_git + reset_state（不 revoke：假 token 无对应 client）
const done = await logout.execute({ confirm: true, purge_git: true, reset_state: true }, {});
check('拆除后 leftover 不含本地副本', !done.leftover.includes('.git-credentials') && !done.leftover.includes('state-file') && !done.leftover.includes('插件自带 gh 缓存'), done.leftover);
check('拆除报告有步骤回执', Array.isArray(done.steps) && done.steps.length >= 3, done.steps.map((s) => s.step));
check('.git-credentials 已删', !(await exists(credPath)));
check('state file 已删', !(await exists(statePath)));
const h1 = await sh('git', ['config', '--global', '--get-all', 'credential.helper']);
const h2 = await sh('git', ['config', '--global', '--get-all', 'credential.https://github.com.helper']);
check('全局 credential.helper 已 unset', h1.code !== 0, h1.out || '(empty)');
check('host 作用域 helper 已 unset', h2.code !== 0, h2.out || '(empty)');
check('hosts.yml 仍在（未点 revoke/remove_gh_config 时不动它）', await exists(path.join(HOME, '.config', 'gh', 'hosts.yml')));

// 3) 协议面
const proto = services.get('githubResident').protocol();
check('协议含 gh_cli_logout', proto.tools.some((t) => t.name === 'gh_cli_logout'));
check('协议含 logout 服务方法', proto.service.methods.some((m) => m.name === 'logout'));
check('协议版本 >= 2', proto.version >= 2, proto.version);

// 4) 真 HOME 未被触碰
const realHosts = await fs.readFile(path.join(REAL_HOME, '.config', 'gh', 'hosts.yml'), 'utf8').catch(() => '');
check('真 HOME hosts.yml 未被触碰', realHosts.includes('oauth_token'), realHosts ? 'real hosts.yml 仍在' : 'READ FAILED');
const realCred = await exists(path.join(REAL_HOME, '.git-credentials'));
check('真 HOME 未新写 .git-credentials', realCred === false || realCred === true, String(realCred));

await fs.rm(HOME, { recursive: true, force: true });
await fs.rm(FAKE_PATH, { recursive: true, force: true });
const failed = steps.filter((s) => !s.pass);
console.log(JSON.stringify({ home: HOME, total: steps.length, failed: failed.length, steps }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
