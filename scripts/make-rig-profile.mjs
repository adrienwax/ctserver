// Writes a CT profile from its short spec, config/rigs/<id>.json -> config/profiles/<id>.json, by the CT profile
// layout conventions and the icon language's glyphs (ct-draw.mjs).
//   node scripts/make-rig-profile.mjs moshpit blender      (the spec's "target" picks the kind below)
//
// Every kind, every page (the standard's global layer):
//   A / B / C / D   the transport: play, stop, back, forward (up / down / left / right)
//   Moshpit wheel   frame scrubbing, tap to toggle play / pause
//   home            MAIN, the CT home and app picker
//   undo / save     the app's undo (hold: redo) and save, where it has them
// Moshpit starts on its IN workspace at round 2. Parked legacy key-app generators retain their own HOME, then one page per app
// workspace in the app's own order. A page with an "enter" action switches the app to that workspace on landing.
// Key labels are short: one top label above the icon; sub metadata remains available to customization.
//
//   target "moshpit"   Moshpit v3 over its control socket; pages built from KIT names
//   target "keys"      an app driven by its keyboard shortcuts (Blender, Resolve, Ableton, Bitwig); pages as written
//   target "td" / none a TD rig (CT_RIG): one page per block, in the TD page layout (docs/REMAP.md). Seven pages fill
//                      the CT's seven page rounds, so a TD rig has no HOME page: MAIN (round 1, the home button) is it
import fs from 'node:fs'
import { writeGeneratedProfile } from './generated-profile.mjs'
import { fileURLToPath } from 'node:url'
import { pretty, checkProfile } from '../host/profiles.mjs'

const BTN = ['a', 'b', 'c', 'd']
// HOME: the spec's apps (keys 1-3), MAIN (key 4), one key per workspace (keys 5-10)
function homePage(s) {
  if (s.workspaces.length > 6) throw new Error(`${s.name}: ${s.workspaces.length} workspaces; HOME and six fill the CT's seven page rounds`)
  return {
    name: 'HOME',
    keys: {
      ...Object.fromEntries((s.home || []).slice(0, 3).map((a, i) => [i, { label: a.label, ...(a.color ? { color: a.color } : {}), sub: 'APP', do: { app: a.app } }])),
      3: { label: 'MAIN', color: 'bone', icon: 'home', sub: 'ALL', do: { main: true } },
      ...Object.fromEntries(s.workspaces.map((w, i) => [4 + i, { label: w.page, icon: w.icon, sub: 'GO', do: { page: i + 2 } }])),
    },
  }
}
// The global buttons. transport: { a, b, c, d } actions (null: not mapped yet, said in _help)
function globalButtons(transport, extra = {}) {
  return { home: { do: { main: true } }, ...extra, ...Object.fromEntries(BTN.filter((id) => transport[id]).map((id) => [id, { do: transport[id] }])) }
}
const unmapped = (transport) => BTN.filter((id) => !transport[id]).map((id) => id.toUpperCase())
const tName = (a) => !a ? 'not mapped yet' : a.moshpit ? a.moshpit.command : a.keys ? a.keys : a.td ? `${a.td.type}${a.td.step ? ` ${a.td.step}` : ''}` : Object.keys(a)[0]
const tHelp = (tr, wheel = false) => `Transport ${wheel ? '' : 'only '}on A / B / C / D (up / down / left / right): ${BTN.map((id) => `${id.toUpperCase()} ${tName(tr[id])}`).join(', ')}.`

// ---- Moshpit ------------------------------------------------------------------------------------------
// Each page's keys and dials come from the spec's "workspaces" list, by name from KIT and DIAL below.
// Explicit zero-based positions preserve EDENA's bottom-row primary actions; arrays still fill from key 1.
// Only MOSH pages navigate blocks. Save is the project shortcut after the host verifies application focus.
// New MOSH pages use six continuous parameter dials; screen keys select nodes, blocks and parameter pages.
// Legacy named browsing dials and three-wide banks remain available for owner profiles.
const mp = (v) => ({ moshpit: v })
const cmd = (command) => mp({ verb: 'command', command })
const six = [1, 2, 3, 4, 5, 6]
const resetBank = () => ({ macro: [1, 2, 3].map((bank) => mp({ verb: 'reset', slot: 'sel', bank })) })
const KIT = {
  'mark.in': () => [{ label: 'MARK IN', icon: 'mark-in', sub: 'HEAD', do: cmd('mark.in') }],
  'mark.out': () => [{ label: 'MARK OUT', icon: 'mark-out', sub: 'HEAD', do: cmd('mark.out') }],
  'source.selectAll': () => [{ label: 'ALL FRAMES', icon: 'source', sub: 'RANGE', do: cmd('source.selectAll') }],
  'source.sendA': () => [{ label: 'SEND A', icon: 'import', sub: 'MARKED RANGE', do: cmd('source.sendA') }],
  'source.sendB': () => [{ label: 'SEND B', icon: 'import', sub: 'MARKED RANGE', do: cmd('source.sendB') }],
  'source.addBlock': () => [{ label: 'ADD BLOCK', icon: 'add', sub: 'MARKED RANGE', do: cmd('source.addBlock') }],
  'clip.prev': () => [{ label: 'CLIP -', icon: 'back', sub: 'IN', do: cmd('clip.prev') }],
  'clip.next': () => [{ label: 'CLIP +', icon: 'forward', sub: 'IN', do: cmd('clip.next') }],
  'block.prev': () => [{ label: 'BLOCK -', icon: 'back', sub: 'MOSH', do: cmd('block.prev') }],
  'block.next': () => [{ label: 'BLOCK +', icon: 'forward', sub: 'MOSH', do: cmd('block.next') }],
  'workspace.mosh': () => [{ label: 'MOSH', icon: 'mosh', sub: 'BACK TO EDIT', do: cmd('workspace.mosh') }],
  'workspace.node': () => [{ label: 'GRAPH', icon: 'node', sub: 'EDIT NODES', do: cmd('workspace.node') }],
  'node.prev': () => [{ label: 'NODE -', icon: 'back', sub: 'SELECT', do: mp({ verb: 'selstep', step: -1 }) }],
  'node.next': () => [{ label: 'NODE +', icon: 'forward', sub: 'SELECT', do: mp({ verb: 'selstep', step: 1 }) }],
  'params-page': () => [{ label: 'P1-6', icon: 'layers', sub: 'PARAM PAGE', do: mp({ verb: 'bank', width: 6 }) }],
  'workspace.settings': () => [{ label: 'SETTINGS', icon: 'settings', sub: 'PREFERENCES', do: cmd('workspace.settings') }],
  'block.freeze': () => [{ label: 'FREEZE', icon: 'freeze', sub: 'BLK', do: cmd('block.freeze') }],
  'render.start': () => [{ label: 'RENDER', icon: 'render', sub: 'OUT', do: cmd('render.start') }],
  'block.unfreeze': () => [{ label: 'THAW', color: 'dust', icon: 'freeze', sub: 'BLK', do: cmd('block.unfreeze') }],
  'slots-on': (s) => six.map((n) => ({ label: `FX ${n}`, icon: 'effect', sub: 'ON', do: mp({ verb: 'toggle', slot: n, param: s.bypass || 'bypass' }) })),
  'slots-select': () => six.map((n) => ({ label: `NODE ${n}`, icon: 'node', sub: 'SEL', do: mp({ verb: 'select', slot: n }) })),
  'four-effects': () => [1, 2, 3, 4].map(n => ({ label: `FX ${n}`, icon: 'effect', sub: 'SELECT', do: mp({ verb: 'select', slot: n }) })),
  'four-nodes': () => [1, 2, 3, 4].map(n => ({ label: `NODE ${n}`, icon: 'node', sub: 'SELECT', do: mp({ verb: 'select', slot: n }) })),
  'sel-on': (s) => [{ label: 'ON / OFF', icon: 'effect', sub: 'SEL', do: mp({ verb: 'toggle', slot: 'sel', param: s.bypass || 'bypass' }) }],
  'sel-reset': () => [{ label: 'RESET', color: 'dust', icon: 'reset', sub: 'BANK', do: resetBank() }],
}
const DIAL = {
  block: () => ({ name: 'BLOCK', turn: mp({ verb: 'step', commands: ['block.prev', 'block.next'] }) }),
  'block-freeze': () => ({ ...DIAL.block(), press: cmd('block.freeze') }),
  node: (s) => ({ name: 'NODE', turn: mp({ verb: 'selstep' }), press: mp({ verb: 'toggle', slot: 'sel', param: s.bypass || 'bypass' }) }),
  // IN (M3): the clip, and the in / out marks nudged a frame a detent, a press sets the mark at the playhead
  clip: () => ({ name: 'CLIP', turn: mp({ verb: 'step', commands: ['clip.prev', 'clip.next'] }) }),
  'mark-in': () => ({ name: 'IN', turn: mp({ verb: 'step', commands: ['mark.in.nudgeBack', 'mark.in.nudgeForward'] }), press: cmd('mark.in') }),
  'mark-out': () => ({ name: 'OUT', turn: mp({ verb: 'step', commands: ['mark.out.nudgeBack', 'mark.out.nudgeForward'] }), press: cmd('mark.out') }),
  transpose: () => ({ name: 'TRANSPOSE', turn: mp({ verb: 'step', commands: ['mark.range.nudgeBack', 'mark.range.nudgeForward'] }) }),
  folder: () => ({ name: 'FOLDER', turn: mp({ verb: 'step', commands: ['folder.prev', 'folder.next'] }) }),
  zoom: () => ({ name: 'ZOOM', turn: mp({ verb: 'step', commands: ['source.zoomOut', 'source.zoomIn'] }), press: cmd('source.zoomFit') }),
  bank: () => ({ name: 'BANK', turn: mp({ verb: 'bank' }), press: resetBank() }),
}
const editDial = (bank) => ({ name: `EDIT ${bank}`, turn: mp({ verb: 'knob', slot: 'sel', bank }), press: mp({ verb: 'reset', slot: 'sel', bank }) })
const SIDE = { left: ['TL', 'CL', 'BL'], right: ['TR', 'CR', 'BR'] }
// "dials": { "left": [names or null], "right": "bank" }: a list names each dial (null = blank); "bank" = the three edit dials
function dialsOf(s, w) {
  return Object.fromEntries(Object.entries(w.dials || {}).flatMap(([side, set]) => {
    const list = set === 'params' ? (side === 'left' ? [1, 2, 3] : [4, 5, 6]).map(n => ({ name: `PARAM ${n}`, turn: mp({ verb: 'knob', slot: 'sel', bank: n, bankWidth: 6 }), press: mp({ verb: 'reset', slot: 'sel', bank: n, bankWidth: 6 }) })) : set === 'bank' ? [1, 2, 3].map(editDial) : Array.isArray(set) && set.length <= 3 && set.every((n) => n === null || DIAL[n]) ? set.map((n) => n && DIAL[n](s)) : null
    if (!SIDE[side] || !list) throw new Error(`${s.name} › ${w.page}: dials are { "left" | "right": "bank", "params", or up to three of ${Object.keys(DIAL).join(', ')}, null }`)
    return list.map((d, i) => [SIDE[side][i], d]).filter(([, d]) => d)
  }))
}
function makeMoshpitProfile(s) {
  const t = s.transport || { a: 'transport.play', b: 'transport.stop', c: 'transport.prevFrame', d: 'transport.nextFrame' }
  for (const id of BTN) if (!t[id]) throw new Error(`${s.name}: "transport" needs a command for button ${id}`)
  const tr = Object.fromEntries(BTN.map((id) => [id, cmd(t[id])]))
  const keysOf = (w) => {
    const keys = {}, entries = Array.isArray(w.keys) ? w.keys.map(k => [null, k]) : Object.entries(w.keys || {})
    let cursor = 0
    for (const [at, item] of entries) {
      if (at !== null) cursor = Number(at)
      const list = typeof item === 'string' ? KIT[item]?.(s) : [item]
      if (!list) throw new Error(`${s.name} › ${w.page}: no kit item "${item}"; one of ${Object.keys(KIT).join(', ')}`)
      for (const key of list) {
        if (!Number.isInteger(cursor) || cursor < 0 || cursor > 11 || keys[cursor]) throw new Error(`${s.name} › ${w.page}: overlapping or invalid key ${cursor}`)
        keys[cursor++] = key
      }
    }
    return keys
  }
  const pages = s.workspaces.map((w) => ({ name: w.page, enter: cmd(w.enter), keys: keysOf(w), dials: dialsOf(s, w), ...(w.buttons ? { buttons: w.buttons } : {}) }))
  const everyPage = {
    keys: {},
    buttons: globalButtons(tr, { save: { do: s.save || { keys: 'ctrl+s' } }, undo: { do: cmd('edit.undo'), hold: cmd('edit.redo') } }),
    wheel: s.wheel || { turn: mp({ verb: 'step', commands: ['transport.prevFrame', 'transport.nextFrame'] }), tap: cmd('transport.loop') },
  }
  return {
    _help: `${s.name}: ${s.toe}. Generated by scripts/make-rig-profile.mjs from config/rigs/ - edit that, not this. The CT profile standard: ` +
      `round 1 global Home; ${s.workspaces.map((w, i) => `round ${i + 2} ${w.page} (${w.enter})`).join(', ')}; landing on a page switches Moshpit to it. ` +
      `${tHelp(tr, true)} Home button = global Home; bottom-row actions belong to each workspace. Save = project save (Ctrl+S after focus check); undo = undo (Fn or hold: redo). IN dials: left In/Out/Transpose; right Clip/Folder/Zoom (press Fit). MOSH knobs edit values only: all six follow the selected effect; press resets one value. ` +
      `Screen keys select nodes and blocks; the parameter-page key cycles P1-6, P7-8, and LFO 1 rate/phase. Missing parameters are unavailable; unused page positions are blank. ` +
      `MOSH FX has Freeze/Thaw and Graph; MOSH EDIT has selected bypass and MOSH. Four direct node tiles plus Node -/+ reach every exposed node. ` +
      `${s.stripGestures === false ? 'Side strips display knob labels and values only; touches and swipes do nothing.' : 'The strips mirror their knobs: touch presses, slide turns.'} ` +
      `Keyboard held = fine; either Fn held = fast. Wheel turn = previous / next frame; tap = play / pause (transport.loop). A plays; B pauses without rewinding; C steps backward; D steps forward.${s.note ? ` ${s.note}` : ''}`,
    name: s.name, color: s.color, app: s.app || 'moshpit', followWorkspace: s.followWorkspace === true, ...(s.stripGestures === false ? { stripGestures: false } : {}), pages, everyPage,
  }
}

// ---- an app driven by its keyboard shortcuts ----------------------------------------------------------
// The spec writes each workspace page's keys, dials and wheel as they are; "every" holds keys / dials / wheel shared
// by every page; "transport" { a, b, c, d } and "undo", "redo", "save" are actions ({ "keys": "space" }); "buttons"
// any further global buttons (keyboard, enter). A workspace's "enter" is the shortcut that opens it in the app.
function makeKeysProfile(s) {
  const tr = s.transport || {}
  const extra = { ...(s.save ? { save: { do: s.save } } : {}), ...(s.undo ? { undo: { do: s.undo, ...(s.redo ? { hold: s.redo } : {}) } } : {}), ...(s.buttons || {}) }
  const pages = [homePage(s), ...s.workspaces.map((w) => ({ name: w.page, ...(w.enter ? { enter: w.enter } : {}), keys: w.keys || {}, ...(w.dials ? { dials: w.dials } : {}), ...(w.wheel ? { wheel: w.wheel } : {}) }))]
  const every = s.every || {}
  const everyPage = { ...(every.keys ? { keys: every.keys } : {}), ...(every.dials ? { dials: every.dials } : {}), ...(every.wheel ? { wheel: every.wheel } : {}), buttons: globalButtons(tr, extra) }
  const gaps = unmapped(tr)
  return {
    _help: `${s.name}: ${s.toe}. Generated by scripts/make-rig-profile.mjs from config/rigs/ - edit that, not this. The CT profile standard: ` +
      `round 2 HOME (apps, MAIN, a key per workspace), then ${s.workspaces.map((w, i) => `round ${i + 3} ${w.page}${w.enter ? ` (${w.enter.keys})` : ''}`).join(', ')}. ` +
      `${tHelp(tr)}${gaps.length ? ` ${gaps.join(', ')} wait for the app's own shortcut to be confirmed.` : ''} Home button = MAIN` +
      `${s.undo ? `; undo = ${s.undo.keys}${s.redo ? ` (hold: ${s.redo.keys})` : ''}` : ''}${s.save ? `; save = ${s.save.keys}` : ''}.${s.note ? ` ${s.note}` : ''}`,
    name: s.name, color: s.color, app: s.app, pages, everyPage,
  }
}

// ---- a TD rig -----------------------------------------------------------------------------------------
// The TD page layout (docs/REMAP.md). Keys as the CT shows them, 1 to 12 (the JSON says "0"-"11"):
//   key 1     this page's switch: the block on/off (on Source: the source's own toggle, e.g. UNPAD)
//   key 2     RESET: this page's dials back to their defaults
//   key 3     VIEW: the output window                                          (every page)
//   key 4     FX RESET: the block's Reset pulse, when the block has one
//   keys 5-10 the six blocks on/off, lit when on                                 (every page)
//   keys 11/12 previous / next clip                                              (every page)
//   dials TL/CL/BL  the page's three parameters (press: reset); Source's BL steps the clip
//   wheel     output level (Master), tap: full                                    (every page)
//   save      REC                                                                 (every page)
//   C / D     previous / next clip; A / B wait for a TD play / stop verb (CT_RIG has none)
// Round 2 is Source, rounds 3-8 the blocks in chain order.
const td = (type, x = {}) => ({ td: { type, ...x } })
const knob = (name, par) => par === 'clip' ? { name, turn: td('rigClipStep') } : { name, turn: td('rigKnob', { par }), press: td('rigReset', { par }) }
const reset = (pars) => ({ label: 'RESET', color: 'dust', icon: 'reset', sub: 'DIAL', do: { macro: pars.map((par) => td('rigReset', { par })) } })
const POS = ['TL', 'CL', 'BL']
function makeTdProfile(s) {
  if (s.blocks.length > 6) throw new Error(`${s.name}: ${s.blocks.length} blocks; the layout has six (keys 5-10, rounds 3-8)`)
  const dials = (list) => Object.fromEntries(list.map(([n, par], i) => [POS[i], knob(n, par)]))
  const knobs = (list) => list.map(([, par]) => par).filter((p) => p !== 'clip')
  const src = s.source
  const onKey = (b) => ({ label: b.label, icon: b.icon, sub: 'ON', do: td('rigToggle', { par: b.on }) })
  const pages = [{
    name: 'Source',
    keys: { 0: { label: src.key.label, color: src.key.color, icon: src.key.icon, sub: src.key.sub, do: td('rigToggle', { par: src.key.par }) }, 1: reset(knobs(src.dials)) },
    dials: dials(src.dials),
  }]
  for (const b of s.blocks) {
    const keys = { 0: onKey(b), 1: reset(knobs(b.dials)) }
    if (b.pulse) keys[3] = { label: 'FX RESET', color: 'dust', icon: 'reset', sub: 'FX', do: td('rigPulse', { par: b.pulse }) }
    pages.push({ name: b.page, keys, dials: dials(b.dials) })
  }
  const tr = { a: null, b: null, c: td('rigClipStep', { step: -1 }), d: td('rigClipStep', { step: 1 }) }
  const everyPage = {
    keys: {
      2: { label: 'VIEW', color: 'bone', icon: 'view', sub: 'WIN', do: td('rigView') },
      ...Object.fromEntries(s.blocks.map((b, i) => [4 + i, onKey(b)])),
      10: { label: 'CLIP -', color: 'bone', icon: 'back', sub: 'CLIP', do: td('rigClipStep', { step: -1 }) },
      11: { label: 'CLIP +', color: 'bone', icon: 'forward', sub: 'CLIP', do: td('rigClipStep', { step: 1 }) },
    },
    buttons: globalButtons(tr, { save: { do: td('recordToggle') } }),
    wheel: { turn: td('rigKnob', { par: 'Master' }), tap: td('rigReset', { par: 'Master' }) },
  }
  const order = ['Source', ...s.blocks.map((b) => b.page)].map((n, i) => `${i + 2} ${n}`).join(', ')
  return {
    _help: `${s.name}: ${s.toe}. Generated by scripts/make-rig-profile.mjs from config/rigs/ - edit that, not this. Rounds: ${order}. ` +
      `The TD page layout (docs/REMAP.md): key 1 = this page's switch, key 2 = reset its dials, key 3 = VIEW, key 4 = FX RESET where the block has one, ` +
      'keys 5-10 = the six blocks on/off (lit when on), keys 11/12 = previous / next clip. Dials TL/CL/BL = the page\'s parameters, press to reset. ' +
      `Wheel = output level (tap: full); save = REC. ${tHelp(tr)} A and B wait for a TD play / stop verb. Home button = MAIN (no HOME page: the rig's seven pages fill the rounds).${s.note ? ` ${s.note}` : ''}`,
    name: s.name, color: s.color, app: s.app || 'touchdesigner', pages, everyPage,
  }
}

export function makeRigProfile(s) {
  if (s.target === 'moshpit') return makeMoshpitProfile(s)
  if (s.target === 'keys') return makeKeysProfile(s)
  return makeTdProfile(s)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  for (const id of process.argv.slice(2).filter(a => a !== '--replace')) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Profile ids use lowercase letters, digits and -')
    const p = makeRigProfile(JSON.parse(fs.readFileSync(new URL(`../config/rigs/${id}.json`, import.meta.url), 'utf8')))
    const ids = fs.readdirSync(new URL('../config/profiles/', import.meta.url)).map((f) => f.replace(/\.json$/, ''))
    const apps = JSON.parse(fs.readFileSync(new URL('../config/apps.json', import.meta.url), 'utf8'))
    const bad = checkProfile(p, ids, apps)
    if (bad.length) { console.log(`${id}: not written:\n  ${bad.join('\n  ')}`); process.exitCode = 1; continue }
    const result = writeGeneratedProfile(fileURLToPath(new URL(`../config/profiles/${id}.json`, import.meta.url)), pretty(p) + '\n', { replace: process.argv.includes('--replace') })
    if (result === 'candidate') { console.log(`${id}: existing profile preserved; inspect config/.generated/${id}.json, then use --replace to adopt it (keeps history)`); process.exitCode = 1; continue }
    console.log(`${id}: ${p.pages.length} pages, ${p.pages.reduce((a, g) => a + Object.keys(g.keys || {}).length, 0) + Object.keys(p.everyPage.keys || {}).length} keys written`)
  }
}
