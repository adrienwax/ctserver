import {createHash,randomUUID} from 'node:crypto'
import {checkNativeAction,nativeEndpointPath} from './native-client.mjs'
import {HOME_ACTIONS} from './home-dashboard.mjs'
// The button config: load it, check it, keep a last-good copy, keep history. Plain JSON files in
// waxyct/config, editable in any text editor or the panel. Nothing here needs a network or Claude.
//
//   config/settings.json          timings
//   config/apps.json              the apps the CT drives: name, colour, exe, target (td, moshpit, keys, handoff), tier
//   config/profiles/<id>.json     one set of pages for one app ("app": "<app id>"); MAIN has no app
//   config/.lastgood/<id>.json    the last version of each profile that passed the check
//   config/.history/<id>-<time>.json   every version the panel replaced
//
// "everyPage" holds controls shared by every page of a profile (keys, dials, buttons, the wheel). Each page
// is merged over it when the profile loads: a page's own control in the same place wins. The status page
// is left as it is.
//
// A profile that fails the check never runs: the last good version of it runs instead, and the
// error names the file, the field and the reason.
import fs from 'node:fs'
import { tdProfileSupported } from './td-contract.mjs'
import { readParkingRegistry, isProfileParked, activeProfileFiles } from './parking.mjs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { parseCombo, MEDIA } from './win-input.mjs'
import { normalizeLaunch } from './launch.mjs'
import { COLORS, TILES, KEY_SLOTS, DIALS, BUTTONS, ICONS, ACTIONS, TD_TYPES, TD_VERBS, LIMITS, APP_TARGETS, TIERS, MOSHPIT_VERBS, MOSHPIT_COMMANDS, MOSHPIT_PATH, pageOf } from './schema.mjs'
export { COLORS, TILES, KEY_SLOTS, DIALS, BUTTONS, ICONS, ACTIONS, TD_TYPES, LIMITS, APP_TARGETS, TIERS, pageOf }   // the deck and the scripts import them from here
const LABEL_OK = /^[A-Z0-9/ +\-.:%]*$/   // what the CT's key font can draw (ct-draw.mjs)

export const DEFAULT_SETTINGS = { holdMs: 500, escapeHoldMs: 1000, startProfile: 'main', knobStep: 0.02 }

// ---- the checker ------------------------------------------------------------------------------------
// Returns a list of problems, each "where: what". Empty = good. A shape it cannot walk (a null where an
// object belongs) is a problem too, never a crash: the deck host and the panel's save both call this.
export function checkProfile(p, ids, apps = {}) {
  try { return check(p, { ids, apps }) } catch (e) { return [`the file has a shape waxyct cannot read (${e.message}); compare it with docs/REMAP.md`] }
}
const has = (o, k) => typeof k === 'string' && Object.hasOwn(o, k)   // not "constructor" and friends
function check(p, ctx) {
  const out = [], bad = (where, what) => out.push(`${where}: ${what}`)
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['the file must hold one { ... } object']
  if (typeof p.name !== 'string' || !p.name) bad('name', 'give the profile a name, like "Windows"')
  if (p.color && !has(COLORS, p.color)) bad('color', `"${p.color}" is not a colour; use one of ${Object.keys(COLORS).join(', ')}`)
  if (typeof p.app === 'string') {
    if (!has(ctx.apps, p.app)) bad('app', `no app "${p.app}"; the apps (config/apps.json) are ${Object.keys(ctx.apps).join(', ') || 'none'}`)
  } else if (p.app !== undefined) {   // the pre-v3 inline form, still read for one release
    if (!p.app || typeof p.app !== 'object' || !p.app.exe) bad('app', 'name an app from config/apps.json, like "touchdesigner"')
    else {
      if (p.app.target === 'native' || p.app.driver !== undefined) bad('app', 'Native adapters must name a registered app from config/apps.json')
      if (p.app.launch !== undefined) checkLaunch('app.launch', p.app.launch, bad)
    }
  }
  if (p.layout !== undefined && p.layout !== 'recipe-v1') bad('layout','unsupported profile layout')
  if (p.layout === 'recipe-v1' && !p.rigIdentity) bad('rigIdentity','recipe profiles require an exact rig identity')
  if (p.metadata !== undefined) {
    if (!p.metadata || typeof p.metadata !== 'object' || Array.isArray(p.metadata)) bad('metadata','must be an object')
    else for (const [key,value] of Object.entries(p.metadata)) if (!['author','version','projectId','title'].includes(key) || typeof value!=='string' || value.length>160) bad('metadata','only short author, version, projectId and title text is supported')
  }
  if (p.rigIdentity !== undefined && (!p.rigIdentity || Object.keys(p.rigIdentity).some(k=>!['parameter','value'].includes(k)) || !/^[A-Z][a-z0-9]+$/.test(p.rigIdentity.parameter) || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(p.rigIdentity.value))) bad('rigIdentity','needs a parameter name and an exact lowercase project identity')
  if (p.tier !== undefined && !TIERS.includes(p.tier)) bad('tier', `is ${TIERS.join(' or ')}`)
  if (p.handoff !== undefined && typeof p.handoff !== 'boolean') bad('handoff', 'must be true or false')
  const app = typeof p.app === 'string' ? ctx.apps[p.app] : p.app
  const handoff = p.handoff || (app && app.target === 'handoff')
  for (const f of ['followFocus', 'sticky', 'followWorkspace', 'stripGestures']) if (p[f] !== undefined && typeof p[f] !== 'boolean') bad(f, 'must be true or false')
  if (p.followFocus && !(app && app.exe)) bad('followFocus', 'needs an app with an "exe" to know which window to follow')
  if (handoff && p.followFocus) bad('followFocus', 'a handoff profile gives the CT away; following focus onto it would hand the CT over whenever its window comes forward')
  if (!handoff) {
    if (!Array.isArray(p.pages) || !p.pages.length) bad('pages', 'needs at least one page: "pages": [ { "name": ..., "keys": { ... } } ]')
    else if (p.pages.length > LIMITS.pages) bad('pages', `has ${p.pages.length} pages; the CT has ${LIMITS.pages} page buttons (round 2 to 8)`)
  }
  if (p.everyPage !== undefined) {
    if (!p.everyPage || typeof p.everyPage !== 'object' || Array.isArray(p.everyPage)) bad('everyPage', 'must be { "keys": { ... }, "wheel": { ... } }: the controls on every page')
    else { if (p.everyPage.name !== undefined || p.everyPage.enter !== undefined) bad('everyPage', 'everyPage has no name or enter: it is not a page'); checkBody('everyPage', p.everyPage, ctx, bad) }
  }
  ;(p.pages || []).forEach((pg, i) => {
    const at = `pages[${i}]${pg && pg.name ? ` (${pg.name})` : ''}`
    if (!pg || typeof pg !== 'object') return bad(at, 'must be { ... }')
    if (pg.status) return
    if (typeof pg.name !== 'string' || !pg.name) bad(at, 'needs a "name", shown on the wheel screen')
    if(pg.nativeWorkspace!==undefined&&(typeof pg.nativeWorkspace!=='string'||!pg.nativeWorkspace||pg.nativeWorkspace.length>80))bad(at,'nativeWorkspace must name an exact app workspace')
    if(pg.inputExe!==undefined && (typeof pg.inputExe!=='string'||!/^[-a-zA-Z0-9 .]+\.exe$/.test(pg.inputExe)))bad(at,'inputExe must be a process filename')
    if (pg.enter !== undefined) checkAction(`${at} › enter`, pg.enter, ctx, bad)
    checkBody(at, pg, ctx, bad)
  })
  return out
}
// The controls of a page, or of everyPage
function checkBody(at, pg, ctx, bad) {
  for (const [k, c] of Object.entries(pg.keys || {})) {
    if (!KEY_SLOTS.includes(k)) { bad(`${at} › keys › "${k}"`, 'keys are numbered "0" to "11", left to right, top to bottom'); continue }
    checkControl(`${at} › keys › ${k}`, c, ctx, bad, true)
  }
  for (const [d, c] of Object.entries(pg.dials || {})) {
    if (!DIALS.includes(d)) { bad(`${at} › dials › "${d}"`, `dials are ${DIALS.join(', ')} (Top/Centre/Bottom, Left/Right)`); continue }
    if (!c || typeof c !== 'object') { bad(`${at} › dials › ${d}`, 'must be { "name": ..., "turn": { ... } }'); continue }
    if (c.unit !== undefined && (typeof c.unit !== 'string' || c.unit.length > 12)) bad(at, 'dial unit must be short text')
    if (c.name !== undefined) checkLabel(`${at} › dials › ${d} › name`, c.name, bad)
    if (c.turn !== undefined) checkAction(`${at} › dials › ${d} › turn`, c.turn, ctx, bad, 'turn')
    if (c.press !== undefined) checkAction(`${at} › dials › ${d} › press`, c.press, ctx, bad)
  }
  if (pg.wheel && typeof pg.wheel !== 'object') bad(`${at} › wheel`, 'must be { "turn": { ... }, "tap": { ... } }')
  else if (pg.wheel) {
    if (pg.wheel.turn !== undefined) checkAction(`${at} › wheel › turn`, pg.wheel.turn, ctx, bad, 'turn')
    if (pg.wheel.tap !== undefined) checkAction(`${at} › wheel › tap`, pg.wheel.tap, ctx, bad)
  }
  for (const [b, c] of Object.entries(pg.buttons || {})) {
    if (!BUTTONS.includes(b)) { bad(`${at} › buttons › "${b}"`, `buttons are ${BUTTONS.join(', ')}`); continue }
    checkControl(`${at} › buttons › ${b}`, c, ctx, bad, false)
  }
}
function checkLabel(at, l, bad) {
  if (typeof l !== 'string') return bad(at, 'must be text in quotes')
  if (l.length > LIMITS.label) bad(at, `"${l}" is ${l.length} characters; ${LIMITS.label} at most fit on a key`)
  if (!LABEL_OK.test(l.toUpperCase())) bad(at, `"${l}" has a character the CT cannot draw; use letters, digits, spaces and / - + . : %`)
}
function checkControl(at, c, ctx, bad, isKey) {
  if (!c || typeof c !== 'object') return bad(at, 'must be { "label": ..., "do": { ... } }')
  if (isKey && c.label !== undefined) checkLabel(`${at} › label`, c.label, bad)
  if (isKey && c.sub !== undefined) { if (typeof c.sub !== 'string' || c.sub.length > LIMITS.sub || !LABEL_OK.test(c.sub.toUpperCase())) bad(`${at} › sub`, `the small line under a label: ${LIMITS.sub} drawable characters at most`) }
  if (isKey && c.icon !== undefined && !ICONS.includes(c.icon)) bad(`${at} › icon`, `"${c.icon}" is not an icon; use one of ${ICONS.join(', ')}`)
  if (c.color !== undefined && !has(COLORS, c.color)) bad(`${at} › color`, `"${c.color}" is not a colour; use one of ${Object.keys(COLORS).join(', ')}`)
  if (c.state !== undefined && (!c.state || Object.keys(c.state).some(k=>!['par','equals'].includes(k)) || !/^[A-Z][a-z0-9]+$/.test(c.state.par) || !['string','number','boolean'].includes(typeof c.state.equals) || (typeof c.state.equals==='number' && !Number.isFinite(c.state.equals)))) bad(at, 'state needs a real parameter and a scalar equals value')
  if (c.do === undefined) bad(at, 'needs "do": the action, like { "keys": "ctrl+c" }')
  else checkAction(`${at} › do`, c.do, ctx, bad)
  if(c.redo!==undefined)checkAction(`${at} > redo`,c.redo,ctx,bad)
  if (c.hold !== undefined) checkAction(`${at} › hold`, c.hold, ctx, bad)
}
function checkLaunch(at, value, bad) {
  try { normalizeLaunch(value) } catch (error) { bad(at, error.message) }
}
function checkAction(at, a, ctx, bad, turn) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return bad(at, 'must be one action in { }, like { "media": "playpause" }')
  const kinds = Object.keys(a).filter(k => ACTIONS.includes(k))
  const stray = Object.keys(a).filter(k => !ACTIONS.includes(k) && k !== 'label' && k !== 'color')
  if (stray.length) return bad(at, `"${stray[0]}" is not an action (the deck would run it instead of the real one); use one of ${ACTIONS.join(', ')}`)
  if (kinds.length !== 1) return bad(at, kinds.length ? `has ${kinds.join(' and ')}: one action each (use "macro" for several)` : `no action here; use one of ${ACTIONS.join(', ')}`)
  const k = kinds[0], v = a[k]
  const tryCombo = (c, where) => { try { parseCombo(c) } catch (e) { bad(where, e.message) } }
  switch (k) {
    case 'keys':
      if (Array.isArray(v)) {
        if (!turn || v.length !== 2) bad(`${at} › keys`, 'a pair ["left key", "right key"] only works on a dial or the wheel')
        v.forEach((c, i) => tryCombo(c, `${at} › keys[${i}]`))
      } else tryCombo(v, `${at} › keys`)
      break
    case 'media': if (!has(MEDIA, v)) bad(`${at} › media`, `"${v}" is not a media key; use ${Object.keys(MEDIA).join(', ')}`); break
    case 'volume': case 'scroll': if (typeof v !== 'number' || !v || Math.abs(v) > 20) bad(`${at} › ${k}`, 'a number of steps, like 2 (or -2 on a button to go down)'); break
    case 'type': if (typeof v !== 'string') bad(`${at} › type`, 'the text to type, in quotes'); break
    case 'launch': checkLaunch(`${at} › launch`, v, bad); break
    case 'focus': if (typeof v !== 'string') bad(`${at} › focus`, 'the program file name, like "TouchDesigner.exe"'); break
    case 'app': if (!has(ctx.apps, v)) bad(`${at} › app`, `no app "${v}"; the apps (config/apps.json) are ${Object.keys(ctx.apps).join(', ')}`); break
    case 'switch': if (!ctx.ids.includes(v)) bad(`${at} › switch`, `no profile "${v}"; the profiles are ${ctx.ids.join(', ')}`); break
    case 'home': if (!HOME_ACTIONS.includes(v) || (turn && !/^browse-(apps|profiles|pages|projects)$/.test(v))) bad(at, 'Choose a supported Home action; rotation only browses'); break
    case 'page': if (!Number.isInteger(v) || v < 1 || v > LIMITS.pages) bad(`${at} › page`, `a page number, 1 to ${LIMITS.pages}`); break
    case 'native': if(!checkNativeAction(v,!!turn))bad(at,'Invalid native app command or parameter binding'); break
    case 'moshpit': {
      const at2 = `${at} › moshpit`
      if (!v || typeof v !== 'object' || !has(MOSHPIT_VERBS, v.verb)) { bad(at2, `needs "verb", one of ${Object.keys(MOSHPIT_VERBS).join(', ')}`); break }
      if (v.verb === 'command') { if (!MOSHPIT_COMMANDS.includes(v.command)) bad(`${at2} › command`, `one of ${MOSHPIT_COMMANDS.join(', ')}`); break }
      if (v.verb === 'step') { if (!Array.isArray(v.commands) || v.commands.length !== 2 || !v.commands.every((c) => MOSHPIT_COMMANDS.includes(c))) bad(`${at2} › commands`, 'two commands, [turn left, turn right], like ["transport.prevFrame", "transport.nextFrame"]'); break }
      if (v.verb === 'selstep') { if (v.step !== undefined && ![-1, 1].includes(v.step)) bad(`${at2} › step`, '-1 or 1 for a previous/next node button'); break }
      if (v.verb === 'bank') { if (v.width !== undefined && v.width !== 6) bad(`${at2} › width`, '6 for six-dial parameter pages, or omit for legacy three-dial banks'); break }
      if (v.bankWidth !== undefined && v.bankWidth !== 6) bad(`${at2} › bankWidth`, '6 for six-dial parameter pages, or omit for legacy banks')
      if (v.bank !== undefined) { if (v.slot !== 'sel' || !(Number.isInteger(v.bank) && v.bank >= 1 && v.bank <= (v.bankWidth === 6 ? 6 : 3)) || v.param !== undefined) bad(`${at2} › bank`, 'the bank control, 1 to 3 (or 1 to 6 with bankWidth: 6), on "slot": "sel", with no "param"'); break }
      if (v.path !== undefined) { if (typeof v.path !== 'string' || !MOSHPIT_PATH.test(v.path)) bad(`${at2} › path`, 'a ControlTarget path, like "/block/<id>/node/<id>/param/<key>" or "/lfo/<id>/period"'); break }
      if (v.lfo !== undefined) { if (!(Number.isInteger(v.lfo) && v.lfo >= 1 && v.lfo <= 8) || !['period', 'phase'].includes(v.field)) bad(`${at2} › lfo`, 'a project LFO by position, 1-8, with "field": "period" or "phase"'); break }
      if (!(Number.isInteger(v.slot) && v.slot >= 1 && v.slot <= 6) && !(v.slot === 'sel' && v.verb !== 'select')) bad(`${at2} › slot`, 'which node of the active block: 1 to 6, or "sel" for the selected one (or give an absolute "path")')
      if (v.verb === 'select') break
      if (!((Number.isInteger(v.param) && v.param >= 1 && v.param <= 8) || (typeof v.param === 'string' && /^[a-zA-Z][\w.-]{0,63}$/.test(v.param)))) bad(`${at2} › param`, 'the parameter by position (1-8) or by its key, like "amount"')
      break
    }
    case 'td':
      if (!v || !TD_TYPES.includes(v.type)) { bad(`${at} › td`, `needs "type", one of ${TD_TYPES.join(', ')}`); break }
      if (TD_VERBS[v.type].par && !/^[A-Z][a-z0-9]+$/.test(String(v.par))) bad(`${at} › td › par`, `${v.type} needs "par", a CT_RIG parameter: one capitalised word like "Glideamt"`)
      if (TD_VERBS[v.type].n && !(Number.isInteger(v.n) && v.n >= 1)) bad(`${at} › td › n`, `${v.type} needs "n", a clip number from 1`)
      break
    case 'macro':
      if (!Array.isArray(v) || !v.length) bad(`${at} › macro`, 'a list of actions, like [ { "keys": "ctrl+a" }, { "wait": 50 }, { "keys": "ctrl+c" } ]')
      else v.forEach((s, i) => { if (s && typeof s.wait === 'number') return; checkAction(`${at} › macro[${i}]`, s, ctx, bad) })
      break
  }
}

const expand = p => p.everyPage ? { ...p, pages: p.pages.map((_, i) => pageOf(p, i)) } : p

// ---- apps ------------------------------------------------------------------------------------------------
// config/apps.json: { "<id>": { "name", "color", "exe"?, "launch"?, "target", "endpoint"?, "tier"?, "default"? } }
export function checkApps(a) {
  const out = [], bad = (where, what) => out.push(`${where}: ${what}`)
  if (!a || typeof a !== 'object' || Array.isArray(a)) return ['the file must hold one { ... } object']
  for (const [id, x] of Object.entries(a)) {
    if (id.startsWith('_')) continue
    if (!/^[a-z0-9-]+$/.test(id)) bad(id, 'an app id is lowercase letters, digits and -')
    if (!x || typeof x !== 'object') { bad(id, 'must be { "name": ..., "target": ... }'); continue }
    if (typeof x.name !== 'string' || !x.name) bad(`${id} › name`, 'give the app a name')
    if (x.color !== undefined && !has(COLORS, x.color)) bad(`${id} › color`, `use one of ${Object.keys(COLORS).join(', ')}`)
    if (!APP_TARGETS.includes(x.target)) bad(`${id} › target`, `is one of ${APP_TARGETS.join(', ')}`)
    if (x.exe !== undefined && typeof x.exe !== 'string') bad(`${id} › exe`, 'the program file name, like "TouchDesigner.exe"')
    if (x.launch !== undefined) checkLaunch(`${id} › launch`, x.launch, bad)
    if (x.launchSha256 !== undefined && (typeof x.launchSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(x.launchSha256))) bad(`${id} › launchSha256`, 'must contain 64 hexadecimal characters')
    if (x.tier !== undefined && !TIERS.includes(x.tier)) bad(`${id} › tier`, `is ${TIERS.join(' or ')}`)
    if(x.driver!==undefined&&(id!=='spotify'||x.target!=='native'||x.driver!=='windows-media'))bad(id,'Only Spotify supports the built-in windows-media driver')
    if (x.target === 'native' && !x.driver && !path.isAbsolute(nativeEndpointPath(x.endpointFile))) bad(id,'Native app needs an absolute endpointFile')
    if (x.target === 'moshpit' && x.endpoint !== undefined && !/^ws:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(x.endpoint)) bad(`${id} › endpoint`, 'a loopback WebSocket address, like "ws://127.0.0.1:6193/control"')
    if (x.target === 'moshpit' && x.endpointFile !== undefined && (typeof x.endpointFile !== 'string' || !/control-endpoint\.json$/.test(x.endpointFile))) bad(`${id} › endpointFile`, 'where Moshpit writes its control-endpoint.json, like "%APPDATA%/Moshpit 3/control-endpoint.json"')
    if (x.target === 'moshpit' && x.endpoint === undefined && x.endpointFile === undefined) bad(id, 'a Moshpit app needs "endpointFile" (its port and token)')
  }
  return out
}
function loadApps(dir, errors) {
  let a = {}
  try { a = JSON.parse(fs.readFileSync(path.join(dir, 'apps.json'), 'utf8')) }
  catch (e) { if (e.code !== 'ENOENT') errors.push({ file: 'apps.json', problems: [`not valid JSON: ${e.message}`], usingLastGood: false }); return {} }
  const problems = checkApps(a)
  if (problems.length) errors.push({ file: 'apps.json', problems, usingLastGood: false })
  return Object.fromEntries(Object.entries(a).filter(([id, x]) => !id.startsWith('_') && !readParkingRegistry(dir).apps.includes(id) && x && typeof x === 'object'))
}
// A profile as the deck plays it: its app's exe, colour and target filled in, its tier settled (a profile
// can be legacy on its own; an app's tier covers all its profiles).
function resolve(p, id, apps) {
  const appId = typeof p.app === 'string' ? p.app : null
  const a = appId ? apps[appId] || {} : null
  const app = a ? { exe: a.exe, launch: a.launch, name: a.name, target: a.target, endpoint: a.endpoint, endpointFile: a.endpointFile, driver:a.driver } : p.app
  const tier = (a && a.tier === 'legacy') || p.tier === 'legacy' || (app?.target === 'td' && !p.rigIdentity) ? 'legacy' : 'current'
  return { ...p, id, appId, app: app && (app.exe || app.target) ? app : undefined, color: p.color || (a && a.color), tier, handoff: !!(p.handoff || (a && a.target === 'handoff')) }
}
export function configuredInventory(dir) {
  const errors=[], apps=loadApps(dir,errors), files=activeProfileFiles(dir), ids=files.map(f=>f.slice(0,-5)), profiles=[]
  for(const file of files) {
    try {const raw=JSON.parse(fs.readFileSync(path.join(dir,'profiles',file),'utf8')), problems=checkProfile(raw,ids,apps)
      if(problems.length){errors.push({file:'profiles/'+file,problems});continue}
      const p=resolve(raw,file.slice(0,-5),apps)
      profiles.push({id:p.id,name:p.name,color:p.color,handoff:!!p.handoff,pages:(p.pages||[]).map(g=>g.name),app:p.app?.exe||null,appId:p.appId,tier:p.tier,pick:!!p.pick,running:null})
    }catch(error){errors.push({file:'profiles/'+file,problems:[error.message]})}
  }
  return {profiles,apps:Object.entries(apps).map(([id,a])=>({id,...a,running:null})),errors}
}

// The profile picker: an app with several current profiles gets a generated page, one key per profile.
function picker(aid, a, mine) {
  const order = mine.sort((x, y) => (y.id === a.default) - (x.id === a.default) || x.name.localeCompare(y.name))
  const keys = Object.fromEntries(order.slice(0, 12).map((x, i) => [String(i), { label: x.name.slice(0, LIMITS.label), sub: 'profile', color: x.color || a.color, do: { switch: x.id } }]))
  return { id: `pick-${aid}`, name: a.name, color: a.color, appId: aid, app: { exe: a.exe, name: a.name, target: a.target }, tier: 'current', pick: true, handoff: false, pages: [{ name: 'Profiles', keys }] }
}

// ---- loading, with the last-good fallback ------------------------------------------------------------
export function loadConfig(dir) {
  const profDir = path.join(dir, 'profiles'), goodDir = path.join(dir, '.lastgood')
  fs.mkdirSync(goodDir, { recursive: true })
  const errors = []
  let settings = { ...DEFAULT_SETTINGS }
  try { Object.assign(settings, JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))) }
  catch (e) { if (e.code !== 'ENOENT') errors.push({ file: 'settings.json', problems: [`not valid JSON: ${e.message}`], usingLastGood: false }) }

  const registry = readParkingRegistry(dir), apps = loadApps(dir, errors)
  const files = activeProfileFiles(dir, registry)
  // a retired profile (config/_retired/<id>.json) stays retired: its last-good copy is not a reason to load it
  const retiredDir = path.join(dir, '_retired'), retired = new Set(fs.existsSync(retiredDir) ? fs.readdirSync(retiredDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : [])
  const ids = [...new Set([...files.map(f => f.slice(0, -5)), ...fs.readdirSync(goodDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(id => !retired.has(id) && !registry.profiles.includes(id) && (() => { try { return !isProfileParked(dir, id, JSON.parse(fs.readFileSync(path.join(goodDir, `${id}.json`), 'utf8')), registry) } catch { return false } })())])]
  const profiles = {}
  for (const id of ids) {
    const file = `profiles/${id}.json`
    let p = null, problems = []
    try { p = JSON.parse(fs.readFileSync(path.join(profDir, `${id}.json`), 'utf8')) }
    catch (e) { problems = [e.code === 'ENOENT' ? 'the file is missing' : `not valid JSON: ${e.message.replace(/^Unexpected/, 'unexpected')} (a missing comma or quote, usually)`] }
    if (p) problems = checkProfile(p, ids, apps)
    if (!problems.length) {
      profiles[id] = resolve(expand(p), id, apps)
      fs.writeFileSync(path.join(goodDir, `${id}.json`), JSON.stringify(p, null, 2))
      continue
    }
    let good = null
    try { good = JSON.parse(fs.readFileSync(path.join(goodDir, `${id}.json`), 'utf8')) } catch {}
    if (good && (isProfileParked(dir, id, good, registry) || checkProfile(good, ids, apps).length)) good = null
    if (good) profiles[id] = resolve(expand(good), id, apps)
    errors.push({ file, problems, usingLastGood: !!good })
  }
  if (!profiles.main) errors.push({ file: 'profiles/main.json', problems: ['MAIN is required: the switchboard on round 1'], usingLastGood: false })
  for (const [aid, a] of Object.entries(apps)) {
    const mine = Object.values(profiles).filter(x => x.appId === aid && x.tier === 'current' && !x.handoff)
    if (mine.length > 1) profiles[`pick-${aid}`] = picker(aid, a, mine)
  }
  if (!tdProfileSupported(profiles[settings.startProfile])) settings.startProfile = 'main'
  return { settings, apps, profiles, errors }
}

// Written the way a person writes it: anything that fits on one line (a key, a dial) stays on one line,
// so a file saved from the panel is as easy to edit by hand as the shipped ones.
const inline = v => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(inline).join(', ')}]`
  : `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }`
export function pretty(v, ind = '') {
  const one = inline(v)
  if (typeof v !== 'object' || v === null || one.length + ind.length <= 140) return one
  const next = ind + '  '
  const NL = '\n'
  if (Array.isArray(v)) return '[' + NL + v.map(x => next + pretty(x, next)).join(',' + NL) + NL + ind + ']'
  return '{' + NL + Object.entries(v).map(([k, x]) => `${next}${JSON.stringify(k)}: ${pretty(x, next)}`).join(',' + NL) + NL + ind + '}'
}

// The panel's save: check first, keep the old version in .history, then write.
export const profileRevision = text => createHash('sha256').update(text).digest('hex')
export function readProfileVersion(dir, id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw Error('Invalid profile id')
  const bytes = fs.readFileSync(path.join(dir, 'profiles', id + '.json'))
  const text = bytes.toString('utf8')
  let problems
  try {
    const ids = [...new Set([...activeProfileFiles(dir).map(f => f.slice(0, -5)), id])]
    problems = checkProfile(JSON.parse(text), ids, loadApps(dir, []))
  } catch (e) { problems = [`Invalid profile: ${e.message}`] }
  return {text, revision:profileRevision(bytes), problems}
}
// expectedRevision is optional only for trusted low-level legacy callers; the panel API requires it.
export function saveProfile(dir, id, text, options = {}) {
  if (!/^[a-z0-9-]+$/.test(id)) return { ok: false, problems: ['a profile id is lowercase letters, digits and -'] }
  if (readParkingRegistry(dir).profiles.includes(id)) return { ok: false, problems: ['This profile is parked; restore it explicitly before editing'] }
  let p
  try { p = JSON.parse(text) } catch (e) { return { ok: false, problems: [`not valid JSON: ${e.message}`] } }
  const ids = [...new Set([...activeProfileFiles(dir).map(f => f.slice(0, -5)), id])]
  if (/^pick-/.test(id)) return { ok: false, problems: ['a profile picker is made by waxyct from config/apps.json; it is not saved'] }
  const problems = checkProfile(p, ids, loadApps(dir, []))
  if (problems.length) return { ok: false, problems }
  const file = path.join(dir, 'profiles', id + '.json'), hist = path.join(dir, '.history')
  const guarded = Object.hasOwn(options, 'expectedRevision'), expected = options.expectedRevision
  if (guarded && expected !== null && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) return {ok:false,problems:['Reload this profile before saving; its disk revision is missing.']}
  const currentRevision = () => fs.existsSync(file) ? profileRevision(fs.readFileSync(file)) : null
  const conflict = () => ({ok:false,conflict:true,problems:['This profile changed on disk. Reload it before saving; your external edits were preserved.']})
  if (guarded && currentRevision() !== expected) return conflict()
  const installed = pretty(p) + '\n', tmp = file + '.' + randomUUID() + '.tmp'
  fs.mkdirSync(hist, {recursive:true})
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(hist, id + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.json'))
  try {
    fs.writeFileSync(tmp, installed, {flag:'wx'})
    // This narrows the check/replace interval; arbitrary external writers are not a filesystem CAS.
    if (guarded && currentRevision() !== expected) return conflict()
    fs.renameSync(tmp, file)
  } finally { fs.rmSync(tmp, {force:true}) }
  const mine = fs.readdirSync(hist).filter(f => f.startsWith(id + '-') && f.endsWith('.json')).sort()
  for (const f of mine.slice(0, -50)) fs.rmSync(path.join(hist, f), {force:true})
  return {ok:true,problems:[],revision:profileRevision(installed)}
}

// Self-check: `node host/profiles.mjs` checks the shipped config and a set of broken examples.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const assert = (await import('node:assert')).strict
  const dir = process.env.WAXYCT_CONFIG || new URL('../config/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')   // a scratch copy keeps .lastgood untouched
  const c = loadConfig(dir)
  for (const e of c.errors) console.log('PROBLEM', e.file, e.problems)
  assert.equal(c.errors.length, 0, 'the shipped config passes')
  console.log('shipped profiles ok:', Object.keys(c.profiles).join(', '))
  const ids = ['main', 'windows']
  const bad = (p) => checkProfile({ name: 'X', pages: [{ name: 'P', ...p }] }, ids)
  assert.match(checkProfile({ name: 'X', stripGestures: 'false', pages: [{ name: 'P' }] }, ids)[0], /stripGestures: must be true or false/)
  assert.equal(checkProfile({ name: 'X', stripGestures: false, pages: [{ name: 'P' }] }, ids).length, 0, 'display-only strips accept an explicit false')
  assert.match(bad({ keys: { 0: { label: 'COPY', do: { keys: 'ctlr+c' } } } })[0], /"ctlr" is not a key name/)
  assert.match(bad({ keys: { 12: { do: { none: true } } } })[0], /numbered "0" to "11"/)
  assert.match(bad({ keys: { 0: { label: 'a&b', do: { none: true } } } })[0], /cannot draw/)
  assert.equal(bad({ keys: { 0: { label: 'VOL -5.0%', do: { none: true } } } }).length, 0, 'the new marks are fine')
  assert.match(bad({ keys: { 0: { do: { media: 'loud' } } } })[0], /not a media key/)
  assert.match(bad({ keys: { 0: { do: { switch: 'resolve' } } } })[0], /no profile "resolve"/)
  assert.match(bad({ keys: { 0: { do: { keys: 'a', media: 'mute' } } } })[0], /one action each/)
  assert.match(bad({ dials: { XX: {} } })[0], /dials are/)
  assert.equal(bad({ dials: { TL: { turn: { keys: ['left', 'right'] } } } }).length, 0, 'a key pair on a dial is fine')
  assert.match(bad({ keys: { 0: { do: { keys: ['left', 'right'] } } } })[0], /only works on a dial/)
  assert.match(checkProfile({ name: 'X', app: null, pages: [{ name: 'P' }] }, ids)[0], /name an app from config\/apps.json/)
  // apps over profiles
  const APPS = { td: { name: 'TD', target: 'td', exe: 'TouchDesigner.exe' }, ed: { name: 'EDENA', target: 'handoff', tier: 'legacy' } }
  assert.equal(checkProfile({ name: 'X', app: 'td', pages: [{ name: 'P' }] }, ids, APPS).length, 0, 'an app reference is fine')
  assert.match(checkProfile({ name: 'X', app: 'resolve', pages: [{ name: 'P' }] }, ids, APPS)[0], /no app "resolve"/)
  assert.equal(checkProfile({ name: 'X', app: 'ed' }, ids, APPS).length, 0, 'a hand-off app needs no pages')
  assert.match(checkProfile({ name: 'X', tier: 'old', pages: [{ name: 'P' }] }, ids, APPS)[0], /tier: is current or legacy/)
  assert.match(bad({ keys: { 0: { do: { app: 'nope' } } } })[0], /no app "nope"/)
  assert.match(checkApps({ x: { name: 'X', target: 'osc' } })[0], /target: is one of/)
  assert.equal(bad({ keys: { 0: { label: 'PLAY', do: { moshpit: { verb: 'command', command: 'transport.play' } } } }, dials: { TL: { name: 'A', turn: { moshpit: { verb: 'knob', slot: 1, param: 1 } } } } }).length, 0, 'moshpit actions are fine')
  assert.match(bad({ keys: { 0: { do: { moshpit: { verb: 'command', command: 'transport.jump' } } } } })[0], /one of transport.play/)
  assert.equal(bad({ enter: { moshpit: { verb: 'command', command: 'workspace.mosh' } }, keys: { 0: { label: 'SLOT 1', do: { moshpit: { verb: 'select', slot: 1 } } } }, dials: { TL: { name: 'P1', turn: { moshpit: { verb: 'knob', slot: 'sel', param: 1 } } } } }).length, 0, 'a page enter, a select key and a dial on the selected slot are fine')
  assert.match(bad({ enter: { moshpit: { verb: 'command', command: 'workspace.nodes' } } })[0], /enter › moshpit › command/)
  assert.match(bad({ keys: { 0: { do: { moshpit: { verb: 'select', slot: 'sel' } } } } })[0], /slot: which node/)
  assert.match(bad({ keys: { 0: { do: { moshpit: { verb: 'toggle', slot: 9, param: 'bypass' } } } } })[0], /slot: which node/)
  assert.match(bad({ dials: { TL: { turn: { moshpit: { verb: 'knob', path: '/block/x/param/y' } } } } })[0], /ControlTarget path/)
  assert.equal(bad({ dials: { TL: { name: 'NODE', turn: { moshpit: { verb: 'selstep' } } }, BL: { name: 'BANK', turn: { moshpit: { verb: 'bank' } } }, TR: { name: 'V1', turn: { moshpit: { verb: 'knob', slot: 'sel', bank: 1 } }, press: { moshpit: { verb: 'reset', slot: 'sel', bank: 1 } } } } }).length, 0, 'browsing knobs and bank dials are fine')
  assert.match(bad({ dials: { TR: { turn: { moshpit: { verb: 'knob', slot: 2, bank: 1 } } } } })[0], /bank/)
  assert.match(bad({ dials: { TR: { turn: { moshpit: { verb: 'knob', slot: 'sel', bank: 4 } } } } })[0], /bank/)
  assert.match(checkApps({ m: { name: 'M', target: 'moshpit', endpoint: 'ws://example.com:80/x' } })[0], /loopback WebSocket/)
  assert.match(checkApps({ m: { name: 'M', target: 'moshpit' } })[0], /needs "endpointFile"/)
  {
    const tmp = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'waxyct-apps-'))
    fs.mkdirSync(path.join(tmp, 'profiles'))
    const put = (id, v) => fs.writeFileSync(path.join(tmp, 'profiles', `${id}.json`), JSON.stringify(v))
    fs.writeFileSync(path.join(tmp, 'apps.json'), JSON.stringify({ ...APPS, td: { ...APPS.td, default: 'b' } }))
    put('main', { name: 'Main', pages: [{ name: 'S', keys: { 0: { label: 'TD', do: { app: 'td' } } } }] })
    put('a', { name: 'A', app: 'td', rigIdentity:{parameter:'Projectid',value:'test-a'}, pages: [{ name: 'P' }] })
    put('b', { name: 'B', app: 'td', rigIdentity:{parameter:'Projectid',value:'test-b'}, pages: [{ name: 'P' }] })
    put('c', { name: 'C', app: 'td', tier: 'legacy', pages: [{ name: 'P' }] })
    put('e', { name: 'E', app: 'ed' })
    fs.mkdirSync(path.join(tmp, '.lastgood')); fs.mkdirSync(path.join(tmp, '_retired'))
    fs.writeFileSync(path.join(tmp, '.lastgood', 'old.json'), JSON.stringify({ name: 'Old', pages: [{ name: 'P' }] }))
    fs.writeFileSync(path.join(tmp, '_retired', 'old.json'), JSON.stringify({ name: 'Old', pages: [{ name: 'P' }] }))
    const c = loadConfig(tmp)
    fs.rmSync(tmp, { recursive: true, force: true })
    assert.equal(c.errors.length, 0, JSON.stringify(c.errors))
    assert.ok(!c.profiles.old, 'a retired profile is not brought back by its last-good copy')
    assert.deepEqual(Object.values(c.profiles['pick-td'].pages[0].keys).map((k) => k.do.switch), ['b', 'a'], 'the picker: current profiles only, the default first')
    assert.ok(c.profiles.e.handoff && c.profiles.e.tier === 'legacy', "a legacy hand-off app's profile is legacy and still hands off")
    assert.equal(c.profiles.a.app.exe, 'TouchDesigner.exe', 'a profile plays with its app\'s exe')
  }
  assert.match(bad({ dials: { TL: null } })[0], /must be \{ "name"/)
  assert.match(bad({ keys: { 0: { do: { note: 'x', keys: 'ctrl+c' } } } })[0], /"note" is not an action/)
  assert.match(bad({ keys: { 0: { color: 'constructor', do: { none: true } } } })[0], /not a colour/)
  assert.match(bad({ keys: { 0: { do: { media: 'constructor' } } } })[0], /not a media key/)
  assert.match(checkProfile({ name: 'X', pages: [{ name: 'P', keys: { 0: { do: { get none() { throw new Error('boom') } } } } }] }, ids)[0], /cannot read/)
  assert.match(bad({ keys: { 0: { do: { osc: '/composition/x' } } } })[0], /"osc" is not an action/)
  assert.match(bad({ keys: { 0: { do: { td: { type: 'fxOn' } } } } })[0], /needs "type", one of rigKnob/)
  const ep = { name: 'X', everyPage: { keys: { 11: { label: 'VIEW', do: { none: true } } }, wheel: { tap: { main: true } } }, pages: [{ name: 'A', keys: { 11: { label: 'MINE', do: { none: true } } } }, { name: 'B', wheel: { tap: { none: true } } }] }
  assert.equal(checkProfile(ep, ids).length, 0, 'everyPage is fine')
  assert.equal(pageOf(ep, 0).keys[11].label, 'MINE', "a page's own key wins over everyPage")
  assert.equal(pageOf(ep, 1).keys[11].label, 'VIEW', "a page without its own key gets everyPage's")
  assert.ok(pageOf(ep, 0).wheel.tap.main && pageOf(ep, 1).wheel.tap.none, 'the wheel: everyPage unless the page has its own')
  assert.match(checkProfile({ ...ep, everyPage: { keys: { 0: { do: { media: 'loud' } } } } }, ids)[0], /everyPage › keys › 0/)
  assert.match(bad({ keys: { 0: { do: { td: { type: 'rigKnob', par: 'glide amt' } } } } })[0], /one capitalised word/)
  assert.match(bad({ keys: { 0: { do: { td: { type: 'rigClip' } } } } })[0], /a clip number/)
  assert.match(bad({ keys: { 0: { label: 'X', icon: 'sparkle', do: { none: true } } } })[0], /not an icon/)
  assert.match(bad({ keys: { 0: { label: 'X', sub: 'far too long a line', do: { none: true } } } })[0], /12 drawable/)
  assert.equal(bad({ keys: { 0: { label: 'TRAILS', icon: 'trails', sub: 'on / off', do: { none: true } } } }).length, 0, 'an icon and a sub line are fine')
  const bridge = process.env.WAXYCT_BRIDGE || fileURLToPath(new URL('../integrations/ct-td-control/', import.meta.url))
  const { GLYPH_NAMES } = await import(pathToFileURL(`${bridge}/ct-draw.mjs`).href)
  assert.deepEqual(ICONS, GLYPH_NAMES, 'ICONS is the glyph list of ct-draw')
  console.log('profiles self-check ok: every broken example caught, the good ones passed, apps and pickers resolve, icons match ct-draw')
}
