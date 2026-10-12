/**
 * tests/merge/host/skill-discovery.test.mjs —— 27 个随包技能在「开发检出」与「打包解压后」都能被发现并读到原文（任务 H · 交付物 2）。
 *
 * 为什么需要它：合并前技能根的候选全是按 `process.cwd()` 与固定的
 * `node_modules/dsh-mattpocock-skills-deck/bundled-skills` 写的；合并后包名变了，**而且**技能根换到了
 * `<包根>/deck/package/bundled-skills`（不再是包根的 `bundled-skills`）。只把旧包名替换一遍会得到一个
 * 「名字对了、路径还是错的」的假通过。所以这里既验计数，也验**解析出来的目录真的是那一份**：
 *   - 开发检出：直接从 `deck/src/host/` 跑，期望解析到 `<repo>/deck/package/bundled-skills`；
 *   - 打包形态：把 bootstrap.js 与 skillDoc.js 复制进临时目录的 `<tmp>/deck/src/host/`，技能目录用
 *     **符号链接**指到真实随包目录，断言解析到的是**临时目录里那一份**（说明是按模块自身位置找的，
 *     不是碰巧撞上 cwd）；
 *   - 构建形态：同一份源码放在 `<tmp>/deck/package/lib/`（deck 构建把 src/host 扁平到 package/lib）。
 *
 * 只读检查：临时目录写在 os.tmpdir() 下（进程退出自动清理），不读真实 HOME、不联网、不写真实 HOME。
 *
 * 用法：node tests/merge/host/skill-discovery.test.mjs
 */
import { copyFileSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { REPO_ROOT, check, importAbs, importRel, note, readJson, section, summary, tmpDir } from './_check.mjs'

const BUNDLED_REAL = join(REPO_ROOT, 'deck', 'package', 'bundled-skills')

/** 只记录 provider 的假 skills 服务。 */
function makeSkillsCtx(captured) {
  return {
    get: (key) => {
      if (key === 'skills') {
        return {
          registerProvider: (factory) => {
            captured.factory = factory
            return () => {
              captured.disposed = true
            }
          },
        }
      }
      if (key === 'logger') return { warn: () => {}, info: () => {} }
      return undefined
    },
    effect: (cb) => {
      try {
        cb()
      } catch {
        /* 登记失败不影响本用例 */
      }
      return () => {}
    },
  }
}

/** 在临时目录里摆一个「合并包布局」：<tmp>/package.json + 技能目录（按 where 决定挂在包根还是 deck/package 下）。 */
function makeLayout(tag, relDir, where) {
  const tmp = tmpDir(tag)
  copyFileSync(join(REPO_ROOT, 'package.json'), join(tmp, 'package.json'))
  const hostDir = join(tmp, relDir)
  mkdirSync(hostDir, { recursive: true })
  copyFileSync(join(REPO_ROOT, 'deck', 'src', 'host', 'bootstrap.js'), join(hostDir, 'bootstrap.js'))
  copyFileSync(join(REPO_ROOT, 'deck', 'src', 'host', 'skillDoc.js'), join(hostDir, 'skillDoc.js'))
  const linkParent = where === 'root' ? tmp : join(tmp, 'deck', 'package')
  mkdirSync(linkParent, { recursive: true })
  symlinkSync(BUNDLED_REAL, join(linkParent, 'bundled-skills'), 'dir')
  return { tmp, bootstrap: join(hostDir, 'bootstrap.js'), skillDoc: join(hostDir, 'skillDoc.js') }
}

/** 跑一次 provider 装配，返回 { names, list, dir }；dir 从第一条 list 结果的 locator 里读。 */
async function discoverWith(bootstrapAbs) {
  const captured = {}
  const bootMod = await importAbs(bootstrapAbs)
  bootMod.createBootstrap({ ctx: makeSkillsCtx(captured) })
  await new Promise((r) => setTimeout(r, 250))
  if (!captured.factory) return { factory: null, provider: null, names: [], list: [], dir: null }
  const provider = captured.factory({})
  const list = await provider.list({})
  const names = list.map((s) => s.name).sort()
  const dir = list.length && list[0].locator ? list[0].locator.directory : null
  return { factory: captured.factory, provider, names, list, dir }
}

section('1) 随包技能目录本体：27 个技能 + VERSION/LICENSE')
const entries = readdirSync(BUNDLED_REAL, { withFileTypes: true })
const skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
check(skillDirs.length === 27, 'deck/package/bundled-skills 下 27 个技能目录（实际 ' + skillDirs.length + '）')
check(entries.some((e) => e.name === 'VERSION'), 'bundled-skills/VERSION 在')
check(entries.some((e) => e.name === 'LICENSE'), 'bundled-skills/LICENSE 在')
check(skillDirs.includes('wayfinder'), 'wayfinder 在（发现逻辑的锚技能）')

section('2) 开发检出：从 deck/src/host/ 装配，解析到随包那一份')
const identity = await importRel('tools/merge/merge-identity.ts')
const dev = await discoverWith(join(REPO_ROOT, 'deck', 'src', 'host', 'bootstrap.js'))
check(!!dev.factory, 'provider 工厂被注册（ctx.get("skills") 有服务时）')
check(dev.names.length === 27, '开发检出发现 27 个技能（实际 ' + dev.names.length + '）')
const devRootRel = dev.dir ? relative(REPO_ROOT, dirname(dev.dir)).split(sep).join('/') : '(无)'
// 关键：解析出来的根必须是**构建负责人声明过、且在 files 白名单里**的那两个位置之一，
// 不能是随便一个恰好叫 bundled-skills 的目录（任务要求：按实际打包位置解析，不靠假设）。
check(
  devRootRel === identity.BUNDLED_SKILLS_SRC || devRootRel === identity.BUNDLED_SKILLS_OUT,
  '开发检出解析到的技能根是声明的两个位置之一（实际 ' + devRootRel + '；声明 ' + identity.BUNDLED_SKILLS_SRC + ' | ' + identity.BUNDLED_SKILLS_OUT + '）',
)
check(readJson('package.json').files.some((e) => e === devRootRel + '/' || e === devRootRel), '解析到的技能根在根 package.json 的 files 白名单里（' + devRootRel + '）')
check(dev.list.every((s) => s.source === 'bundled' && s.rank === 350 && s.provider === 'bundled-mattpocock'), '每条都带 source=bundled / rank=350 / provider=bundled-mattpocock')
check(dev.list.every((s) => s.locator && s.locator.path && s.locator.path.endsWith('SKILL.md')), '每条都带 SKILL.md 的定位符')

section('3) provider.get() 真的能读到内容与目录基座')
const wayfinder = dev.list.find((s) => s.name === 'wayfinder')
const got = await dev.provider.get(wayfinder, {})
check(!!got && typeof got.content === 'string' && got.content.length > 100, 'get(wayfinder) 回正文（' + ((got && got.content) || '').length + ' 字节）')
check(!!got && got.resourceBase && got.resourceBase.kind === 'directory', 'get() 带 resourceBase（技能资源目录）')
const notMine = await dev.provider.get({ name: 'nope', locator: { path: join(BUNDLED_REAL, 'wayfinder', 'SKILL.md') } }, {})
check(notMine === undefined, '名单外的名字回 undefined（不串技能）')

section('4) 打包形态：技能在 deck/package 下（<tmp>/deck/src/host）也能找到')
const packed = makeLayout('packed', join('deck', 'src', 'host'), 'package')
const packedRes = await discoverWith(packed.bootstrap)
check(packedRes.names.length === 27, '打包形态（技能在 deck/package）发现 27 个技能（实际 ' + packedRes.names.length + '）')
check(!!packedRes.dir && packedRes.dir.startsWith(packed.tmp), '解析到的目录在临时包根下（说明是模块相对解析，实际 ' + packedRes.dir + '）')
const packedDocMod = await importAbs(packed.skillDoc)
const packedDoc = packedDocMod.createSkillDoc({})
const packedRead = await packedDoc.readDoc({ name: 'wayfinder' })
check(packedRead.ok === true && packedRead.path.startsWith(packed.tmp), '打包形态 skillDoc.readDoc 也读到临时包根下的原文（实际 ' + packedRead.path + '）')

section('4b) 发布位置：技能只在包根 bundled-skills/（构建负责人的声明位置）也能找到')
const rootOnly = makeLayout('rootonly', join('deck', 'src', 'host'), 'root')
const rootRes = await discoverWith(rootOnly.bootstrap)
check(rootRes.names.length === 27, '只有包根 bundled-skills/ 时也发现 27 个技能（实际 ' + rootRes.names.length + '）')
check(!!rootRes.dir && rootRes.dir.startsWith(join(rootOnly.tmp, 'bundled-skills')), '解析到的是包根那一份（实际 ' + rootRes.dir + '）')
const rootDocMod = await importAbs(rootOnly.skillDoc)
const rootRead = await rootDocMod.createSkillDoc({}).readDoc({ name: 'code-review' })
check(rootRead.ok === true && rootRead.path.startsWith(rootOnly.tmp), '包根形态下 skillDoc 也读得到（实际 ' + rootRead.path + '）')

section('5) 构建形态（<tmp>/deck/package/lib）：同样能找到')
const built = makeLayout('built', join('deck', 'package', 'lib'), 'package')
const builtRes = await discoverWith(built.bootstrap)
check(builtRes.names.length === 27, '构建形态发现 27 个技能（实际 ' + builtRes.names.length + '）')
check(!!builtRes.dir && builtRes.dir.startsWith(built.tmp), '构建形态解析到临时包根下（实际 ' + builtRes.dir + '）')

section('6) skillDoc.readDoc：27 个技能逐个可读 + 非法输入不越界')
const docMod = await importRel('deck/src/host/skillDoc.js')
const doc = docMod.createSkillDoc({})
let readable = 0
let zhCount = 0
for (const name of skillDirs) {
  const r = await doc.readDoc({ name })
  if (r && r.ok === true && typeof r.md === 'string' && r.md.trim()) readable += 1
  if (r && r.mdZh) zhCount += 1
}
check(readable === 27, '27 个技能全部 readDoc 成功（实际 ' + readable + '）')
note('带中文译文的技能数：' + zhCount)
const traversal = await doc.readDoc({ name: '../../etc/passwd' })
check(traversal.ok === false && traversal.missing === true, '路径穿越名被拒（../../etc/passwd）')
const dotdot = await doc.readDoc({ name: '..' })
check(dotdot.ok === false, '名字 .. 被拒')
const empty = await doc.readDoc({})
check(empty.ok === false, '空参数被拒而不是抛错')
const ghost = await doc.readDoc({ name: 'no-such-skill-xyz' })
check(ghost.ok === false && ghost.missing === true, '不存在的技能回 missing:true（不抛）')
const longName = await doc.readDoc({ name: 'a'.repeat(200) })
check(longName.ok === false, '超长名字被拒')

summary()
