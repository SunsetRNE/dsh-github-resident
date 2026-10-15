import test from 'node:test'
import assert from 'node:assert/strict'
import { account, mountClient } from './resident-rpc-harness.mjs'

test('真实合并模块通过 connection dsws 读取状态，不依赖全局 host 或端口', async (t) => {
  const page = await mountClient(t)
  t.diagnostic(JSON.stringify({ carrier: page.carrier, rpc: page.residentRequests().length, directHttp: page.directHttp }))
  assert.equal(page.residentRequests().length, 1, '状态读取必须到达宿主 dsws')
  assert.deepEqual(page.residentRequests()[0].envelope.payload, { method: 'ghr.state', payload: { query: 'cached=1' } })
  assert.equal(page.residentRequests()[0].url, 'http://127.0.0.1:3080/api/dsws')
  assert.match(page.text(), /已授权 · rpc-reader/)
  assert.deepEqual(page.directHttp, [])
})

test('状态 RPC 拒绝时页面显示宿主原始错误，不改发 HTTP', async (t) => {
  const page = await mountClient(t, { handlers: { 'ghr.state': () => { throw new Error('state snapshot denied by host') } } })
  assert.match(page.text(), /state snapshot denied by host/)
  assert.deepEqual(page.directHttp, [])
  assert.equal(page.residentRequests().length, 1)
})

test('设备码写操作在 45 秒内结束 busy，底层不响应取消也不重放或采用迟到结果', async (t) => {
  let writes = 0
  let release
  const page = await mountClient(t, { handlers: { 'ghr.authStart': () => {
    writes += 1
    return new Promise((resolve) => { release = resolve })
  } } })
  const previous = new Set(page.timers.keys())
  await page.click('生成一次性码')
  assert.equal(page.button('正在生成…').disabled, true)
  assert.equal(writes, 1)
  await page.expireDeadlines(previous)
  assert.match(page.text(), /RPC.*超时.*ghr.authStart/)
  assert.equal(page.button('生成一次性码').disabled, false)
  assert.equal(page.residentRequests().find((r) => r.envelope.payload.method === 'ghr.authStart').signal.aborted, true)
  await page.settle(() => release({ user_code: 'LATE-CODE' }))
  assert.doesNotMatch(page.text(), /LATE-CODE/)
  assert.equal(writes, 1)
  assert.deepEqual(page.directHttp, [])
})

test('登记库读失败保留真实 RPC 错误，不误报为旧 HTTP 404', async (t) => {
  const page = await mountClient(t, {
    section: 'github-repo-registry',
    handlers: { 'ghr.registry': () => { throw new Error('registry permission denied by host') } },
  })
  assert.match(page.text(), /registry permission denied by host/)
  assert.doesNotMatch(page.text(), /404|宿主未重启/)
  assert.deepEqual(page.directHttp, [])
})

test('登记库全部动作通过 dsws 保留 consent/confirm，不读取旧端口配置', async (t) => {
  const actions = []
  const handlers = Object.fromEntries(['build', 'plan', 'verify', 'revoke', 'purge'].map((action) => [
    'ghr.registry.' + action,
    (args) => { actions.push({ method: 'ghr.registry.' + action, args }); return { ok: true, action } },
  ]))
  const page = await mountClient(t, { section: 'github-repo-registry', handlers, rejectLegacyApi: true })
  assert.match(page.text(), /登记库已建立/)
  for (const label of ['重建登记库', '看计划', '刷新登记快照', '对账', '撤销许可']) await page.click(label)
  await page.click('清空…')
  assert.equal(actions.length, 5, '清空第一击仅确认，不写入')
  await page.click('确认清空')
  assert.deepEqual(actions, [
    { method: 'ghr.registry.build', args: { query: 'consent=1' } },
    { method: 'ghr.registry.plan', args: {} },
    { method: 'ghr.registry.build', args: { query: 'rescan=1&consent=1' } },
    { method: 'ghr.registry.verify', args: {} },
    { method: 'ghr.registry.revoke', args: {} },
    { method: 'ghr.registry.purge', args: { query: 'confirm=1' } },
  ])
  assert.deepEqual(page.directHttp, [])
})

for (const viewport of [
  { name: '手机', width: 390, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36' },
  { name: '平板', width: 1024, userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/130.0 Safari/537.36' },
]) test(`${viewport.name}环境模拟：状态、生成码、打开授权页、保存邮箱均通过真实组件入口`, async (t) => {
  let stored = null
  let codes = 0
  const saved = []
  const page = await mountClient(t, { viewport, handlers: {
    'ghr.state': () => ({ ...account, commitEmail: { offer: !stored, stored } }),
    'ghr.authStart': () => { codes += 1; return { ok: true, user_code: 'ABCD-EFGH', opened: { via: 'device-bridge' } } },
    'ghr.identity.email': (args) => { saved.push(args); stored = new URLSearchParams(args.query).get('email'); return { ok: true } },
  } })
  assert.equal(page.win.innerWidth, viewport.width)
  assert.match(page.text(), /已授权 · rpc-reader/)
  await page.click('生成一次性码')
  assert.match(page.text(), /ABCD-EFGH/)
  assert.equal(codes, 1)
  await page.click('打开授权页')
  assert.deepEqual(page.opened, [['https://github.com/login/device', '_blank', 'noopener']])
  assert.equal(page.button('保存').disabled, true)
  await page.input(' human+panel@example.com ')
  await page.click('保存')
  assert.deepEqual(saved, [{ query: 'email=human%2Bpanel%40example.com' }])
  assert.match(page.text(), /human\+panel@example.com/)
  assert.equal(page.win.document.querySelector('.ghr-input'), null, '成功重读后填写入口消失')
  assert.deepEqual(page.residentRequests().filter((r) => r.envelope.payload.method === 'ghr.state').map((r) => r.envelope.payload.payload), [
    { query: 'cached=1' }, { query: 'refresh=1' }, { query: 'refresh=1' },
  ])
  assert.equal([...page.timers.values()].filter((timer) => timer.ms === 45000).length, 0, '成功后 deadline 计时器已清理')
  assert.deepEqual(page.directHttp, [])
})

for (const scenario of [
  { name: '设备码', method: 'ghr.authStart', section: 'github-resident', button: '生成一次性码' },
  { name: '邮箱', method: 'ghr.identity.email', section: 'github-resident', button: '保存', email: true },
  { name: '登记库', method: 'ghr.registry.build', section: 'github-repo-registry', button: '重建登记库' },
]) test(`${scenario.name}写入收到宿主 RPC 错误时展示原文且仅执行一次`, async (t) => {
  let writes = 0
  const message = scenario.name + ' 已处理但宿主返回错误'
  const page = await mountClient(t, { section: scenario.section, handlers: {
    [scenario.method]: () => { writes += 1; throw new Error(message) },
  } })
  if (scenario.email) await page.input('reader@example.com')
  await page.click(scenario.button)
  assert.ok(page.text().includes(message), '页面保留宿主错误全文')
  assert.equal(writes, 1)
  assert.equal(page.residentRequests().filter((r) => r.envelope.payload.method === scenario.method).length, 1)
  assert.equal(page.button(scenario.button).disabled, false, '失败后 busy 释放')
  assert.deepEqual(page.directHttp, [])
})

test('写入成功后传输断开，客户端不重放写入', async (t) => {
  let writes = 0
  const page = await mountClient(t, {
    handlers: { 'ghr.authStart': () => { writes += 1; return { user_code: 'LOST-CODE' } } },
    async transport(request, envelope, dispatch) {
      const response = await dispatch(request)
      if (envelope.payload.method === 'ghr.authStart') throw new Error('connection lost after host write')
      return response
    },
  })
  await page.click('生成一次性码')
  assert.match(page.text(), /connection lost after host write/)
  assert.equal(writes, 1)
  assert.equal(page.residentRequests().filter((r) => r.envelope.payload.method === 'ghr.authStart').length, 1)
  assert.deepEqual(page.directHttp, [])
})

test('缺少 connection 或宿主不认识端点时如实报错，无 HTTP 回落', async (t) => {
  await t.test('缺少 connection', async (t) => {
    const page = await mountClient(t, { noConnection: true })
    assert.match(page.text(), /connection 服务不可用/)
    assert.deepEqual(page.directHttp, [])
  })
  await t.test('端点不存在', async (t) => {
    const page = await mountClient(t)
    await page.click('生成一次性码')
    assert.match(page.text(), /unknown endpoint: ghr.authStart/)
    assert.equal(page.residentRequests().filter((r) => r.envelope.payload.method === 'ghr.authStart').length, 1)
    assert.deepEqual(page.directHttp, [])
  })
})
