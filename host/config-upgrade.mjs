// Shipped defaults and user mappings have different owners. Only a file still equal
// to its last shipped baseline may be upgraded automatically. No baseline means
// unknown ownership: preserve it, even when an old release probably generated it.
import fs from 'node:fs'
import { readParkingRegistry } from './parking.mjs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const read = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
const same = (a, b) => a !== null && b !== null && JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b))
function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, file) }
  finally { fs.rmSync(tmp, { force: true }) }
}
const equal = (a, b) => { try { return same(a, b) } catch { return false } }

export function upgradeConfig({ shipped, user, version = 'development' }) {
  if (path.resolve(shipped) === path.resolve(user)) throw new Error('Shipped and user configuration must be separate directories')
  // Build and parse the complete plan before the first write. Only application
  // defaults are eligible; history, private configuration and backups are not.
  const registry = readParkingRegistry(user)
  const files = ['apps.json', 'settings.json']
  for (const dir of ['profiles', 'rigs']) if (fs.existsSync(path.join(shipped, dir)))
    for (const f of fs.readdirSync(path.join(shipped, dir)).sort()) if (/^[a-z0-9-]+\.json$/.test(f)) files.push(`${dir}/${f}`)
  const plan = files.filter(f => fs.existsSync(path.join(shipped, f))).map(file => {
    let incoming = read(path.join(shipped, file))
    const parsed = JSON.parse(incoming)
    const id = path.basename(file, '.json')
    const parked = file.startsWith('profiles/') && (registry.profiles.includes(id) || registry.apps.includes(parsed.app)) || file.startsWith('rigs/') && (registry.rigs.includes(id) || registry.apps.includes(parsed.app))
    if (file === 'apps.json') { for (const id of registry.apps) delete parsed[id]; incoming = JSON.stringify(parsed, null, 2) + '\n' }
    const current = read(path.join(user, file)), baseline = read(path.join(user, '.shipped', file))
    const status = parked ? 'parked' : current === null ? 'added' : equal(current, incoming) ? 'current' : equal(current, baseline) ? 'updated' : 'preserved'
    return { file, incoming, current, status }
  })
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  for (const p of plan) {
    if (p.status === 'parked') continue
    if (p.status === 'updated') atomic(path.join(user, '.upgrade-history', stamp, p.file), p.current)
    if (p.status === 'added' || p.status === 'updated') atomic(path.join(user, p.file), p.incoming)
    // A candidate never loads as a profile until the user deliberately adopts it.
    // Clear obsolete candidates when the user has adopted this shipped default.
    const candidate = path.join(user, '.updates', 'incoming', p.file)
    if (p.status === 'preserved') atomic(candidate, p.incoming)
    else fs.rmSync(candidate, { force: true })
    atomic(path.join(user, '.shipped', p.file), p.incoming)
  }
  const report = { version, checked: new Date().toISOString(), files: plan.map(({ file, status }) => ({ file, status })) }
  atomic(path.join(user, '.updates', 'report.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}
