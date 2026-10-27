// One-shot, safe to run twice: profiles that carry the pre-v3 inline app ("app": { "exe": ... }) or none get
// a reference to an app in config/apps.json instead. MAIN stays app-less (it is the switchboard).
//   node scripts/migrate-apps.mjs           rewrites config/profiles/*.json (backups: config/_backup-*)
// The match: the same exe, else a profile whose id is an app's id (windows). A hand-off flag is dropped when
// the app's target is "handoff", since the app says so now.
import fs from 'node:fs'
import { pretty } from '../host/profiles.mjs'

const dir = new URL('../config/', import.meta.url)
const apps = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(new URL('apps.json', dir), 'utf8'))).filter(([id]) => !id.startsWith('_')))
for (const f of fs.readdirSync(new URL('profiles/', dir)).filter((x) => x.endsWith('.json'))) {
  const id = f.slice(0, -5), file = new URL(`profiles/${f}`, dir)
  const p = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (id === 'main' || typeof p.app === 'string') { console.log(`${id}: unchanged`); continue }
  const exe = p.app && p.app.exe && p.app.exe.toLowerCase()
  const appId = Object.keys(apps).find((a) => exe && (apps[a].exe || '').toLowerCase() === exe) || (apps[id] ? id : null)
  if (!appId) { console.log(`${id}: no matching app, left as it is`); continue }
  const out = {}
  for (const [k, v] of Object.entries(p)) {
    if (k === 'app') continue
    if (k === 'handoff' && apps[appId].target === 'handoff') continue
    out[k] = v
    if (k === 'color' || (k === 'name' && !('color' in p))) out.app = appId
  }
  if (!('app' in out)) out.app = appId
  fs.writeFileSync(file, pretty(out) + '\n')
  console.log(`${id}: app ${appId}${p.handoff && apps[appId].target === 'handoff' ? ' (hand-off now comes from the app)' : ''}`)
}
