// Moves every control that is identical on all of a profile's pages into its "everyPage" block, so a shared
// key (VIEW, the six on/off keys, the wheel, REC) is written once. The CT plays the same thing afterwards:
// host/profiles.mjs pageOf() merges everyPage back under each page. The status page is never touched.
//   node scripts/share-common.mjs mega template      rewrites config/profiles/<id>.json (backups: config/_backup-*)
import fs from 'node:fs'
import { pretty, pageOf } from '../host/profiles.mjs'

export function shareCommon(p) {
  const pages = p.pages.filter((g) => !g.status)
  if (pages.length < 2) return p
  const out = structuredClone(p), ep = out.everyPage = out.everyPage || {}
  const same = (get) => { const v = pages.map((g, i) => JSON.stringify(get(pageOf(p, p.pages.indexOf(g))))); return v[0] !== undefined && v.every((x) => x === v[0]) ? JSON.parse(v[0]) : undefined }
  for (const s of ['keys', 'dials', 'buttons']) {
    const slots = new Set(pages.flatMap((g, i) => Object.keys(pageOf(p, p.pages.indexOf(g))[s] || {})))
    for (const k of slots) {
      const v = same((g) => (g[s] || {})[k])
      if (v === undefined) continue
      ep[s] = { ...ep[s], [k]: v }
      for (const g of out.pages) if (!g.status && g[s]) { delete g[s][k]; if (!Object.keys(g[s]).length) delete g[s] }
    }
  }
  const w = same((g) => g.wheel)
  if (w !== undefined) { ep.wheel = w; for (const g of out.pages) delete g.wheel }
  if (!Object.keys(ep).length) delete out.everyPage
  return out
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  for (const id of process.argv.slice(2)) {
    const f = new URL(`../config/profiles/${id}.json`, import.meta.url)
    const p = JSON.parse(fs.readFileSync(f, 'utf8'))
    const q = shareCommon(p)
    // the proof: every page plays exactly as before
    const canon = (v) => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)
    p.pages.forEach((_, i) => { if (canon(pageOf(p, i)) !== canon(pageOf(q, i))) throw new Error(`${id} page ${i} would change`) })
    const n = (x) => x.pages.reduce((a, g) => a + Object.keys(g.keys || {}).length, 0) + Object.keys(x.everyPage?.keys || {}).length
    fs.writeFileSync(f, pretty(q) + '\n')
    console.log(`${id}: ${n(p)} keys written -> ${n(q)}; everyPage holds ${Object.entries(q.everyPage || {}).map(([s, v]) => s === 'wheel' ? 'the wheel' : `${Object.keys(v).length} ${s}`).join(', ') || 'nothing'}`)
  }
}
