/**
 * tests/merge/host/gh-probe-bound.test.mjs —— 票「gh 探测也要有界：probeGh（gh --version）不能无限等」的门禁。
 *
 * 全离线，两层取证：
 *   - 夹具的 gh 桩加了一个新形状 `hangAll`（**对任何 argv 都挂死**，连 `--version` 也不答）——
 *     这就是「探测无上界」的现场；
 *   - 一个**记账桩服务**：谁按 release API / 下载基址打过来就记一笔 —— 证明「超时**没有**去下载」。
 *
 * 逐条对着 Agent Brief 的验收标准：
 *   ①  先自证形状是真的（同一个桩能让纯 spawn 也等不到 close），别拿「随便挂一下」冒充；
 *   ②  六个入口（resolve / status / identity / env_probe / version / pr）都在设定上界内返回，
 *      且结论是**「探测超时（未知）」**而不是「没装 gh」；
 *   ③  超时**不触发**落地/下载（`install` 默认开启的入口一个请求都不发）；
 *   ④  超时**不写**记忆、**不写**探测缓存（连调两次 → 探测被重新执行，桩记得到）；
 *   ⑤  命令查找那一步（`command -v gh`）也带上界；
 *   ⑥  旋钮 `DSH_GH_PROBE_TIMEOUT_MS` 生效，并带下限钳制。
 *
 * 用法：node tests/merge/host/gh-probe-bound.test.mjs
 */
import http from 'node:http'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, note, section, summary } from './_check.mjs'
import { makeHome, withPlugin, readGhCalls, ghStubScript, orphanHoldsPipes } from './_env-harness.mjs'

const BOUND = 700;                       // 门禁把探测上界压到 700ms
const CAP = BOUND * 4 + 2000;            // 「在设定上界内返回」的判定上限（留出多次探测与进程开销）
const HANG = { hangMs: 30000, exec: false };   // 挂死形状：留一个攥着管道的孙进程（本仓那个坑的原形）

const homes = [];
function home(tag, opts) { const h = makeHome(tag, opts); homes.push(h); return h; }

/** 挂死的 gh 桩（落在夹具 bin 里，PATH 上只有它）。 */
function hangingHome(tag) {
  return home(tag, { withGh: true, gh: { hangAll: HANG, log: true } });
}

/** 「PATH 上没有 gh，但插件缓存那一层躺着一个挂死的 gh」——用来钉 probeCache 粘住那条。 */
function cacheHangingHome(tag) {
  const h = home(tag, { withGh: false });
  const dir = join(h.home, '.dsh', 'gh-cli', 'bin');
  mkdirSync(dir, { recursive: true });
  const log = join(h.home, 'cache-gh-argv.log');
  const p = join(dir, 'gh');
  writeFileSync(p, ghStubScript({ hangAll: HANG, log }), { mode: 0o755 });
  chmodSync(p, 0o755);
  return { ...h, cacheLog: log };
}

/** 记账桩服务：谁打过来就记一笔（并且回一份**像样**的 release JSON，好让版本工具能往下走）。 */
async function countingStub() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tag_name: 'v9.9.9', assets: [] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    hits,
    url: (p) => 'http://127.0.0.1:' + port + p,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** 在夹具环境里驱一次工具，返回 { out, ms }。 */
function drive(h, tool, args = {}, env = {}) {
  const t0 = Date.now();
  return withPlugin(h.home, {
    path: h.path,
    dataDir: join(h.home, '.dsh', 'gh-cli'),
    env: { DSH_GH_PROBE_TIMEOUT_MS: String(BOUND), ...env },
  }, ({ tool: t }) => t(tool).execute(args, {})).then((out) => ({ out, ms: Date.now() - t0 }));
}
const versionsIn = (log) => readGhCalls(log).filter((a) => a[0] === '--version');

// ---------------------------------------------------------------------------
section('① 先自证形状是真的：同一个桩能让纯 spawn 的父进程也等不到 close')
const hShape = hangingHome('probe-shape');
check(await orphanHoldsPipes(join(hShape.bin, 'gh'), ['--version']),
  '「对任何 argv 都挂死」的桩真能钉住一个纯 spawn 的父进程（800ms 内等不到 close）—— 形状不是假的');

// ---------------------------------------------------------------------------
section('② 六个入口：挂死的 gh 也要在设定上界内返回，且结论是「超时」而不是「没装」')
{
  const h = hangingHome('six-resolve');
  const r = await drive(h, 'gh_cli_resolve');
  check(r.ms < CAP, 'gh_cli_resolve 在设定上界内返回（实测 ' + r.ms + 'ms，判定上限 ' + CAP + 'ms）');
  check(r.out.resolved === 'unknown', "resolved 报 'unknown'（不是 'none'——那是「没有 gh」的结论）：" + r.out.resolved);
  check(r.out.autoLandOnNextUse === false, 'autoLandOnNextUse=false：超时不许替用户按「下次自动落地」那个按钮');
  check(r.out.system && r.out.system.timedOut === true, 'system 那次探测如实带 timedOut');
  check(r.out.timedOut === true, '回执顶层也带 timedOut（一眼能看出是第三种事实）');
}
{
  const h = hangingHome('six-status');
  const r = await drive(h, 'gh_cli_status');
  check(r.ms < CAP, 'gh_cli_status 在设定上界内返回（实测 ' + r.ms + 'ms）');
  check(r.out.installed === false && r.out.timedOut === true, 'status 回 { installed:false, timedOut:true }');
  check(/超时/.test(String(r.out.hint)) && /不会在超时时/.test(String(r.out.hint)),
    'hint 说清是超时，并且**不再**承诺「下次会自动落地一份」：' + String(r.out.hint).slice(0, 60) + '…');
  check(/超时/.test(String(r.out.note)), 'note 里是那句「未知」的口径');
}
{
  const h = hangingHome('six-identity');
  const r = await drive(h, 'gh_identity');
  check(r.ms < CAP, 'gh_identity 在设定上界内返回（实测 ' + r.ms + 'ms）');
  const path = (r.out.points || []).find((p) => p.point === 'path') || {};
  const landing = (path.checks || []).find((c) => c.name === 'landing') || {};
  check(landing.detail && landing.detail.timedOut === true, 'landing 检查点带 detail.timedOut');
  check(landing.state !== 'missing', "landing 不报 'missing'（那是「确认没有」）—— 实得 " + landing.state);
  check(/超时/.test(String(path.verdict)), 'path 消费点的结论写的是超时/未知：' + String(path.verdict).slice(0, 50) + '…');
  check(/超时/.test(String(landing.fix)) && !/^gh_cli_install/.test(String(landing.fix)),
    '补救建议不再直接劝人「落地一份」：' + String(landing.fix).slice(0, 50) + '…');
}
{
  const h = hangingHome('six-envprobe');
  const r = await drive(h, 'gh_env_probe', { network_targets: [], attempts: 1, timeout_ms: 300 });
  check(r.ms < CAP + 1500, 'gh_env_probe 在设定上界内返回（实测 ' + r.ms + 'ms）—— 它自称「总预算封顶」，上游那次探测也得有界');
  const gh = (r.out.capabilities || []).find((i) => i.name === 'gh') || {};
  check(gh.state === 'degraded', "env_probe 的 gh 报 degraded（「待确认」），不是 missing（那是「确认没有」）：" + gh.state);
  check(gh.detail && gh.detail.timedOut === true, 'env_probe 的 gh detail 带 timedOut');
  check(/超时/.test(String(gh.next)), 'next 说清是超时：' + String(gh.next).slice(0, 50) + '…');
}
{
  const stub = await countingStub();
  const h = hangingHome('six-version');
  const r = await drive(h, 'gh_cli_version', {}, { DSH_GH_RELEASE_API: stub.url('/release'), DSH_GH_DOWNLOAD_BASE: stub.url('/dl') });
  check(r.ms < CAP + 1500, 'gh_cli_version 在设定上界内返回（实测 ' + r.ms + 'ms）');
  check(r.out.timedOut === true && r.out.layer === 'unknown',
    "version 状态报 layer='unknown'（不是 'none'）：" + r.out.layer);
  await stub.close();
}
{
  const h = hangingHome('six-pr');
  const r = await drive(h, 'gh_pr', { repo: 'o/r', title: 'T', head: 'x' });
  const attempts = r.out.attempts || [];
  check(r.ms < CAP + 1500, 'gh_pr 在设定上界内返回（实测 ' + r.ms + 'ms）—— 它卡在解析那一步时回落也救不了');
  check(r.out.ok === false && attempts.length === 2, 'gh_pr 按失败回，且两条路各留一条记录');
  check(/超时/.test(String(attempts[1] && attempts[1].reason)) && !/这台机器上没有能跑的 gh/.test(String(attempts[1] && attempts[1].reason)),
    '回落那条的原因说的是「探测超时、此刻未知」，不是「没有能跑的 gh」：' + String(attempts[1] && attempts[1].reason).slice(0, 70) + '…');
}

// ---------------------------------------------------------------------------
section('③ 超时**不触发**落地/下载（记账桩收到 0 次请求）')
{
  const stub = await countingStub();
  const h = hangingHome('no-download');
  const env = { DSH_GH_RELEASE_API: stub.url('/release'), DSH_GH_DOWNLOAD_BASE: stub.url('/dl') };
  // install 默认为 true 的入口：老代码在这里会把「超时」读成「这层没有 gh」→ 去下载一份
  const a = await drive(h, 'gh_cli_setup_git', {}, env);
  const b = await drive(h, 'gh_cli_auth_web', { open_browser: false }, env);
  const c = await drive(h, 'gh_cli_status', {}, env);
  check(stub.hits.length === 0, '超时时一个 release/下载请求都没发（实得 ' + stub.hits.length + ' 次：' + JSON.stringify(stub.hits.slice(0, 3)) + '）');
  check(/超时/.test(String(a.out.error)) && !/落地没成功/.test(String(a.out.error)),
    'gh_cli_setup_git 如实报超时，不再说「自带落地没成功」：' + String(a.out.error).slice(0, 60) + '…');
  check(/超时/.test(String(b.out.error)) && !/落地没成功/.test(String(b.out.error)),
    'gh_cli_auth_web 同样如实：' + String(b.out.error).slice(0, 60) + '…');
  check(c.out.timedOut === true, 'gh_cli_status 也走同一条口径');
  await stub.close();
}

// ---------------------------------------------------------------------------
section('④ 超时**不写**记忆、**不写**探测缓存：下一次必须重新探测')
{
  const h = hangingHome('memo-twice');
  await withPlugin(h.home, { path: h.path, dataDir: join(h.home, '.dsh', 'gh-cli'), env: { DSH_GH_PROBE_TIMEOUT_MS: String(BOUND) } },
    async ({ tool }) => { await tool('gh_cli_resolve').execute({}, {}); await tool('gh_cli_resolve').execute({}, {}); });
  const calls = versionsIn(h.ghLog);
  check(calls.length >= 2, '系统层：同一个实例连调两次 → 探测被**重新执行**（桩记到 ' + calls.length + ' 次 --version），没被记忆粘住');
}
{
  const h = cacheHangingHome('cache-twice');
  const out = await withPlugin(h.home, { path: h.path, dataDir: join(h.home, '.dsh', 'gh-cli'), env: { DSH_GH_PROBE_TIMEOUT_MS: String(BOUND) } },
    async ({ tool }) => ({ a: await tool('gh_cli_resolve').execute({}, {}), b: await tool('gh_cli_resolve').execute({}, {}) }));
  const calls = versionsIn(h.cacheLog);
  check(calls.length >= 2, '插件缓存层：绝对路径存在时也**不写** probeCache（桩记到 ' + calls.length + ' 次），没被「一次卡死」粘成长期结论');
  check(out.b.pluginCache && out.b.pluginCache.timedOut === true && out.b.system && out.b.system.timedOut === false,
    '两层分得清：缓存层超时、系统层只是没有（timedOut 各自如实）');
  check(out.b.resolved === 'unknown', "两层都没成、其中一层超时 → resolved='unknown'：立刻回 " + out.b.resolved);
}

// ---------------------------------------------------------------------------
section('⑤ 命令查找那一步也带上界（gh 能跑、但 `command -v` 卡死）')
{
  // 注意：`gh_cli_resolve` 不走 whichCmd（它自己直接探两层）—— 要测这一步得用**走 resolveGh** 的工具（如 status）。
  const h = home('which-hang', { withGh: true });          // 普通富桩：--version 秒回
  const shPath = join(h.bin, 'sh');
  rmSync(shPath, { force: true });                          // 注意：先**删掉软链**再写，别顺着软链写到真 /bin/sh 上
  writeFileSync(shPath, '#!/bin/sh\n/bin/sleep 30\n', { mode: 0o755 });
  chmodSync(shPath, 0o755);
  const r = await drive(h, 'gh_cli_status');
  check(r.ms < CAP, '`command -v gh` 卡死时仍在上界内返回（实测 ' + r.ms + 'ms）—— 解析不会被这一步钉住');
  check(r.out.layer === 'system', 'gh 本身能跑 → 仍如实报 system：' + r.out.layer);
  note('这一步超时后路径沿用既有的 /usr/bin/gh 兜底 —— 那是既有行为，不在本票口径内（要改另开票）。');
}

// ---------------------------------------------------------------------------
section('⑥ 旋钮 DSH_GH_PROBE_TIMEOUT_MS：生效 + 下限钳制')
{
  const h = hangingHome('knob-floor');
  const r = await drive(h, 'gh_cli_status', {}, { DSH_GH_PROBE_TIMEOUT_MS: '1' });
  check(r.ms < 2500, '旋钮=1ms：立刻返回（实测 ' + r.ms + 'ms）');
  check(/100ms/.test(String(r.out.note)), '被钳到下限 100ms，而且结论里报的是**钳后**的值：' + String(r.out.note).slice(0, 60) + '…');
}

// ---------------------------------------------------------------------------
section('⑦ 两处「非工具」路径同样不许把超时读成「没有」：写路径与销毁验收')
{
  // 夹具：PATH 上那份 gh 挂死；**插件缓存那份是好的**（GH_BIN 种一个能答版本的桩）。
  // 老代码会以为「PATH 上没有 gh、缓存里有」→ 往 PATH 目录里写一个软链（**写动作**，
  // 比报错难收回）；修好之后：探测超时 = 未知 → 不据此落 PATH。
  const h = home('wire-landing', { withGh: false });
  const hangDir = join(h.home, 'hang-bin');
  mkdirSync(hangDir, { recursive: true });
  const hangGh = join(hangDir, 'gh');
  writeFileSync(hangGh, ghStubScript({ hangAll: HANG }), { mode: 0o755 });
  chmodSync(hangGh, 0o755);
  const cacheDir = join(h.home, '.dsh', 'gh-cli', 'bin');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, 'gh'), '#!/bin/sh\necho "gh version 9.9.9 (PLANTED-CACHE)"\n', { mode: 0o755 });
  chmodSync(join(cacheDir, 'gh'), 0o755);
  const gitConfig = join(h.home, 'gitconfig');
  writeFileSync(gitConfig, '', { mode: 0o600 });

  const t0 = Date.now();
  const out = await withPlugin(h.home, {
    path: h.bin + ':' + hangDir,          // bin（可写、没有 gh）在前，挂死的那份在后
    dataDir: join(h.home, '.dsh', 'gh-cli'),
    gitConfig,
    env: { DSH_GH_PROBE_TIMEOUT_MS: String(BOUND) },
  }, ({ tool }) => tool('gh_identity').execute({ action: 'wire', consent: true }, {}));
  const ms = Date.now() - t0;
  const landing = (out.results || []).find((r) => r.point === 'path-landing');
  check(ms < CAP + 2000, 'wire 在设定上界内返回（实测 ' + ms + 'ms）');
  check(!landing, '超时**不落 PATH**：path-landing 没出现在写入结果里（实得 ' + JSON.stringify(landing || null) + '）');
  check(!existsSync(join(h.bin, 'gh')), 'PATH 目录里没有多出 gh 软链（没往宿主上写东西）');

  // 对照：**没有超时**时该落还是落 —— 免得把守卫写成「一律不落」
  const hOk = home('wire-landing-ok', { withGh: false });
  const cacheDir2 = join(hOk.home, '.dsh', 'gh-cli', 'bin');
  mkdirSync(cacheDir2, { recursive: true });
  writeFileSync(join(cacheDir2, 'gh'), '#!/bin/sh\necho "gh version 9.9.9 (PLANTED-CACHE)"\n', { mode: 0o755 });
  chmodSync(join(cacheDir2, 'gh'), 0o755);
  const gitConfig2 = join(hOk.home, 'gitconfig');
  writeFileSync(gitConfig2, '', { mode: 0o600 });
  const outOk = await withPlugin(hOk.home, {
    path: hOk.bin, dataDir: join(hOk.home, '.dsh', 'gh-cli'), gitConfig: gitConfig2,
    env: { DSH_GH_PROBE_TIMEOUT_MS: String(BOUND) },
  }, ({ tool }) => tool('gh_identity').execute({ action: 'wire', consent: true }, {}));
  const landingOk = (outOk.results || []).find((r) => r.point === 'path-landing');
  check(Boolean(landingOk && landingOk.ok), '对照：PATH 上确实没有 gh 时，该落的 PATH 落点照落（守卫不是「一律不落」）');
}
{
  // `gh_cli_logout {confirm:true}` 的销毁验收：探测超时时不许谎报「系统 gh 已清掉」。
  const h = hangingHome('logout-verify');
  const gitConfig = join(h.home, 'gitconfig');
  writeFileSync(gitConfig, '', { mode: 0o600 });
  const t0 = Date.now();
  const out = await withPlugin(h.home, {
    path: h.path, dataDir: join(h.home, '.dsh', 'gh-cli'), gitConfig,
    env: { DSH_GH_PROBE_TIMEOUT_MS: String(BOUND) },
  }, ({ tool }) => tool('gh_cli_logout').execute({ confirm: true }, {}));
  const ms = Date.now() - t0;
  check(ms < CAP + 2000, 'gh_cli_logout 在设定上界内返回（实测 ' + ms + 'ms）');
  check(out.verify && out.verify.ghSystemTimedOut === true, 'verify 如实标 ghSystemTimedOut（没把「未知」写成「不存在」）');
  check((out.leftover || []).some((x) => /系统 gh（探测超时/.test(x)), 'leftover 明写「未能确认」，ok 才不会变成「已清干净」：' + JSON.stringify(out.leftover));
  check(out.ok === false, 'ok=false：没确认干净就不许报成功');
}

note('本门禁的三条硬规矩：① 「超时」是第三种事实（既不是 system/plugin-cache，也不是「没有」），六个入口都要说清；'
  + '② 超时**不许**触发下载、**不许**写进任何记忆/缓存 —— 前者换来几十 MB 出网，后者把一次卡死变成长期结论；'
  + '③ 超时**不许**据此写盘（wire 的 PATH 落点）或谎报成功（logout 的销毁验收）。')

note('夹具新增的形状：`makeHome(tag, { withGh: true, gh: { hangAll: { hangMs, exec } } })`（对任何 argv 都挂死）；'
  + '「形状是真的」这条自证由夹具导出的 orphanHoldsPipes() 提供，回落那张票的门禁共用同一支。');

for (const h of homes) h.cleanup();
summary()
