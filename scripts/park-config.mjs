// Explicit backend operation. Preview is the default; never touches installed config implicitly.
import path from 'node:path'
import { planParking, parkConfig, restoreParked } from '../host/parking.mjs'
const args = process.argv.slice(2), dir = args[0]
if (!dir || dir.startsWith('--')) throw new Error('Usage: node scripts/park-config.mjs <config-folder> [--apply] [--restore operation-id]')
const restore = args.indexOf('--restore'), options = { apps: ['blender', 'ableton', 'bitwig', 'edena'], profiles: ['moshpit-legacy'], operation: `unification-${Date.now()}` }
if (restore >= 0) {
  if (!args.includes('--apply')) throw new Error('Restore needs --apply after reviewing the parked manifest; changed owner files are never overwritten')
  console.log(JSON.stringify(restoreParked(path.resolve(dir), args[restore + 1]), null, 2))
} else if (args.includes('--apply')) console.log(JSON.stringify(parkConfig(path.resolve(dir), options), null, 2))
else { const p = planParking(path.resolve(dir), options); console.log(JSON.stringify({ preview: true, directory: path.resolve(dir), apps: p.apps, profiles: p.profiles, files: p.changes.map(c => ({ path: c.path, action: c.after ? 'repair references' : 'park' })), dependencies: p.dependencies.map(c => c.path) }, null, 2)) }
