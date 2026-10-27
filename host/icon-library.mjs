import fs from 'node:fs'
import path from 'node:path'
import { ICONS } from './schema.mjs'
import { iconSvg, parseIconSvg } from '../ui/icon-model.mjs'
const DEFAULTS = new URL('../ui/icons/', import.meta.url)
const known = name => { if (!ICONS.includes(name)) throw new Error('Choose a known icon from the library.'); return name }
function directory(root, leaf, create = false) {
  const full = path.join(root, leaf)
  if (fs.existsSync(full)) { if (fs.lstatSync(full).isSymbolicLink() || !fs.statSync(full).isDirectory()) throw new Error(`Icon directory must be a regular folder: ${leaf}`) }
  else if (create) fs.mkdirSync(full, { recursive: true })
  return full
}
function asset(root, name, create = false) {
  const file = path.join(directory(root, 'icons', create), known(name) + '.svg')
  if (fs.existsSync(file) && (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile())) throw new Error('Icon files must be regular SVG files.')
  return file
}
export function loadIcons(root) {
  const icons = {}
  for (const name of ICONS) {
    const lines = parseIconSvg(fs.readFileSync(new URL(name + '.svg', DEFAULTS), 'utf8'))
    icons[name] = { lines, source: 'default' }
    try {
      const file = asset(root, name)
      if (fs.existsSync(file)) icons[name] = { lines: parseIconSvg(fs.readFileSync(file, 'utf8')), source: 'custom' }
    } catch (error) { icons[name].error = error.message }
  }
  return { icons, folder: path.join(root, 'icons') }
}
export function saveIcon(root, name, lines, reset = false) {
  known(name)
  const svg = reset ? null : iconSvg(lines) + '\n' // validate before any filesystem changes
  const file = asset(root, name, true)
  let backup
  if (fs.existsSync(file)) {
    const history = directory(root, '.history', true), icons = directory(history, 'icons', true)
    backup = path.join(icons, `${name}-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.svg`)
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL)
  }
  if (reset) { if (fs.existsSync(file)) fs.unlinkSync(file) }
  else {
    const tmp = file + `.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    try { fs.writeFileSync(tmp, svg, { flag: 'wx' }); fs.renameSync(tmp, file) }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) }
  }
  return { ok: true, backup, ...loadIcons(root) }
}
/** Copy missing defaults only; the owner's existing icons are never overwritten. */
export function prepareIconFolder(root) {
  const folder = directory(root, 'icons', true)
  for (const name of ICONS) {
    const file = asset(root, name)
    if (!fs.existsSync(file)) fs.copyFileSync(new URL(name + '.svg', DEFAULTS), file, fs.constants.COPYFILE_EXCL)
  }
  const guide = path.join(folder, 'README.md')
  if (!fs.existsSync(guide)) fs.copyFileSync(new URL('README.md', DEFAULTS), guide, fs.constants.COPYFILE_EXCL)
  return folder
}
