/**
 * github-resident — 常驻 GitHub 身份 + 多仓库提交/推送/PR 工具。
 *
 * 设计要点：
 *  - 凭据落盘在 ~/.dsh/github-resident.json（0600），并同步写 ~/.git-credentials（0600）
 *    + git config --global credential.helper store，让任何仓库的裸 `git push` 都免交互。
 *  - token 只从 env / 状态文件读取，任何工具输出都只回掩码，不回明文。
 *  - 工具全部用 node 内建模块实现（无第三方依赖），bundle 装进 profile 后每个会话常驻。
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

export const name = 'github-resident';
export const inject = ['tools'];

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, '.dsh');
const STATE_FILE = path.join(STATE_DIR, 'github-resident.json');
const CRED_FILE = path.join(HOME, '.git-credentials');
const DEFAULT_ROOT = path.join(HOME, 'GitHub');
// gh CLI 自己的凭据文件（**只读**：那是 gh 的格式，替它维护迟早对不上 —— ADR 0001）。
// 身份解析走 readHostsEntry（全插件唯一的**解析**入口）；gh_cli_status 的账号摘要另按显示需要
// 直接读同一路径（token 一律掩码）。路径只在这里定义一次，别处不许再拼。
const HOSTS_FILE = path.join(HOME, '.config', 'gh', 'hosts.yml');
const GH_HOST = 'github.com';

// ---------- 基础工具 ----------

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      // 保留 errno/signal：ENOENT（命令不存在）与「命令返回 1」必须能分开（审计 L8）。
      resolve({
        code,
        stdout: stdout || '',
        stderr: stderr || '',
        ...(err && typeof err.code === 'string' ? { errno: err.code } : {}),
        ...(err && err.signal ? { signal: err.signal } : {}),
      });
    });
  });
}

/**
 * 有界子进程 —— **读到结论即结算**，不等子进程（也不等它的孙进程）收场。
 *
 * 为什么不用 `run()` + `timeout` 就完事：`execFile` 自带 timeout 在 Node 24 上实测**确实会收场**，
 * 但「父进程能不能结算」这件事不该寄在子进程那一侧 —— 实测同一个挂死的桩，纯 `spawn` + `kill`
 * 的父进程永远等不到 'close'（孙进程攥着 stdout/stderr 管道就不放），也就是本仓踩过的
 * 「子进程不退」：不退出、不报错、不结束的第三态。
 *
 * 所以这里到点就自己结算，并显式放掉我们这端的管道：上界由**这一段代码**保证，不由子进程的收场保证。
 * 返回形状与 run() 一致，只多一个 `timedOut`。
 */
function runBounded(cmd, args, { timeoutMs, graceMs = 500, env = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let child = null;
    const finish = (out) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(out);
    };
    const releasePipes = () => {
      try { if (child && child.stdout) child.stdout.destroy(); } catch { /* 已经关了 */ }
      try { if (child && child.stderr) child.stderr.destroy(); } catch { /* 已经关了 */ }
      try { if (child && child.unref) child.unref(); } catch { /* 已经跑完 */ }
    };
    try {
      // env 通道（票「子进程环境…」）：与 run() 同一条规矩 —— 只认调用方显式给的**合并结果**（见 withBadge）。
      child = execFile(cmd, args, {
        maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
        ...(env ? { env } : {}),
      }, (err, stdout, stderr) => {
        finish({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          ...(err && typeof err.code === 'string' ? { errno: err.code } : {}),
          ...(err && err.signal ? { signal: err.signal } : {}),
          timedOut: Boolean(err && err.signal === 'SIGKILL'),
        });
      });
    } catch (err) {
      finish({ code: 1, stdout: '', stderr: String(err), timedOut: false });
      return;
    }
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* 可能已经死了 */ }
      releasePipes();
      finish({ code: 1, stdout: '', stderr: '', signal: 'SIGKILL', timedOut: true });
    }, timeoutMs + graceMs);
  });
}

/**
 * git 子进程出口。
 *
 * `opts`（票「子进程环境…」）：透传给 run() —— 身份与凭据要戴工牌时走 `withBadge('git').opts`；
 * **不传就是今天的样子**（继承现进程 env、只认宿主盘上的 git 配置）——体检 / 接线 / 对账那些「问盘上是什么」的
 * 调用**必须**走这条不传的路（注入会把「盘上真值」读成注入值：实测 `git config --get` 与 `git var` 取注入值，
 * 而 `git config --global --get` 仍读盘上）。
 */
function git(repo, args, opts = {}) {
  return run('git', ['-C', repo, ...args], opts);
}

/**
 * 读当前生效的 git 凭据助手 —— 只给**报告类**调用点用（gh_cli_status / buildSnapshot）。
 *
 * `gh auth setup-git` 写的是 host 作用域 credential.https://github.com.helper，
 * 而 git 先问 host 作用域、再回落全局 credential.helper。只读全局的话，
 * 在「helper 由 gh 接管」的常见状态下会读到空 —— 于是凭据明明能用、报告却说没接线：
 * 实测 `git ls-remote` 认证成功，gh_cli_status 却报 gitCredentialHelper=null（假告警）。
 *
 * 注意**不要**拿它去改登录流程的判断分支（gh_resident_login 里"已有非 store helper 就不覆盖"
 * 看的是全局 helper 本身：那里要判断的是"要不要回退写 store"，换成 host 作用域会把决策反过来）。
 */
/**
 * credential helper 的两个作用域**分开**读（ADR 0001 要的是事实，不是结论）：
 * gh 的 `auth setup-git` 写的是 host 作用域（`credential.https://github.com.helper`），
 * 它优先于全局 `credential.helper`。两个都报，谁在生效一眼可见 —— 原来只报「生效的那个」，
 * 于是「全局是空、是不是没接好」这种问题没人答得出来。
 * 全插件只有这一处读 helper 作用域：`readCredHelper` 与身份体检共用它。
 */
async function readCredHelpers() {
  const hostScope = (await git(process.cwd(), ['config', '--global', '--get-all', 'credential.https://github.com.helper'])).stdout.trim();
  const globalScope = (await git(process.cwd(), ['config', '--global', '--get-all', 'credential.helper'])).stdout.trim();
  return { hostScope, global: globalScope, effective: hostScope || globalScope };
}

async function readCredHelper() {
  return (await readCredHelpers()).effective;
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeState(patch) {
  const next = { ...(await readState()), ...patch };
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(STATE_FILE, 0o600);
  return next;
}

/**
 * 目录可写性判定 —— **只读**：`fs.access(W_OK)`，不写探针文件。
 * 探针的职责是「如实报告宿主」，不是「顺便在宿主上留个文件」。
 */
async function canWriteDir(p) {
  try { await fs.access(p, fsSync.constants.W_OK); return true; } catch { return false; }
}

/**
 * 读 gh CLI 的 hosts.yml（**只读**，绝不写回）里某个 host 的凭据。
 * 返回 { host, login, token }：缺失的字段各自回 ''，文件不在或格式不认得一律回空，**不抛**。
 * 兼容 gh 的实际写法：host 块以顶格 `<host>:` 起头；块内 `user:` 是登录名、`oauth_token:` 是令牌，
 * 两者都可能在 `users:` 子表里再深一层（深一层的也算这个 host 的），值可带引号。
 */
export async function readHostsEntry(hostname) {
  const empty = { host: hostname, login: '', token: '' };
  let raw = '';
  try { raw = await fs.readFile(HOSTS_FILE, 'utf8'); } catch { return empty; }
  const unquote = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) return s.slice(1, -1);
    return s;
  };
  let inHost = false;
  let login = '';
  let token = '';
  for (const line of raw.split(/\r?\n/)) {
    if (/^\S/.test(line)) {                       // 顶格 = 新的 host 块
      inHost = unquote(line.replace(/:\s*$/, '')) === hostname;
      continue;
    }
    if (!inHost) continue;
    const mT = line.match(/^\s+oauth_token:\s*(\S+)\s*$/);
    if (mT) { token = unquote(mT[1]); continue; }
    const mU = line.match(/^\s+user:\s*(\S+)\s*$/);
    if (mU) { login = unquote(mU[1]); continue; }
  }
  return { host: hostname, login, token };
}

/**
 * 统一身份解析器 —— ADR 0001 的真源口径：`env GH_TOKEN/GITHUB_TOKEN → 插件 state（0600） →
 * gh CLI hosts.yml（只读）`。这是**唯一**编码优先级的地方；改顺序要走新的 ADR。
 *
 * 返回 `{ ok, token, login, host, source, scopes }`：
 *   - `source` ∈ `env:GH_TOKEN` / `env:GITHUB_TOKEN` / `state:~/.dsh/github-resident.json` /
 *     `gh-cli:~/.config/gh/hosts.yml` / `(none)` —— 回执里如实标出来源，不许含糊成「有 token」。
 *   - `login` 只有从 state / hosts.yml 读到的才是真的；env 来源下**不猜**（回 null，让调用方自己去问）。
 *   - token 原文只在这份返回值里流动，**任何回执/日志一律走 maskIdentity()**。
 */
export async function resolveIdentity(stateInput) {
  const state = stateInput || (await readState());
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  if (envToken) {
    return {
      ok: true, token: envToken, login: null, host: GH_HOST,
      source: process.env.GH_TOKEN ? 'env:GH_TOKEN' : 'env:GITHUB_TOKEN', scopes: null,
    };
  }
  const stateToken = typeof state.token === 'string' ? state.token : '';
  if (stateToken) {
    return {
      ok: true, token: stateToken, login: state.login || state.user || null, host: GH_HOST,
      source: 'state:~/.dsh/github-resident.json', scopes: state.scopes || null,
    };
  }
  const entry = await readHostsEntry(GH_HOST);
  if (entry.token) {
    return {
      ok: true, token: entry.token, login: entry.login || null, host: GH_HOST,
      source: 'gh-cli:~/.config/gh/hosts.yml', scopes: null,
    };
  }
  return { ok: false, token: '', login: null, host: GH_HOST, source: '(none)', scopes: null };
}

/** 回执/日志专用的掩码投影：只出「来源 + 登录名 + 掩码」，永不带 token 原文。 */
export function maskIdentity(resolved) {
  const it = resolved || {};
  return {
    source: it.source || '(none)',
    login: it.login || null,
    host: it.host || GH_HOST,
    masked: mask(it.token),
    present: Boolean(it.token),
  };
}

/**
 * 提交邮箱的**唯一口径** —— 读侧（子进程 git 组）与写侧（`gh_identity {action:"wire"}` 的计划 / 台账 / 同意框）
 * 都从这里派生，别处不许再算第二份（2026-10-14 实测踩过：写侧硬编码隐私邮箱、读侧查 state，
 * 同一份 state 给出两个提交身份）。
 *
 * 顺序：state 里填过 `user_email` → 用它；没填过 → 由登录名生成 GitHub 的隐私邮箱形式；两者都没有 → null
 *（null 表示这一项根本写不出来，回执要如实说为什么，而不是编一个值）。
 * 「不填」不是一个值：它只是让这里走回退分支，state 里不会为此多出任何字段。
 */
export function commitEmail(state, login) {
  const explicit = state && typeof state.user_email === 'string' ? state.user_email.trim() : '';
  if (explicit) return explicit;
  return login ? login + '@users.noreply.github.com' : null;
}

/**
 * 「要不要填提交邮箱」这一问的**唯一文案**：登录成功后问一次，跳过就什么都不写。
 * 回退值的写法从 commitEmail() 派生（对空 state 求值＝纯回退形式）—— 别在这里再写一遍那个地址，
 * 否则「唯一口径」立刻变成两份（这正是本票修掉的那种分叉）。
 */
export function emailQuestion(login) {
  const fallback = commitEmail({}, login);
  return {
    question: '要不要填一个 git 提交用的邮箱？不填就用 GitHub 的隐私邮箱 '
      + (fallback || '（要先有登录名）')
      + '。不填不影响任何流程，之后随时能改（gh_identity {action:"email", email:"…"}）。',
    options: ['填一个邮箱（告诉我用哪个）', '就用隐私邮箱', '先不管'],
    onAgree: 'gh_identity {action:"email", email:"<你要用的提交邮箱>"}',
    onDecline: '一个字节都不写：这个环境下不会再问；想改随时 gh_identity {action:"email", email:"…"}',
  };
}

function mask(token) {
  if (!token) return '(none)';
  if (token.length <= 8) return `(len=${token.length})`;
  return `${token.slice(0, 4)}…${token.slice(-4)} (len=${token.length})`;
}

/**
 * 对 GitHub 的 REST 动作的**统一上界**（票「给对 GitHub 的网络动作定一套统一的有界冗余策略（可达性随机）」
 * 的收窄版：只把三处**完全没有上界**的 REST 调用变成有界；重试 / 退避 / 双通道**不在本票范围**）。
 * 默认 20s，`DSH_GH_NET_TIMEOUT_MS` 可覆盖；钳 100ms–120s。调用时才读，改环境不用重载插件
 *（与 `ghProbeTimeoutMs` 同款写法）。
 */
const GH_NET_DEFAULT_MS = 20000;

/** 导出给门禁直接钉「可配 + 上下限钳制 + 调用时才读」这三条（与 readHostsEntry / resolveIdentity 同一种接缝）。 */
export function ghNetTimeoutMs() {
  const raw = Number(process.env.DSH_GH_NET_TIMEOUT_MS);
  const ms = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : GH_NET_DEFAULT_MS;
  return Math.min(120 * 1000, Math.max(100, ms));
}

/**
 * 带上界的 fetch：超时抛一个**说得清是超时**的错（`err.timedOut` / `err.boundMs`），
 * 而不是让调用方拿到一个泛化错误、或者永远等下去（本仓不许的第三态）。
 * 只加上界这一件事 —— 传输层怎么选（fetch / curl）、要不要重试都保持现状（票面「留给下一轮」）。
 */
async function fetchBounded(url, init = {}) {
  const ms = ghNetTimeoutMs();
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      const err = new Error('请求在 ' + ms + 'ms 上界内没有回话（超时）—— 结果**未知**，不是「没有」'
        + '（要调上界：DSH_GH_NET_TIMEOUT_MS）');
      err.timedOut = true;
      err.boundMs = ms;
      throw err;
    }
    throw e;
  }
}

async function api(token, method, urlPath, body) {
  let res;
  try {
    res = await fetchBounded(`https://api.github.com${urlPath}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'dsh-github-resident',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // 超时是**第三种事实**：既不是「没身份」，也不是某个 HTTP 状态。如实回出去（`status` 留 null、
    // `timedOut` 为真），由每个调用方按自己的话术说「超时 / 未知」—— 别在这里吞成泛化错误。
    const message = String((e && e.message) || e);
    return { status: null, ok: false, timedOut: true, error: message, json: { message } };
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, json };
}

/**
 * 一行摘要：多行输出取第一条非空行。**保留原文**，不翻译成泛化错误 ——
 * 「两条路都没成」时，调用方要能分别读出 gh / GitHub 各自说了什么（票「gh_pr … 回落 gh pr create」R4）。
 */
function firstLine(s, max = 300) {
  const line = String(s == null ? '' : s).split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
  return line.slice(0, max);
}

/**
 * 回落路径的上界：默认 60s（开 PR 要出网，链路慢也得给足），但**绝不无限等**。
 * `DSH_GH_PR_TIMEOUT_MS` 可覆盖（门禁把它压到秒级好做「挂死」用例）；下限 200ms、上限 10 分钟，
 * 免得配出一个等于没有上界的值。调用时才读，改环境不用重载插件。
 */
const PR_FALLBACK_DEFAULT_MS = 60 * 1000;

function prFallbackTimeoutMs() {
  const raw = Number(process.env.DSH_GH_PR_TIMEOUT_MS);
  const ms = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : PR_FALLBACK_DEFAULT_MS;
  return Math.min(600 * 1000, Math.max(200, ms));
}

/**
 * gh **探测**的上界（票「gh 探测也要有界：probeGh（gh --version）不能无限等」）。
 *
 * 探测 = 跑一次 `<gh> --version`（或 `command -v gh`）。它是本插件最热的一次子进程，
 * 也是「gh 一卡死就永远等」的那个入口 —— 所以上界做成**默认值**，而不是让每个调用点自己记得传：
 * 实测（票 29 的诊断）十来个调用点里只有环境探针传了，其余全在无上界的 `run()` 上。
 *
 * 默认 5s（与既有进程探针同档），`DSH_GH_PROBE_TIMEOUT_MS` 可覆盖；钳 100ms–60s。
 * 调用时才读，改环境不用重载插件。
 */
const GH_PROBE_DEFAULT_MS = 5000;

function ghProbeTimeoutMs() {
  const raw = Number(process.env.DSH_GH_PROBE_TIMEOUT_MS);
  const ms = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : GH_PROBE_DEFAULT_MS;
  return Math.min(60 * 1000, Math.max(100, ms));
}

// ---------- 仓库发现与状态 ----------

async function isRepo(dir) {
  const r = await git(dir, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

async function findRepos(root, depth) {
  const found = [];
  async function walk(dir, level) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // worktree / submodule 的 `.git` 是**文件**：只看 isDirectory 会把整棵树漏掉（审计 L1）。
    if (entries.some((e) => e.name === '.git')) found.push(dir);
    if (level >= depth) return;
    for (const child of entries) {
      if (!child.isDirectory() || child.name === '.git' || child.name === 'node_modules') continue;
      await walk(path.join(dir, child.name), level + 1);
    }
  }
  await walk(root, 0);
  return found.sort();
}

async function repoStatus(repo) {
  const branch = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || '(no-commit)';
  const porcelain = (await git(repo, ['status', '--porcelain'])).stdout.trim();
  const files = porcelain ? porcelain.split('\n').filter(Boolean) : [];
  const remote = (await git(repo, ['remote', 'get-url', 'origin'])).stdout.trim() || '';
  const { ahead, behind } = await aheadBehind(repo);
  return { repo, branch, remote, dirty: files.length, ahead, behind, sample: files.slice(0, 15) };
}

async function commitRepo(repo, message, push) {
  const add = await git(repo, ['add', '-A']);
  if (add.code !== 0) return { repo, step: 'add', ok: false, stderr: add.stderr.trim() };
  const staged = (await git(repo, ['diff', '--cached', '--name-only'])).stdout.trim();
  if (!staged) return { repo, step: 'commit', ok: false, reason: 'no staged changes' };
  // 提交与推送**戴 git 组**（票「子进程环境…」）：提交要「谁写的」、推送要过凭据这一关 ——
  // 宿主全局 git 配置与 ~/.git-credentials 撤掉之后，这两步靠的就是它。`add` / 读状态那些不戴。
  const badge = await withBadge('git');
  const commit = await git(repo, ['commit', '-m', message], badge.opts);
  if (commit.code !== 0) return { repo, step: 'commit', ok: false, stderr: commit.stderr.trim(), identityEnv: badge.badge };
  const sha = (await git(repo, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
  const result = { repo, step: 'commit', ok: true, sha, files: staged.split('\n').length, message, identityEnv: badge.badge };
  if (!push) return result;
  const pushRes = await git(repo, ['push'], badge.opts);
  result.push = pushRes.code === 0 ? 'ok' : 'failed';
  if (pushRes.code !== 0) result.push_stderr = (pushRes.stderr || pushRes.stdout).trim().slice(0, 500);
  return result;
}

// ---------- Git 仓库登记文件库（repo registry） ----------
// 对外契约（同时写进 PROTOCOL.registry，是插件协议的一部分）：
//  - 一仓一文件：REGISTRY_REPO_DIR/<slug>.json，slug = <basename>-<sha1(绝对路径)[:12]>；
//    目录本身即事实来源 —— 消费方只读目录就能拿到「当前环境有哪些 Git 仓库、有没有绑远端」，
//    不必调本插件任何工具。
//  - 授权才落盘：没有 consent.json 且本次调用没带 consent:true 时，一个字节都不写，
//    工具只回一个 ask 载荷，让模型把问题原样转给用户。
//  - 绝不写进仓库内部：所有写入都在 REGISTRY_DIR 之内，登记不改变任何工作树的 dirty 计数。
//  - URL 落盘前脱敏：https://user:pass@host/... 只保留 https://host/...，token 永不出现在库里。

const REGISTRY_SCHEMA = 'dsh-github-resident/repo-entry';
const REGISTRY_INDEX_SCHEMA = 'dsh-github-resident/registry-index';
const REGISTRY_CONSENT_SCHEMA = 'dsh-github-resident/registry-consent';
const REGISTRY_SCHEMA_VERSION = 2;

const REGISTRY_BASE = process.env.DSH_GH_REGISTRY_DIR || path.join(STATE_DIR, 'github-resident');
const REGISTRY_DIR = path.join(REGISTRY_BASE, 'registry');
const REGISTRY_REPO_DIR = path.join(REGISTRY_DIR, 'repos');
const REGISTRY_INDEX_FILE = path.join(REGISTRY_DIR, 'index.json');
const REGISTRY_CONSENT_FILE = path.join(REGISTRY_DIR, 'consent.json');

const REGISTRY_ACTIONS = ['status', 'plan', 'build', 'rescan', 'verify', 'forget', 'revoke', 'purge'];

// ---------- 接线（wire / verify / unwire）：投影点的落点、台账与授权 ----------
// 「投影」= 把真源（插件 state）投射到宿主上的几个消费点。写动作归 `gh_identity`，但**与登记库不共用授权文件**：
// 登记库那条授权说的是「哪些目录可以扫描」，这条说的是「哪些宿主配置可以改」，两件事不能互相顶用。
// 落点跟着 **HOME** 走（默认 ~/.dsh/github-resident/wire），与登记库同父目录但**不搭它的环境变量**：
// 登记库的 DSH_GH_REGISTRY_DIR 是给「扫描哪些仓库」用的，顺手把接线数据也搬走会让门禁的隔离互相串味（踩过一次）。
// DSH_GH_WIRE_DIR 单独覆盖接线目录 —— 门禁要单独钉它时用得上。
const WIRE_DIR = process.env.DSH_GH_WIRE_DIR || path.join(STATE_DIR, 'github-resident', 'wire');
const WIRE_HELPER_FILE = path.join(WIRE_DIR, 'git-credential-helper');
const WIRE_LEDGER_FILE = path.join(WIRE_DIR, 'ledger.json');
const WIRE_CONSENT_FILE = path.join(WIRE_DIR, 'consent.json');
const WIRE_LEDGER_SCHEMA = 'dsh-github-resident/wire-ledger';
const WIRE_CONSENT_SCHEMA = 'dsh-github-resident/wire-consent';

// 运行期身份环境的落点（票「子进程环境：插件启动的 gh / git 子进程按需带上真源 token」）。
// 与接线目录 `WIRE_DIR` **故意分开**：接线是「把真源投射到宿主盘上」（可对账、可撤销、要同意），
// 运行期是「给这一次子进程指路」（插件自有资产、不碰宿主、不需要同意）—— 合成一个目录会让体检/台账串味
//（「助手存在」与「接线过没接过」变成同一个事实）。助手源码与接线那份**同源**（同一个常量）。
const RUNTIME_DIR = process.env.DSH_GH_RUNTIME_DIR || path.join(STATE_DIR, 'github-resident', 'runtime');
const RUNTIME_HELPER_FILE = path.join(RUNTIME_DIR, 'git-credential-helper');

// 重活租约的落点（协议 `load` 段 / 工具 `gh_load_lease`）。
// 「重活」＝全量门禁 / 合成环境矩阵这类会同时起一堆子进程的活。同一台机器上**一次只许一份**：
// 本机实测宿主进程被系统杀过 6 次（00:35 / 00:51 / 01:07 / 01:17 / 02:16 / 02:18），签名都是「外部杀」，
// 而相关性明确 —— 重活并跑 / 连着跑；多会话并跑时各自的 agent 看不见别人，所以规矩要写进协议、锁要自己上。
const LOAD_LEASE_FILE = process.env.DSH_GH_LOAD_LEASE || path.join(STATE_DIR, 'github-resident', 'load-lease.json');
const LOAD_LEASE_DEFAULT_TTL_MS = 30 * 60 * 1000;
const LOAD_LEASE_HELD_ENV = 'DSH_GH_LOAD_LEASE_HELD';   // 祖先进程已持有时传给子进程的记号（runner 与门禁共用）
/** 凭据助手的落点（host 作用域）：它**优先于**全局 `credential.helper`；写全局会把所有 host 都劫走。 */
const CRED_HOST_HELPER_KEY = 'credential.https://' + GH_HOST + '.helper';

/**
 * 插件自有的 git 凭据助手（写到 WIRE_HELPER_FILE，0755）。
 *
 * 只用 node 内建模块，git 调它时按 git credential 协议读 stdin、把真源身份答回去：
 * 取值只来自**插件 state（0600）**——不读 hosts.yml、不落第二份 token、不缓存。
 * state 缺失 / 没 token / host 不是 github.com 时**静默不答**（exit 0、无输出），
 * 让 git 继续问下一个助手，而不是把错误甩给 git。
 */
const GIT_CREDENTIAL_HELPER_SRC = `#!/usr/bin/env node
// 本插件自有：读插件 state（0600）回答 git credential 请求。由 gh_identity {action:"wire"} 落盘，勿手改。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const op = process.argv[2] || 'get';
if (op !== 'get') process.exit(0);            // store / erase：不落盘（真源在插件 state，不在这里）
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  const want = {};
  for (const line of raw.split(/\\r?\\n/)) {
    const i = line.indexOf('=');
    if (i > 0) want[line.slice(0, i)] = line.slice(i + 1);
  }
  if (want.protocol && want.protocol !== 'https') process.exit(0);
  if (want.host && want.host !== 'github.com') process.exit(0);
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'github-resident.json'), 'utf8'));
  } catch {
    process.exit(0);
  }
  const token = typeof state.token === 'string' ? state.token : '';
  if (!token) process.exit(0);
  process.stdout.write('username=' + (state.login || 'x-access-token') + '\\n');
  process.stdout.write('password=' + token + '\\n');
});
`;

/**
 * 落一份插件自有凭据助手（0755；内容已一致就不重写，免得每次提交都改 mtime）。
 *
 * 两处共用**同一份源码**、两个落点，语义不同（见 `RUNTIME_DIR` 那段注释）：接线那处要台账可对账，
 * 运行期这处只是「给这一次子进程指路」。写盘失败不抛给调用方 —— 由调用方按「没戴上」如实报。
 */
async function landGitCredentialHelper(dir, file) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await chmodQuiet(dir, 0o700);
  const cur = await fs.readFile(file, 'utf8').catch(() => null);
  if (cur !== GIT_CREDENTIAL_HELPER_SRC) {
    await fs.writeFile(file, GIT_CREDENTIAL_HELPER_SRC, { mode: 0o755 });
  }
  await chmodQuiet(file, 0o755);
  return file;
}

const ensureRuntimeHelper = () => landGitCredentialHelper(RUNTIME_DIR, RUNTIME_HELPER_FILE);

/** 登录名：解析器的答案优先（state / hosts.yml 来源才有），否则退回 state 里可能存在的 login/user。 */
function identityLogin(state, resolved) {
  return (resolved && resolved.login) || (typeof state.login === 'string' ? state.login : '')
    || (typeof state.user === 'string' ? state.user : '') || '';
}

/**
 * 子进程身份环境（票「子进程环境：插件启动的 gh / git 子进程按需带上真源 token」）
 * —— **两组、分开给**、值**现算不缓存**。
 *
 * 谁戴谁不戴，判断在**调用点**（本函数只负责"给什么"）：
 *   戴 —— 真要以**插件身份**做事的动作：git 的提交 / 推送（身份与凭据）、`gh api user` 这类以身份作答的调用；
 *   不戴 —— 探活（`gh --version`）、状态与读数（四处 `gh auth status`、`hosts.yml`、`git config --global …`）。
 *   理由是**实测**的：`GH_TOKEN` 一旦给了子进程，它会**盖过** gh 自己的登录态（假 token 下 `auth status` 报
 *   GH_TOKEN 无效、hosts.yml 里的账号不再 active）—— 戴在读数上会把「宿主自己登没登录」读成「插件有身份」，
 *   也会把体检读成假绿。
 *
 * 返回 `{ gh, git, source, login, degraded }`（`degraded` 只在落盘失败这种降级情形下非空）：
 *   - `gh` 组：`GH_TOKEN` + 非交互三件套（`GH_PROMPT_DISABLED` / `GH_PAGER` / `NO_COLOR`）；
 *     **不含** `GH_CONFIG_DIR`（那是 gh 自己的家，替它搬家就读不出「它自己登没登录」）；
 *     真源没有 token 时**空组** —— 宁可什么都不给，也不给一套看起来「配好了」的假环境。
 *   - `git` 组：`GIT_TERMINAL_PROMPT=0` + `GIT_CONFIG_*` 注入身份与凭据助手；**不含** `GH_TOKEN`
 *     （git 的环境「同屋共享」：commit hook、子模块、兄弟进程都读得到）。
 *     提交邮箱走**唯一口径** `commitEmail()`（state 里填过就用它；没填过退回隐私邮箱形式）——
 *     与 `wire` 写出去的全局 `user.email` 同一处取值，两个消费点不许各算一份。
 *     ⚠️ **空值重置必须排在助手之前**（实测，git 2.43）：git 的助手是「按配置出现顺序依次问、先答者胜」，
 *     而**文件的条目排在命令行（`GIT_CONFIG_*`）注入的条目之前** —— 宿主已有的 `credential.helper=store`
 *     （里头常压着过期凭据）或 gh 写的 host 作用域助手会先被问到并作答，工牌根本没被问到（实测拿到的是 `stale-user`）。
 *     先注入一条**空的同一个键**把这一组清掉，再指我们的助手 —— 这也是 gh 自己 `auth setup-git` 用的手法。
 *     用**通用键** `credential.helper=` 清会连别的 host（例如 gitlab）的宿主凭据一起清掉 —— 越权，不许。
 *   - `groups`：调用方声明这次要哪几组（默认两组都给）；只有真要 `git` 组时才**落助手文件**
 *     （写盘只发生在要用的那一刻 —— 体检那种只读路径不该因为它多出一个文件）。
 */
async function identityEnv({ groups = ['gh', 'git'], land = true } = {}) {
  const state = await readState();
  const resolved = await resolveIdentity(state);
  const login = identityLogin(state, resolved);
  const out = { gh: {}, git: {}, source: resolved.source || '(none)', login: login || null, degraded: [] };

  if (groups.includes('gh') && resolved.token) {
    out.gh.GH_TOKEN = resolved.token;
    out.gh.GH_PROMPT_DISABLED = '1';
    out.gh.GH_PAGER = 'cat';
    out.gh.NO_COLOR = '1';
  }

  if (groups.includes('git')) {
    out.git.GIT_TERMINAL_PROMPT = '0';   // 不许它问人（GUI askpass 那条路也一并断掉）
    const keys = [];
    const values = [];
    const stateToken = typeof state.token === 'string' ? state.token : '';
    // 助手答的是**插件 state**（与接线那份同源）；凭据不在 state 里（例如只有 env 覆盖）时，
    // 指过去也答不出东西 —— 那就不指，免得给 git 一个「有助手但永远不答」的假接线。
    if (stateToken && land) {
      // 落盘失败（HOME 只读、目录被占…）**不许把调用整个炸掉**：如实降级成「这一组没有凭据指路」，
      // 由回执的 `degraded` 与体检的 `helperLanded` 说出去 —— 宁可少戴一样，也不能让提交/推送无谓失败。
      try {
        const helperFile = await ensureRuntimeHelper();
        keys.push(CRED_HOST_HELPER_KEY); values.push('');            // ① 清掉这一组继承来的助手
        keys.push(CRED_HOST_HELPER_KEY); values.push('!' + helperFile);  // ② 再指插件自有助手
      } catch (e) {
        out.degraded.push('git-helper');
      }
    }
    // 全局身份两项**各按各的口径**给：`user.name` 要有登录名；`user.email` 只认**唯一口径** commitEmail()
    //（state 里填过就用它；没填过退回隐私邮箱形式）—— 与 `wire` 写出去的全局 user.email 同源。
    // 分开判是有意的：登录名解析不出来（env token 不带登录名）时，用户填过的邮箱照样戴得上，
    // 于是「没 login」这一格两个消费点也给出同一个答案。
    const email = commitEmail(state, login);
    if (login) { keys.push('user.name'); values.push(login); }
    if (email) { keys.push('user.email'); values.push(email); }
    if (keys.length) {
      out.git.GIT_CONFIG_COUNT = String(keys.length);
      keys.forEach((k, i) => { out.git['GIT_CONFIG_KEY_' + i] = k; out.git['GIT_CONFIG_VALUE_' + i] = values[i]; });
    }
  }
  return out;
}

/**
 * 体检用：**只读**地回答「子进程环境这一支现在能给出什么」—— 不落任何文件、不吐任何值。
 * 与 `identityEnv()` 共用同一个登录名口径，避免两处各算一份。
 */
async function identityEnvFacts() {
  const state = await readState();
  const resolved = await resolveIdentity(state);
  const login = identityLogin(state, resolved);
  const helperLanded = await fs.access(RUNTIME_HELPER_FILE).then(() => true, () => false);
  return {
    canInjectGh: Boolean(resolved.token),
    canInjectGit: Boolean((typeof state.token === 'string' && state.token) || login),
    login: login || null,
    helper: RUNTIME_HELPER_FILE,
    helperLanded,
  };
}

/**
 * 戴工牌 + 如实回执：`{ opts, badge }` —— `opts` 交给 `run()` / `git()`，`badge` 放进这次的回执。
 *
 * env 是**合并**进现进程 env 的：Node 的 `env` 选项是**整体替换**，只给身份组会把 `PATH` / `HOME` 弄丢（实测）。
 * `badge` 只报「戴了哪组、身份从哪来」，**不含任何值**（token 一律掩码、原文不出现在回执里）。
 */
async function withBadge(group, extra = {}) {
  const env = await identityEnv({ groups: [group] });
  const applied = Object.keys(env[group]).length > 0;
  const badge = { applied: applied ? [group] : [], source: env.source };
  // 票 #37（已裁「经验判据 + 措辞收窄」）：`applied` 只说「往这一组注入了环境」，**不区分**两种情形 ——
  //   · 已清场并指向插件自有助手（这条路上**实测是我们答的**：宿主压着过期的 store 助手时仍回插件凭据，判据在 subprocess-env）；
  //   · 真源 state 里没有 token，**压根没指路**（identityEnv 那一支不进），凭据由宿主自己的助手决定。
  // 后者最容易被读成「赢了」，所以单列一个字段如实说，没指路时再附一句 note。
  if (group === 'git' && applied) {
    // 注意：助手那条在 env 里是 `GIT_CONFIG_KEY_<i>` 的**值**（键名是 git 的配置项写法），不是属性名 ——
    // 按属性名找会永远找不到（这一点是本票判据第一次跑就抓出来的：有 token 却被判成「没指路」）。
    const pointed = Object.keys(env.git).some((k) => /^GIT_CONFIG_KEY_\d+$/.test(k) && env.git[k] === CRED_HOST_HELPER_KEY);
    badge.gitCredential = pointed ? 'plugin-helper' : 'none';
    if (!pointed) {
      badge.note = 'git 这条**没有指路**（真源 state 里没有 token）：凭据由宿主自己的助手决定 —— 「戴了」不等于「赢了」';
    }
  }
  if (env.degraded && env.degraded.length) badge.degraded = env.degraded.slice();
  return { opts: { ...extra, env: { ...process.env, ...env[group] } }, badge };
}

// ---------- 重活租约：同一台机器上的重活一次只许一份 ----------

/** pid 还活着吗？`null` = 没记 pid（不知道），true/false = 明确。EPERM 说明进程在、只是不是我的。 */
function leasePidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; } catch (e) { return Boolean(e && e.code === 'EPERM'); }
}

/** 租约的**只读视图**：把「谁在跑、什么时候到期、那个 pid 还在不在、能不能回收」一次说清。 */
function leaseView(lease) {
  if (!lease || typeof lease !== 'object') return null;
  const alive = leasePidAlive(lease.pid);
  const expiresAt = typeof lease.expiresAt === 'string' ? lease.expiresAt : null;
  const expired = expiresAt ? Date.parse(expiresAt) <= Date.now() : true;   // 没写到期时间 = 当作过期（可回收）
  return {
    holder: lease.holder || null, purpose: lease.purpose || null, pid: Number.isInteger(lease.pid) ? lease.pid : null,
    host: lease.host || null, at: lease.at || null, expiresAt, ttlMs: Number.isFinite(lease.ttlMs) ? lease.ttlMs : null,
    pidAlive: alive, expired,
    // 可回收 = 过期，或持有人**明确**已经不在（pid 查不到）。查不到 pid 时只按过期算。
    stale: expired || alive === false,
  };
}

async function readLoadLease() {
  try {
    const raw = await fs.readFile(LOAD_LEASE_FILE, 'utf8');
    return { file: LOAD_LEASE_FILE, exists: true, lease: JSON.parse(raw), error: null };
  } catch (e) {
    const missing = e && e.code === 'ENOENT';
    return { file: LOAD_LEASE_FILE, exists: false, lease: null, error: missing ? null : String((e && e.message) || e) };
  }
}

/**
 * 取租约。**只在**没人持有 / 持有人过期 / 持有人 pid 明确已经不在时成功（这里**没有** force：
 * 抢别人的锁正是这个机制要消灭的事）。回收不是悄悄发生的：回执里带 `reclaimed`。
 */
async function acquireLoadLease({ holder, purpose, ttlMs } = {}) {
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.round(ttlMs) : LOAD_LEASE_DEFAULT_TTL_MS;
  const me = {
    holder: String(holder || ('pid ' + process.pid)), purpose: String(purpose || '未注明'),
    pid: process.pid, host: os.hostname(), at: new Date().toISOString(),
    ttlMs: ttl, expiresAt: new Date(Date.now() + ttl).toISOString(),
  };
  await fs.mkdir(path.dirname(LOAD_LEASE_FILE), { recursive: true, mode: 0o700 });
  let reclaimed = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // `wx` = 存在就失败：取锁这一步必须是原子的，不能"先读再写"（那中间有窗口）。
      await fs.writeFile(LOAD_LEASE_FILE, JSON.stringify(me, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await chmodQuiet(LOAD_LEASE_FILE, 0o600);
      return { ok: true, acquired: true, lease: me, reclaimed };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return { ok: false, acquired: false, error: String((e && e.message) || e) };
      const cur = await readLoadLease();
      const view = leaseView(cur.lease);
      if (view && view.stale) {
        // 回收：先把陈旧的删掉，再抢一次（只重试一轮；有人同时抢就如实回"没拿到"）。
        await fs.rm(LOAD_LEASE_FILE, { force: true });
        reclaimed = view;
        continue;
      }
      return { ok: false, acquired: false, heldBy: view, note: '同一台机器上已经有重活在跑：换时间，别无脑并跑' };
    }
  }
  return { ok: false, acquired: false, error: '回收之后又撞上了（有人刚抢到）' };
}

/** 放租约。**只认持有者**（不替别人放 —— 那会把正在跑的那一位解锁）。 */
async function releaseLoadLease({ holder } = {}) {
  const cur = await readLoadLease();
  if (!cur.lease) return { ok: true, released: false, note: '没有租约（已经是空的）' };
  const mine = holder ? String(cur.lease.holder) === String(holder) : cur.lease.pid === process.pid;
  if (!mine) return { ok: false, released: false, heldBy: leaseView(cur.lease), note: '租约不是你的：不替别人放' };
  await fs.rm(LOAD_LEASE_FILE, { force: true });
  return { ok: true, released: true, was: leaseView(cur.lease) };
}

/**
 * `gh_identity` 五个动作各自的回执视图 —— **一处声明**：工具目录那行、协议 identity 段、门禁都从这里派生。
 * 信封（`ok` / `protocol`）不算业务字段，不进这张表。改字段＝接口变更，先改这里。
 */
/** `gh_load_lease` 三个动作各自的回执视图 —— 一处声明：工具目录那行与协议 `load` 段都从这里派生。 */
const LOAD_LEASE_VIEWS = {
  status: ['ok', 'action', 'held', 'lease', 'file', 'exists', 'note', 'error'],
  acquire: ['ok', 'action', 'acquired', 'lease', 'heldBy', 'reclaimed', 'note', 'error'],
  release: ['ok', 'action', 'released', 'was', 'heldBy', 'note', 'error'],
};
const LOAD_LEASE_RETURNS = [...new Set(Object.values(LOAD_LEASE_VIEWS).flat())];

const GH_IDENTITY_VIEWS = {
  audit: ['identity', 'points', 'config', 'summary'],
  wire: ['action', 'consentRequired', 'wrote', 'plan', 'results', 'ledger', 'consent', 'ask'],
  verify: ['action', 'items', 'summary', 'disk', 'ledger', 'notes'],
  unwire: ['action', 'consentRequired', 'wrote', 'results', 'ledger', 'consent', 'ask'],
  // 提交邮箱（唯一的填写入口）：`email` = state 里存着的值（null＝没填过）；`effective` = **现在接线会用到的**
  // 那个值（填过就是它，没填过是隐私邮箱形式，两样都没有是 null）—— 让「填了到底生效没有」在同一份回执里闭环。
  // （`error` 是失败回执的通用键、信封级，按惯例不进视图 —— 别的动作视图也不列它。）
  email: ['action', 'email', 'effective', 'wrote', 'stateFile', 'note'],
};
const GH_IDENTITY_ACTIONS = Object.keys(GH_IDENTITY_VIEWS);
const GH_IDENTITY_RETURNS = [...new Set(Object.values(GH_IDENTITY_VIEWS).flat())];

/** 稳定 slug：路径唯一化，同时保持人类可读前缀。 */
function registrySlug(absPath) {
  const base = (path.basename(absPath) || 'repo').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 40) || 'repo';
  return base + '-' + createHash('sha1').update(absPath).digest('hex').slice(0, 12);
}

/** 远端 URL 脱敏：剥掉 userinfo，绝不把凭据写进登记库。 */
function redactRemoteUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.username || u.password) { u.username = ''; u.password = ''; }
    return u.toString();
  } catch {
    const m = url.match(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/@]+)@(.*)$/);
    return m ? m[1] + m[3] : url;
  }
}

/** 把一个远端 URL 拆成 { scheme, host, owner, name }；支持 URL 与 git@host:owner/repo 两种写法。 */
function parseRemoteUrl(raw) {
  const out = { scheme: null, host: null, owner: null, name: null };
  const url = String(raw || '').trim();
  if (!url) return out;
  let host = '';
  let p = '';
  const m1 = url.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:[^/@]*@)?([^/]+)\/(.+)$/);
  if (m1) {
    out.scheme = m1[1].toLowerCase();
    host = m1[2];
    p = m1[3];
  } else {
    const m2 = url.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
    if (m2) { out.scheme = 'ssh'; host = m2[1]; p = m2[2]; }
  }
  if (host) out.host = host.replace(/:\d+$/, '');
  const seg = p.replace(/\.git$/, '').replace(/^\/+/, '').split('/').filter(Boolean);
  if (seg.length >= 2) { out.owner = seg.slice(0, -1).join('/'); out.name = seg[seg.length - 1]; }
  else if (seg.length === 1) out.name = seg[0];
  return out;
}

function remoteView(raw) {
  const url = redactRemoteUrl(raw);
  return { url, ...parseRemoteUrl(url) };
}

/** 按 host 更新 ~/.git-credentials 的一行：保留其它 host 的凭据，0600 落盘（审计 L6）。 */
async function writeCredentialLine(file, host, userinfo) {
  let lines = [];
  try {
    lines = (await fs.readFile(file, 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { /* 文件不存在就从空开始 */ }
  const kept = lines.filter((l) => {
    try { return new URL(l).hostname !== host; } catch { return true; }
  });
  kept.push('https://' + userinfo + '@' + host);
  await fs.writeFile(file, kept.join('\n') + '\n', { mode: 0o600 });
  await chmodQuiet(file, 0o600);
  return file;
}

async function chmodQuiet(p, mode) {
  await fs.chmod(p, mode).catch(() => {});
}

/** 原子写：同目录 tmp + rename，0600；目录 0700。 */
async function writeJsonAtomic(file, data, mode = 0o600) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await chmodQuiet(dir, 0o700);
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
  await fs.rename(tmp, file);
  await chmodQuiet(file, mode);
  return file;
}

/** 相对 upstream 的 ahead/behind；没有 upstream 或 rev-list 失败时都是 null（单一实现，审计 R4）。 */
async function aheadBehind(repo) {
  const lr = await git(repo, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
  if (lr.code !== 0) return { ahead: null, behind: null };
  const [b, a] = lr.stdout.trim().split(/\s+/).map((n) => Number(n));
  return { ahead: a, behind: b };
}

/** 单个仓库的 git 事实；不在仓库里就回 { isRepo:false }。 */
async function registryGitFacts(repo) {
  if (!(await isRepo(repo).catch(() => false))) return { isRepo: false, remotes: [] };
  const branch = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || '(no-commit)';
  const head = (await git(repo, ['rev-parse', '--short', 'HEAD'])).stdout.trim() || null;
  const porcelain = (await git(repo, ['status', '--porcelain'])).stdout.trim();
  const lines = porcelain ? porcelain.split('\n').filter(Boolean) : [];
  const lastAt = (await git(repo, ['log', '-1', '--format=%cI'])).stdout.trim() || null;
  const lastSubject = (await git(repo, ['log', '-1', '--format=%s'])).stdout.trim() || null;
  const remoteOut = (await git(repo, ['remote', '-v'])).stdout.trim();
  const remotes = [];
  for (const line of remoteOut ? remoteOut.split('\n') : []) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!m) continue;
    if (remotes.some((r) => r.name === m[1])) continue;
    remotes.push({ name: m[1], url: m[2] });
  }
  const upstreamRaw = (await git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).stdout.trim();
  const { ahead, behind } = await aheadBehind(repo);
  const branchOut = (await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).stdout.trim();
  return {
    isRepo: true,
    branch,
    head,
    detached: branch === 'HEAD' || !head,
    dirty: lines.length,
    untracked: lines.filter((l) => l.startsWith('??')).length,
    clean: lines.length === 0,
    lastCommitAt: lastAt,
    lastCommitSubject: lastSubject,
    remotes,
    hasRemote: remotes.length > 0,
    remoteCount: remotes.length,
    upstream: upstreamRaw || null,
    ahead,
    behind,
    localBranches: branchOut ? branchOut.split('\n').filter(Boolean).length : 0,
  };
}

/** 组装一个登记条目；与旧条目合并以保留 notes / tags / registeredAt。 */
function registryEntryFrom(repo, facts, prev, extra = {}) {
  const now = new Date().toISOString();
  // 展开顺序有讲究：remoteView 里的 name 是「URL 里的仓库名」，别让它盖掉远端名（origin / upstream）。
  const remotes = (facts.remotes || []).map((r) => {
    const view = remoteView(r.url);
    return { name: r.name, url: view.url, scheme: view.scheme, host: view.host, owner: view.owner, repoName: view.name };
  });
  const origin = remotes.find((r) => r.name === 'origin') || remotes[0] || null;
  return {
    schema: REGISTRY_SCHEMA,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    slug: registrySlug(repo),
    name: path.basename(repo),
    path: repo,
    registeredAt: prev?.registeredAt || now,
    updatedAt: now,
    source: extra.source || prev?.source || 'scan',
    notes: extra.notes !== undefined ? extra.notes : (prev?.notes ?? ''),
    tags: extra.tags !== undefined ? extra.tags : (prev?.tags ?? []),
    git: { ...facts, isRepo: true, remotes, origin, url: origin ? origin.url : null },
  };
}

/** 条目里远端的仓库名：新条目读 repoName，旧条目（schemaVersion 1）从 URL 反解。 */
function remoteRepoName(remote) {
  if (!remote) return null;
  return remote.repoName || parseRemoteUrl(remote.url).name || null;
}

/** 读整个文件库；文件即事实来源，schema 不符的进 malformed，不静默吞掉。 */
async function readRegistry() {
  const out = { exists: false, dir: REGISTRY_REPO_DIR, entries: [], malformed: [] };
  let names = [];
  try {
    names = await fs.readdir(REGISTRY_REPO_DIR);
  } catch {
    return out;
  }
  out.exists = true;
  for (const n of names.filter((x) => x.endsWith('.json')).sort()) {
    const file = path.join(REGISTRY_REPO_DIR, n);
    try {
      const entry = JSON.parse(await fs.readFile(file, 'utf8'));
      if (entry && entry.schema === REGISTRY_SCHEMA) out.entries.push({ ...entry, file });
      else out.malformed.push({ file, why: 'schema 不匹配（不是本插件的登记条目）' });
    } catch (e) {
      out.malformed.push({ file, why: String(e).slice(0, 160) });
    }
  }
  out.entries.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return out;
}

async function readRegistryIndex() {
  try {
    return JSON.parse(await fs.readFile(REGISTRY_INDEX_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function readConsent() {
  try {
    const c = JSON.parse(await fs.readFile(REGISTRY_CONSENT_FILE, 'utf8'));
    return c && c.schema === REGISTRY_CONSENT_SCHEMA ? c : { granted: false, malformedFile: REGISTRY_CONSENT_FILE };
  } catch {
    return { granted: false };
  }
}

/** 授权可以有多条（多 root）；旧形态（单条 root/depth）也认。 */
function consentGrants(consent) {
  if (!consent || consent.granted !== true) return [];
  if (Array.isArray(consent.grants) && consent.grants.length) return consent.grants;
  if (consent.root) return [{ root: consent.root, depth: Number.isInteger(consent.depth) ? consent.depth : null, grantedAt: consent.grantedAt || null, via: consent.via || null }];
  return [];
}

/**
 * 授权是否覆盖本次请求：root 必须一致（或 '*'），depth 不得悄悄放大。
 * depth 只保留「扫描深度」一个含义（审计 L3）：缺 depth 字段的旧 grant 不覆盖任何请求
 * —— 宁可再问用户一次，也不把「字段缺失」当成「不限深度」。
 */
function consentCovers(consent, { root, depth }) {
  for (const g of consentGrants(consent)) {
    if (g.root !== '*' && g.root !== root) continue;
    if (!Number.isInteger(g.depth)) continue;
    if (depth <= g.depth) return true;
  }
  return false;
}

/** 记一条授权：同 root 覆盖，depth 取更大者。 */
function mergeConsent(consent, { root, depth, via }) {
  const grants = consentGrants(consent).filter((g) => g.root !== root);
  grants.push({ root, depth, grantedAt: new Date().toISOString(), via, tool: 'gh_repo_registry' });
  return {
    schema: REGISTRY_CONSENT_SCHEMA,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    granted: true,
    updatedAt: new Date().toISOString(),
    grants: grants.sort((a, b) => String(a.root).localeCompare(String(b.root))),
  };
}

function registryConsentQuestion({ root, depth, action }) {
  return {
    question: '是否同意建立 Git 仓库登记文件库？范围 ' + root + '（深度 ' + depth + '），'
      + '位置 ' + REGISTRY_REPO_DIR + '，一个仓库一个文件；只记录仓库路径与 git 元数据'
      + '（分支 / HEAD / 脏文件数 / 远端 URL（凭据脱敏）），不写仓库内部的任何文件，不写 token。',
    options: ['同意建立', '先看计划（action:plan）', '不同意（不登记）'],
    onAgree: 'gh_repo_registry {action:"' + (action === 'rescan' ? 'rescan' : 'build') + '", consent:true}',
    onDecline: '不落盘任何文件；登记库不存在时，之后每次调用都会再问一次',
  };
}

/** 未授权时的统一回执：不写任何东西，把该问的问题原样交给模型转述。 */
function consentRequiredPayload({ root, depth, action, consent }) {
  const view = registryConsentView(consent);
  return {
    ok: false,
    consentRequired: true,
    wrote: false,
    action,
    dir: REGISTRY_REPO_DIR,
    consentFile: REGISTRY_CONSENT_FILE,
    consent: view,
    ask: registryConsentQuestion({ root, depth, action }),
    instruction: '先按 ask.question 原样向用户提问并等待答复；用户同意后才带 consent:true 重调本工具。不要自行假定同意，也不要先落盘再问。',
  };
}

async function registryPlan({ root, depth }) {
  const exists = await fs.stat(root).then((s) => s.isDirectory()).catch(() => false);
  if (!exists) return { ok: false, error: 'root 不是目录：' + root, root };
  const found = await findRepos(root, depth);
  const reg = await readRegistry();
  const known = new Set(reg.entries.map((e) => e.path));
  const unregistered = [];
  for (const repo of found) if (!known.has(repo)) unregistered.push(repo);
  return {
    ok: true,
    root,
    depth,
    found: found.length,
    registered: reg.entries.length,
    unregistered,
    missingFromDisk: reg.entries.filter((e) => !found.includes(e.path)).map((e) => ({ slug: e.slug, path: e.path, why: '库里有、这次扫描没扫到（目录已删或超出 root/depth）' })),
    unchanged: reg.entries.filter((e) => found.includes(e.path)).length,
    malformed: reg.malformed,
  };
}

function registryIndexObject(entries, meta) {
  const sorted = entries.slice().sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return {
    schema: REGISTRY_INDEX_SCHEMA,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    action: meta.action,
    root: meta.root ?? null,
    depth: meta.depth ?? null,
    dir: REGISTRY_REPO_DIR,
    count: sorted.length,
    remoteBound: sorted.filter((e) => e.git?.hasRemote).length,
    withoutRemote: sorted.filter((e) => !e.git?.hasRemote).length,
    entries: sorted.map((e) => ({
      slug: e.slug,
      name: e.name,
      path: e.path,
      branch: e.git?.branch ?? null,
      head: e.git?.head ?? null,
      dirty: e.git?.dirty ?? null,
      hasRemote: Boolean(e.git?.hasRemote),
      remoteUrl: e.git?.origin?.url ?? null,
      host: e.git?.origin?.host ?? null,
      owner: e.git?.origin?.owner ?? null,
      upstream: e.git?.upstream ?? null,
      updatedAt: e.updatedAt,
    })),
  };
}

/** build / rescan 共用：写一仓一文件 + 重建 index.json；可顺带剪掉失效条目。 */
async function registryWrite({ root, depth, prevSource, action, prune = false, withFacts = true, note, tags, consentRecord }) {
  const found = await findRepos(root, depth);
  const reg = await readRegistry();
  const prevByPath = new Map(reg.entries.map((e) => [e.path, e]));
  const written = [];
  for (const repo of found) {
    const prev = prevByPath.get(repo) || null;
    const facts = withFacts ? await registryGitFacts(repo) : (prev?.git || { isRepo: true });
    const entry = registryEntryFrom(repo, facts, prev, { source: prevSource, notes: note, tags });
    await writeJsonAtomic(path.join(REGISTRY_REPO_DIR, entry.slug + '.json'), entry);
    written.push(entry);
    prevByPath.delete(repo);
  }
  const pruned = [];
  if (prune) {
    for (const stale of prevByPath.values()) {
      await fs.rm(path.join(REGISTRY_REPO_DIR, stale.slug + '.json'), { force: true });
      pruned.push({ slug: stale.slug, path: stale.path });
    }
  }
  const index = registryIndexObject(written, { action, root, depth });
  await writeJsonAtomic(REGISTRY_INDEX_FILE, index);
  if (consentRecord) await writeJsonAtomic(REGISTRY_CONSENT_FILE, consentRecord);
  return { written, index, pruned };
}

async function registryVerify({ root, depth }) {
  const reg = await readRegistry();
  const unregistered = [];
  const registeredMissing = [];
  const notRepo = [];
  const outOfScope = [];
  if (root) {
    const found = await findRepos(root, depth);
    const known = new Set(reg.entries.map((e) => e.path));
    for (const repo of found) if (!known.has(repo)) unregistered.push(repo);
    const onDisk = new Set(found);
    for (const e of reg.entries) {
      if (onDisk.has(e.path)) continue;
      const present = await fs.stat(e.path).then(() => true).catch(() => false);
      if (!present) registeredMissing.push({ slug: e.slug, path: e.path, why: '路径已不存在' });
      else if (await isRepo(e.path).catch(() => false)) outOfScope.push({ slug: e.slug, path: e.path, why: '路径仍是仓库，但不在本次 root/depth 范围内' });
      else notRepo.push({ slug: e.slug, path: e.path, why: '路径还在，但已不是 git 仓库' });
    }
  }
  return {
    ok: true,
    dir: REGISTRY_REPO_DIR,
    libraryExists: reg.exists,
    count: reg.entries.length,
    remoteBound: reg.entries.filter((e) => e.git?.hasRemote).length,
    withoutRemote: reg.entries.filter((e) => !e.git?.hasRemote).length,
    drift: { unregistered, registeredMissing, outOfScope, notRepo },
    inSync: unregistered.length === 0 && registeredMissing.length === 0 && notRepo.length === 0 && outOfScope.length === 0,
    malformed: reg.malformed,
  };
}

function registryLibraryPayload(reg, { prefix, onlyMissingRemote, hasRemote, host, tag } = {}) {
  let entries = reg.entries;
  if (prefix) entries = entries.filter((e) => String(e.path).startsWith(prefix));
  if (onlyMissingRemote) entries = entries.filter((e) => !e.git?.hasRemote);
  else if (hasRemote === true) entries = entries.filter((e) => e.git?.hasRemote);
  if (host) entries = entries.filter((e) => e.git?.origin?.host === host);
  if (tag) entries = entries.filter((e) => Array.isArray(e.tags) && e.tags.includes(tag));
  const byHost = {};
  for (const e of reg.entries) {
    const h = e.git?.origin?.host || '(no-remote)';
    byHost[h] = (byHost[h] || 0) + 1;
  }
  return {
    dir: REGISTRY_REPO_DIR,
    count: entries.length,
    libraryCount: reg.entries.length,
    remoteBound: entries.filter((e) => e.git?.hasRemote).length,
    withoutRemote: entries.filter((e) => !e.git?.hasRemote).length,
    byHost,
    entries: entries.map((e) => ({
      slug: e.slug,
      name: e.name,
      path: e.path,
      branch: e.git?.branch ?? null,
      head: e.git?.head ?? null,
      dirty: e.git?.dirty ?? null,
      ahead: e.git?.ahead ?? null,
      behind: e.git?.behind ?? null,
      hasRemote: Boolean(e.git?.hasRemote),
      remoteCount: e.git?.remoteCount ?? 0,
      remote: e.git?.origin
        ? { name: e.git.origin.name, url: e.git.origin.url, host: e.git.origin.host, owner: e.git.origin.owner, repo: remoteRepoName(e.git.origin) }
        : null,
      remotes: (e.git?.remotes || []).map((r) => ({ name: r.name, url: r.url, host: r.host, owner: r.owner, repo: remoteRepoName(r) })),
      upstream: e.git?.upstream ?? null,
      lastCommitAt: e.git?.lastCommitAt ?? null,
      notes: e.notes ?? '',
      tags: e.tags ?? [],
      registeredAt: e.registeredAt,
      updatedAt: e.updatedAt,
      file: e.file,
    })),
    malformed: reg.malformed,
  };
}

async function registryDefaultRoot() {
  const state = await readState();
  return state.reposRoot || DEFAULT_ROOT;
}

function registryConsentView(consent) {
  const grants = consentGrants(consent);
  const latest = grants.slice().sort((a, b) => String(b.grantedAt).localeCompare(String(a.grantedAt)))[0] || null;
  return {
    recorded: consent?.granted === true,
    grantCount: grants.length,
    grants,
    grantedAt: latest?.grantedAt || null,
    root: latest?.root || null,
    depth: latest?.depth ?? null,
  };
}

/** 读侧：文件库即事实来源，回「有哪些仓库 + 有没有绑远端」；库不存在就回该问的问题。 */
async function registryListPayload(opts = {}) {
  const reg = await readRegistry();
  const consent = await readConsent();
  if (!reg.exists) {
    const root = opts.root || (await registryDefaultRoot());
    const depth = Number.isInteger(opts.depth) ? opts.depth : 3;
    return {
      ok: false,
      libraryExists: false,
      consentRequired: consent.granted !== true,
      dir: REGISTRY_REPO_DIR,
      consent: registryConsentView(consent),
      ask: registryConsentQuestion({ root, depth, action: 'build' }),
      instruction: '登记文件库还不存在：先按 ask.question 向用户提问；用户同意后跑 gh_repo_registry {action:"build", consent:true} 建库，再用本工具读库。',
    };
  }
  return {
    ok: true,
    libraryExists: true,
    action: 'list',
    consent: registryConsentView(consent),
    ...registryLibraryPayload(reg, {
      prefix: opts.prefix,
      onlyMissingRemote: opts.onlyMissingRemote === true || opts.only_missing_remote === true,
      hasRemote: opts.hasRemote === true || opts.has_remote === true,
      host: opts.host,
      tag: opts.tag,
    }),
  };
}

/** 写侧 / 状态侧唯一入口；工具、Host Service、回环 HTTP 都走这里。 */
async function registryAction(opts = {}) {
  const action = String(opts.action || 'status');
  if (!REGISTRY_ACTIONS.includes(action)) {
    return { ok: false, error: 'action 未知：' + action, action, known: REGISTRY_ACTIONS };
  }
  const root = opts.root || (await registryDefaultRoot());
  const depth = Number.isInteger(opts.depth) ? opts.depth : 3;
  const consent = await readConsent();
  const reg = await readRegistry();
  const grantedNow = opts.consent === true;
  const granted = grantedNow || consentCovers(consent, { root, depth });

  if (action === 'status') {
    return {
      ok: true,
      action,
      root,
      depth,
      dir: REGISTRY_DIR,
      repoDir: REGISTRY_REPO_DIR,
      indexFile: REGISTRY_INDEX_FILE,
      consentFile: REGISTRY_CONSENT_FILE,
      libraryExists: reg.exists,
      count: reg.entries.length,
      remoteBound: reg.entries.filter((e) => e.git?.hasRemote).length,
      withoutRemote: reg.entries.filter((e) => !e.git?.hasRemote).length,
      malformed: reg.malformed,
      index: await readRegistryIndex(),
      consent: registryConsentView(consent),
      ...(consent.granted ? {} : { ask: registryConsentQuestion({ root, depth, action: 'build' }) }),
      nextStep: !consent.granted
        ? '还没授权：跑 action:"plan" 拿计划与 ask，再问用户是否同意建库'
        : (reg.exists ? '库已就绪：新仓库出现或远端变了就跑 action:"rescan"' : '已授权但库还没建：跑 action:"build"'),
    };
  }

  if (action === 'plan') {
    const plan = await registryPlan({ root, depth });
    if (!plan.ok) return plan;
    return {
      ok: true,
      action,
      ...plan,
      dryRun: true,
      wrote: false,
      consentRequired: !granted,
      consent: registryConsentView(consent),
      ...(granted ? {} : { ask: registryConsentQuestion({ root, depth, action: 'build' }) }),
    };
  }

  if (action === 'verify') {
    const v = await registryVerify({ root, depth });
    return { ok: true, action, ...v, consentRequired: !granted, consent: registryConsentView(consent) };
  }

  if (action === 'forget') {
    const key = String(opts.path || opts.slug || '').trim();
    if (!key) return { ok: false, error: 'forget 需要 path 或 slug' };
    const hit = reg.entries.find((e) => e.path === key || e.slug === key);
    if (!hit) return { ok: false, error: '库里没有这个条目', key, count: reg.entries.length };
    await fs.rm(path.join(REGISTRY_REPO_DIR, hit.slug + '.json'), { force: true });
    const rest = reg.entries.filter((e) => e.slug !== hit.slug);
    const index = registryIndexObject(rest, { action: 'forget', root, depth });
    await writeJsonAtomic(REGISTRY_INDEX_FILE, index);
    return {
      ok: true, action, removed: { slug: hit.slug, path: hit.path }, count: rest.length,
      note: '只删登记条目，不碰仓库本身',
    };
  }

  if (action === 'revoke') {
    const existed = await fs.stat(REGISTRY_CONSENT_FILE).then(() => true).catch(() => false);
    if (existed) await fs.rm(REGISTRY_CONSENT_FILE, { force: true });
    return {
      ok: true, action, revoked: existed, libraryKept: reg.exists,
      count: reg.entries.length, dir: REGISTRY_REPO_DIR,
      note: '只撤销授权：已建的文件库保留可读，之后的 build/rescan 会重新问一次；要清库用 action:"purge"',
    };
  }

  if (action === 'purge') {
    const consentFileExists = await fs.stat(REGISTRY_CONSENT_FILE).then(() => true).catch(() => false);
    if (opts.confirm !== true) {
      return {
        ok: false, action, confirmRequired: true, dryRun: true, dir: REGISTRY_DIR,
        wouldRemove: { entries: reg.entries.length, indexFile: reg.exists, consentFile: consentFileExists },
        hint: '真要清库再带 confirm:true 重调',
      };
    }
    await fs.rm(REGISTRY_DIR, { recursive: true, force: true });
    return { ok: true, action, removedDir: REGISTRY_DIR, removedEntries: reg.entries.length, removedConsent: consentFileExists };
  }

  // build / rescan：唯一的落盘路径，先过授权闸门。
  if (!granted) return consentRequiredPayload({ root, depth, action, consent });
  const prevPaths = new Set(reg.entries.map((e) => e.path));
  // 只有「本次调用真的拿到了同意」才重写 consent.json。
  // 沿用已记录的授权时一律不动它 —— 否则 rescan 会把 via 从 ui:registry-panel / tool:consent:true
  // 改写成 recorded-consent，审计链就断了（本轮实测到过）。
  const record = grantedNow ? mergeConsent(consent, { root, depth, via: opts.via || 'tool:consent:true' }) : null;
  const res = await registryWrite({
    root,
    depth,
    prevSource: action === 'rescan' ? 'rescan' : 'scan',
    action,
    prune: opts.prune === true,
    note: opts.note,
    tags: Array.isArray(opts.tags) ? opts.tags : undefined,
    consentRecord: record,
  });
  return {
    ok: true,
    action,
    dir: REGISTRY_REPO_DIR,
    indexFile: REGISTRY_INDEX_FILE,
    consentFile: REGISTRY_CONSENT_FILE,
    root,
    depth,
    registered: res.written.length,
    added: res.written.filter((e) => !prevPaths.has(e.path)).length,
    refreshed: res.written.filter((e) => prevPaths.has(e.path)).length,
    pruned: res.pruned,
    remoteBound: res.index.remoteBound,
    withoutRemote: res.index.withoutRemote,
    wroteFiles: res.written.length + 1,
    touchedWorkTrees: false,
    consent: registryConsentView(record || consent),
  };
}

/** gh_sync 工具体与 Host Service sync 的唯一实现（审计 R3：两边各写一遍会漂移）。 */
async function syncRepos({ root, depth, message, push, dryRun } = {}) {
  const state = await readState();
  const useRoot = root || state.reposRoot || DEFAULT_ROOT;
  const useDepth = Number.isInteger(depth) ? depth : 3;
  const usePush = push !== false;
  const useMessage = String(message || `chore: sync ${new Date().toISOString().slice(0, 10)}`);
  const repos = await findRepos(useRoot, useDepth);
  const planned = [];
  for (const repo of repos) {
    const st = await repoStatus(repo);
    if (st.dirty > 0) planned.push(st);
  }
  if (dryRun) return { root: useRoot, dryRun: true, message: useMessage, wouldCommit: planned.length, repos: planned };
  const results = [];
  for (const st of planned) results.push(await commitRepo(st.repo, useMessage, usePush));
  return {
    root: useRoot,
    message: useMessage,
    scanned: repos.length,
    committed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

// ---------- 工具定义 ----------

// ---------- 协议层：工具协议与插件协议的单一事实来源 ----------
// 任何消费方（其它插件、页面、外部脚本）都应该能只读这一处就知道：
// 调用什么、传什么、拿到什么、错在哪。
const PROTOCOL_ID = 'dsh-github-resident';
// 6 → 7（2026-10-14，票「协议新增 identity / environment 两段 + 收口断言」）：新增 `identity` / `environment` 两段。
// 增量规矩：**给已有段加字段算兼容（不动 version），新增段才 bump version** —— 消费方可以只按 `spec`
// 判断「这份协议里有没有这两段」，不必先探测一遍（老版本按 `/6` 判断的代码不会被静默改写语义）。
// 7 → 8（2026-10-14，票「重活租约：同一台机器上的全量门禁一次只许一份（协议 + 工具 + runner 自锁）」新增了
// `load` 段；票「协议号 bump：新增 `load` 段后 `dsh-github-resident/7 → /8`（票 30 已裁未做）」补上漏掉的这一步）：
// 新增 `load` 段。这一行原来是**漏掉的那一步** —— 段加了、号没涨；门禁里那条字面量期望当时也停在 `/7`，
// 而它管的是「两份副本彼此一致」，不是「号配不配得上段清单」，所以那次它照样绿（补后一种判据的事不在本票边界内，
// 另开了《协议「新增段忘了 bump」要有一条机器判据（本轮靠人肉才发现）》）。
// 后果不是「哪一处当场炸」，而是**号不再能当形状的键**：同一个 `/7` 在一段时间里对应过两种协议文档
//（有 `load` 段之前 / 之后），按 `spec` 判断「这份协议里有没有某段」的消费方、以及按号定位的文档与快照，
// 拿到的答案取决于它读的是哪一刻 —— 号只涨不跌，防的是这个。
const PROTOCOL_VERSION = 8;
const PROTOCOL_SPEC = PROTOCOL_ID + '/' + PROTOCOL_VERSION;
const SERVICE_KEY = 'githubResident';

const TOOL_PROTOCOL = [
  { name: 'gh_resident_status', kind: 'read', required: [], optional: ['root', 'depth'], returns: ['token', 'identity', 'gitGlobal', 'gitCredentials', 'repoCount', 'dirtyRepos', 'repos'] },
  { name: 'gh_resident_login', kind: 'write', required: ['token', 'user_login'], optional: ['user_name', 'user_email', 'repos_root'], returns: ['ok', 'identity', 'credentialHelper', 'gitUser', 'email', 'ask'] },
  { name: 'gh_repos', kind: 'read', required: [], optional: ['root', 'depth'], returns: ['root', 'count', 'repos'] },
  { name: 'gh_repo_registry', kind: 'write', required: [], optional: ['action', 'root', 'depth', 'consent', 'confirm', 'prune', 'path', 'slug', 'note', 'tags'], returns: ['ok', 'action', 'consentRequired', 'ask', 'dir', 'count', 'registered', 'added', 'refreshed', 'pruned', 'remoteBound', 'withoutRemote', 'drift', 'inSync', 'libraryExists'] },
  { name: 'gh_repo_registry_list', kind: 'read', required: [], optional: ['root', 'prefix', 'only_missing_remote', 'has_remote', 'host', 'tag'], returns: ['libraryExists', 'dir', 'count', 'libraryCount', 'remoteBound', 'withoutRemote', 'byHost', 'entries', 'malformed'] },
  { name: 'gh_commit', kind: 'write', required: ['repo', 'message'], optional: ['push'], returns: ['ok', 'sha', 'files', 'push', 'identityEnv'] },
  { name: 'gh_sync', kind: 'write', required: [], optional: ['root', 'depth', 'message', 'push', 'dry_run'], returns: ['root', 'scanned', 'committed', 'failed', 'results'] },
  // 2026-10-14：成功分支实际还回 authSource / message / errors（源码里确有），表里一直漏着 —— 顺手改真。
  // 同一类漂移（表说少了）以前没人管：门禁只钉 gh_protocol 自己的 returns，不钉每工具那行。
  // 2026-10-14（票「gh_pr 共用解析器 + 回落 gh pr create」）：加 `authPath`（这次走哪条路）与 `attempts`
  // （逐路记 `{ path, ok, reason }`：两条路都没成时，两边的**原始原因**都在，不吞成一句泛化错误）。
  // 这一行从此也有门禁钉着（tests/merge/host/pr-fallback.test.mjs）——两条路都能离线实跑，不必再手抄。
  { name: 'gh_pr', kind: 'write', required: ['repo', 'title'], optional: ['head', 'base', 'body', 'draft'], returns: ['ok', 'number', 'url', 'base', 'status', 'authSource', 'authPath', 'message', 'errors', 'attempts'] },
  { name: 'gh_cli_install', kind: 'write', required: [], optional: ['force', 'prefer'], returns: ['installed', 'layer', 'path', 'version', 'attempts'] },
  { name: 'gh_cli_auth_web', kind: 'write', required: [], optional: ['open_browser'], returns: ['ok', 'version', 'ghLayer', 'ghPath', 'user_code', 'verification_uri', 'opened', 'note', 'logTail'] },
  { name: 'gh_cli_status', kind: 'read', required: [], optional: [], returns: ['version', 'authenticated', 'activeAccount', 'gitCredentialHelper', 'hosts'] },
  { name: 'gh_cli_setup_git', kind: 'write', required: [], optional: ['set_identity'], returns: ['exitCode', 'credentialHelper', 'gitUserName', 'gitUserEmail', 'identityEnv'] },
  { name: 'gh_cli_logout', kind: 'write', required: [], optional: ['hostname', 'confirm', 'revoke', 'purge_git', 'reset_state', 'uninstall_gh', 'remove_gh_cache', 'remove_gh_config', 'dry_run'], returns: ['ok', 'dryRun', 'hostname', 'tokenMasked', 'steps', 'verify', 'leftover'] },
  { name: 'gh_cli_resolve', kind: 'read', required: [], optional: [], returns: ['resolved', 'system', 'pluginCache', 'dataDir', 'arch', 'autoLandOnNextUse', 'lastInstall'] },
  // 2026-10-14（票「gh_identity {wire|verify|unwire}：投影接线 + 对账 + 可撤」）：它从只读工具变成
  // 「默认只读 + 三个能写的动作」，所以 kind 从 read 变 write（并从 guarantees.readOnlyTools 里退出 —— 诚实）。
  // 必填仍为空：不带 action 时就是体检，行为与从前逐字节一致。returns 是五个动作视图的并集（一处声明派生）。
  { name: 'gh_identity', kind: 'write', required: [], optional: ['action', 'consent', 'targets', 'email'], returns: GH_IDENTITY_RETURNS },
  // 重活租约（协议 `load` 段）：同一台机器上的全量门禁 / 矩阵一次只许一份 ——
  // 多会话并跑看不见彼此，这个工具是那只能看见全局的眼睛；runner 自己也取同一份锁。
  { name: 'gh_load_lease', kind: 'write', required: [], optional: ['action', 'holder', 'purpose', 'ttl_ms'], returns: LOAD_LEASE_RETURNS },
  { name: 'gh_env_probe', kind: 'read', required: [], optional: ['network_targets', 'attempts', 'timeout_ms'], returns: ['capabilities', 'network', 'proxy', 'dirs', 'summary', 'bounds', 'notes'] },
  { name: 'gh_cli_version', kind: 'write', required: [], optional: ['update', 'force'], returns: ['current', 'latest', 'layer', 'updateAvailable', 'checkedAt', 'updated', 'reason', 'lastUpdate'] },
  { name: 'gh_cache_gc', kind: 'write', required: [], optional: ['dry_run', 'keep_versions'], returns: ['dir', 'removed', 'removedCount', 'freedBytes', 'kept', 'keptVersions'] },
  { name: 'gh_protocol', kind: 'read', required: [], optional: [], returns: ['id', 'version', 'spec', 'service', 'http', 'envelope', 'tools', 'errors', 'registry', 'identity', 'environment', 'load', 'guarantees'] },
];

/**
 * 协议里 `identity` / `environment` 两段的**字段清单不手抄**：从上面那张表的对应行**派生**（同一处声明）。
 * 这条链路由门禁钉死：`段.fields == 表行.returns == 该工具的真实回执键`，最后那一环是在合成环境里
 * **离线跑工具**取到的 —— 真源是行为，不是文本。子字段（尤其探针的条件键）不进协议，由工具回执自己回答。
 */
const declaredReturns = (toolName) => {
  const row = TOOL_PROTOCOL.find((t) => t.name === toolName);
  return row ? row.returns.slice() : [];
};

/**
 * 错误码表。语义说清楚（2026-10-13 对齐）：这里是**本插件会出现在回执文案里的码**，
 * 不等于「所有码都由代码 throw」—— 多数工具失败时回的是裸中文串 + `ok:false`（那时没有码前缀），
 * 只有回环路由与少数工具路径会带码。所以判据是「真实出现过的码都要在表里」，
 * 而不是「表里的码都要被抛」。来源闸门族那三条此前真实出现却没登记，协议因此与代码对不上。
 */
const ERROR_CODES = {
  E_NO_GH: '宿主里没有可用的 gh（先跑 gh_cli_install）',
  E_NO_TOKEN: '尚未保存 token（先 gh_resident_login 或 gh_cli_auth_web）',
  E_NOT_A_REPO: '目标路径不是 git 仓库',
  E_NO_UPSTREAM: '仓库没有配置 upstream，push 无处可去',
  E_API: 'GitHub REST API 返回非 2xx',
  E_ARGS: '必填参数缺失或类型不符',
  E_REGISTRY_CONSENT: '登记文件库尚未获得授权：先按回执里的 ask 问用户，同意后带 consent:true 重调',
  E_REGISTRY_LIB: '登记文件库不存在：先 gh_repo_registry {action:"build", consent:true} 建库',
  E_INTERFACE_DOWN: '插件回环接口不可达（插件未启用或未刷新页面）',
  // —— 来源闸门族：这三条真实出现在回环路由的拒绝文案里（此前没登记）——
  E_ORIGIN: '这条路由只接受带本机页面来源头（Origin/Referer）的请求',
  E_REGISTRY_ORIGIN: '写登记库的路由只接受来自设置页的请求（缺 Origin/Referer）',
  E_REGISTRY_CONSENT_ORIGIN: 'consent=1 只接受来自设置页的请求（缺 Origin/Referer）；机器调用请走 gh_repo_registry 工具，它会先回 ask',
  E_IDENTITY_EMAIL_ORIGIN: '写提交邮箱的路由只接受来自设置页的请求（缺 Origin/Referer）；机器调用请走 gh_identity {action:"email"}',
};

/** 注册表就绪的工具定义；execute 的返回值统一套上协议信封。 */
function textTool({ toolName, description, parameters, execute, readOnly }) {
  // 注册表要的是「注册表就绪」形态：parameters 必须是带 type:'object' 的 JSON Schema，
  // 字段上的 required:true 标记要提升到对象级 required 数组（这里是手写，不经 defineTool）。
  const properties = {};
  const required = [];
  for (const [key, spec] of Object.entries(parameters || {})) {
    const { required: isRequired, ...rest } = spec;
    properties[key] = rest;
    if (isRequired) required.push(key);
  }
  return {
    name: toolName,
    description,
    parameters: {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    // 工具协议：所有工具的返回值都带 { protocol, ok } 信封，失败不改字段、只加标记。
    execute: async (args, exec) => {
      const out = await execute(args, exec);
      const plain = out && typeof out === 'object' && !Array.isArray(out);
      return plain
        ? { ...out, protocol: PROTOCOL_SPEC, ok: out.ok !== false }
        : { protocol: PROTOCOL_SPEC, ok: true, data: out };
    },
    isConcurrencySafe: () => Boolean(readOnly),
  };
}

export function apply(ctx) {
  ctx.tools.register(textTool({
    toolName: 'gh_resident_status',
    description: 'Report the resident GitHub identity in this environment: token source and masked token, git global identity and credential helper, ~/.git-credentials presence, api.github.com reachability, and the git repositories discovered under the configured root.',
    parameters: {
      root: { type: 'string', description: 'Directory to scan for git repositories. Defaults to the configured reposRoot, then ~/GitHub.' },
      depth: { type: 'integer', description: 'Max directory depth to descend while scanning. Defaults to 3.' },
    },
    readOnly: true,
    execute: async (args) => {
      const state = await readState();
      const resolvedToken = await resolveIdentity(state);
      const token = resolvedToken.token;
      const root = args.root || state.reposRoot || DEFAULT_ROOT;
      const depth = Number.isInteger(args.depth) ? args.depth : 3;

      const cfgName = (await git(process.cwd(), ['config', '--global', 'user.name'])).stdout.trim();
      const cfgEmail = (await git(process.cwd(), ['config', '--global', 'user.email'])).stdout.trim();
      const helper = (await git(process.cwd(), ['config', '--global', 'credential.helper'])).stdout.trim();

      let credFile = { path: CRED_FILE, exists: false, hasGithubHost: false };
      try {
        const raw = await fs.readFile(CRED_FILE, 'utf8');
        credFile = { path: CRED_FILE, exists: true, hasGithubHost: raw.includes('github.com'), lines: raw.trim().split('\n').filter(Boolean).length };
      } catch { /* 不存在即保持 false */ }

      const repos = await findRepos(root, depth);
      const statuses = [];
      for (const repo of repos) statuses.push(await repoStatus(repo));

      let identity = null;
      if (token) {
        const me = await api(token, 'GET', '/user');
        // 超时不是「HTTP null」：如实标成 timeout，把那条「上界内没有回话」的原话带上（票「…有界冗余策略」收窄版）。
        identity = me.ok
          ? { login: me.json.login, name: me.json.name ?? null, scopes: null }
          : me.timedOut
            ? { error: 'timeout', message: me.json.message ?? null }
            : { error: `HTTP ${me.status}`, message: me.json.message ?? null };
      }

      return {
        token: maskIdentity(resolvedToken),
        stateFile: { path: STATE_FILE, exists: Object.keys(state).length > 0, keys: Object.keys(state) },
        gitGlobal: { user_name: cfgName || null, user_email: cfgEmail || null, credential_helper: helper || null },
        gitCredentials: credFile,
        identity,
        reposRoot: root,
        repoCount: statuses.length,
        dirtyRepos: statuses.filter((s) => s.dirty > 0).length,
        repos: statuses,
      };
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_resident_login',
    description: 'Persist a GitHub personal access token for this environment: writes the state file and ~/.git-credentials with 0600 permissions, sets credential.helper=store so any repository can push without prompting, and optionally sets the global git user name and email. The token is never echoed back.',
    parameters: {
      token: { type: 'string', required: true, description: 'GitHub personal access token (repo scope). Never log it.' },
      user_login: { type: 'string', required: true, description: 'GitHub account login, used in the credential URL.' },
      user_name: { type: 'string', description: 'Global git user.name to set.' },
      user_email: { type: 'string', description: 'Global git user.email to set.' },
      repos_root: { type: 'string', description: 'Default directory scanned by gh_resident_status and gh_sync.' },
    },
    readOnly: false,
    execute: async (args) => {
      const token = String(args.token || '').trim();
      const login = String(args.user_login || '').trim();
      if (!token || !login) return { ok: false, error: 'token 与 user_login 均为必填' };
      const before = await readState();
      // 提交邮箱**只问一次**（票「登录后可选填提交邮箱（不填用隐私邮箱），wire 优先用它」）：
      //   ① state 里已经有邮箱（不论谁写的、怎么来的）→ 不再问；
      //   ② 已经问过（emailAskedAt）→ 不再问，否则每次登录都会再弹一次。
      // 「问过」这笔在**发问的同一刻**记进去（跟 token 同一次写），不额外多写一次 state。
      const hasOwnEmail = typeof before.user_email === 'string' && before.user_email.trim().length > 0;
      const askEmail = !hasOwnEmail && !(typeof before.emailAskedAt === 'string' && before.emailAskedAt);
      const state = await writeState({
        token,
        login,
        ...(args.repos_root ? { reposRoot: args.repos_root } : {}),
        ...(askEmail ? { emailAskedAt: new Date().toISOString() } : {}),
        updatedAt: new Date().toISOString(),
      });
      // 只替换 github.com 那一行：整文件覆写会把用户其它 host 的凭据一起冲掉（审计 L6）。
      await writeCredentialLine(CRED_FILE, 'github.com', `${login}:${token}`);
      const helperBefore = (await git(process.cwd(), ['config', '--global', 'credential.helper'])).stdout.trim();
      const setHelper = helperBefore && helperBefore !== 'store'
        ? { code: 0, stdout: helperBefore, stderr: '' }   // 已有非 store 的 helper（如 gh）时不覆盖
        : await git(process.cwd(), ['config', '--global', 'credential.helper', 'store']);
      const setUser = { name: null, email: null };
      if (args.user_name) {
        await git(process.cwd(), ['config', '--global', 'user.name', String(args.user_name)]);
        setUser.name = String(args.user_name);
      }
      if (args.user_email) {
        await git(process.cwd(), ['config', '--global', 'user.email', String(args.user_email)]);
        setUser.email = String(args.user_email);
      }
      const me = await api(token, 'GET', '/user');
      return {
        ok: me.ok,
        stateFile: STATE_FILE,
        credentialHelper: (helperBefore && helperBefore !== 'store')
          ? helperBefore + '（保留原有 helper，未改写）'
          : (setHelper.code === 0 ? 'store' : 'set failed'),
        gitUser: setUser,
        reposRoot: state.reposRoot || DEFAULT_ROOT,
        token: mask(token),
        // 提交邮箱：如实报「现在接线会用哪个」；`ask` 只在**还没填过、也没问过**时出现，跳过即什么都不写。
        email: commitEmail(state, login),
        ask: askEmail ? emailQuestion(login) : null,
        identity: me.ok
          ? { login: me.json.login, name: me.json.name ?? null }
          : me.timedOut
            ? { error: 'timeout', message: me.json.message ?? null }
            : { error: `HTTP ${me.status}`, message: me.json.message ?? null },
      };
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_repos',
    description: 'Enumerate git repositories under a root directory with their branch, origin remote, dirty file count and ahead/behind against upstream. Read-only.',
    parameters: {
      root: { type: 'string', description: 'Directory to scan. Defaults to the configured reposRoot, then ~/GitHub.' },
      depth: { type: 'integer', description: 'Max depth. Defaults to 3.' },
    },
    readOnly: true,
    execute: async (args) => {
      const state = await readState();
      const root = args.root || state.reposRoot || DEFAULT_ROOT;
      const depth = Number.isInteger(args.depth) ? args.depth : 3;
      const repos = await findRepos(root, depth);
      const statuses = [];
      for (const repo of repos) statuses.push(await repoStatus(repo));
      const reg = await readRegistry();
      const registered = new Set(reg.entries.map((e) => e.path));
      const unregistered = statuses.filter((s) => !registered.has(s.repo)).length;
      return {
        root,
        depth,
        count: statuses.length,
        repos: statuses,
        registry: {
          dir: REGISTRY_REPO_DIR,
          libraryExists: reg.exists,
          registered: reg.entries.length,
          unregistered,
          remoteBound: statuses.filter((s) => s.remote).length,
          withoutRemote: statuses.filter((s) => !s.remote).length,
          hint: !reg.exists
            ? '仓库登记文件库还没建立：把 gh_repo_registry {action:"plan"} 的计划与 ask.question 交给用户，同意后带 consent:true 建库'
            : (unregistered > 0 ? '有 ' + unregistered + ' 个仓库尚未登记：跑 gh_repo_registry {action:"rescan"}' : '登记库与环境一致'),
        },
      };
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_repo_registry',
    description: 'Build and maintain the Git repository registry file library (one JSON file per repository under ~/.dsh/github-resident/registry/repos, plus index.json): each file records the repo path and its git metadata — branch, HEAD, dirty/untracked counts, ahead/behind, upstream, and remotes with credential-stripped URLs — and nothing is ever written inside a repository. Writing requires the user\'s consent: unless consent:true is passed in this call or a consent file is already recorded for the same root/depth, build and rescan write NOTHING and return {consentRequired:true, ask:{question, options, onAgree}} — relay that question to the user verbatim and wait for the answer. status/plan/verify/forget/revoke never need consent; purge needs confirm:true.',
    parameters: {
      action: { type: 'string', enum: REGISTRY_ACTIONS, description: 'status (read) | plan (read dry-run diff) | build (write, needs consent) | rescan (refresh git facts, needs consent) | verify (read drift vs disk) | forget (drop one entry; give path or slug) | revoke (drop the recorded consent, keep the library) | purge (delete the whole library, needs confirm:true). Defaults to status.' },
      root: { type: 'string', description: 'Directory the registry covers. Defaults to the configured reposRoot, then ~/GitHub.' },
      depth: { type: 'integer', description: 'Max scan depth. Defaults to 3. Widening root/depth beyond a recorded consent asks again.' },
      consent: { type: 'boolean', description: 'Set true only after the user explicitly agreed in this conversation. Records the consent file; required the first time and whenever root/depth is widened.' },
      confirm: { type: 'boolean', description: 'purge only: required to actually delete the library. Without it purge only reports what it would remove.' },
      prune: { type: 'boolean', description: 'build/rescan: also drop registry entries whose path is gone or out of scope. Defaults to false.' },
      path: { type: 'string', description: 'forget: absolute path of the entry to drop.' },
      slug: { type: 'string', description: 'forget: entry slug (basename plus sha1 prefix) instead of path.' },
      note: { type: 'string', description: 'Free-text note stored on every entry written by this call.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags stored on every entry written by this call.' },
    },
    readOnly: false,
    execute: async (args) => registryAction(args || {}),
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_repo_registry_list',
    description: 'Read the Git repository registry file library — the plugin protocol\'s on-disk contract, one JSON file per repository — and answer "which Git repositories exist in this environment, and which of them have a remote bound". Pure file-library read: it never scans the filesystem and never writes. If the library does not exist yet, it returns {libraryExists:false, ask:{question, options, onAgree}} for you to relay to the user instead of guessing.',
    parameters: {
      root: { type: 'string', description: 'Only used to phrase the consent question when the library is missing.' },
      prefix: { type: 'string', description: 'Only entries whose absolute path starts with this prefix.' },
      only_missing_remote: { type: 'boolean', description: 'Only repositories with no remote at all.' },
      has_remote: { type: 'boolean', description: 'Only repositories that do have a remote.' },
      host: { type: 'string', description: 'Only repositories whose primary remote host equals this, e.g. github.com.' },
      tag: { type: 'string', description: 'Only entries carrying this tag.' },
    },
    readOnly: true,
    execute: async (args) => registryListPayload(args || {}),
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_commit',
    description: 'Stage and commit all changes in one repository, optionally pushing to its upstream. Returns the short commit SHA, staged file count, and push outcome.',
    parameters: {
      repo: { type: 'string', required: true, description: 'Absolute path of the repository.' },
      message: { type: 'string', required: true, description: 'Commit message.' },
      push: { type: 'boolean', description: 'Push to upstream after committing. Defaults to true.' },
    },
    readOnly: false,
    execute: async (args) => {
      const repo = path.resolve(String(args.repo || ''));
      if (!(await isRepo(repo))) return { ok: false, error: `不是 git 仓库: ${repo}` };
      return commitRepo(repo, String(args.message || 'chore: update'), args.push !== false);
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_sync',
    description: 'Commit and push every dirty repository under a root in one pass — the multi-project change-submission entry point. Repositories with no changes are skipped; per-repo results are returned as a report.',
    parameters: {
      root: { type: 'string', description: 'Directory to scan. Defaults to the configured reposRoot, then ~/GitHub.' },
      depth: { type: 'integer', description: 'Max depth. Defaults to 3.' },
      message: { type: 'string', description: 'Commit message applied to every dirty repository. Defaults to a timestamped sync message.' },
      push: { type: 'boolean', description: 'Push after committing. Defaults to true.' },
      dry_run: { type: 'boolean', description: 'Only report what would be committed. Defaults to false.' },
    },
    readOnly: false,
    execute: async (args) => syncRepos({
      root: args.root,
      depth: args.depth,
      message: args.message,
      push: args.push,
      dryRun: args.dry_run === true,
    }),
  }));

  /**
   * 回落的第二条路：把活交给 gh 自己（票「gh_pr 共用解析器 + 回落 gh pr create」）。
   *
   * 边界（ADR 0001）：**不读** gh 的 hosts.yml、不猜它是谁 —— 只借它的落点（绝对路径）与执行，
   * 身份仍归 gh 自己。所以回执里 `authSource` 如实是 `(none)`，路由事实由 `authPath` 承担。
   * 有界：到上界即结算并如实报「超时」（用 runBounded，不等子进程退出）；只**尽力而为**，不重试。
   */
  async function createPrViaGhCli({ repo, title, head, base, body, draft }) {
    // 读路径（install:false）：不因为「要开个 PR」就顺手下载几十 MB 的 gh，更不在写动作里出网。
    const gh = await resolveGh({ install: false });
    if (!gh.ok || !gh.path) {
      // 票 29：「探测超时（未知）」与「这台机器没有 gh」要给不同的下一步 —— 前者不该劝人去重新落地。
      return {
        ok: false,
        layer: gh.layer || 'none',
        timedOut: Boolean(gh.timedOut),
        reason: gh.timedOut
          ? 'gh 探测超时（' + String(gh.note || '上界内没有回话') + '）—— 此刻**无法确认**这台机器上的 gh 能不能跑，这条回落没法开始；'
            + '稍后重试，或显式跑 gh_cli_install 落地一份'
          : '这台机器上没有能跑的 gh（' + String(gh.note || '系统层与插件缓存都没有') + '）'
            + '；要走这条回落得先跑 gh_cli_install 落地一份',
      };
    }

    const argv = ['pr', 'create', '--repo', repo, '--title', title];
    if (head) argv.push('--head', head);
    if (base) argv.push('--base', base);
    // `--body` **一律显式给**（哪怕空串）：不给的话 gh 在非交互环境下直接失败
    // （实测 gh 2.102：`must provide --title and --body (or --fill …) when not running interactively`），
    // 于是这条回落每次都会撞在同一句话上。给空串既跳过它的提问，也不会去开编辑器。
    argv.push('--body', body);
    if (draft) argv.push('--draft');

    const boundMs = prFallbackTimeoutMs();
    // **不戴工牌**（票「子进程环境…」的边界）：这条路只在三处都取不到 token 时才走到，
    // 那一刻没有可注入的值；身份仍归 gh 自己（ADR 0001 边界，回执里 authSource 如实是 (none)）。
    const r = await runBounded(gh.path, argv, { timeoutMs: boundMs });
    if (r.timedOut) {
      return {
        ok: false, timedOut: true, layer: gh.layer, boundMs,
        reason: 'gh pr create 在 ' + boundMs + 'ms 上界内没有返回（超时）—— '
          + 'PR 可能已经开了、也可能没有，**结果未知**，别盲目重试（可以先 gh pr list 看一眼）',
      };
    }
    const output = (r.stdout || '') + '\n' + (r.stderr || '');
    if (r.code !== 0) {
      return {
        ok: false, layer: gh.layer,
        reason: 'gh pr create 退出码 ' + r.code + '：' + (firstLine(output) || '(没有输出)'),
      };
    }
    const url = (output.match(/https?:\/\/\S*\/pull\/\d+/) || [])[0] || null;
    // 退出码 0 但没有 PR 链接 = 假结论（桩、被包装的 gh、被 alias 的 gh 都可能这样）——不许当成功。
    if (!url) {
      return {
        ok: false, layer: gh.layer,
        reason: 'gh pr create 退出码 0，但输出里没有 PR 链接（不敢当成功）：' + (firstLine(output) || '(没有输出)'),
      };
    }
    return { ok: true, layer: gh.layer, url, number: Number((url.match(/\/pull\/(\d+)/) || [])[1]) || null };
  }

  ctx.tools.register(textTool({
    toolName: 'gh_pr',
    description: 'Open a pull request. Uses the resident token through the GitHub REST API when one resolves; '
      + 'when no token is available anywhere (env / plugin state / gh CLI hosts.yml) it falls back to `gh pr create` '
      + 'with the resolved gh binary, bounded by a timeout. The receipt reports which path was taken via `authPath`.',
    parameters: {
      repo: { type: 'string', required: true, description: 'Repository as owner/name.' },
      title: { type: 'string', required: true, description: 'Pull request title.' },
      head: { type: 'string', description: 'Head branch (source).' },
      base: { type: 'string', description: 'Base branch (target). Defaults to the repository default branch.' },
      body: { type: 'string', description: 'Pull request body.' },
      draft: { type: 'boolean', description: 'Open as draft.' },
    },
    readOnly: false,
    execute: async (args) => {
      const state = await readState();
      const resolvedToken = await resolveIdentity(state);
      const token = resolvedToken.token;
      const repo = String(args.repo || '');
      const title = String(args.title || '');
      const attempts = [];

      if (token) {
        // 有 token：行为与从前完全一致（REST 优先，且**不**多跑一个 gh 子进程）。
        // 回落只在「三处都解析不到 token」时发生：REST 自己失败（401/403/网络）**不改道** ——
        // 否则会拿另一个身份去执行，把权限问题与网络问题掩盖成路由问题。
        let base = args.base;
        if (!base) {
          const info = await api(token, 'GET', `/repos/${repo}`);
          base = info.ok ? info.json.default_branch : undefined;
        }
        const created = await api(token, 'POST', `/repos/${repo}/pulls`, {
          title: String(args.title || ''),
          head: String(args.head || ''),
          base,
          body: String(args.body || ''),
          draft: Boolean(args.draft),
        });
        attempts.push({
          path: 'token-rest',
          ok: created.ok,
          reason: created.ok
            ? null
            : created.timedOut
              ? '超时：' + ((created.json && created.json.message) || created.error || '请求没有回话')
              : 'HTTP ' + created.status + (created.json && created.json.message ? '：' + created.json.message : ''),
        });
        return {
          ok: created.ok,
          authPath: 'token-rest',            // 这次走的是哪条路（一眼可见，不用猜）
          status: created.status,
          base,
          number: created.json.number ?? null,
          url: created.json.html_url ?? null,
          authSource: resolvedToken.source,   // 这次用的是哪条身份路径（回执里如实标出来）
          message: created.ok ? null : (created.json.message ?? null),
          errors: created.json.errors ?? null,
          attempts,
        };
      }

      // 三处都没有 token → 尽力而为的第二条路。**不是**隐式重试：上面那条路失败时已经 return 了。
      const restReason = '三处都没有可用身份（env GH_TOKEN/GITHUB_TOKEN、插件 state、gh CLI 的 hosts.yml）';
      attempts.push({ path: 'token-rest', ok: false, reason: restReason });
      const fallback = await createPrViaGhCli({
        repo, title,
        head: String(args.head || ''),
        base: args.base,
        body: String(args.body || ''),
        draft: Boolean(args.draft),
      });
      attempts.push({ path: 'gh-cli-fallback', ok: fallback.ok, reason: fallback.ok ? null : fallback.reason });

      if (fallback.ok) {
        return {
          ok: true,
          authPath: 'gh-cli-fallback',
          status: null,                     // HTTP 状态码是 REST 那条路的事，这里如实留空
          base: args.base ?? null,          // 没给 base 就交给 gh 自己判定（不为它再发一次 REST 请求）
          number: fallback.number,
          url: fallback.url,
          authSource: '(none)',             // 回落不解析 gh 自己的凭据（ADR 0001 边界）；路由事实看 authPath
          message: null,
          errors: null,
          attempts,
        };
      }
      return {
        ok: false,
        authPath: 'gh-cli-fallback',
        status: null,
        base: null,
        number: null,
        url: null,
        authSource: '(none)',
        message: null,
        errors: null,
        attempts,
        error: '两条路都没有成功 —— REST：' + restReason
          + '；gh CLI 回落：' + fallback.reason
          + '。可以 gh_resident_login 落一份 state，或 gh_cli_install / gh auth login 让 gh CLI 自己能跑。',
      };
    },
  }));

  // ---------- gh CLI 常驻化（自带安装 / 网页认证 / 账号管理） ----------
  // 契约：装完插件就有一个可用的 gh，不需要宿主机预装、也不需要二次手动安装。
  //   L1 系统 gh（有就用，不抢用户的）→ L2 插件自带缓存（~/.dsh/gh-cli/bin/gh）
  //   → L3 自动落地：优先官方 tar.gz 抽单文件（不需要 root、不动系统），失败退回 .deb。
  // 全程只用 node 内建模块 + curl，不引第三方依赖。

  const GH_DEVICE_URL = 'https://github.com/login/device';
  // HOSTS_FILE 已在模块顶部定义（全插件一份）；这里不再重复定义，免得两份写法各自漂移。
  const GH_DATA_DIR = process.env.DSH_GH_DATA_DIR || path.join(STATE_DIR, 'gh-cli');
  const GH_BIN = path.join(GH_DATA_DIR, 'bin', 'gh');
  const GH_STATE = path.join(GH_DATA_DIR, 'install.json');
  const DEFAULT_REPO = 'cli/cli';
  const RELEASE_API = process.env.DSH_GH_RELEASE_API
    || 'https://api.github.com/repos/' + DEFAULT_REPO + '/releases/latest';
  const RELEASE_DL = process.env.DSH_GH_DOWNLOAD_BASE
    || 'https://github.com/' + DEFAULT_REPO + '/releases/download';

  // gh 官方资产名用的是 apt 风格架构串，不是 node 的 arch。
  const GH_ARCH = ({ x64: 'amd64', arm64: 'arm64', arm: 'armv6', ia32: '386' })[process.arch] || process.arch;

  async function ghPathExists(p) {
    try { await fs.stat(p); return true; } catch { return false; }
  }

  function versionLine(out) {
    return (out || '').split('\n')[0].trim() || null;
  }

  /** 从 PATH 解析命令的真实绝对路径（N5：原来把 PATH 里的 gh 报成 /usr/bin/gh）。 */
  async function whichCmd(name, timeoutMs = 0) {
    const r = await run('sh', ['-c', 'command -v ' + name], timeoutMs > 0 ? { timeout: timeoutMs, killSignal: 'SIGKILL' } : {});
    const p = (r.stdout || '').trim().split('\n')[0].trim();
    return p.startsWith('/') ? p : null;
  }

  /** 真跑一次 --version：存在但跑不起来（架构不符/动态库缺）不算可用。 */
  let probeCache = new Map(); // bin -> { mtimeMs, size, ok, version }

  /**
   * 真跑一次 --version。带 mtime+size 缓存：文件没换就不重复 fork；
   * 文件被换掉（自更新）时 mtime 变了，缓存自然失效。
   */
  async function probeGh(bin, { fresh = false, timeoutMs = ghProbeTimeoutMs() } = {}) {
    if (!bin) return { ok: false, bin: null, version: null, timedOut: false };
    let st = null;
    try { st = await fs.stat(bin); } catch { /* PATH 里的名字 stat 不到，按无缓存处理 */ }
    const key = bin;
    const hit = probeCache.get(key);
    if (!fresh && hit && st && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      return { ok: hit.ok, bin, version: hit.version, timedOut: false };
    }
    // 上界**默认就有**（票 29）：到点 SIGKILL，并把这次结论单独标出来 ——
    // 「探测超时（未知）」与「探测过、确实没有」是两种事实；混成一个 ok:false，调用方就会按下错的按钮
    //（最贵的一个按钮是「去下载一份 gh」）。timeoutMs <= 0 时不设上界（只给显式要它的调用方）。
    // **不戴工牌**（票「子进程环境…」）：探活只回答「这个程序跑不跑得起来」，不是「我是谁」——
    // 戴上会把「宿主 gh 自己什么状态」糊住（实测 GH_TOKEN 会盖过 hosts.yml 的登录态）。
    const r = await run(bin, ['--version'], timeoutMs > 0 ? { timeout: timeoutMs, killSignal: 'SIGKILL' } : {});
    const timedOut = r.signal === 'SIGKILL';
    const version = !timedOut && r.code === 0 ? versionLine(r.stdout) : null;
    // 超时**不写探测缓存**：一次卡死不能被记成长期结论（否则同一个路径以后连跑都不跑，直接读回「没有」）。
    if (st && !timedOut) probeCache.set(key, { mtimeMs: st.mtimeMs, size: st.size, ok: Boolean(version), version });
    return { ok: Boolean(version), bin, version, timedOut };
  }

  /**
   * 只认 ustar/POSIX 头（GNU 长名用不到，gh 的包也不会有）。
   * 注意 checksum 字段必须跳过，否则 hdr 里同时含 \0 与空格会解析错位。
   */
  function readUstarPath(buf, off) {
    if (buf.length < off + 512) return null;
    const hdr = buf.subarray(off, off + 512);
    const name = hdr.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) return null;
    const sizeStr = hdr.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const type = String.fromCharCode(hdr[156]);
    const prefix = hdr.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    // mode 只取低 12 位：真实包里 uid/gid 位常被置成 0o1000 及以上（setuid 风格）。
    const mode = parseInt(hdr.subarray(100, 108).toString('ascii').replace(/\0.*$/, '').trim(), 8) || 0;
    return { name: prefix ? prefix + '/' + name : name, size, type, mode: mode & 0o777 };
  }

  /**
   * 写二进制：目录可能被外部（测试清理、tmp 回收）中途删掉，所以 mkdir 一次写一次，
   * 失败再 mkdir + 写一次；两次都失败才抛。
   */
  function writeFileEnsured(dest, data, mode) {
    const dir = path.dirname(dest);
    try {
      fsSync.mkdirSync(dir, { recursive: true });
      fsSync.writeFileSync(dest, data, { mode });
      fsSync.chmodSync(dest, mode);
      return true;
    } catch {
      fsSync.mkdirSync(dir, { recursive: true });
      fsSync.writeFileSync(dest, data, { mode });
      fsSync.chmodSync(dest, mode);
      return true;
    }
  }

  /** 从 tar.gz 里抽出 bin/gh 写盘 —— 不做全量解包，不依赖系统 tar。权限按包里的 mode，缺省 0755。 */
  function extractGhFromTarGz(buf, dest) {
    const gz = zlib.gunzipSync(buf);
    let off = 0;
    while (off + 512 <= gz.length) {
      const entry = readUstarPath(gz, off);
      if (!entry) break;
      const dataStart = off + 512;
      if (entry.type === '0' || entry.type === '\0') {
        if (/(^|\/)bin\/gh$/.test(entry.name) && entry.size > 0) {
          const data = gz.subarray(dataStart, dataStart + entry.size);
          const mode = entry.mode ? (entry.mode & 0o777) : 0o755;
          writeFileEnsured(dest, data, mode);
          return { entry: entry.name, bytes: entry.size, mode: '0' + mode.toString(8) };
        }
      }
      off = dataStart + Math.ceil(entry.size / 512) * 512;
    }
    throw new Error('tar.gz 里没有 bin/gh');
  }

  /** 拿到 release 元数据；测试可用 DSH_GH_RELEASE_API 指向本地夹具。**带上界**（超时的错说得清是超时）。 */
  async function releaseMeta() {
    const res = await fetchBounded(RELEASE_API, {
      headers: { 'user-agent': 'dsh-github-resident', accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error('release API HTTP ' + res.status);
    return res.json();
  }

  function assetNamesFor(meta, arch) {
    const names = (meta.assets || []).map((a) => a.name);
    return {
      tarball: 'gh_' + String(meta.tag_name || '').replace(/^v/, '') + '_linux_' + arch + '.tar.gz',
      candidates: names.filter((n) => n.includes('linux_' + arch)),
    };
  }

  /** 优先用 API 给的 browser_download_url（测试夹具与私有镜像都靠它），否则按官方命名规则拼。 */
  function assetUrl(meta, name) {
    const asset = (meta.assets || []).find((a) => a.name === name);
    if (asset && asset.browser_download_url) return asset.browser_download_url;
    return RELEASE_DL + '/' + (meta.tag_name || '') + '/' + name;
  }

  /**
   * 下载首选 curl（带进度可控的超时），没有 curl 就退回 node 内建 fetch。
   * 两条路都回同一个形状：{ ok, method, httpCode }，诊断里能看到走的哪条。
   */
  async function downloadTo(url, file, extraArgs = []) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const forceFetch = process.env.DSH_GH_FORCE_FETCH === '1';
    if (!forceFetch) {
      const haveCurl = await run('sh', ['-c', 'command -v curl']);
      if (haveCurl.code === 0) {
        const r = await run('curl', ['-sSL', '--max-time', '300', '-w', '%{http_code}', ...extraArgs, '-o', file, url]);
        return { ok: r.code === 0, method: 'curl', httpCode: (r.stdout || '').trim().slice(-3), stderr: r.stderr || '' };
      }
    }
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
      if (!res.ok) return { ok: false, method: 'fetch', httpCode: String(res.status), stderr: '' };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) return { ok: false, method: 'fetch', httpCode: String(res.status), stderr: '响应体为空' };
      await fs.writeFile(file, buf);
      return { ok: true, method: 'fetch', httpCode: String(res.status), bytes: buf.length, stderr: '' };
    } catch (e) {
      return { ok: false, method: 'fetch', httpCode: '', stderr: String(e).slice(0, 300) };
    }
  }

  /** tar.gz 优先：抽 bin/gh 落缓存，不需要 root、不动系统包库。 */
  async function installFromTarball(meta, arch) {
    const { tarball } = assetNamesFor(meta, arch);
    const url = assetUrl(meta, tarball);
    const file = path.join(GH_DATA_DIR, tarball);
    const dl = await downloadTo(url, file);
    if (!dl.ok) {
      return { ok: false, step: 'tarball', url, error: '下载失败', method: dl.method, httpCode: dl.httpCode, stderr: (dl.stderr || '').slice(0, 300) };
    }
    try {
      await fs.mkdir(path.join(GH_DATA_DIR, 'bin'), { recursive: true });
      const extracted = extractGhFromTarGz(await fs.readFile(file), GH_BIN);
      await fs.rm(file, { force: true });
      return { ok: true, step: 'tarball', url, asset: tarball, ...extracted };
    } catch (e) {
      return { ok: false, step: 'tarball', url, error: '抽取失败: ' + String(e) };
    }
  }

  /** 退化路径：只有 .deb 时用 dpkg --extract 抽单文件（免 root，不注册系统包）。 */
  async function installFromDeb(meta, arch) {
    const { candidates } = assetNamesFor(meta, arch);
    const debName = candidates.find((n) => n.endsWith('.deb'));
    if (!debName) return { ok: false, step: 'deb', error: 'release 里没有 linux_' + arch + '.deb' };
    const dir = path.join(GH_DATA_DIR, 'deb-extract');
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(GH_DATA_DIR, debName);
    const url = assetUrl(meta, debName);
    const dl = await downloadTo(url, file);
    if (!dl.ok) {
      return { ok: false, step: 'deb', url, error: '下载失败', method: dl.method, httpCode: dl.httpCode, stderr: (dl.stderr || '').slice(0, 300) };
    }
    const ex = await run('dpkg', ['--force-not-root', '--extract', file, dir]);
    if (ex.code !== 0) return { ok: false, step: 'deb', url, error: 'dpkg --extract 失败', stderr: ex.stderr.slice(0, 300) };
    const src = path.join(dir, 'usr', 'bin', 'gh');
    if (!(await ghPathExists(src))) return { ok: false, step: 'deb', url, error: '解包里没有 usr/bin/gh' };
    await fs.mkdir(path.join(GH_DATA_DIR, 'bin'), { recursive: true });
    await fs.copyFile(src, GH_BIN);
    await fs.chmod(GH_BIN, 0o755);
    await fs.rm(file, { force: true });
    await fs.rm(dir, { recursive: true, force: true });
    return { ok: true, step: 'deb', url, asset: debName };
  }

  /** 落地一份自带 gh；已经能用则直接回。失败不抛，把诊断回给调用方。 */
  async function ensureGh({ force = false, prefer = 'auto' } = {}) {
    // 同一时刻只允许一次落地：GC 会删下载残留，并发的两次落地会互相把包删掉。
    if (gcInFlight) await gcInFlight;      // 先等 GC 让开，免得它删掉我们正在下的包
    if (ensureGhInFlight) return ensureGhInFlight;
    ensureGhInFlight = ensureGhOnce({ force, prefer }).finally(() => { ensureGhInFlight = null; });
    return ensureGhInFlight;
  }

  let ensureGhInFlight = null;

  async function ensureGhOnce({ force = false, prefer = 'auto' } = {}) {
    if (!force) {
      const cached = await probeGh(GH_BIN);
      if (cached.ok) return { ok: true, layer: 'plugin-cache', path: GH_BIN, version: cached.version };
    }
    const attempts = [];
    let meta = null;
    try {
      meta = await releaseMeta();
    } catch (e) {
      attempts.push({ step: 'release-api', error: String(e) });
    }
    if (meta) {
      const order = prefer === 'deb' ? ['deb', 'tarball'] : ['tarball', 'deb'];
      for (const kind of order) {
        const r = kind === 'tarball' ? await installFromTarball(meta, GH_ARCH) : await installFromDeb(meta, GH_ARCH);
        attempts.push(r);
        if (r.ok) break;
      }
    }
    const probe = await probeGh(GH_BIN);
    const result = {
      ok: probe.ok,
      layer: probe.ok ? 'plugin-cache' : 'none',
      path: probe.ok ? GH_BIN : null,
      version: probe.version || null,
      tag: meta ? meta.tag_name : null,
      arch: GH_ARCH,
      dataDir: GH_DATA_DIR,
      attempts,
    };
    if (probe.ok) {
      await fs.mkdir(GH_DATA_DIR, { recursive: true });
      await fs.writeFile(GH_STATE, JSON.stringify({
        installedAt: new Date().toISOString(), version: probe.version, tag: result.tag,
        arch: GH_ARCH, source: attempts.filter((a) => a.ok).map((a) => a.step),
      }, null, 2) + '\n', { mode: 0o600 });
    }
    lastEnsure = result;
    return result;
  }

  let lastEnsure = null;
  let ghMemo = null;
  /**
   * 系统层探测是否还"欠一次"（L1 没有缓存一说：宿主可能在插件进程活着的时候才装上 gh）。
   * 插件自带层是本地文件、跑没跑起来是事实，可以永久缓存；PATH 上的东西会变。
   * 只记「未命中」两个字面量、不带进快照，所以对既有调用方是惰性修复、不改任何返回字段。
   */
  let sysMemoPending = false;
  let sysProbedAt = 0;
  /** 系统层结论的最长保鲜期：TTL 内复用，过期重探（apt 卸载/替换 gh 后不至于一直报一个跑不起来的路径）。 */
  const SYS_LAYER_TTL_MS = Number(process.env.DSH_GH_SYS_LAYER_TTL_MS || 10 * 1000);

  /**
   * 全插件唯一的 gh 入口。system = 宿主已装（有就用），plugin-cache = 自带，
   * 两者都没有且 install !== false 时自动落地一份。
   */
  async function resolveGh({ install = true, force = false, prefer = 'auto' } = {}) {
    // install:false 是"读路径"（面板 buildSnapshot / gh_cli_status / 版本探测），它不落地，
    // 但系统层结论必须能过期重探：否则 L1 出现之前留下的 plugin-cache 会一直在，同一个插件里
    // gh_cli_resolve（install:true）报 system、gh_cli_status 报 plugin-cache，口径互相打架；
    // 反过来宿主的 gh 被卸掉后也会一直报一个跑不起来的路径。
    if (!force && ghMemo && !install) {
      const sysStateFresh = ghMemo.layer === 'system'
        && sysProbedAt > 0 && (Date.now() - sysProbedAt) < SYS_LAYER_TTL_MS;
      if (sysStateFresh || (!sysMemoPending && ghMemo.layer !== 'system')) return ghMemo;
    }
    const probeMs = ghProbeTimeoutMs();
    const sys = await probeGh('gh', { timeoutMs: probeMs });
    if (sys.ok) {
      // 报告真实路径：下游（buildSnapshot / gh_cli_status / teardown）都是拿这个路径去执行（N5）。
      const abs = sys.bin === 'gh' ? ((await whichCmd('gh', probeMs)) || '/usr/bin/gh') : sys.bin;
      ghMemo = { ok: true, layer: 'system', path: abs, version: sys.version };
      sysMemoPending = false;
      sysProbedAt = Date.now();
      return ghMemo;
    }
    // L1 未命中：只把这次结论当"此刻的快照"，下次读路径重探（见 sysMemoPending）。
    sysMemoPending = true;
    sysProbedAt = Date.now();
    const cached = await probeGh(GH_BIN, { timeoutMs: probeMs });
    if (cached.ok) {
      // 系统层没答上来、插件缓存这层有一份能跑的：这份是**能用的**答案，但系统层那次超时要如实带着走。
      ghMemo = {
        ok: true, layer: 'plugin-cache', path: GH_BIN, version: cached.version,
        ...(sys.timedOut ? { systemProbeTimedOut: true, note: '系统层的 gh 探测超时（未知）；这一份来自插件缓存' } : {}),
      };
      return ghMemo;
    }
    // 探测超时 = **未知**（不是「这一层没有 gh」）：不落 ghMemo、不去 ensureGh（不下载），如实回。
    // 票 29 的三条硬规矩：① 不把「卡死」翻译成「去下载一份」；② 一次卡死不能变成长期结论（下次重探）；
    //                   ③ 回执里「超时」与「没有」必须能分开。
    if (sys.timedOut || cached.timedOut) {
      ghMemo = null;                        // 旧结论此刻不可信 → 下次调用必须重探
      const which = [sys.timedOut ? '系统层' : null, cached.timedOut ? '插件缓存层' : null].filter(Boolean).join(' 与 ');
      return {
        ok: false, layer: 'none', path: null, version: null, timedOut: true,
        systemProbeTimedOut: Boolean(sys.timedOut), cacheProbeTimedOut: Boolean(cached.timedOut),
        note: which + '的 gh 探测在 ' + probeMs + 'ms 上界内没有回话（超时）：gh 在不在、能不能跑，此刻 **未知** —— '
          + '不是「没装」，也没有替你去下载；下次调用会重新探测（要调上界：DSH_GH_PROBE_TIMEOUT_MS）',
      };
    }
    if (install === false) {
      return { ok: false, layer: 'none', path: null, version: null, note: '系统没有 gh，插件缓存也没落地（install:false）' };
    }
    const res = await ensureGh({ force, prefer });
    ghMemo = res.ok ? { ok: true, layer: res.layer, path: res.path, version: res.version, ensure: res } : res;
    return ghMemo;
  }

  /** 兼容旧调用点：返回版本字符串或 null，但会顺手保证 gh 存在（除非 install:false）。 */
  async function ghVersion(opts = {}) {
    const r = await resolveGh(opts);
    return r.ok ? r.version : null;
  }

  /** 旧的强制落地入口（gh_cli_install 用），保留完整诊断。 */
  async function installGh({ prefer = 'auto' } = {}) {
    const sys = await probeGh('gh');
    if (sys.ok) {
      const abs = sys.bin === 'gh' ? ((await whichCmd('gh')) || '/usr/bin/gh') : sys.bin;
      return { installed: true, alreadyPresent: true, version: sys.version, path: abs, layer: 'system' };
    }
    const res = await ensureGh({ force: true, prefer });
    return {
      installed: res.ok,
      layer: res.layer,
      path: res.path,
      version: res.version,
      tag: res.tag,
      arch: res.arch,
      attempts: res.attempts,
      ...(res.ok ? {} : { error: '自带安装失败：' + JSON.stringify(res.attempts).slice(0, 400) }),
    };
  }

  /** 优先拉起手机上的默认浏览器 / GitHub 应用（DSHA 桥），退回桌面 xdg-open。 */
  async function openUrl(url) {
    try {
      const res = await fetch(`http://127.0.0.1:3090/app/open?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) return { via: 'device-bridge', status: res.status };
    } catch { /* 桥不在（非手机宿主），继续往下试 */ }
    const xdg = await run('xdg-open', [url]);
    if (xdg.code === 0) return { via: 'xdg-open' };
    return { via: 'none', note: '自行打开返回的 verification_uri' };
  }

    // gh 的交互流程必须挂在真 TTY 上，`script` 转发非终端 stdin 不可靠；
  // 这里用 python3 的 pty.fork 起一个真终端：自动回答两个提示、抓出一次性码，
  // 然后继续持有 pty 不放（gh 仍在轮询），授权完成后 gh 自己把凭据写进 hosts.yml。
  const DEVICE_FLOW_PY = String.raw`
import os, pty, re, select, sys, time
timeout = float(sys.argv[1])
gh = sys.argv[2]
hosts = sys.argv[3]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(gh, [gh, 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'])
buf = b''
deadline = time.time() + timeout
sent_y = announced = False
dsr = 0
last_enter = 0.0
while True:
    r, _, _ = select.select([fd], [], [], 0.4)
    if r:
        try:
            data = os.read(fd, 4096)
        except OSError:
            data = b''
        if data:
            buf += data
            if not sent_y and b'(Y/n)' in buf:
                os.write(fd, b'Y\n')
                sent_y = True
            # gh 的 survey 会发 ESC[6n 查光标位置，不回答就永远卡在这里
            seen = buf.count(b'\x1b[6n')
            if seen > dsr:
                os.write(fd, b'\x1b[1;1R')
                dsr = seen
            if not announced:
                m = re.search(rb'[A-Z0-9]{4}-[A-Z0-9]{4}', buf)
                if m:
                    sys.stdout.write('__DSH_CODE__ ' + m.group(0).decode() + '\n')
                    sys.stdout.flush()
                    announced = True
                    deadline = time.time() + 900
    # 关键：拿到码之后 gh 仍停在「Press Enter to open ... in your browser」，
    # 只补一次回车不够（实测会卡住、永不进入轮询），必须持续补。
    if announced:
        now = time.time()
        if now - last_enter > 1.0:
            try:
                os.write(fd, b'\n')
            except OSError:
                break
            last_enter = now
        if os.path.exists(hosts):
            sys.stdout.write('__DSH_OK__ credentials written\n')
            sys.stdout.flush()
            break
    if time.time() > deadline:
        sys.stdout.write('__DSH_TIMEOUT__\n')
        sys.stdout.flush()
        break
sys.stdout.flush()
`;

  function startDeviceFlowPty(timeoutMs = 20000) {
    return new Promise((resolve) => {
      resolveGh().then((g) => {
        if (!g.ok) {
          resolve({ code: null, output: '', error: 'gh 不可用且自带安装未成功', ensure: g.ensure || null });
          return;
        }
        let child;
        try {
          child = spawn('python3', ['-c', DEVICE_FLOW_PY, String(Math.max(5, Math.round(timeoutMs / 1000))), g.path, HOSTS_FILE], {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (err) {
          resolve({ code: null, output: '', spawnError: String(err) });
          return;
        }
      let out = '';
      let settled = false;
      const finish = (extra = {}) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child) child.unref();
        const code = (out.match(/__DSH_CODE__ ([A-Z0-9]{4}-[A-Z0-9]{4})/) || [])[1] || null;
        resolve({ code, output: out.slice(-600), ...extra });
      };
      const onData = (b) => {
        out += b.toString();
        if (out.includes('__DSH_CODE__')) finish();
        else if (out.includes('__DSH_TIMEOUT__')) finish({ timedOut: true });
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (err) => { finish({ spawnError: String(err) }); });
      const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs + 8000);
      });
    });
  }

  // ---------- 凭据销毁：卸载/登出必须清掉「插件目录之外」的副本 ----------
  // 这些路径都不随插件卸载消失：系统 dpkg 装的 /usr/bin/gh、gh 自己写的
  // ~/.config/gh/hosts.yml、登录工具写的 ~/.git-credentials 与全局 git credential.helper。

  async function fileMode(p) {
    try { return '0' + ((await fs.stat(p)).mode & 0o777).toString(8); } catch { return null; }
  }

  async function pathExists(p) {
    try { await fs.stat(p); return true; } catch { return false; }
  }

  /** 取 hosts.yml 里某 host 的 oauth_token。只用于撤销与掩码；返回值不出日志。 */
  /** hosts.yml 的读取口径上收到模块级的 readHostsEntry（全插件一份解析器）；本路径只需要 token。 */
  async function hostsToken(hostname) {
    return (await readHostsEntry(hostname)).token;
  }

  /** 撤 token 先认来源：gho_/ghu_ 可撤销；ghp_/github_pat_ 只能由用户在网页手删。 */
  function tokenSource(token) {
    if (!token) return 'none';
    if (/^gh[ou]_/.test(token)) return 'oauth';
    if (/^ghp_/.test(token)) return 'pat-classic';
    if (/^github_pat_/.test(token)) return 'pat-fine-grained';
    return 'unknown';
  }

  async function revokeToken(token) {
    if (!token) return { attempted: false, reason: 'no-token' };
    if (tokenSource(token) !== 'oauth') {
      return { attempted: false, reason: tokenSource(token), manual: 'https://github.com/settings/applications' };
    }
    const id = process.env.DSH_GH_OAUTH_CLIENT_ID || 'DSH_GITHUB_RESIDENT_CLIENT_ID';
    try {
      const r = await fetchBounded('https://api.github.com/applications/' + id + '/token', {
        method: 'DELETE',
        headers: { accept: 'application/vnd.github+json', authorization: 'Basic ' + Buffer.from(id + ':').toString('base64') },
        body: JSON.stringify({ access_token: token }),
      });
      return { attempted: true, status: r.status, revoked: r.status === 204 };
    } catch (e) {
      // 超时时**不许**说成「没撤成」：请求可能已经到达 GitHub —— 如实标「未知」（timedOut + 那句话）。
      return { attempted: true, timedOut: Boolean(e && e.timedOut), error: String((e && e.message) || e) };
    }
  }

  async function gitConfigValues(key) {
    const r = await run('git', ['config', '--global', '--get-all', key]);
    return r.code === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  }

  /**
   * 全量拆除。没给 confirm:true 一律只勘察、不改任何东西。
   * 顺序固定：先撤销（还挂在网上），再删本地副本，最后动 git 配置与 gh 包。
   */
  async function teardown(opts = {}) {
    const hostname = opts.hostname || 'github.com';
    const dryRun = opts.dry_run === true || opts.confirm !== true;
    const state = await readState();
    const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
    const hostToken = await hostsToken(hostname);
    const liveToken = hostToken || state.token || envToken || '';

    const helperKeys = [
      'credential.https://' + hostname + '.helper',
      'credential.' + hostname + '.helper',
      'credential.helper',
    ];
    const systemGh = await probeGh('gh');
    const helpers = {};
    for (const key of helperKeys) helpers[key] = await gitConfigValues(key);

    const found = {
      hostsFile: { path: HOSTS_FILE, exists: await pathExists(HOSTS_FILE), mode: await fileMode(HOSTS_FILE) },
      stateFile: { path: STATE_FILE, exists: await pathExists(STATE_FILE), mode: await fileMode(STATE_FILE) },
      gitCredentials: { path: CRED_FILE, exists: await pathExists(CRED_FILE), mode: await fileMode(CRED_FILE) },
      gitConfigHelpers: helpers,
      envTokenPresent: Boolean(envToken),
      token: { present: Boolean(liveToken), source: tokenSource(liveToken), masked: mask(liveToken) },
      ghBinary: { system: systemGh, pluginCache: { path: GH_BIN, exists: await pathExists(GH_BIN) } },
      pendingRemovals: (await pathExists(GH_DATA_DIR)) ? [GH_DATA_DIR] : [],
      accountedFor: Boolean(hostToken || state.token || envToken),
    };

    if (dryRun) {
      return {
        ok: true, dryRun: true, hostname, found,
        plan: ['revoke(仅 oauth)', 'unlink hosts.yml 条目', 'unlink ~/.git-credentials',
          'unlink state file', 'git config --unset-all helper', '可选 dpkg -r gh'],
      };
    }

    const steps = [];
    if (opts.revoke === true) steps.push({ step: 'revoke', ...(await revokeToken(liveToken)) });
    if (opts.reset_state === true && found.stateFile.exists) {
      await fs.rm(STATE_FILE, { force: true });
      steps.push({ step: 'state-file', removed: true });
    }
    if (opts.purge_git === true) {
      if (found.gitCredentials.exists) {
        await fs.rm(CRED_FILE, { force: true });
        steps.push({ step: 'git-credentials', removed: true });
      }
      for (const key of helperKeys) {
        if (!helpers[key].length) continue;
        const un = await run('git', ['config', '--global', '--unset-all', key]);
        steps.push({ step: 'git-config', key, unset: un.code === 0, stderr: un.stderr.trim().slice(0, 200) });
      }
    }
    if (opts.uninstall_gh === true) {
      const activeBin = (systemGh.ok && systemGh.bin) || GH_BIN;
      // **不戴工牌**：下面几条问/动的是**宿主自己**的 gh 登录态（销毁路径按它决定做什么）。
      const st = await run(activeBin, ['auth', 'status', '--hostname', hostname]);
      if (st.code === 0) {
        const lg = await run(activeBin, ['auth', 'logout', '--hostname', hostname]);
        steps.push({ step: 'gh-auth-logout', exitCode: lg.code, stderr: lg.stderr.trim().slice(0, 200) });
      }
      if (systemGh.ok) {
        const rm = await run('dpkg', ['-r', 'gh']);
        steps.push({ step: 'dpkg-remove-gh', exitCode: rm.code, stderr: rm.stderr.trim().slice(0, 200) });
      } else {
        steps.push({ step: 'dpkg-remove-gh', skipped: '系统本就没装 gh（插件自带模式）' });
      }
    }
    if (opts.remove_gh_cache !== false) {
      if (await pathExists(GH_DATA_DIR)) {
        await fs.rm(GH_DATA_DIR, { recursive: true, force: true });
        steps.push({ step: 'gh-cache-dir', removed: true, path: GH_DATA_DIR });
      }
      ghMemo = null;
      sysMemoPending = true;   // 环境刚被改过，下次读路径必须重探 L1
      sysProbedAt = 0;
    }
    if (opts.remove_gh_config === true) {
      await fs.rm(path.join(HOME, '.config', 'gh'), { recursive: true, force: true });
      steps.push({ step: 'gh-config-dir', removed: true });
    }

    const sysProbe = await probeGh('gh');
    const verify = {
      hostsHasToken: Boolean(await hostsToken(hostname)),
      gitCredentialsExists: await pathExists(CRED_FILE),
      stateFileExists: await pathExists(STATE_FILE),
      // 票 29：探测超时 = 未知 —— 不写成「不存在」（那会让这次销毁验收误报「已清干净」）。
      ghSystemExists: sysProbe.ok,
      ...(sysProbe.timedOut ? { ghSystemTimedOut: true } : {}),
      ghCacheExists: await pathExists(GH_BIN),
      helpers: {},
    };
    for (const key of helperKeys) verify.helpers[key] = await gitConfigValues(key);
    const leftover = [
      verify.hostsHasToken && 'hosts.yml',
      verify.gitCredentialsExists && '.git-credentials',
      verify.stateFileExists && 'state-file',
      sysProbe.timedOut && '系统 gh（探测超时，未能确认清没清）',
      verify.ghSystemExists && '系统 gh',
      verify.ghCacheExists && '插件自带 gh 缓存',
    ].filter(Boolean);
    return { ok: leftover.length === 0, dryRun: false, hostname, tokenMasked: mask(liveToken), steps, verify, leftover };
  }

  ctx.tools.register(textTool({
    toolName: 'gh_cli_logout',
    description: 'Destroy the resident GitHub identity and every local copy of it: optionally revoke the OAuth token at GitHub, drop the hosts.yml entry, delete ~/.git-credentials and the plugin state file, unset the global git credential helper, and optionally log out of / remove the gh CLI package. Without confirm:true it only reports what exists. The token is only ever reported as a mask.',
    parameters: {
      hostname: { type: 'string', description: 'GitHub host to tear down. Defaults to github.com.' },
      confirm: { type: 'boolean', description: 'Required to actually modify anything; without it this is a read-only exposure report.' },
      revoke: { type: 'boolean', description: 'Revoke the token at GitHub first (OAuth tokens only; PATs must be deleted in the web UI). Defaults to false.' },
      purge_git: { type: 'boolean', description: 'Delete ~/.git-credentials and unset global credential helpers. Defaults to false.' },
      reset_state: { type: 'boolean', description: 'Delete the plugin state file ~/.dsh/github-resident.json. Defaults to false.' },
      uninstall_gh: { type: 'boolean', description: 'Run gh auth logout, then dpkg -r gh to remove the system package. Defaults to false.' },
      remove_gh_config: { type: 'boolean', description: 'Delete the whole ~/.config/gh directory. Defaults to false.' },
      remove_gh_cache: { type: 'boolean', description: 'Delete the plugin-owned gh cache at ~/.dsh/gh-cli. Defaults to true (it is the plugin private copy, not a system install).' },
      dry_run: { type: 'boolean', description: 'Force report-only mode even when confirm is true.' },
    },
    readOnly: false,
    execute: async (args) => teardown(args || {}),
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_cli_version',
    description: 'Report the gh version situation and optionally self-update: compares the resolved gh against the latest official release (cached probe), and with update:true replaces the plugin-owned copy at ~/.dsh/gh-cli. A system-layer gh is never modified — the result says so and names the teardown path instead. Idempotent: already-latest returns updated:false.',
    parameters: {
      update: { type: 'boolean', description: 'Actually land the newer version when one exists. Defaults to false (report only).' },
      force: { type: 'boolean', description: 'Bypass the version-probe cache and re-ask the release API. Defaults to false.' },
    },
    readOnly: false,
    execute: async (args) => {
      const st = await versionStatus({ force: args.force === true });
      if (args.update !== true) return { ...st, updated: false, reason: st.updateAvailable ? 'update-available' : 'already-latest' };
      return { ...st, ...(await autoUpdate({ force: args.force === true })) };
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_cache_gc',
    description: 'Garbage-collect the plugin-owned gh cache dir (~/.dsh/gh-cli): remove leftover downloaded tarball/deb files, the dpkg --extract scratch dir, and old binary versions beyond keep_versions. Never touches the installed gh, the system gh, or the credential files. dry_run:true only reports what would be removed.',
    parameters: {
      dry_run: { type: 'boolean', description: 'Report only; remove nothing. Defaults to false.' },
      keep_versions: { type: 'integer', description: 'How many entries under versions/ to keep, newest first. Defaults to 2.' },
    },
    readOnly: false,
    execute: async (args) => gcCache(args || {}),
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_cli_install',
    description: 'Make the GitHub CLI available without any manual step: reuse the system gh when present, otherwise land a plugin-owned copy at ~/.dsh/gh-cli/bin/gh (official tar.gz single-file extract; falls back to a dpkg --extract of the .deb). No root and no package install required for the tarball path. Returns the resolved path, layer, version and per-step diagnostics.',
    parameters: {
      force: { type: 'boolean', description: 'Re-run the landing path even when a usable gh is already resolved. Defaults to false.' },
      prefer: { type: 'string', description: 'Landing preference: auto (tarball then deb), tarball, or deb. Defaults to auto.' },
    },
    readOnly: false,
    execute: async (args) => {
      const force = args.force === true;
      // prefer 此前**声明了却从没往下传**（handler 只读 force，ensureGh 收到的一直是默认 'auto'）——
      // 于是 prefer:'deb' 与不传完全等价。这里如实接线：认得的两个值才生效，其余按 auto
      //（判据与 ensureGh 内部一致：`prefer === 'deb' ? ['deb','tarball'] : ['tarball','deb']`）。
      const prefer = args.prefer === 'deb' ? 'deb' : args.prefer === 'tarball' ? 'tarball' : 'auto';
      const g = await resolveGh({ force, prefer });
      let res;
      if (g.ok && g.layer === 'system' && !force) {
        return { installed: true, alreadyPresent: true, layer: 'system', path: g.path, version: g.version };
      } else if (g.ok && g.layer === 'plugin-cache' && g.ensure) {
        res = g.ensure; // 这次调用真落地了一份，带上 attempts 诊断
      } else if (g.ok) {
        return { installed: true, alreadyPresent: true, layer: g.layer, path: g.path, version: g.version };
      } else {
        res = await installGh({ prefer });
      }
      const ghBin = res.path || g.path || 'gh';
      // **不戴工牌**：这条报的是「宿主自己的 gh 登录了没有」，戴上去会把它读成「插件有身份」。
      const auth = await run(ghBin, ['auth', 'status', '--hostname', 'github.com']);
      // installed = 调用结束后 gh 可用（不管是本次落地的还是已经在的）。
      return { ...res, installed: Boolean(ghBin !== 'gh' && res.version), authStatus: auth.code === 0 ? 'authenticated' : 'not-authenticated' };
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_cli_resolve',
    description: 'Read-only report of how this plugin will reach gh right now: layer (system vs plugin-cache), resolved binary path, version, the cache dir, and whether a landing would be attempted on next use. Never installs anything.',
    parameters: {},
    readOnly: true,
    execute: async () => {
      const sys = await probeGh('gh');
      const cached = await probeGh(GH_BIN);
      const state = await fs.readFile(GH_STATE, 'utf8').then((t) => JSON.parse(t)).catch(() => null);
      // 票 29：探测超时是**第三种事实**（未知），既不是 system 也不是「没有」——
      // 别让 resolved='none' 与 autoLandOnNextUse=true 替用户按下一个错的按钮（那次「自动落地」会去下载）。
      const timedOut = Boolean(sys.timedOut || cached.timedOut);
      return {
        resolved: sys.ok ? 'system' : (cached.ok ? 'plugin-cache' : (timedOut ? 'unknown' : 'none')),
        system: sys,
        pluginCache: { path: GH_BIN, ...cached },
        dataDir: GH_DATA_DIR,
        arch: GH_ARCH,
        autoLandOnNextUse: !sys.ok && !cached.ok && !timedOut,
        ...(timedOut ? { timedOut: true } : {}),
        lastInstall: state,
        lastEnsure: lastEnsure ? { ok: lastEnsure.ok, pending: lastEnsure.pending === true, layer: lastEnsure.layer, arch: lastEnsure.arch, attempts: lastEnsure.attempts } : null,
      };
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_cli_auth_web',
    description: 'Start the GitHub CLI web (device-code) sign-in for github.com, pull the one-time code out of the CLI output, and open the verification page in the phone browser or the system default browser. Returns the one-time code and the verification URL; the user finishes authorisation in the browser, then gh_cli_status confirms it.',
    parameters: {
      // 这里原来还有一个 `setup_git`（描述写着「Run gh auth setup-git afterwards … Defaults to true」），
      // 但 handler 从没读过它 —— 那句承诺一次都没兑现。要配 git 凭据助手请用独立工具 gh_cli_setup_git
      //（它真的执行 gh auth setup-git）。删掉而不是补实现：设备码流程只负责「拿到码 + 开页面」，
      // 此刻用户还没完成授权，顺手去改 git 全局配置属于另一个动作，让它保持显式更诚实。
      open_browser: { type: 'boolean', description: 'Try to open the verification page automatically. Defaults to true.' },
    },
    readOnly: false,
    execute: async (args) => {
      const g = await resolveGh();
      if (!g.ok) {
        // 票 29：探测超时时「落地没成功」是假话 —— 我们**故意没去**下载（未知 ≠ 没有）。
        return g.timedOut
          ? { ok: false, timedOut: true, error: 'gh 探测超时（此刻未知）：稍后重试；本插件不会在超时时替你下载，确需一份自带副本请显式跑 gh_cli_install', ensure: null }
          : { ok: false, error: 'gh 不可用，且自带落地没成功', ensure: g.ensure || null };
      }
      const version = g.version;
      const flow = await startDeviceFlowPty();
      const opened = args.open_browser === false ? { via: 'skipped' } : await openUrl(GH_DEVICE_URL);
      return {
        ok: Boolean(flow.code),
        version,
        ghLayer: g.layer,
        ghPath: g.path,
        user_code: flow.code,
        verification_uri: GH_DEVICE_URL,
        opened,
        note: flow.code
          ? '在打开的页面填入 user_code 完成授权；授权后调用 gh_cli_status 核验'
          : '未能抓到一次性码；看 gh_cli_install / gh_cli_resolve 的 attempts 诊断',
        logTail: flow.output,
      };
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_cli_status',
    description: 'Report the GitHub CLI state: gh version and path, authenticated accounts on github.com, active account, git credential helper wiring, and the masked contents of ~/.config/gh/hosts.yml.',
    parameters: {},
    readOnly: true,
    execute: async () => {
      const g = await resolveGh({ install: false });
      if (!g.ok) {
        // 票 29：探测超时 ≠ 没装。别在这时说「下次会自动落地一份」——超时那条路**故意不下载**。
        if (g.timedOut) {
          return {
            installed: false, timedOut: true, note: g.note,
            hint: 'gh 探测超时（此刻未知）：下次调用会重新探测；确需一份自带副本，显式跑 gh_cli_install（本插件不会在超时时替你下载）',
          };
        }
        return { installed: false, hint: '下次调用任意 gh_* 工具会自动落地一份，或显式跑 gh_cli_install' };
      }
      const version = g.version;
      // **不戴工牌**（票「子进程环境…」的「不戴」清单）：本工具问的就是**宿主 gh 自己的状态**，
      // 戴上 GH_TOKEN 会让它改口报「按 token 登录」（实测），把真相读成假象。
      const status = await run(g.path, ['auth', 'status', '--hostname', 'github.com']);
      const helper = await readCredHelper();
      const hostsPath = HOSTS_FILE;   // 路径只有模块顶部一处定义（原来这里又拼了一份）
      let hosts = null;
      try {
        const raw = await fs.readFile(hostsPath, 'utf8');
        hosts = {
          path: hostsPath,
          accounts: raw.split('\n')
            .filter((l) => /^\s{4}user:/.test(l))
            .map((l) => l.trim().replace(/^user:\s*/, '')),
          tokens: raw.split('\n')
            .filter((l) => /oauth_token:/.test(l))
            .map((l) => mask(l.split('oauth_token:')[1].trim())),
          gitProtocol: (raw.match(/git_protocol:\s*(\S+)/) || [])[1] || null,
        };
      } catch { hosts = { path: hostsPath, exists: false }; }
      let active = null;
      if (status.code === 0) {
        // **不戴工牌**：同上 —— 这里答的是「宿主 gh 的活动账号是谁」，不是「插件是谁」。
        const who = await run(g.path, ['api', 'user', '--jq', '.login']);
        if (who.code === 0) active = who.stdout.trim();
      }
      return {
        version,
        path: g.path,
        layer: g.layer,
        authenticated: status.code === 0,
        activeAccount: active,
        gitCredentialHelper: helper || null,
        hosts,
        rawStatus: status.stdout.trim().slice(0, 600),
      };
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_cli_setup_git',
    description: 'Wire git to the GitHub CLI credential helper (gh auth setup-git) so plain git push works without a stored token, and optionally set the global git identity to the active account.',
    parameters: {
      set_identity: { type: 'boolean', description: 'Also set git user.name/user.email from the active account. Defaults to true.' },
    },
    readOnly: false,
    execute: async (args) => {
      const g = await resolveGh();
      if (!g.ok) {
        // 票 29：探测超时时「落地没成功」是假话 —— 我们**故意没去**下载（未知 ≠ 没有）。
        return g.timedOut
          ? { ok: false, timedOut: true, error: 'gh 探测超时（此刻未知）：稍后重试；本插件不会在超时时替你下载，确需一份自带副本请显式跑 gh_cli_install', ensure: null }
          : { ok: false, error: 'gh 不可用，且自带落地没成功', ensure: g.ensure || null };
      }
      // 这三条 gh 调用是**以插件身份做事**（写宿主 git 配置、问"我是谁"）—— 戴 gh 组（票「子进程环境…」）。
      // 宿主没登录过 gh、或凭据在 keyring / hosts.yml 被清掉时，靠的就是这一戴。
      const badge = await withBadge('gh');
      const setup = await run(g.path, ['auth', 'setup-git', '--hostname', 'github.com'], badge.opts);
      const result = { exitCode: setup.code, ghLayer: g.layer, stderr: setup.stderr.trim().slice(0, 300), identityEnv: badge.badge };
      result.credentialHelper = (await readCredHelper()) || null;
      if (args.set_identity !== false && setup.code === 0) {
        const who = await run(g.path, ['api', 'user', '--jq', '.login'], badge.opts);
        const mail = await run(g.path, ['api', 'user', '--jq', '.email'], badge.opts);
        // 下面两条 `git config --global` 是**写盘**：不戴（它们问/写的是宿主盘上真值，不是"我是谁"）。
        if (who.code === 0 && who.stdout.trim()) {
          await git(process.cwd(), ['config', '--global', 'user.name', who.stdout.trim()]);
          result.gitUserName = who.stdout.trim();
        }
        if (mail.code === 0 && mail.stdout.trim() && mail.stdout.trim() !== 'null') {
          await git(process.cwd(), ['config', '--global', 'user.email', mail.stdout.trim()]);
          result.gitUserEmail = mail.stdout.trim();
        }
      }
      return result;
    },
  }));

  // ---------- 插件协议：Host Service + 自描述文档 ----------
  // 端口定义提到协议之前：协议里的 http.base 必须报**真实端口**（见下面 base 那行 —— 它此前写死
  // 31790，一旦用 DSH_GH_API_PORT 改端口，协议就在说谎）。接口本身的说明留在下面起服务那一段。
  const API_PORT = Number(process.env.DSH_GH_API_PORT) || 31790;
  const API_ORIGIN = 'http://127.0.0.1:' + API_PORT;
  const PROTOCOL = {
    id: PROTOCOL_ID,
    version: PROTOCOL_VERSION,
    spec: PROTOCOL_SPEC,
    service: {
      key: SERVICE_KEY,
      methods: [
        { name: 'protocol', args: [], returns: '本协议文档' },
        // 这一条曾经写的是**工具** gh_resident_status 的形状（token/identity/…），而服务方法
        // status() 走的是 statePayload（面板读的那份快照），两者字段完全不同 —— 消费方照协议调会拿不到东西。
        { name: 'status', args: '{ cached?: boolean, refresh?: boolean }', returns: '{ gh: { installed, version, layer, path, willAutoLand }, authenticated, account, hostsPath, stateFile, credHelper, reposRoot, lastFlow, updates, cached, snapshotAt, snapshotAgeMs, probe?, serverError?, apiPort? }' },
        { name: 'repos', args: '{ root?: string, depth?: number }', returns: '{ root, count, repos }' },
        { name: 'registry', args: '{ action?, root?, depth?, consent?, confirm?, prune?, path?, slug?, note?, tags? }', returns: '{ ok, action, consentRequired?, ask?, dir, registered|count, remoteBound, withoutRemote, drift? }' },
        { name: 'registryList', args: '{ root?, prefix?, onlyMissingRemote?, hasRemote?, host?, tag? }', returns: '{ libraryExists, dir, count, libraryCount, remoteBound, withoutRemote, byHost, entries, malformed }' },
        { name: 'sync', args: '{ root?, depth?, message?, push?, dryRun? }', returns: '{ root, scanned, committed, failed, results }' },
        { name: 'authStart', args: [], returns: '{ user_code, verification_uri, opened }' },
        { name: 'logout', args: '{ hostname?, confirm?, revoke?, purge_git?, reset_state?, uninstall_gh?, remove_gh_config?, dry_run? }', returns: '{ ok, dryRun, found|steps, verify, leftover }' },
        { name: 'version', args: '{ update?, force? }', returns: '{ current, latest, layer, updateAvailable, updated, reason }' },
        { name: 'gc', args: '{ dry_run?, keep_versions? }', returns: '{ dir, removed, freedBytes, kept }' },
      ],
      // 同一个 ctx 上还挂了第二个服务（Resident 半边借给合并进来的 Deck 半边）。它不叫 githubResident，
      // 所以不在上面的 methods 里 —— 但它是**对外契约的一部分**（Deck 晚绑定取用它），必须登记：
      // 否则「本插件对外提供哪些服务」这个问题的答案永远少一条。
      alsoProvided: [
        {
          key: 'ghResolver',
          providedWhen: '同一 ctx 具备 provide 能力时（服务位被占则缺席，Deck 侧如实回落自己的 PATH 解析，不静默换口径）',
          methods: [
            { name: 'resolve', args: [], returns: 'string|null —— gh 可执行文件的绝对路径（系统层 gh 优先，其次插件自带缓存 ~/.dsh/gh-cli/bin/gh；install:false，不落地、不回抛，找不到就回 null）' },
            { name: 'identityEnv', args: '{ groups?: ("gh"|"git")[] }', returns: '{ gh, git, source, login } —— **两组分开**的身份环境（值现算不缓存）：gh 组＝GH_TOKEN + 非交互三件套（不含 GH_CONFIG_DIR，真源没 token 时为空组）；git 组＝GIT_TERMINAL_PROMPT=0 + GIT_CONFIG_* 注入 user.name / user.email / 指向插件自有助手的 credential.helper（**空值重置在前**，且**不含 GH_TOKEN**）。谁戴谁不戴由调用方按「以插件身份做事 / 只是问宿主」判，别无差别注入' },
          ],
          why: '合并宿主先跑 Deck 后跑 Resident，所以 Deck 必须晚绑定；这条服务的存在就是为了「同一个插件只有一个 gh 在哪的答案」',
        },
      ],
      // consume 的示例根目录曾经写死 /root/GitHub —— 那只是默认值，不是事实。改成显式传参的样子，
      // 免得别的插件照抄一个在多数机器上都不存在的路径。
      consume: "const git = ctx.get('githubResident'); const r = await git.repos({ root: '/path/to/your/repos' })  // root 省略时用配置的 reposRoot，再退回 ~/GitHub",
    },
    http: {
      base: API_ORIGIN,
      loopbackOnly: true,
      endpoints: [
        { method: 'GET', path: '/state', returns: '账号快照 / gh 版本 / 更新意图 / 最近一次 GC（默认走快照，?refresh=1 同步重建）' },
        { method: 'GET', path: '/gh/version', returns: '当前版本 / 最新版本 / 是否可更新' },
        { method: 'POST', path: '/gh/update', returns: '自更新结果（系统层只报告）' },
        { method: 'GET', path: '/protocol', returns: '本文档（机器可读）' },
        { method: 'GET', path: '/registry', returns: '登记库状态：授权、条目数、有/无远端、index.json' },
        { method: 'GET', path: '/registry/list', returns: '登记库清单（?prefix= / ?host= / ?tag= / ?missing_remote=1）' },
        { method: 'POST', path: '/registry/plan', returns: '只读计划：会新登记谁、谁失效（不落盘）' },
        { method: 'POST', path: '/registry/build', returns: '建库/刷新（?consent=1 且带浏览器来源头才落盘，否则只回 ask）' },
        { method: 'POST', path: '/registry/verify', returns: '与磁盘对账（未登记 / 已消失 / 不再是仓库 / 越界）' },
        { method: 'POST', path: '/registry/revoke', returns: '撤授权（库保留）' },
        { method: 'POST', path: '/registry/purge', returns: '删整棵库（?confirm=1）' },
        { method: 'POST', path: '/auth/start', returns: '一次性码 + 授权页' },
        { method: 'POST', path: '/logout', returns: '凭据拆除勘察或执行结果（token 只回掩码）' },
        { method: 'POST', path: '/identity/email', returns: '写提交邮箱（?email=…；只认带浏览器来源头的请求，机器调用请走 gh_identity {action:"email"}；空值只回报现状、不写）' },
      ],
    },
    envelope: {
      protocol: 'string，固定为 ' + PROTOCOL_SPEC,
      ok: 'boolean，false 表示这次调用没成功（字段仍原样保留）',
      '<tool fields>': '各工具自己的字段原样保留，信封只加不替换',
    },
    tools: TOOL_PROTOCOL,
    errors: ERROR_CODES,
    registry: {
      schema: REGISTRY_SCHEMA,
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      dir: REGISTRY_DIR,
      repoDir: REGISTRY_REPO_DIR,
      indexFile: REGISTRY_INDEX_FILE,
      consentFile: REGISTRY_CONSENT_FILE,
      envOverride: 'DSH_GH_REGISTRY_DIR 覆盖整棵数据目录（授权文件、index.json、repos/ 都在它下面）；DSH_GH_API_PORT 改回环端口（默认 31790）',
      oneFilePerRepo: '<slug>.json，slug = <basename>-<sha1(绝对路径)[:12]>；目录名即事实来源，消费方只读目录即可',
      entry: {
        schema: 'string，固定 ' + REGISTRY_SCHEMA,
        schemaVersion: 'number，当前 ' + REGISTRY_SCHEMA_VERSION + '（1 → 2：远端名与仓库名拆成 name / repoName；1 的条目仍能读，仓库名从 URL 反解）',
        slug: 'string，文件名（不含 .json）',
        name: 'string，仓库目录名',
        path: 'string，仓库绝对路径（主键）',
        registeredAt: 'string，首次登记时间（ISO8601）',
        updatedAt: 'string，最近一次刷新时间',
        source: 'string，scan | rescan | manual',
        notes: 'string，人工备注（build/rescan 不覆盖已有备注，除非显式传 note）',
        tags: 'string[]，人工标签',
        git: {
          isRepo: 'boolean，探测时是否仍是 git 仓库',
          branch: 'string，当前分支（游离头为 HEAD）',
          head: 'string|null，短 SHA',
          dirty: 'number，git status --porcelain 的行数',
          untracked: 'number，其中未跟踪条目数',
          clean: 'boolean，dirty === 0',
          lastCommitAt: 'string|null，%cI',
          lastCommitSubject: 'string|null',
          hasRemote: 'boolean，是否有任何远端',
          remoteCount: 'number',
          remotes: '[{ name（远端名，如 origin/upstream）, url, scheme, host, owner, repoName（URL 里的仓库名）}]，url 已剥掉 userinfo',
          origin: 'object|null，名为 origin 的远端（没有才退回第一个远端）',
          url: 'string|null，origin.url 的别名',
          upstream: 'string|null，@{upstream}，没配追踪分支时为 null',
          ahead: 'number|null，相对 upstream 领先的提交数',
          behind: 'number|null，相对 upstream 落后的提交数',
          localBranches: 'number',
        },
      },
      consent: {
        schema: REGISTRY_CONSENT_SCHEMA,
        fields: ['granted', 'updatedAt', 'grants[]: { root, depth, grantedAt, via, tool }'],
        rule: '每个 root 一条 grant；请求的 root 必须命中某条 grant，且请求 depth 不得大于该 grant 的 depth（depth 只有「扫描深度」一个含义；缺 depth 的旧 grant 不覆盖任何请求）；不满足即重新问用户。consent:true 是一次性等价凭据，用后落成一条 grant',
        provenance: "grant.via 记来源：tool:consent:true（会话里用户同意）/ ui:registry-panel（设置页按钮）/ recorded-consent（沿用旧授权）；HTTP 的 ?consent=1 只接受带 Origin/Referer 的浏览器请求", 
        revoke: 'action:"revoke" 只删授权文件（库保留可读）；action:"purge" + confirm:true 才删整棵目录',
      },
      invariants: [
        '未授权时 build/rescan 一个字节都不写，只回 { consentRequired:true, ask:{...} }',
        '所有写入都在 REGISTRY_DIR 之内，绝不写进任何仓库（登记不改变工作树 dirty）',
        '远端 URL 落盘前剥掉 userinfo；token 永不进入登记库',
        'index.json 是派生视图：可由 repos/*.json 重建，不作为事实来源',
      ],
    },
    // 下面两段是**描述**，不是快照：它们说清「这类事实由谁负责、字段有哪些、谁该读、读了干什么」；
    // 当前值一律由对应工具的**回执**回答 —— 协议不该变成「跑这份协议这台机器」的快照。
    identity: {
      what: '身份：真源是谁、按什么顺序找它、找完之后谁在用它 —— 不跑任何工具就能读到。',
      sourceOfTruth: '插件自有 state（~/.dsh/github-resident.json，0600）是真源；gh CLI 的 hosts.yml 只作**只读**后端（ADR 0001）',
      priority: ['env:GH_TOKEN', 'env:GITHUB_TOKEN', 'state:~/.dsh/github-resident.json', 'gh-cli:~/.config/gh/hosts.yml'],
      points: ['git', 'gh-cli', 'env', 'path'],
      pointsNote: '四个消费点：git（凭据助手两个作用域 + 全局身份）/ gh CLI 凭据 / 子进程环境 / PATH 落点；每个点的当前状态与补救命令在 gh_identity 的回执里',
      // 票 #37 已裁（经验判据 + 措辞收窄）：这一句就是「子进程身份这条能说到哪、说不到哪」的**唯一口径**。
      subprocessIdentity: '子进程身份（ghResolver.identityEnv）的回执分两层：`applied` 只说「往哪几组注入了环境」；git 组另有 `gitCredential` —— `plugin-helper` ＝ 已清场并指向插件自有助手，**这条路上实测是我们答的**（宿主里压着过期的 store 助手／host 作用域助手时，`git credential fill` 回的仍是插件凭据；判据在 tests/merge/host/subprocess-env.test.mjs），`none` ＝ 真源 state 里没有 token、**根本没有指路**，凭据由宿主自己的助手决定（此时回执带一句 note 明说）。gh 组靠 `GH_TOKEN`，对 hosts.yml 有**文档化优先权**（同判据实测）。两样都**不宣称**「整条链路就是用这份凭据认证成功的」：ssh 远端、URL 内嵌凭据、http.extraheader 这些路径与本注入无关，谁赢不可知。',
      fieldsFrom: 'gh_identity',
      // 这一段说的字段＝**体检视图**（身份事实：谁、接了没、缺什么）；工具另外三个动作（接线 / 对账 / 撤销）
      // 各自的字段在 `views` 里，同样是同一处声明（GH_IDENTITY_VIEWS）派生出来的。
      fields: GH_IDENTITY_VIEWS.audit,
      actions: GH_IDENTITY_ACTIONS,
      views: GH_IDENTITY_VIEWS,
      readers: {
        'Deck 半边 / 未来的插件': '身份只走这一个消费面（服务位，或本段 points/fieldsFrom 指向的工具）；不要自己去读 hosts.yml，也不要另存一份 token',
        '面板 / 设置页': '按 points 的四项渲染「接了没接」，按 gh_identity 回执里的 summary.fixes 渲染补救命令',
        '诊断 agent': '先读本段分清「缺什么该问谁」：身份类缺口问 gh_identity，机器能力类缺口问 gh_env_probe',
        '本包维护者': '改字段属**接口变更**：先改 `GH_IDENTITY_VIEWS`（工具目录那行、本段 `fields` 与 `views` 都从它派生），门禁再把它们钉到工具真返回上',
      },
    },
    environment: {
      what: '环境：这台机器能不能干活、缺什么、为什么缺 —— 由 gh_env_probe 回答；本段说明它报什么、边界在哪。',
      tool: 'gh_env_probe',
      boundsNote: '探针自带**上界**：每条路多次尝试、总预算封顶、子进程逐项限时，所以它一定返回（不会出现「不退出、不报错、不结束」的第三态）',
      boundary: '能力与配置分家：这台机器**有什么**（gh / curl / node / 架构 / HOME 可写）在 environment；配置类路径（reposRoot / stateFile / hostsFile）的**存在性**在 gh_identity 的 config —— 同一事实只报一处',
      fieldsFrom: 'gh_env_probe',
      fields: declaredReturns('gh_env_probe'),
      readers: {
        'Deck 半边 / 未来的插件': '「执行环境能不能用」交给这个消费面判断，别自己 fork 一遍 gh/curl 去猜',
        '面板 / 设置页': '按 capabilities 逐项渲染缺什么，按每一项的 next 渲染补救动作',
        '诊断 agent': '先读本段再跑探针：网络**时通时不通**要按 degraded 读，不要读成 missing',
        '本包维护者': '新增能力项＝加字段（兼容，不动 version）；新增一段才 bump version',
      },
    },
    // 2026-10-14（票「重活租约」）：重活并跑会把宿主压垮 —— 本机实测宿主被系统杀过 6 次
    //（00:35 / 00:51 / 01:07 / 01:17 / 02:16 / 02:18），签名都是「外部杀」（无异常栈、无日志异常）。
    // 多会话并跑时各自的 agent 看不见别人，所以这条规矩写进协议，锁由 runner 自己上。
    load: {
      what: '重活租约：同一台机器上的**重活**（全量门禁 npm run verify:merge、合成环境矩阵）一次只许一份。',
      why: '重活会同时起一堆子进程；并跑 / 连着跑会把宿主压垮（本机实测被杀 6 次，凶手未定位但相关性明确）。',
      leaseFile: LOAD_LEASE_FILE,
      defaultTtlMs: LOAD_LEASE_DEFAULT_TTL_MS,
      env: {
        file: 'DSH_GH_LOAD_LEASE —— 覆盖租约文件路径（默认见 leaseFile）',
        inherited: LOAD_LEASE_HELD_ENV + ' —— 祖先进程已持有时传给子进程的记号（子进程见到它就不再取一次）',
      },
      rule: [
        '跑重活前先 acquire；**拿不到就换时间**，不硬跑、不并跑、不静默跳过',
        'runner 自己也会取：tests/merge/run.mjs 与合成环境矩阵拿不到就 exit 2 + BLOCKED-LOAD-LEASE（如实拒绝，不假装绿）',
        '持有者死了（pid 查不到）或过期 → 后来者可回收，**回收这件事在回执里看得见**（不悄悄抢）',
        'release 只认持有者：不替别人放（那会把正在跑的那一位解锁）',
        '它不属于「接线」：租约是运行期的事，不落宿主配置、不需要同意、不需要对账',
      ],
      tool: 'gh_load_lease',
      views: LOAD_LEASE_VIEWS,
      fieldsFrom: 'gh_load_lease',
      readers: {
        '任何要跑重活的 agent': '先 gh_load_lease {action:"status"}；有主就等（或换别的活），没主再 acquire，跑完 release',
        'runner / 门禁': '自己取同一份锁（tests/merge/_load-lease.mjs）：拿不到就如实拒绝，退出码 2 + BLOCKED-LOAD-LEASE 行',
      },
    },

    guarantees: {
      masking: '任何输出都不含 token 原文，只出现掩码',
      loopbackOnly: 'HTTP 只监听 127.0.0.1',
      readOnlyTools: TOOL_PROTOCOL.filter((t) => t.kind === 'read').map((t) => t.name),
      protocolIncrements: '协议增量规矩：给已有段**加字段**算向后兼容（不动 version）；**新增段**必须 bump version —— 消费方只按 spec 就能判断某段在不在',
      idempotent: '只读工具可重复调用；gh_sync 支持 dry_run 预演；registry build/rescan 幂等（同路径同 slug）',
      registryConsent: '登记库的建立与刷新必须先拿到用户同意：工具只回 ask 载荷，由模型转述给用户',
      registryWritesOnlyItsOwnDir: '登记过程不在任何仓库里写文件',
    },
  };

  const serviceApi = {
    id: PROTOCOL_ID,
    // 这一行原来也叫 `version`，与下面那个同名方法撞键：对象字面量后写者胜，于是它被**静默丢掉**
    //（协议号从来没能从服务上取到，取到的是版本体检方法）。改名保留信息，同时消掉重复键。
    protocolVersion: PROTOCOL_VERSION,
    protocol: () => PROTOCOL,
    status: (opts = {}) => statePayload(opts),
    repos: async (opts = {}) => {
      const state = await readState();
      const root = opts.root || state.reposRoot || DEFAULT_ROOT;
      const depth = Number.isInteger(opts.depth) ? opts.depth : 3;
      const list = await findRepos(root, depth);
      const out = [];
      for (const repo of list) out.push(await repoStatus(repo));
      return { root, count: out.length, repos: out };
    },
    registry: async (opts = {}) => registryAction(opts),
    registryList: async (opts = {}) => registryListPayload(opts),
    sync: async (opts = {}) => syncRepos({
      root: opts.root,
      depth: opts.depth,
      message: opts.message,
      push: opts.push,
      dryRun: opts.dryRun === true,
    }),
    authStart: async () => {
      const flow = await startDeviceFlowPty();
      const opened = await openUrl(GH_DEVICE_URL);
      lastFlow = { user_code: flow.code, at: new Date().toISOString(), opened };
      return { user_code: flow.code, verification_uri: GH_DEVICE_URL, opened };
    },
    logout: async (opts = {}) => teardown(opts),
    version: async (opts = {}) => {
      const st = await versionStatus({ force: opts.force === true });
      if (opts.update !== true) return { ...st, updated: false, reason: st.updateAvailable ? 'update-available' : 'already-latest' };
      return { ...st, ...(await autoUpdate({ force: opts.force === true })) };
    },
    gc: async (opts = {}) => gcCache(opts),
  };
  if (typeof ctx.provide === 'function') ctx.provide(SERVICE_KEY, serviceApi);

  // 2026-10-12 gh 解析点归一（身份/交付融合收尾）：把**本插件唯一的 gh 解析器**（resolveGh：
  //   系统 gh → 插件自带缓存 ~/.dsh/gh-cli/bin/gh → 自动落地）以服务形式借给同一 ctx 里的另一半
  //   （合并进来的 Deck：它过去自己认 PATH 与 DSH_GH_PATH，于是出现"Resident 能用 gh、Deck 说没装 gh"）。
  // 为什么是服务而不是装配层传对象：合并宿主先跑 Deck、后跑 Resident（见 tools/merge/client-factory.ts 的
  //   装配约定），所以 Deck 侧必须**晚绑定**——真正取 gh 是在用的时候（探测/执行），那时本服务已在。
  // resolve() 只回路径或 null，不回抛：调用方（Deck 平台层）自己按"没找到"诚实报告。
  if (typeof ctx.provide === 'function') {
    try {
      ctx.provide('ghResolver', {
        resolve: async function () {
          try {
            const r = await resolveGh({ install: false });
            return (r && r.ok && r.path) ? r.path : null;
          } catch (e) { return null; }
        },
        // 2026-10-14（票「子进程环境：插件启动的 gh / git 子进程按需带上真源 token」）：这支服务位从此答的是
        // 「gh 怎么跑」的**唯一答案** —— 除了"在哪"（resolve，语义与调用方都不动），还有"用谁的身份、带什么环境"
        // （identityEnv，两组分开给）。挂在这里而不是另开一个服务位，是《Deck 半边接消费面（执行环境由消费面供给）》
        // Q5=(a) 的裁决：消费面保持唯一入口。Deck 半边用它来给三个执行出口戴同一份；Resident 自己 spawn 的子进程
        // 走的是同一个实现（见 withBadge），**两处各算一份环境**是明令禁止的。
        identityEnv: async function (opts) { return await identityEnv(opts); },
      });
    } catch (eProvide) { /* 服务位被占：Deck 侧会如实回落 PATH（不静默换口径） */ }
  }

  // ---------- 身份接线的写半边（wire / verify / unwire；票「gh_identity {wire|verify|unwire}」） ----------
  // 真源只有一个（插件 state）。这里做的是「把它投射到宿主的几个消费点」这件**可对账、可撤**的事。
  // 三条硬规矩：
  //   ① 写之前先回显**具体值**并拿到同意 —— 没同意一个字节都不写（只回 ask 载荷，由模型转述给用户）；
  //   ② 每次写都记台账（before / after / at / writer），撤的时候按它逐项还原；
  //   ③ 撤只撤「现在仍等于我们写的值」的项 —— 被别人改过的不动，只如实报（不拿旧值去盖别人的新值）。

  /** 第一个「存在且在 PATH 上、又可写」的目录（PATH 落点用）；找不到回 null，绝不硬塞。 */
  async function firstWritablePathDir() {
    for (const dir of String(process.env.PATH || '').split(':').filter(Boolean)) {
      try {
        const st = await fs.stat(dir);
        if (st.isDirectory() && await canWriteDir(dir)) return dir;
      } catch { /* 试下一个 */ }
    }
    return null;
  }

  /** 落盘自有凭据助手（0755；内容已一致就不重写，免得每次 wire 都改 mtime）。与运行期那份**同源**（同一个落盘实现）。 */
  async function ensureWireHelper() {
    return await landGitCredentialHelper(WIRE_DIR, WIRE_HELPER_FILE);
  }

  const gitGlobalGet = async (key) => (await git(process.cwd(), ['config', '--global', '--get', key])).stdout.trim() || null;
  const gitGlobalSet = (key, value) => git(process.cwd(), ['config', '--global', '--replace-all', key, String(value)]);
  const gitGlobalUnset = (key) => git(process.cwd(), ['config', '--global', '--unset-all', key]);

  /**
   * 一个键在 git 全局配置里**读出来的所有行**（`--get-all`）：键不存在回 `[]`。
   *
   * 为什么撤销前必须问这一句（票 36《unwire 的「先归一化再比对」补实施（票 19 已裁未做）》，实测）：
   * `--get` 是**单值**读法 —— 同一个键被写成多行时它只回**最后一行**，而撤销是**整键**动作
   * （`--unset-all` / `--replace-all`）。于是「最后一行恰好等于我们写的值」时，撤下去会把别人的行一起抹掉
   * （复现：`--add somebody-else` + `--add <我们写的值>` → unwire 之后 `somebody-else` 那行没了）。
   *
   * 不用 `--null` 去分辨「同一项有多条」与「值本身跨行」：那两种在**判定上完全等价**（都是读不准），
   * 而多依赖一个老 git 未必支持的开关，换来的是「开关不被支持 → 读成空 → 判定静默退化」的风险。
   */
  const gitGlobalGetAll = async (key) => {
    const r = await git(process.cwd(), ['config', '--global', '--get-all', key]);
    if (r.code === 0) return r.stdout.replace(/\n$/, '').split('\n');
    // 退出码 1 = git 说的「这个键没有」；别的非 0 = **读失败**（未知）。未知**不折成「没有」**：
    // 折成没有的话，撤销在 before 非空时会判成「被别人改过」，还永久记一笔放手 —— 与票 29 那条
    // 「探测超时 = 未知，不据此写宿主」同一个口径。读失败的项交给调用方跳过（`null`）。
    if (r.code === 1) return [];
    return null;
  };

  /**
   * 四个投影点的接线项：每条 = 一处宿主配置的 `before → after`。
   * 写不了的点照样出现，但标 `writable:false` + `why` —— 让回执说清「不是忘了，是写不了」。
   */
  async function wireItems() {
    const state = await readState();
    const resolved = await resolveIdentity(state);
    const login = resolved.login || (typeof state.login === 'string' ? state.login : '') || '';
    const items = [];

    // ---- 点 1：git 凭据助手（**host 作用域**：它优先于全局；只写全局会把别的 host 的凭据也劫到本插件）----
    items.push({
      point: 'git-helper', key: CRED_HOST_HELPER_KEY, scope: 'git global（host 作用域）',
      before: await gitGlobalGet(CRED_HOST_HELPER_KEY), after: '!' + WIRE_HELPER_FILE, writable: true,
      why: '指向插件自有助手（读插件 state 作答），不再依赖 gh 的绝对路径',
    });

    // ---- 点 2：全局 git 身份（提交邮箱从**唯一口径** commitEmail() 取：state 填过就用它，没填过退回隐私邮箱形式）----
    const nameAfter = login || null;
    const emailAfter = commitEmail(state, login);
    // 「这个值是不是 state 给的」也问同一支口径（对 null 登录名求值：非空即来自 state），不另写一遍判断。
    const emailFromState = Boolean(commitEmail(state, null));
    items.push({
      point: 'git-identity', key: 'user.name', scope: 'git global',
      before: await gitGlobalGet('user.name'), after: nameAfter, writable: Boolean(nameAfter),
      why: nameAfter ? null : '解析不到 login（env token 不带登录名）—— 先 gh_resident_login，或让 gh CLI 登录后再接线',
    });
    items.push({
      point: 'git-identity', key: 'user.email', scope: 'git global',
      before: await gitGlobalGet('user.email'), after: emailAfter, writable: Boolean(emailAfter),
      why: emailAfter
        ? (emailFromState
          ? 'state 里填过提交邮箱，就用它（要改：gh_identity {action:"email", email:"…"}）'
          : 'state 里没填过邮箱 → 由登录名生成 GitHub 的隐私邮箱形式（要换成真邮箱：gh_identity {action:"email", email:"…"}）')
        : '既解析不到 login、state 里也没填过邮箱 —— 填一个（gh_identity {action:"email", email:"…"}），或先 gh_resident_login / 让 gh CLI 登录后再接线',
    });

    // ---- 点 3：gh CLI（写不了：hosts.yml 只读不写，ADR 0001 的边界）----
    const hostsEntry = await readHostsEntry(GH_HOST);
    items.push({
      point: 'gh-cli', key: HOSTS_FILE, scope: 'gh 自己的文件（只读）', before: null, after: null, writable: false,
      why: hostsEntry.token
        ? 'gh CLI 自己已有凭据（' + (hostsEntry.login || '登录名未知') + '）—— 本插件不写它'
        : 'hosts.yml 只读不写（ADR 0001）：这条只能让用户自己 gh auth login，或走 gh_cli_auth_web 设备码',
    });

    // ---- 点 4：PATH 落点（**只在 PATH 上没有能跑的 gh 时**才落；解析器优先系统层，不抢系统的）----
    const sysGh = await probeGh('gh');
    const cachedGh = await probeGh(GH_BIN);
    // 票 29：探测超时 = 未知 —— **不据此落 PATH**。否则一个卡死的 gh 会被当成「没有 gh」，
    // 于是往宿主的 PATH 目录里写一个软链（那是**写动作**，比报错难收回）。
    const landingDir = (sysGh.ok || sysGh.timedOut) ? null : await firstWritablePathDir();
    const landingTarget = landingDir ? path.join(landingDir, 'gh') : null;
    let landingBefore = null;
    let landingWritable = false;
    let landingWhy = null;
    if (sysGh.ok) {
      landingWhy = 'PATH 上已经有能跑的 gh（' + (sysGh.version || '版本未知') + '）—— 什么都不做，不抢系统的';
    } else if (sysGh.timedOut) {
      landingWhy = '系统层的 gh 探测超时（此刻未知）—— 不据此落 PATH：把「未知」当成「没有」会往宿主上白写一个软链';
    } else if (!cachedGh.ok) {
      landingWhy = 'PATH 上没有 gh，插件自带缓存里也没有可跑的副本 —— 先跑 gh_cli_install';
    } else if (!landingTarget) {
      landingWhy = 'PATH 里找不到可写的目录 —— 不硬塞（要的话自己把 ' + GH_BIN + ' 软链到 PATH 上）';
    } else {
      const existing = await fs.lstat(landingTarget).catch(() => null);
      if (!existing) {
        landingWritable = true;
      } else if (existing.isSymbolicLink()) {
        landingBefore = await fs.readlink(landingTarget).catch(() => null);
        landingWritable = landingBefore === GH_BIN;
        if (!landingWritable) landingWhy = '那个位置已经有别人的软链（' + landingBefore + '）—— 不覆盖';
      } else {
        landingWhy = '那个位置已经有真实文件 —— 不覆盖';
      }
    }
    items.push({
      point: 'path-landing', key: landingTarget || 'gh', scope: 'PATH',
      before: landingBefore, after: landingWritable ? GH_BIN : null, writable: landingWritable, why: landingWhy,
    });

    return items;
  }

  async function readWireLedger() {
    try {
      const raw = JSON.parse(await fs.readFile(WIRE_LEDGER_FILE, 'utf8'));
      if (raw && raw.schema === WIRE_LEDGER_SCHEMA && Array.isArray(raw.items)) return raw;
      return { schema: WIRE_LEDGER_SCHEMA, items: [], malformed: true };
    } catch {
      return { schema: WIRE_LEDGER_SCHEMA, items: [] };
    }
  }
  const wireLedgerView = (ledger) => ({
    file: WIRE_LEDGER_FILE,
    entries: ledger.items.length,
    active: ledger.items.filter((i) => !i.revokedAt && !i.abandonedAt).length,
  });

  async function readWireConsent() {
    try {
      const c = JSON.parse(await fs.readFile(WIRE_CONSENT_FILE, 'utf8'));
      return c && c.schema === WIRE_CONSENT_SCHEMA ? c : { granted: false, malformed: true };
    } catch {
      return { granted: false };
    }
  }

  /** 计划的指纹：只算**真要写**的项 —— 计划变了指纹就变，授权不能跟着漂。 */
  function wirePlanFingerprint(items) {
    const lines = items
      .filter((i) => i.writable && i.before !== i.after)
      .map((i) => [i.point, i.key, i.before === null ? '(unset)' : i.before, i.after === null ? '(unset)' : i.after].join(' | '))
      .sort();
    return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
  }

  function wireQuestion(items) {
    const changed = items.filter((i) => i.writable && i.before !== i.after);
    const lines = changed.map((i) => '「' + i.key + '」' + (i.before === null ? '(未设置)' : i.before) + ' → ' + i.after);
    return {
      question: '是否同意把身份设置写到这台机器上？共 ' + changed.length + ' 项：' + lines.join('；')
        + '。只改 git 的全局配置（github.com 的凭据助手 + 全局 user.name / user.email）'
        + (changed.some((i) => i.point === 'path-landing') ? '，以及把自带 gh 软链到 PATH 上' : '')
        + '；每一项都记台账，随时可以用 unwire 撤销；不写 gh 的 hosts.yml、不落第二份 token。',
      options: ['同意接线', '先看计划（不带 consent 再调一次 wire）', '不同意'],
      onAgree: 'gh_identity {action:"wire", consent:true}',
      onDecline: '一个字节都不写；只要计划没变，之后每次调用都会再问一次',
    };
  }

  /**
   * 撤销比对用的**归一化**：去掉**首尾**空白与引号 —— 只用于**判断**，绝不拿去写（票 36）。
   *
   * 为什么反复剥（空白 → 引号 → 空白）：两者互相遮挡，`  "!helper"  ` 要能归到 `!helper`；
   * 只剥一轮会在这种形状上留下引号。`null`（键不存在）与空串在这一层**不是**同一件事 ——
   * 归一化不改变「有没有这个键」这一维，否则「原本为空 → 删键」那条判断会被抹平。
   * （读那一侧另有一层全仓一致的约定：`--get` / `--get-all` + trim 会把**空值**折成「未设置」；
   *   那条路径的行为由 §七⑧ 的判据钉着，不是这里悄悄决定的。）
   */
  function normalizeForCompare(v) {
    if (v === null || v === undefined) return null;
    let s = String(v);
    for (let i = 0; i < 8; i += 1) {
      const next = s.trim().replace(/^["']+/, '').replace(/["']+$/, '').trim();
      if (next === s) break;
      s = next;
    }
    return s;
  }

  /** 回执里怎么显示一个值（`null` ＝ 这个键没有 / 读不到）—— 两处共用，别各写一遍。 */
  const shownValue = (v) => (v === null ? '(未设置)' : JSON.stringify(v));

  /**
   * 读一项的**现况**，并回答「这一次读能不能用来做归属判定」—— 票 36 的「判不出来」第一类。
   *
   * 票 41 起这是**两处共用**的读（原名 `readUnwireCurrent`）：`verify` 与 `unwire` 都从这里取现况，
   * 免得「怎么读一个 git 值」再长出第二种口径。
   *
   * 读不准有两种：**同一项被写成多行**（git 键有多行，或值本身跨行 —— 单值读法只看到其中一份，
   * 而撤是整键动作，会误伤别人那几行），以及 PATH 落点上「那个位置存在却不是软链」（读不出归属，
   * 更不能拿 readlink 的 null 去 `rm`）。两种都交给调用方**跳过**，不据此写任何东西。
   * （`verify` 是只读的，无所谓「跳过写入」，但同样**不下结论**：报 `state:"unknown"`，不报「不是我们写的」。）
   */
  async function readEntryCurrent(entry) {
    if (entry.point !== 'path-landing') {
      const all = await gitGlobalGetAll(entry.key);
      if (all === null) {
        return { current: null, readable: false, why: 'git 读不出来（退出码既不是 0 也不是「键不存在」的 1）—— 未知不当成没有，这次不判' };
      }
      if (all.length > 1) {
        return {
          current: all.join('\n'), readable: false,
          why: '这个键在 git 里读出来是 ' + all.length + ' 行（同一项被写成多行，或值本身跨行）—— 单值读法只看到最后一行，撤它会把别的行一起抹掉',
        };
      }
      return { current: all.length === 1 ? (all[0].trim() || null) : null, readable: true, why: null };
    }
    // 用 lstat（不是 stat）：悬空软链也要算「存在」—— 它是我们落的，readlink 照样读得出目标。
    const st = await fs.lstat(entry.key).catch(() => null);
    if (!st) return { current: null, readable: true, why: null };
    if (!st.isSymbolicLink()) {
      return { current: null, readable: false, why: '那个位置现在不是软链（不是本插件落的）—— 读不出归属，也不去删它' };
    }
    const target = await fs.readlink(entry.key).catch(() => null);
    if (target === null) return { current: null, readable: false, why: '那个软链的目标读不出来' };
    return { current: target, readable: true, why: null };
  }

  /**
   * 一项的**归属判定** —— 一处实现、两处读者（票 41 已裁的「真同源」）。
   *
   * 返回 `{ own, reason, current, why }`：`own` 是**中性事实**，不带动作含义 ——
   *   - `true`  归一化后仍等于台账里的 `after` → `reason:'ours'`（`why` 只在「只差首尾空白/引号」时有话）；
   *   - `false` 归一化后确实是别的值 → `reason:'not-ours'`；
   *   - `null`  **判不出来** → `reason:'unreadable'`（读不准），或 `'back-to-before'`
   *            （已经回到接线前的样子：撤与不撤结果相同，「是我们撤的」还是「别人改回来的」无从判断）。
   *
   * 顺序即优先级（票 36 已裁）：「判不出来」优先 —— 它只会**减少**写入。
   * 「先归一化再比对」是同票的裁决口径：值与台账只差一个首尾引号/空白时**不该**被当成「被别人改过」
   * （那会把还能撤的项误判成放手）。
   *
   * 两处说法都从这一支派生，不各写一遍：
   *   - `unwire`（动作）译成票 36 的三种结果 `revoked` / `abandoned` / `undecidable`，**回执词与行为不变**；
   *   - `verify`（只读）译成 `state` 的四个词 `ours` / `not-ours` / `back-to-before` / `unknown`
   *     （后两个都来自 `own === null`，按 `reason` 分开 —— 一个成功撤销的项不该读成 `unknown`）。
   */
  async function judgeOwnership(entry) {
    const read = await readEntryCurrent(entry);
    if (!read.readable) return { own: null, reason: 'unreadable', current: read.current, why: read.why };
    if (normalizeForCompare(read.current) === normalizeForCompare(entry.before)) {
      return {
        own: null, reason: 'back-to-before', current: read.current,
        why: '现在的值已经和接线前一样（' + shownValue(entry.before) + '）—— 撤与不撤结果相同，是「我们撤的」还是「别人改回来的」无从判断',
      };
    }
    if (normalizeForCompare(read.current) === normalizeForCompare(entry.after)) {
      // 归一化只影响这一次判断：真撤的时候写的仍是台账里记的 before 原文。
      if (read.current !== entry.after) {
        return {
          own: true, reason: 'ours', current: read.current,
          why: '现在的值与台账只差首尾空白/引号（' + shownValue(read.current) + ' ≈ ' + shownValue(entry.after) + '），归一化后相同 → 仍算本插件写的',
        };
      }
      return { own: true, reason: 'ours', current: read.current, why: null };
    }
    return {
      own: false, reason: 'not-ours', current: read.current,
      why: '现在的值不是本插件写的（被别人改过）—— 不动它，只记「放手」',
    };
  }

  async function identityWireAction(action, args) {
    const ledger = await readWireLedger();

    // ---- verify：只读对账，不需要同意。逐项回答「现在的值 / 本插件写入的值 / 写入时间 / 还算不算我们写的」----
    // 归属那一问与 unwire **同一支判定**（票 41 已裁的「真同源」）：这里只报，不做。
    if (action === 'verify') {
      const items = [];
      for (const entry of ledger.items) {
        const j = await judgeOwnership(entry);
        // `own === null` 的两种情形按 `reason` 分开报：一个**成功撤销**的项不该读成 `unknown`。
        const state = j.own === true ? 'ours'
          : j.own === false ? 'not-ours'
            : (j.reason === 'back-to-before' ? 'back-to-before' : 'unknown');
        // 台账态与盘上归属**分两列**（票 41 已裁）：一列只说一件事；且已撤销／已放手的项也照判盘上那一问 ——
        // 于是「撤了但没生效」「撤后又被改回来」第一次看得见（老写法台账态一到就短路，盘上什么都不看）。
        const retired = entry.revokedAt ? 'revoked' : (entry.abandonedAt ? 'abandoned' : null);
        const retiredNote = entry.revokedAt
          ? '已撤销（' + (entry.revokedBy || 'unwire') + ' 于 ' + entry.revokedAt + '）'
          : entry.abandonedAt
            ? '已放手：值被别人改过，本插件不再管它（' + entry.abandonedAt + '），也不去覆盖'
            : null;
        const ownershipNote = state === 'ours'
          ? j.why                                     // 只在「只差首尾空白/引号」时有话要说
          : state === 'not-ours'
            ? '现在的值不是本插件写的：本插件在 ' + entry.at + ' 写的是 written 那一列'
            : state === 'back-to-before'
              ? '盘上现在的值已经回到接线前的样子（' + shownValue(entry.before) + '）—— 是谁改回来的无从判断'
              : '读不准，这一项这次不下结论：' + (j.why || '读不出来');
        items.push({
          point: entry.point, key: entry.key, scope: entry.scope,
          now: j.current, written: entry.after, writtenAt: entry.at, writer: entry.writer,
          state, retired, ours: j.own,
          note: [retiredNote, ownershipNote].filter(Boolean).join('；') || null,
        });
      }
      const helperExists = await fs.stat(WIRE_HELPER_FILE).then(() => true).catch(() => false);
      const credFileExists = await pathExists(CRED_FILE);
      return {
        ok: true, action, items,
        // 计数按 `state` 的四个取值（票 41 已裁）：台账态的条数由 `ledger` 那块报，不在这里重复。
        summary: {
          ours: items.filter((i) => i.state === 'ours').length,
          notOurs: items.filter((i) => i.state === 'not-ours').length,
          backToBefore: items.filter((i) => i.state === 'back-to-before').length,
          unknown: items.filter((i) => i.state === 'unknown').length,
        },
        disk: {
          helperFile: WIRE_HELPER_FILE, helperExists,
          ledgerFile: WIRE_LEDGER_FILE,
          gitCredentialsFile: CRED_FILE, gitCredentialsExists: credFileExists,
          hostsFile: HOSTS_FILE,
        },
        ledger: wireLedgerView(ledger),
        notes: [
          '本插件不注入子进程环境（那是另一张票的事：《子进程环境：插件启动的 gh / git 子进程按需带上真源 token》）。',
          '本插件不搬迁 state：hosts.yml 有身份而 state 没有时，不改写 state（迁移包带着别人的信息等同于网络裸奔）。',
          ...(credFileExists ? ['磁盘上还有一份明文凭据（' + CRED_FILE + '，store 那条路留下的）—— 本插件不删它；要清就跑 gh_cli_logout {purge_git:true}'] : []),
          ...(ledger.items.length === 0 ? ['台账还是空的：还没接过线。verify 只回答「我们写过什么」；没写过就无从对账（要接线就跑 action:"wire"）'] : []),
        ],
      };
    }

    const plan0 = await wireItems();
    const only = Array.isArray(args.targets) && args.targets.length ? new Set(args.targets.map(String)) : null;
    const plan = only ? plan0.filter((i) => only.has(i.point)) : plan0;
    const changed = plan.filter((i) => i.writable && i.before !== i.after);
    const fingerprint = wirePlanFingerprint(plan);
    const grant = await readWireConsent();
    const grantedByCall = args.consent === true;
    const grantedByRecord = grant.granted === true && grant.fingerprint === fingerprint;

    if (action === 'wire') {
      if (changed.length > 0 && !grantedByCall && !grantedByRecord) {
        return {
          ok: false, action, consentRequired: true, wrote: false,
          plan: plan.map((i) => ({ ...i, changed: i.writable && i.before !== i.after })),
          results: [], ledger: wireLedgerView(ledger),
          consent: { required: true, grantedBy: null, fingerprint },
          ask: wireQuestion(plan),
        };
      }
      const results = [];
      const now = new Date().toISOString();
      if (changed.length > 0) await ensureWireHelper();
      for (const item of changed) {
        let ok = false;
        let error = null;
        try {
          if (item.point === 'path-landing') {
            await fs.mkdir(path.dirname(item.key), { recursive: true });
            await fs.symlink(item.after, item.key);
            ok = true;
          } else if (item.after === null) {
            const r = await gitGlobalUnset(item.key);
            ok = r.code === 0;
            if (!ok) error = r.stderr.trim().slice(0, 200) || ('exit ' + r.code);
          } else {
            const r = await gitGlobalSet(item.key, item.after);
            ok = r.code === 0;
            if (!ok) error = r.stderr.trim().slice(0, 200) || ('exit ' + r.code);
          }
        } catch (e) {
          error = String((e && e.message) || e).slice(0, 200);
        }
        if (ok) {
          ledger.items.push({
            point: item.point, key: item.key, scope: item.scope,
            before: item.before, after: item.after,
            at: now, writer: 'gh_identity.wire', revokedAt: null,
          });
        }
        results.push({ point: item.point, key: item.key, before: item.before, after: item.after, ok, error });
      }
      const wrote = results.some((r) => r.ok);
      if (wrote) {
        await writeJsonAtomic(WIRE_LEDGER_FILE, { schema: WIRE_LEDGER_SCHEMA, schemaVersion: 1, updatedAt: now, items: ledger.items });
        await writeJsonAtomic(WIRE_CONSENT_FILE, {
          schema: WIRE_CONSENT_SCHEMA, granted: true, at: now, fingerprint,
          items: changed.map((i) => i.key), tool: 'gh_identity',
        });
      }
      return {
        ok: results.every((r) => r.ok || !changed.includes(plan.find((i) => i.key === r.key))),
        action, consentRequired: false, wrote,
        plan: plan.map((i) => ({ ...i, changed: i.writable && i.before !== i.after })),
        results, ledger: wireLedgerView(ledger),
        consent: { required: false, grantedBy: grantedByCall ? 'call' : (grantedByRecord ? 'recorded-grant' : null), fingerprint },
        ask: null,
      };
    }

    // ---- unwire：按台账逐项还原（只撤「归一化后仍等于我们写的值」的项；判定见 judgeOwnership）----
    const active = ledger.items.filter((i) => !i.revokedAt && !i.abandonedAt);
    if (active.length > 0 && !grantedByCall) {
      return {
        ok: false, action, consentRequired: true, wrote: false, results: [],
        ledger: wireLedgerView(ledger),
        consent: { required: true, grantedBy: null, fingerprint },
        ask: {
          question: '是否同意撤销身份接线、把宿主还原成接线前的样子？共 ' + active.length + ' 项：'
            + active.map((i) => '「' + i.key + '」' + (i.after === null ? '(未设置)' : i.after) + ' → ' + (i.before === null ? '(删除该项)' : i.before)).join('；')
            + '。只还原本插件写过的、且现在去掉首尾空白/引号后仍是那个值的项；被别人改过的不动；'
            + '判不出来的（同一项被写成多行、或已经回到接线前的样子）一律跳过并如实报，不猜、不硬撤。',
          options: ['同意撤销', '先看台账（' + WIRE_LEDGER_FILE + '）', '不同意'],
          onAgree: 'gh_identity {action:"unwire", consent:true}',
          onDecline: '什么都不改；之后每次调用都会再问一次',
        },
      };
    }
    const restored = [];
    const nowIso = new Date().toISOString();
    let ledgerChanged = false;
    /** 三项回执共用的四个字段（哪一项 / 现在是什么值 / 我们写的是什么）—— 一处拼，别在三处手抄。 */
    const receiptBase = (entry, j) => ({ point: entry.point, key: entry.key, now: j.current, written: entry.after });
    for (const entry of active) {
      const j = await judgeOwnership(entry);
      if (j.own === null) {
        // 判不出来：一个字节都不写，台账里也不下结论（不猜是谁改的）—— 于是它仍是「未决」，
        // 下次 unwire 还会如实报出来。宁可反复报，也不替用户记一笔不实的账。
        restored.push({
          ...receiptBase(entry, j),
          verdict: 'undecidable', ok: false, skipped: true,
          why: (j.why || '判不出来') + '；本插件不替你决定，也不硬撤（下次 unwire 仍会如实报出来）',
        });
        continue;
      }
      if (j.own === false) {
        // 值已经被别人改过：我们撤不回「我们的值」（它不在了），也**不该**拿接线前的旧值去盖别人的新值。
        // 所以就地「放手」并记进台账 —— 这样它不会再被反复问起，历史也留着。
        entry.abandonedAt = nowIso;
        entry.abandonedBy = 'gh_identity.unwire';
        entry.abandonedWhy = '值被别人改过，不再由本插件管理';
        ledgerChanged = true;
        restored.push({ ...receiptBase(entry, j), verdict: 'abandoned', ok: false, skipped: true, why: j.why });
        continue;
      }
      let ok = false;
      let error = null;
      try {
        if (entry.point === 'path-landing') {
          await fs.rm(entry.key, { force: true });
          ok = true;
        } else if (entry.before === null) {
          const r = await gitGlobalUnset(entry.key);
          ok = r.code === 0;
          if (!ok) error = r.stderr.trim().slice(0, 200) || ('exit ' + r.code);
        } else {
          const r = await gitGlobalSet(entry.key, entry.before);
          ok = r.code === 0;
          if (!ok) error = r.stderr.trim().slice(0, 200) || ('exit ' + r.code);
        }
      } catch (e) {
        error = String((e && e.message) || e).slice(0, 200);
      }
      if (ok) {
        entry.revokedAt = nowIso;
        entry.revokedBy = 'gh_identity.unwire';
        ledgerChanged = true;
      }
      restored.push({
        ...receiptBase(entry, j),
        restored: entry.before, verdict: 'revoked', ok, skipped: false, error, why: j.why,
      });
    }
    const wrote = restored.some((r) => r.ok);
    // 只有**台账真的变了**才落盘（revoked / abandoned 两种；判不出来那种什么都没变）——
    // 与 wire 那一支「真的写了才落盘」同一个**习惯**（`if (wrote)`）：没改动就不写盘，
    // 也不动已记录的授权（计划没变，授权就还有效）。
    // 两处的 `wrote` 都指**宿主被写**：只记「放手」（abandoned）时台账会落盘，而 `wrote` 仍是 false ——
    // 那只是记账，不是把配置还回去了。
    if (ledgerChanged) {
      await writeJsonAtomic(WIRE_LEDGER_FILE, { schema: WIRE_LEDGER_SCHEMA, schemaVersion: 1, updatedAt: nowIso, items: ledger.items });
      await fs.rm(WIRE_CONSENT_FILE, { force: true });
    }
    return {
      ok: restored.every((r) => r.ok || r.skipped), action, consentRequired: false, wrote,
      results: restored, ledger: wireLedgerView(ledger),
      consent: { required: false, grantedBy: grantedByCall ? 'call' : null, fingerprint },
      ask: null,
    };
  }

  /**
   * 提交邮箱的**唯一写入口** —— 工具动作（`gh_identity {action:"email"}`）与面板的回环路由（`POST /identity/email`）
   * 都调它：校验只写一遍、落盘只走一处，面板不许再实现第二套（否则「唯一口径」立刻变两份）。
   *
   * 只写插件自己的 state（跟 token 同一份文件、0600），**不碰宿主**；把值接到宿主（全局 `user.email`）归 `wire`。
   * `raw` 为空 = 只读地报现状，一个字节都不写。返回值 `{ ok, email, effective, wrote, error }`：
   *   - `email` = state 里现在存着的值（null = 没填过）；`effective` = 现在接线会用到的那个值（见 commitEmail）。
   */
  async function applyCommitEmail(raw) {
    const state = await readState();
    const resolved = await resolveIdentity(state);
    const login = identityLogin(state, resolved);
    const current = typeof state.user_email === 'string' && state.user_email.trim() ? state.user_email.trim() : null;
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return { ok: true, email: current, effective: commitEmail(state, login), wrote: false, error: null };
    // 校验从严、拒绝得具体：邮箱不是凭据，但写进去的值会被拿去当 git 的 user.email，不能是换行/空白拼出来的串。
    if (value.length > 254 || /\s/.test(value) || !/^[^@\s]+@[^@\s]+$/.test(value)) {
      return {
        ok: false, email: current, effective: commitEmail(state, login), wrote: false,
        error: '不是有效的邮箱（不能有空白，形如 name@example.com，长度 ≤254）：' + value.slice(0, 60),
      };
    }
    const next = await writeState({ user_email: value });
    return { ok: true, email: value, effective: commitEmail(next, login), wrote: true, error: null };
  }

  /**
   * `action:"email"` —— 提交邮箱在**会话侧**的入口（票「登录后可选填提交邮箱（不填用隐私邮箱），wire 优先用它」）。
   *
   * 为什么它是独立的一个动作：填邮箱**不能要求用户重填 token**（`gh_resident_login` 的 `user_email` 参数挂在
   * 一个 token 必填的工具上，当不了填写入口）。它只写插件自己的 state —— 不动宿主上任何东西，所以**不需要同意**；
   * 把值接到宿主（全局 `user.email`）仍然归 `wire`，那一步照样要同意。
   *
   * 两种用法：
   *   - 带 `email` → 校验后写进 state（`email` 可回显：它不是凭据；token 依旧只出掩码）；
   *   - 不带 `email` → 只读地报「现在存的是什么 / 现在接线会用哪个」，一个字节都不写。
   *
   * 「不填」不是一个值：不调它就行 —— state 里不会多出任何字段，`wire` 走回退（登录名生成的隐私邮箱形式）。
   */
  async function identityEmailAction(args) {
    const r = await applyCommitEmail(typeof args.email === 'string' ? args.email : '');
    const note = r.wrote
      ? '已写进插件 state（0600，与 token 同一份文件，不是第二份凭据存储）。'
        + '要让 git 用它：跑 gh_identity {action:"wire"} —— 计划变了会重新问一次同意'
      : r.ok
        ? (r.email
          ? 'state 里现在存的就是它；要改就带 email 再调一次。接线是另一步：gh_identity {action:"wire"}（要同意）'
          : 'state 里还没存过提交邮箱；现在接线会用登录名生成的隐私邮箱形式。要填就带 email 再调一次')
        : null;
    return { action: 'email', stateFile: STATE_FILE, note, ...r };
  }

  // ---------- 身份体检（只读；票「新工具 gh_identity（只读体检 + 准确补救命令）」） ----------
  // 一次答完「我的身份是谁、四个消费点各接好没、缺什么、补的准确命令」。
  // 返回形状同时是《启动自述》与协议 identity 段的字段来源（一处定义、三处消费）—— 改字段属**接口变更**。
  // 只读且不联网：本地 git config 读取 + gh --version 探测；**不调 `gh auth status`**（那次会打网）。
  // 2026-10-14：写动作（wire / verify / unwire / email）落在**同一个工具**上（action 分发）—— 不带 action 时
  // 与从前逐字节一致；这些动作的机制见上面那一大段（email 只写插件自己的 state，不碰宿主，故不需要同意）。
  ctx.tools.register(textTool({
    toolName: 'gh_identity',
    description: 'Identity audit and wiring in one tool. Default (no action) is a READ-ONLY audit: who the identity is, whether each of the four consumption points is wired, what is missing, and the exact command that fixes it. Points: git (credential-helper in BOTH scopes + global git identity) / gh CLI credentials / subprocess environment / PATH landing. action:"wire" projects the truth source onto the host (github.com credential helper pointing at this plugin\'s own helper, global user.name/user.email, bundled gh on PATH only when none is runnable) and writes nothing without consent:true; action:"verify" reconciles the host against the ledger BY OWNERSHIP — the same judgement unwire acts on, reported and never acted on: each item gets state ours / not-ours / back-to-before / unknown (a value that differs only by surrounding whitespace or quotes still counts as ours and the note says so; the verbatim value and what we wrote are reported side by side), an item whose read is ambiguous (key written on several lines, or unreadable) is reported unknown rather than guessed, and the ledger state (revoked / abandoned) rides in a separate `retired` column so a retired item is still judged against the disk; action:"unwire" restores the pre-wire values item by item, judging each item AFTER normalizing (surrounding whitespace/quotes trimmed — a value that only differs by quoting is still reclaimed) and reporting one of three verdicts per item (revoked / abandoned / undecidable): items somebody else changed are let go, and items it cannot judge (written on several lines, or already back to the pre-wire value) are skipped and reported rather than force-restored; action:"email" writes ONLY the git commit email into the plugin state (a non-credential value; no consent needed because it touches nothing on the host — the email reaches the host only through "wire", which keeps its consent gate). It never writes gh\'s hosts.yml, never stores a second token, and makes no network calls.',
    parameters: {
      action: { type: 'string', enum: GH_IDENTITY_ACTIONS, description: 'audit (default, read-only) | wire (needs consent) | verify (read-only reconcile) | unwire (needs consent, restores pre-wire values) | email (writes ONLY the commit email into the plugin state; no consent needed, it touches nothing on the host).' },
      consent: { type: 'boolean', description: 'Set true only after the user explicitly agreed to the plan returned by the previous call. Without it, wire/unwire write nothing and return {consentRequired:true, ask:{...}}.' },
      targets: { type: 'array', items: { type: 'string' }, description: 'Optional subset of points to act on: git-helper / git-identity / gh-cli / path-landing. Defaults to all.' },
      email: { type: 'string', description: 'Only for action:"email": the git commit email to store in the plugin state (it replaces the login-derived GitHub privacy-email fallback that wire would otherwise write). Omit it to read back what is stored. It is not a credential and is echoed back; tokens stay masked.' },
    },
    readOnly: false,
    execute: async (args = {}) => {
      const action = String(args.action || 'audit');
      if (!GH_IDENTITY_ACTIONS.includes(action)) {
        return { ok: false, error: 'action 只支持 ' + GH_IDENTITY_ACTIONS.join(' / ') + '（缺省＝audit）' };
      }
      if (action === 'email') return await identityEmailAction(args);
      if (action !== 'audit') return await identityWireAction(action, args);
      const state = await readState();
      const identity = maskIdentity(await resolveIdentity(state));
      const rollup = (states) => states.every((s) => s === 'pass') ? 'pass'
        : states.every((s) => s === 'missing') ? 'missing' : 'drift';

      // ---- 消费点 1：git（凭据助手两个作用域 + 全局身份）----
      const helpers = await readCredHelpers();
      const credFileExists = await pathExists(CRED_FILE);
      const ghPathFromHelper = (String(helpers.hostScope || '').match(/^!\s*(\S+)\s+auth\s+git-credential/) || [])[1] || null;
      const hostHelperRunnable = ghPathFromHelper ? (await probeGh(ghPathFromHelper)).ok : false;
      const globalIsStore = /(^|\s)store(\s|$)/.test(helpers.global || '');
      const helperState = helpers.hostScope
        ? (hostHelperRunnable ? 'pass' : 'drift')
        : helpers.global
          ? (globalIsStore && !credFileExists ? 'drift' : 'pass')
          : 'missing';
      const helperFix = helperState === 'pass' ? null
        : helperState === 'drift'
          ? 'gh auth setup-git   # 现在这条接线不可用（' + (ghPathFromHelper && !hostHelperRunnable ? 'host 作用域的助手指向的 gh 跑不起来：' + ghPathFromHelper : '全局是 store 但 ~/.git-credentials 不存在') + '）'
          : 'gh auth setup-git   # 让 git 用 gh 的凭据（它写的是 host 作用域，全局为空是正常的）';
      const gitName = (await git(process.cwd(), ['config', '--global', 'user.name'])).stdout.trim();
      const gitEmail = (await git(process.cwd(), ['config', '--global', 'user.email'])).stdout.trim();
      const identityState = (gitName && gitEmail) ? 'pass' : (gitName || gitEmail) ? 'drift' : 'missing';
      const gitCheck = {
        name: 'credential-helper', state: helperState,
        detail: { global: helpers.global || null, hostScope: helpers.hostScope || null, effective: helpers.effective || null, gitCredentialsFile: credFileExists, hostHelperRunnable },
        fix: helperFix,
      };
      const identityCheck = {
        name: 'identity', state: identityState,
        detail: { user_name: gitName || null, user_email: gitEmail || null },
        fix: identityState === 'pass' ? null : 'git config --global user.name "<你的名字>" && git config --global user.email "<你的邮箱>"',
      };

      // ---- 消费点 2：gh CLI 的凭据（只读 hosts.yml；不调会打网的 gh auth status）----
      const hostsEntry = await readHostsEntry(GH_HOST);
      const hostsExists = await pathExists(HOSTS_FILE);
      const ghCliState = hostsEntry.token ? 'pass' : hostsExists ? 'drift' : 'missing';
      const ghCliCheck = {
        name: 'credentials', state: ghCliState,
        detail: { hostsFile: HOSTS_FILE, exists: hostsExists, login: hostsEntry.login || null, tokenMasked: mask(hostsEntry.token) },
        fix: ghCliState === 'pass' ? null : 'gh auth login   # 或走本插件工具 gh_cli_auth_web（设备码）',
      };

      // ---- 消费点 3：子进程环境（票「子进程环境…」之后，这一支**由插件自己供给**；只报「给不给 / 落没落」，不报值）----
      // 两件事都在这里如实报，别混成一件：
      //   ① 注入：本插件 fork 的 gh / git 子进程会**按需**戴上真源身份（gh 组 / git 组），不需要宿主做任何事；
      //   ② 覆盖：用户自己在 env 里放 GH_TOKEN/GITHUB_TOKEN 想盖过真源 —— 那是可选的一条路，不是必须。
      const envFacts = await identityEnvFacts();
      const envOverrideOn = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
      const envCheck = {
        name: 'override-token', state: envOverrideOn ? 'pass' : 'missing',
        detail: {
          GH_TOKEN: Boolean(process.env.GH_TOKEN), GITHUB_TOKEN: Boolean(process.env.GITHUB_TOKEN),
          injection: envFacts,
        },
        fix: envOverrideOn ? null : 'export GH_TOKEN=<token>   # 可选：只有想用环境变量覆盖真源时才需要',
      };

      // ---- 消费点 4：PATH 落点（解析层级 + 能否真跑）----
      const ghResolved = await resolveGh({ install: false });
      // 票 29：探测超时 = 未知。状态词表只有 pass/drift/missing 三个值（门禁与面板都按它渲染，不新造），
      // 所以超时归 drift（「有待确认」，不是「没有」），诚实性放在 detail.timedOut 与 verdict / fix 的文案里。
      const pathCheck = {
        name: 'landing',
        state: ghResolved.ok ? 'pass' : (ghResolved.timedOut ? 'drift' : 'missing'),
        detail: {
          resolved: ghResolved.ok ? ghResolved.layer : (ghResolved.timedOut ? 'unknown' : 'none'),
          path: ghResolved.path || null, version: ghResolved.version || null,
          runnable: Boolean(ghResolved.ok), timedOut: Boolean(ghResolved.timedOut),
        },
        fix: ghResolved.ok ? null
          : ghResolved.timedOut ? 'gh 探测超时（此刻未知）：稍后重试；确需一份自带副本，显式跑 gh_cli_install'
            : 'gh_cli_install   # 本插件工具：系统没有 gh 时落地一份自带副本',
      };

      const mkPoint = (point, checks, verdict) => ({ point, state: rollup(checks.map((c) => c.state)), verdict, checks });
      const points = [
        mkPoint('git', [gitCheck, identityCheck],
          (helperState === 'pass' ? '凭据助手已接线（' + (helpers.hostScope ? 'host 作用域' : '全局') + '）' : '凭据助手' + (helperState === 'drift' ? '接了但不可用' : '没有'))
          + '；全局 git 身份' + (identityState === 'pass' ? '已设' : identityState === 'drift' ? '只设了一半' : '为空')),
        mkPoint('gh-cli', [ghCliCheck],
          ghCliState === 'pass' ? 'hosts.yml 有凭据（login=' + (hostsEntry.login || '未知') + '）'
            : ghCliState === 'drift' ? 'hosts.yml 在但没有 oauth_token' : '没有 hosts.yml（gh CLI 未登录）'),
        mkPoint('env', [envCheck],
          (envCheck.state === 'pass' ? '有环境变量覆盖' : '没有环境变量覆盖（不是必须：身份可由 state 或 gh CLI 供给）')
          + '；子进程身份' + (envFacts.canInjectGh || envFacts.canInjectGit
            ? '由本插件按需供给（' + [envFacts.canInjectGh ? 'gh 组' : null, envFacts.canInjectGit ? 'git 组' : null].filter(Boolean).join(' + ')
              + '；助手' + (envFacts.helperLanded ? '已落盘' : '尚未落盘 —— 第一次真要 git 身份时落') + '）'
            : '暂无来源：真源里没有可注入的身份')),
        mkPoint('path', [pathCheck],
          ghResolved.ok ? 'gh 落在 ' + ghResolved.layer + ' 层：' + ghResolved.path
            : ghResolved.timedOut ? 'gh 探测超时（此刻未知）——不是「没装」，本插件也不会据此去下载'
              : '找不到能跑的 gh'),
      ];

      // ---- 配置面：指向不存在的目录今天会静默扫 0，这里明说 ----
      const reposRoot = (typeof state.reposRoot === 'string' && state.reposRoot) ? state.reposRoot : DEFAULT_ROOT;
      const reposRootExists = await pathExists(reposRoot);
      const config = {
        reposRoot: {
          path: reposRoot, exists: reposRootExists,
          fix: reposRootExists ? null : '把 reposRoot 指到真实目录（或调用时显式传 root）：现在指向的目录不存在，扫描会静默返回 0 个仓库',
        },
        stateFile: { path: STATE_FILE, exists: await pathExists(STATE_FILE) },
        hostsFile: { path: HOSTS_FILE, exists: hostsExists },
      };

      const allChecks = points.flatMap((p) => p.checks);
      const fixes = [...new Set([...allChecks.map((c) => c.fix), config.reposRoot.fix].filter(Boolean))];
      const summary = {
        pass: points.filter((p) => p.state === 'pass').length,
        drift: points.filter((p) => p.state === 'drift').length,
        missing: points.filter((p) => p.state === 'missing').length,
        fixes,
      };
      return { identity, points, config, summary };
    },
  }));

  // ---------- 环境能力矩阵（只读；票「新工具 gh_env_probe（环境能力矩阵）」） ----------
  // 一次调用报全「这台机器能不能干活」：gh 能否**真跑**、curl、node/arch、HOME 可写性、三路连通性、
  // 代理变量、环境入口目录。与 gh_identity 的分工：那边答「身份接好没」，这边答「机器行不行」——
  // **同一事实只报一处**（配置类路径 reposRoot / stateFile / hostsFile 的存在性在 gh_identity.config）。
  // **有界**：每个网络探测各自 4 秒上界、每个子进程探测 5 秒上界 —— 最坏情况也能返回，不出现「不退出」。
  // 只读：不写探针文件、不改配置（目录可写性用 fs.access(W_OK) 判，不落地试写）。
  /**
   * 重活租约（协议 `load` 段）：同一台机器上的全量门禁 / 合成环境矩阵一次只许一份。
   *
   * 为什么是个**工具**而不是只写一条文档：多会话并跑时，各自的 agent 看不见别人在跑重活 ——
   * 这个工具是那只能看见全局的眼睛；而 runner（`tests/merge/_load-lease.mjs`）自己也取同一份锁，
   * 所以「忘了问」也跑不成双份（拿不到就是 exit 2 + BLOCKED-LOAD-LEASE，不静默跳过）。
   */
  ctx.tools.register(textTool({
    toolName: 'gh_load_lease',
    description: 'Heavy-work lease for this machine. Heavy work — the full merge gate (npm run verify:merge) and the synthetic-environment matrix — must never run twice at once: concurrent heavy runs are what got the DSH host killed six times on this device. action:"status" (default, read-only) reports who holds the lease, for what, since when, when it expires and whether that pid is still alive; action:"acquire" succeeds only when nobody holds it, or the holder expired or died (a reclaim is reported, never silent); action:"release" only releases your own lease. When you cannot acquire it, the correct move is to come back later — not to run the heavy work anyway. The lease lives in the plugin own directory (0600, DSH_GH_LOAD_LEASE overrides the path); no host config, no network, no consent needed.',
    parameters: {
      action: { type: 'string', enum: ['status', 'acquire', 'release'], description: 'status (default, read-only) | acquire | release.' },
      holder: { type: 'string', description: 'Who is asking (free text, e.g. "verify:merge@session-b5c43c0f"). Defaults to "pid <n>"; release only accepts the matching holder.' },
      purpose: { type: 'string', description: 'What the heavy work is (free text; shown to whoever asks next).' },
      ttl_ms: { type: 'number', description: 'Lease lifetime in ms (default 30 min). A lease whose holder died or whose time is up can be reclaimed by the next caller.' },
    },
    readOnly: false,
    execute: async (args = {}) => {
      const action = String(args.action || 'status');
      if (!Object.prototype.hasOwnProperty.call(LOAD_LEASE_VIEWS, action)) {
        return { ok: false, action, error: 'action 只支持 status / acquire / release（缺省＝status）' };
      }
      if (action === 'status') {
        const cur = await readLoadLease();
        const view = leaseView(cur.lease);
        return {
          ok: true, action, held: Boolean(view), lease: view, file: cur.file, exists: cur.exists,
          note: view
            ? (view.stale ? '这把锁已经陈旧（持有人不在或已过期）：下一个来的人可以回收' : '正在跑重活：换时间，别无脑并跑')
            : '没有人在跑重活',
        };
      }
      if (action === 'acquire') {
        const r = await acquireLoadLease({
          holder: args.holder ? String(args.holder) : ('pid ' + process.pid),
          purpose: args.purpose ? String(args.purpose) : undefined,
          ttlMs: Number(args.ttl_ms),
        });
        const out = { ok: Boolean(r.ok), action, acquired: Boolean(r.acquired) };
        if (r.lease) out.lease = leaseView(r.lease);
        if (r.heldBy) out.heldBy = r.heldBy;
        if (r.reclaimed) out.reclaimed = r.reclaimed;
        if (r.error) out.error = r.error;
        out.note = r.ok
          ? (r.reclaimed ? '拿到了（并且回收了一把陈旧的）' : '拿到了')
          : (r.note || r.error || '没拿到');
        return out;
      }
      const r = await releaseLoadLease({ holder: args.holder ? String(args.holder) : undefined });
      const out = { ok: Boolean(r.ok), action, released: Boolean(r.released) };
      if (r.was) out.was = r.was;
      if (r.heldBy) out.heldBy = r.heldBy;
      out.note = r.ok ? (r.released ? '放了' : r.note) : r.note;
      return out;
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_env_probe',
    description: 'Read-only environment capability matrix: in one call it reports whether gh can really run (path, layer, version), whether curl exists, node version, arch/platform, HOME writability, reachability of the three network routes the plugin depends on (REST API / codeload / release CDN), which proxy variables are set (presence only, values are never echoed), and whether the environment input directories exist and are writable. Every non-ok item carries the exact next step. Reachability is treated as inherently random (China/VPN routes): each route is tried several times (default 3, override with `attempts`) over two channels — Node fetch and the system curl, since only curl honours HTTP(S)_PROXY — and the receipt reports successes, success rate, redirect landing and the channel that worked, never a bare yes/no. Bounded: 4s per fetch attempt, 15s total network budget, 8s curl ceiling, 5s per subprocess probe, so it always returns.',
    parameters: {
      network_targets: {
        type: 'array',
        description: 'Override the reachability targets (each {name,url}) — used by hermetic gates to point the probes at a local stub. Omit to probe the three canonical routes.',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, url: { type: 'string' } },
          required: ['name', 'url'],
        },
      },
      attempts: {
        type: 'number',
        description: 'How many times to try each route on the fetch channel (default 3, clamped 1..5). Reachability is treated as random, so more attempts give a truer picture.',
      },
      timeout_ms: {
        type: 'number',
        description: 'Per-attempt ceiling in ms (default 4000, clamped 500..15000). The total network budget stays 15000ms regardless.',
      },
    },
    readOnly: true,
    execute: async (args) => {
      const startedAt = Date.now();
      // 单次上界可调（慢链路/挂代理时可以把单次放宽），但整体预算固定 —— 上界可调不等于无界。
      const NET_TIMEOUT_MS = Math.min(15000, Math.max(500, Number(args && args.timeout_ms) || 4000));
      const CURL_TIMEOUT_MS = Math.min(8000, NET_TIMEOUT_MS * 2);
      const PROC_TIMEOUT_MS = 5000;
      const DEFAULT_TARGETS = [
        { name: 'api', url: 'https://api.github.com/', what: 'REST API（gh api / 权限预检走这里）；用根路径，因为端点自身未必支持 HEAD' },
        { name: 'codeload', url: 'https://codeload.github.com/', what: '源码归档下载（tarball / clone 走这里）' },
        { name: 'release-cdn', url: 'https://objects.githubusercontent.com/', what: 'Release 资产 CDN（自带 gh 落地走这里）；只测主机可达，不是完整下载' },
      ];
      const custom = Array.isArray(args && args.network_targets)
        ? args.network_targets.filter((t) => t && t.url)
        : [];
      const targets = custom.length
        ? custom.map((t) => ({ name: String(t.name || 'custom'), url: String(t.url), what: '调用方指定的目标' }))
        : DEFAULT_TARGETS;

      const items = [];   // 统一形状：{ name, state: ok|degraded|missing, detail, next }

      // ---- 能力 ----
      const gh = await resolveGh({ install: false });
      const ghProbe = (gh.ok && gh.path) ? await probeGh(gh.path, { fresh: true, timeoutMs: PROC_TIMEOUT_MS }) : { ok: false, version: null };
      // 票 29：探测超时归 degraded（「待确认」），不归 missing（那是「确认没有」）；next 也不许劝人去重新落地。
      const ghTimedOut = Boolean(gh.timedOut);
      items.push({
        name: 'gh',
        state: (gh.ok && ghProbe.ok) ? 'ok' : (gh.ok || ghTimedOut) ? 'degraded' : 'missing',
        detail: { layer: gh.ok ? gh.layer : 'none', path: gh.path || null, runnable: Boolean(ghProbe.ok), version: ghProbe.version || null, timedOut: ghTimedOut },
        next: (gh.ok && ghProbe.ok) ? null
          : ghTimedOut ? 'gh 探测超时（此刻未知）：稍后重试即可（本插件不会在超时时去下载）；要显式落地就 gh_cli_install'
            : gh.ok ? '解析到了 gh（' + gh.path + '）但它跑不起来：多半是架构不符或缺动态库 —— 跑 gh_cli_install {force:true} 重落地'
              : '跑 gh_cli_install（本插件工具）落地一份自带 gh；或装系统 gh 后重试',
      });
      const curlPath = await whichCmd('curl', PROC_TIMEOUT_MS);
      items.push({
        name: 'curl', state: curlPath ? 'ok' : 'missing', detail: { path: curlPath || null },
        next: curlPath ? null : '装 curl；或依赖插件的 fetch 兜底路径（能跑，但大文件更慢）',
      });
      items.push({ name: 'node', state: 'ok', detail: { version: process.version, execPath: process.execPath }, next: null });
      items.push({ name: 'arch', state: 'ok', detail: { arch: process.arch, platform: process.platform }, next: null });
      const homeWritable = await canWriteDir(HOME);
      items.push({
        name: 'home-writable', state: homeWritable ? 'ok' : 'degraded', detail: { path: HOME, writable: homeWritable },
        next: homeWritable ? null : 'HOME 不可写（或不存在）：插件要往 ~/.dsh 写 state / 缓存 / 日志 —— 换一个可写的 HOME，或修权限',
      });

      // ---- 网络：三路连通性（**冗余 + 双通道 + 上界**） ----
      // 前提（2026-10-14 维护者给的域知识 + 本机实测）：到 GitHub 的可达性**本身就随机** ——
      // 国内链路、VPN 抖动是常态，「测一次不通」不代表不能用。所以：
      //   ① 冗余：每路多次尝试，如实报成功次数与成功率，**不做二元判断**；时通时不通就是 degraded；
      //   ② 重定向：跟随（真链路上 github.com 的下载会 302 到 CDN；不跟就测不到真实通路），并报出最终落点；
      //   ③ 双通道：Node fetch 与系统 curl 各自尝试 —— **fetch 不读 HTTP(S)_PROXY，curl 读**，
      //      所以 VPN/代理环境下「fetch 不通、curl 通」是常态，分开报才不会把能干活冤枉成不能。
      const attemptsWanted = Math.min(5, Math.max(1, Number(args && args.attempts) || 3));
      const net = [];
      const netBudgetMs = 15000;
      const netStartedAt = Date.now();
      const budgetLeft = () => Math.max(0, netBudgetMs - (Date.now() - netStartedAt));
      for (const t of targets) {
        const t0 = Date.now();
        const rec = { attempts: 0, okCount: 0, firstOkMs: null, httpCode: null, redirects: false, finalUrl: null, error: null };
        // 通道一：Node fetch（插件自己的 REST 工具走它）
        for (let i = 0; i < attemptsWanted; i += 1) {
          const budget = Math.min(NET_TIMEOUT_MS, budgetLeft());
          if (budget <= 0) { rec.error = 'budget-exhausted（网络总预算 ' + netBudgetMs + 'ms 用完）'; break; }
          rec.attempts += 1;
          const a0 = Date.now();
          try {
            const res = await fetch(t.url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(budget) });
            rec.okCount += 1;
            if (rec.firstOkMs === null) rec.firstOkMs = Date.now() - a0;
            rec.httpCode = res.status;
            if (res.redirected) { rec.redirects = true; rec.finalUrl = res.url; }
          } catch (e) {
            const msg = String((e && (e.message || e.name)) || e);
            rec.error = /abort|timeout/i.test(msg) ? 'timeout（单次上界 ' + NET_TIMEOUT_MS + 'ms）' : msg.slice(0, 120);
          }
        }
        // 通道二：系统 curl（读 HTTP(S)_PROXY + 自己的 DNS/TLS 栈；VPN 环境下常常只有它通）
        let curl = null;
        if (rec.okCount < attemptsWanted) {
          const budget = Math.min(CURL_TIMEOUT_MS, budgetLeft());
          if (budget > 0) {
            const c0 = Date.now();
            // `--max-time` 用**小数秒**（curl 支持）：取整到整秒会让 1200ms 的预算实际变成 2s。
            const r = await run('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-I', '--max-time', (budget / 1000).toFixed(2), t.url], { timeout: budget + 800, killSignal: 'SIGKILL' });
            const code = Number(String(r.stdout).trim().split('\n').pop()) || 0;
            curl = {
              ok: r.code === 0 && code > 0,
              httpCode: code || null,
              ms: Date.now() - c0,
              viaProxyEnv: Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy),
              ...(r.code !== 0 && r.stderr ? { error: String(r.stderr).trim().slice(0, 120) } : {}),
            };
          } else {
            curl = { ok: false, httpCode: null, ms: 0, viaProxyEnv: false, error: 'budget-exhausted' };
          }
        }
        const rate = rec.attempts ? rec.okCount / rec.attempts : 0;
        const state = rec.okCount === attemptsWanted ? 'ok' : (rec.okCount > 0 || (curl && curl.ok)) ? 'degraded' : 'missing';
        const next = state === 'ok' ? null
          : rec.okCount > 0
            ? '时通时不通（' + rec.okCount + '/' + rec.attempts + ' 次成功）：国内链路 / VPN 抖动下这是常态 —— 关键动作失败就重试；要稳定就把 HTTPS_PROXY 配上'
            : (curl && curl.ok)
              ? '插件自己的 fetch 通道不通，但系统 curl 通（curl 读 HTTP(S)_PROXY，Node fetch 不读）—— 设 HTTPS_PROXY 让 fetch 也走代理，或让关键动作走 curl 通道'
              : '这台机器到「' + t.name + '」不通（' + rec.attempts + ' 次都没成）：依赖它的动作会失败（' + t.what + '）—— 换网络 / 配代理（HTTPS_PROXY），或先只用不需要它的功能';
        net.push({
          name: t.name, url: t.url, what: t.what, state,
          detail: {
            via: rec.okCount > 0 ? 'fetch' : (curl && curl.ok ? 'curl' : null),
            attempts: rec.attempts, okCount: rec.okCount, successRate: rate,
            httpCode: rec.httpCode,
            // ms = 这一路**总耗时**（全部失败时也要有值 —— 「卡了多久」正是失败时最该看的数）；
            // firstOkMs = 首次成功的那次延迟（全失败时为 null）。
            ms: Date.now() - t0, firstOkMs: rec.firstOkMs,
            redirects: rec.redirects, finalUrl: rec.finalUrl,
            boundMs: NET_TIMEOUT_MS, budgetMs: netBudgetMs,
            ...(curl ? { curl } : {}),
            ...(rec.error ? { error: rec.error } : {}),
          },
          next,
        });
      }

      // ---- 代理变量：**只报有无**（值里可能带凭据，一律不回显） ----
      const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
      const proxy = {};
      for (const k of proxyKeys) proxy[k] = Boolean(process.env[k]);

      // ---- 环境入口目录（配置类路径不在这里，见 notes） ----
      const dirs = [];
      for (const [label, p] of [['home', HOME], ['cwd', process.cwd()], ['data-dir', GH_DATA_DIR], ['tmp', os.tmpdir()]]) {
        const exists = await pathExists(p);
        const writable = exists ? await canWriteDir(p) : false;
        dirs.push({
          name: label, path: p, exists, writable,
          next: !exists
            ? '目录不存在：确认这个路径（配置或环境变量）指的是不是真地方 —— 指向不存在的目录时，扫描与落地都会静默落空'
            : writable ? null : '目录在但不可写：落地 / 缓存会失败 —— 修权限或换路径',
        });
      }

      const flat = items.concat(net.map((n) => ({ name: 'net:' + n.name, state: n.state, next: n.next })));
      return {
        capabilities: items,
        network: net,
        proxy,
        dirs,
        summary: {
          ok: flat.filter((i) => i.state === 'ok').length,
          degraded: flat.filter((i) => i.state === 'degraded').length,
          missing: flat.filter((i) => i.state === 'missing').length,
          next: [...new Set(flat.map((i) => i.next).concat(dirs.map((d) => d.next)).filter(Boolean))],
        },
        bounds: { networkMs: NET_TIMEOUT_MS, networkTotalMs: netBudgetMs, curlMs: CURL_TIMEOUT_MS, attempts: attemptsWanted, processMs: PROC_TIMEOUT_MS, elapsedMs: Date.now() - startedAt, targets: targets.length },
        notes: [
          '代理变量只报有无，不回显值（值里可能带凭据）',
          '同一事实只报一处：配置类路径（reposRoot / stateFile / hostsFile）的存在性在 gh_identity.config',
          '网络探测是 HEAD 可达性判断，任何 HTTP 状态码都算「通」；不代表某个具体资产能下载',
          '可达性按**随机**对待：每路多次尝试（默认 3 次，可传 attempts 覆盖），回执报成功次数/成功率/最终落点，不做二元判断',
          '双通道：先 Node fetch（不读 HTTP(S)_PROXY），再系统 curl（读代理）；只有 curl 通 = degraded，不是 missing',
        ],
      };
    },
  }));

  ctx.tools.register(textTool({
    toolName: 'gh_protocol',
    description: 'Return the machine-readable protocol of this plugin: protocol version, the Host Service surface other plugins may call, the loopback HTTP endpoints, the tool catalogue with declared inputs and returns, the result envelope, and the error-code table. Read this before driving this plugin from another plugin or script.',
    parameters: {},
    readOnly: true,
    execute: async () => PROTOCOL,
  }));

  // ---------- 本机回环 API：让设置页能真正生成并显示一次性码 ----------
  // 设置页（浏览器）与插件（node）是两个进程，没有现成的数据通道；
  // 这里在 127.0.0.1 上开一个小接口，浏览器直连取状态与一次性码。
  // 只监听回环、只回状态与一次性码，任何 token 都不出现在响应里。
  // （API_PORT / API_ORIGIN 两行已提到上面协议定义之前 —— 协议里的 http.base 要报真实端口。）
  let lastFlow = null;
  let lastServerError = null;

  /** 请求自带的浏览器来源头（Origin 优先，退回 Referer）。 */
  function pageOriginOf(req) {
    return String((req && req.headers && (req.headers.origin || req.headers.referer)) || '');
  }

  /** 只有回环来源算「本机页面」（设置页）；其余一律不给 CORS，也不放行写路由（审计 L4）。 */
  function originAllowed(req) {
    try {
      const u = new URL(pageOriginOf(req));
      return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1' || u.hostname === '[::1]';
    } catch {
      return false;
    }
  }

  /** 写路由统一闸门：缺来源头 = 机器调用，只回错，不改任何东西。 */
  function originGate(res, req, action, code) {
    if (originAllowed(req)) return false;
    sendJson(res, 200, {
      ok: false,
      action,
      error: (code || 'E_ORIGIN') + '：这条路由只接受带本机页面来源头（Origin/Referer）的请求',
      hint: '机器调用请走 gh_* 工具：需要同意时工具先回 ask，由模型把问题交给用户',
    }, req);
    return true;
  }

  function sendJson(res, code, body, req) {
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'cache-control': 'no-store',
    };
    // 原来恒发 ACAO:* —— 任意网页都能读本机状态（审计 L4）。改成只回环来源回显。
    if (originAllowed(req)) {
      headers['access-control-allow-origin'] = pageOriginOf(req);
      headers.vary = 'Origin';
    }
    res.writeHead(code, headers);
    res.end(code === 204 ? undefined : JSON.stringify(body));
  }

  // ---------- 版本自更新 ----------
  // 更新只换「插件自带的那份」；系统层 gh 是宿主的东西，只报告不动它（要动就卸载系统包）。

  /** 版本串形如 "gh version 2.102.0 (2026-09-30)" → 取中间三个数字。 */
  function parseGhVersion(line) {
    const m = String(line || '').match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? { raw: m[0], parts: [Number(m[1]), Number(m[2]), Number(m[3])] } : null;
  }

  function newerThan(a, b) {
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
      if (a.parts[i] > b.parts[i]) return true;
      if (a.parts[i] < b.parts[i]) return false;
    }
    return false;
  }

  const UPDATE_TTL_MS = Number(process.env.DSH_GH_UPDATE_TTL_MS || 24 * 3600 * 1000);
  const VERSION_PROBE_TTL_MS = Number(process.env.DSH_GH_VERSION_PROBE_TTL_MS || 30 * 60 * 1000);
  let latestCache = null;
  let versionState = null;
  let lastAutoUpdate = null;
  let lastGc = null;

  /** 查最新版本；结果带 TTL 缓存，设置页反复刷新也只打一次 API。 */
  async function latestRelease({ force = false } = {}) {
    if (!force && latestCache && Date.now() - latestCache.at < VERSION_PROBE_TTL_MS) return latestCache;
    try {
      const meta = await releaseMeta();
      latestCache = { at: Date.now(), tag: meta.tag_name, version: parseGhVersion(meta.tag_name) };
    } catch (e) {
      latestCache = { at: Date.now(), error: String(e).slice(0, 200) };
    }
    return latestCache;
  }

  /**
   * 当前 gh 的版本状态。**非 force 且已有缓存时纯内存返回**，绝不 fork 任何子进程；
   * 没有缓存时才真查一次（并把结果缓存起来）。加载期由 scheduleVersionWork() 预热。
   */
  async function versionStatus({ force = false } = {}) {
    // 读路径永不 fork 子进程：有状态就先回状态，过期只在**后台**回源（审计 L2：
    // 原来第二条 if 让 TTL 永不生效，长驻进程里 latest 会永久停在首次探测结果）。
    if (!force && versionState) {
      if (Date.now() - versionState.at >= VERSION_PROBE_TTL_MS) refreshVersionState().catch(() => {});
      return versionState;
    }
    return refreshVersionState({ force });
  }

  let versionRefresh = null;

  /** 真正回源查一次版本状态；并发调用共享同一次探测。 */
  async function refreshVersionState({ force = false } = {}) {
    if (versionRefresh) return versionRefresh;
    versionRefresh = (async () => {
    const g = await resolveGh({ install: false });
    const cur = g.ok ? parseGhVersion(g.version) : null;
    const latest = await latestRelease({ force });
    const latestVer = latest.version || parseGhVersion(latest.tag);
    versionState = {
      at: Date.now(),
      current: cur ? cur.raw : null,
      // 票 29：探测超时时 layer 报 'unknown'（不是 'none' —— 那会被读成「没有 gh」）。
      layer: g.ok ? g.layer : (g.timedOut ? 'unknown' : 'none'),
      latest: latestVer ? latestVer.raw : null,
      updateAvailable: Boolean(cur && latestVer && newerThan(latestVer, cur)),
      checkedAt: new Date().toISOString(),
      ttlMs: VERSION_PROBE_TTL_MS,
      ...(g.timedOut ? { timedOut: true, note: g.note } : {}),
      ...(latest.error ? { error: latest.error } : {}),
      ...(lastAutoUpdate ? { lastUpdate: lastAutoUpdate } : {}),
    };
    return versionState;
    })().finally(() => { versionRefresh = null; });
    return versionRefresh;
  }

  /** 自更新：只换插件自带的那份；系统层只报告。 */
  async function autoUpdate({ force = false } = {}) {
    const st = await versionStatus({ force: true });
    if (!st.updateAvailable) {
      return { ok: true, updated: false, reason: 'already-latest', current: st.current, latest: st.latest };
    }
    if (st.layer === 'system') {
      return {
        ok: true, updated: false, reason: 'system-layer-managed-externally',
        current: st.current, latest: st.latest,
        hint: '系统层由宿主包管理器管；要改走插件自带层，先 gh_cli_logout {uninstall_gh:true}',
      };
    }
    const before = st.current;
    const res = await ensureGh({ force: true });
    // 直接探盘上的二进制，别信缓存：文件系统 mtime 粒度会让「刚写」看起来还没变。
    const probed = await probeGh(GH_BIN, { fresh: true });
    const after = probed.version ? (parseGhVersion(probed.version) || {}).raw : null;
    lastAutoUpdate = {
      at: new Date().toISOString(), from: before, to: after,
      updated: Boolean(res.ok && after) && after !== before, layer: res.layer, attempts: res.attempts,
    };
    versionState = null;
    versionState = await versionStatus({ force: false });
    ghMemo = null;
    sysMemoPending = true;   // 自更新换过二进制，下次读路径重探
    sysProbedAt = 0;
    return { ok: Boolean(res.ok && after), ...lastAutoUpdate };
  }

  /** 到点就在后台自更新；失败不影响任何前台调用。 */
  function scheduleAutoUpdate() {
    // DSH_GH_NO_STATE_CHECK=1 表示「加载期不做任何检查」（测试与纯离线部署用）。
    if (process.env.DSH_GH_NO_STATE_CHECK === '1') return;
    versionStatus({ force: true }).catch(() => {});   // 预热版本状态，之后读它不再出网
    if (process.env.DSH_GH_NO_UPDATE === '1') return;
    versionStatus({ install: false })
      .then(async (st) => {
        if (!st.updateAvailable) return null;
        const cooled = lastAutoUpdate && Date.now() - Date.parse(lastAutoUpdate.at) < UPDATE_TTL_MS;
        if (cooled) return null;
        return autoUpdate({});
      })
      .catch(() => { /* 自更新失败只是少一次升级，诊断留在 versionState.lastUpdate */ });
  }

  // ---------- 落地缓存 GC ----------
  // 只清插件自己的数据目录：残留下载包、解包临时目录、超出保留份数的旧二进制。
  async function gcCache(opts = {}) {
    // 与落地互斥：清残留不能和正在下载的文件撞上（否则会把刚下好的包删掉）。
    if (gcInFlight) return gcInFlight;
    gcInFlight = gcCacheOnce(opts).finally(() => { gcInFlight = null; });
    return gcInFlight;
  }

  let gcInFlight = null;

  async function gcCacheOnce({ dry_run: dryRun = false, keep_versions: keepVersions = 2 } = {}) {
    // 下限 1：keep_versions:0 原本走 slice(0) 会删光所有版本目录（审计 L7）。
    keepVersions = Math.max(1, Number.isInteger(keepVersions) ? keepVersions : 2);
    const removed = [];
    const kept = [];
    const sizeOf = async (p) => { try { const s = await fs.stat(p); return s.isDirectory() ? 0 : s.size; } catch { return 0; } };
    let names = [];
    try { names = await fs.readdir(GH_DATA_DIR); } catch {
      return { ok: true, dryRun, dir: GH_DATA_DIR, removed: [], removedCount: 0, freedBytes: 0, kept: [], note: '缓存目录不存在' };
    }
    for (const name of names) {
      if (name === 'bin' || name === 'install.json' || name === 'gc.json') { kept.push(name); continue; }
      const p = path.join(GH_DATA_DIR, name);
      const isLeftover = /^gh_.*\.(tar\.gz|deb)$/.test(name);
      const isExtractDir = name === 'deb-extract';
      const isVersionDir = name === 'versions';
      if (!isLeftover && !isExtractDir && !isVersionDir) { kept.push(name); continue; }
      if (isVersionDir) continue; // 单独处理
      const bytes = await sizeOf(p);
      if (dryRun) { removed.push({ name, bytes, why: isExtractDir ? '解包临时目录' : '下载残留' }); continue; }
      await fs.rm(p, { recursive: true, force: true });
      removed.push({ name, bytes, why: isExtractDir ? '解包临时目录' : '下载残留' });
    }
    let versions = [];
    try { versions = (await fs.readdir(path.join(GH_DATA_DIR, 'versions'))).sort().reverse(); } catch { versions = []; }
    for (const v of versions.slice(Math.max(0, Number(keepVersions) || 0))) {
      const p = path.join(GH_DATA_DIR, 'versions', v);
      const bytes = await sizeOf(p);
      if (dryRun) { removed.push({ name: 'versions/' + v, bytes, why: '超出保留份数' }); continue; }
      await fs.rm(p, { recursive: true, force: true });
      removed.push({ name: 'versions/' + v, bytes, why: '超出保留份数' });
    }
    const freedBytes = removed.reduce((n, f) => n + (f.bytes || 0), 0);
    const out = { ok: true, dryRun, dir: GH_DATA_DIR, removed, removedCount: removed.length, freedBytes, kept, keptVersions: versions.slice(0, Number(keepVersions) || 0) };
    if (!dryRun) {
      lastGc = { at: new Date().toISOString(), removedCount: out.removedCount, freedBytes };
      await fs.writeFile(path.join(GH_DATA_DIR, 'gc.json'), JSON.stringify(lastGc, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
    }
    return out;
  }

  // ---------- 账号状态：背景提交 + 快照缓存 ----------
  // 默认读取只回快照（毫秒级）；刷新在后台跑，调用方不会被 gh 子进程拖住。
  const SNAPSHOT_TTL_MS = Number(process.env.DSH_GH_SNAPSHOT_TTL_MS || 90 * 1000);
  const SNAPSHOT_RETRY_MS = Number(process.env.DSH_GH_SNAPSHOT_RETRY_MS || 20 * 1000);
  let snapshot = null;
  let snapshotInFlight = null;
  let snapshotTriedAt = 0;
  let lastSnapshotError = null;
  // 检查阶段：idle 未跑过 / running 进行中 / ready 有结论 / failed 失败 / disabled 被开关关掉
  //（N4：面板得能分清「进行中」与「从未启动」）
  let snapshotProbe = { state: 'idle', at: null, error: null };

  async function buildSnapshot() {
    const state = await readState();
    const g = await resolveGh({ install: false });
    let authenticated = false;
    let account = null;
    if (g.ok) {
      // **不戴工牌**：面板那格「宿主 gh 登录态」要如实；插件自己的身份由消费面与体检回答。
      const st = await run(g.path, ['auth', 'status', '--hostname', 'github.com']);
      authenticated = st.code === 0;
      if (authenticated) {
        const who = await run(g.path, ['api', 'user', '--jq', '.login']);
        if (who.code === 0 && who.stdout.trim()) account = who.stdout.trim();
      }
    }
    return {
      gh: { installed: g.ok, version: g.ok ? g.version : null, layer: g.layer, path: g.path, willAutoLand: !g.ok },
      authenticated,
      account,
      // 提交邮箱（票「面板的提交邮箱入口：已授权但没填过时给一次填写机会」）：面板据此决定要不要给填写入口。
      // **规则只写在这里** —— 已授权 ＋ 没填过 ＋ 没问过 三条的唯一判定处，面板不自己算一遍（离线可验）。
      // `stored` 是普通值（邮箱不是凭据，可回显）；`asked` 就是 tool 那次询问的记账（没填才算数，见票 28）。
      commitEmail: {
        stored: typeof state.user_email === 'string' && state.user_email.trim() ? state.user_email.trim() : null,
        asked: Boolean(typeof state.emailAskedAt === 'string' && state.emailAskedAt),
        offer: authenticated && Boolean(account)
          && !(typeof state.user_email === 'string' && state.user_email.trim())
          && !(typeof state.emailAskedAt === 'string' && state.emailAskedAt),
      },
      hostsPath: HOSTS_FILE,
      stateFile: STATE_FILE,
      // gh auth setup-git 写的是 host 作用域的 helper（credential.https://github.com.helper），
      // 只读全局 credential.helper 永远是空，所以走 readCredHelper() 两个作用域都读。
      credHelper: (await readCredHelper()) || null,
      reposRoot: state.reposRoot || DEFAULT_ROOT,
    };
  }

  function refreshSnapshot(force = false) {
    if (!force && snapshot && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) return Promise.resolve(snapshot.data);
    if (snapshotInFlight && !force) return snapshotInFlight;
    snapshotTriedAt = Date.now();
    snapshotProbe = { state: 'running', at: new Date().toISOString(), error: null };
    snapshotInFlight = buildSnapshot()
      .then((data) => {
        snapshot = { at: Date.now(), data };
        snapshotProbe = { state: 'ready', at: new Date().toISOString(), error: null };
        return data;
      })
      .catch((e) => {
        const error = String(e).slice(0, 300);
        lastSnapshotError = { at: new Date().toISOString(), error };
        snapshotProbe = { state: 'failed', at: new Date().toISOString(), error };
        return snapshot ? snapshot.data : null;
      })
      .finally(() => { snapshotInFlight = null; });
    return snapshotInFlight;
  }

  /**
   * 快照过期就在这里补一次**后台**检查（N2：原来 readSnapshot 只看「有没有快照」，
   * 不看 age，`SNAPSHOT_TTL_MS` 因此形同虚设，快照一旦建立就永不更新）。
   * 失败后按 SNAPSHOT_RETRY_MS 退避（N3：这两个量原本声明了却没人用）。
   */
  function maybeRefreshStale() {
    if (snapshotInFlight) return;
    if (snapshot && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) return;
    if (snapshotProbe.state === 'failed' && snapshotTriedAt && Date.now() - snapshotTriedAt < SNAPSHOT_RETRY_MS) return;
    refreshSnapshot(true).catch(() => {});
  }

  /** 回执里的检查阶段（面板据此如实显示，不再把「没跑」显示成「正在跑」）。 */
  function probeView() {
    return {
      state: snapshotProbe.state,
      at: snapshotProbe.at,
      error: snapshotProbe.error,
      inFlight: Boolean(snapshotInFlight),
      ttlMs: SNAPSHOT_TTL_MS,
      retryMs: SNAPSHOT_RETRY_MS,
      disabled: process.env.DSH_GH_NO_STATE_CHECK === '1',
      snapshotAt: snapshot ? new Date(snapshot.at).toISOString() : null,
      snapshotAgeMs: snapshot ? Date.now() - snapshot.at : null,
    };
  }

  /** 读取入口：有快照立刻回；过期就后台刷，不等它。 */
  /**
   * 读取入口。**纯读**：只回缓存里的快照，绝不触发任何检查。
   *  - 检查发生在两处：插件加载时后台起一次；显式 refresh:true（UI 的「立即刷新」）。
   *  - 没有快照时回骨架（probing:true），UI 照实显示，等后台那次检查落盘。
   */
  async function readSnapshot({ refresh = false, peek = false } = {}) {
    if (refresh) return refreshSnapshot(true);
    if (peek) return snapshot ? { data: snapshot.data, at: snapshot.at } : { data: null, at: null };
    if (snapshot) {
      maybeRefreshStale();   // 过期就后台补，读路径照样不阻塞（N2）
      return snapshot.data;
    }
    return {
      gh: { installed: null, version: null, layer: 'checking', path: null, willAutoLand: null },
      authenticated: null, account: null,
      hostsPath: HOSTS_FILE, stateFile: STATE_FILE, credHelper: null,
      reposRoot: (await readState()).reposRoot || DEFAULT_ROOT,
      probing: true,
    };
  }

  /** 设置页首屏只要缓存，不进任何子进程。 */
  async function peekSnapshot() {
    const { data, at } = await readSnapshot({ peek: true });
    const probe = probeView();
    return data
      ? { ...data, snapshotAt: new Date(at).toISOString(), snapshotAgeMs: Date.now() - at, cached: true, probe }
      : { cached: false, probing: true, probe, gh: { installed: null, version: null, layer: 'checking', path: null }, authenticated: null, account: null };
  }

  /**
   * 对外状态：快照 + 版本 + 更新意图 + 最近 GC。
   * 默认走快照（毫秒级）；refresh:true 才同步重建（设置面板的「立即刷新」用它）。
   */
  async function statePayload(opts = {}) {
    const base = (await readSnapshot(opts)) || {};
    if (opts.cached === true && !opts.refresh) {
      const peeked = await peekSnapshot();
      return { ...peeked, lastFlow, updates: versionState, ...(lastGc ? { lastGc } : {}), cached: peeked.cached === true, probe: peeked.probe || probeView() };
    }
    const updates = await versionStatus().catch(() => null);
    return {
      ...base,
      lastFlow,
      updates,
      cached: Boolean(snapshot),
      ...(lastGc ? { lastGc } : {}),
      ...(lastEnsure ? { lastEnsure: { ok: lastEnsure.ok, pending: lastEnsure.pending === true, layer: lastEnsure.layer } } : {}),
      snapshotAt: snapshot ? new Date(snapshot.at).toISOString() : null,
      snapshotAgeMs: snapshot ? Date.now() - snapshot.at : null,
      ...(lastSnapshotError ? { snapshotError: lastSnapshotError } : {}),
      snapshotTtlMs: SNAPSHOT_TTL_MS,
      probe: probeView(),
    };
  }

  async function startLoopbackServer(port) {
    const http = await import('node:http');
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', API_ORIGIN);
        const send = (code, body) => sendJson(res, code, body, req);
        if (req.method === 'OPTIONS') {
          send(204, {});
          return;
        }
        if (url.pathname === '/state') {
          // ?refresh=1 才同步重建；?cached=1 只回缓存（首屏用），默认同样只读快照。
          const snap = await statePayload({
            refresh: url.searchParams.get('refresh') === '1',
            cached: url.searchParams.get('cached') === '1',
          });
          // 面板连的是 31790；端口被占时这里能看出「服务没起来」（审计 L4/L5）。
          send(200, { ...snap, apiPort: API_PORT, ...(lastServerError ? { serverError: lastServerError } : {}) });
          return;
        }
        if (url.pathname === '/gh/version') {
          send(200, await versionStatus({ force: url.searchParams.get('force') === '1' }));
          return;
        }
        if (url.pathname === '/gh/update' && req.method === 'POST') {
          if (originGate(res, req, 'gh-update')) return;
          send(200, await autoUpdate({ force: url.searchParams.get('force') === '1' }));
          return;
        }
        if (url.pathname === '/protocol') {
          send(200, PROTOCOL);
          return;
        }
        if (url.pathname === '/registry') {
          send(200, await registryAction({ action: 'status' }));
          return;
        }
        if (url.pathname === '/registry/list') {
          send(200, await registryListPayload({
            prefix: url.searchParams.get('prefix') || undefined,
            host: url.searchParams.get('host') || undefined,
            tag: url.searchParams.get('tag') || undefined,
            onlyMissingRemote: url.searchParams.get('missing_remote') === '1',
          }));
          return;
        }
        if (url.pathname === '/registry/plan' && req.method === 'POST') {
          const d = Number(url.searchParams.get('depth'));
          send(200, await registryAction({
            action: 'plan',
            root: url.searchParams.get('root') || undefined,
            depth: Number.isInteger(d) && d > 0 ? d : undefined,
          }));
          return;
        }
        if (url.pathname === '/registry/verify' && req.method === 'POST') {
          send(200, await registryAction({ action: 'verify', root: url.searchParams.get('root') || undefined }));
          return;
        }
        if (url.pathname === '/registry/revoke' && req.method === 'POST') {
          if (originGate(res, req, 'revoke', 'E_REGISTRY_ORIGIN')) return;
          send(200, await registryAction({ action: 'revoke' }));
          return;
        }
        if (url.pathname === '/registry/purge' && req.method === 'POST') {
          // 破坏性动作同样只接受设置页来的请求；工具路径要 confirm:true。
          const wantsConfirm = url.searchParams.get('confirm') === '1';
          if (wantsConfirm && !originAllowed(req)) {
            send(200, {
              ok: false, action: 'purge', confirmRequired: true, dryRun: true,
              error: 'E_REGISTRY_ORIGIN：confirm=1 只接受来自设置页的请求（缺 Origin/Referer）',
            });
            return;
          }
          send(200, await registryAction({ action: 'purge', confirm: wantsConfirm }));
          return;
        }
        if (url.pathname === '/registry/build' && req.method === 'POST') {
          // 同意是「人自己点的」这件事：?consent=1 只接受带浏览器来源头（Origin/Referer）的请求 ——
          // 也就是设置页里的按钮。没有来源头的机器调用一律走工具路径：工具先回 ask，由模型问用户。
          const d = Number(url.searchParams.get('depth'));
          const wantsConsent = url.searchParams.get('consent') === '1';
          const action = url.searchParams.get('rescan') === '1' ? 'rescan' : 'build';
          const root = url.searchParams.get('root') || undefined;
          if (wantsConsent && !originAllowed(req)) {
            send(200, {
              ...(await consentRequiredPayload({
                root: root || (await registryDefaultRoot()),
                depth: Number.isInteger(d) && d > 0 ? d : 3,
                action,
                consent: await readConsent(),
              })),
              error: 'E_REGISTRY_CONSENT_ORIGIN：consent=1 只接受来自设置页的请求（缺 Origin/Referer）',
              hint: '机器调用请走 gh_repo_registry 工具：它会先回 ask，由模型把问题交给用户',
            });
            return;
          }
          send(200, await registryAction({
            action,
            consent: wantsConsent ? true : undefined,
            via: wantsConsent ? 'ui:registry-panel' : undefined,
            prune: url.searchParams.get('prune') === '1',
            root,
            depth: Number.isInteger(d) && d > 0 ? d : undefined,
          }));
          return;
        }
        if (url.pathname === '/logout' && req.method === 'POST') {
          if (originGate(res, req, 'logout')) return;
          send(200, await teardown({ confirm: false }));
          return;
        }
        if (url.pathname === '/auth/start' && req.method === 'POST') {
          if (originGate(res, req, 'auth-start')) return;
          if (!(await ghVersion())) {
            send(200, { ok: false, error: 'gh 不可用，且自带安装没成功；看 gh_cli_install 的 attempts 诊断' });
            return;
          }
          const flow = await startDeviceFlowPty();
          const opened = await openUrl(GH_DEVICE_URL);
          lastFlow = { user_code: flow.code, at: new Date().toISOString(), opened };
          send(200, {
            ok: Boolean(flow.code),
            user_code: flow.code,
            verification_uri: GH_DEVICE_URL,
            opened,
          });
          return;
        }
        if (url.pathname === '/identity/email' && req.method === 'POST') {
          // 面板的填写入口（票「面板的提交邮箱入口：已授权但没填过时给一次填写机会」）：
          // **只认带本机页面来源头的请求** —— 机器调用请走 `gh_identity {action:"email"}`（同一条写入口、
          // 同一套校验、只是回执形状不同）。写的是插件自己的 state，不碰宿主；不带 email（空值）时只回报现状。
          if (originGate(res, req, 'identity-email', 'E_IDENTITY_EMAIL_ORIGIN')) return;
          send(200, { action: 'email', stateFile: STATE_FILE, ...(await applyCommitEmail(url.searchParams.get('email') || '')) });
          return;
        }
        send(404, { error: 'not found' });
      } catch (err) {
        send(500, { error: String(err) });
      }
    });
    // 端口被占（重复加载）不该静默：留一条诊断，/state 里能看到（审计 L5）。
    server.on('error', (e) => {
      lastServerError = {
        at: new Date().toISOString(),
        port: API_PORT,
        code: e && e.code ? e.code : null,
        message: String((e && e.message) || e).slice(0, 200),
        note: '端口被占时首个实例继续服务；本实例的 HTTP 路由不可达',
      };
    });
    server.listen(port, '127.0.0.1');
    return server;
  }

  // 加载期预置：只先探本地（毫秒级、不出网），确认缺 gh 才在后台落地一份。
  // 这样用户第一次调 gh_* 时通常已经就绪，而插件加载本身不被几十 MB 下载拖住。
  /** 加载期唯一一次账号检查：结果落进快照，之后所有读取都只碰内存。 */
  function scheduleStartupChecks() {
    if (process.env.DSH_GH_NO_STATE_CHECK === '1') {
      snapshotProbe = { state: 'disabled', at: new Date().toISOString(), error: null };   // N4：面板照实说「未启动」
      return;
    }
    refreshSnapshot(true).catch(() => {});
  }

  function scheduleAutoLand() {
    if (process.env.DSH_GH_NO_BOOTSTRAP === '1') return;
    resolveGh({ install: false })
      .then((g) => {
        if (g.ok) return null;
        lastEnsure = { pending: true, at: new Date().toISOString() };
        return ensureGh({});
      })
      .then((res) => {
        if (!res) return null;
        lastEnsure = res;
        if (res.ok) return gcCache({}); // 落地顺带清残留，缓存目录不会被旧包堆满
        return null;
      })
      .catch(() => { /* 后台落地失败不影响插件加载，诊断留在 lastEnsure */ });
  }

  // 加载期预置第二部分：版本自更新（有更新才动手，24h 冷却）。
  function scheduleVersionWork() {
    scheduleAutoUpdate();
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      let handle = null;
      let disposed = false;
      // dispose 可能早于 listen 回调：那时也要关掉，否则端口留在旧实例手里（审计 L5）。
      startLoopbackServer(API_PORT).then((s) => { if (disposed) s.close(); else handle = s; });
      scheduleStartupChecks();
      scheduleAutoLand();
      scheduleVersionWork();
      return () => { disposed = true; if (handle) handle.close(); };
    });
  } else {
    startLoopbackServer(API_PORT);
    scheduleStartupChecks();
    scheduleAutoLand();
    scheduleVersionWork();
  }
  return undefined;
}
