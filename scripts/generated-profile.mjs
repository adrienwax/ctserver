import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// Generation is a developer operation, never a silent reset of someone's editor
// changes. A differing file produces a review candidate unless --replace is given.
export function writeGeneratedProfile(file, text, { replace = false } = {}) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  JSON.parse(text) // Never write a malformed generated candidate.
  try { if (old !== null && JSON.stringify(JSON.parse(old)) === JSON.stringify(JSON.parse(text))) return 'unchanged' } catch { /* preserve a malformed user file too */ }
  if (old !== null && !replace) {
    const candidate = path.join(path.dirname(file), '..', '.generated', path.basename(file))
    fs.mkdirSync(path.dirname(candidate), { recursive: true })
    fs.writeFileSync(candidate, text)
    return 'candidate'
  }
  if (old !== null) {
    const keep = path.join(path.dirname(file), '..', '.history', `${path.basename(file, '.json')}-generator-${Date.now()}-${randomUUID().slice(0, 8)}.json`)
    fs.mkdirSync(path.dirname(keep), { recursive: true })
    fs.writeFileSync(keep, old)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, file) }
  finally { fs.rmSync(tmp, { force: true }) }
  return old === null ? 'created' : 'replaced (previous version kept in .history)'
}
