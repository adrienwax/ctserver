// Contrast check for the panel: every text-on-ground pair it uses, against WCAG AA (4.5:1 for text,
// 3:1 for the large state word and for non-text marks). Reads the suite tokens (ui/tokens.css, the HUD
// theme) and the panel's short names over them (ui/app.css :root), resolving var() and color-mix().
//   node check-contrast.mjs        prints each pair; exits 1 if any fails
import fs from 'node:fs'

const read = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')
// the tokens.css blocks that apply to the default (HUD) theme, then the panel's own :root; later wins
const blocks = [...read('./ui/tokens.css').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(m => /:root|\[data-theme\]|"hud"/.test(m[1]) && !/studio|heritage/.test(m[1])).map(m => m[2])
blocks.push(read('./ui/app.css').match(/\n:root \{([^}]*)\}/)[1])
const RAW = {}
for (const body of blocks) for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) RAW[m[1]] = m[2].trim()
const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const toHex = (c) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
function resolve(v, depth = 0) {
  if (depth > 20) throw new Error('token cycle at ' + v)
  v = v.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  let m = v.match(/^var\(--([\w-]+)\)$/)
  if (m) return RAW[m[1]] === undefined ? null : resolve(RAW[m[1]], depth + 1)
  m = v.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/)   // the one form the panel uses: color-mix(in srgb, A p%, B)
  if (m) { const a = resolve(m[1], depth + 1), b = resolve(m[3], depth + 1), p = m[2] / 100; return a && b && toHex(rgb(a).map((c, i) => c * p + rgb(b)[i] * (1 - p))) }
  return null
}
const T = Object.fromEntries(Object.keys(RAW).map(k => [k, resolve(RAW[k])]).filter(([, v]) => v))
const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [x, y] = [lum(T[a]), lum(T[b])].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// [foreground, background, minimum, where]
const PAIRS = [
  ...['ground', 'head', 'panel', 'raised'].flatMap(bg => [['ink', bg, 4.5, 'body text'], ['ink-2', bg, 4.5, 'secondary text'], ['ink-3', bg, 4.5, 'captions, headers']]),
  ['int-text', 'panel', 4.5, 'active state word'], ['int-text', 'head', 4.5, 'active view tab'],
  ['int-text', 'int-tint', 4.5, 'active tile, on segment'], ['int-text', 'int-wash', 4.5, 'hover'],
  ['txt-on-fill', 'fn-commit', 4.5, 'commit button (teal): Activate on CT, Replace, Check and save'],
  ['ok', 'panel', 4.5, 'ok verdict text'], ['ok', 'head', 4.5, 'chip'],
  ['warn', 'panel', 4.5, 'warning text'], ['warn', 'warn-tint', 4.5, 'warning alert head'], ['ink-2', 'warn-tint', 4.5, 'warning alert body'],
  ['busy', 'panel', 4.5, 'in-flight state word: connecting, reconnecting'], ['busy', 'warn-tint', 4.5, 'handing over tile'],
  ['bad', 'panel', 4.5, 'caution verdict text'], ['bad-text', 'panel', 4.5, 'caution state word'],
  ['bad-text', 'bad-tint', 4.5, 'error alert head'], ['ink-2', 'bad-tint', 4.5, 'error alert body'],
  ['bad-ink', 'bad', 4.5, 'destructive hover'], ['bad-text', 'raised', 4.5, 'destructive button (spec crimson on surface-3 is 4.16:1)'],
  ['int-text', 'int-wash', 4.5, 'info alert head'], ['ink-2', 'int-wash', 4.5, 'info alert body'],
  ['ink', 'raised', 4.5, 'owner badge'], ['ink-2', 'raised', 4.5, 'console source tag'], ['int-text', 'raised', 4.5, 'console tag: router'],
  ['ink', 'ground', 4.5, 'console text'], ['ink-3', 'ground', 4.5, 'console times'],
  ['ghost-text', 'panel', 4.5, 'a free control, a disabled button'], ['ghost-text', 'ground', 4.5, 'a disabled button on the ground'],
  ['txt-on-fill', 'ok', 4.5, 'replug step done mark'], ['txt-on-fill', 'warn', 4.5, 'profile warning badge'],
  ['fn-interactive', 'panel', 3, 'focus ring, selection (non-text)'], ['warn', 'panel', 3, 'glyph (non-text)'], ['bad', 'panel', 3, 'glyph (non-text)'], ['busy', 'panel', 3, 'glyph (non-text)'],
  ['fn-interactive', 'ground', 3, 'seen control border (non-text)'], ['txt-on-fill', 'fn-interactive', 4.5, 'label on the input flash'],
]

let fails = 0
for (const [fg, bg, min, where] of PAIRS) {
  if (!T[fg] || !T[bg]) { console.log(`MISSING token ${fg} or ${bg}`); fails++; continue }
  const r = ratio(fg, bg), ok = r >= min
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${fg} on ${bg}  - ${where}`)
}
console.log(fails ? `\n${fails} pair(s) below AA` : `\nall ${PAIRS.length} pairs clear AA`)
process.exit(fails ? 1 : 0)
