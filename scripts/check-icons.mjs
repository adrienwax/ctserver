// Offline only: numeric renderer parity + scratch owner files; no router/device/installed config.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ICONS } from '../host/schema.mjs'
import { loadIcons, saveIcon, prepareIconFolder } from '../host/icon-library.mjs'
import { parseIconSvg, iconSvg, validateLines } from '../ui/icon-model.mjs'
import { glyphLines, GLYPH_NAMES, setGlyphs, renderKeys, toRgb565 } from '../integrations/ct-td-control/ct-draw.mjs'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'waxyct-icons-test-'))
let checks = 0
const test = (name, fn) => { fn(); checks++; console.log(`ok ${name}`) }
try {
  test('all 37 defaults match the existing device geometry to SVG numeric precision', () => {
    assert.deepEqual(ICONS, GLYPH_NAMES)
    const { icons } = loadIcons(temp)
    for (const name of ICONS) {
      const source = glyphLines(name), saved = icons[name].lines
      assert.equal(saved.length, source.length, name)
      source.forEach((line, i) => { assert.equal(saved[i].length, line.length); line.forEach((point, j) => point.forEach((n, k) => assert(Math.abs(n - saved[i][j][k]) <= .000051, name))) })
      assert.deepEqual(parseIconSvg(iconSvg(saved)), saved)
    }
  })
  test('custom SVG changes device pixels; reset returns the original device buffer', () => {
    const keys = [{ label: 'PLAY', glyph: 'play', color: '#ffffff' }]
    setGlyphs(loadIcons(temp).icons)
    const before = toRgb565(renderKeys(keys))
    saveIcon(temp, 'play', [[[-8, -8], [8, 8]], [[8, -8], [-8, 8]]])
    const custom = loadIcons(temp); assert.equal(custom.icons.play.source, 'custom')
    setGlyphs(custom.icons); assert.notDeepEqual(toRgb565(renderKeys(keys)), before)
    const reset = saveIcon(temp, 'play', null, true)
    assert(fs.existsSync(reset.backup)); assert.equal(reset.icons.play.source, 'default')
    setGlyphs(reset.icons); assert.deepEqual(toRgb565(renderKeys(keys)), before)
  })
  test('editing and reset each preserve the previous owner SVG in a separate backup', () => {
    const first = [[[-2, -2], [2, 2]]], second = [[[-3, 3], [3, -3]]]
    saveIcon(temp, 'home', first)
    const changed = saveIcon(temp, 'home', second)
    assert.deepEqual(parseIconSvg(fs.readFileSync(changed.backup, 'utf8')), first)
    const reset = saveIcon(temp, 'home', null, true)
    assert.notEqual(changed.backup, reset.backup)
    assert.deepEqual(parseIconSvg(fs.readFileSync(reset.backup, 'utf8')), second)
  })
  test('invalid owner artwork falls back visibly and never modifies its original file', () => {
    const file = path.join(temp, 'icons', 'play.svg'), invalid = '<svg><script>alert(1)</script></svg>'
    fs.writeFileSync(file, invalid)
    const data = loadIcons(temp).icons.play
    assert.equal(data.source, 'default'); assert(data.error); assert.equal(fs.readFileSync(file, 'utf8'), invalid)
  })
  test('allowlisted icon names prevent path traversal or arbitrary file replacement', () => {
    for (const name of ['../settings', 'C:/outside', 'play.svg', 'constructor', '', null]) assert.throws(() => saveIcon(temp, name, [[[-1, 0], [1, 0]]]))
    assert(!fs.existsSync(path.join(temp, 'settings.svg')))
  })
  test('canonical parser rejects markup, nonfinite points, large geometry and outside points', () => {
    const good = iconSvg([[[-1, 0], [1, 0]]])
    for (const text of [good.replace('</svg>', '<script>alert(1)</script></svg>'), good.replace('points="', 'onclick="evil" points="'), good.replace('-1,0', 'NaN,0'), good.replace('-1,0', '999,0')]) assert.throws(() => parseIconSvg(text))
    assert.throws(() => validateLines([[[Infinity, 0], [0, 0]]]))
    assert.throws(() => validateLines(Array.from({ length: 513 }, () => [[0, 0], [1, 1]])))
  })
  test('opening the editable folder preserves existing custom and even invalid owner files', () => {
    const file = path.join(temp, 'icons', 'play.svg'), before = fs.readFileSync(file, 'utf8')
    prepareIconFolder(temp)
    assert.equal(fs.readFileSync(file, 'utf8'), before)
    assert(fs.existsSync(path.join(temp, 'icons', 'README.md')))
    assert.equal(fs.readdirSync(path.join(temp, 'icons')).filter(n => n.endsWith('.svg')).length, ICONS.length)
  })
  test('symbolic icon directories cannot redirect writes outside owner config', () => {
    const owner = path.join(temp, 'link-owner'), outside = path.join(temp, 'outside')
    fs.mkdirSync(owner); fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(owner, 'icons'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => saveIcon(owner, 'play', [[[-1, 0], [1, 0]]]), /regular folder/)
    assert.equal(fs.readdirSync(outside).length, 0)
  })
  console.log(`${checks} icon checks passed; device buffer math only, no CT opened`)
} finally { setGlyphs(); fs.rmSync(temp, { recursive: true, force: true }) }
