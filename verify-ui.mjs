/**
 * verify-ui.mjs — 验证「UI 接线」：设置页那一页与宿主半边说的是同一套接口、同一套语义。
 *
 * A. 宿主半边：在伪 HOME + 临时登记目录 + 测试端口上**真起一个回环服务**（effect 真跑），
 *    用 HTTP 打面板会打的那几条路由 —— 包括「没有浏览器来源头的 consent=1 必须被拒」。
 * B. 客户端半边（不渲染）：把 client.js 当普通脚本执行（桩掉 window.__ModuleLoader__），
 *    确认它只依赖 react、注册了两个 settings.section（id / order / label 正确）。
 * C. 接线判据：client.js 里出现的每一条 /registry* 路径，都必须在宿主 PROTOCOL.http.endpoints 里有对应路由。
 *
 * 明确不在本件范围内：**视觉验证**。没有浏览器控制就不写假渲染器、不出截图 ——
 * 一个自造渲染器通过只证明桩写得对，不证明运行中的插件长什么样（见 LESSONS 坑 26）。
 * 面板长什么样，要人在设置页里刷新一次亲眼看；本件只保证它接的线是对的。
 *
 * 用法: node verify-ui.mjs
 */
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';

const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'ghui-home-'));
const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'ghui-root-'));
const PORT = 31791;
const PAGE_ORIGIN = 'http://127.0.0.1:3080';
const SECRET = 'ghp_FAKE0000000000000000000000000000000000';

os.homedir = () => HOME;
process.env.HOME = HOME;
process.env.GIT_CONFIG_GLOBAL = path.join(HOME, '.gitconfig');
process.env.DSH_GH_REGISTRY_DIR = path.join(HOME, '.dsh', 'github-resident');
process.env.DSH_GH_API_PORT = String(PORT);
process.env.DSH_GH_NO_STATE_CHECK = '1';
process.env.DSH_GH_NO_BOOTSTRAP = '1';
process.env.DSH_GH_NO_UPDATE = '1';

const ENV = { HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
const steps = [];
const check = (label, cond, detail) => steps.push({ label, pass: Boolean(cond), detail });
const exists = (p) => fs.stat(p).then(() => true).catch(() => false);
const repoDir = path.join(process.env.DSH_GH_REGISTRY_DIR, 'registry', 'repos');

function sh(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, env: { ...process.env, ...ENV } }, (e, out, err) =>
      resolve({ code: e ? 1 : 0, out: (out || '').trim(), err: (err || '').trim() }));
  });
}

async function mkRepo(dir, { remote } = {}) {
  await fs.mkdir(dir, { recursive: true });
  await sh('git', ['init', '-q', '-b', 'main'], dir);
  await fs.writeFile(path.join(dir, 'README.md'), '# ' + path.basename(dir) + '\n');
  await sh('git', ['add', '-A'], dir);
  await sh('git', ['-c', 'user.email=v@example.com', '-c', 'user.name=verify', 'commit', '-q', '-m', 'init'], dir);
  if (remote) await sh('git', ['remote', 'add', 'origin', remote], dir);
}

const ALPHA = path.join(ROOT, 'alpha');
const BETA = path.join(ROOT, 'beta');
await mkRepo(ALPHA, { remote: 'https://USER:' + SECRET + '@github.com/OWNER/alpha.git' });
await mkRepo(BETA);
await fs.mkdir(path.join(ROOT, 'not-a-repo'), { recursive: true });

// ---------- A. 宿主半边：真起回环服务 ----------
const mod = await import(new URL('./plugin.js', import.meta.url).href);
const tools = new Map();
const services = new Map();
let cleanup = null;
mod.apply({
  tools: { register: (t) => tools.set(t.name, t) },
  provide: (k, v) => services.set(k, v),
  effect: (fn) => { cleanup = fn() || null; },
});

const API = 'http://127.0.0.1:' + PORT;
const post = (p, headers) => fetch(API + p, { method: 'POST', headers: headers || {} }).then((r) => r.json());
const get = (p) => fetch(API + p).then((r) => r.json());

async function waitUp(ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(API + '/registry');
      if (r.ok) return true;
    } catch { /* 还没监听 */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}
const up = await waitUp();
check('测试实例的回环服务起来了', up, API);
if (!up) { console.log(JSON.stringify({ total: steps.length, failed: 1, failedSteps: ['回环服务未起来'], steps }, null, 2)); process.exit(1); }

// 1) 状态：未授权 + 该问的问题（面板首屏就是这两样）
const st0 = await get('/registry');
check('GET /registry 回状态', st0.ok === true && st0.action === 'status', { ok: st0.ok, libraryExists: st0.libraryExists });
check('未授权状态里带 ask.question（面板直接显示）', typeof st0.ask?.question === 'string' && st0.ask.question.includes('是否同意建立'), Boolean(st0.ask));
check('未授权时库不存在', st0.libraryExists === false && st0.consent.recorded === false, { libraryExists: st0.libraryExists });
check('状态里回面板要展示的目录', typeof st0.dir === 'string' && st0.dir.includes('github-resident'), st0.dir);

// 2) 没有浏览器来源头的 consent=1 必须被拒（授权是「人自己点的」那条路径）
const noOrigin = await post('/registry/build?consent=1&root=' + encodeURIComponent(ROOT));
check('无 Origin 的 consent=1 被拒', noOrigin.ok === false && String(noOrigin.error).includes('E_REGISTRY_CONSENT_ORIGIN'), { error: noOrigin.error });
check('被拒时一个字节都没写', (await exists(repoDir)) === false, repoDir);

// 3) 带浏览器来源头（= 设置页按钮）：落盘并记下来源
const fromPage = await post('/registry/build?consent=1&root=' + encodeURIComponent(ROOT), { origin: PAGE_ORIGIN });
check('设置页来源的 consent=1 建成库', fromPage.ok === true && fromPage.registered === 2, { registered: fromPage.registered });
check('授权来源记为 ui:registry-panel', (fromPage.consent?.grants || []).some((g) => g.via === 'ui:registry-panel'), fromPage.consent?.grants);

// 4) 面板读的清单：远端绑定
const list = await get('/registry/list');
check('GET /registry/list 回条目', list.ok === true && list.count === 2, { count: list.count });
const alphaRow = (list.entries || []).find((e) => e.name === 'alpha') || {};
const betaRow = (list.entries || []).find((e) => e.name === 'beta') || {};
check('alpha 标为有远端（host/owner/repo 可读）', alphaRow.hasRemote === true && alphaRow.remote?.host === 'github.com' && alphaRow.remote?.owner === 'OWNER' && alphaRow.remote?.repo === 'alpha', alphaRow.remote);
check('beta 标为无远端（面板要能据此筛选）', betaRow.hasRemote === false && betaRow.remote === null, { hasRemote: betaRow.hasRemote });
check('URL 里的凭据没进清单', !JSON.stringify(list).includes(SECRET), 'token 未出现');

// 5) 面板其余按钮打的路由
const plan = await post('/registry/plan?root=' + encodeURIComponent(ROOT));
check('POST /registry/plan 只读且不落盘', plan.ok === true && plan.wrote === false && plan.found === 2, { wrote: plan.wrote, found: plan.found });
const verify = await post('/registry/verify?root=' + encodeURIComponent(ROOT));
check('POST /registry/verify 对账一致', verify.ok === true && verify.inSync === true, { inSync: verify.inSync });
const rescan = await post('/registry/build?rescan=1&consent=1&root=' + encodeURIComponent(ROOT), { origin: PAGE_ORIGIN });
check('POST /registry/build?rescan=1 刷新快照', rescan.ok === true && rescan.refreshed === 2, { refreshed: rescan.refreshed });

// 6) 撤销后，再点一次「同意并建立」会重新落成授权
const revoke = await post('/registry/revoke', { origin: PAGE_ORIGIN });   // L4：写路由统一要来源头
check('POST /registry/revoke 撤授权但保库', revoke.ok === true && revoke.revoked === true && revoke.libraryKept === true, { revoked: revoke.revoked });
const afterRevoke = await post('/registry/build?rescan=1&consent=1&root=' + encodeURIComponent(ROOT), { origin: PAGE_ORIGIN });
check('撤授权后再点同意 → 重新落成授权', afterRevoke.ok === true && afterRevoke.consent?.recorded === true, { ok: afterRevoke.ok });

// 7) 清库：两步确认 + 来源门
const purgeNoConfirm = await post('/registry/purge');
check('purge 无 confirm 只报告', purgeNoConfirm.ok === false && purgeNoConfirm.confirmRequired === true, { dryRun: purgeNoConfirm.dryRun });
const purgeNoOrigin = await post('/registry/purge?confirm=1');
check('无 Origin 的 purge confirm=1 被拒', purgeNoOrigin.ok === false && String(purgeNoOrigin.error).includes('E_REGISTRY_ORIGIN'), { error: purgeNoOrigin.error });
const purgeOk = await post('/registry/purge?confirm=1', { origin: PAGE_ORIGIN });
check('设置页来源的 purge 真删库', purgeOk.ok === true && (await exists(repoDir)) === false, { removedEntries: purgeOk.removedEntries });

// ---------- B. 客户端半边：模块加载 + slot 注册（不渲染） ----------
const clientSrc = await fs.readFile(new URL('./client.js', import.meta.url), 'utf8');
let captured = null;
const windowStub = { __ModuleLoader__: { load: (m) => { captured = m; } }, setTimeout, clearTimeout };
globalThis.window = windowStub;
new Function('window', 'require', clientSrc)(windowStub, () => { throw new Error('factory 之前不该 require'); });
check('client.js 用 __ModuleLoader__ 注册模块', Boolean(captured) && captured.id === '@local/dsh-github-resident-v2', captured && captured.id);
const required = [];
const clientMod = captured.factory((id) => { required.push(id); return id === 'react' ? { createElement: () => null } : null; });
check('客户端半边只 require react（无 Harness 包依赖）', required.length === 1 && required[0] === 'react', required);
check('模块声明 inject=slots', Array.isArray(clientMod.inject) && clientMod.inject.includes('slots'), clientMod.inject);

const registrations = [];
clientMod.apply({
  slots: {
    inject: (slot, fn) => fn(),
    register: (opts, component) => { registrations.push({ slot: 'settings.section', opts, component }); return { dispose() {} }; },
  },
});
const regEntry = registrations.find((r) => r.opts.id === 'github-repo-registry');
check('注册了独立的 settings.section（id=github-repo-registry）', Boolean(regEntry) && regEntry.opts.name === 'settings.section', registrations.map((r) => r.opts.id));
check('原有 GitHub 页保持不变', registrations.some((r) => r.opts.id === 'github-resident' && r.opts.order === 60), registrations.map((r) => r.opts.order));
check('新页 order/label 正确（排在 GitHub 之后）', regEntry.opts.order === 61 && regEntry.opts.label === '仓库登记库', { order: regEntry.opts.order, label: regEntry.opts.label });
check('新页组件是个函数（交给 slot 渲染）', typeof regEntry.component === 'function', typeof regEntry.component);
check('两页都由同一次 apply 注册', registrations.filter((r) => r.slot === 'settings.section').length === 2, registrations.length);


// ---------- D. 用词隔离：登记库页不许借用账号页的「授权」二字 ----------
// 用户实测踩过：GitHub 页写「已授权 · SunsetRNE」，登记库页写「未授权 · 等你点头」，
// 同一个面板里两个「授权」= 看起来像账号掉了。判据写死这两条，改回去就红。
/**
 * 按花括号配对取一个组件的源码体。
 * 原来拿「const CSS = [」当右界 —— R5 把两页 CSS 合并成模板后这个标记就不存在了，
 * 切片会一直吃到文件尾，把 GitHub 页的文案也算进登记库页（用词与文案预算双双误报）。
 */
function fnBody(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) return '';
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}
const regRegion = fnBody(clientSrc, 'RegistryPanel');
if (!regRegion.includes('登记库未建立')) {
  throw new Error('无法定位 RegistryPanel 组件体：门禁的区域切片需要更新');
}
const regCode = regRegion.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
check('登记库页说「登记库未建立 / 建库许可」，不用「未授权」', regCode.includes('登记库未建立') && regCode.includes('建库许可'), '');
check('登记库页没有「未授权 / 已授权」这类账号用词', !regCode.includes('未授权') && !regCode.includes('已授权'), '');
check('登记库页与 GitHub 页共用同一份账号快照（/state?cached=1）', regCode.includes('/state?cached=1'), '');
check('登记库页显式声明与账号登录无关', regRegion.includes('和账号登录是两件事') || regRegion.includes('不涉及账号登录'), '');

// 文案预算：这一页被要求「清理与压缩」，给它一个上限，长回去就红。
const regLits = [...regRegion.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]).filter((x) => /[\u4e00-\u9fff]/.test(x));
const regCjk = (regLits.join('').match(/[\u4e00-\u9fff]/g) || []).length;
check('登记库页文案预算：可见汉字 ≤ 400（压缩后 337）', regCjk <= 400, regCjk);
check('登记库页最长一句 ≤ 60 字', Math.max(...regLits.map((x) => x.length)) <= 60, Math.max(...regLits.map((x) => x.length)));

// ---------- C. 接线判据：客户端用的路径 ⊆ 宿主路由 ----------
const hostPaths = new Set((services.get('githubResident').protocol().http.endpoints || []).map((e) => e.path));
const clientPaths = [...new Set([...clientSrc.matchAll(/API \+ '(\/registry[^']*)'/g)].map((m) => m[1].split('?')[0]))];
check('客户端对 /state 的读取也走同一 API 基址', clientSrc.includes("API + '/state?cached=1'"), '');
// N1：面板不能只在挂载时读一次 —— 后台检查落地后必须自己补读，否则一直停在「检查中」
check('客户端在检查未就绪时会自补读', clientSrc.includes("document.addEventListener('visibilitychange'")
  && /setInterval\(\(\) => \{/.test(clientSrc), '');
check('客户端按 probe 阶段显示（进行中 / 未启动 / 失败）',
  clientSrc.includes("probe.state === 'disabled'") && clientSrc.includes("probe.state === 'failed'"), '');
check('客户端确实用了多条 registry 路径', clientPaths.length >= 5, clientPaths);
const missing = clientPaths.filter((p) => !hostPaths.has(p));
check('客户端每条路径都有宿主路由', missing.length === 0, { clientPaths, missing });
check('授权/破坏性路由都在宿主侧有来源门', clientPaths.includes('/registry/build') && clientPaths.includes('/registry/purge'), clientPaths);

if (cleanup) { try { cleanup(); } catch { /* 关服务失败不影响判定 */ } }
await fs.rm(HOME, { recursive: true, force: true });
await fs.rm(ROOT, { recursive: true, force: true });

const failed = steps.filter((s) => !s.pass);
console.log(JSON.stringify({ total: steps.length, failed: failed.length, failedSteps: failed.map((s) => s.label), steps }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
