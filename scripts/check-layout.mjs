// The layout check: what the profile checker cannot see because each control is valid on its own. A key with
// no label or an action-less label, a dial that turns but has no name, and a TD rig profile that leaves the
// TD page layout (docs/REMAP.md). Reads every profile as the CT plays it (everyPage merged in).
//   node scripts/check-layout.mjs [dir]      exits 1 on any problem
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pageOf } from '../host/schema.mjs'

const td = (c) => c && c.do && c.do.td
// icons that mean an action, never an effect: REC's ring is never an effect's icon
// (the Moshpit verbs count as the same kinds: its workspace is its view, block -/+ its previous / next)
const RESERVED = { rec: ['recordToggle'], view: ['rigView', 'moshpit:workspace', 'page'], back: ['rigClipStep', 'moshpit:prev'], more: ['rigClipStep', 'moshpit:next'], forward: ['rigClipStep', 'moshpit:next'], reset: ['rigReset', 'rigPulse', 'macro', 'moshpit:reset'] }
function verbOf(k) {
  const a=k.do?.native
  if(a){if(a.verb==='reset')return 'moshpit:reset';const c=a.command||'';return /^(workspace|page)\./.test(c)?'page':/\.(previous|prev|prevFrame)$/.test(c)?'moshpit:prev':/\.(next|nextFrame)$/.test(c)?'moshpit:next':null}
  const m = k.do && k.do.moshpit
  if (m) return m.verb === 'selstep' ? (m.step === -1 ? 'moshpit:prev' : 'moshpit:next') : m.verb === 'reset' ? 'moshpit:reset' : m.verb !== 'command' ? `moshpit:${m.verb}` : /^workspace\./.test(m.command) ? 'moshpit:workspace' : /\.prev/.test(m.command) ? 'moshpit:prev' : /\.next/.test(m.command) ? 'moshpit:next' : `moshpit:${m.command}`
  return k.do && k.do.macro ? 'macro' : k.do && k.do.page ? 'page' : td(k) ? td(k).type : null
}
export function checkLayout(id, p) {
  const out = [], bad = (where, what) => out.push(`${id} › ${where}: ${what}`)
  const rig = (p.pages || []).some((g) => !g.status && Object.values(pageOf(p, p.pages.indexOf(g)).keys || {}).some((k) => td(k)))
  ;(p.pages || []).forEach((_, i) => {
    const g = pageOf(p, i)
    if (!g || g.status) return
    for (const [n, k] of Object.entries(g.keys || {})) {
      if (!k.label && k.do && !k.do.none) bad(`${g.name} key ${Number(n) + 1}`, 'does something but shows no label')
      if (rig && td(k) && (!k.icon || !k.sub)) bad(`${g.name} key ${Number(n) + 1}`, 'a TD key needs an icon and a sub line')
      // a shortcut key is an action already; the reserved icons keep TD and Moshpit effects from wearing an action's shape
      const recipeView = p.layout === 'recipe-v1' && k.icon === 'view' && ((td(k)?.type === 'rigPulse' && td(k)?.par === 'View') || (td(k)?.type === 'rigPulse' && td(k)?.par === 'Toggleoutput'))
      const recipeSelection = p.layout === 'recipe-v1' && td(k)?.type === 'rigPulse' && ((k.icon === 'back' && td(k)?.par === 'Selectprev') || (k.icon === 'more' && td(k)?.par === 'Selectnext'))
      if (!recipeView && !recipeSelection && RESERVED[k.icon] && !(k.do && k.do.keys) && !RESERVED[k.icon].includes(verbOf(k))) bad(`${g.name} key ${Number(n) + 1}`, `the ${k.icon} icon is kept for ${RESERVED[k.icon].join(' / ')}`)
    }
    for (const [d, c] of Object.entries(g.dials || {})) if (c.turn && !c.name) bad(`${g.name} dial ${d}`, 'turns something but has no name on the strip')
    // Moshpit: A-D retain transport; the wheel may scrub frames and toggle play / pause.
    const tp = (x) => JSON.stringify(x || {}).match(/"transport\.[a-zA-Z]+"/)
    for (const [n, k] of Object.entries(g.keys || {})) if (tp(k.do) || tp(k.hold)) bad(`${g.name} key ${Number(n) + 1}`, 'transport belongs on the A / B / C / D buttons only')
    for (const [d, c] of Object.entries(g.dials || {})) if (tp(c.turn) || tp(c.press)) bad(`${g.name} dial ${d}`, 'transport belongs on the A / B / C / D buttons only')
    if (tp(g.wheel)) {
      const turn = g.wheel?.turn?.moshpit, tap = g.wheel?.tap?.moshpit
      if (!(g.wheel.turn?.native?.verb==='turn'&&g.wheel.tap?.native?.verb==='command'&&g.wheel.tap.native.command==='transport.toggle') && (turn?.verb !== 'step' || JSON.stringify(turn.commands) !== JSON.stringify(['transport.prevFrame', 'transport.nextFrame']) || tap?.verb !== 'command' || tap.command !== 'transport.loop')) bad(`${g.name} wheel`, 'transport wheel turns previous / next frame and taps play / pause (transport.loop)')
    }
    for (const [b, c] of Object.entries(g.buttons || {})) if ((tp(c.do) || tp(c.hold)) && !['a', 'b', 'c', 'd'].includes(b)) bad(`${g.name} button ${b}`, 'transport belongs on the A / B / C / D buttons only')
    if (!rig) return
    if (p.layout === 'recipe-v1') {
      if (p.stripGestures !== false || !p.rigIdentity) bad(g.name,'recipe pages need display-only strips and exact rig identity')
      if (g.enter) bad(g.name,'page entry must not activate a recipe or launch a project')
      for (const [button,par] of Object.entries({a:'Play',b:'Pause',c:'Stepback',d:'Stepforward'})) if (g.buttons?.[button]?.do?.td?.type !== 'rigPulse' || g.buttons[button].do.td.par!==par) bad(g.name,`${button} must remain ${par}`)
      if (g.wheel?.turn?.td?.type!=='rigFrameStep' || g.wheel?.tap?.td?.par!=='Playpause') bad(g.name,'wheel must scrub frames and toggle play/pause')
      if (g.keys?.['2']?.do?.td?.par!=='View' || g.keys?.['11']?.do?.td?.par!=='Toggleoutput') bad(g.name,'View and Output retain their standard positions')
      return
    }
    // the TD page layout: VIEW on key 3, previous / next clip on 11 / 12, the wheel is the level, save is REC
    const t = (n) => td((g.keys || {})[n]) || {}
    if (t('2').type !== 'rigView') bad(`${g.name} key 3`, 'is VIEW (rigView) on every TD page')
    if (t('10').type !== 'rigClipStep' || t('11').type !== 'rigClipStep') bad(`${g.name} keys 11 / 12`, 'are previous / next clip (rigClipStep) on every TD page')
    if (g.wheel?.turn?.td?.par !== 'Master') bad(`${g.name} wheel`, 'is the output level (rigKnob Master) on every TD page')
    if (g.buttons?.save?.do?.td?.type !== 'recordToggle') bad(`${g.name} save`, 'is REC (recordToggle) on every TD page')
    if (t('0').type !== 'rigToggle') bad(`${g.name} key 1`, "is the page's switch (rigToggle)")
  })
  return out
}

// one label, one icon: the same effect looks the same on every page of every profile
export function sameIcons(profs) {
  const seen = {}, out = []
  for (const [id, p] of Object.entries(profs)) (p.pages || []).forEach((_, i) => {
    const g = pageOf(p, i)
    for (const k of Object.values((g && !g.status && g.keys) || {})) {
      if (!k.label || !k.icon) continue
      const was = seen[k.label]
      if (was && was.icon !== k.icon) out.push(`${id} › ${k.label}: icon ${k.icon}, but ${was.icon} in ${was.id}; one label, one icon`)
      else if (!was) seen[k.label] = { icon: k.icon, id }
    }
  })
  return [...new Set(out)]
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2] || fileURLToPath(new URL('../config/profiles/', import.meta.url))
  const profs = Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]))
  const all = [...Object.entries(profs).flatMap(([id, p]) => checkLayout(id, p)), ...sameIcons(profs)]
  for (const l of all) console.log('LAYOUT', l)
  console.log(all.length ? `${all.length} layout problems` : 'layout ok: every key labelled, every dial named, TD profiles in the TD page layout, icons consistent')
  process.exitCode = all.length ? 1 : 0
}
