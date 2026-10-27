// What a waxyct profile is made of: the one list of the CT's controls, colours, icons, actions, TD verbs and
// limits. host/profiles.mjs checks profiles against it, the deck plays them by it, and the panel reads it
// too (the router serves this file), so no list is ever copied. No Node imports: it runs in the page as well.

export const COLORS = { bone: '#f1e9da', lilac: '#c3b4e8', sky: '#9fd4cf', sage: '#b3d4a8', sand: '#e8c99a', peach: '#efb49a', rose: '#e8a9b8', dust: '#8f879f', teal: '#5ec9c0',
  // shared app accent colours
  coral: '#f08a63', cyan: '#46c7cf', orange: '#e8822e', magenta: '#d9609a', indigo: '#8f7af0', green: '#46c06a' }
// Each app accent's key face (tile) and the recess behind the keys (deep), from the same section: a profile in that
// colour draws its keys as section 5's tiles (glyph above, knocked-out label strip below). Moshpit coral, TD cyan,
// Blender orange, Resolve magenta, Ableton indigo, Bitwig green.
export const TILES = {
  coral: { tile: '#12141b', deep: '#0c0e13' }, cyan: { tile: '#0a1416', deep: '#06100f' }, orange: { tile: '#16110a', deep: '#0e0a05' },
  magenta: { tile: '#150b11', deep: '#0d0609' }, indigo: { tile: '#100d18', deep: '#09070f' }, green: { tile: '#0a140d', deep: '#060e08' },
}
export const KEY_SLOTS = Array.from({ length: 12 }, (_, i) => String(i))   // "0"-"11" in files; keys 1-12 to a person
export const DIALS = ['TL', 'CL', 'BL', 'TR', 'CR', 'BR']
export const bankLabel = (width, bank = 0) => (width === 6 ? ['P1-6', 'P7-8', 'LFO'] : ['P1-3', 'P4-6', 'LFO'])[bank] || (width === 6 ? 'P1-6' : 'P1-3')
export const BUTTONS = ['home', 'undo', 'keyboard', 'enter', 'save', 'fnL', 'a', 'b', 'c', 'd', 'e', 'fnR']
// the key icons ct-draw.mjs can draw (its GLYPH_NAMES; the profiles self-check keeps the two lists equal)
export const ICONS = ['more', 'back', 'clip', 'look', 'trails', 'melt', 'bloom', 'view', 'reset', 'rec', 'speed', 'layers',
  'home', 'source', 'mosh', 'node', 'render', 'forward', 'freeze', 'lfo', 'mark-in', 'mark-out', 'effect',
  'play', 'pause', 'stop', 'record', 'loop', 'undo', 'redo', 'save', 'add', 'delete', 'folder', 'settings', 'slice', 'import', 'volume', 'mute', 'scroll', 'desktop', 'tasks', 'keyboard', 'zoom']
export const ACTIONS = ['keys', 'media', 'volume', 'scroll', 'type', 'launch', 'focus', 'app', 'switch', 'page', 'td', 'moshpit', 'native', 'macro', 'main', 'home', 'none']

// Apps over profiles (config/apps.json). An app is a program the CT drives and how waxyct reaches it; a profile
// is one set of pages for one app. The target picks the route: TD verbs, the Moshpit adapter, Windows input,
// or a hand-off (the app opens the CT itself).
export const APP_TARGETS = ['td', 'moshpit', 'native', 'keys', 'handoff']
// current: on the CT and up front in the window. legacy: loaded and still runnable from the window, but kept off
// the CT and collapsed in the window. (Retired profiles are not loaded at all: config/_retired/.)
export const TIERS = ['current', 'legacy']

// The Moshpit v3 adapter (Route B: waxyct owns the CT; Moshpit serves a localhost WebSocket). An action names
// what it drives either by an absolute ControlTarget path (moshpit-v3 engine/src/model/control.ts) or relative
// to the active block: slot n (the nth node of the block's chain) and its param, by position (1-3) or ParamKey.
// Dials send raw detents; Moshpit applies each param's own step (engine/src/control/params.ts ControlWrite).
// "slot": "sel" is the slot the CT has selected (a select key sets it, per profile), so dials follow selection.
// "slot": "sel", "bank": 1-3 is the bank's nth control: the selected node's params 1-3, 4-6, or LFO 1's period and phase.
// A page's "enter" is an action run when the CT lands on that page: a Moshpit page switches Moshpit's workspace.
export const MOSHPIT_VERBS = {
  knob: { name: 'Turn a Moshpit parameter', trig: 'turn' },
  reset: { name: 'Reset a Moshpit parameter', trig: 'press' },
  toggle: { name: 'Switch a Moshpit parameter', trig: 'press' },
  command: { name: 'Moshpit command', trig: 'press' },
  step: { name: 'Step with two commands', trig: 'turn' },
  select: { name: 'Select the slot the dials follow', trig: 'press' },
  // browsing knobs (EDENA's grammar: left dials browse, right dials edit), both CT-side cursors
  selstep: { name: 'Move the selection through the block', trig: 'any' },
  bank: { name: 'Choose the parameter page', trig: 'any' },
}
// A mirror of moshpit-v3 COMMANDS (engine/src/model/control.ts); scripts/check-moshpit-contract.mjs keeps it equal.
export const MOSHPIT_COMMANDS = [
  'transport.play', 'transport.stop', 'transport.loop', 'transport.prevFrame', 'transport.nextFrame',
  'mark.in', 'mark.out', 'block.prev', 'block.next', 'block.freeze', 'block.unfreeze',
  'workspace.browse', 'workspace.mosh', 'workspace.node', 'workspace.render', 'workspace.settings',
  'edit.undo', 'edit.redo',
  // M3 / M4 (docs/CT-PAR-PLAN.md), landed in Moshpit 9 Oct (152c75a)
  'clip.prev', 'clip.next', 'mark.in.nudgeBack', 'mark.in.nudgeForward', 'mark.out.nudgeBack', 'mark.out.nudgeForward', 'render.start',
  'source.selectAll', 'source.sendA', 'source.sendB', 'source.addBlock',
  'mark.range.nudgeBack', 'mark.range.nudgeForward', 'folder.prev', 'folder.next', 'source.zoomOut', 'source.zoomIn', 'source.zoomFit',
]
// Commands waxyct already uses that Moshpit may not have yet: the contract check reports them as pending (and
// fails on them with --strict, the deploy gate); the adapter checks count a refusal of one as pending, not broken.
export const MOSHPIT_PENDING = []
export const MOSHPIT_PATH = /^\/(block\/[^/]+\/node\/[^/]+\/param\/[^/]+|lfo\/[^/]+\/(period|phase))$/
export const LIMITS = { label: 10, sub: 12, pages: 7 }   // a key label, its small line, a profile's pages (rounds 2-8)

// The TD verbs waxyct sends, all to CT_RIG (ct-td-control/ct-td-map.mjs builds them). `par` names a CT_RIG
// parameter (one capitalised word). The words are what the panel shows; `trig` is how the verb is used.
export const TD_VERBS = {
  rigKnob: { name: 'Turn a parameter', trig: 'turn', par: true },
  rigFrameStep: { name: 'Scrub source frames', trig: 'turn' },
  rigReset: { name: 'Reset a parameter', trig: 'press', par: true },
  rigToggle: { name: 'Switch on / off', trig: 'press', par: true },
  rigPulse: { name: 'Pulse (momentary)', trig: 'press', par: true },
  rigClip: { name: 'Play clip number', trig: 'press', n: true },
  rigClipStep: { name: 'Previous / next clip', trig: 'any' },
  rigView: { name: 'Output window', trig: 'press' },
  recordToggle: { name: 'Record (REC)', trig: 'press' },
}
export const TD_TYPES = Object.keys(TD_VERBS)

// A page as the CT plays it: the profile's everyPage underneath, the page's own controls on top.
export function pageOf(p, i) {
  const pg = (p.pages || [])[i], ep = p.everyPage
  if (!pg || pg.status || !ep) return pg
  const out = { ...pg }
  for (const s of ['keys', 'dials', 'buttons']) if (ep[s] || pg[s]) out[s] = { ...ep[s], ...pg[s] }
  if (ep.wheel || pg.wheel) out.wheel = pg.wheel || ep.wheel
  return out
}

// Shared physical-display palette; bitmap and desktop SVG consume these named tokens.
export const CONTROL_DISPLAY_COLORS = Object.freeze({face:'#171e28',ink:'#f1e9da',quiet:'#8998ad',on:'#bde8be',off:'#303b4c',unavailable:'#293140',plain:'#566277',selection:'#e8a9b8'})
