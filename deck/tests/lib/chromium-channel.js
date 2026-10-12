// chromium-channel.js — 真渲染门禁共用的浏览器通道（票「恢复一条能跑的真渲染验收通道」）
//
// 为什么需要它（2026-10-12 本机实测）：
//   1. 本容器**没有 /dev/shm**（`mkdir /dev/shm` → Permission denied）。chromium 默认把共享内存放在
//      /dev/shm，起不来或起来就崩 —— 必须带 `--disable-dev-shm-usage`。
//   2. playwright 默认只认它自己那一版 revision：1.62.1 找 `chromium_headless_shell-1234`、1.58.2 找
//      它那一版；本机缓存里没有那些目录，于是默认解析直接报
//      `browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1234/...`。
//      本机缓存里**能起来的**是 `~/.cache/ms-playwright/chromium-1208/chrome-linux/chrome`（Chromium 145.0.7632.0），
//      所以要以可执行文件路径显式指过去。
//
// 通道解析顺序（越靠前越硬）：
//   1. `DSH_TEST_CHROMIUM=<可执行文件绝对路径>` —— 人指定，最高优先
//   2. `~/.cache/ms-playwright/chromium-<rev>/chrome-linux/chrome` —— 按 rev 数字倒序（先新的）
//   3. `~/.cache/ms-playwright/chromium_headless_shell-<rev>/chrome-linux/headless_shell`
//   4. 都没有 → 不传 executablePath，交回 playwright 默认解析（本机大概率报上面那条 exists 错）
// 逐个候选真起一次，谁先起来用谁；全起不来才抛错，并把每个候选的失败原因列出来。
//
// 启动参数：`--no-sandbox`（容器里是 root）+ `--disable-dev-shm-usage`（/dev/shm 缺失，必需）。
//
// 用法：
//   import { launchChromium, describeChannel } from './lib/chromium-channel.js'
//   const browser = await launchChromium()          // 默认 headless + 上面那两条参数
//   console.log(describeChannel())                  // 打通道自述，便于把「用的哪个浏览器」写进日志
// 想换通道：`DSH_TEST_CHROMIUM=/path/to/chrome node deck/tests/xxx.js`。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CACHE = process.env.DSH_TEST_PW_CACHE || path.join(os.homedir(), '.cache', 'ms-playwright')

function listByPattern(re, leaf) {
  let names = []
  try {
    names = fs.readdirSync(CACHE)
  } catch {
    return []
  }
  return names
    .map((n) => {
      const m = re.exec(n)
      return m ? { rev: Number(m[1]), exe: path.join(CACHE, n, 'chrome-linux', leaf) } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.rev - a.rev)
    .map((x) => x.exe)
    .filter((p) => fs.existsSync(p))
}

/** 候选可执行文件，按优先级排序（人指定的排最前）。 */
export function candidates() {
  const out = []
  if (process.env.DSH_TEST_CHROMIUM) out.push(process.env.DSH_TEST_CHROMIUM)
  out.push(...listByPattern(/^chromium-(\d+)$/, 'chrome'))
  out.push(...listByPattern(/^chromium_headless_shell-(\d+)$/, 'headless_shell'))
  return out.filter((p) => {
    try {
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  })
}

/** 通道参数：容器 root + 无 /dev/shm，这两条不是可选装饰。 */
export function launchArgs(extra = []) {
  return ['--no-sandbox', '--disable-dev-shm-usage', ...extra]
}

async function playwrightModule() {
  const spec = process.env.DSH_TEST_PLAYWRIGHT
  if (spec) return import(spec)
  try {
    return await import('playwright')
  } catch (e) {
    throw new Error(
      '找不到 playwright 模块（' + String(e.message).split('\n')[0] + '）。' +
        '在仓库根跑 `npm install`（devDependencies 里有 playwright），' +
        '或设 DSH_TEST_PLAYWRIGHT=<playwright 包的绝对路径或路径前缀>。',
    )
  }
}

/**
 * 起一个真浏览器。opts 里给 executablePath 就只用它，否则按 candidates() 逐个试。
 * 返回的 browser 上挂了一个 __channel 字段，写明这次用的是哪条通道。
 */
export async function launchChromium(opts = {}) {
  const { executablePath, args = [], ...rest } = opts
  const { chromium } = await playwrightModule()
  const tries = executablePath ? [executablePath] : candidates()
  const list = tries.length ? tries : [undefined]
  const failures = []
  for (const exe of list) {
    try {
      const browser = await chromium.launch({ headless: true, ...rest, executablePath: exe, args: launchArgs(args) })
      browser.__channel = exe || '(playwright 默认解析)'
      return browser
    } catch (e) {
      failures.push((exe || '(playwright 默认解析)') + ' → ' + String(e.message).split('\n')[0])
    }
  }
  throw new Error(
    '真渲染通道起不来，试过 ' + list.length + ' 个候选：\n  ' + failures.join('\n  ') +
      '\n本机可用通道（实测）：~/.cache/ms-playwright/chromium-1208/chrome-linux/chrome + --disable-dev-shm-usage。',
  )
}

/** 一行通道自述：用的哪个可执行文件、带了哪些参数。 */
export function describeChannel() {
  const list = candidates()
  return (
    'chromium 通道：' + (list[0] || '(playwright 默认解析)') +
    ' | 参数 ' + launchArgs().join(' ') +
    ' | 候选 ' + list.length + ' 个' + (list.length > 1 ? '（' + list.slice(1).join(', ') + '）' : '')
  )
}
