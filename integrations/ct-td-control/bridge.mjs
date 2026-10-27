// RAWK CT -> TouchDesigner bridge.
//
// SAFETY / GUARD: this file does NOTHING unless you explicitly launch it with a mode flag.
//   node bridge.mjs                 -> prints usage and exits. No hardware, no network.
//   node bridge.mjs --print-map     -> prints the CT->TD map. No hardware, no network.
//   node bridge.mjs --selftest      -> GET the TD bridge handshake only. No CT opened.
//   node bridge.mjs --live          -> opens the CT and forwards input to TD. (see README)
//   node bridge.mjs --live --dry    -> opens the CT, logs the scripts it WOULD send, sends none.
//   add --allow-layout to enable the layout-step button (moves the rig out of TEST).
//
// Opening the CT grabs the USB serial device — only one process can hold it. --live takes the shared
// claim first (ct-claim.mjs) and waits while EDENA or another owner holds it; the ct-router panel hands
// the CT over. The Loupedeck app takes no claim: quit it first.
//
// Written 2026-09-27 as design+scaffold. Not run against live hardware or TD.

import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTdClient } from './td-client.mjs'
import { buildScript, GEN_ORDER, FX_ORDER, LOOK_PY } from './ct-td-map.mjs'
import { keysFor, renderKeys, renderStrip, toRgb565 } from './ct-draw.mjs'
import * as ctClaim from './ct-claim.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = new Set(process.argv.slice(2))
const LIVE = args.has('--live')
const DRY = args.has('--dry')
const ALLOW_LAYOUT = args.has('--allow-layout')
const FAKE = args.has('--fake')     // no hardware: emit synth-sequence.mjs through the real handlers, check each script
const SYNTH = FAKE || args.has('--synth')   // --synth: the same sequence emitted on the REAL CT (screens, LEDs, haptics)
const TRACE = args.has('--trace')   // log every CT event, the script sent, and TD state read back
// --neon-look (temporary, 27 Sep): dial the rack look for the promo re-record. Right dials = the generator
// as usual; left dials = FX mix / Ceiling / Knee. Keys, buttons, faders and the wheel do nothing, so
// nothing can re-route the chain or move the master level.
const NEON = args.has('--neon-look')

function loadConfig() {
  const p = path.join(__dirname, 'config.json')
  if (!fs.existsSync(p)) {
    const ex = path.join(__dirname, 'config.example.json')
    throw new Error(`No config.json. Copy config.example.json to config.json and confirm the VERIFY items.\n  cp ${ex} ${p}`)
  }
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (cfg.configured !== true) throw new Error('TD bridge is not configured. Follow the local setup guide before enabling a compatible rig. No connection was opened.')
  if (ALLOW_LAYOUT) cfg.guards.allowLayout = true
  return cfg
}

function usage() {
  console.log(`RAWK CT -> TouchDesigner bridge (design+scaffold; TEST layout)

  node bridge.mjs                 print this and exit (no hardware, no network)
  node bridge.mjs --print-map     print the CT->TD map (no hardware, no network)
  node bridge.mjs --selftest      GET the TD bridge handshake only (no CT opened)
  node bridge.mjs --live          open the CT and forward input to TD
  node bridge.mjs --live --dry    open the CT, log scripts it WOULD send, send none
  add --allow-layout              enable the layout-step button (leaves TEST)
  add --trace                     log every CT event, the script sent, and TD state read back
  add --neon-look                 dials only: right = generator, left = FX mix / Ceiling / Knee
  add --for <seconds>             stop after N seconds with a clean CT close
  add --stall-after <s>           test: make the link report not-ready, to prove the heartbeat reconnects
  --live --fake [--dry|--trace]   no hardware: run synth-sequence.mjs through the real handlers
  --live --synth --trace          the same sequence on the real CT: keys, LEDs and haptics, sent to TD

Before --live: config.json present and confirmed, TouchDesigner open with the TD bridge
running, the CT plugged in and free (nothing else holding it). See README.md.`)
}

function printMap() {
  console.log('GENERATORS (right hand, calm -> wild):')
  GEN_ORDER.forEach((g, i) => console.log(`  ${String(i).padStart(2)}  ${g}`))
  console.log('\nEFFECTS (left hand, calm -> wild):')
  FX_ORDER.forEach((f, i) => console.log(`  ${String(i).padStart(2)}  ${f}`))
  console.log('\nControls: see CT-TD-MAPPING.md §3. Dials=settings, wheel=gen speed,')
  console.log('left strip=level, right strip=fx speed, keys=named pickers, buttons=state+transport.')
}

async function selftest() {
  const cfg = loadConfig()
  const td = makeTdClient(cfg.td)
  console.log('handshake ->', cfg.td.handshakeUrl)
  try {
    const r = await td.handshake()
    console.log('  ok:', r.ok, 'status:', r.status, 'body:', JSON.stringify(r.json))
  } catch (e) {
    console.error('  FAILED:', e.message, '\n  Is TouchDesigner open with the TD bridge running?')
    process.exit(1)
  }
}

// -------- live mode ---------------------------------------------------------------
// TD state for the trace read-back and the LED feedback, read through the 9981 exec endpoint.
// Mirrors map_test.py's state() (26 Sep) but reads the shared state directly, so it also works on
// rigs whose TEST DAT predates state() and on rigs without the 9982 tutorial_state server.
function stateScript({ common, mapModule }) {
  return `_c=mod('${common}');_S=_c.st().S;_T=mod('${mapModule}').T;_g=_S['source'];_x=_c.x1();` +
    `_r=lambda v:[round(a,3) for a in v[:3]];` +
    `result={'generator':_g,'gen_k':_r(_S['k'][_g]) if _g in _S['k'] else None,` +
    `'gen_speed':round(_S['rate'].get(_g,1.0),3),'gen_frozen':_g in _S['frozen'],` +
    `'effect':_T['fx'],'effect_on':_T['fx_on'],'fx_k':_r(_S['k'][_T['fx']]),` +
    `'fx_speed':round(_S['rate'][_T['fx']],3),'fx_pulse':_S['pulse'][_T['fx']],` +
    `'td_level':round(_x.MASK['level'],3),'bpm':round(_x.TEMPO['bpm'],1)}`
}

async function live() {
  const cfg = loadConfig()
  const td = makeTdClient(cfg.td)
  const { tdPaths: paths, scaling, guards, ctIds } = cfg
  const log = (...a) => console.log(new Date().toISOString(), ...a)
  const wait = ms => new Promise(r => setTimeout(r, ms))

  // local UI state; the source of truth stays in TD
  const ui = { page: 'gen', fxPageOffset: 0 }

  const STATE_PY = stateScript(paths)
  const readState = async () => {
    const r = await td.exec(STATE_PY).catch(() => null)
    if (!(r && r.success)) return null
    if (NEON) { const l = await td.exec(LOOK_PY(paths.common)).catch(() => null); if (l && l.success) r.data.result.look = l.data.result }
    return r.data.result
  }

  // --trace: after each send, read TD state back and log only what changed.
  let last = {}
  const readback = async () => {
    const now = await readState()
    if (!now) return log('READBACK failed')
    const diff = Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(last[k])))
    last = now
    log('TD CHANGED', Object.keys(diff).length ? JSON.stringify(diff) : '(nothing)')
  }

  // At most one read-back every 300 ms, not one per send: tracing must not add load. A throttle, not a
  // debounce: during a continuous spin a debounce never fired, so the log showed no change (27 Sep).
  let rbTimer = null
  const scheduleReadback = () => { if (!rbTimer) rbTimer = setTimeout(() => { rbTimer = null; readback() }, 300) }

  const sent = []   // --fake: scripts sent for the current synthetic step
  const send = async (action) => {
    const script = buildScript(action, paths, scaling, guards)
    sent.push(script)
    if (!script) { log('skip (guarded/unsupported):', action.type); return }
    if (DRY) { log('DRY exec:', script); return }
    try {
      const res = await td.exec(script)
      if (res && res.success === false) log('TD error:', res.error, '<-', script)
      else {
        commitFeedback(action.type)
        if (TRACE) { log('SENT', action.type, script, '-> ok'); scheduleReadback() }
      }
    } catch (e) {
      log('exec failed:', e.message, '<-', script)
    }
  }

  // ---- lanes: at most one request in flight per control ---------------------------
  // A fast spin fires ~20 detents a second per dial; one HTTP exec each overran TD's web server
  // (27 Sep: 303 sends timed out in 60 s). Now a control has one request in flight, and whatever
  // arrives meanwhile is folded into the next: relative moves are summed, absolute ones keep the latest.
  const lanes = new Map()
  // ponytail: a different action in the same lane (a wheel reset between turns) takes the later one;
  // both inside one ~20 ms in-flight window is the only case that loses anything.
  const sum = (a, b) => a.type !== b.type ? b : ({ ...b, delta: (a.delta || 0) + (b.delta || 0), step: (a.step || 0) + (b.step || 0) })
  const latest = (a, b) => b
  const stats = { events: 0, sends: 0 }
  function queue(key, action, merge) {
    stats.events++
    let lane = lanes.get(key)
    if (!lane) lanes.set(key, lane = { busy: false, pending: null })
    lane.pending = lane.pending ? merge(lane.pending, action) : action
    if (!lane.busy) pump(lane)
  }
  async function pump(lane) {
    lane.busy = true
    while (lane.pending) {
      const a = lane.pending
      lane.pending = null
      if (a.delta === 0 && a.type.endsWith('Knob')) continue   // turned and turned back
      if (a.step === 0 && a.type === 'genSpeedStep') continue
      stats.sends++
      await send(a)
    }
    lane.busy = false
  }

  // ---- input handlers -----------------------------------------------------------
  const KNOB_STEP = 0.02   // per detent tick; ~50 ticks for the full range (measured sweep, 27 Sep)

  // Dials: rotate -> nudge that knob; wheel rotate -> generator speed.
  function onRotate(e) {
    const role = ctIds.dials[e.id] || (e.id === ctIds.wheel ? 'wheel' : null)
    if (!role) { log('unknown rotate id:', e.id, '(add to config ctIds)'); return }
    if (role === 'wheel') return void (NEON || queue('wheel', { type: 'genSpeedStep', step: Math.sign(e.delta) || 0 }, sum))
    const [side, k] = role.split('.')                 // e.g. 'R.k1'
    if (NEON && side === 'L') { const n = Number(k.replace('k', '')); return void queue('look' + n, { type: 'lookKnob', n, delta: e.delta * KNOB_STEP }, sum) }
    const type = side === 'R' ? 'genKnob' : 'fxKnob', n = Number(k.replace('k', ''))
    queue(type + n, { type, n, delta: e.delta * KNOB_STEP }, sum)
  }

  // dial press -> reset that knob; wheel press -> gen speed reset; button -> its function
  function onDown(e) {
    if (ctIds.dials[e.id]) {
      const [side, k] = ctIds.dials[e.id].split('.')
      const n = Number(k.replace('k', ''))
      if (NEON && side === 'L') return void send({ type: 'lookReset', n })
      return void send(side === 'R' ? { type: 'genKnobReset', n } : { type: 'fxKnobReset', n })
    }
    if (NEON) return
    if (e.id === ctIds.wheel) return void queue('wheel', { type: 'genSpeedReset' }, latest)
    const btn = ctIds.buttons[String(e.id)]
    if (!btn) { log('unknown button id:', e.id, '(add to config ctIds)'); return }
    onButton(btn)
  }

  function onButton(btn) {
    switch (btn) {
      case 'genPage': ui.page = 'gen'; return void commitFeedback('page')
      case 'fxPage':  ui.page = 'fx'; return void commitFeedback('page')
      case 'fxOn':    return void send({ type: 'fxOn' })
      case 'pulse':   return void send({ type: 'pulse' })
      case 'freeze':  return void send({ type: 'freeze' })
      case 'tap':     return void send({ type: 'tap' })
      case 'reset':   return void send(ui.page === 'gen' ? { type: 'resetGen' } : { type: 'resetFx' })
      case 'layout':  return void send({ type: 'layoutStep', side: 'L' })
    }
  }

  function onTouch(e) {
    if (NEON) return
    const t = e.changedTouches && e.changedTouches[0]
    if (!t || !t.target) return
    const scr = t.target.screen
    // a press on the wheel arrives as a touch on its round screen, never as a `down` (27 Sep)
    if (scr === 'knob') { if (e.type === 'touchstart') queue('wheel', { type: 'genSpeedReset' }, latest); return }
    if (scr === 'center' && e.type === 'touchstart') {
      const key = t.target.key
      if (typeof key !== 'number') return
      if (ui.page === 'gen') {
        if (key < GEN_ORDER.length) send({ type: 'pickGenName', name: GEN_ORDER[key] })
      } else {
        const idx = key + ui.fxPageOffset
        if (key === 11 && FX_ORDER.length > 11) { ui.fxPageOffset = ui.fxPageOffset ? 0 : 11; return void commitFeedback('page') }
        if (idx < FX_ORDER.length) send({ type: 'pickFxName', name: FX_ORDER[idx] })
      }
      return
    }
    // touchstrips: y (0 top .. height bottom) -> fraction (1 top .. 0 bottom)
    const frac = clamp01(1 - (t.y ?? 0) / 270)
    if (scr === 'left') return void queue('level', { type: 'level', frac }, latest)
    if (scr === 'right') {
      if (frac > 1 - scaling.fxSpeedResetTopFraction) return void queue('fxSpeed', { type: 'fxSpeedReset' }, latest)
      return void queue('fxSpeed', { type: 'fxSpeedAbs', frac }, latest)
    }
  }

  // ---- device: open, wire, reconnect ---------------------------------------------
  let dev = null, stopping = false, reconnecting = false, leds = {}, drawnSig = '', stripSig = {}
  let lastInput = Date.now(), quietWarned = 0, lastEvent = '', hbLost = false, notFound = false

  function wire(d) {
    for (const ev of ['rotate', 'down', 'touchstart']) d.on(ev, e => {
      lastInput = Date.now(); quietWarned = 0
      lastEvent = `${ev} ${e.id ?? (e.changedTouches && e.changedTouches[0].target.screen)}`
    })
    if (TRACE) {
      d.on('rotate', e => log('CT rotate', e.id, e.delta))
      d.on('down', e => log('CT down', e.id))
      d.on('touchstart', e => { const t = e.changedTouches[0]; log('CT touch', t.target.screen, 'key', t.target.key, 'x', t.x, 'y', t.y) })
    }
    d.on('rotate', onRotate)
    d.on('down', onDown)
    // the library's touch events carry no `type`, so pass it in (onTouch picks only on touchstart)
    d.on('touchstart', e => onTouch({ ...e, type: 'touchstart' }))
    d.on('touchmove', e => onTouch({ ...e, type: 'touchmove' }))     // strips update continuously
    d.on('disconnect', e => {
      if (stopping || d !== dev) return
      log('CT disconnected', e ? e.message : '', '- reconnecting')
      reconnect()
    })
  }

  async function open() {
    const d = FAKE ? fakeCT() : await (await import('./connect-ct.mjs')).connectCT()
    wire(d)
    await d.setBrightness(1).catch(() => {})
    leds = {}; drawnSig = ''; stripSig = {}   // a fresh device shows nothing; repaint LEDs, keys and strips
    return d
  }

  // A dropped port (unplug, USB reset) retries every 2 s until the CT is back.
  async function reconnect() {
    if (reconnecting) return
    reconnecting = true
    const old = dev
    dev = null
    if (old && old.connection) delete old.connection.isReady   // undo a test stall so close() runs
    await Promise.resolve(old && old.close()).catch(() => {})
    while (!stopping) {
      await wait(2000)
      // ours already, unless it went stale and another owner took it; re-taken with the real state, not 'connecting'
      const h = FAKE ? null : ctClaim.claim('td-bridge', { state: hbLost ? 'heartbeat-lost' : notFound ? 'not-found' : 'disconnected' })
      if (h) { log(`reconnect: the CT is claimed by ${h.owner} (pid ${h.pid}) - waiting`); continue }
      try { dev = await open(); hbLost = false; notFound = false; log('CT reconnected on', dev.path); break }
      catch (e) {
        if (!notFound || !/No Loupedeck CT found/.test(e.message)) log('reconnect failed:', e.message)   // said once while it is off USB
        notFound = /No Loupedeck CT found/.test(e.message)
      }
    }
    reconnecting = false
  }

  // The keys are labelled from GEN_ORDER / FX_ORDER; say so if the rig's lists differ.
  if (!DRY) {
    const r = await td.exec(`_s=mod('${paths.common}').st();result={'gens':list(_s.GENS),'mods':list(_s.MODS)}`).catch(() => null)
    if (r && r.success) {
      const { gens, mods } = r.data.result
      const off = [...GEN_ORDER.filter(g => !gens.includes(g)), ...gens.filter(g => !GEN_ORDER.includes(g)),
        ...FX_ORDER.filter(f => !mods.includes(f)), ...mods.filter(f => !FX_ORDER.includes(f))]
      log(off.length ? `WARNING key labels and the rig differ: ${off.join(', ')}` : `key labels match the rig: ${gens.length} generators, ${mods.length} effects`)
    }
  }

  // ---- ownership: the ct-router panel, and the claim file every CT owner shares ----------------
  // A signal from another process never reaches the handlers below on Windows: kill('SIGTERM') ends
  // the process at once, which leaves the CT stuck (measured 27 Sep). So the panel starts the bridge
  // with fork() and stops it with an IPC 'stop'; losing the panel stops the bridge too, cleanly.
  // A stop that lands while the CT is still opening waits for stop() below: exiting mid-handshake sticks it.
  let pendingStop = null, stopFn = why => { pendingStop = why }
  if (process.send) {
    process.on('message', m => { if (m === 'stop') stopFn('router: stop') })
    process.on('disconnect', () => stopFn('router gone'))
  }
  for (let said = false; !FAKE;) {
    if (pendingStop) { log(pendingStop, '- the CT was never opened'); ctClaim.release(); process.exit(0) }
    const h = ctClaim.claim('td-bridge')
    if (!h) break
    if (!said) log(`the CT is claimed by ${h.owner} (pid ${h.pid}) - waiting for it to let go`)
    said = true
    await wait(2000)
  }
  let claimLost = false
  const claimTimer = FAKE ? null : setInterval(() => {
    const ours = ctClaim.update({
      state: stopping ? 'closing' : !dev ? (hbLost ? 'heartbeat-lost' : notFound ? 'not-found' : 'disconnected') : quietWarned ? 'quiet' : 'connected',
      port: dev ? dev.path : null, lastInput, lastEvent,
    })
    // Only if this process stalled past the claim's 10 s: another owner saw it as stale and took it.
    if (!ours && !claimLost) { const h = ctClaim.readClaim(); log(`WARNING: the claim was taken by ${h ? `${h.owner} (pid ${h.pid})` : 'nobody'} while this bridge ran - stop one of them`) }
    claimLost = !ours
  }, ctClaim.REFRESH_MS)

  // The CT may be off USB when the bridge starts (unplugged mid-hand-off): keep the claim and wait for
  // it, as a reconnect does, rather than exit.
  log('opening CT...')
  for (let said = false; ;) {
    try { dev = await open(); notFound = false; break }
    catch (e) {
      notFound = /No Loupedeck CT found/.test(e.message)
      if (FAKE || !said) log(`could not open the CT: ${e.message} - retrying every 2 s`)
      if (FAKE) throw e
      said = true
      await wait(2000)
      if (pendingStop) { log(pendingStop, '- the CT was never opened'); ctClaim.release(); process.exit(0) }
    }
  }
  log('CT open on', dev.path)
  if (!FAKE) ctClaim.update({ state: 'connected', port: dev.path })

  // ---- heartbeat: catch a hard hang early -----------------------------------------
  // Every 3 s ask the CT for its VERSION, the lightest command it answers. No answer in 2 s, or a
  // connection that says it is not ready, is a hang: reconnect (proven 2.1 s, 27 Sep). Never the
  // RESET command: on 27 Sep it put this CT into the quiet state it is meant to cure.
  const HEARTBEAT_MS = 3000, HEARTBEAT_TIMEOUT_MS = 2000
  const heartbeat = FAKE ? null : setInterval(async () => {
    if (!dev || reconnecting || stopping) return
    const d = dev
    const ask = d.connection && d.connection.isReady() ? d.send(0x07) : undefined   // VERSION; undefined = not ready
    const ok = ask && await Promise.race([ask.then(() => true), wait(HEARTBEAT_TIMEOUT_MS).then(() => false)])
    if (ok || d !== dev || stopping) return
    log('HEARTBEAT lost: the CT did not answer in', HEARTBEAT_TIMEOUT_MS, 'ms - reconnecting')
    hbLost = true
    reconnect()
  }, HEARTBEAT_MS)

  // ---- quiet warning: the state no ping can see -----------------------------------
  // In the quiet state the CT answers every write and sends no input, and only a replug has cleared
  // it (27 Sep, 3 times). The likely cause is Windows USB power saving (README, "If the CT goes quiet").
  const QUIET_MS = 20000
  const quiet = FAKE ? null : setInterval(() => {
    if (!dev || stopping || Date.now() - lastInput < QUIET_MS) return
    if (quietWarned && Date.now() - quietWarned < 60000) return
    quietWarned = Date.now()
    log(`WARNING: no CT input for ${Math.round((Date.now() - lastInput) / 1000)} s - if you have been turning dials, ` +
      'the CT may have gone quiet: replug it (unplug 5 s, straight into the PC)')
  }, 1000)

  // ---- LED feedback from TD state, 4 times a second; only changed LEDs are written ----
  const COL = { bed: '#00c850', body: '#c800c8', warn: '#c8003c', off: '#000000', flash: '#f1e9da' }
  const LED_OF = s => ({
    genPage: ui.page === 'gen' ? COL.bed : COL.off,
    fxPage:  ui.page === 'fx' ? COL.body : COL.off,
    fxOn:    s.effect_on ? COL.bed : COL.off,
    pulse:   s.fx_pulse ? COL.body : COL.off,
    freeze:  s.gen_frozen ? COL.warn : COL.off,
    tap:     COL.off,
    reset:   COL.off,
  })
  const paint = async want => {
    for (const [name, color] of Object.entries(want)) {
      const id = idOfButton(name, ctIds)
      if (leds[id] === color) continue
      await dev.setButtonColor({ id, color })
      leds[id] = color
      if (TRACE) log('LED', name, '(button ' + id + ')', color)
    }
  }
  // Centre keys: the page on show, labelled, with TD's current pick lit. Redrawn only on change.
  const drawKeys = async s => {
    const st = { page: ui.page, fxOffset: ui.fxPageOffset, generator: s.generator, effect: s.effect }
    const sig = JSON.stringify(st)
    if (sig === drawnSig) return
    await dev.drawBuffer({ id: 'center' }, toRgb565(renderKeys(keysFor(st))))
    drawnSig = sig
    if (TRACE) log('KEYS', st.page === 'gen' ? 'generator page' : `effect page ${st.fxOffset ? 2 : 1}`, '- lit:', st.page === 'gen' ? st.generator : st.effect)
  }

  // Side strips: the three dial names beside each column of dials, with values, and the fader's
  // position on the inner edge. Left = the effect's dials + level; right = the generator's + effect speed.
  const speedFrac = v => Math.log(Math.max(0.1, v) / scaling.fxSpeedMin) / Math.log(scaling.fxSpeedMax / scaling.fxSpeedMin)
  const drawStrips = async s => {
    const want = {
      left:  NEON ? ['look', s.look, null] : [s.effect, s.fx_k, s.td_level],
      right: [s.generator, s.gen_k, speedFrac(s.fx_speed)],
    }
    for (const [side, [name, k, fader]] of Object.entries(want)) {
      // redraw on a new name, a value moving a whole step, or the fader mark moving ~5 px
      const sig = JSON.stringify([name, k && k.map(v => Math.round(v * 100)), Math.round(fader * 50)])
      if (sig === stripSig[side]) continue
      await dev.drawBuffer({ id: side }, toRgb565(renderStrip(side, name, k, fader)))
      stripSig[side] = sig
      if (TRACE) log('STRIP', side, name, k ? k.map(v => Math.round(v * 100)).join('/') : '-')
    }
  }

  // Commit feedback (EDENA's deck does the same since its ct-polish branch): a haptic tap, and the pressed button's LED flashes
  // bone for 120 ms, then goes back to what TD's state says it should be.
  const COMMIT_LED = { fxOn: 'fxOn', pulse: 'pulse', freeze: 'freeze', tap: 'tap', resetGen: 'reset', resetFx: 'reset' }
  const COMMITS = new Set([...Object.keys(COMMIT_LED), 'page', 'pickGenName', 'pickFxName', 'genKnobReset', 'fxKnobReset', 'genSpeedReset', 'fxSpeedReset'])
  let lastWant = {}
  function commitFeedback(type) {
    if (!dev || !COMMITS.has(type)) return
    dev.vibrate(0x01).catch(() => {})
    const name = COMMIT_LED[type]
    if (!name) return
    const id = idOfButton(name, ctIds)
    leds[id] = COL.flash
    dev.setButtonColor({ id, color: COL.flash }).catch(() => {})
    if (TRACE) log('FLASH', name, '(button ' + id + ')')
    setTimeout(() => {
      if (!dev || stopping) return
      const back = lastWant[name] || COL.off
      dev.setButtonColor({ id, color: back }).then(() => { leds[id] = back }).catch(() => { delete leds[id] })
    }, 120)
  }

  let painting = false
  const ledTimer = setInterval(async () => {
    if (!dev || painting) return
    painting = true
    try {
      const s = await readState()
      if (s && dev) { lastWant = LED_OF(s); await paint(lastWant); await drawKeys(s); await drawStrips(s) }
    }
    catch { leds = {} }   // drawing errors are non-fatal; repaint next tick
    finally { painting = false }
  }, 250)

  // Always close the CT cleanly: a killed process leaves the deck stuck (see connect-ct.mjs).
  const stop = async why => {
    if (stopping) return
    stopping = true
    clearInterval(ledTimer); clearInterval(heartbeat); clearInterval(quiet)   // the claim timer runs on, as 'closing'
    if (!FAKE) ctClaim.update({ state: 'closing' })
    log(why, '- closing CT')
    for (let i = 0; painting && i < 40; i++) await wait(50)   // never close mid-framebuffer: that sticks the deck
    if (dev) {
      await dev.drawBuffer({ id: 'center' }, Buffer.alloc(360 * 270 * 2)).catch(() => {})
      for (const id of ['left', 'right']) await dev.drawBuffer({ id }, Buffer.alloc(60 * 270 * 2)).catch(() => {})
      for (const id of Object.keys(ctIds.buttons)) await dev.setButtonColor({ id: Number(id), color: COL.off }).catch(() => {})
      await dev.close().catch(() => {})
    }
    clearInterval(claimTimer)
    log('CT closed cleanly')
    if (!FAKE) ctClaim.release()
    if (stats.events) log(`lanes: ${stats.events} merged events -> ${stats.sends} sends`)
    process.exit(process.exitCode ?? 0)
  }
  stopFn = stop
  if (pendingStop) stop(pendingStop)
  log('LIVE. Turn dials, spin the wheel, tap keys and buttons. Ctrl-C to stop.')
  // SIGHUP is the console window closing (Windows allows ~5 s), SIGBREAK is Ctrl-Break; unhandled,
  // both end the process at once and leave the CT stuck.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => stop(sig))
  const forIdx = process.argv.indexOf('--for')
  if (forIdx > 0) setTimeout(() => stop('--for elapsed'), Number(process.argv[forIdx + 1]) * 1000)
  // test hook: close the serial port under the bridge after N s, as an unplug would, to prove reconnect
  const dropIdx = process.argv.indexOf('--drop-after')
  if (dropIdx > 0) setTimeout(() => { log('TEST: dropping the port'); dev && dev.connection && dev.connection.close() }, Number(process.argv[dropIdx + 1]) * 1000)
  // test hook: make the connection report not-ready, as a hung link would, to prove the heartbeat
  const stallIdx = process.argv.indexOf('--stall-after')
  if (stallIdx > 0) setTimeout(() => { log('TEST: stalling the link'); if (dev && dev.connection) dev.connection.isReady = () => false }, Number(process.argv[stallIdx + 1]) * 1000)

  if (SYNTH) {
    const { SEQ } = await import('./synth-sequence.mjs')
    let pass = 0
    for (const st of SEQ) {
      sent.length = 0
      dev.emit(st.ev, st.data)
      await wait(DRY ? 20 : (st.wait ?? 700))   // let the send + readback land
      const got = sent.filter(Boolean)
      const ok = st.expect === null ? got.length === 0 : got.some(g => g.includes(st.expect))
      if (ok) pass++
      log(ok ? 'PASS' : 'FAIL', st.name, '->', got.join(' | ') || '(no send)', ok ? '' : `\n    expected: ${st.expect}`)
    }
    log(`SYNTH ${pass}/${SEQ.length} passed`)
    process.exitCode = pass === SEQ.length ? 0 : 1
    await stop('synthetic run done')
  }
}

// Stand-in CT for --fake: an event emitter with the device methods the bridge calls.
function fakeCT() {
  const d = new EventEmitter()
  d.path = 'FAKE'
  d.setBrightness = d.setButtonColor = d.drawBuffer = d.vibrate = d.close = async () => {}
  return d
}

function idOfButton(name, ctIds) {
  const hit = Object.entries(ctIds.buttons).find(([, v]) => v === name)
  return hit ? Number(hit[0]) : 0
}
function clamp01(x) { return Math.max(0, Math.min(1, Number(x) || 0)) }

// -------- entry -------------------------------------------------------------------
if (args.has('--print-map')) printMap()
else if (args.has('--selftest')) await selftest()
else if (LIVE) await live()
else usage()
