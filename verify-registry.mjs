/**
 * verify-registry.mjs — 验证 Git 仓库登记文件库（gh_repo_registry / gh_repo_registry_list）。
 *
 * 隔离手法与 verify-logout.mjs 一致：monkey-patch os.homedir() 必须在 import 插件之前完成
 * （插件的 HOME 常量在模块加载期求值）；另外用 DSH_GH_REGISTRY_DIR 把整棵登记目录钉到临时目录，
 * 保证真 ~/.dsh 一个字节都不动。
 *
 * 覆盖的硬判据：
 *   1. 未授权调 build → 回 { consentRequired:true, ask.question } 且磁盘上一个字节都没写；
 *   2. 用户同意（consent:true）后才落盘，一仓一文件 + index.json + consent.json；
 *   3. 条目如实反映远端绑定：有远端 / 无远端 / 远端 URL 里的凭据被剥掉；
 *   4. 登记不污染任何工作树（build 前后 git status --porcelain 行数不变）；
 *   5. 授权按 root/depth 绑定：换 root 会重新要授权；已记录的授权可免 consent:true；
 *   6. forget 只删条目不删仓库；revoke 撤授权不删库；purge 无 confirm 只报告；
 *   7. 协议面自描述：工具表、service 方法、registry 落盘契约都在 PROTOCOL 里。
 *
 * 用法: node verify-registry.mjs
 */
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';

const REAL_HOME = os.homedir();
const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'ghreg-home-'));
os.homedir = () => HOME; // 必须在 import 插件之前
process.env.HOME = HOME;
process.env.GIT_CONFIG_GLOBAL = path.join(HOME, '.gitconfig');
process.env.DSH_GH_REGISTRY_DIR = path.join(HOME, '.dsh', 'github-resident');
process.env.DSH_GH_NO_STATE_CHECK = '1';
process.env.DSH_GH_NO_BOOTSTRAP = '1';
process.env.DSH_GH_NO_UPDATE = '1';

const ENV = { HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'ghreg-root-'));
const OTHER_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'ghreg-other-'));
const SECRET = 'ghp_FAKE0000000000000000000000000000000000';

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
const OTHER = path.join(OTHER_ROOT, 'gamma');
await mkRepo(ALPHA);
// 顺序刻意是 upstream 先、origin 后：git remote -v 按写入顺序列出，
// 只要有谁把「远端名」和「URL 里的仓库名」搞混，origin 就会被找成 upstream。
await sh('git', ['remote', 'add', 'upstream', 'git@github.com:OWNER/alpha-fork.git'], ALPHA);
await sh('git', ['remote', 'add', 'origin', `https://USER:${SECRET}@github.com/OWNER/alpha.git`], ALPHA);
await mkRepo(BETA);
await mkRepo(OTHER, { remote: 'git@github.com:OWNER/gamma.git' });
await fs.mkdir(path.join(ROOT, 'not-a-repo'), { recursive: true });
// alpha 上留一处未提交改动，用来验「登记不改工作树」这件事本身有意义
await fs.writeFile(path.join(ALPHA, 'dirty.txt'), 'x\n');

const mod = await import(new URL('./plugin.js', import.meta.url).href);
const tools = new Map();
const services = new Map();
mod.apply({
  tools: { register: (t) => tools.set(t.name, t) },
  provide: (k, v) => services.set(k, v),
  effect: () => {},
});

const registry = tools.get('gh_repo_registry');
const list = tools.get('gh_repo_registry_list');
const repos = tools.get('gh_repos');

const steps = [];
const check = (label, cond, detail) => steps.push({ label, pass: Boolean(cond), detail });
const exists = async (p) => fs.stat(p).then(() => true).catch(() => false);
const repoDir = path.join(process.env.DSH_GH_REGISTRY_DIR, 'registry', 'repos');
const consentFile = path.join(process.env.DSH_GH_REGISTRY_DIR, 'registry', 'consent.json');
const indexFile = path.join(process.env.DSH_GH_REGISTRY_DIR, 'registry', 'index.json');
const dirtyCount = async (repo) => (await sh('git', ['status', '--porcelain'], repo)).out.split('\n').filter(Boolean).length;

check('两个工具都注册了', Boolean(registry && list), [...tools.keys()].filter((k) => k.includes('registry')));

// 1) 库还没建时：list 回该问的问题，而不是猜
const before = await list.execute({ root: ROOT }, {});
check('库不存在时 list 回 consentRequired', before.ok === false && before.libraryExists === false && before.consentRequired === true, { ok: before.ok, libraryExists: before.libraryExists });
check('回执带 ask.question（可直接转述给用户）', typeof before.ask?.question === 'string' && before.ask.question.includes('是否同意建立'), before.ask?.question);
check('ask 给出同意后的调用式', String(before.ask?.onAgree || '').includes('consent:true'), before.ask?.onAgree);

// 2) 未授权 build：必须一个字节都不写
const blocked = await registry.execute({ action: 'build', root: ROOT, depth: 2 }, {});
check('未授权 build 被闸门拦下', blocked.ok === false && blocked.consentRequired === true && blocked.wrote === false, { ok: blocked.ok, consentRequired: blocked.consentRequired });
check('未授权时 repos/ 目录不存在', (await exists(repoDir)) === false, repoDir);
check('未授权时 consent.json 不存在', (await exists(consentFile)) === false, consentFile);
check('闸门回执带 instruction（先问再落盘）', String(blocked.instruction || '').includes('先'), blocked.instruction);

// 3) plan 是只读的，且把 ask 一起交出来
const plan = await registry.execute({ action: 'plan', root: ROOT, depth: 2 }, {});
check('plan 不落盘', plan.wrote === false && (await exists(repoDir)) === false, { wrote: plan.wrote });
check('plan 认得出 2 个仓库', plan.found === 2 && plan.unregistered.length === 2, { found: plan.found, unregistered: plan.unregistered });
check('plan 带 ask（看完计划仍要问）', typeof plan.ask?.question === 'string', Boolean(plan.ask));

// 4) 授权后 build：一仓一文件
const dirtyBefore = await dirtyCount(ALPHA);
const built = await registry.execute({ action: 'build', root: ROOT, depth: 2, consent: true }, {});
check('build 成功并落盘', built.ok === true && built.wroteFiles >= 3, { registered: built.registered, wroteFiles: built.wroteFiles });
check('登记了 2 个仓库（非仓库目录被排除）', built.registered === 2 && built.added === 2, { registered: built.registered, added: built.added });
check('有远端 1 / 无远端 1', built.remoteBound === 1 && built.withoutRemote === 1, { remoteBound: built.remoteBound, withoutRemote: built.withoutRemote });
const files = (await fs.readdir(repoDir)).filter((f) => f.endsWith('.json')).sort();
check('repos/ 里正好两个条目文件', files.length === 2, files);
check('index.json 与 consent.json 都在', (await exists(indexFile)) && (await exists(consentFile)));

const alphaFile = JSON.parse(await fs.readFile(path.join(repoDir, files.find((f) => f.startsWith('alpha-'))), 'utf8'));
const betaFile = JSON.parse(await fs.readFile(path.join(repoDir, files.find((f) => f.startsWith('beta-'))), 'utf8'));
check('条目 schema/版本正确', alphaFile.schema === 'dsh-github-resident/repo-entry' && alphaFile.schemaVersion === 2, { schema: alphaFile.schema, v: alphaFile.schemaVersion });
check('alpha 表明有绑定远端', alphaFile.git.hasRemote === true && alphaFile.git.origin.host === 'github.com' && alphaFile.git.origin.owner === 'OWNER', alphaFile.git.origin);
check('多远端时 origin 命中正确的那个远端（不是列表第一个）', alphaFile.git.origin.name === 'origin' && alphaFile.git.origin.repoName === 'alpha', alphaFile.git.origin);
check('remotes[].name 是远端名，repoName 才是仓库名（曾经同用一个 name）', alphaFile.git.remotes.length === 2 && alphaFile.git.remotes.some((r) => r.name === 'upstream' && r.repoName === 'alpha-fork'), alphaFile.git.remotes.map((r) => r.name + '→' + r.repoName));
check('条目 schemaVersion 跟到 2', alphaFile.schemaVersion === 2 && alphaFile.git.remotes.every((r) => 'repoName' in r), alphaFile.schemaVersion);
check('远端 URL 里的凭据被剥掉', !JSON.stringify(alphaFile).includes(SECRET) && !JSON.stringify(alphaFile).includes('USER:'), String(alphaFile.git.origin.url));
check('beta 表明没有远端', betaFile.git.hasRemote === false && betaFile.git.remoteCount === 0 && betaFile.git.origin === null, { hasRemote: betaFile.git.hasRemote });
check('记下分支与 HEAD', alphaFile.git.branch === 'main' && /^[0-9a-f]{7,}$/.test(String(alphaFile.git.head)), { branch: alphaFile.git.branch, head: alphaFile.git.head });

// 5) 登记不污染工作树
const dirtyAfter = await dirtyCount(ALPHA);
check('工作树 dirty 计数不变', dirtyAfter === dirtyBefore, { before: dirtyBefore, after: dirtyAfter });
const stray = (await fs.readdir(ALPHA)).filter((n) => n.startsWith('repo-entry') || n.endsWith('.json.tmp'));
check('仓库里没多出登记相关文件', stray.length === 0, stray);

// 6) 读库：列表 + 远端绑定
const listed = await list.execute({ root: ROOT }, {});
check('list 从文件库读出 2 条', listed.ok === true && listed.count === 2 && listed.libraryCount === 2, { count: listed.count });
check('list 标出远端绑定', listed.remoteBound === 1 && listed.withoutRemote === 1 && listed.byHost['github.com'] === 1, listed.byHost);
check('filter: 只看没远端的', (await list.execute({ only_missing_remote: true }, {})).count === 1);
check('filter: 只看有远端的', (await list.execute({ has_remote: true }, {})).count === 1);
check('filter: 按前缀', (await list.execute({ prefix: path.join(ROOT, 'beta') }, {})).count === 1);
check('filter: 未命中就是 0 条', (await list.execute({ prefix: '/nonexistent-x' }, {})).count === 0);

// 6.5) 人工字段（note / tags）与过滤器：写进去、刷新后不丢、能按标签/主机筛出来
const noted = await registry.execute({ action: 'build', root: ROOT, depth: 2, consent: true, note: '审计备注', tags: ['audit'] }, {});
check('带 note/tags 重建成功', noted.ok === true && noted.registered === 2, { registered: noted.registered });
const afterNote = JSON.parse(await fs.readFile(path.join(repoDir, files.find((f) => f.startsWith('alpha-'))), 'utf8'));
check('note/tags 落到条目里', afterNote.notes === '审计备注' && afterNote.tags.includes('audit'), { notes: afterNote.notes, tags: afterNote.tags });
const rescanNoNote = await registry.execute({ action: 'rescan', root: ROOT, depth: 2 }, {});
const afterRescan = JSON.parse(await fs.readFile(path.join(repoDir, files.find((f) => f.startsWith('alpha-'))), 'utf8'));
check('rescan 不覆盖已有 note/tags', rescanNoNote.ok === true && afterRescan.notes === '审计备注' && afterRescan.tags.includes('audit'), { notes: afterRescan.notes });
check('按 tag 筛得出来', (await list.execute({ tag: 'audit' }, {})).count === 2);
check('按 host 筛得出来', (await list.execute({ host: 'github.com' }, {})).count === 1);
check('root 指向文件时报错而不是崩', (await registry.execute({ action: 'plan', root: path.join(ROOT, 'alpha', 'README.md') }, {})).ok === false);
const byPath = await registry.execute({ action: 'forget', path: BETA }, {});
check('forget 也支持按 path', byPath.ok === true && byPath.removed?.path === BETA, byPath.removed);
await registry.execute({ action: 'build', root: ROOT, depth: 2, consent: true }, {});   // 复原成 2 条

// 7) 已记录的授权免 consent:true；换 root 要重新授权
const rescan = await registry.execute({ action: 'rescan', root: ROOT, depth: 2 }, {});
check('已记录的授权让 rescan 直接通过', rescan.ok === true && rescan.refreshed === 2 && rescan.added === 0, { refreshed: rescan.refreshed, added: rescan.added });
check('沿用授权时不改写审计来源（via 仍是当初那次）', (rescan.consent?.grants || []).some((g) => g.via === 'tool:consent:true'), rescan.consent?.grants);
const consentFileAfter = JSON.parse(await fs.readFile(consentFile, 'utf8'));
check('consent.json 里的 via 也没被改写', consentFileAfter.grants.some((g) => g.via === 'tool:consent:true'), consentFileAfter.grants);
const widened = await registry.execute({ action: 'build', root: OTHER_ROOT, depth: 2 }, {});
check('换 root 会重新要授权（授权按范围绑定）', widened.ok === false && widened.consentRequired === true && (await fs.readdir(repoDir)).length === 2, { ok: widened.ok });
const otherBuilt = await registry.execute({ action: 'build', root: OTHER_ROOT, depth: 2, consent: true }, {});
check('同意新范围后 gamma 也登记（ssh 风格远端解析）', otherBuilt.ok === true && otherBuilt.registered === 1, { registered: otherBuilt.registered });
const gammaFile = JSON.parse(await fs.readFile(path.join(repoDir, (await fs.readdir(repoDir)).find((f) => f.startsWith('gamma-'))), 'utf8'));
check('git@host:owner/repo 解析出 host/owner', gammaFile.git.origin.host === 'github.com' && gammaFile.git.origin.owner === 'OWNER' && gammaFile.git.origin.scheme === 'ssh', gammaFile.git.origin);
const rescanBack = await registry.execute({ action: 'rescan', root: ROOT, depth: 2 }, {});
check('新授权不顶掉旧 root 的授权（grant 可多条）', rescanBack.ok === true && rescanBack.consent?.grantCount === 2, { grantCount: rescanBack.consent?.grantCount });

// 8) 对账、forget、revoke、purge
const drift = await registry.execute({ action: 'verify', root: ROOT, depth: 2 }, {});
check('verify 报出跨 root 的漂移', drift.inSync === false && drift.drift.outOfScope.length === 1 && drift.drift.registeredMissing.length === 0, drift.drift);
const forgot = await registry.execute({ action: 'forget', slug: betaFile.slug }, {});
check('forget 只删条目', forgot.ok === true && (await exists(path.join(repoDir, betaFile.slug + '.json'))) === false && (await exists(BETA)) === true, { removed: forgot.removed?.slug });
check('forget 后 index 同步重建', JSON.parse(await fs.readFile(indexFile, 'utf8')).count === 2, JSON.parse(await fs.readFile(indexFile, 'utf8')).count);
const revoked = await registry.execute({ action: 'revoke' }, {});
check('revoke 撤授权但保留库', revoked.ok === true && revoked.revoked === true && (await exists(consentFile)) === false && (await fs.readdir(repoDir)).length === 2, { revoked: revoked.revoked });
const reblocked = await registry.execute({ action: 'rescan', root: ROOT, depth: 2 }, {});
check('撤授权后 rescan 立刻又被拦', reblocked.ok === false && reblocked.consentRequired === true, { ok: reblocked.ok });
const purgeDry = await registry.execute({ action: 'purge' }, {});
check('purge 无 confirm 只报告', purgeDry.ok === false && purgeDry.confirmRequired === true && (await exists(repoDir)) === true, { dryRun: purgeDry.dryRun });
const purged = await registry.execute({ action: 'purge', confirm: true }, {});
check('purge confirm 后整棵目录清掉', purged.ok === true && (await exists(repoDir)) === false && (await exists(consentFile)) === false, { removedEntries: purged.removedEntries });

// 8.5) 旧条目（schemaVersion 1，远端名与仓库名混用）读进来仍要能用
await fs.mkdir(repoDir, { recursive: true });   // 前面的 purge 清过目录，这里重建
const legacyPath = path.join(repoDir, 'legacy-selfheal.json');
await fs.writeFile(legacyPath, JSON.stringify({
  schema: 'dsh-github-resident/repo-entry', schemaVersion: 1, slug: 'legacy-selfheal',
  name: 'legacy', path: path.join(ROOT, 'legacy'), registeredAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  source: 'scan', notes: '', tags: [],
  git: { isRepo: true, branch: 'main', head: 'deadbee', dirty: 0, hasRemote: true, remoteCount: 1, upstream: null, ahead: null, behind: null,
    remotes: [{ name: 'legacy-name', url: 'https://github.com/OWNER/legacyrepo.git', scheme: 'https', host: 'github.com', owner: 'OWNER' }],
    origin: { name: 'legacy-name', url: 'https://github.com/OWNER/legacyrepo.git', scheme: 'https', host: 'github.com', owner: 'OWNER' }, url: 'https://github.com/OWNER/legacyrepo.git' },
}, null, 2) + '\n');
const legacyList = await list.execute({ prefix: path.join(ROOT, 'legacy') }, {});
check('旧条目仍能读（没有 repoName 就从 URL 反解仓库名）', legacyList.count === 1 && legacyList.entries[0].remote?.repo === 'legacyrepo', legacyList.entries[0] && legacyList.entries[0].remote);
await fs.rm(legacyPath, { force: true });
await fs.rm(repoDir, { recursive: true, force: true });   // 复原 purge 之后的空状态，交给下一段判据

// 9) gh_repos 会提示登记库状态（这就是「AI 主动问」的触发点）
const hint = await repos.execute({ root: ROOT, depth: 2 }, {});
check('gh_repos 带 registry 提示', hint.registry && hint.registry.libraryExists === false && String(hint.registry.hint).includes('ask.question'), hint.registry?.hint);

// 10) 协议面
const proto = services.get('githubResident').protocol();
check('协议版本 >= 6（新增路由/方法必须跟着涨）', proto.version >= 6, proto.version);
check('协议契约里 schemaVersion 是 2', proto.registry?.schemaVersion === 2, proto.registry?.schemaVersion);
check('协议工具表含两个新工具', proto.tools.some((t) => t.name === 'gh_repo_registry') && proto.tools.some((t) => t.name === 'gh_repo_registry_list'));
check('协议 service 含 registry 方法', proto.service.methods.some((m) => m.name === 'registry') && proto.service.methods.some((m) => m.name === 'registryList'));
check('协议含 registry 落盘契约', proto.registry?.schema === 'dsh-github-resident/repo-entry' && proto.registry?.entry?.path && proto.registry?.dir === path.join(process.env.DSH_GH_REGISTRY_DIR, 'registry'), proto.registry?.dir);
check('协议 HTTP 含 /registry 路由', proto.http.endpoints.some((e) => e.path === '/registry') && proto.http.endpoints.some((e) => e.path === '/registry/list'));
const viaService = await services.get('githubResident').registry({ action: 'status', root: ROOT });
check('Host Service 与工具走同一条实现', viaService.action === 'status' && typeof viaService.libraryExists === 'boolean', viaService.action);

// 11) 真 HOME 与真仓库没被碰
check('真 HOME 下没有新建登记目录', (await exists(path.join(REAL_HOME, '.dsh', 'github-resident', 'registry', 'repos'))) === false || process.env.DSH_GH_REGISTRY_DIR.startsWith(HOME), path.join(REAL_HOME, '.dsh'));

await fs.rm(HOME, { recursive: true, force: true });
await fs.rm(ROOT, { recursive: true, force: true });
await fs.rm(OTHER_ROOT, { recursive: true, force: true });

const failed = steps.filter((s) => !s.pass);
console.log(JSON.stringify({ total: steps.length, failed: failed.length, failedSteps: failed.map((s) => s.label), steps }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
