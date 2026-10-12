/* 设备分线复验：手机 / 平板 / 桌面各打开一次，量「收不收字、行高、命中、提示」。 */
const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright')
const REPO = '/root/local-dsh-github-resident-v2/deck/research/prototype-5-narrow-scrollbar'
const PROTO = path.join(REPO, 'narrow-scrollbar-PROTOTYPE.html')
const OUT = process.env.OUT || path.join(REPO, 'measurements')
const EXEC = process.env.HOME + '/.cache/ms-playwright/chromium-1208/chrome-linux/chrome'

;(async () => {
  const b = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const cases = [
    { w: 393, tag: 'phone', file: 'm5-393-手机线.png' },
    { w: 834, tag: 'tablet', file: 'm6-834-平板线.png' },
    { w: 1280, tag: 'desktop', file: 'm7-1280-桌面线.png' },
  ]
  const rows = []
  for (const c of cases) {
    const p = await b.newPage({ viewport: { width: Math.max(c.w + 40, 420), height: 1300 }, deviceScaleFactor: 2, hasTouch: c.w < 1024 })
    const errs = []
    p.on('pageerror', e => errs.push(e.message))
    await p.goto('file://' + PROTO)
    await p.waitForTimeout(350)
    await p.click('text=' + (c.w === 393 ? '393 手机竖屏' : c.w === 834 ? '834 平板竖屏' : '1280 桌面'))
    await p.waitForTimeout(350)
    const m = await p.evaluate(() => {
      const lane = document.querySelector('.cap-lane')
      const sc = document.querySelector('[data-scroller]')
      const ph = document.querySelector('.cap-phantom')
      const rows = Array.from(document.querySelectorAll('#state-panel tr')).map(tr => [tr.querySelector('th').textContent, tr.querySelector('td').textContent])
      const get = k => { const r = rows.find(x => x[0].indexOf(k) >= 0); return r ? r[1] : '?' }
      return {
        cls: lane.className,
        laneW: Math.round(lane.getBoundingClientRect().width),
        rowH: Math.round(document.querySelector('.dsws-seg').getBoundingClientRect().height),
        scroller: Math.round(sc.clientWidth), content: Math.round(ph.scrollWidth),
        overflow: Math.round(ph.scrollWidth - sc.clientWidth),
        hints: { fade: !!lane.querySelector('.edge-fade'), sb: !!lane.querySelector('.scrollbar'), arrows: !!lane.querySelector('.edge-arrow') },
        hits: document.querySelectorAll('.hitbox').length,
        hitsShort: document.querySelectorAll('.hitbox.short').length,
        line: get('设备线'), fit: get('这条线怎么处理宽不够'), hintRow: get('滚动提示'), rowRow: get('单行高'),
        selfFail: Array.from(document.querySelectorAll('#selftest span')).filter(s => s.className === 'fail').map(s => s.textContent.trim()),
      }
    })
    rows.push({ view: c.w, ...m })
    await p.screenshot({ path: path.join(OUT, c.file), clip: await p.evaluate(() => { const r = document.querySelector('#phone').getBoundingClientRect(); return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: Math.min(r.width + 12, window.innerWidth), height: Math.min(r.height + 12, window.innerHeight) } }) })
    console.log('===', c.w, 'px ===')
    console.log('  线:', m.line.split('·')[0].trim(), '|', m.fit, '|', m.hintRow)
    console.log('  行高:', m.rowRow, '| 横条', m.laneW, 'px | 滚动窗', m.scroller, '内容', m.content, '溢出', m.overflow)
    console.log('  提示层: 渐隐', m.hints.fade, '滚动条', m.hints.sb, '箭头', m.hints.arrows, '| 命中框', m.hits, '其中不达标', m.hitsShort)
    console.log('  页面自检 fail:', m.selfFail.length ? m.selfFail : '无', '| 错误', errs.length ? errs : '无')
    await p.close()
  }
  fs.writeFileSync('/tmp/pwproto/devicelines-result.json', JSON.stringify(rows, null, 2))
  await b.close()
})().catch(e => { console.error('FAILED', e); process.exit(1) })
