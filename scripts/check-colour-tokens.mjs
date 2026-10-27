// Colour-token lint, ported from moshpit-v3 scripts/check-colour-tokens.mjs (DESIGN-SYSTEM.md §1).
//   node scripts/check-colour-tokens.mjs     exits 1 on a violation
// Rules:
//   1. Colour literals (hex, rgb(), hsl()) belong in ui/tokens.css, the synced suite tokens. The panel's
//      other files hold none, so there is no baseline: any literal there fails.
//   2. Crimson is caution only: in tokens.css a red-family literal may sit only on a caution primitive
//      (--p-crimson, --p-red), scope red channels or the shared named legacy image-art tokens.
// Not scanned: ui/icons and ui/icon-reference (artwork) and host/schema.mjs COLORS (the deck's own palette).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui')
const TOKENS = 'tokens.css'
const RED_OK = /--(p-crimson|p-red|scope-r|scope-panel-r|legacy-coral-a\d+)\s*:/
const LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\b(?:rgba?|hsla?)\([^)]*\)/g

function rgbOf(lit) {
  if (lit[0] === '#') {
    let h = lit.slice(1)
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  }
  const n = lit.match(/[\d.]+%?/g)
  if (!n || n.length < 3 || /var\(/.test(lit)) return null
  return n.slice(0, 3).map((v) => (v.endsWith('%') ? 2.55 * parseFloat(v) : parseFloat(v)))
}
// the same red window as Moshpit's: hue 335°-15°, saturation ≥ 0.35
function isRedFamily(lit) {
  const c = rgbOf(lit)
  if (!c) return false
  const [r, g, b] = c.map((v) => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const l = (max + min) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (s < 0.35 || l < 0.2 || l > 0.9) return false
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return h >= 335 || h < 15
}

const errors = []
let tokenLiterals = 0
for (const f of fs.readdirSync(UI).filter((f) => /\.(css|m?js|html)$/.test(f)).sort()) {
  fs.readFileSync(path.join(UI, f), 'utf8').split('\n').forEach((line, i) => {
    for (const [lit] of line.matchAll(LITERAL)) {
      if (!rgbOf(lit) && !lit.startsWith('#')) continue   // rgb(var(--x) / .5) and the like are token uses
      if (f !== TOKENS) errors.push(`ui/${f}:${i + 1}: colour literal ${lit}; use a token from ui/${TOKENS}`)
      else { tokenLiterals++; if (isRedFamily(lit) && !RED_OK.test(line)) errors.push(`ui/${f}:${i + 1}: red-family ${lit} outside a caution primitive`) }
    }
  })
}
// the self-check: the red window still catches the old salmon --bad and leaves Moshpit's coral alone
if (!isRedFamily('#f07a72') || isRedFamily('#f08a63') || !isRedFamily('#ff2e55')) errors.push('the red-family test drifted')
if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`colour tokens ok: ${tokenLiterals} literals, all in ui/${TOKENS}; none elsewhere in ui/`)
