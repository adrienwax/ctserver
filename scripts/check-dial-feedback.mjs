// No hardware or native apps: real adapter, snapshot formatter and host action handlers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createMoshpitClient, ctResolve, sanitizeUiFeedback } from '../host/moshpit-client.mjs'
import { captureAction } from '../host/action-queue.mjs'
import { dialFeedback, formatParameter } from '../host/dial-feedback.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))
const unit = (value, extra = {}) => formatParameter({ type: 'float', step: 1, ...extra }, value)
assert.equal(unit(137.4321, { unit: '%' }), '137.4%')
assert.equal(unit(75, { unit: '%' }), '75%')
assert.equal(unit(0.01234, { unit: '%' }), '0.012%')
assert.equal(unit(0.000001, { unit: '%' }), '<0.0001%')
assert.equal(unit(0, { unit: '%' }), '0%')
assert.equal(unit(0.125, { step: 0.01 }), '0.125') // phase has no unit; never multiply by 100
assert.equal(unit(0.025, { step: 0.25, unit: 'beats' }), '0.025 beats')
assert.equal(unit(-2.1234, { unit: 'px' }), '-2.1234 px')
assert.equal(formatParameter({ type: 'int', unit: 'f' }, 120), '120 f')
assert.equal(formatParameter({ type: 'bool' }, false), 'Off')
assert.equal(formatParameter({ type: 'bool' }, true), 'On')
assert.equal(formatParameter({ type: 'enum', options: ['wrap', 'mirror'] }, 'mirror'), 'mirror')
assert.equal(formatParameter({ type: 'enum', options: ['wrap'] }, 'bad'), null)
assert.equal(unit(NaN), null)
assert.equal(unit(null), null)
assert.deepEqual(sanitizeUiFeedback({ workspace: 'browse', values: { in: { text: '120 f', norm: 2 }, out: null, zoom: { text: '2.5x', norm: 'bad' } } }), { workspace: 'browse', values: { in: { text: '120 f', norm: 1 }, zoom: { text: '2.5x' } } })

const paths = Array.from({ length: 8 }, (_, i) => `/block/b/node/a/param/p${i + 1}`)
const targets = paths.map((path, i) => ({ path, generation: 1, value: i === 0 ? 137.4321 : i + 1, param: { key: `p${i + 1}`, label: `Value ${i + 1}`, type: 'float', step: 1, min: 0, max: 200, ...(i === 0 ? { unit: '%' } : {}) } }))
targets.push({ path: '/lfo/l/period', value: 0.025, param: { label: 'LFO rate', type: 'float', min: 0, max: 64, step: 0.25, unit: 'beats' } }, { path: '/lfo/l/phase', value: 0.125, param: { label: 'LFO phase', type: 'float', min: 0, max: 1, step: 0.01 } })
let discovery = { generation: 1, workspace: 'browse', caps: ['select', 'selection', 'ui-feedback.v1'], selected: { nodeId: 'a' }, slots: [{ nodeId: 'a', name: 'Tone', params: paths }], targets, feedback: { workspace: 'browse', values: { in: { text: '120 f', norm: .2 }, out: { text: '240 f', norm: .4 }, transpose: { text: '120 f', norm: .2 }, clip: { text: '2 / 8' }, folder: { text: '3 / 4' }, zoom: { text: '2.5x', norm: .5 }, frame: { text: '150 f', norm: .25 } } } }
class Socket {
  static instances = []
  constructor() { this.readyState = 1; this.sent = []; Socket.instances.push(this); queueMicrotask(() => this.onopen?.()) }
  push(message) { this.onmessage?.({ data: JSON.stringify(message) }) }
  send(raw) {
    const message = JSON.parse(raw); this.sent.push(message)
    queueMicrotask(() => this.push(message.type === 'hello' ? { type: 'welcome', id: message.id, version: 1, project: { name: 'Test' }, ...discovery } : message.type === 'discover' ? { type: 'targets', id: message.id, ...discovery } : { type: 'ack', id: message.id }))
  }
  close() { this.readyState = 3; this.onclose?.() }
}
const client = createMoshpitClient({ endpoint: 'ws://fixture', WebSocketImpl: Socket })
const profile = JSON.parse(fs.readFileSync(new URL('../config/profiles/moshpit.json', import.meta.url), 'utf8'))
const page = index => ({ ...profile.pages[index], wheel: profile.everyPage.wheel })
try {
  client.start(); await tick(); assert.equal(client.connected(), true)
  const socket = Socket.instances.at(-1)
  client.state().targets.get(paths[0]).param = { ...client.state().targets.get(paths[0]).param, initial: 170, default: 100 }
  await client.act({ verb: 'reset', slot: 1, param: 1 })
  assert.equal(socket.sent.at(-1).write.value, 170, 'CT reset matches user-facing initial value')
  client.state().targets.get(paths[1]).param.default = 100
  await client.act({ verb: 'reset', slot: 1, param: 2 })
  assert.equal(socket.sent.at(-1).write.value, 100, 'legacy metadata without initial resets to default')
  let snapshot = dialFeedback({ page: page(0), client, selection: 1 })
  assert.deepEqual([snapshot.TL.text, snapshot.CL.text, snapshot.BL.text, snapshot.TR.text, snapshot.CR.text, snapshot.BR.text, snapshot.wheel.text], ['120 f', '240 f', '120 f', '2 / 8', '3 / 4', '2.5x', '150 f'])
  assert.equal(snapshot.TL.bindingKey, JSON.stringify(page(0).dials.TL.turn))
  snapshot = dialFeedback({ page: page(1), client, selection: 1 })
  assert.deepEqual(['TL','CL','BL','TR','CR','BR'].map(k => snapshot[k].text), ['137.4%','2','3','4','5','6'])
  assert.equal(snapshot.TL.norm, 137.4321 / 200)
  snapshot = dialFeedback({ page: page(1), client, selection: 1, bank: 1 })
  assert.equal(snapshot.TL.text, '7'); assert.equal(snapshot.CL.text, '8')
  for (const key of ['BL','TR','CR','BR']) { assert.equal(snapshot[key].label, ''); assert.equal(snapshot[key].available, false) }
  snapshot = dialFeedback({ page: page(1), client, selection: 1, bank: 2 })
  assert.equal(snapshot.TL.text, '0.025 beats'); assert.equal(snapshot.CL.text, '0.125'); assert.equal(snapshot.BL.label, '')
  socket.push({ type: 'value', path: paths[0], value: 100.1234, resolved: 190 })
  assert.equal(dialFeedback({ page: page(1), client, selection: 1 }).TL.text, '100.1%', 'base is primary; resolved modulation is not substituted')
  socket.push({ type: 'ui-feedback', feedback: { workspace: 'browse', values: { in: { text: '121 f' } } } })
  assert.equal(dialFeedback({ page: page(0), client }).CL.available, false, 'absent fields clear stale readouts')
  socket.push({ type: 'ui-feedback', feedback: null }); assert.equal(client.state().feedback, null)
  socket.push({ type: 'ui-feedback', feedback: discovery.feedback })
  socket.push({ type: 'workspace', workspace: 'mosh' }); assert.equal(client.state().feedback, null)
  socket.push({ type: 'ui-feedback', feedback: discovery.feedback }); assert.equal(dialFeedback({ page: page(0), client }).TL.available, false, 'old workspace feedback cannot leak')
  socket.push({ type: 'ui-feedback', feedback: { workspace: 'mosh', values: { block: { text: '2 / 6', norm: .2 }, frame: { text: '99 f' } } } })
  snapshot = dialFeedback({ page: page(1), client, selection: 1 })
  assert.equal(snapshot.wheel.text, '99 f')
  assert.equal(snapshot.TL.text, '100.1%', 'block navigation feedback never replaces parameter knobs')
  assert.equal(dialFeedback({ page: page(2), client, selection: 1 }).TL.text, '100.1%', 'FX and EDIT share six continuous controls')
  socket.push({ type: 'ui-feedback', feedback: { workspace: 'mosh', values: {} } })
  assert.equal(dialFeedback({ page: page(1), client }).TL.available, true, 'missing block feedback does not clear effect controls')

  // Execute the actual host capture + dispatch for no selection and Source/Output.
  const host = fs.readFileSync(new URL('../host/deck-host.mjs', import.meta.url), 'utf8')
  const jobs = [], selection = { moshpit: 0 }
  const context = vm.createContext({ captureAction, sel: selection, bank: {}, prof: () => ({ appId: 'moshpit' }), moshOf: () => client, buzz: () => {}, lanes: { run: (...job) => jobs.push(job) }, actionContext: () => 'same', stopping: false, counts: { actions: 0 }, ACTIONS: ['moshpit'], discreteDelta: n => n })
  vm.runInContext(host.slice(host.indexOf('function run(action'), host.indexOf('function buzz()')), context)
  for (const selected of [null, { nodeId: 'source' }, { nodeId: 'output' }]) {
    socket.push({ type: 'selection', selected }); selection.moshpit = client.selectedSlot()
    assert.equal(selection.moshpit, 0)
    assert.equal(dialFeedback({ page: page(1), client, selection: 0 }).TR.available, false)
    const count = socket.sent.filter(m => m.type === 'write').length
    context.run(page(1).dials.TR.turn, 'turn TR', 1)
    const [, captured, what, delta] = jobs.at(-1)
    assert.equal(captured.moshpit.path, null, 'zero selection must not fall back to slot 1')
    await context.act(captured, what, delta)
    assert.equal(socket.sent.filter(m => m.type === 'write').length, count)
    await assert.rejects(client.act(ctResolve(page(1).dials.TR.turn.moshpit, 0, 0), 1), e => e.code === 'PARAM_UNKNOWN')
  }
  socket.send = raw => { const message = JSON.parse(raw); socket.sent.push(message); queueMicrotask(() => { socket.push({ type: 'ack', id: message.id, value: 99 }); socket.close() }) }
  await client.act({ verb: 'knob', slot: 1, param: 1 }, 1)
  for (const key of ['values', 'resolved', 'targets']) assert.equal(client.state()[key].size, 0)
  assert.equal(client.state().selected, null); assert.equal(client.state().feedback, null)
  assert.equal(dialFeedback({ page: page(1), client, selection: 1 }).TR.available, false)
  client.stop()
  discovery = { ...discovery, caps: [], selected: null, targets: [targets[1]], feedback: discovery.feedback }
  client.start(); await tick()
  assert.equal(client.connected(), true); assert.equal(client.state().feedback, null, 'legacy capability ignores unsupported feedback')
  assert.equal(client.state().values.has(paths[0]), false, 'reconnect cannot retain old parameter values')
  assert.equal(dialFeedback({ page: page(0), client }).TL.available, false)
  discovery = { ...discovery, caps: ['ui-feedback.v1'], feedback: { workspace: 'browse', values: { in: { text: '0 f' } } } }
  await client.discover(); assert.equal(client.state().feedback.values.in.text, '0 f')
  discovery = { ...discovery, feedback: undefined }; await client.discover(); assert.equal(client.state().feedback, null, 'absent rediscovery feedback clears')
  client.stop(); assert.equal(client.state().values.size, 0); assert.equal(client.state().selected, null)
  console.log('PASS dial feedback: units/precision/enums/bools, all six IN values and wheel, bank/selection, physical+IPC snapshot, no-target host dispatch, disconnect/reconnect/legacy clearing')
} finally { client.stop() }
