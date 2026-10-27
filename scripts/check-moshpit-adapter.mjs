// The Moshpit adapter against the stand-in server (CONTROL-PROTOCOL.md v1): the endpoint file and its token, a
// refused token, discovery, a dial, a reset, a toggle, commands with repeat, pushed and resolved values, a stale
// generation, and a reconnect after Moshpit goes away and comes back on a new token. No CT, no Moshpit app.
//   node scripts/check-moshpit-adapter.mjs      exits 1 on a failure
import assert from 'node:assert/strict'
import { captureAction } from '../host/action-queue.mjs'
import { createMoshpitClient, ctResolve, ctSide, BANKS } from '../host/moshpit-client.mjs'
import { startMockMoshpit } from './mock-moshpit.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pageOf, MOSHPIT_PENDING } from '../host/schema.mjs'
const cmdOf = (q) => q.verb === 'command' ? [q.command] : q.verb === 'step' ? q.commands : []


const until = async (f, ms = 4000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 20)) } }
const endpointFile = path.join(os.tmpdir(), `waxyct-check-endpoint-${process.pid}.json`)
let mock = await startMockMoshpit({ port: 0, endpointFile })
const port = mock.port
const m = createMoshpitClient({ endpointFile })
const rows = []
const ok = (what) => rows.push(`ok   ${what}`)
try {
  // a wrong token in the file: refused (NOT_AUTHORISED), and the CT keeps trying; the right one: in
  const real = fs.readFileSync(endpointFile, 'utf8')
  fs.writeFileSync(endpointFile, JSON.stringify({ ...JSON.parse(real), token: 'not-the-token' }))
  const said = []
  const off = m.onChange((why, st) => { if (why === 'phase') said.push(st.detail) })
  m.start()
  await until(() => said.some((d) => /retrying/.test(d)))
  assert.ok(!m.connected())
  fs.writeFileSync(endpointFile, real)
  await until(() => m.connected(), 6000)
  off()
  ok('the endpoint file: a wrong token is refused and retried; the right token connects')
  ok(`handshake and discovery: ${m.state().targets.size} targets, ${m.state().slots.length} slots, project "${m.state().project.name}"`)

  const frames = { verb: 'knob', slot: 1, param: 1 }
  assert.equal(m.resolve(frames), '/block/b1/node/n1/param/frames')
  await m.act(frames, 3)
  assert.equal(mock.values.get('/block/b1/node/n1/param/frames'), 7, 'int param: 4 + 3 detents x step 1')
  ok('dial: slot 1 param 1 (Hold frames) 4 -> 7 by 3 detents, Moshpit applying the step')

  await m.act({ verb: 'knob', slot: 2, param: 'amount' }, 5, 'fine')
  assert.equal(mock.values.get('/block/b1/node/n2/param/amount'), 0.205, 'fine: 0.2 + 5 x 0.01 x 0.1')
  ok('fine mode and a param by key: Melt amount 0.2 -> 0.205')

  await m.act({ verb: 'knob', lfo: 1, field: 'period' }, 4)
  assert.equal(mock.values.get('/lfo/l1/period'), 5, 'LFO period 4 + 4 x 0.25')
  ok('an LFO by position: LFO 1 period 4 -> 5 beats')

  await m.act({ verb: 'reset', slot: 1, param: 1 })
  assert.equal(mock.values.get('/block/b1/node/n1/param/frames'), 4)
  ok('reset: back to the default 4')

  await m.act({ verb: 'toggle', slot: 3, param: 'bypass' })
  assert.equal(mock.values.get('/block/b1/node/n3/param/bypass'), true)
  await until(() => m.on({ slot: 3, param: 'bypass' }))
  ok('toggle: Tone bypass on, and the CT sees it lit')

  await m.act({ verb: 'command', command: 'transport.play' })
  const r = await m.act({ verb: 'step', commands: ['transport.prevFrame', 'transport.nextFrame'] }, -2)
  assert.equal(r.repeat, 2)
  assert.deepEqual(mock.commandsSeen, ['transport.play', 'transport.prevFrame', 'transport.prevFrame'])
  await m.act({ verb: 'step', commands: ['transport.prevFrame', 'transport.nextFrame'] }, 40)
  assert.equal(mock.commandsSeen.length, 13, 'a fast turn: one message, Moshpit runs it at most 10 times')
  ok('commands: transport.play; a 2-detent wheel turn as one command with repeat 2; a 40-detent spin capped at 10')

  mock.setFromApp('/block/b1/node/n2/param/amount', 1)
  await until(() => m.norm({ slot: 2, param: 'amount' }) === 1)
  ok('feedback: a change made in Moshpit reaches the CT (dial bar at 100)')

  mock.modulate('/block/b1/node/n1/param/mix', 0.83)
  await until(() => m.modulated({ slot: 1, param: 'mix' }))
  assert.equal(m.state().resolved.get('/block/b1/node/n1/param/mix'), 0.83)
  assert.equal(m.norm({ slot: 1, param: 'mix' }), 0.5, 'the dial shows the base, never the LFO-resolved value')
  ok('an LFO-driven param: "resolved" kept for the ring, the dial stays on the base value')

  const capturedBeforeChange = captureAction({ moshpit: frames }, m, 1, 0).moshpit
  const beforeCaptured = mock.values.get('/block/b1/node/n1/param/frames')
  mock.bumpGeneration()
  await until(() => m.state().generation === 2)
  await assert.rejects(m.act(capturedBeforeChange, 9), e => e.code === 'CONTROL_STALE_TARGET')
  assert.equal(mock.values.get('/block/b1/node/n1/param/frames'), beforeCaptured)
  ok('captured queued action keeps its old generation after rediscovery and cannot write a renamed/replaced target')
  await m.act(frames, 1)
  ok('the graph changed: Moshpit said so, the CT re-read it, and the next write landed')

  mock.bumpGeneration(true)                       // moved on without saying so: the next write is stale
  await assert.rejects(m.act(frames, 1), (e) => e.code === 'CONTROL_STALE_TARGET')
  assert.equal(m.state().generation, 3)
  await m.act(frames, 1)
  ok('a stale write: Moshpit refused it, the CT re-read the targets, the retry landed')

  // the CT's cursors: a bank dial is params 1-3, then 4-6, then LFO 1's period and phase with the third blank
  const e2 = { verb: 'knob', slot: 'sel', bank: 2 }
  assert.deepEqual([0, 1, 2].map((b) => ctResolve(e2, 3, b)), [{ verb: 'knob', slot: 3, param: 2 }, { verb: 'knob', slot: 3, param: 5 }, { verb: 'knob', lfo: 1, field: 'phase' }])
  assert.equal(ctResolve({ verb: 'reset', slot: 'sel', bank: 3 }, 1, 2), null, 'the LFO bank has no third control')
  assert.ok(ctSide({ verb: 'selstep' }) && ctSide({ verb: 'bank' }) && !ctSide(e2), 'selstep and bank never reach Moshpit')
  ok('bank dials: P1-3, P4-6, LFO period / phase; NODE and BANK stay on the CT')

  // M1: one selection. The CT selects, Moshpit's inspector follows; Moshpit selects, the CT follows
  assert.ok(m.syncs(), 'the stand-in offers the selection cap')
  assert.equal(await m.select('n2'), true)
  await until(() => mock.selected() === 'n2')
  assert.equal(m.selectedSlot(), 2)
  mock.selectFromApp('n3')
  await until(() => m.selectedSlot() === 3)
  ok('selection sync: a CT select moved Moshpit to node 2; Moshpit selecting node 3 moved the CT to slot 3')
  // a stale generation: Moshpit refuses, the client re-reads and says so; Moshpit clearing its selection clears the CT's
  mock.bumpGeneration(true)
  await assert.rejects(m.select('n1'), (e) => e.code === 'CONTROL_STALE_TARGET')
  assert.equal(m.state().generation, mock.generation(), 'a refused select re-reads the targets')
  assert.equal(await m.select('n1'), true, 'the retry lands')
  mock.selectFromApp(null)
  await until(() => m.state().selected === null)
  assert.equal(m.selectedSlot(), 0)
  ok('selection: a stale select is refused, re-read and retried; a cleared selection clears the CT')

  // an empty project (a fresh Moshpit): no slots, selected null; commands still run, nothing else is sent or thrown
  const emptyFile = path.join(os.tmpdir(), `mock-moshpit-empty-${process.pid}.json`)
  const em = await startMockMoshpit({ port: 0, endpointFile: emptyFile, empty: true })
  const m2 = createMoshpitClient({ endpointFile: emptyFile })
  try {
    m2.start()
    await until(() => m2.connected())
    assert.equal(m2.state().slots.length, 0); assert.equal(m2.state().selected, null); assert.equal(m2.selectedSlot(), 0)
    assert.equal(await m2.select(undefined), false, 'nothing to select: nothing sent')
    await assert.rejects(m2.select('n9'), (e) => e.code === 'CONTROL_STALE_TARGET')
    await assert.rejects(m2.act({ verb: 'knob', slot: 1, param: 1 }, 1), (e) => e.code === 'PARAM_UNKNOWN')
    for (const c of ['clip.next', 'mark.in.nudgeBack', 'render.start']) await m2.act({ verb: 'command', command: c })
    assert.equal(m2.norm({ verb: 'knob', slot: 1, param: 1 }), null)
    assert.ok(m2.connected(), 'still connected after every refusal')
    ok('empty project: 0 slots, selected null; select and dials refused with codes, commands run, the link stays up')
  } finally { m2.stop(); await em.close() }

  // the generated moshpit profile, every control, as the deck would send it (pages as the CT plays them)
  const prof = JSON.parse(fs.readFileSync(new URL('../config/profiles/moshpit.json', import.meta.url), 'utf8'))
  // Repeated wheel taps must send the toggle, never the start-only command, on every effective page.
  // This checks the shipped mapping through the wire; app playback and physical CT acceptance are separate.
  for (let i = 0; i < prof.pages.length; i++) {
    const g = pageOf(prof, i), start = mock.commandsSeen.length
    assert.equal(g.wheel?.tap?.moshpit?.command, 'transport.loop', `${g.name}: wheel tap toggles playback`)
    assert.equal(g.buttons.a.do.moshpit.command, 'transport.play', `${g.name}: A still starts playback`)
    assert.equal(g.buttons.b.do.moshpit.command, 'transport.stop', `${g.name}: B still stops playback`)
    await m.act(g.wheel.tap.moshpit)
    await m.act(g.wheel.tap.moshpit)
    await m.act(g.wheel.turn.moshpit, -2)
    await m.act(g.wheel.turn.moshpit, 2)
    assert.deepEqual(mock.commandsSeen.slice(start), ['transport.loop', 'transport.loop', 'transport.prevFrame', 'transport.prevFrame', 'transport.nextFrame', 'transport.nextFrame'], `${g.name}: two taps and both scrub directions reach the server`)
  }
  ok('wheel on every Moshpit page: repeated play / pause toggle commands, bidirectional frame scrubbing; A / B retain play / stop')
  const acts = (x) => (x && x.macro ? x.macro.map((y) => y.moshpit) : x && x.moshpit ? [x.moshpit] : []).filter(Boolean)
  let sent = 0, absent = 0, pending = 0
  for (let i = 0; i < prof.pages.length; i++) {
    const g = pageOf(prof, i)
    const all = [...acts(g.enter).map((a) => [a, 0]), ...Object.values(g.keys || {}).flatMap((k) => acts(k.do).map((a) => [a, 0])), ...Object.values(g.dials || {}).flatMap((d) => [...acts(d.turn).map((a) => [a, 1]), ...acts(d.press).map((a) => [a, 0])]),
      ...acts(g.wheel && g.wheel.turn).map((a) => [a, -1]), ...acts(g.wheel && g.wheel.tap).map((a) => [a, 0]), ...Object.values(g.buttons || {}).flatMap((b) => [...acts(b.do), ...acts(b.hold)].map((a) => [a, 0]))]
    // as the deck: select, selstep and bank are the CT's own cursors; "sel" is slot 1, and a bank dial is tried in every bank
    for (const [a0, d] of all.flatMap(([q, d]) => ctSide(q) ? [] : q.bank ? BANKS.map((_, b) => [ctResolve(q, 1, b), d]).filter(([r]) => r) : [[ctResolve(q, 1, 0), d]])) {
      const a = a0
      try { await m.act(a, d); sent++ } catch (e) { if (e.code === 'PARAM_UNKNOWN' && cmdOf(a).some((c) => MOSHPIT_PENDING.includes(c))) pending++; else if (e.code === 'PARAM_UNKNOWN' && (Number.isInteger(a.slot) && (a.slot > m.state().slots.length || a.param > (m.state().slots[a.slot - 1]?.params || []).filter((q) => !q.endsWith('/bypass')).length))) absent++; else throw new Error(`${g.name}: ${JSON.stringify(a)}: ${e.message}`) }
    }
  }
  assert.equal(pending, 0, 'the stand-in has every command waxyct uses')
  ok(`the moshpit profile: ${sent} actions taken by "Moshpit"; ${absent} aimed at an empty slot or a param the node lacks, refused as unknown`)

  await mock.close()
  await until(() => !m.connected())
  assert.ok(!fs.existsSync(endpointFile), 'Moshpit removes its endpoint file when it stops')
  ok(`Moshpit gone, endpoint file gone: the CT waits ("${m.state().detail}")`)
  mock = await startMockMoshpit({ port: 0, endpointFile })
  await until(() => m.connected(), 6000)
  ok(`Moshpit back on a new port (${mock.port}) and a new token: read from the file, reconnected, re-discovered`)
} finally {
  m.stop()
  await mock.close()
  console.log(rows.join('\n'))
}
console.log(`moshpit adapter ok: ${rows.length} checks against the stand-in server`)
