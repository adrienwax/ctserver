// Queue + real adapter regression for a wheel backlog behind a slow ACK. No socket, CT or app.
import assert from 'node:assert/strict'
import { createActionQueue } from '../host/action-queue.mjs'
import { createMoshpitClient, MAX_REPEAT } from '../host/moshpit-client.mjs'
const tick = () => new Promise(resolve => setImmediate(resolve))
const action = { moshpit: { verb: 'step', commands: ['transport.prevFrame', 'transport.nextFrame'] } }
let total = 0
async function check(name, test) {
  const received = [], acks = [], errors = []
  let context = 'page1', outstanding = 0, peak = 0
  class OfflineSocket {
    constructor() { this.readyState = 1; queueMicrotask(() => this.onopen?.()) }
    send(raw) {
      const m = JSON.parse(raw)
      let reply = { type: 'ack', id: m.id }
      if (m.type === 'hello') reply = { ...reply, version: 1, caps: [] }
      if (m.type === 'discover') reply = { ...reply, generation: 1, targets: [], slots: [] }
      if (m.type === 'command') {
        received.push({ command: m.command, repeat: m.repeat })
        outstanding++; peak = Math.max(peak, outstanding)
        acks.push(fail => { outstanding--; this.onmessage?.({ data: JSON.stringify(fail ? { type: 'error', id: m.id, code: 'CONTROL_FAILED', error: { code: 'CONTROL_FAILED', message: 'simulated failure' } } : reply) }) })
      } else queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(reply) }))
    }
    close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()) }
  }
  const client = createMoshpitClient({ endpoint: 'ws://offline.invalid', WebSocketImpl: OfflineSocket })
  const queue = createActionQueue({ context: () => context, execute: j => client.act(j.action.moshpit, j.delta), error: e => errors.push(e) })
  const run = delta => queue.run('wheel', action, 'wheel', delta)
  const ack = async (fail = false) => { assert.ok(acks.length, 'a request is awaiting its ACK'); acks.shift()(fail); await tick() }
  const drain = async () => { for (let i = 0; acks.length && i < 100; i++) await ack(); assert.equal(acks.length, 0, 'work remains bounded') }
  try {
    client.start(); await tick(); assert.equal(client.connected(), true)
    await test({ received, errors, queue, run, ack, drain, change: () => { context = 'page2' } })
    assert.ok(received.every(m => Number.isInteger(m.repeat) && m.repeat >= 1 && m.repeat <= MAX_REPEAT))
    assert.ok(peak <= 1, 'no concurrent command flood: one request per ACK')
    total++; console.log(`ok ${name}`)
  } finally { client.stop() }
}

await check('26 physical detents survive a slow first ACK as [1,10,10,5]', async f => {
  for (let i = 0; i < 26; i++) f.run(1)
  assert.equal(f.received.length, 1)
  await f.drain()
  assert.deepEqual(f.received.map(m => m.repeat), [1, 10, 10, 5])
  assert.equal(f.errors.length, 0)
})
await check('reversals remain ordered across chunk boundaries', async f => {
  f.run(-1); f.run(-25); f.run(13)
  await f.drain()
  assert.deepEqual(f.received.map(m => [m.command, m.repeat]), [
    ['transport.prevFrame', 1], ['transport.prevFrame', 10], ['transport.prevFrame', 10], ['transport.prevFrame', 5],
    ['transport.nextFrame', 10], ['transport.nextFrame', 3],
  ])
  // Starting at frame zero, left turns clamp there and the later right turns reach frame 13.
  assert.equal(f.received.reduce((n, m) => Math.max(0, n + (m.command.endsWith('prevFrame') ? -m.repeat : m.repeat)), 0), 13)
})
await check('a single large turn is chunked and new input joins its unsent tail', async f => {
  f.run(26); f.run(4); await f.drain()
  assert.deepEqual(f.received.map(m => m.repeat), [10, 10, 10])
})
await check('context changes cancel an unsent burst between ACKs', async f => {
  f.run(26); f.change(); f.run(-2); await f.drain()
  assert.deepEqual(f.received.map(m => [m.command, m.repeat]), [['transport.nextFrame', 10], ['transport.prevFrame', 2]])
})
await check('escape clears the tail without overlapping a command already sent', async f => {
  f.run(26); f.queue.clear(); f.run(-3); await f.drain()
  assert.deepEqual(f.received.map(m => m.repeat), [10, 3])
})
await check('a failed chunk is never retried and its remaining burst is discarded', async f => {
  f.run(26); await f.ack(true); await f.drain()
  assert.deepEqual(f.received.map(m => m.repeat), [10])
  assert.equal(f.errors.length, 1)
})
await check('a failed first detent cancels separately accumulated steps and queued reversals', async f => {
  for (let i = 0; i < 26; i++) f.run(1)
  f.run(-12)
  await f.ack(true); await f.drain()
  assert.deepEqual(f.received.map(m => m.repeat), [1])
  assert.equal(f.errors.length, 1)
})
await check('failure preserves a different queued action in the same lane', async f => {
  f.run(1); f.run(25)
  f.queue.run('wheel', { moshpit: { verb: 'step', commands: ['block.prev', 'block.next'] } }, 'blocks', 2)
  await f.ack(true); await f.drain()
  assert.deepEqual(f.received.map(m => [m.command, m.repeat]), [['transport.nextFrame', 1], ['block.next', 2]])
})
await check('failure preserves work captured in a new context', async f => {
  f.run(26); f.change(); f.run(-2)
  await f.ack(true); await f.drain()
  assert.deepEqual(f.received.map(m => [m.command, m.repeat]), [['transport.nextFrame', 10], ['transport.prevFrame', 2]])
})
await check('extreme input is bounded and excess is reported rather than silently lost', async f => {
  f.run(1); f.run(1000000); await f.drain()
  assert.equal(f.received.reduce((sum, m) => sum + m.repeat, 0), 321)
  assert.equal(f.received.length, 33)
  assert.equal(f.errors.length, 1)
  assert.match(f.errors[0].message, /999680 detents were discarded/)
})
await check('non-finite and fractional wheel input never reaches the adapter', async f => {
  for (const delta of [Infinity, NaN, 1.5]) f.run(delta)
  await f.drain()
  assert.equal(f.received.length, 0)
  assert.equal(f.errors.length, 3)
})
console.log(`wheel queue: ${total} checks passed through the adapter (no CT, windows or sockets)`)
