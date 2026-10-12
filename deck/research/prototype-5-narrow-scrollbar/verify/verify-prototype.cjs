/* 验证件：把原型页面在真 Chromium（1208，容器自带）里跑一遍 —— 截图 + 量数 + 页面自检读数。
   跑法：cd deck/research/prototype-5-narrow-scrollbar/verify
         npm i playwright@1.56.0 --prefix /tmp/pwproto   # 只装一处，别动仓库
         NODE_PATH=/tmp/pwproto/node_modules node verify-prototype.cjs
   环境变量：PROTO=原型 HTML 路径（缺省 = ../narrow-scrollbar-PROTOTYPE.html），OUT=截图输出目录 */
const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright')

const PROTO = process.env.PROTO || '/root/local-dsh-github-resident-v2/deck/research/prototype-5-narrow-scrollbar/narrow-scrollbar-PROTOTYPE.html'
const OUT = process.env.OUT || path.join(__dirname, '..', 'screenshots-raw')
const EXEC = process.env.HOME + '/.cache/ms-playwright/chromium-1208/chrome-linux/chrome'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=2'] })
  const page = await browser.newPage({ viewport: { width: 1240, height: 1500 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false })
  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })

  await page.goto('file://' + PROTO)
  await page.waitForTimeout(400)

  const api = await page.evaluate(() => ({ hasModel: !!window.CAPMODEL, steps: window.CAPMODEL ? window.CAPMODEL.buildLadder().steps.length : -1 }))
  console.log('纯模块在否：', api.hasModel, '· 阶梯档位：', api.steps)

  const shot = async (name, sel) => {
    const el = sel ? await page.$(sel) : null
    const file = path.join(OUT, name)
    await (el ? el.screenshot({ path: file }) : page.screenshot({ path: file, fullPage: false }))
    const kb = Math.round(fs.statSync(file).size / 1024)
    console.log('截图', name, kb + 'KB')
    return file
  }

  // 1) 初态：393px 触屏（这颗手机框是量几何用的那一颗）
  await shot('shot-01-393-initial.png', '#phone')
  // 2) 滚到右端
  await page.click('text=滚到右端')
  await page.waitForTimeout(150)
  await shot('shot-02-393-scrolled-right.png', '#phone')
  // 3) 不钉 + 滚到右端
  await page.click('text=不钉')
  await page.waitForTimeout(120)
  await shot('shot-03-393-pin-off.png', '#phone')
  // 4) 钉住 + 渐隐 + 点开可接菜单
  await page.click('text=钉住+渐隐')
  await page.click('text=点开「可接」菜单（点第二次才收起）')
  await page.waitForTimeout(150)
  await shot('shot-04-393-menu-open.png', '#phone')
  const clampGeom = await page.$eval('[data-pop]', n => { const r = n.getBoundingClientRect(); const lane = n.closest('.cap-lane').getBoundingClientRect(); return { overflowRight: Math.round(r.right - lane.right), overflowLeft: Math.round(lane.left - r.left) } })
  console.log('弹层（夹取）越界：', JSON.stringify(clampGeom))
  // 5) 只按锚点定位（会越界）
  await page.click('text=只按锚点（会越界）')
  await page.waitForTimeout(150)
  const naiveGeom = await page.$eval('[data-pop]', n => { const r = n.getBoundingClientRect(); const lane = n.closest('.cap-lane').getBoundingClientRect(); return { overflowRight: Math.round(r.right - lane.right), overflowLeft: Math.round(lane.left - r.left) } })
  console.log('弹层（只按锚点）越界：', JSON.stringify(naiveGeom))
  await shot('shot-05-393-menu-naive-overflow.png', '#phone')
  // 6) 320px 收到底
  await page.click('text=夹取（不越界）')
  await page.click('text=320（下限）')
  await page.waitForTimeout(150)
  await shot('shot-06-320-bottomed.png', '#phone')
  // 7) 320px + 黄条 + 触屏命中框
  await page.click('text=出黄条')
  await page.waitForTimeout(150)
  await shot('shot-07-320-banner-hits.png', '#phone')
  // 8) 整页（给票上挂的那份外观）
  await page.click('text=393（真机竖屏）')
  await page.click('text=收黄条')
  await page.waitForTimeout(200)
  await shot('shot-08-page-full.png')

  const st = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#state-panel tr')).map(tr => tr.querySelector('th').textContent + ' = ' + tr.querySelector('td').textContent)
    const self = Array.from(document.querySelectorAll('#selftest span')).map(s => s.textContent.trim())
    const hit = Array.from(document.querySelectorAll('.hitbox')).map(n => n.getBoundingClientRect().height)
    return { rows, self, hitHeights: hit, laneH: document.querySelector('.cap-lane').getBoundingClientRect().height }
  })
  console.log('--- 状态面板 ---')
  st.rows.forEach(r => console.log(' ', r))
  console.log('--- 页面自检 ---')
  st.self.forEach(s => console.log(' ', s))
  console.log('命中框高度（现状）：', JSON.stringify(st.hitHeights), '· 横条高：', Math.round(st.laneH))
  console.log('页面错误：', errors.length ? errors : '无')
  await browser.close()
  if (errors.length) process.exit(2)
})().catch(e => { console.error('VERIFY FAILED', e); process.exit(1) })
