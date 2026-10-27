// waxyct: one small app for the Loupedeck CT. It shows the CT's state at a glance, hands the CT
// between the TD bridge (ct-td-control) and EDENA so that only one ever holds it, and walks through
// the fix for the quiet state. The router never opens the CT itself: the owners do, and each reports
// through the shared claim file (ct-td-control/ct-claim.mjs, copied into EDENA).
//
//   node router.mjs          serve the panel on http://127.0.0.1:9990
//   node router.mjs --open   and open it in an Edge app window
//
// Paths to the two owners: config.json, optional (README). An owner is only ever stopped cleanly:
// over IPC (the bridge, the probe) or --ct=release (EDENA). Killing one leaves the CT stuck, so the
// panel does it only when the viewer confirms a force stop, after a clean stop has failed.
import { execFile, execFileSync, fork, spawn } from 'node:child_process'
import fs from 'node:fs'
import {guidesRoute} from './host/home-routes.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { saveProfile, readProfileVersion, configuredInventory } from './host/profiles.mjs'
import { createProjectLibrary } from './host/project-library.mjs'
import { readParkingRegistry, activeProfileFiles, isProfileParked } from './host/parking.mjs'
import { loadIcons, saveIcon, prepareIconFolder } from './host/icon-library.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cfg = loadConfig()
const URL_ = `http://127.0.0.1:${cfg.port}`
// The build that is running, shown in the window: package version + git commit (+ "*" when files
// differ from it). The open window reloads itself when the router it talks to reports another build.
const BUILD = (() => {
  const v = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version
  try { return { version: v, commit: JSON.parse(fs.readFileSync(path.join(HERE, 'build-info.json'), 'utf8')).commit, started: Date.now() } } catch {}
  try {
    const git = a => execFileSync('git', a, { cwd: HERE, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const dirty = git(['status', '--porcelain', '--', 'router.mjs', 'host', 'ui']) ? '*' : ''
    return { version: v, commit: git(['rev-parse', '--short', 'HEAD']) + dirty, started: Date.now() }
  } catch { return { version: v, commit: 'no git', started: Date.now() } }
})()
// The claim file and the owners' logs. The folder keeps the working name the owners' hooks were written
// under (ct-td-control/ct-claim.mjs); rename it there and here together.
const DIR = process.env.WAXYCT_ROUTER_DATA || path.join(process.env.LOCALAPPDATA, 'ct-router')
const CLAIM_FILE = path.join(process.env.LOCALAPPDATA, 'ct-router', 'owner.json') // shared hardware ownership remains global
const STALE_MS = 10000     // as ct-claim.mjs: owners refresh every 2 s
const SETTLE_MS = 1000     // between one owner closing the port and the next opening it
const RELEASE_MS = 10000   // a clean release that takes longer has hung
const CONFIG_DIR = process.env.WAXYCT_CONFIG || path.join(HERE, 'config')   // the button config (host/profiles.mjs)
// Inside the packaged app (Electron main): the app draws its own window, and the forked owners run as
// Node on the same exe (ELECTRON_RUN_AS_NODE), with no console of their own.
const projectLibrary = createProjectLibrary({ configDir: CONFIG_DIR })
const homeEpochs=new WeakMap();
async function homeRequest(c,m){
 if(c!==children.host||!c.connected||quitting||!Number.isSafeInteger(m.id)||!Number.isSafeInteger(m.epoch))return;
 if(!['inventory','open','guides','setup','device'].includes(m.operation))return;
 const current=()=>c===children.host&&c.connected&&!quitting&&!S.busy&&homeEpochs.get(c)===m.epoch;
 if(!current())return c.send({type:'home-result',id:m.id,epoch:m.epoch,error:'Home changed or CTserver busy'});
 let result;
 try{
  if(m.operation==='inventory')result=projectLibrary.list();
  else if(m.operation==='open')result=await projectLibrary.open({profileId:m.payload?.profileId,projectId:m.payload?.projectId},current);
  else if(m.operation==='guides'){const route=guidesRoute();if(route.error)throw Error(route.error);if(!current())return;if(!hooks.guides)throw Error('Open the CTserver app to view Guides');await hooks.guides(route.file);result={message:'Guides opening requested'};}
  else {if(!hooks.panel)throw Error('Open the CTserver app to view this panel');await hooks.panel(m.operation);if(!current())return;broadcast('panel',{intent:m.operation});result={message:m.operation==='setup'?'Mapping panel opened':'Device diagnostics opened'};}
  if(current())c.send({type:'home-result',id:m.id,epoch:m.epoch,result});
 }catch(error){if(current())c.send({type:'home-result',id:m.id,epoch:m.epoch,error:error.message})}
}

export const EMBEDDED = !!process.versions.electron
// The app's own quit, set by electron/main.mjs (the tray's Quit): POST /api/quit runs the same function
// Start with Windows: a shortcut in the user's Startup folder, made or removed only from the panel's switch.
const STARTUP_LNK = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'waxyct.lnk')
fs.mkdirSync(DIR, { recursive: true })

// findCT lists USB ports only; it never opens one. Imported from the bridge so there is one copy.
const { findCT } = await import(pathToFileURL(path.join(cfg.bridgeDir, 'connect-ct.mjs')).href)

function loadConfig() {
  const c = {
    port: 9990,
    bridgeDir: process.env.WAXYCT_BRIDGE || path.resolve(HERE, 'integrations/ct-td-control'),
    bridgeArgs: ['--live'],
    edenaDir: process.env.WAXYCT_EDENA || path.resolve(HERE, '../edena'),
    edenaCmd: null,     // default: found by edenaLauncher()
    edenaArgs: [],
    edenaEnv: {},
    hostAuto: true,     // start the deck host (waxyct's own CT owner) when the router starts and the CT is free
    hostArgs: [],       // tests: ["--dry-input"] logs Windows keys instead of pressing them
    hostEnv: {},
  }
  const p = process.env.WAXYCT_ROUTER_CONFIG || path.join(HERE, 'config.json')
  if (fs.existsSync(p)) Object.assign(c, JSON.parse(fs.readFileSync(p, 'utf8')))
  c.bridgeDir = path.resolve(HERE, c.bridgeDir)
  c.edenaDir = path.resolve(HERE, c.edenaDir)
  try { c.tdUrl = JSON.parse(fs.readFileSync(path.join(c.bridgeDir, 'config.json'), 'utf8')).td.handshakeUrl } catch {}
  c.tdUrl ??= 'http://127.0.0.1:9981/api/td/server/td'
  return c
}

// ---- state: what the panel renders, sent whole every second --------------------------------------
const S = {
  usb: { present: null, port: null },
  replug: { goneAt: 0, backAt: 0 },   // the last time the CT left USB and came back
  claim: null,                        // the live claim, or null
  procs: { edena: [], edenaMain: null, bridges: [], loupedeck: [] },
  edena: null,                        // how EDENA would be started: { kind, cmd, hooks }
  td: { ok: null, detail: 'checking' },
  power: { suspend: null, hub: null },
  hooks: { bridge: false, edena: false },
  busy: null,                         // what a hand-off is doing now
  target: null,                       // where it is going: td, edena, none, test
  steps: [],                          // its steps, each { label, state: doing | done | warn | fail }
  error: null,                        // { id, side, what, fix, force?, forceName? }
  test: null,                         // { prev } while the input test runs
  host: null,                         // the deck host's last status: profile, page, profiles, config errors
  note: '',                           // the router's last line, for the HUD
}
const children = { bridge: null, probe: null }
let quitting = false                  // the router is shutting down: children exiting now are expected
const stopping = new Set()            // children asked to stop, so their exit is not a crash
const wait = ms => new Promise(r => setTimeout(r, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

// A failure the panel can show: what happened, on which side, what to do, and whether a force stop helps.
class Fail extends Error {
  constructor(side, what, fix, force) { super(what); Object.assign(this, { side, what, fix, force }) }
}
const FORCE_NAME = { bridge: 'the TD bridge', probe: 'the input test', edena: 'EDENA', host: 'the waxyct deck' }
const SIDE = { bridge: 'TD bridge', probe: 'Input test', host: 'waxyct deck' }

let rawClaim = null   // the file as it is, stale or not
function pollClaim() {
  let c = null
  try { c = JSON.parse(fs.readFileSync(CLAIM_FILE, 'utf8')) }
  catch (e) { if (e.code !== 'ENOENT') return }   // mid-write: keep the last good read
  rawClaim = c
  S.claim = c && alive(c.pid) && Date.now() - c.updated < STALE_MS ? c : null
}
// Has this owner let go? Its claim deleted, taken by another, or its process gone. A claim that is
// only stale while its process lives is an owner stuck in its close, still holding the port: not
// released (27 Sep: EDENA hung on close, its claim went stale at 10 s, and the router took that as done).
const letGo = (owner, pid) => !rawClaim || rawClaim.owner !== owner || (pid && rawClaim.pid !== pid) || !alive(rawClaim.pid)

async function pollUsb() {
  const port = await findCT().catch(() => null)
  const present = !!port
  if (S.usb.present !== null && present !== S.usb.present) {
    S.replug[present ? 'backAt' : 'goneAt'] = Date.now()
    note(present ? `CT back on USB (${port})` : 'CT left USB')
  }
  S.usb = { present, port }
}

// Who else is running. The claim covers the owners that cooperate; this finds the ones that do not.
const PS = `Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='electron.exe' or Name like 'EDENA%' or Name like 'Loupedeck%' or Name like 'LogiPluginService%'" | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`
function pollProcs() {
  return new Promise(resolve => execFile('powershell', ['-NoProfile', '-Command', PS], { windowsHide: true, timeout: 10000 }, (err, out) => {
    if (!err) {
      let list = []
      try { list = [].concat(JSON.parse(out || '[]')) } catch {}
      const cmd = p => (p.CommandLine || '').toLowerCase().replace(/\//g, '\\')
      const edenaDir = cfg.edenaDir.toLowerCase().replace(/\//g, '\\')
      const edena = list.filter(p => (/^edena/i.test(p.Name) || (p.Name === 'electron.exe' && cmd(p).includes(edenaDir))) && !cmd(p).includes('--type=') && !cmd(p).includes('--ct='))
      // the app itself, not the portable exe's launcher, which unpacks EDENA.exe to temp and waits on it
      const main = edena.find(p => /^edena\.exe$/i.test(p.Name)) || edena.find(p => p.Name === 'electron.exe')
      S.procs = {
        edena: edena.map(p => p.ProcessId),
        edenaMain: main ? { pid: main.ProcessId, name: main.Name, exe: main.ExecutablePath, hooks: runningEdenaHooks(main) } : null,
        // --fake runs never open the CT
        bridges: list.filter(p => p.Name === 'node.exe' && /bridge\.mjs/.test(cmd(p)) && /--live/.test(cmd(p)) && !/--fake/.test(cmd(p)))
          .map(p => ({ pid: p.ProcessId, ours: p.ProcessId === children.bridge?.pid })),
        loupedeck: list.filter(p => /^(loupedeck|logipluginservice)/i.test(p.Name)).map(p => p.Name),
      }
    }
    resolve()
  }))
}

// Does the EDENA that is running carry the hooks? A build is read inside its app.asar (the portable
// exe runs one unpacked in temp); EDENA run from source is its electron/main.js.
function runningEdenaHooks(p) {
  if (/^edena\.exe$/i.test(p.Name) && p.ExecutablePath) return has(path.join(path.dirname(p.ExecutablePath), 'resources', 'app.asar'), '--ct=')
  return has(path.join(cfg.edenaDir, 'electron', 'main.js'), '--ct=')
}

async function pollTd() {
  try {
    const r = await fetch(cfg.tdUrl, { signal: AbortSignal.timeout(1500) })
    const j = await r.json().catch(() => ({}))
    S.td = { ok: r.ok, detail: r.ok ? (j.data && j.data.server) || j.server || 'answering' : `HTTP ${r.status}` }
  } catch {
    S.td = { ok: false, detail: 'no answer on 9981: TouchDesigner is closed or its bridge is not running' }
  }
}

// Power saving, the likely cause of the quiet state (ct-td-control/TUTORIAL-CT-TD.md). Two settings:
// USB selective suspend (the power plan), and "Allow the computer to turn off this device" on the hub
// the CT hangs off. Read only; changing either needs admin.
const HUB_PS = `$ct = Get-PnpDevice -PresentOnly | ? { $_.InstanceId -match '^USB\\\\VID_2EC2&PID_0003\\\\' } | Select -First 1
if ($ct) { $hub = (Get-PnpDeviceProperty -InstanceId $ct.InstanceId -KeyName DEVPKEY_Device_Parent).Data
  $pm = Get-CimInstance -Namespace root\\wmi -ClassName MSPower_DeviceEnable | ? { $_.InstanceName -like "$hub*" } | Select -First 1
  @{ name = (Get-PnpDevice -InstanceId $hub).FriendlyName; allowOff = $pm.Enable } | ConvertTo-Json -Compress }`
function pollPower() {
  const q = ['/q', 'SCHEME_CURRENT', '2a737441-1930-4402-8d77-b2bebba308a3', '48e6b7a6-50f5-4782-a5d4-53bb8f07e226']
  execFile('powercfg', q, { windowsHide: true }, (err, out) => {
    const ac = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(out || ''), dc = /Current DC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(out || '')
    S.power.suspend = err || !ac ? null : { ac: parseInt(ac[1], 16), dc: dc ? parseInt(dc[1], 16) : 0 }
  })
  execFile('powershell', ['-NoProfile', '-Command', HUB_PS], { windowsHide: true, timeout: 15000 }, (err, out) => {
    try { const h = JSON.parse(out); if (h && h.name) S.power.hub = { name: h.name, allowOff: h.allowOff === true } } catch {}
  })
}

// The owners only cooperate once they carry the hooks (the claim, IPC stop, --ct=). A packaged EDENA
// is checked inside its app.asar (24 MB, read again only when it changes).
const hasCache = new Map()
function has(f, needle) {
  try {
    const m = fs.statSync(f).mtimeMs, hit = hasCache.get(f)
    if (hit && hit.m === m) return hit.v
    const v = fs.readFileSync(f).includes(needle)
    hasCache.set(f, { m, v })
    return v
  } catch { return false }
}

// How to start EDENA: config.json's edenaCmd; else the unpacked build if it carries the hooks; else
// EDENA's own electron on its source; else the build anyway, reported as missing the hooks. Never the
// portable exe, which unpacks 147 MB to temp on every launch. Re-checked every 10 s: a rebuild can land.
function edenaLauncher() {
  if (cfg.edenaCmd) return { kind: 'config', cmd: cfg.edenaCmd, args: cfg.edenaArgs, hooks: true }
  const exe = newestBuild() || path.join(cfg.edenaDir, 'release', 'win-unpacked', 'EDENA.exe')
  const build = { kind: 'build', cmd: exe, args: [], hooks: has(path.join(path.dirname(exe), 'resources', 'app.asar'), '--ct=') }
  const dev = { kind: 'source', cmd: path.join(cfg.edenaDir, 'node_modules', 'electron', 'dist', 'electron.exe'), args: [cfg.edenaDir], hooks: has(path.join(cfg.edenaDir, 'electron', 'main.js'), '--ct=') }
  const built = fs.existsSync(exe)
  if (built && build.hooks) return build
  if (dev.hooks && fs.existsSync(dev.cmd)) return dev
  return built ? build : dev
}

// The newest complete unpacked build: release\win-unpacked or release\<version>\win-unpacked. Complete
// means Electron can start it (icudtl.dat present) and it carries the hooks. 29 Sep: a rebuild into
// release\0.3.1\ left release\win-unpacked without icudtl.dat, and EDENA died on start.
function newestBuild() {
  const rel = path.join(cfg.edenaDir, 'release')
  let dirs = []
  try { dirs = [path.join(rel, 'win-unpacked'), ...fs.readdirSync(rel).map(d => path.join(rel, d, 'win-unpacked'))] } catch { return null }
  return dirs.filter(d => fs.existsSync(path.join(d, 'EDENA.exe')) && fs.existsSync(path.join(d, 'icudtl.dat')) && has(path.join(d, 'resources', 'app.asar'), '--ct='))
    .map(d => ({ exe: path.join(d, 'EDENA.exe'), t: fs.statSync(path.join(d, 'EDENA.exe')).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.exe || null
}

function pollHooks() {
  S.autostart = fs.existsSync(STARTUP_LNK)
  S.edena = edenaLauncher()
  S.hooks = { bridge: has(path.join(cfg.bridgeDir, 'bridge.mjs'), 'ct-claim.mjs'), edena: S.edena.hooks }
}

// ---- logs: every owner writes to a file in DIR, and the panel tails them ----------------------
const LOG = []
const tails = {}
function push(src, line) {
  const e = { t: Date.now(), src, line }
  LOG.push(e)
  if (LOG.length > 800) LOG.shift()
  broadcast('log', e)
}
function note(msg) { S.note = msg; push('router', msg); console.log(new Date().toISOString(), msg) }

function pollLogs() {
  for (const src of ['bridge', 'edena', 'probe', 'host']) {
    const f = path.join(DIR, `${src}.log`)
    let size
    try { size = fs.statSync(f).size } catch { continue }
    let off = tails[src] ?? Math.max(0, size - 4000)
    if (size < off) off = 0   // truncated by a new launch
    if (size === off) { tails[src] = off; continue }
    const buf = Buffer.alloc(size - off)
    const fd = fs.openSync(f, 'r')
    fs.readSync(fd, buf, 0, buf.length, off)
    fs.closeSync(fd)
    const end = buf.lastIndexOf(10)   // whole lines only; the rest waits for the next poll
    if (end < 0) { tails[src] = off; continue }
    tails[src] = off + end + 1
    for (const line of buf.subarray(0, end).toString('utf8').split(/\r?\n/)) if (line.trim()) push(src, line)
  }
}
// A new launch writes a fresh log; the last one is kept as <name>.prev.log, so a crash survives a restart.
function freshLog(name) {
  const f = path.join(DIR, `${name}.log`)
  try { fs.renameSync(f, path.join(DIR, `${name}.prev.log`)) } catch {}
  tails[name] = 0
  return fs.openSync(f, 'w')
}
function lastLines(name, n = 3) {
  let t = ''
  try { t = fs.readFileSync(path.join(DIR, `${name}.log`), 'utf8').trim().split(/\r?\n/).filter(l => !/exec failed/.test(l)).slice(-n).map(l => l.replace(/^\S+Z\s/, '')).join(' / ') } catch {}
  return t.replace(/[.\s]+$/, '')   // the sentence around it adds the full stop
}

// ---- steps: the hand-off as the panel shows it ----------------------------------------------------
function step(label) {
  const s = { label, state: 'doing' }
  S.steps.push(s)
  broadcast('status', snapshot())
  const set = state => (lbl) => { s.state = state; if (lbl) s.label = lbl; broadcast('status', snapshot()) }
  return { done: set('done'), warn: set('warn'), fail: set('fail') }
}
async function stepped(label, fn) {
  const st = step(label)
  try { const r = await fn(); st.done(); return r } catch (e) { st.fail(); throw e }
}

// ---- hand-off ----------------------------------------------------------------------------------
async function until(fn, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(250)) { pollClaim(); if (fn()) return true }
  pollClaim()
  return fn()
}

async function stopChild(name, ms = RELEASE_MS) {
  const c = children[name]
  if (!c) return
  stopping.add(c)
  note(`asking ${FORCE_NAME[name]} to close the CT (pid ${c.pid})`)
  try { c.send('stop') } catch {}
  if (!await until(() => !children[name], ms)) {
    stopping.delete(c)   // if it exits later on its own, that is news again: reported, and the deck restarted
    throw new Fail(SIDE[name], `${FORCE_NAME[name]} did not close the CT in ${ms / 1000} s`,
      `It was asked to close cleanly and has not exited (pid ${c.pid}). Its last lines: ${lastLines(name) || 'none'}. Wait and try again, or force stop it.`, name)
  }
}

function candidateReleaseAllowed(claim, host) {
  return !claim || !!(host && Number.isSafeInteger(host.pid) && host.pid > 0 && claim.owner === 'waxyct' && claim.pid === host.pid)
}
async function releaseCandidateHost() {
  // Recheck after queued work; stop only our child, never the global hand-off path.
  pollClaim()
  if (!candidateReleaseAllowed(S.claim, children.host)) throw new Fail('CT owner', 'Another or unknown owner holds the CT', 'Release that owner normally in its own app.')
  standDown = true
  if (children.host) await stopChild('host')
  pollClaim()
  note(S.claim ? 'Candidate released; another owner is unchanged' : 'Candidate released the CT; automatic ownership stays off')
}

// A --ct= command goes through the executable the running EDENA was started from, so it lands on the
// same single-instance lock; a fresh start uses edenaLauncher().
function launchEdena(extra, logName) {
  if (quitting) throw new Fail('router', 'The router is closing', 'New controller connections remain paused; retry Quit.')
  const run = S.procs.edenaMain, l = edenaLauncher()
  const [cmd, args] = extra.length && run && /^edena\.exe$/i.test(run.name) && run.exe ? [run.exe, []] : [l.cmd, l.args]
  const out = logName ? freshLog('edena') : 'ignore'
  const env = { ...process.env, ...cfg.edenaEnv }
  delete env.ELECTRON_RUN_AS_NODE
  if (!extra.length) note(`starting EDENA from ${l.kind === 'build' ? 'its build' : l.kind === 'source' ? 'its source' : 'config'}: ${cmd}`)
  const p = spawn(cmd, [...args, ...extra], { cwd: cfg.edenaDir, detached: true, stdio: ['ignore', out, out], env })
  p.on('error', e => note(`could not start EDENA: ${e.message}`))
  p.unref()
  if (typeof out === 'number') fs.closeSync(out)
  return p
}

// Owners the panel cannot stop. Checked before anything is released, so a hand-off that is going to
// fail does not first take the CT off its owner (27 Sep: a bridge started by hand, waiting on the claim,
// took the CT the moment EDENA let go).
async function refuseOutsiders() {
  await pollProcs()
  if (S.procs.loupedeck.length) throw new Fail('Loupedeck app', `${S.procs.loupedeck.join(', ')} is running`, 'It holds the CT without a claim, so waxyct cannot hand the CT over safely. Quit it, then try again.')
  const stray = S.procs.bridges.filter(b => !b.ours)
  if (stray.length) throw new Fail('TD bridge', `A TD bridge outside waxyct is running (pid ${stray.map(b => b.pid).join(', ')})`, 'waxyct did not start it and cannot stop it cleanly. Stop it with Ctrl-C in its own terminal, then try again.')
  const e = S.procs.edenaMain
  if (e && !e.hooks) throw new Fail('EDENA', 'An EDENA without the router hooks is open', `${e.exe || 'It'} can hold the CT without a claim and ignores waxyct. Quit it (waxyct starts the hooked build), then try again.`)
}

// Take the CT off whoever holds it, cleanly, and make sure nobody else is about to grab it.
async function releaseAll() {
  await stepped('Checking nothing outside waxyct holds the CT', refuseOutsiders)
  for (let guard = 0; guard < 4; guard++) {
    pollClaim()
    const c = S.claim
    if (!c) break
    if (c.owner === 'waxyct' && c.pid === children.host?.pid) await stepped('The waxyct deck blanks the CT and closes it', () => stopChild('host'))
    else if (c.owner === 'td-bridge' && c.pid === children.bridge?.pid) await stepped('The TD bridge blanks the CT and closes it', () => stopChild('bridge'))
    else if (c.owner === 'probe' && c.pid === children.probe?.pid) await stepped('The input test closes the CT', () => stopChild('probe'))
    else if (c.owner === 'edena') {
      await stepped('EDENA blanks the CT and lets go (it stays open)', async () => {
        launchEdena(['--ct=release'])
        if (!await until(() => letGo('edena', c.pid), RELEASE_MS)) {
          throw new Fail('EDENA', `EDENA did not let go in ${RELEASE_MS / 1000} s`,
            'EDENA got --ct=release and still holds the CT. It may be busy or hung. Wait and try again, or force stop it: waxyct asks it to quit, then ends it if it does not.', 'edena')
        }
      })
    } else {
      throw new Fail(c.owner === 'td-bridge' ? 'TD bridge' : c.owner, `${c.owner} holds the CT from outside waxyct (pid ${c.pid})`,
        'waxyct did not start it and cannot stop it cleanly. Stop it where it runs (Ctrl-C in its terminal), then try again.')
    }
  }
  // our own children hold nothing while they wait for a claim, but would take the CT the moment it frees
  if (children.bridge) await stopChild('bridge')
  if (children.probe) await stopChild('probe')
  await refuseOutsiders()   // again: one may have started while the owner was letting go
  step('The claim is gone and the port is free').done()
}

function startChild(name, file, args, dir = cfg.bridgeDir, env = {}) {
  if (quitting) throw new Fail('router', 'The router is closing', 'Wait for clean shutdown before starting another owner.')
  if (EMBEDDED) env = { ...env, ELECTRON_RUN_AS_NODE: '1' }
  const out = freshLog(name)
  // detached: libuv puts every other child in a job object that Windows kills with the parent, so a
  // router that crashed took the bridge down mid-session and left the CT stuck (measured 27 Sep).
  // Detached, it outlives the router, sees the IPC channel close, and closes the CT itself.
  const c = fork(path.join(dir, file), args, { cwd: dir, stdio: ['ignore', out, out, 'ipc'], detached: true, windowsHide: true, env: { ...process.env, ...env } })
  fs.closeSync(out)
  children[name] = c
  c.on('exit', code => {
    if (children[name] === c) children[name] = null
    if (name === 'probe') S.test = null
    if (name === 'host') S.host = null
    note(`${FORCE_NAME[name]} exited (code ${code})`)
    // Not asked to stop: it crashed or gave up. Say so where the viewer is looking.
    if (!stopping.delete(c) && !quitting) {
      S.error = { id: `x${Date.now()}`, side: SIDE[name], what: `${FORCE_NAME[name][0].toUpperCase()}${FORCE_NAME[name].slice(1)} stopped on its own (exit code ${code})`,
        fix: `Its last lines: ${lastLines(name) || 'none'}. ${name === 'host' ? 'waxyct restarts it by itself.' : 'Nobody holds the CT now: pick an owner above.'} If the CT does not answer after this, replug it.` }
      if (name === 'host') restartHost()
    }
  })
  note(`${FORCE_NAME[name]} started (pid ${c.pid})`)
  return c
}

async function startBridge() {
  if (!S.hooks.bridge) throw new Fail('TD bridge', 'The bridge has no router hooks', `${cfg.bridgeDir}\\bridge.mjs does not use ct-claim.mjs. Point bridgeDir in config.json at a copy that does (README).`)
  const c = startChild('bridge', 'bridge.mjs', cfg.bridgeArgs)
  const st = step('Starting the TD bridge')
  if (!await until(() => !children.bridge || S.claim?.pid === c.pid, 8000) || !children.bridge) {
    st.fail()
    throw new Fail('TD bridge', 'The TD bridge did not start', `It exited or did not take the claim. Its last lines: ${lastLines('bridge') || 'none'}.`)
  }
  st.done()
  const st2 = step('The TD bridge opens the CT')
  // Unplugged: the bridge keeps the claim and takes the CT when it arrives; that is a wait, not a failure.
  if (!await until(() => !children.bridge || (S.claim?.pid === c.pid && (S.claim.state === 'connected' || S.claim.state === 'not-found')), 15000) || !children.bridge) {
    st2.fail()
    throw new Fail('TD bridge', 'The TD bridge could not open the CT', `It holds the claim but reports "${S.claim?.state ?? 'nothing'}". Its last lines: ${lastLines('bridge') || 'none'}. If the CT is stuck, replug it.`, 'bridge')
  }
  if (S.claim.state === 'not-found') { st2.warn('The CT is not on USB: the TD bridge takes it when it is plugged in'); return note('the TD bridge holds the claim and waits for the CT') }
  st2.done('The TD bridge holds the CT')
  if (S.td.ok === false) step('TouchDesigner is not answering on 9981: the dials do nothing until it is').warn()
  note('the TD bridge holds the CT')
}

// The deck host: waxyct's own permanent CT owner (host/deck-host.mjs). Its status and requests arrive over IPC.
async function startHost() {
  const c = startChild('host', path.join('host', 'deck-host.mjs'), cfg.hostArgs, HERE, cfg.hostEnv)
  c.on('message', m => {
    if (!m) return
    if (m.type === 'home-cancel' && Number.isSafeInteger(m.epoch)) {homeEpochs.set(c,m.epoch);return}
    if (m.type === 'home-request') return void homeRequest(c,m)
    if (m.type === 'status') S.host = m
    if (m.type === 'input') broadcast('input', m)
    // a switchboard key for an app that draws its own deck (EDENA, until phase 4): hand the CT to it
    if (m.type === 'want' && m.owner === 'edena' && !S.busy) run('handing the CT to EDENA', 'edena', () => handToOrBack('edena'))
  })
  const st = step('Starting the waxyct deck')
  if (!await until(() => !children.host || (S.claim?.pid === c.pid && ['connected', 'not-found'].includes(S.claim.state)), 15000) || !children.host) {
    st.fail()
    throw new Fail('waxyct deck', 'The waxyct deck could not open the CT', `Its last lines: ${lastLines('host') || 'none'}. If the CT is stuck, replug it.`, children.host ? 'host' : undefined)
  }
  if (S.claim.state === 'not-found') { st.warn('The CT is not on USB: the waxyct deck takes it when it is plugged in'); return note('the waxyct deck holds the claim and waits for the CT') }
  st.done('The waxyct deck holds the CT')
  note('the waxyct deck holds the CT')
}
// A deck that dies on its own comes back, at most 3 times a minute (then it waits for a click).
const hostRestarts = []
function restartHost() {
  const now = Date.now()
  while (hostRestarts.length && now - hostRestarts[0] > 60000) hostRestarts.shift()
  if (hostRestarts.length >= 3) return note('the waxyct deck stopped 3 times in a minute: not restarting it; pick waxyct above when ready')
  hostRestarts.push(now)
  setTimeout(() => { if (!S.busy && !children.host && !quitting) run('restarting the waxyct deck', 'waxyct', () => handTo('waxyct')) }, 2000)
}

async function startEdena() {
  await pollProcs()
  pollHooks()
  if (!S.hooks.edena) throw new Fail('EDENA', 'No EDENA with the router hooks', `${S.edena.cmd} (${S.edena.kind}) does not carry them. Rebuild EDENA from main, or set edenaCmd in config.json (README).`)
  const open = S.procs.edena.length > 0
  const st = step(open ? 'EDENA is open: asking it to take the CT' : `Starting EDENA from its ${S.edena.kind}`)
  const p = launchEdena(open ? ['--ct=claim'] : [], open ? null : 'edena.log')
  let died = null
  if (!open && p) p.on('exit', code => { died = code })   // a fresh EDENA that dies on start: say so at once
  if (!await until(() => died !== null || (S.claim?.owner === 'edena' && (S.claim.state === 'connected' || S.claim.state === 'not-found')), 25000) || died !== null) {
    st.fail()
    if (died !== null) throw new Fail('EDENA', `EDENA closed as it started (exit code ${died})`, `${S.edena.cmd} could not start. ${lastLines('edena') ? `Its log: ${lastLines('edena')}.` : ''} Its build may be incomplete: rebuild EDENA, or set edenaCmd in config.json.`)
    throw new Fail('EDENA', S.claim?.owner === 'edena' ? `EDENA claimed the CT but reports "${S.claim.state}"` : 'EDENA did not take the CT in 25 s',
      open ? 'It got --ct=claim and did not claim the CT. It may be busy; try again, or quit and let waxyct start it.' : `It did not claim the CT after starting. ${lastLines('edena') ? `Its last lines: ${lastLines('edena')}.` : ''}`)
  }
  if (S.claim.state === 'not-found') { st.warn('The CT is not on USB: EDENA takes it when it is plugged in'); return note('EDENA holds the claim and waits for the CT') }
  st.done('EDENA holds the CT')
  note('EDENA holds the CT')
}

// Hand the CT on; if that fails and the CT is left with nobody, the waxyct deck takes it back, so an
// unattended CT is never left dead by a failed hand-off (29 Sep: an EDENA build that could not start).
async function handToOrBack(to) {
  try { await handTo(to) }
  catch (e) {
    pollClaim()
    if (!S.claim && cfg.hostAuto && !quitting) {
      note(`${NAME[to]} did not take the CT: the waxyct deck takes it back`)
      try { await startHost() } catch (e2) { note(`the waxyct deck could not take it back: ${e2.message}`) }
    }
    throw e
  }
}

const NAME = { waxyct: 'the waxyct deck', td: 'the TD bridge', edena: 'EDENA', none: 'nobody' }
async function handTo(to) {
  if (!NAME[to]) throw new Fail('router', `Unknown owner "${to}"`, '')
  pollClaim()
  if (to === 'td' && S.claim?.owner === 'td-bridge' && S.claim.pid !== children.bridge?.pid)
    return note(`a TD bridge started outside waxyct already holds the CT (pid ${S.claim.pid}); stop it with Ctrl-C in its own terminal when you are done`)
  if ((to === 'td' && S.claim?.owner === 'td-bridge') || (to === 'edena' && S.claim?.owner === 'edena') || (to === 'waxyct' && S.claim?.owner === 'waxyct' && S.claim.pid === children.host?.pid)) return note(`${NAME[to]} already holds the CT`)
  S.test = null
  await releaseAll()
  note(to === 'none' ? 'the CT is free' : `the CT is free; handing it to ${NAME[to]}`)
  if (to === 'none') return
  await wait(SETTLE_MS)
  await (to === 'waxyct' ? startHost() : to === 'td' ? startBridge() : startEdena())
}

// Input test: the probe holds the CT alone, sends nothing to TD, and hands the CT back afterwards.
async function startTest() {
  // checked first: the test cannot run without the CT, and a failed start must not cost the owner
  if (!S.usb.present) throw new Fail('CT', 'The CT is not on USB', 'Plug it in first. The current owner keeps it.')
  pollClaim()
  const prev = { 'td-bridge': 'td', edena: 'edena', waxyct: 'waxyct' }[S.claim?.owner] || null
  await releaseAll()
  await wait(SETTLE_MS)
  const c = startChild('probe', 'probe-input.mjs', ['3600'])
  S.test = { prev }
  c.on('message', m => { if (S.test) broadcast('input', m) })
  const st = step('The input test opens the CT')
  if (!await until(() => S.claim?.pid === c.pid && S.claim.state === 'connected', 12000)) {
    st.fail()
    const lines = lastLines('probe') || 'none'
    const back = prev && children.probe ? await stopChild('probe').then(() => true, () => false) : !!prev
    if (back) { S.test = null; await wait(SETTLE_MS); await giveBack(prev).catch(() => {}) }   // a failed test must not cost the owner
    throw new Fail('Input test', 'The input test could not open the CT', `Its last lines: ${lines}.${prev ? back ? ` The CT went back to ${NAME[prev]}.` : ` ${NAME[prev]} was released; pick it again above.` : ''}`, children.probe ? 'probe' : undefined)
  }
  st.done('The input test holds the CT')
  note(`input test running: touch every control${prev ? `; stopping hands the CT back to ${NAME[prev]}` : ''}`)
}

async function stopTest() {
  const prev = S.test?.prev
  await stepped('The input test closes the CT', () => stopChild('probe'))
  S.test = null
  if (!prev) return note('input test ended; the CT is free')
  await wait(SETTLE_MS)
  note(`handing the CT back to ${NAME[prev]}`)
  await giveBack(prev)
}
const giveBack = prev => ({ td: startBridge, edena: startEdena, waxyct: startHost })[prev]()

// Last resort, after a clean stop failed, and only on the viewer's confirmation. The bridge and the
// probe are ended outright (tree kill). EDENA is asked to quit first (a normal quit blanks and closes
// the CT; measured 27 Sep), and ended only if it has not gone in 5 s.
async function force(target) {
  if (['bridge', 'probe', 'host'].includes(target)) {
    const c = children[target]
    if (!c) return note(`${FORCE_NAME[target]} is not running`)
    stopping.add(c)
    await stepped(`Ending ${FORCE_NAME[target]} (pid ${c.pid})`, async () => {
      await new Promise(r => execFile('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true }, () => r()))
      if (!await until(() => !children[target], 5000)) throw new Fail('router', `Could not end ${FORCE_NAME[target]}`, `taskkill did not end pid ${c.pid}. End it in Task Manager.`)
    })
  } else if (target === 'edena') {
    await pollProcs()
    const pid = S.procs.edenaMain?.pid
    if (!pid) return note('EDENA is not running')
    await stepped('Asking EDENA to quit', async () => {
      execFile('taskkill', ['/PID', String(pid)], { windowsHide: true }, () => {})
      if (await until(() => !alive(pid), 5000)) return
      note('EDENA did not quit in 5 s: ending it')
      await new Promise(r => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => r()))
      if (!await until(() => !alive(pid), 5000)) throw new Fail('router', 'Could not end EDENA', `taskkill did not end pid ${pid}. End it in Task Manager.`)
    })
  } else throw new Fail('router', `Nothing to force stop called "${target}"`, '')
  step('Done. If the CT does not answer the next owner, replug it: a forced stop can leave it stuck').warn()
  note(`force stopped ${FORCE_NAME[target]}`)
}

async function run(label, target, fn) {
  if (quitting) return
  S.busy = label
  S.target = target
  S.steps = []
  S.error = null
  broadcast('status', snapshot())
  try { await fn() }
  catch (e) {
    const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t
    S.error = e instanceof Fail ? { id: `e${Date.now()}`, side: e.side, what: cap(e.what), fix: e.fix, force: e.force, forceName: FORCE_NAME[e.force] }
      : { id: `e${Date.now()}`, side: 'router', what: e.message, fix: 'An unexpected error in waxyct itself. The console has the details.' }
    note(`FAILED: ${S.error.what}`)
  }
  finally { S.busy = null; S.target = null; S.stepsAt = Date.now(); broadcast('status', snapshot()) }
}

// ---- http: the page, a server-sent event stream, the actions -------------------------------------
const clients = new Set()
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  for (const r of clients) r.write(msg)
}
// Startup reconciles defaults; this read-only summary lets the panel explain why
// user mappings stayed unchanged. Never load incoming candidates as live profiles.
function configUpdates() {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, '.updates', 'report.json'), 'utf8'))
    return { version: r.version, preserved: r.files.filter(f => f.status === 'preserved').map(f => f.file) }
  } catch { return null }
}
const snapshot = () => ({ ...S, configuration:!S.host?configuredInventory(CONFIG_DIR):null, tdPort: (cfg.tdUrl.match(/:(\d+)\//) || [])[1] || null, build: {...BUILD,label:process.env.WAXYCT_HOME_CANDIDATE_ROOT?'CT Home r04 candidate':'CTserver · KRAB Home'}, children: { bridge: children.bridge?.pid ?? null, probe: children.probe?.pid ?? null, host: children.host?.pid ?? null }, now: Date.now(), bridgeDir: cfg.bridgeDir, edenaDir: cfg.edenaDir, configDir: CONFIG_DIR, configUpdates: configUpdates() })

// The page, from ui/. A fixed list, so no request can name any other file.
const UI = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/tokens.css': ['tokens.css', 'text/css; charset=utf-8'],   // the suite tokens, synced from moshpit-v3
  '/fonts/inter-latin-wght-normal.woff2': ['fonts/inter-latin-wght-normal.woff2', 'font/woff2'],
  '/fonts/jetbrains-mono-latin-wght-normal.woff2': ['fonts/jetbrains-mono-latin-wght-normal.woff2', 'font/woff2'],
  '/control-font.mjs': ['control-font.mjs', 'text/javascript; charset=utf-8'],
  '/control-key-layout.mjs': ['control-key-layout.mjs', 'text/javascript; charset=utf-8'],
  '/control-presentation.mjs': ['control-presentation.mjs', 'text/javascript; charset=utf-8'],
  '/control-feedback-view.mjs': ['control-feedback-view.mjs', 'text/javascript; charset=utf-8'],
  '/profile-picker.js': ['profile-picker.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/mock.js': ['mock.js', 'text/javascript; charset=utf-8'],
  '/actions.js': ['actions.js', 'text/javascript; charset=utf-8'],
  '/icon-model.mjs': ['icon-model.mjs', 'text/javascript; charset=utf-8'],
  '/icon-import.mjs': ['icon-import.mjs', 'text/javascript; charset=utf-8'],
  '/editor-model.mjs': ['editor-model.mjs', 'text/javascript; charset=utf-8'],
  '/icon-library.js': ['icon-library.js', 'text/javascript; charset=utf-8'],
  '/host/schema.mjs': ['../host/schema.mjs', 'text/javascript; charset=utf-8'],   // the page reads the same lists as the deck
}

const server = http.createServer((req, res) => {
  // loopback only, and only when asked for by that name: a page on another site cannot reach it
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) { res.writeHead(403); return res.end() }
  const file = req.method === 'GET' && UI[req.url.split('?')[0]]
  if (file) {
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' })
    return res.end(fs.readFileSync(path.join(HERE, 'ui', file[0])))
  }
  if (req.method === 'GET' && req.url === '/api/projects') {
    try {
      res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' })
      return res.end(JSON.stringify(projectLibrary.list()))
    } catch { res.writeHead(500); return res.end(JSON.stringify({error:'Project library unavailable',projects:[]})) }
  }
  if (req.method === 'GET' && req.url === '/api/icons') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify(loadIcons(CONFIG_DIR)))
  }
  if (req.method === 'GET' && req.url === '/api/apps') {   // config/apps.json as written, for the panel's ?mock view
    let out = {}
    try { out = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'apps.json'), 'utf8')); for (const id of readParkingRegistry(CONFIG_DIR).apps) delete out[id] } catch { out = {} }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify(out))
  }
  if (req.method === 'GET' && req.url === '/api/profiles') {   // every profile file as written, for the panel's ?mock view
    const dir = path.join(CONFIG_DIR, 'profiles'), out = {}
    for (const f of activeProfileFiles(CONFIG_DIR)) { try { out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch {} }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify(out))
  }
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    clients.add(res)
    res.write(`event: status\ndata: ${JSON.stringify(snapshot())}\n\n`)
    for (const e of LOG) res.write(`event: log\ndata: ${JSON.stringify(e)}\n\n`)
    req.on('close', () => clients.delete(res))
    return
  }
  // A cross-site form cannot set this header, and the preflight a script would need is never answered.
  if (req.method === 'POST' && req.headers['x-ct-router'] === '1') {
    let body = ''
    req.setEncoding('utf8')   // whole characters, never half of one split across chunks
    req.on('data', d => { body += d; if (body.length > 1e6) req.destroy() })   // a big profile is ~8 KB
    req.on('end', () => {
      let b = {}
      try { b = JSON.parse(body || '{}') } catch {}
      if(process.env.WAXYCT_HOME_CANDIDATE_ROOT&&(['/api/force','/api/autostart','/api/test'].includes(req.url)||req.url==='/api/owner'&&(b.to==='none'?!candidateReleaseAllowed(S.claim,children.host):b.to!=='waxyct'||S.claim||children.host))){res.writeHead(409);return res.end(JSON.stringify({error:'Candidate keeps other owners and startup unchanged; release CT normally before connecting'}))}
      if (req.url === '/api/project/open') {
        if (quitting || S.busy) { res.writeHead(409, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:false,error:'CT is busy; try again once it is ready'})) }
        projectLibrary.open({profileId:b.profileId,projectId:b.projectId}).then(out => {
          res.writeHead(out.ok?202:409, {'Content-Type':'application/json'})
          res.end(JSON.stringify(out))
        }).catch(() => {res.writeHead(500);res.end(JSON.stringify({ok:false,error:'Project opening failed'}))})
        return
      }
      if (req.url === '/api/icon') {
        let out
        try { out = saveIcon(CONFIG_DIR, b.name, b.lines, b.reset === true) }
        catch (error) { out = { error: error.message } }
        res.writeHead(out.error ? 400 : 200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(out))
      }
      if (req.url === '/api/open-icons') {
        try {
          const folder = prepareIconFolder(CONFIG_DIR)
          spawn('explorer', [folder], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
          res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ folder }))
        } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: error.message })) }
      }
      const act = {
        '/api/owner': () => { standDown = b.to === 'none'; return [`handing the CT to ${NAME[b.to] || b.to}`, b.to, () => b.to === 'none' ? (process.env.WAXYCT_HOME_CANDIDATE_ROOT ? releaseCandidateHost() : handTo('none')) : handToOrBack(b.to)] },
        '/api/test': () => b.on ? ['starting the input test', 'test', startTest] : ['ending the input test', S.test?.prev || 'none', stopTest],
        '/api/force': () => [`force stopping ${FORCE_NAME[b.target] || b.target}`, null, () => force(b.target)],
      }[req.url]
      // the deck: switch profile or page, reload the config; answered at once, no hand-off involved
      if(req.url==='/api/home'){
        const ok=!quitting&&!S.busy&&children.host?.connected&&S.host?.connected===true&&S.claim?.owner==='waxyct'&&S.claim.pid===children.host.pid&&S.host?.profile==='main'&&Number.isSafeInteger(b.revision)&&b.revision===S.host?.home?.revision&&['key','move','select'].includes(b.kind)&&
          (b.kind!=='key'||Number.isInteger(b.slot)&&b.slot>=0&&b.slot<12)&&(b.kind!=='move'||Number.isSafeInteger(b.delta)&&Math.abs(b.delta)<=100);
        if(ok)children.host.send({type:'home-input',revision:b.revision,kind:b.kind,slot:b.slot,delta:b.delta});
        res.writeHead(ok?202:409,{'Content-Type':'application/json'});return res.end(JSON.stringify(ok?{}:{error:'Home changed or deck unavailable; choose again'}));
      }
      if (req.url === '/api/deck') {
        const ok = !quitting && children.host && ['switch', 'page', 'reload', 'escape'].includes(b.type) && (b.page === undefined || Number.isInteger(b.page) && b.page >= 1 && b.page <= 7) && (b.type !== 'switch' || !readParkingRegistry(CONFIG_DIR).profiles.includes(b.id))
        if (ok) children.host.send({ type: b.type, id: b.id, page: b.page, profileOnly: b.profileOnly === true })
        res.writeHead(ok ? 202 : 409, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(ok ? {} : { error: 'the waxyct deck is not running: pick waxyct above' }))
      }
      // the button config: read one profile's file, or check and save it (the old one goes to .history)
      if (req.url === '/api/profile') {
        const id = String(b.id || '')
        let out
        if (!/^[a-z0-9-]+$/.test(id)) out = { ok: false, error: 'a profile id is lowercase letters, digits and -', problems: ['a profile id is lowercase letters, digits and -'] }
        else if (isProfileParked(CONFIG_DIR, id, (() => { try { return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'profiles', `${id}.json`), 'utf8')) } catch { return null } })())) out = { ok: false, error: 'Profile is parked; restore it explicitly before editing', problems: ['Profile is parked'] }
        else if (b.text === undefined) { try { out = readProfileVersion(CONFIG_DIR, id) } catch { out = { error: `no profile "${id}"` } } }
        else if (!Object.hasOwn(b, 'expectedRevision')) out = {ok:false,problems:['Reload this profile before saving; its disk revision is missing.']}
        else { out = saveProfile(CONFIG_DIR, id, b.text, {expectedRevision:b.expectedRevision}); if (out.ok) note(`profile ${id} saved from the panel`) }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(out))
      }
      if (req.url === '/api/autostart') {
        const done = err => { pollHooks(); note(err ? `start with Windows: ${err}` : `start with Windows: ${S.autostart ? 'on' : 'off'}`); res.writeHead(err ? 500 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ on: S.autostart, error: err || undefined })) }
        if (!b.on) { try { fs.rmSync(STARTUP_LNK, { force: true }); return done() } catch (e) { return done(e.message) } }
        const q = s => s.replace(/'/g, "''")
        const exe = EMBEDDED ? process.env.PORTABLE_EXECUTABLE_FILE || process.execPath : null
        const [target, icon] = exe ? [exe, exe] : [path.join(HERE, 'waxyct.bat'), path.join(HERE, 'waxyct.ico')]
        const ps = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${q(STARTUP_LNK)}'); $s.TargetPath = '${q(target)}'; ${exe ? "$s.Arguments = '--start-in-tray'; " : ''}$s.WorkingDirectory = '${q(path.dirname(target))}'; $s.WindowStyle = 7; $s.IconLocation = '${q(icon)},0'; $s.Description = 'waxyct: Loupedeck CT manager (starts in the tray)'; $s.Save()`
        return execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, err => done(err && err.message))
      }
      if (req.url === '/api/quit') {
        const ok = typeof hooks.quit === 'function'
        res.writeHead(ok ? 202 : 409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(ok ? {} : { error: 'only the waxyct app can quit itself this way' }))
        if (ok) setTimeout(() => hooks.quit('asked over /api/quit'), 50)
        return
      }
      if (req.url === '/api/open-config') {
        spawn('explorer', [CONFIG_DIR], { detached: true, stdio: 'ignore' }).unref()
        res.writeHead(202); return res.end('{}')
      }
      if (!act) { res.writeHead(404); return res.end() }
      if (quitting) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'New controller connections remain paused; retry Quit.' })) }
      if (S.busy) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `busy: ${S.busy}` })) }
      run(...act())
      res.writeHead(202, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
    return
  }
  res.writeHead(404)
  res.end()
})

// An Edge app window: no tabs, no address bar. Falls back to the default browser.
function openWindow() {
  const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean)
    .map(p => path.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(p => fs.existsSync(p))
  const [cmd, args] = edge ? [edge, [`--app=${URL_}`, '--window-size=1280,1040']] : ['explorer', [URL_]]
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}

// Already running: bring its window forward (restored if minimised) rather than open a second one.
// The app's title always starts "waxyct ·"; the router's console ("waxyct - CT router") does not.
const FOCUS_PS = `Add-Type -Name U -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'
$p = Get-Process msedge -EA SilentlyContinue | ? { $_.MainWindowTitle -like 'waxyct ·*' } | Select -First 1
if ($p) { [W.U]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; (New-Object -ComObject WScript.Shell).AppActivate($p.MainWindowTitle) } else { $false }`
// One window, always: an open waxyct window is brought forward (restored if minimised) and a new one
// opens only when none is. Used on every start, fresh or not: 29 Sep, seven restarts of the router
// had each opened a window beside the last (they reconnect by themselves), so eight were open.
function focusOrOpen(then = () => {}) {
  execFile('powershell', ['-NoProfile', '-Command', FOCUS_PS], { windowsHide: true, timeout: 10000 }, (err, out) => {
    if (String(out).trim().split(/\r?\n/).pop() !== 'True') openWindow()
    then()
  })
}

// One router, always: the port is the lock. Windows lets one process listen on 127.0.0.1:9990, so a
// second launch finds it taken, brings the running waxyct's window forward and exits.
server.on('error', async e => {
  if (e.code !== 'EADDRINUSE') throw e
  if(process.env.WAXYCT_HOME_CANDIDATE_ROOT){readyFn({error:'CT Home candidate port already in use; no existing app was borrowed'});return}
  const mine = await fetch(`${URL_}/`, { signal: AbortSignal.timeout(2000) }).then(r => r.text()).then(t => t.includes('waxyct')).catch(() => false)
  if (!mine) { console.log(`port ${cfg.port} is used by another program, not waxyct: close it, or set "port" in config.json`); if (EMBEDDED) return readyFn({ error: `port ${cfg.port} is used by another program` }); process.exit(1) }
  console.log(`waxyct is already running at ${URL_}: bringing its window forward`)
  if (EMBEDDED) return readyFn({ url: URL_, borrowed: true })
  if (process.argv.includes('--open')) return focusOrOpen(() => process.exit(0))
  process.exit(0)
})
// The CT is never left blank by accident. Opened by hand, EDENA waits for the claim (its own retry):
// the deck lets go the moment a new EDENA appears, and EDENA takes the CT. Free for 3 s with no EDENA
// (it quit, or the deck was stopped), the deck takes the CT back and draws MAIN. "Nobody", picked in
// the window, stands this down until another owner is picked.
let standDown = false, lastEdenaPid = null, freeFor = 0
function autoOwner() {
  if (!cfg.hostAuto || S.busy || S.test || quitting) return
  const e = S.procs.edenaMain
  const fresh = e && e.pid !== lastEdenaPid && e.hooks !== false
  lastEdenaPid = e ? e.pid : null
  if (fresh && S.claim?.owner === 'waxyct' && children.host) {
    freeFor = 0
    return run('EDENA opened: handing it the CT', 'edena', async () => { await stepped('The waxyct deck lets go of the CT', () => stopChild('host')); note('EDENA takes the CT (its own retry)') })
  }
  freeFor = !S.claim && !e && !children.host && !children.bridge && !children.probe && !standDown && S.usb.present ? freeFor + 1 : 0
  if (freeFor >= 3) { freeFor = 0; run('the CT is free: the waxyct deck takes it', 'waxyct', () => handTo('waxyct')) }
}

// The packaged app waits on this before it loads its window: resolves with the URL once a waxyct
// router answers on the port (this one, or one already running).
let readyFn
export const ready = new Promise(r => { readyFn = r })
export const hooks = { quit: null, panel:null, guides:null }
// Closing the app: every owner waxyct started closes the CT itself first.
let shutdownAttempt = null
export function shutdown(why = 'closing') {
  if (shutdownAttempt) return shutdownAttempt
  quitting = true // never start a new owner while a failed close awaits an explicit retry
  note(`${why}: closing the CT cleanly first`)
  shutdownAttempt = Promise.allSettled([stopChild('bridge'), stopChild('probe'), stopChild('host')]).then(results => {
    const failures = results.filter(r => r.status === 'rejected').map(r => r.reason)
    if (failures.length) throw new AggregateError(failures, failures.map(e => e.message).join('; '))
  }).catch(error => { shutdownAttempt = null; throw error })
  return shutdownAttempt
}

// Nothing starts until this process owns the port: a second launch (which only brings the window
// forward) must never race the running one to fork a deck.
server.listen(cfg.port, '127.0.0.1', async () => {
  note(`waxyct ${BUILD.version} (${BUILD.commit}) on ${URL_}  (bridge: ${cfg.bridgeDir}  edena: ${cfg.edenaDir})`)
  if (process.argv.includes('--open') && !EMBEDDED) focusOrOpen()
  readyFn({ url: URL_ })
  pollHooks(); pollClaim(); pollPower(); pollProcs(); pollTd(); await pollUsb()
  if (cfg.hostAuto && !quitting) {
    await pollProcs()
    if (!quitting && !S.claim && !S.procs.loupedeck.length && !S.procs.bridges.some(b => !b.ours)) run('starting the waxyct deck', 'waxyct', () => handTo('waxyct'))
    else if (!quitting) note(`the CT is ${S.claim ? `held by ${S.claim.owner}` : 'not free'}: the waxyct deck waits; pick waxyct above to take it`)
  }
  setInterval(pollClaim, 500)
  setInterval(pollLogs, 500)
  setInterval(pollUsb, 1000)
  setInterval(pollProcs, 4000)
  setInterval(pollTd, 5000)
  setInterval(pollHooks, 10000)
  setInterval(pollPower, 60000)
  setInterval(() => broadcast('status', snapshot()), 1000)
  setInterval(autoOwner, 1000)
})

// ponytail: a poll that throws is logged and the router keeps serving; the pollers are independent.
process.on('uncaughtException', e => note(`FAILED inside waxyct: ${e.stack || e.message}`))

// Ctrl-C, Ctrl-Break or closing this console reach the forked owners too (same console), and each
// closes the CT itself; the router waits for them. EDENA runs on its own and is left as it is.
for (const sig of ['SIGINT', 'SIGHUP', 'SIGBREAK']) process.on(sig, async () => {
  try { await shutdown(sig); process.exit(0) }
  catch (e) { note(`Clean shutdown failed: ${e.message}. Retry Quit; the owner was not force-stopped.`) }
})
