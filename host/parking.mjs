// Explicit, reversible owner-config operation. Runtime loading and upgrades consult the
// registry; archived JSON is never executable configuration. No automatic migration.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const ID = /^[a-z0-9-]+$/
const digest = data => createHash('sha256').update(data).digest('hex')
const read = file => fs.existsSync(file) ? fs.readFileSync(file) : null
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => x === '..' || x === '')) throw new Error(`Unsafe parked path: ${relative}`)
  const result = path.resolve(root, relative)
  if (!result.startsWith(path.resolve(root) + path.sep)) throw new Error(`Path escapes configuration: ${relative}`)
  // Never follow an owner-created symlink/junction out of the configuration root.
  let current = path.resolve(root)
  for (const part of relative.split(/[\\/]/)) { current = path.join(current, part); if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked parked path: ${relative}`) }
  return result
}
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try { fs.writeFileSync(temp, data); fs.renameSync(temp, file) } finally { fs.rmSync(temp, { force: true }) }
}
export function readParkingRegistry(dir) {
  const file = path.join(dir, 'parked', 'registry.json')
  const r = fs.existsSync(file) ? json(file) : { version: 1, apps: [], profiles: [], rigs: [], operations: [] }
  if (r.version !== 1 || !['apps', 'profiles', 'rigs', 'operations'].every(k => Array.isArray(r[k]) && r[k].every(id => typeof id === 'string' && ID.test(id)))) throw new Error('Invalid parking registry; repair parked/registry.json before loading controls')
  return r
}
export function isProfileParked(dir, id, profile, registry = readParkingRegistry(dir)) {
  return registry.profiles.includes(id) || (typeof profile?.app === 'string' && registry.apps.includes(profile.app))
}
export const isAppParked = (dir, id) => readParkingRegistry(dir).apps.includes(id)
export function activeProfileFiles(dir, registry = readParkingRegistry(dir)) {
  const folder = path.join(dir, 'profiles')
  return (fs.existsSync(folder) ? fs.readdirSync(folder) : []).filter(f => /^[a-z0-9-]+\.json$/.test(f)).filter(f => {
    let p; try { p = json(path.join(folder, f)) } catch {}
    return !isProfileParked(dir, f.slice(0, -5), p, registry)
  })
}
function cleanReferences(value, apps, profiles) {
  if (!value || typeof value !== 'object') return value
  if (typeof value.app === 'string' && apps.includes(value.app) && !value.pages || typeof value.switch === 'string' && profiles.includes(value.switch)) return undefined
  if (Array.isArray(value)) return value.map(v => cleanReferences(v, apps, profiles)).filter(v => v !== undefined)
  const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanReferences(v, apps, profiles)]).filter(([, v]) => v !== undefined))
  if (Object.hasOwn(value, 'do') && !out.do) return undefined
  if ((Object.hasOwn(value, 'turn') || Object.hasOwn(value, 'press')) && !out.turn && !out.press) return undefined
  if (Array.isArray(out.macro) && !out.macro.length) return undefined
  return out
}
export function planParking(dir, { apps = [], profiles = [], operation = `park-${Date.now()}` } = {}) {
  if (![...apps, ...profiles, operation].every(id => ID.test(id)) || profiles.includes('main')) throw new Error('Invalid parking id (Home cannot be parked)')
  const registry = readParkingRegistry(dir), allApps = json(path.join(dir, 'apps.json'))
  if (apps.some(id => registry.apps.includes(id)) || profiles.some(id => registry.profiles.includes(id))) throw new Error('An app/profile is already parked; restore its existing operation before parking it again')
  const selected = new Set(profiles), changes = [], dependencies = [{ path: 'apps.json', before: read(path.join(dir, 'apps.json')) }]
  for (const folder of ['profiles', '.lastgood']) {
    if (!fs.existsSync(path.join(dir, folder))) continue
    for (const file of fs.readdirSync(path.join(dir, folder)).filter(f => /^[a-z0-9-]+\.json$/.test(f))) {
      let p; try { p = json(path.join(dir, folder, file)) } catch {}
      if (apps.includes(p?.app)) selected.add(file.slice(0, -5))
    }
  }
  const ids = [...selected].filter(id => id !== 'main').sort()
  const add = (relative, after = null) => { const before = read(inside(dir, relative)); if (before && (!after || !before.equals(after))) changes.push({ path: relative, before, after }) }
  for (const folder of ['profiles', '.lastgood', 'rigs', '.generated', '.shipped/profiles', '.shipped/rigs', '.updates/incoming/profiles', '.updates/incoming/rigs']) {
    for (const id of ids) add(`${folder}/${id}.json`)
  }
  // History and icon overrides remain in place, with exact archive copies. Restoration
  // never overwrites these shared dependencies or a newer owner history entry.
  for (const folder of ['.history', 'icons']) if (fs.existsSync(path.join(dir, folder))) {
    const walk = (relative) => { for (const entry of fs.readdirSync(inside(dir, relative), { withFileTypes: true })) {
      const f = `${relative}/${entry.name}`; inside(dir, f)
      if (entry.isDirectory()) walk(f)
      else if (folder === 'icons' || ids.some(id => entry.name.startsWith(`${id}-`))) dependencies.push({ path: f, before: read(inside(dir, f)) })
    } }; walk(folder)
  }
  // Disable cross-profile links in both live files and their recovery copies.
  for (const folder of ['profiles', '.lastgood']) if (fs.existsSync(path.join(dir, folder))) {
    for (const f of fs.readdirSync(path.join(dir, folder)).filter(f => /^[a-z0-9-]+\.json$/.test(f) && !ids.includes(f.slice(0, -5)))) {
      let p; try { p = json(path.join(dir, folder, f)) } catch { continue }
      const next = cleanReferences(p, apps, ids)
      if (JSON.stringify(p) !== JSON.stringify(next)) add(`${folder}/${f}`, bytes(next))
    }
  }
  const entries = Object.fromEntries(apps.filter(id => allApps[id]).map(id => [id, allApps[id]]))
  return { operation, apps: [...new Set(apps)], profiles: ids, entries, changes, dependencies, registry }
}
export function parkConfig(dir, options = {}) {
  const p = planParking(dir, options), folder = inside(dir, `parked/${p.operation}`)
  if (fs.existsSync(folder) || p.registry.operations.includes(p.operation)) throw new Error(`Parking operation already exists: ${p.operation}`)
  const manifest = { version: 1, operation: p.operation, created: new Date().toISOString(), apps: p.apps, profiles: p.profiles, entries: p.entries,
    files: p.changes.map(c => ({ path: c.path, sha256: digest(c.before), afterSha256: c.after ? digest(c.after) : null })),
    dependencies: p.dependencies.map(c => ({ path: c.path, sha256: digest(c.before) })) }
  for (const c of [...p.changes, ...p.dependencies]) atomic(inside(folder, `files/${c.path}`), c.before)
  atomic(inside(folder, 'manifest.json'), bytes(manifest))
  // Registry first: an interrupted mutation fails closed instead of resurrecting files.
  const registry = { version: 1, apps: [...new Set([...p.registry.apps, ...p.apps])], profiles: [...new Set([...p.registry.profiles, ...p.profiles])], rigs: [...new Set([...p.registry.rigs, ...p.profiles])], operations: [...p.registry.operations, p.operation] }
  atomic(path.join(dir, 'parked', 'registry.json'), bytes(registry))
  const apps = json(path.join(dir, 'apps.json'))
  for (const id of p.apps) delete apps[id]
  atomic(path.join(dir, 'apps.json'), bytes(apps))
  for (const c of p.changes) { const file = inside(dir, c.path); if (c.after) atomic(file, c.after); else fs.rmSync(file, { force: true }) }
  return manifest
}
export function restoreParked(dir, operation) {
  if (!ID.test(operation)) throw new Error('Invalid parking operation')
  const registry = readParkingRegistry(dir)
  if (!registry.operations.includes(operation)) throw new Error('Parking operation is not active')
  const folder = inside(dir, `parked/${operation}`), m = json(inside(folder, 'manifest.json')), apps = json(path.join(dir, 'apps.json'))
  if (m.version !== 1 || m.operation !== operation || !Array.isArray(m.files) || !Array.isArray(m.dependencies)) throw new Error('Invalid parked manifest')
  for (const [id, entry] of Object.entries(m.entries)) {
    if (!ID.test(id) || (apps[id] && JSON.stringify(apps[id]) !== JSON.stringify(entry))) throw new Error(`Restore conflict: app ${id} has changed`)
  }
  const writes = []
  for (const f of [...m.files, ...m.dependencies]) {
    const archived = read(inside(folder, `files/${f.path}`)), current = read(inside(dir, f.path))
    if (!archived || digest(archived) !== f.sha256) throw new Error(`Archive checksum mismatch: ${f.path}`)
    const dependency = !Object.hasOwn(f, 'afterSha256')
    if (dependency && current) continue // shared artwork/history belongs to the current owner
    if (current && digest(current) !== f.sha256 && digest(current) !== f.afterSha256) throw new Error(`Restore conflict: ${f.path} has changed`)
    if (!current && f.afterSha256) throw new Error(`Restore conflict: ${f.path} was removed`)
    writes.push({ file: inside(dir, f.path), data: archived })
  }
  // All paths, hashes and collisions checked before any live write.
  for (const w of writes) atomic(w.file, w.data)
  atomic(path.join(dir, 'apps.json'), bytes({ ...apps, ...m.entries }))
  registry.apps = registry.apps.filter(id => !m.apps.includes(id)); registry.profiles = registry.profiles.filter(id => !m.profiles.includes(id)); registry.rigs = registry.rigs.filter(id => !m.profiles.includes(id)); registry.operations = registry.operations.filter(id => id !== operation)
  atomic(path.join(dir, 'parked', 'registry.json'), bytes(registry))
  return { operation, restored: writes.length, apps: Object.keys(m.entries) }
}
