/**
 * verify-ui.mjs — 验证「UI 接线」：设置页那一页与宿主半边说的是同一套接口、同一套语义。
 *
 * A. 宿主半边：伪 HOME + 临时登记目录，真起 effect、禁止监听端口，经真实宿主 RPC 调服务位。
 *    保留来源、同意、清库两步确认的全部判据。
 * B. 客户端半边（不渲染）：把 client.js 当普通脚本执行（桩掉 window.__ModuleLoader__），
 *    确认它只依赖 react、注册了两个 settings.section（id / order / label 正确）。
 * C. 客户端每条 ghr.* 调用都必须在协议清单和实际注册表中。
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
import { Server } from 'node:net';
import { createRpcChannel } from './deck/src/host/rpcChannel.js';
import { holdLoadLease } from './tests/merge/_load-lease.mjs';

// 重活租约（票 61）：resident 这一族与 verify:merge / verify:deck 共用**同一把锁**（引同一支
// tests/merge/_load-lease.mjs，不抄第二份）；拿不到就 exit 2 + BLOCKED-LOAD-LEASE，本件一条判据都不跑。
holdLoadLease({
  holder: 'verify:resident/verify-ui.mjs@' + (process.env.DSH_SESSION_ID || ('pid' + process.pid)),
  purpose: 'verify:resident（verify-ui.mjs）',
})

const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'ghui-home-'));
const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'ghui-root-'));
const PAGE_ORIGIN = 'http://127.0.0.1:3080';
const SECRET = 'ghp_FAKE0000000000000000000000000000000000';

os.homedir = () => HOME;
process.env.HOME = HOME;
process.env.GIT_CONFIG_GLOBAL = path.join(HOME, '.gitconfig');
process.env.DSH_GH_REGISTRY_DIR = path.join(HOME, '.dsh', 'github-resident');
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

// ---------- A. 真 effect + 服务位 + 真实 RPC 分发，不开端口 ----------
const mod = await import(new URL('./plugin.js', import.meta.url).href);
const tools = new Map(), services = new Map(), endpoints = new Map(), cleanups = [];
const listen = Server.prototype.listen;
let listens = 0, route;
Server.prototype.listen = function () { listens++; throw new Error('不允许自开端口'); };
services.set('dswEndpoints', { handle: (name, fn) => { endpoints.set(name, fn); return () => endpoints.delete(name); } });
services.set('connection', { fetch: { register: (def) => { route = def.fetch; return () => {}; } } });
const ctx = {
  tools: { register: (t) => tools.set(t.name, t) },
  provide: (k, v) => services.set(k, v), get: (k) => services.get(k),
  inject: (keys, fn) => { if (keys.every(k => services.has(k))) fn(ctx); },
  effect: (fn) => { const stop = fn(); if (typeof stop === 'function') cleanups.push(stop); },
};
mod.apply(ctx);
createRpcChannel({ ctx, handlers: endpoints, fireLog() {}, dispatchMeta: async () => ({ shortArgHash: () => '', dispatchErrorKind: () => 'internal' }) });
const pathNames = {
  '/state': 'state', '/registry': 'registry', '/registry/list': 'registry.list',
  '/registry/plan': 'registry.plan', '/registry/verify': 'registry.verify',
  '/registry/build': 'registry.build', '/registry/revoke': 'registry.revoke', '/registry/purge': 'registry.purge',
};
const request = async (path, headers = {}) => {
  const [pathname, query = ''] = path.split('?');
  const res = await route(new Request(PAGE_ORIGIN + '/api/dsws', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ type: 'client-request', rpcId: 'verify-ui', method: 'dsws', payload: { method: 'ghr.' + pathNames[pathname], payload: { query } } }),
  }));
  const envelope = await res.json();
  if (!envelope.result.ok) throw new Error(envelope.result.error.message);
  return envelope.result.value;
};
const post = request, get = request;
check('测试实例真起 effect 后 RPC 服务位可用', endpoints.has('ghr.state') && endpoints.has('ghr.registry'));
// 面板那颗「生成一次性码」的第一阶段就落在 ghr.ensureGh 上：端点必须真的注册着（不是只在协议文档里写着）。
check('面板授权链的两个端点都在（ensureGh / authStart）', endpoints.has('ghr.ensureGh') && endpoints.has('ghr.authStart'));
await new Promise(r => setTimeout(r, 20));
check('真 effect 没有监听端口', listens === 0, listens);

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
check('client.js 用 __ModuleLoader__ 注册模块', Boolean(captured) && captured.id === '@sunsetrne/dsh-github-resident-v2', captured && captured.id);
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
// #78：页名从「仓库登记库」改成「插件后端」——这一页管的是后端的五件事，登记库只是其中一件。
check('新页 order/label 正确（排在 GitHub 之后，页名 = 插件后端）', regEntry.opts.order === 61 && regEntry.opts.label === '插件后端', { order: regEntry.opts.order, label: regEntry.opts.label });
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
// 票 51 第 2 步：账号快照改走宿主 RPC 端点 ghr.state（?cached=1）—— 判据等价换：仍认「登记库页读的是同一份快照」。
check('登记库页与 GitHub 页共用同一份账号快照（ghr.state · cached=1）', regCode.includes('ghr.state') && regCode.includes('cached=1'), '');
check('登记库页显式声明与账号登录无关', regRegion.includes('和账号登录是两件事') || regRegion.includes('不涉及账号登录'), '');

// #78：五子页骨架。页签、落点、分发页的边界各自钉一条——少一个就红。
check('五个子页签都在（数据 / 绑定 / 诊断 / 工具 / 分发）', ['数据', '绑定', '诊断', '工具', '分发'].every((x) => regRegion.includes("'" + x + "'")), '');
check('绑定 / 诊断两页挂的是 Deck 拆出来的两片（WorkspaceSection / DiagnosticsSection）', regRegion.includes('deck.WorkspaceSection') && regRegion.includes('deck.DiagnosticsSection'), '');
check('分发页不再挂 Deck 更新入口件（只给去向链接）', !regRegion.includes('h(DeckUpdate') && !regRegion.includes('DeckUpdate = deck'), '');
check('分发页给出发布页与仓库两个链接', regRegion.includes('/releases') && regRegion.includes("target: '_blank'"), '');

// 文案预算：这一页被要求「清理与压缩」，给它一个上限，长回去就红。
// 合并期调整（2026-10-11，构建负责人）：登记库页按实施计划 ⑦⑧⑨⑩ 并入了 Deck 的 4 个区块，
// 可见汉字从压缩后的 337 涨到 432 —— 这是「合并本身带来的正文」，不是这页自己长胖；
// 阈值 400 → 480（留 ~11% 余量），仍然拦「继续往里堆文案」这类退化。
// 1.8.2 两处订正：
//   a) 标签里不再写死「实测 N」——按本包 1.8.1 自己立的规矩（数字没有真源就会过期），现值由
//      这条断言每次自己报（detail 字段）。写死的那个 432 到 1.8.2 时早已是 441，没人发现。
//   b) 作者其他插件区块（1.8.2 删除）**从来不在本区间内**：本区间取的是 RegistryPanel 的函数体，
//      而那个区块住在 SettingsPage 的 DeckSettingsSections 里 —— 删它不会让这个数字变小，
//      所以别拿这条预算去论证「删了文案所以变短」。区间与理由记录在 docs/merge-work-build.md 第 4 节。
const REG_CJK_BUDGET = 480;
const regLits = [...regRegion.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]).filter((x) => /[\u4e00-\u9fff]/.test(x));
const regCjk = (regLits.join('').match(/[\u4e00-\u9fff]/g) || []).length;
check(`登记库页文案预算：可见汉字 ≤ ${REG_CJK_BUDGET}`, regCjk <= REG_CJK_BUDGET, regCjk);
check('登记库页最长一句 ≤ 60 字', Math.max(...regLits.map((x) => x.length)) <= 60, Math.max(...regLits.map((x) => x.length)));

// ---------- C. 客户端用到的端点 ⊆ 协议清单 ∩ 实际服务位 ----------
const hostNames = new Set(services.get('githubResident').protocol().http.endpoints.map(e => e.path));
const clientNames = [...new Set([...clientSrc.matchAll(/(?:call|post)\('([^']+)'/g)].map(m => m[1]).filter(n => n.startsWith('ghr.')))];
const registryNames = clientNames.filter(n => n.startsWith('ghr.registry'));
check('客户端状态读取走唯一 RPC 出口，没有裸 fetch', clientNames.includes('ghr.state') && !/\bfetch\s*\(/.test(clientSrc));
check('客户端在检查未就绪时会自补读', clientSrc.includes("document.addEventListener('visibilitychange'") && /setInterval\(\(\) => \{/.test(clientSrc));
check('客户端按 probe 阶段显示（进行中 / 未启动 / 失败）', clientSrc.includes("probe.state === 'disabled'") && clientSrc.includes("probe.state === 'failed'"));
check('客户端确实用了多条 registry 端点', registryNames.length >= 5, registryNames);
const missing = clientNames.filter(n => !hostNames.has(n) || !endpoints.has(n));
check('客户端每个端点都在协议且实际注册', missing.length === 0, { clientNames, missing });
const requiredWrites = ['ghr.registry.build', 'ghr.registry.purge', 'ghr.authStart', 'ghr.ensureGh', 'ghr.identity.email'];
check('客户端用到的写类端点一条不少', requiredWrites.every(n => clientNames.includes(n)), requiredWrites);
const hostSrc = await fs.readFile(new URL('./plugin.js', import.meta.url), 'utf8');
check('Resident 源码没有监听或端口配置', !/server\.listen\s*\(|DSH_GH_API_PORT|lastServerError/.test(hostSrc));
for (const stop of cleanups.reverse()) stop();
Server.prototype.listen = listen;
await fs.rm(HOME, { recursive: true, force: true });
await fs.rm(ROOT, { recursive: true, force: true });

const failed = steps.filter((s) => !s.pass);
console.log(JSON.stringify({ total: steps.length, failed: failed.length, failedSteps: failed.map((s) => s.label), steps }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
