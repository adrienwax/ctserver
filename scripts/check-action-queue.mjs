import assert from 'node:assert/strict'
import { captureAction, createActionQueue } from '../host/action-queue.mjs'
const tick = () => new Promise(resolve => setImmediate(resolve))
let total = 0
async function check(name, fn) { await fn(); total++; console.log(`ok ${name}`) }
function fixture() {
  let context = 'profile1/page1/node1/bank1/generation1', release, busy = 0, peak = 0
  const done = new Promise(r => { release = r }), calls = [], errors = []
  const queue = createActionQueue({ context: () => context, execute: async job => { busy++; peak = Math.max(peak, busy); calls.push(job); if (calls.length === 1) await done; busy-- }, error: e => errors.push(e) })
  const run = (delta = 1, action = { target: 'one' }, mode = 'normal') => queue.run('TR', action, 'TR', delta, mode)
  return { queue, calls, errors, run, release, change: value => { context = value }, peak: () => peak }
}
await check('slow ACK retains and coalesces same-target detents', async () => { const f = fixture(); f.run(1); f.run(2); f.run(3); f.release(); await tick(); assert.deepEqual(f.calls.map(c => c.delta), [1, 5]) })
for (const boundary of ['selected-node', 'bank', 'page', 'profile', 'generation', 'reconnect', 'config-reload']) {
  await check(`${boundary} change discards old pending deltas`, async () => { const f = fixture(); f.run(); f.run(8); f.change(boundary); f.run(2, { target: 'new' }); f.release(); await tick(); assert.deepEqual(f.calls.map(c => [c.action.target, c.delta]), [['one', 1], ['new', 2]]) })
}
await check('different action on same physical control never receives old deltas', async () => { const f = fixture(); f.run(); f.run(2); f.run(3, { target: 'other' }); f.release(); await tick(); assert.deepEqual(f.calls.map(c => [c.action.target, c.delta]), [['one', 1], ['one', 2], ['other', 3]]) })
await check('direction reversals retain order and clamping semantics', async () => { const f = fixture(); f.run(); f.run(2); f.run(-2); f.release(); await tick(); assert.deepEqual(f.calls.map(c => c.delta), [1, 2, -2]); assert.equal(f.calls.reduce((value, c) => Math.max(0, Math.min(10, value + c.delta)), 10), 8) })
await check('discrete presses remain separate and ordered', async () => { const f = fixture(); f.run(0); f.run(0); f.run(0); f.release(); await tick(); assert.equal(f.calls.length, 3) })
await check('Fn mode is captured per gesture', async () => { const f = fixture(); f.run(); f.run(2, { target: 'one' }, 'fine'); f.run(3, { target: 'one' }, 'coarse'); f.release(); await tick(); assert.deepEqual(f.calls.map(c => c.mode), ['normal', 'fine', 'coarse']) })
await check('escape clears pending jobs without overlapping an in-flight lane', async () => { const f = fixture(); f.run(); f.run(4); f.queue.clear(); f.change('after-escape'); f.run(2); assert.equal(f.calls.length, 1); f.release(); await tick(); assert.equal(f.peak(), 1); assert.deepEqual(f.calls.map(c => c.delta), [1, 2]) })
await check('repeated discrete inputs have a bounded queue', async () => { const f = fixture(); f.run(0); for (let i = 0; i < 40; i++) f.run(0); f.release(); await tick(); assert.equal(f.calls.length, 33); assert.equal(f.errors.length, 8) })
const client = { resolve: a => a.slot && a.param ? `/block/b/node/n${a.slot}/param/p${a.param}` : null, state: () => ({ generation: 42 }) }
await check('selected bank aliases become immutable target plus generation', () => { const action = { moshpit: { verb: 'knob', slot: 'sel', bank: 2 } }; const captured = captureAction(action, client, 3, 1); assert.equal(captured.moshpit.path, '/block/b/node/n3/param/p5'); assert.equal(captured.moshpit.generation, 42); assert.equal(action.moshpit.slot, 'sel') })
await check('macro children capture targets too', () => { const captured = captureAction({ macro: [{ wait: 50 }, { moshpit: { verb: 'reset', slot: 'sel', bank: 1 } }] }, client, 2, 0); assert.equal(captured.macro[1].moshpit.path, '/block/b/node/n2/param/p1'); assert.deepEqual(captured.macro[0], { wait: 50 }) })
console.log(`control queue: ${total} checks passed (no CT, windows, keys or TD)`)
