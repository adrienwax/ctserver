// End-to-end check of a TD rig profile against a live CT_RIG (its .toe open in TD), through the deck's own
// path: ct-td-map buildScript -> td-client exec on TD's port, exactly as host/deck-host.mjs runs a TD action.
//   node scripts/check-td-profile.mjs [id]   every key, dial (both ways + press), wheel and button on every page
//   NO_VIEW=1                                 skips VIEW, so no output window opens
// It reads CT_RIG before and after each action, says what moved, and puts every parameter back at the end.
// REC is started and stopped once, so one short test recording is left in REC_ctrl's folder.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pageOf } from '../host/profiles.mjs'

const BRIDGE = process.env.WAXYCT_BRIDGE || fileURLToPath(new URL('../integrations/ct-td-control/', import.meta.url))
const imp = (f) => import(pathToFileURL(path.join(BRIDGE, f)).href)
const { buildScript, RIG_STATE_PY, RIG } = await imp('ct-td-map.mjs')
const { makeTdClient } = await imp('td-client.mjs')
const tdCfg = JSON.parse(fs.readFileSync(path.join(BRIDGE, 'config.json'), 'utf8'))
const td = makeTdClient({ ...tdCfg.td, timeoutMs: 8000 })
const PROFILE = process.argv[2] || 'template'    // node scripts/check-td-profile.mjs mega   (NO_VIEW=1: never open the output window)
const prof = JSON.parse(fs.readFileSync(new URL(`../config/profiles/${PROFILE}.json`, import.meta.url), 'utf8'))
const settings = JSON.parse(fs.readFileSync(new URL('../config/settings.json', import.meta.url), 'utf8'))
const knobStep = settings.knobStep ?? 1

const exec = async (py) => { const r = await td.exec(py); if (!r || r.success === false) throw new Error(r ? r.error : 'no answer from TD'); return r.data.result }
const state = () => exec(RIG_STATE_PY)
const raw = () => exec(`_r=op('${RIG}')\nresult={p.name:p.eval() for p in _r.customPars if p.style!='Pulse'}`)
const recOn = () => exec(`result=bool(op('/project1/REC').par.record.eval())`)
const run = async (t, delta, step) => {
  const a = { ...t }
  if (/Knob$/.test(a.type)) a.delta = delta * knobStep
  if (/Step$/.test(a.type)) a.step = a.step ?? step
  await exec(buildScript(a, tdCfg.tdPaths, tdCfg.scaling, tdCfg.guards))
}
const acts = (x) => (x && x.macro ? x.macro.map((m) => m.td).filter(Boolean) : x && x.td ? [x.td] : [])
const diff = (a, b) => {
  const out = []
  if (a.clip !== b.clip) out.push(`clip ${a.clip}->${b.clip}`)
  for (const k in b.on) if (a.on[k] !== b.on[k]) out.push(`${k} ${a.on[k] ? 'on' : 'off'}->${b.on[k] ? 'on' : 'off'}`)
  for (const k in b.norm) if (Math.abs(a.norm[k] - b.norm[k]) > 1e-4) out.push(`${k} ${a.norm[k].toFixed(3)}->${b.norm[k].toFixed(3)}`)
  return out
}

const start = await raw()
const rows = []
let fails = 0
const check = async (where, t, how, expect) => {
  const before = await state()
  const r0 = t.type === 'recordToggle' ? await recOn() : null
  await how()
  const after = await state()
  const moved = diff(before, after)
  let ok, note
  if (t.type === 'recordToggle') { const r1 = await recOn(); ok = r1 !== r0; note = `REC ${r0 ? 'on' : 'off'}->${r1 ? 'on' : 'off'}` }
  else if (t.type === 'rigPulse') { ok = true; note = 'pulsed (TD took it)' }
  else if (t.type === 'rigView') { ok = moved.some((m) => m.startsWith('View')); note = moved.join(', ') }
  else { ok = expect(before, after, moved); note = moved.join(', ') || 'nothing moved' }
  if (!ok) fails++
  rows.push(`${ok ? 'ok  ' : 'FAIL'} ${where.padEnd(28)} ${t.type.padEnd(13)} ${note}`)
}

const buttonsDone = new Set()
for (const pg of prof.pages.map((_, i) => pageOf(prof, i))) {   // as the CT plays them: everyPage merged in
  for (const [n, k] of Object.entries(pg.keys || {})) for (const t of acts(k.do)) {
    if (t.type === 'rigView' && process.env.NO_VIEW) { rows.push(`skip ${`${pg.name} key ${n} ${k.label}`.padEnd(28)} rigView       (NO_VIEW: no window opened)`); continue }
    // a reset only shows if the value is away from its default first: nudge it, then press
    if (t.type === 'rigReset') await run({ type: 'rigKnob', par: t.par }, 6)
    await check(`${pg.name} key ${n} ${k.label}`, t, () => run(t), (b, a, m) =>
      t.type === 'rigClip' ? a.clip === t.n : t.type === 'rigToggle' ? a.on[t.par] !== b.on[t.par] : t.type === 'rigReset' ? m.some((x) => x.startsWith(t.par)) : m.length > 0)
    if (t.type === 'rigToggle' || t.type === 'rigView') await run(t)      // put a toggle back
  }
  for (const [d, dial] of Object.entries(pg.dials || {})) {
    for (const t of acts(dial.turn)) {
      if (t.type === 'rigKnob') {
        await run({ type: 'rigReset', par: t.par })
        await check(`${pg.name} dial ${d} ${dial.name} +`, t, () => run(t, 6), (b, a) => a.norm[t.par] > b.norm[t.par] || b.norm[t.par] >= 0.999)
        await check(`${pg.name} dial ${d} ${dial.name} -`, t, () => run(t, -12), (b, a) => a.norm[t.par] < b.norm[t.par] || b.norm[t.par] <= 0.001)
      } else await check(`${pg.name} dial ${d} ${dial.name}`, t, () => run(t, 0, 1), (b, a) => a.clip !== b.clip)
    }
    for (const t of acts(dial.press)) {
      await run({ type: 'rigReset', par: t.par })                            // from its default, nudged away, so the reset shows
      await run({ type: 'rigKnob', par: t.par }, (await state()).norm[t.par] > 0.9 ? -6 : 6)
      await check(`${pg.name} dial ${d} press`, t, () => run(t), (b, a, m) => m.some((x) => x.startsWith(t.par)))
    }
  }
  for (const t of acts(pg.wheel && pg.wheel.turn)) await check(`${pg.name} wheel turn`, t, () => run(t, -6), (b, a) => a.norm[t.par] < b.norm[t.par] || b.norm[t.par] <= 0.001)
  for (const t of acts(pg.wheel && pg.wheel.tap)) await check(`${pg.name} wheel tap`, t, () => run(t), (b, a) => a.norm[t.par] >= 0.999)
  for (const [b, btn] of Object.entries(pg.buttons || {})) for (const t of acts(btn.do)) {
    const key = `${b} ${JSON.stringify(t)}`                                  // a button shared by every page is tested once
    if (buttonsDone.has(key)) { rows.push(`same ${`${pg.name} button ${b}`.padEnd(28)} ${t.type.padEnd(13)} (as on the first page)`); continue }
    buttonsDone.add(key)
    await check(`${pg.name} button ${b}`, t, () => run(t), () => true)
    if (t.type === 'recordToggle') await run(t)                               // stop the test recording
  }
}
// everything back as it was
await exec(`import json\n_r=op('${RIG}')\n_v=json.loads(${JSON.stringify(JSON.stringify(start))})\nfor k,v in _v.items():\n    setattr(_r.par, k, v)\nresult=1`)   // JSON true/false are not Python: decode in TD
const end = await raw()
const back = Object.keys(start).every((k) => (typeof start[k] === 'number' ? Math.abs(start[k] - end[k]) < 1e-6 : start[k] === end[k]))
console.log(rows.join('\n'))
console.log(`\n${rows.length} actions, ${fails} failed; CT_RIG restored to its start values: ${back}`)
process.exit(fails || !back ? 1 : 0)
