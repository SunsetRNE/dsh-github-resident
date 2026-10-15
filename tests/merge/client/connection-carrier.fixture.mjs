/**
 * 外部 DSH connection 接缝的最小载体，供没有安装 DSH 的 CI 使用。
 * 契约核对自 @deepseek-ai/dsh-client-connection 0.2.0-rc.2：
 * call(channel, endpoint, payload, signal) → RpcResult；POST client-request/server-response 信封。
 * 这里不实现插件业务，也不替换本仓的装配、组件或 dsws 分发。
 * DSH_CONNECTION_CLIENT=.../lib/client.js 可使相同测试改用真实官方模块。
 */
import assert from 'node:assert/strict'

export function installConnectionFixture(ctx, { transport }) {
  let nextId = 0
  ctx.provide('connection', {
    rpc: {
      async call(channel, endpoint, payload, signal) {
        const rpcId = 'client-test-' + ++nextId
        const response = await transport.fetch(`${channel}/${endpoint}`.slice(1), {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal,
          body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
        })
        if (!response.ok) throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`)
        const envelope = await response.json()
        assert.equal(envelope.type, 'server-response')
        assert.equal(envelope.rpcId, rpcId)
        signal?.throwIfAborted()
        return envelope.result
      },
    },
  })
}
