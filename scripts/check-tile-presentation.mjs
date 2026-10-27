// Offline raster contract; no router, device or installed configuration.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { renderKeys, toRgb565, rgb565ToPng, setGlyphs, keyTitle } from '../integrations/ct-td-control/ct-draw.mjs'

const skin = { tile: '#191e25', deep: '#101318' }
const base = { label: 'SEND A', glyph: 'import', color: '#53cdbb' }
const raster = key => toRgb565(renderKeys([key], skin))
const before = raster(base)
assert.deepEqual(raster({ ...base, sub: 'OLD BANNER' }), before, 'legacy sub metadata must not recreate the banner')
const renamed = raster({ ...base, label: 'SEND B' })
let changed = 0
for (let i = 0; i < before.length; i += 2) {
  if (before.readUInt16LE(i) === renamed.readUInt16LE(i)) continue
  const y = Math.floor(i / 2 / 360)
  assert(y >= 10 && y <= 22, `title pixels must stay above the icon (${y})`)
  changed++
}
assert(changed > 0)
assert.equal(keyTitle('SEND A'), 'SEND A')
assert(keyTitle('AN UNUSUALLY LONG OWNER LABEL').endsWith('..'))
assert.notDeepEqual(raster({ ...base, active: true }), before, 'active state needs a non-colour cue')
assert.notDeepEqual(raster({ ...base, dim: true }), before)
setGlyphs({ 'import': { lines: [[[-16, -16], [16, 16]], [[-16, 16], [16, -16]]] } })
const custom = raster(base), blank = toRgb565(renderKeys([], skin))
for (let y = 0; y < 270; y++) for (let x = 0; x < 360; x++) {
  if (x < 90 && y < 90) continue
  const offset = (y * 360 + x) * 2
  assert.equal(custom.readUInt16LE(offset), blank.readUInt16LE(offset), 'owner geometry must not spill into another key')
}
setGlyphs()
const names = ['volume', 'mute', 'scroll', 'desktop', 'tasks', 'keyboard', 'zoom']
const utilities = names.map(glyph => raster({ ...base, label: 'UTILITY', glyph }))
for (let i = 0; i < utilities.length; i++) for (let j = i + 1; j < utilities.length; j++) assert.notDeepEqual(utilities[i], utilities[j])
if (process.argv[2]) {
  const file = path.resolve(process.argv[2])
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const keys = [
    { label: 'MARK IN', glyph: 'mark-in', color: '#e8c99a' },
    { label: 'MARK OUT', glyph: 'mark-out', color: '#e8c99a' },
    { label: 'SEND A', glyph: 'import', color: '#53cdbb', active: true },
    { label: 'SEND B', glyph: 'import', color: '#53cdbb' },
    { label: 'ALL FRAMES', glyph: 'source', color: '#b3d4a8' },
    { label: 'FILES', glyph: 'folder', color: '#e8c99a' },
    { label: 'TASKS', glyph: 'tasks', color: '#b3d4a8' },
    { label: 'DESKTOP', glyph: 'desktop', color: '#53cdbb' },
    { label: 'VOLUME', glyph: 'volume', color: '#b3d4a8' },
    { label: 'ZOOM', glyph: 'zoom', color: '#e8c99a' },
    { label: 'SHORTCUT', glyph: 'keyboard', color: '#e8a9b8' },
    { label: 'UNAVAILABLE', glyph: 'mute', color: '#e8c99a', dim: true },
  ]
  fs.writeFileSync(file, rgb565ToPng(toRgb565(renderKeys(keys, skin)), 360, 270))
  console.log(`Offline RGB565 preview: ${file}`)
}
console.log('Tile raster checks passed: top titles, no sub banners, bounded owner glyphs, states and distinct utilities')
