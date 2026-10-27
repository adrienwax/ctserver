import {createSpotifyClient} from './spotify-client.mjs'
// The deck host: waxyct's permanent owner of the Loupedeck CT. It holds the CT, draws its screens
// from the button config, and turns every press, turn and touch into the active profile's action:
// Windows keys and media, TD verbs, switching apps. The waxyct router starts it (detached, over IPC)
// and restarts it if it dies. Runs with no network and no Claude: config is local JSON.
//
//   Round 1 (tap)          MAIN, page 1: the switchboard
//   Round 1 (hold 1 s)     escape: MAIN from anywhere, stuck keys released
//   Round 2-8              the active profile's pages 1-7 (unavailable on global Home)
//   Landing on a page      runs its "enter" action, if it has one: a Moshpit page switches Moshpit's workspace
//
// Reuses from ct-td-control: connect-ct (open, unstick), ct-claim (the shared lock), ct-draw (screens),
// ct-td-map + td-client (TD). Clean close on every exit path, as the bridge: a killed owner sticks the CT.
import fs from 'node:fs'
import {createHomeDashboard} from './home-dashboard.mjs'
import {homeAppRoute} from './home-routes.mjs'
import {keyBindingKey} from '../ui/control-presentation.mjs'
import path from 'node:path'
import { launchGui } from './launch.mjs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createWinInput, exeName } from './win-input.mjs'
import { loadConfig, COLORS, TILES, DIALS, BUTTONS, ACTIONS } from './profiles.mjs'
import { captureAction, createActionQueue } from './action-queue.mjs'
import { createNativeClient } from './native-client.mjs'
import { createMoshpitClient, ctResolve, BANKS, bankLabel } from './moshpit-client.mjs'
import { dialFeedback } from './dial-feedback.mjs'
import { keyFeedback } from './key-feedback.mjs'
import { renderFeedbackWheel, renderFeedbackStrip, renderFeedbackKeys } from './feedback-renderer.mjs'
import { guardRigScript, rigStateMatches, stateTileActive, tdProfileSupported } from './td-contract.mjs'
import { WORKSPACES, pageWorkspace, workspacePage, nativeWorkspacePage } from './workspace-pages.mjs'
import { loadIcons } from './icon-library.mjs'
import { guardAppInput } from './focus-guard.mjs'
import { controlContext } from './control-context.mjs'
import { createRotaryModifiers, continuousFactor, discreteDelta, volumeChunks } from './rotary-modifiers.mjs'

const rotaryModifiers = createRotaryModifiers()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = process.env.WAXYCT_CONFIG || path.join(HERE, '..', 'config')
const BRIDGE_DIR = process.env.WAXYCT_BRIDGE || path.join(HERE, '..', 'integrations', 'ct-td-control')
const DRY = process.argv.includes('--dry-input')          // tests: log Windows input instead of sending it
const imp = f => import(pathToFileURL(path.join(BRIDGE_DIR, f)).href)
const { connectCT, findCT } = await imp('connect-ct.mjs')
const ctClaim = await imp('ct-claim.mjs')
const draw = await imp('ct-draw.mjs')
draw.setGlyphs(loadIcons(CONFIG_DIR).icons)
const { buildScript, RIG_STATE_PY } = await imp('ct-td-map.mjs')
const { makeTdClient } = await imp('td-client.mjs')

const log = (...a) => console.log(new Date().toISOString(), ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))
const OWNER = 'waxyct'
const tdCfg = JSON.parse(fs.readFileSync(path.join(BRIDGE_DIR, 'config.json'), 'utf8'))
const td = makeTdClient(tdCfg.td)
const win = createWinInput({ dry: DRY, log })

// ---- config ------------------------------------------------------------------------------------------
let cfg = loadConfig(CONFIG_DIR)
let inputEpoch = 0 // increments across context boundaries, including away-and-back changes
const reportConfig = () => { for (const e of cfg.errors) log(`CONFIG ${e.file}: ${e.problems.join(' | ')}${e.usingLastGood ? ' - running its last good version' : ''}`) }
reportConfig()
let reloadTimer = null, configWatcher = null
try {
  configWatcher = fs.watch(CONFIG_DIR, { recursive: true }, (ev, f) => {
    if (!f || /^\.(lastgood|history)/.test(f)) return
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => reload('file changed'), 300)
  })
} catch (e) { log('config watch unavailable:', e.message) }
function reload(why) {
  if (stopping) return
  home.invalidate()
  rotaryModifiers.reset()
  draw.setGlyphs(loadIcons(CONFIG_DIR).icons)
  inputEpoch++; pendingPageEntry = null
  cfg = loadConfig(CONFIG_DIR)
  for(const c of native.values())c.stop()
  native.clear()
  for (const [id, client] of mosh) if (!cfg.apps[id] || cfg.apps[id].target !== 'moshpit') { client.stop(); mosh.delete(id) }
  log(`config reloaded (${why}): ${Object.keys(cfg.profiles).length} profiles${cfg.errors.length ? `, ${cfg.errors.length} with problems` : ''}`)
  reportConfig()
  if (!tdProfileSupported(cfg.profiles[view.profile])) view = { profile: 'main', page: 0 }
  if (!(prof().pages || [])[view.page]) view.page = 0   // the edit removed the page the CT was on
  repaint(true)
  status()
}

// ---- where the CT is: the active profile and page -----------------------------------------------------
let view = { profile: cfg.profiles[cfg.settings.startProfile] ? cfg.settings.startProfile : 'main', page: 0 }
let pendingPageEntry = null, passiveProfile = false
const lastPage = {}                               // profile -> page, so returning lands where you were
const workspacePages = {}                        // per profile, remember the owner's subpage in each workspace
const lastOfApp = {}                              // app -> the profile last played, for the app key's second press
const prof = () => cfg.profiles[view.profile] || cfg.profiles.main
const configuredPage = () => (prof().pages || [])[view.page] || {}
const page = () => view.profile === 'main' ? home.snapshot(configuredPage()).page : configuredPage()
const note = { text: '', at: 0 }                  // the last thing that went wrong, shown on status

// ---- the device --------------------------------------------------------------------------------------
let dev = null, stopping = false, reconnecting = false, notFound = false, hbLost = false
let openingTask = null, reconnectTask = null, stopAttempt = null, claimTimer = null
const ownedDevices = new Set(), closingDevices = new Map(), lifecycleTimers = new Set()
const startupAbort = new AbortController()
// Cosmetic ACKs may never arrive on a disconnected CT. They must not gate port closure.
function bestEffortAck(send, timeoutMs, signal) {
  if (signal?.aborted || timeoutMs <= 0) return Promise.resolve(false)
  return new Promise(resolve => {
    let settled = false
    const finish = ok => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(ok)
    }
    const onAbort = () => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    try { Promise.resolve(send()).then(() => finish(true), () => finish(false)) }
    catch { finish(false) }
  })
}
const every = (fn, ms) => { const timer = setInterval(fn, ms); lifecycleTimers.add(timer); return timer }
function closeDevice(device) {
  if (!ownedDevices.has(device)) return Promise.resolve()
  if (closingDevices.has(device)) return closingDevices.get(device)
  const task = Promise.resolve().then(() => device.close()).then(() => { ownedDevices.delete(device) }).finally(() => closingDevices.delete(device))
  closingDevices.set(device, task)
  return task
}
let lastInput = Date.now(), lastEvent = '', quietWarned = 0, drawing = false
let tdOk = null, running = {}                     // app exe -> running, for the switchboard
let tdCheckedAt = 0, tdProfileId = null, tdReadSequence = 0
let tdState = null                                // CT_RIG's { clip, on, norm } while a TD page is up
const counts = { actions: 0, blocked: 0, heartbeatLost: 0 }
// Moshpit v3 (Route B): one adapter per Moshpit app, started the first time a Moshpit profile is used and kept
// up while waxyct runs. Keyboard held makes rotary controls fine; either Fn makes them fast.
const mosh = new Map()
const native = new Map()
function nativeOf(p) {
  if(p?.app?.target!=='native')return null
  let c=native.get(p.appId)
  if(!c){c=p.app.driver==='windows-media'?createSpotifyClient({win}):createNativeClient({appId:p.appId,endpointFile:p.app.endpointFile});native.set(p.appId,c)}
  return c
}
function captureNative(action,c) {
  if(action.macro)return {...action,macro:action.macro.map(a=>captureNative(a,c))}
  return action.native ? {...action,native:{...action.native,captured:c?.capture(action.native)}} : action
}
async function pollNative() {
  const p=prof(),c=nativeOf(p),epoch=inputEpoch
  if(!c||stopping)return
  const up=c.connected(),oldWorkspace=c.state().workspace;await c.refresh()
  if(stopping||epoch!==inputEpoch||p!==prof())return
  const requested=pendingPageEntry?.profile===view.profile&&pendingPageEntry.page===view.page
  if(!up&&c.connected()&&requested&&!passiveProfile){pendingPageEntry=null;enterPage()}
  else if(c.connected()&&(!up||oldWorkspace!==c.state().workspace)){
    const next=nativeWorkspacePage(p,c.state().workspace,view.page,!up)
    if(next!==null&&next!==view.page){view.page=next;lastPage[p.id]=next;inputEpoch++;rotaryModifiers.reset()}
  }
  repaint();status()
}
let moshTick = 0
// The slot the dials follow, per app: a select key or a "selstep" dial sets it, "slot": "sel" reads it. CT-side
// only: the control protocol does not carry Moshpit's own selection (yet; CT-PAR-PLAN.md M1).
// The bank, per app: what the right dials edit (EDENA's grammar: left dials browse, right dials edit). A dial with
// "bank": n is the bank's nth: params 1-3, params 4-6, or the first LFO's period and phase (the third is blank).
const sel = {}, bank = {}
const mres = (v) => ctResolve(v, sel[prof().appId] ?? 1, bank[prof().appId] || 0)
// Status and panel callbacks run during claim/device waits: initialize their feedback first.
const currentTdFresh = (p = prof()) => !!(tdOk && tdProfileId === view.profile && Date.now()-tdCheckedAt<5000 && rigStateMatches(p,tdState))
const currentDialFeedback = (p = prof(), pg = page()) => ({
  ...dialFeedback({ page: pg, nativeClient:native.get(p.appId), client: mosh.get(p.appId), selection: sel[p.appId] ?? 1, bank: bank[p.appId] || 0, tdState, tdOk: currentTdFresh(p), contextId:JSON.stringify([view.profile,view.page,inputEpoch]) }),
  ...(view.profile==='main'?home.snapshot(configuredPage()).dialFeedback:{})
})
const baseKeyFeedback = (p = prof(), pg = page()) => keyFeedback({page:pg,profile:p,nativeClient:native.get(p.appId),client:mosh.get(p.appId),selection:sel[p.appId]??0,bank:bank[p.appId]||0,tdState,tdOk:currentTdFresh(p),apps:cfg.apps,profiles:cfg.profiles,view,running,lastOfApp})
const currentKeyFeedback=(p=prof(),pg=page())=>{const readings=baseKeyFeedback(p,pg);if(view.profile==='main'){const h=home.snapshot(configuredPage());if(h.highlight!==null&&pg.keys[h.highlight])readings[h.highlight]={kind:'selection',state:'confirmed',selected:true,enabled:null,bindingKey:keyBindingKey(pg.keys[h.highlight]),display:{active:true,dim:false}};}return readings};
function moshOf(p) {
  if (!p || !p.app || p.app.target !== 'moshpit') return null
  let c = mosh.get(p.appId)
  if (!c) {
    const env = (s) => s && s.replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? m)   // "%APPDATA%/Moshpit 3/..."
    c = createMoshpitClient({ endpointFile: env(p.app.endpointFile), endpoint: p.app.endpoint, log, clientVersion: cfg.version || '' })
    let was = false
    c.onChange((why) => {
      const s = c.syncs() ? c.selectedSlot() : Math.min(c.state().slots.length, Math.max(1, sel[p.appId] ?? 1)) // legacy peers retain the CT cursor; explicit no-selection stays zero
      if (why === 'selection' || why === 'targets') { if (sel[p.appId] !== s && prof().appId === p.appId) inputEpoch++; sel[p.appId] = s }
      if (why === 'phase' && prof().appId === p.appId) { rotaryModifiers.reset(); inputEpoch++ }
      moshTick++
      const up = c.connected()
      if (up && prof().appId === p.appId) {
        if (why === 'workspace' || !was) {
          const requested = pendingPageEntry?.profile === view.profile && pendingPageEntry.page === view.page
          if (requested) { pendingPageEntry = null; enterPage() }
          else {
            const followed = followWorkspace(c.state().workspace)
            if (!passiveProfile && !was && !followed) enterPage() // legacy server/profile retains its existing entry behavior
          }
        }
      }
      was = up
      repaint(); status()
    })
    mosh.set(p.appId, c)
    c.start()
  }
  return c
}
// Declared before the waits below: the router's messages (escape, switch) can arrive while the CT is still
// being waited for, and must not meet a variable that does not exist yet.
const holds = new Map()                           // button id -> { timer, fired }
let switching = false, switchRequest = 0
function actionContext() {
  const p = prof(), c = mosh.get(p.appId)
  return JSON.stringify([inputEpoch, view.profile, view.page, sel[p.appId], bank[p.appId], c?.state().generation, c?.state().phase,native.get(p.appId)?.state().sessionId,native.get(p.appId)?.state().contextId])
}
const lanes = createActionQueue({ context: actionContext, execute: j => act(j.action, j.what, j.delta, j.context, j.mode), error: (e, j) => flash(`${j.what}: ${e.message}`) })

const homePending = new Map(); let homeRequestId=0;
function homeRequest(operation,payload,current){
 if(!process.connected)return Promise.reject(Error('CTserver panel unavailable'));
 return new Promise((resolve,reject)=>{const id=++homeRequestId,epoch=inputEpoch;
  const timer=setTimeout(()=>{homePending.delete(id);reject(Error('Home request timed out; select again'))},12000);
  homePending.set(id,{resolve,reject,timer,current,epoch});process.send({type:'home-request',id,epoch,operation,payload});
 });
}
const home = createHomeDashboard({
 inventory:()=>({profiles:Object.values(cfg.profiles).map(p=>({...p,pages:(p.pages||[]).map(g=>g.name),supported:tdProfileSupported(p)})),apps:Object.fromEntries(Object.entries(cfg.apps).map(([id,a])=>[id,{...a,running:a.exe&&Object.hasOwn(running,a.exe)?running[a.exe]:null}])),connected:!!dev}),
 request:homeRequest,activate:(id,page,passive,current,kind)=>current()?switchTo(id,kind==='app'?'Home app':'Home',page,passive):undefined,
 change:()=>{inputEpoch++;rotaryModifiers.reset();lanes.clear();for(const h of holds.values())clearTimeout(h.timer);holds.clear();
  for(const [id,p] of homePending){clearTimeout(p.timer);p.reject(Error('Home selection changed'));homePending.delete(id)}
  if(process.connected)process.send({type:'home-cancel',epoch:inputEpoch});repaint();status();},
});
const stopFn = why => { void stop(why).catch(e => log('CT close failed:', e.message, '- keeping the claim; retry Stop')) }
if (process.send) {
  process.send({type:'home-cancel',epoch:inputEpoch})
  process.on('message', m => {
    if (m === 'stop') return stopFn('router: stop')
    if (stopping) return
    if (m && m.type === 'home-result') {const p=homePending.get(m.id);if(!p)return;homePending.delete(m.id);clearTimeout(p.timer);if(p.epoch!==m.epoch||!p.current())return p.reject(Error('Home selection changed'));return m.error?p.reject(Error(m.error)):p.resolve(m.result)}
    if (m && m.type === 'home-input' && view.profile==='main' && m.revision===home.snapshot(configuredPage()).revision) {if(m.kind==='move'&&Number.isSafeInteger(m.delta))return home.move(m.delta);if(m.kind==='select')return home.select();if(m.kind==='key'&&Number.isInteger(m.slot)&&m.slot>=0&&m.slot<12){const a=page().keys[m.slot]?.do;return a&&run(a,'Home key '+m.slot)}return}
    if (m && m.type === 'switch') return switchTo(m.id, 'panel', m.page, m.profileOnly === true)
    if (m && m.type === 'page') return goPage(m.page)
    if (m && m.type === 'reload') return reload('asked by the panel')
    if (m && m.type === 'escape') return escape()
    // tests only (dry input): press the CT from outside, as if by hand
    if (DRY && m && m.type === 'emit' && dev) return dev.emit(m.ev, m.data)
  })
}
process.on('disconnect', () => stopFn('router gone'))
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => stopFn(sig))
// IPC messages are queued until a listener exists; disconnect events are not.
// An owner lost while bridge imports were pending must never claim/open the CT.
if (process.send && !process.connected) stopFn('router gone during startup')
else {
  every(() => status(), 2000) // list profiles even while the CT is unplugged
  moshOf(cfg.profiles[view.profile]) // starting on a Moshpit profile: link up at once
}
for (let said = false; ;) {                       // take the shared claim; wait while another owner holds it
  if (stopping) while (stopping) { await stopAttempt?.catch(() => {}); await wait(250) }
  const h = ctClaim.claim(OWNER)
  if (!h) break
  if (!said) log(`the CT is claimed by ${h.owner} (pid ${h.pid}) - waiting for it to let go`)
  said = true
  await wait(2000)
}
claimTimer = setInterval(() => {
  ctClaim.update({ state: stopping ? 'closing' : !dev ? (hbLost ? 'heartbeat-lost' : notFound ? 'not-found' : 'disconnected') : quietWarned ? 'quiet' : 'connected',
    port: dev ? dev.path : null, lastInput, lastEvent, profile: view.profile, page: view.page })
}, ctClaim.REFRESH_MS)

function open() {
  const task = (async () => {
    const d = await connectCT()
    ownedDevices.add(d)
    if (stopping) return null // stop owns and awaits closure; never publish a late device
    const bright = await bestEffortAck(() => d.setBrightness(1), 1000, startupAbort.signal)
    if (!stopping) log(bright ? 'brightness set to full' : 'brightness ACK unavailable; continuing')
    if (stopping) return null
    wire(d)
    return d
  })()
  openingTask = task
  return task.finally(() => { if (openingTask === task) openingTask = null })
}
log('opening CT...')
for (let said = false; !stopping;) { // an absent CT is waited for, not a reason to exit
  try { const opened = await open(); if (!stopping) { dev = opened; notFound = false } break }
  catch (e) {
    if (stopping) break
    notFound = /No Loupedeck CT found/.test(e.message)
    if (!said) log(`could not open the CT: ${e.message} - retrying every 2 s`)
    said = true
    await wait(2000)
  }
}
// A stop during startup must finish before any LIVE status, listeners or drawing are installed.
if (stopping) while (stopping) { await stopAttempt?.catch(() => {}); await wait(250) }
else { log('CT open on', dev.path); ctClaim.update({ state: 'connected', port: dev.path }) }

function reconnect() {
  if (reconnecting || stopping) return reconnectTask
  rotaryModifiers.reset()
  reconnecting = true
  inputEpoch++; lanes.clear()
  const old = dev
  dev = null
  reconnectTask = (async () => {
    if (old) await closeDevice(old)
    if (stopping) return
    status()
    while (!stopping) {
      await wait(2000)
      if (stopping) break // a stopped retry must never reclaim or reopen the port
      const h = ctClaim.claim(OWNER, { state: hbLost ? 'heartbeat-lost' : notFound ? 'not-found' : 'disconnected' })
      if (h) { log(`reconnect: the CT is claimed by ${h.owner} (pid ${h.pid}) - waiting`); continue }
      try {
        const opened = await open()
        if (stopping) break
        dev = opened; hbLost = false; notFound = false
        log('CT reconnected on', dev.path); drawnSig = ''; repaint(true); break
      } catch (e) {
        if (stopping) break
        if (!notFound || !/No Loupedeck CT found/.test(e.message)) log('reconnect failed:', e.message)
        notFound = /No Loupedeck CT found/.test(e.message)
      }
    }
  })().catch(e => { log('reconnect close failed:', e.message); note.text = `CT close failed: ${e.message}`; note.at = Date.now() }).finally(() => {
    reconnecting = false; reconnectTask = null
    if (!stopping) status()
  })
  return reconnectTask
}

// ---- input -------------------------------------------------------------------------------------------
function wire(d) {
  const seen = ev => e => { lastInput = Date.now(); quietWarned = 0; lastEvent = `${ev} ${e.id ?? e.changedTouches?.[0]?.target?.screen}` }
  d.on('down', seen('down')); d.on('rotate', seen('rotate')); d.on('touchstart', seen('touch'))
  const tell = m => { if (process.send && process.connected) process.send({ type: 'input', ...m }) }
  d.on('down', ({ id }) => tell({ ev: 'down', id }))
  d.on('rotate', ({ id, delta }) => tell({ ev: 'rotate', id, delta }))
  d.on('touchstart', ({ changedTouches }) => { const t = changedTouches[0]; tell({ ev: 'touch', screen: t?.target?.screen, key: t?.target?.key }) })
  d.on('down', ({ id }) => { if (!stopping && d === dev && !rotaryModifiers.down(id)) onDown(id) })
  d.on('up', ({ id }) => { if (!stopping && d === dev && !rotaryModifiers.up(id)) onUp(id) })
  d.on('rotate', ({ id, delta }) => { if (!stopping && d === dev) onRotate(id, delta) })
  d.on('touchstart', ({ changedTouches }) => !stopping && d === dev && onTouch(changedTouches[0]))
  d.on('touchmove', ({ changedTouches }) => !stopping && d === dev && onStrip('move', changedTouches[0]))
  d.on('touchend', ({ changedTouches }) => !stopping && d === dev && onStrip('end', changedTouches[0]))
  d.on('disconnect', e => { if (!stopping && d === dev) { log('CT disconnected', e ? e.message : '', '- reconnecting'); reconnect() } })
}
const DIAL_OF = { knobTL: 'TL', knobCL: 'CL', knobBL: 'BL', knobTR: 'TR', knobCR: 'CR', knobBR: 'BR' }

function onDown(id) {
  if (id === 0) {                                 // round 1: tap = MAIN, hold = the escape
    const h = { context: actionContext(), timer: null, fired: false }
    clearTimeout(holds.get(0)?.timer)
    h.timer = setTimeout(() => { if (holds.get(0) !== h || h.context !== actionContext()) return; h.fired = true; escape() }, cfg.settings.escapeHoldMs)
    return void holds.set(0, h)
  }
  if (typeof id === 'number') return goRound(id)
  if (DIAL_OF[id]) return run((page().dials || {})[DIAL_OF[id]]?.press, `press ${DIAL_OF[id]}`)
  if (BUTTONS.includes(id)) {
    const b = (page().buttons || {})[id]
    if (!b) return buzz()
    // Fn + the Moshpit Undo key is Redo. Capture on press, independent of the
    // rotary fine/fast priority; release (in either order) must not also undo.
    if (id === 'undo' && holds.get(id)?.fnRedoDevice === dev) return
    if (id === 'undo' && rotaryModifiers.fnHeld() && (b.redo || b.do?.moshpit?.verb === 'command' && b.do.moshpit.command === 'edit.undo')) {
      clearTimeout(holds.get(id)?.timer)
      holds.set(id, { timer: null, fired: true, fnRedoDevice: dev })
      return run(b.redo || { moshpit: { verb: 'command', command: 'edit.redo' } }, id)
    }
    if (!b.hold) return run(b.do, id)             // no hold action: act at once
    const h = { context: actionContext(), timer: null, fired: false }
    clearTimeout(holds.get(id)?.timer)
    h.timer = setTimeout(() => { if (holds.get(id) !== h || h.context !== actionContext()) return; h.fired = true; run(b.hold, `${id} (hold)`) }, cfg.settings.holdMs)
    holds.set(id, h)
  }
}
function onUp(id) {
  const h = holds.get(id)
  if (!h) return
  clearTimeout(h.timer)
  holds.delete(id)
  if (h.fired || h.context !== actionContext()) return
  if (id === 0) return goMain()
  const b = (page().buttons || {})[id]
  if (b) run(b.do, id)
}
function onRotate(id, delta) {
  if (!Number.isSafeInteger(delta) || !delta) return
  const mode = rotaryModifiers.mode() // capture now; release must not change queued detents
  if (id === 'knobCT' && view.profile==='main') return home.move(delta)
  if (id === 'knobCT') return run(page().wheel?.turn, 'wheel', delta, mode)
  if (DIAL_OF[id]) return run((page().dials || {})[DIAL_OF[id]]?.turn, `turn ${DIAL_OF[id]}`, delta, mode)
}
// Strips always display the adjacent knobs. Profiles can disable their mirrored gestures;
// Moshpit's shipped pages use display-only strips, while physical knobs remain active.
const STRIP_STEP = 16
let strip = null
const stripDial = (s) => (s.side === 'left' ? ['TL', 'CL', 'BL'] : ['TR', 'CR', 'BR'])[s.cell]
function onStrip(ev, t) {
  if (prof().stripGestures === false || strip?.context !== actionContext()) { strip = null; return }
  if (!strip || !t || (t.target && t.target.screen !== strip.side)) return
  if (ev === 'move') {
    const steps = Math.trunc((strip.y - (t.y ?? strip.y)) / STRIP_STEP)
    if (!steps) return
    strip.y -= steps * STRIP_STEP
    strip.moved = true
    return run((page().dials || {})[stripDial(strip)]?.turn, `turn ${stripDial(strip)}`, steps)
  }
  const s = strip
  strip = null
  if (!s.moved) run((page().dials || {})[stripDial(s)]?.press, `press ${stripDial(s)}`)
}
function onTouch(t) {
  if (!t || !t.target) return
  if (t.target.screen === 'left' || t.target.screen === 'right') {
    if (prof().stripGestures === false) { strip = null; return }
    return void (strip = { side: t.target.screen, cell: Math.min(2, Math.max(0, Math.floor((t.y ?? 0) / 90))), y: t.y ?? 0, moved: false, context: actionContext() })
  }
  if (t.target.screen === 'knob' && view.profile==='main') return home.select()
  if (t.target.screen === 'knob') return run(page().wheel?.tap, 'wheel tap')
  if (t.target.screen === 'center' && typeof t.target.key === 'number') {
    if (page().status) return
    const k = (page().keys || {})[String(t.target.key)]
    return k ? run(k.do, `key ${t.target.key}`) : buzz()
  }
}

// ---- pages and profiles ------------------------------------------------------------------------------
function rememberWorkspacePage() {
  const workspace = pageWorkspace(page())
  if (workspace) (workspacePages[view.profile] ||= {})[workspace] = view.page
}
function followWorkspace(workspace) {
  const n = workspacePage(prof(), workspace, view.page, workspacePages[view.profile])
  if (n === null) return prof().followWorkspace === true && WORKSPACES.includes(workspace)
  if (n !== view.page) { rotaryModifiers.reset(); inputEpoch++; pendingPageEntry = null; view.page = n; lastPage[view.profile] = n; repaint(true) }
  rememberWorkspacePage()
  return true // no enterPage: feedback must never echo a navigation command
}
function goMain() { if(view.profile!=='main')home.setProfile(view.profile);home.reset();rotaryModifiers.reset(); inputEpoch++; pendingPageEntry = null; view = { profile: 'main', page: 0 }; passiveProfile = false; repaint(true); status() }
async function escape() {
  log('ESCAPE: round 1 held - back to MAIN, keys released')
  await win.release().catch(() => {})
  lanes.clear()
  dev && dev.vibrate(0x0a).catch(() => {})
  goMain()
}
// Round r (0-based id 1..7): first useful app page is round 2. Home has no secondary pages.
function goRound(r) {
  if (view.profile === 'main') return buzz()
  const n = r - 1
  if (!prof().pages || !prof().pages[n]) return buzz()
  rotaryModifiers.reset()
  inputEpoch++; pendingPageEntry = null; passiveProfile = false; view.page = n
  lastPage[view.profile] = n
  rememberWorkspacePage()
  enterPage()
  repaint(true)
  status()
}
function goPage(p) { const n = Number(p) - 1; if (prof().pages && prof().pages[n]) { rotaryModifiers.reset(); inputEpoch++; pendingPageEntry = null; passiveProfile = false; view.page = n; lastPage[view.profile] = n; rememberWorkspacePage(); enterPage(); repaint(true); status() } }
// A page's "enter" action, run on landing. A Moshpit link that is not up yet is not an error here: the link
// runs it when it comes up.
async function enterPage() {
  if (passiveProfile) return
  const e = page().enter, p = prof()
  if (!e) return
  if (e.native) { const c=nativeOf(p);if(!c?.connected()){pendingPageEntry={profile:view.profile,page:view.page};return} }
  if (e.moshpit) { const c = moshOf(p); if (!c || !c.connected()) return }
  if (e.keys && p.app && p.app.exe && !await win.running(p.app.exe)) return   // a shortcut page with its app closed: nothing to switch
  run(e, `enter ${page().name || ''}`.trim())
}

async function switchTo(id, from = 'CT', requestedPage, profileOnly = false) {
  if(view.profile==='main'&&id!=='main')home.invalidate()
  const p = cfg.profiles[id]
  if (!p) { flash(`no profile "${id}"`); return buzz() }
  if (!tdProfileSupported(p)) { flash(`${p.name}: TD profile unavailable; choose an identity-guarded profile`); return buzz() }
  if (requestedPage !== undefined && (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > (p.pages || []).length)) { flash('That workspace is unavailable'); return buzz() }
  rotaryModifiers.reset()
  const request = ++switchRequest, epoch = ++inputEpoch
  const current = () => request === switchRequest && epoch === inputEpoch && cfg.profiles[id] === p
  pendingPageEntry = null; switching = true
  try {
    if (p.handoff && profileOnly) { flash('This profile needs an explicit device handoff'); return }
    if (p.handoff) {                              // EDENA until phase 4: it opens the CT itself
      log(`switch to ${p.name}: handing the CT over (${from})`)
      if (process.send) process.send({ type: 'want', owner: id })
      else flash(`${p.name} needs the waxyct window to hand over`)
      return
    }
    if (!profileOnly && p.app && p.app.exe) {
      let up = await win.running(p.app.exe)
      if (!current()) return
      let appLaunch=p.app.launch;
      if(!up&&from==='Home app'&&['moshpit','touchdesigner'].includes(p.appId)){const route=homeAppRoute(p.appId);if(route.error){flash(route.error);return}appLaunch=route.file;}
      if (!up && appLaunch) {
        log(`${p.name} is not running: starting it`)
        launch(appLaunch)
        for (let i = 0; i < 40 && !up; i++) { await wait(500); if (!current()) return; up = await win.running(p.app.exe); if (!current()) return }
      }
      if (!up) flash(`${p.name} is not running`)
      else {
        const f = await win.focus(p.app.exe)
        if (!current()) return
        if (f !== 'ok') flash(`${p.name}: Windows refused to bring it forward (${f})`)
      }
    }
    if (!current()) return
    rotaryModifiers.reset() // a key pressed during slow app activation belongs to the former profile
    passiveProfile = profileOnly
    view = { profile: id, page: requestedPage === undefined ? lastPage[id] || 0 : requestedPage - 1 }
    lastPage[id] = view.page; rememberWorkspacePage()
    if (!profileOnly && requestedPage !== undefined) pendingPageEntry = { profile: id, page: view.page }
    if (p.appId && !p.pick) lastOfApp[p.appId] = id
    if(p.app?.target==='native'){
      const client=nativeOf(p)
      if(!profileOnly&&requestedPage!==undefined){pendingPageEntry=null;enterPage()}
      else if(client?.connected()){
        const next=nativeWorkspacePage(p,client.state().workspace,view.page,true)
        if(next!==null){view.page=next;lastPage[id]=next}
      }
    }else{
      const client = moshOf(p)
      if (!profileOnly && requestedPage !== undefined) { if (!client || client.connected()) { pendingPageEntry = null; enterPage() } }
      else if (!profileOnly && (!client?.connected() || !followWorkspace(client.state().workspace))) enterPage()
    }
    log(`switched to ${p.name} (${from})`)
    repaint(true)
    status()
  } finally { if (request === switchRequest) switching = false }
}

// An app key on Home opens the last useful profile, otherwise its declared default.
// Choosing another TD rig is available in the desktop selector; legacy profiles stay parked.
function appKey(aid) {
  const a = cfg.apps[aid]
  if (!a) { flash(`no app "${aid}"`); return buzz() }
  const mine = Object.values(cfg.profiles).filter(x => x.appId === aid && x.tier === 'current' && !x.pick)
  if (!mine.length) { flash(`${a.name}: no current profile yet`); return buzz() }
  return switchTo(mine.find(p => p.id === lastOfApp[aid])?.id || mine.find(p => p.id === a.default)?.id || mine[0].id,'Home app')
}

// ---- actions -----------------------------------------------------------------------------------------
function launch(target) {
  return launchGui(target, { dry: DRY, onDry: file => log(`DRY launch: ${file}`), onError: (error, file) => flash(`could not start ${file || 'app'}: ${error.message}`) })
}
function run(action, what, delta = 0, mode = 'normal') {
  if (!action) return buzz()
  const p = prof(), client = moshOf(p)
  let captured = captureAction(action, client, sel[p.appId] ?? 1, bank[p.appId] || 0)
  if(action.native||action.macro)captured=captureNative(captured,nativeOf(p))
  lanes.run(what.replace(/ \(hold\)$/, ''), captured, what, delta, mode)
}
async function act(a, what, delta, context = actionContext(), mode = 'normal') {
  if (context !== actionContext() || stopping) return
  counts.actions++
  const k = Object.keys(a).find(x => ACTIONS.includes(x))
  const v = a[k]
  const dir = Math.sign(delta) || 1, steps = delta ? discreteDelta(delta, mode) : 1
  const n = Math.max(1, Math.abs(steps))
  const result = r => { if (r === 'blocked') { counts.blocked++; flash(`${what}: Windows blocked the keys (an administrator window?)`); buzz() } }
  // keys, typing and scrolling go to the front window: an app profile brings its app forward first
  const inputExe=['keys','type','scroll'].includes(k) ? page().inputExe||prof().app?.exe : null
  const needsApp = ['keys', 'type', 'scroll'].includes(k) && inputExe && !prof().handoff
  if (needsApp) {
    const app = prof()
    if (!await guardAppInput(win, inputExe, () => context === actionContext() && !stopping, reason => { flash(`${app.name}: ${reason}`); buzz() })) return
  }
  switch (k) {
    case 'keys': {
      const combo = Array.isArray(v) ? v[dir < 0 ? 0 : 1] : v
      for (let i = 0; i < (Array.isArray(v) ? n : 1) && context === actionContext() && !stopping; i++) result(await win.keys(combo))
      return
    }
    case 'media': return result(await win.media(v))
    case 'volume': return volumeChunks(v * steps, async part => result(await win.volume(part)), () => context === actionContext() && !stopping)
    case 'scroll': return result(await win.scroll(v * steps))
    case 'type': return result(await win.type(v))
    case 'launch': return launch(v)
    case 'focus': { const r = await win.focus(v); if (r !== 'ok') { flash(`${v}: ${r}`); buzz() } return }
    case 'app': return appKey(v)
    case 'switch': return switchTo(v)
    case 'page': return goPage(v)
    case 'main': return goMain()
    case 'home': if(view.profile==='main')return home.action(v,delta?steps:0);return
    case 'none': return
    case 'native': {
      const c=nativeOf(prof());if(!c)throw Error('No native app adapter for this profile')
      await c.act(v.captured,delta,mode,()=>context===actionContext()&&!stopping);repaint();status();return
    }
    case 'td': {
      if (!prof().rigIdentity || !tdProfileSupported(prof())) { tdOk = false; flash('TD profile unavailable: no supported project identity'); return buzz() }
      const t = { ...v }
      if (/Knob$/.test(t.type)) t.delta = (delta || 0) * cfg.settings.knobStep * continuousFactor(mode)
      if (t.type === 'rigKnob') { t.detents = delta || 0; t.detentStep = cfg.settings.knobStep * continuousFactor(mode) }
      if (/Step$/.test(t.type)) t.step = delta ? (t.step ?? 1) * steps : (t.step ?? dir)
      let script = buildScript(t, tdCfg.tdPaths, tdCfg.scaling, tdCfg.guards)
      if (!script) return flash(`td ${t.type}: not available`)
      script = guardRigScript(script, prof().rigIdentity)
      const r = await td.exec(script).catch(e => ({ success: false, error: e.message }))
      if (!r || r.success === false) { tdOk = false; flash(`TD did not take it: ${r ? r.error : 'no answer'}`); return buzz() }
      tdOk = true
      if (/^rig/.test(t.type)) readTd()
      return
    }
    case 'moshpit': {
      const c = moshOf(prof())
      if (!c) { flash(`${prof().name} is not a Moshpit profile`); return buzz() }
      const app = prof().appId, n = c.state().slots.length
      // a select key or the NODE dial: the CT's cursor moves at once, and Moshpit's inspector follows (M1)
      const pick = (to) => { inputEpoch++; sel[app] = to; moshTick++; repaint(); status(); const s = c.state().slots[to - 1]; if (c.connected() && s) c.select(s.nodeId).catch((e) => flash(`Moshpit: ${e.message}`)) }
      if (v.verb === 'select') return pick(v.slot)
      // browsing knobs: CT-side cursors, so they work before Moshpit answers
      if (v.verb === 'selstep') { const to = Math.min(Math.max(1, n), Math.max(1, (sel[app] ?? 1) + (v.step ?? 1) * steps)); if (!n || to === (sel[app] ?? 1)) return buzz(); return pick(to) }
      if (v.verb === 'bank') { inputEpoch++; bank[app] = (((bank[app] || 0) + steps) % BANKS.length + BANKS.length) % BANKS.length; moshTick++; status(); return repaint() }
      if (v.captured && !v.path) return buzz()
      const r = v.captured ? v : mres(v)
      if (!r) return buzz()
      if (!c.connected()) { buzz(); throw new Error(`Moshpit: ${c.state().detail || 'not connected'}`) }
      try { await c.act(r, delta, mode) } catch (e) {
        // Let the queue discard this burst's unsent tail after a failed/uncertain
        // ACK. Its error callback flashes the note; retain the device vibration.
        buzz()
        throw new Error(`Moshpit: ${e.message}`, { cause: e })
      }
      return
    }
    case 'macro':
      for (const s of v) { if (typeof s.wait === 'number') await wait(Math.min(5000, s.wait)); else await act(s, what, 0, context, mode) }
      return
  }
}
function buzz() { dev && dev.vibrate(0x1e).catch(() => {}) }
function flash(text) { note.text = text; note.at = Date.now(); log(`NOTE ${text}`); status(); repaintStatus() }

// ---- screens -----------------------------------------------------------------------------------------
const hex = c => COLORS[c] || c || COLORS.bone
const dim = (h, f) => '#' + [1, 3, 5].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('')
let drawnSig = '', repaintPending = false, repaintForce = false, drawDevice = null, drawToken = 0
const surfaceSignatures = new Map()
async function repaint(force) {
  if (!dev || stopping) return
  // A replacement device needs all pixels even when its COM path is unchanged.
  // An unresolved ACK on the retired device must not block the new device's draw.
  if (drawDevice !== dev) {
    drawDevice = dev; drawToken++; drawing = false
    drawnSig = ''; surfaceSignatures.clear(); repaintPending = false; repaintForce = false
  }
  if (drawing) { repaintPending = true; repaintForce ||= !!force; return }
  const device = dev, token = ++drawToken
  const p = prof(), pg = page(), keyReadings = currentKeyFeedback(p, pg)
  const keys = pg.status ? statusKeys() : Array.from({ length: 12 }, (_, i) => {
    const k = (pg.keys || {})[String(i)]
    if (!k) return null
    const sw = k.do && k.do.switch && cfg.profiles[k.do.switch]
    const ak = k.do && k.do.app && cfg.apps[k.do.app]                 // an app key: lit while that app is on the CT
    const app = ak ? ak.exe : sw && sw.app && sw.app.exe
    const mp = mres(k.do && k.do.moshpit), mc = mp && moshOf(p)
    let reading=keyReadings[String(i)]
    if(view.profile==='main'){const h=home.snapshot(configuredPage());if(h.highlight===i)reading={kind:'selection',state:'confirmed',selected:true,enabled:null,bindingKey:keyBindingKey(k),display:{active:true,dim:false}}}
    const node = mp && mp.slot && mc && mc.slotName(mp.slot)   // a Moshpit slot key: the node's live name is the label, the key's own tag the sub
    return { label: mp?.verb === 'bank' ? bankLabel(mp.width, bank[p.appId] || 0) : node ? node.slice(0, 10) : k.label || '', color: hex(k.color || p.color), active: reading?.display?.active===true,
      sub: ak || sw ? (app ? (running[app] ? 'running' : 'not running') : k.sub || '') : node ? (k.label || '').replace(/ /g, '') : k.sub || '', glyph: k.icon, control: k, feedback: reading, dim: reading?.display?.dim===true }
  })
  const feedback = currentDialFeedback(p, pg)
  if(view.profile==='main')feedback.wheel=home.snapshot(configuredPage()).wheel;if(feedback.wheel)feedback.wheel.bindingKey=JSON.stringify(pg.wheel?.turn??null)
  const sig = JSON.stringify([view, keys, device.path, feedback, p.color, p.name, pg.name, (p.pages || []).length])
  if (!force && sig === drawnSig) return
  if (force) surfaceSignatures.clear()
  drawing = true
  const current = () => device === dev && token === drawToken && !stopping
  const present = async (surface, content, write) => {
    if (!current()) return false
    const signature = JSON.stringify(content)
    if (surfaceSignatures.get(surface) === signature) return true
    await write()
    if (!current()) return false
    surfaceSignatures.set(surface, signature) // never acknowledge a failed or retired device write
    return true
  }
  try {
    const skin = TILES[p.color]                     // the app's key face and recess, from the icon language (Moshpit: coral on #12141b)
    if (!await present('center', [keys, skin], () => device.drawBuffer({ id: 'center' }, draw.toRgb565(renderFeedbackKeys(draw, keys, skin))))) return
    for (const side of ['left', 'right']) {
      const positions = side === 'left' ? ['TL', 'CL', 'BL'] : ['TR', 'CR', 'BR']
      if (!await present(side, [p.color, skin, positions.map(d => feedback[d])], async () => {
        const s = renderFeedbackStrip(draw, positions.map(d => feedback[d]), {color:hex(p.color),skin})
        await device.drawBuffer({ id: side }, draw.toRgb565(s))
      })) return
    }
    const pgs = (p.pages || []).length
    if (!await present('knob', [p.color, skin, p.name, pg.name, feedback.wheel, view.page, pgs], async () => {
      const w = renderFeedbackWheel(draw, feedback.wheel, {color:hex(p.color),skin,profileName:p.name,pageName:pg.name||''})
      await device.drawBuffer({ id: 'knob' }, draw.toRgb565(w, true))
    })) return
    for (let r = 0; r < 8; r++) {                 // round LEDs: 1 = MAIN, 2-8 = this profile's pages
      const n = view.profile === 'main' ? -1 : r - 1
      const color = r === 0 ? (view.profile === 'main' ? COLORS.bone : hex(p.color))
        : (p.pages || [])[n] ? (n === view.page ? hex(p.color) : dim(hex(p.color), 0.18)) : '#000000'
      if (!await present(`led${r}`, color, () => device.setButtonColor({ id: r, color }))) return
    }
    // said once per open, so the log shows the CT was drawn, not merely that nothing failed
    if (!drawnSig) log(`drew ${p.name} / ${pg.name || pg.status && 'Status' || ''} on the CT: 12 keys, both strips, the wheel, 8 round LEDs`)
    drawnSig = sig
  } catch (e) {
    if (current()) { drawnSig = ''; surfaceSignatures.clear() }
    log('draw failed:', e.message)
  } finally {
    if (token === drawToken) {
      drawing = false
      const pending = repaintPending, pendingForce = repaintForce
      repaintPending = false; repaintForce = false
      if (pending && !stopping) queueMicrotask(() => repaint(pendingForce))
    }
  }
}
function statusKeys() {
  const ok = COLORS.sage, bad = COLORS.rose, meh = COLORS.sand
  const cfgBad = cfg.errors.length
  return [
    { label: 'CT', sub: dev ? dev.path : 'offline', color: dev ? ok : bad, active: !!dev },
    { label: 'INPUT', sub: quietWarned ? 'quiet' : 'live', color: quietWarned ? meh : ok },
    { label: `TD ${(tdCfg.td.handshakeUrl || '').match(/:(\d+)\//)?.[1] || ''}`.trim(), sub: tdOk === null ? 'checking' : tdOk ? 'answering' : 'no answer', color: tdOk ? ok : tdOk === null ? COLORS.dust : meh },
    { label: 'EDENA', sub: running['EDENA.exe'] ? 'running' : 'not running', color: running['EDENA.exe'] ? ok : COLORS.dust },
    { label: 'CONFIG', sub: cfgBad ? `${cfgBad} to fix` : 'ok', color: cfgBad ? bad : ok },
    { label: 'KEYS', sub: counts.blocked ? `${counts.blocked} blocked` : 'ok', color: counts.blocked ? meh : ok },
    { label: 'HEARTBEAT', sub: counts.heartbeatLost ? `lost ${counts.heartbeatLost}x` : 'steady', color: counts.heartbeatLost ? meh : ok },
    { label: 'UP', sub: `${Math.round(process.uptime() / 60)} min`, color: COLORS.dust },
    note.text && Date.now() - note.at < 60000 ? { label: 'LAST NOTE', sub: note.text.slice(0, 18), color: meh } : null,
    null, null,
    { label: 'MAIN', sub: 'round 1', color: COLORS.bone },
  ]
}
function repaintStatus() { if (page().status) repaint(true) }

// ---- health loops ------------------------------------------------------------------------------------
const HEARTBEAT_MS = 3000, HEARTBEAT_TIMEOUT_MS = 2000, QUIET_MS = 20000
const heartbeat = every(async () => {       // a VERSION ping; never the RESET command
  if (!dev || reconnecting || stopping) return
  const d = dev
  const ask = d.connection && d.connection.isReady() ? d.send(0x07) : undefined
  const ok = ask && await Promise.race([ask.then(() => true), wait(HEARTBEAT_TIMEOUT_MS).then(() => false)])
  if (ok || d !== dev || stopping) return
  counts.heartbeatLost++
  hbLost = true
  log('HEARTBEAT lost: the CT did not answer in', HEARTBEAT_TIMEOUT_MS, 'ms - reconnecting')
  reconnect()
}, HEARTBEAT_MS)
const quiet = every(() => {
  if (!dev || stopping || Date.now() - lastInput < QUIET_MS || (quietWarned && Date.now() - quietWarned < 60000)) return
  quietWarned = Date.now()
  log(`WARNING: no CT input for ${Math.round((Date.now() - lastInput) / 1000)} s - if you have been turning dials, the CT may have gone quiet: replug it`)
  repaintStatus()
}, 1000)
const apps = every(async () => {            // which switchboard apps are up, and TD's web server
  const exes = [...new Set([...Object.values(cfg.profiles).map(p => p.app && p.app.exe), ...Object.values(cfg.apps || {}).map(a => a.exe)].filter(Boolean))]
  let changed = false
  for (const e of exes) { const r = await win.running(e).catch(() => false); if (running[e] !== r) { running[e] = r; changed = true } }
  const t = prof().app?.target === 'td' ? await td.handshake().then(r => r.ok).catch(() => false) : null
  if (t !== tdOk) { tdOk = t; changed = true }
  if (changed) { repaint(); status() }
}, 3000)

// Follow focus (opt-in per profile): when an app whose profile says "followFocus" comes to the front
// and stays there for two checks, the CT switches to it. A "sticky" profile is never switched away from.
let focusSeen = { exe: '', n: 0 }
const focusPoll = every(async () => {
  const followers = Object.values(cfg.profiles).filter(p => p.followFocus && p.app && p.app.exe && tdProfileSupported(p))
  if (!dev || stopping || switching || !followers.length || prof().sticky) return
  const epoch = inputEpoch
  const front = await win.front().catch(() => '')
  if (!dev || stopping || switching || inputEpoch !== epoch || prof().sticky) return
  focusSeen = front === focusSeen.exe ? { exe: front, n: focusSeen.n + 1 } : { exe: front, n: 1 }
  const p = followers.find(f => cfg.profiles[f.id] === f && tdProfileSupported(f) && exeName(f.app.exe).toLowerCase() === front)
  if (p && p.id !== view.profile && focusSeen.n === 2) {
    // A focus-follow switch is the same input boundary as a manual profile change:
    // held keys and unsent rotary work belong to the profile that received them.
    rotaryModifiers.reset()
    inputEpoch++; pendingPageEntry = null; lanes.clear()
    view = { profile: p.id, page: lastPage[p.id] || 0 }
    log(`switched to ${p.name} (it came to the front)`)
    repaint(true); status()
  }
}, 400)

// TD's state, while the page on the CT has TD controls: CT_RIG's (the clip, the toggles, every value 0-1).
// Read again straight after a CT_RIG action, so a
// dial's bar follows the dial rather than lagging a second behind.
const pageTd = () => { const pg = page(); return [...Object.values(pg.keys || {}).map(k => k.do?.td), ...Object.values(pg.dials || {}).flatMap(d => [d?.turn?.td, d?.press?.td]), pg.wheel?.turn?.td, pg.wheel?.tap?.td].filter(Boolean) }
async function readTd() {
  if (!dev || stopping) return
  const tds = pageTd()
  if (!tds.length) return
  const profileId = view.profile, profile = prof(), epoch = inputEpoch, sequence = ++tdReadSequence
  if (!profile.rigIdentity || !tdProfileSupported(profile)) { tdOk = false; tdState = null; status(); return }
  const script = guardRigScript(RIG_STATE_PY + "\nif result is not None: result['parameters']=[p.name for p in _r.customPars]", profile.rigIdentity)
  const r = await td.exec(script).catch(() => null)
  if (sequence !== tdReadSequence || view.profile !== profileId || prof() !== profile || inputEpoch !== epoch) return
  tdCheckedAt = Date.now(); tdProfileId = profileId
  const next = r && r.success ? r.data.result : null
  if (JSON.stringify(next) !== JSON.stringify(tdState)) { tdState = next; repaint() }
  status()
}
const tdPoll = every(readTd, 1000)
// A hanging read cannot leave stale gauges looking current. Only redraw on transition;
// existing per-surface signatures continue suppressing identical device writes.
let displayedTdFresh = false
const feedbackExpiry = every(() => { const fresh=currentTdFresh(); if(fresh!==displayedTdFresh){displayedTdFresh=fresh;repaint();status()} }, 500)

function status() {
  if (!process.send || !process.connected) return
  const p = prof()
  const dialReadings=currentDialFeedback(p);if(view.profile==='main')dialReadings.wheel=home.snapshot(configuredPage()).wheel;if(view.profile==='main'&&dialReadings.wheel)dialReadings.wheel.bindingKey=JSON.stringify(page().wheel?.turn??null);
  process.send({ type: 'status', home:view.profile==='main'?home.snapshot(configuredPage()):null, dialFeedback: dialReadings, keyFeedback: currentKeyFeedback(p), controlContext: controlContext({ profile: p, nativeState:native.get(p.appId)?.state(), profileId: view.profile, moshpit: mosh.get(p.appId)?.state(), tdOk, tdState, tdCheckedAt, tdProfileId }), profile: view.profile, page: view.page, profileName: p.name, pageName: page().name || '',
    profiles: Object.values(cfg.profiles).map(x => ({ id: x.id, name: x.name, color: x.color, handoff: !!x.handoff, pages: (x.pages || []).map(g => g.name), app: x.app?.exe || null, running: x.app?.exe ? !!running[x.app.exe] : null, appId: x.appId || null, tier: x.tier, pick: !!x.pick })),
    apps: Object.entries(cfg.apps || {}).map(([id, a]) => ({ id, name: a.name, color: a.color, target: a.target, tier: a.tier === 'legacy' ? 'legacy' : 'current', exe: a.exe || null, running: a.exe ? !!running[a.exe] : null, default: a.default || null })),
    errors: cfg.errors, connected: !!dev, port: dev?.path || null, note, counts, tdOk, tdState, dry: DRY, uptimeMin: Math.round(process.uptime() / 60),
    moshpit: Object.fromEntries([...mosh].map(([id, c]) => [id, { phase: c.state().phase, detail: c.state().detail, workspace: c.state().workspace, project: c.state().project?.name || null, slots: c.state().slots.map((x) => x.name), parameterPage: bank[id] || 0 }])) })
}

// ---- clean close -------------------------------------------------------------------------------------
function stop(why) {
  if (stopAttempt) return stopAttempt
  stopping = true
  home.invalidate()
  startupAbort.abort()
  rotaryModifiers.reset()
  inputEpoch++; lanes.clear()
  for (const timer of lifecycleTimers) clearInterval(timer)
  clearTimeout(reloadTimer); configWatcher?.close()
  for (const hold of holds.values()) clearTimeout(hold.timer)
  holds.clear()
  for (const c of mosh.values()) c.stop()
  ctClaim.update({ state: 'closing' })
  log(why, '- closing CT')
  stopAttempt = (async () => {
    // connectCT cannot be cancelled. Its returned device must be closed before releasing ownership.
    await openingTask?.catch(() => {})
    await reconnectTask
    for (let i = 0; drawing && i < 40; i++) await wait(50)
    await win.release().catch(() => {})
    for(const c of native.values())c.stop()
    win.close()
    const current = dev
    dev = null
    if (current) {
      // One total blanking budget, not a timeout multiplied by every screen and LED.
      // On a missing ACK stop the sequence: a late resolution must not enqueue more writes.
      const deadline = Date.now() + 400
      const blank = [
        ...[['center', 360 * 270 * 2], ['left', 60 * 270 * 2], ['right', 60 * 270 * 2], ['knob', 240 * 240 * 2]].flatMap(([id, bytes]) => [
          // drawBuffer normally refreshes after its ACK. Split it so a late ACK cannot enqueue DRAW.
          () => current.drawBuffer({ id, autoRefresh: false }, Buffer.alloc(bytes)),
          () => current.refresh(id),
        ]),
        ...Array.from({ length: 8 }, (_, id) => () => current.setButtonColor({ id, color: '#000000' })),
      ]
      for (const send of blank) if (!await bestEffortAck(send, deadline - Date.now())) break
    }
    // Includes late opens and a previous disconnect whose close failed. A failure retains claim.
    for (const device of ownedDevices) await closeDevice(device)
    clearInterval(claimTimer)
    log('CT closed cleanly')
    ctClaim.release()
    process.exit(0)
  })().catch(error => { stopAttempt = null; throw error })
  return stopAttempt
}
every(pollNative,400)
if (!stopping) {
  log(`LIVE: ${prof().name}${DRY ? ' (dry input: Windows keys are logged, not sent)' : ''}. Round 1 = MAIN; hold it 1 s to escape.`)
  repaint(true)
  status()
}
