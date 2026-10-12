/**
 * tests/merge/host/update-target.test.mjs —— 更新目标/manifest 指向合并包，且本地 private 状态如实（任务 H · 交付物 3）。
 *
 * 为什么需要它：合并后最危险的一条退化是「更新入口去 npm 上检查/安装**旧 Deck**」——
 * 表现是用户点一次更新就把合并包换回旧的两个插件，而日志里只会看到一次成功的安装。
 * 第二个坑在「身份证验明正身」：它按旧布局（上一层就是包根 + lib/client.js）找根与横幅，
 * 合并包里永远 skip，于是面板版本永远不更新（2026-10-01 那个故障的形状）。
 *
 * 这里用**真 dsh-plugin-update**（根 node_modules 里已安装）+ 临时目录夹具：
 *   - 拦截 fetch，断言联网请求打的是合并包名、**一次都没有**打到旧 Deck 名；
 *   - 在临时 node_modules 下摆合并包与旧 Deck 两种布局，逐个断言验明正身的返回码与写入内容。
 *
 * 隔离：HOME/profileDir 全指向 os.tmpdir()；不读真实 HOME、不写真实文件、不绑端口、不出网。
 *
 * 用法：node tests/merge/host/update-target.test.mjs
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, check, importRel, note, readText, section, skip, summary, tmpDir } from './_check.mjs'

section('1) 更新包可用性（没有依赖就如实 SKIP，不假装通过）')
const hasUpdatePkg = existsSync(join(REPO_ROOT, 'node_modules', 'dsh-plugin-update', 'package.json'))
if (!hasUpdatePkg) {
  skip('node_modules/dsh-plugin-update 未安装：先 root 安装依赖再跑本文件（构建负责人负责）')
}

const identity = await importRel('tools/merge/merge-identity.ts')
const MERGED = identity.MERGED_PACKAGE_NAME
const updateSrc = readText('deck/src/host/updateFromPackage.js')
// 身份融合后旧包名字面量**只许住在共享真源**一处（deck/src/shared/plugin-identity.js）；
// updateFromPackage.js 只 import 它，所以本文件里应当 0 处。
const legacyLitCount = (updateSrc.match(/'dsh-mattpocock-skills-deck'/g) || []).length
check(legacyLitCount === 0, "updateFromPackage.js 里旧 Deck 包名字面量 0 处（改从共享真源取，实际 " + legacyLitCount + "）")
const sharedIdentitySrc = readText('deck/src/shared/plugin-identity.js')
const sharedLegacyCount = (sharedIdentitySrc.match(/'dsh-mattpocock-skills-deck'/g) || []).length
check(sharedLegacyCount === 1, "共享身份真源里旧 Deck 包名字面量恰好 1 处（只作漂移守卫的对照值，实际 " + sharedLegacyCount + "）")
check(updateSrc.includes('targetPackageName: MERGED_PACKAGE_NAME'), 'resolveUpdateConfig 显式传 targetPackageName（不传就落到更新包自带的旧 Deck 默认值）')

if (!hasUpdatePkg) {
  summary()
}

const mod = await importRel('deck/src/host/updateFromPackage.js')

section('2) 身份常量：插件标识合法 + 目标包是合并包')
const assertPluginIdSurface = /^[^/\\\0]+$/
check(typeof mod.UPDATE_PLUGIN_ID === 'string' && mod.UPDATE_PLUGIN_ID.length > 0 && assertPluginIdSurface.test(mod.UPDATE_PLUGIN_ID), 'UPDATE_PLUGIN_ID 不含路径分隔符（更新包的 assertPluginId 硬约束）：' + mod.UPDATE_PLUGIN_ID)
check(mod.MERGED_PACKAGE_NAME === MERGED, 'updateFromPackage 的 MERGED_PACKAGE_NAME = 真源（实际 ' + mod.MERGED_PACKAGE_NAME + '）')
check(mod.DEFAULT_TARGET_PACKAGE === MERGED, 'DEFAULT_TARGET_PACKAGE = 合并包名（实际 ' + mod.DEFAULT_TARGET_PACKAGE + '）')
check(mod.DEFAULT_TARGET_PACKAGE !== mod.LEGACY_DECK_PACKAGE_NAME, 'DEFAULT_TARGET_PACKAGE 不是旧 Deck 包名')
check(mod.__updateTargetsLegacyDeck({ targetPackageName: mod.DEFAULT_TARGET_PACKAGE }) === false, '漂移守卫：当前配置不指向旧 Deck')
check(mod.__updateTargetsLegacyDeck({ targetPackageName: mod.LEGACY_DECK_PACKAGE_NAME }) === true, '漂移守卫：真指回旧 Deck 时返回 true（守卫本身有效）')
check(mod.UPDATE_LOCAL_PRIVATE === true && typeof mod.UPDATE_LOCAL_PRIVATE_HINT === 'string' && mod.UPDATE_LOCAL_PRIVATE_HINT.includes(MERGED), '本地 private 事实与如实文案都导出了：' + mod.UPDATE_LOCAL_PRIVATE_HINT)
check(String(mod.UPDATE_LOCAL_PRIVATE_HINT).includes('npm'), '文案明说更新不走 npm')

section('3) 真建一次电话处理器：更新包接受我们的 pluginId（含 scope 的包名会被拒）')
const quietLog = { fire: () => {} }
let phones = null
let buildErr = null
try {
  mod.__resetSharedUpdateReaderForTests()
  phones = mod.createUpdatePhoneHandlers({ ctx: null, logCtx: quietLog })
} catch (e) {
  buildErr = String((e && e.message) || e)
}
check(!!phones && buildErr === null, 'createUpdatePhoneHandlers 建起来了（pluginId 未触发 assertPluginId）：' + (buildErr || ''))
if (phones) {
  const names = phones.phoneNames || {}
  check(names.updateStatus === 'wf.updateStatus' && names.updateCheck === 'wf.updateCheck' && names.updateInstall === 'wf.updateInstall' && names.updateChangelog === 'wf.updateChangelog', '四个电话名仍是 wf.*（契约未变）：' + JSON.stringify(names))
  check(['handleUpdateStatus', 'handleUpdateCheck', 'handleUpdateInstall', 'handleUpdateChangelog'].every((k) => typeof phones[k] === 'function'), '四个处理入口都是函数')
}

section('4) 联网查新版：请求打合并包名，一次都不打旧 Deck')
let checkedUrls = []
let checkResult = null
if (phones) {
  mod.__resetSharedUpdateReaderForTests()
  const home = tmpDir('upd-home')
  const profile = tmpDir('upd-profile')
  const fetchImpl = async (url) => {
    checkedUrls.push(String(url))
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{"error":"Not found"}' }
  }
  const isolated = mod.createUpdatePhoneHandlers({
    ctx: null,
    logCtx: quietLog,
    readerOverrides: { runningVersion: '1.6.4', profileDir: profile, homeDir: home, fetchImpl, registryUrl: 'https://registry.npmjs.org/' },
  })
  checkResult = await isolated.handleUpdateCheck({})
  check(!!checkResult, '查新版返回了对象（没有抛）')
  check(checkedUrls.length >= 1, '查新版确实发出过一次联网请求（夹具拦到 ' + checkedUrls.length + ' 条）')
  const hitLegacy = checkedUrls.filter((u) => u.includes(mod.LEGACY_DECK_PACKAGE_NAME))
  check(hitLegacy.length === 0, '没有任何请求打到旧 Deck 包名（实际 ' + JSON.stringify(hitLegacy) + '）')
  const hitMerged = checkedUrls.filter((u) => u.includes('dsh-github-resident-v2'))
  check(hitMerged.length === checkedUrls.length, '所有请求都指向合并包名：' + JSON.stringify(checkedUrls))
  note('查新版结果 ok=' + (checkResult && checkResult.ok) + '（404 被如实吸收，不伪称成功）')
}

section('4b) 使用范围目录探测：链接式安装也要认得出（票 #10 回归）')
// 为什么单开这一段：**生产路径**（不注入 readerOverrides.profileDir）正是 2026-10-12 报
// `unknown-profile` 的那条路 —— 更新包靠「路径里有没有 /node_modules/<包名>」倒推使用范围目录，
// 而链接式安装 realpath 后落在源码工作区，永远命中不了那个标记。宿主必须自己把目录交出去。
{
  const mkWorkspace = async (tag) => {
    const ws = tmpDir('ws-' + tag)
    await writeFile(join(ws, 'package.json'), JSON.stringify({ name: MERGED, version: '1.7.0' }, null, 2) + '\n', 'utf8')
    return ws
  }
  // 真安装形态：profile/node_modules/<包名> 是指向工作区的**符号链接**（本机就是这么装的）
  const mkLinkedProfile = async (home, name, ws) => {
    const prof = join(home, '.dsh', 'profiles', name)
    await mkdir(join(prof, 'node_modules', '@local'), { recursive: true })
    await symlink(ws, join(prof, 'node_modules', MERGED), 'dir')
    return prof
  }

  const home1 = tmpDir('home1')
  const ws1 = await mkWorkspace('a')
  const prof1 = await mkLinkedProfile(home1, 'web', ws1)
  check(
    mod.__detectProfileDir({}, home1) === prof1,
    '链接式安装（node_modules 下是符号链接）也能认出使用范围目录：' + mod.__detectProfileDir({}, home1)
  )

  // 环境变量优先：宿主自己报的目录最准，哪怕它指的不是扫描会命中的那一个
  check(
    mod.__detectProfileDir({ DSH_PROFILE_DIR: '/explicit/scope' }, home1) === '/explicit/scope',
    'DSH_PROFILE_DIR 优先于扫描结果'
  )
  check(
    mod.__detectProfileDir({ DSH_PROFILE_DIR: '   ' }, home1) === prof1,
    'DSH_PROFILE_DIR 只有空白时按缺失处理，退回扫描（不把空白当目录）'
  )

  // 扫不到就如实回 null：绝不猜一个目录出来（猜错会把更新写进别的使用范围）
  const home2 = tmpDir('home2')
  check(mod.__detectProfileDir({}, home2) === null, '没有 profile 装着本包时回 null（不猜）')
  check(mod.__detectProfileDir({}, join(home2, 'nope')) === null, '家目录不存在时回 null，不抛错')
  check(mod.__detectProfileDir({}, '') === null, '家目录为空时回 null，不抛错')

  // 多份使用范围并存时，认的是「那个目录里真装着本包」，不是目录名
  const home3 = tmpDir('home3')
  await mkdir(join(home3, '.dsh', 'profiles', 'desktop'), { recursive: true })
  const ws3 = await mkWorkspace('c')
  const prof3 = await mkLinkedProfile(home3, 'web', ws3)
  check(mod.__detectProfileDir({}, home3) === prof3, '空壳使用范围（desktop）不会被误认成本包的家')

  // 生产路径必须真的调用它：源码里不能只剩一个没人用的探测器
  const callsDetector = /__detectProfileDir\s*\(/.test(updateSrc.replace(/export function __detectProfileDir[\s\S]*?\n}\n/, ''))
  check(callsDetector, 'createUpdatePhoneHandlers 那条路真的调用了探测（不是只导出不用）')
}

section('4c) 不注入使用范围目录时，不再退化成 unknown-profile（票 #10 的原始现象）')
{
  const home = tmpDir('home-noprof')
  const ws = tmpDir('ws-noprof')
  await writeFile(join(ws, 'package.json'), JSON.stringify({ name: MERGED, version: '1.7.0' }, null, 2) + '\n', 'utf8')
  const prof = join(home, '.dsh', 'profiles', 'web')
  await mkdir(join(prof, 'node_modules', '@local'), { recursive: true })
  await symlink(ws, join(prof, 'node_modules', MERGED), 'dir')

  // 这一段是本次修复的**原始现象**回归：宿主在生产形状（只给 DSH_PROFILE_DIR、不注入 profileDir）下
  // 打一次查状态，不允许再出现 unknown-profile。允许后续档位（如 invalid-installation）如实出现。
  const savedProfileDir = process.env.DSH_PROFILE_DIR
  const savedHome = process.env.DSH_HOME
  mod.__resetSharedUpdateReaderForTests()
  process.env.DSH_PROFILE_DIR = prof
  process.env.DSH_HOME = home
  let status = null
  let threw = null
  try {
    const prodShaped = mod.createUpdatePhoneHandlers({ ctx: null, logCtx: quietLog })
    status = await prodShaped.handleUpdateStatus({})
  } catch (e) {
    threw = e
  } finally {
    if (savedProfileDir === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = savedProfileDir
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    mod.__resetSharedUpdateReaderForTests()
  }
  check(threw === null, '生产形状下查状态没有抛错' + (threw ? '：' + String(threw && threw.message) : ''))
  check(!!status, '生产形状下查状态回了对象')
  check(
    !status || status.error !== 'unknown-profile',
    '不再退化成 unknown-profile（实际 error = ' + (status ? status.error : '(无回包)') + '）'
  )
}

section('5) 身份证验明正身：合并包布局（根按包名向上找 + dist/client.js 横幅）')
const PKG_JSON = (name, version) => JSON.stringify({ name, version, private: true, type: 'module' }, null, 2) + '\n'
const CLIENT_JS = (v) => "const DSW_VERSION = '" + v + "';\n"

async function makeInstalled(tag, opts) {
  const root = tmpDir(tag)
  const pkgDir = join(root, 'node_modules', opts.dirName)
  await mkdir(join(pkgDir, 'deck', 'src', 'host'), { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), PKG_JSON(opts.name, opts.version), 'utf8')
  if (opts.bannerIn === 'dist') {
    await mkdir(join(pkgDir, 'dist'), { recursive: true })
    await writeFile(join(pkgDir, 'dist', 'client.js'), CLIENT_JS(opts.banner), 'utf8')
  } else if (opts.bannerIn === 'lib') {
    await mkdir(join(pkgDir, 'lib'), { recursive: true })
    await writeFile(join(pkgDir, 'lib', 'client.js'), CLIENT_JS(opts.banner), 'utf8')
  }
  return { root, pkgDir, moduleDir: join(pkgDir, 'deck', 'src', 'host') }
}

/** 记录读过哪些路径的 io（委派给真 fs）。 */
function recordingIo() {
  const reads = []
  return {
    reads,
    io: {
      readFile: (p, enc) => {
        reads.push(String(p))
        return readFile(p, enc)
      },
      writeFile: (p, data, enc) => writeFile(p, data, enc),
    },
  }
}

{
  const inst = await makeInstalled('sync-ok', { dirName: MERGED, name: MERGED, version: '1.6.0', bannerIn: 'dist', banner: '1.6.5' })
  const rec = recordingIo()
  const ver = await mod.__syncInstalledManifest({ moduleDir: inst.moduleDir, targetVersion: '1.6.5', io: rec.io, log: null })
  check(ver === 'synced', '合并包布局：身份证补到横幅版本（实际 ' + ver + '）')
  const after = JSON.parse(await readFile(join(inst.pkgDir, 'package.json'), 'utf8'))
  check(after.version === '1.6.5' && after.name === MERGED && after.private === true, '只改了 version 一个字段（name/private 原样）')
  check(rec.reads.some((p) => p.endsWith(join('dist', 'client.js'))), '横幅读的是 dist/client.js（合并包的产物位置）')
}

{
  // 旧布局只把横幅放在 lib/client.js：合并包这边仍要能兜住（行为保留），但要靠候选回退而不是唯一路径。
  const inst = await makeInstalled('sync-lib', { dirName: MERGED, name: MERGED, version: '1.6.0', bannerIn: 'lib', banner: '1.6.5' })
  const rec = recordingIo()
  const ver = await mod.__syncInstalledManifest({ moduleDir: inst.moduleDir, targetVersion: '1.6.5', io: rec.io, log: null })
  check(ver === 'synced', '横幅只在 lib/client.js 时也能补（候选回退，实际 ' + ver + '）')
  check(rec.reads.some((p) => p.endsWith(join('dist', 'client.js'))) && rec.reads.some((p) => p.endsWith(join('lib', 'client.js'))), '先试 dist/client.js 再试 lib/client.js（顺序可核对）')
}

section('6) 身份证验明正身的其它档位')
{
  const inst = await makeInstalled('sync-same', { dirName: MERGED, name: MERGED, version: '1.6.5', bannerIn: 'dist', banner: '1.6.5' })
  const ver = await mod.__syncInstalledManifest({ moduleDir: inst.moduleDir, targetVersion: '1.6.5', io: { readFile, writeFile }, log: null })
  check(ver === 'skip:already', '版本相同 → skip:already（实际 ' + ver + '）')
}
{
  const inst = await makeInstalled('sync-older', { dirName: MERGED, name: MERGED, version: '1.6.6', bannerIn: 'dist', banner: '1.5.0' })
  const ver = await mod.__syncInstalledManifest({ moduleDir: inst.moduleDir, targetVersion: '1.5.0', io: { readFile, writeFile }, log: null })
  check(ver === 'skip:not-older', '目标更旧 → skip:not-older（永不降级，实际 ' + ver + '）')
}
{
  const inst = await makeInstalled('sync-banner', { dirName: MERGED, name: MERGED, version: '1.6.0', bannerIn: 'dist', banner: '1.6.4' })
  const ver = await mod.__syncInstalledManifest({ moduleDir: inst.moduleDir, targetVersion: '1.6.5', io: { readFile, writeFile }, log: null })
  check(ver === 'skip:banner-mismatch', '横幅对不上 → skip:banner-mismatch（安装半截子不认，实际 ' + ver + '）')
}
{
  const ver = await mod.__syncInstalledManifest({ moduleDir: join(REPO_ROOT, 'deck', 'src', 'host'), targetVersion: '1.6.5', io: { readFile, writeFile }, log: null })
  check(ver === 'skip:not-installed-copy', '不在已装目录（源码仓）→ skip:not-installed-copy（实际 ' + ver + '）')
}
{
  const ver = await mod.__syncInstalledManifest({ moduleDir: '/nowhere/node_modules/x', targetVersion: 'not-a-version', io: { readFile, writeFile }, log: null })
  check(ver === 'skip:no-target', '目标版本不合法 → skip:no-target（实际 ' + ver + '）')
}
check(mod.__bannerVersionOf(CLIENT_JS('9.9.9')) === '9.9.9' && mod.__bannerVersionOf('nothing here') === null, '__bannerVersionOf 正负例都对')

section('7) 旧 Deck 已装副本不再被认领（不把更新写进旧包）')
{
  const inst = await makeInstalled('sync-legacy', { dirName: mod.LEGACY_DECK_PACKAGE_NAME, name: mod.LEGACY_DECK_PACKAGE_NAME, version: '1.6.0', bannerIn: 'lib', banner: '1.6.5' })
  const before = await readFile(join(inst.pkgDir, 'package.json'), 'utf8')
  const ver = await mod.__syncInstalledManifest({ moduleDir: inst.moduleDir, targetVersion: '1.6.5', io: { readFile, writeFile }, log: null })
  const after = await readFile(join(inst.pkgDir, 'package.json'), 'utf8')
  check(ver === 'skip:no-manifest', '旧 Deck 副本 → 根本找不到合并包根，直接 skip:no-manifest（实际 ' + ver + '）')
  check(ver.startsWith('skip:'), '旧 Deck 副本永远不会被认领（实际 ' + ver + '）')
  check(before === after, '旧 Deck 的身份证一个字节都没动')
}

summary()
