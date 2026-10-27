// CT centre-key labels, drawn in pure JS and sent to the CT as raw RGB565.
// No canvas: npm blocked canvas's native build, and a thin-line look needs only strokes anyway.
// The look is EDENA's Mœbius deck (edena/src/ct/draw.ts): a night-indigo ground, a hairline key
// outline, a light pastel label; state is carried by the line (brighter, a dot), never a filled tile.
//   node ct-draw.mjs   -> self-check + writes preview PNGs of every page to ./preview/
import fs from 'node:fs'
import zlib from 'node:zlib'
import { GEN_ORDER, FX_ORDER } from './ct-td-map.mjs'

export const KEY = 90
export const INK = {
  night: '#14121d', bone: '#f1e9da', dust: '#8f879f', sand: '#e8c99a',
  rose: '#e8a9b8', sage: '#b3d4a8',
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

// ---------------------------------------------------------------- surface
// Float RGB, painted by coverage: each shape's pixel coverage comes from its distance field.
export function surface(w, h, bg = INK.night) {
  const px = new Float32Array(w * h * 3)
  const [r, g, b] = rgb(bg)
  for (let i = 0; i < w * h; i++) { px[i * 3] = r; px[i * 3 + 1] = g; px[i * 3 + 2] = b }
  return { w, h, px }
}

function paint(s, x0, y0, x1, y1, color, alpha, coverage) {
  const [r, g, b] = rgb(color)
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(s.h - 1, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(s.w - 1, Math.ceil(x1)); x++) {
      const c = coverage(x + 0.5, y + 0.5) * alpha
      if (c <= 0) continue
      const i = (y * s.w + x) * 3
      s.px[i] += (r - s.px[i]) * c; s.px[i + 1] += (g - s.px[i + 1]) * c; s.px[i + 2] += (b - s.px[i + 2]) * c
    }
  }
}

const clamp01 = v => Math.max(0, Math.min(1, v))
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
  const t = l2 ? clamp01(((px - ax) * dx + (py - ay) * dy) / l2) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// Polylines as one shape, so joints are not painted twice.
export function stroke(s, lines, color, width = 1, alpha = 1) {
  const segs = []
  for (const l of lines) for (let i = 1; i < l.length; i++) segs.push([...l[i - 1], ...l[i]])
  if (!segs.length) return
  const xs = segs.flatMap(q => [q[0], q[2]]), ys = segs.flatMap(q => [q[1], q[3]]), pad = width + 1
  paint(s, Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad, color, alpha,
    (x, y) => { let d = Infinity; for (const q of segs) d = Math.min(d, segDist(x, y, ...q)); return clamp01(width / 2 + 0.5 - d) })
}

export function roundRect(s, x, y, w, h, r, color, width = 1, alpha = 1) {
  const cx = x + w / 2, cy = y + h / 2
  paint(s, x - 2, y - 2, x + w + 2, y + h + 2, color, alpha, (px, py) => {
    const qx = Math.abs(px - cx) - (w / 2 - r), qy = Math.abs(py - cy) - (h / 2 - r)
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
    return clamp01(width / 2 + 0.5 - Math.abs(d))
  })
}

export function dot(s, x, y, r, color, alpha = 1) {
  paint(s, x - r - 1, y - r - 1, x + r + 1, y + r + 1, color, alpha, (px, py) => clamp01(r + 0.5 - Math.hypot(px - x, py - y)))
}

// ---------------------------------------------------------------- single-stroke font
// Uppercase, digits and a few marks, on a cap height of 6 units, y down. [width, ...polylines]
const O = [[0.8, 0], [3.2, 0], [4, 0.8], [4, 5.2], [3.2, 6], [0.8, 6], [0, 5.2], [0, 0.8], [0.8, 0]]
const P = [[0, 6], [0, 0], [3, 0], [4, 0.8], [4, 2.4], [3, 3.2], [0, 3.2]]
const FONT = {
  A: [4, [[0, 6], [2, 0], [4, 6]], [[0.7, 4], [3.3, 4]]],
  B: [4, [[0, 6], [0, 0], [3, 0], [4, 0.75], [4, 2.25], [3, 3], [0, 3]], [[3, 3], [4, 3.75], [4, 5.25], [3, 6], [0, 6]]],
  C: [4, [[4, 0.8], [3.2, 0], [0.8, 0], [0, 0.8], [0, 5.2], [0.8, 6], [3.2, 6], [4, 5.2]]],
  D: [4, [[0, 0], [0, 6], [2.8, 6], [4, 4.8], [4, 1.2], [2.8, 0], [0, 0]]],
  E: [3.6, [[3.6, 0], [0, 0], [0, 6], [3.6, 6]], [[0, 3], [3, 3]]],
  F: [3.6, [[3.6, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]],
  G: [4, [[4, 0.8], [3.2, 0], [0.8, 0], [0, 0.8], [0, 5.2], [0.8, 6], [3.2, 6], [4, 5.2], [4, 3.2], [2.2, 3.2]]],
  H: [4, [[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [0, [[0, 0], [0, 6]]],
  J: [3.6, [[3.6, 0], [3.6, 5.1], [2.7, 6], [0.9, 6], [0, 5.1]]],
  K: [4, [[0, 0], [0, 6]], [[4, 0], [0, 3.6]], [[1.4, 2.6], [4, 6]]],
  L: [3.4, [[0, 0], [0, 6], [3.4, 6]]],
  M: [4.6, [[0, 6], [0, 0], [2.3, 4], [4.6, 0], [4.6, 6]]],
  N: [4, [[0, 6], [0, 0], [4, 6], [4, 0]]],
  O: [4, O],
  P: [4, P],
  Q: [4, O, [[2.6, 4.4], [4.3, 6.5]]],
  R: [4, P, [[2.2, 3.2], [4, 6]]],
  S: [4, [[4, 0.8], [3.2, 0], [0.8, 0], [0, 0.8], [0, 2.2], [0.8, 3], [3.2, 3], [4, 3.8], [4, 5.2], [3.2, 6], [0.8, 6], [0, 5.2]]],
  T: [4, [[0, 0], [4, 0]], [[2, 0], [2, 6]]],
  U: [4, [[0, 0], [0, 5.2], [0.8, 6], [3.2, 6], [4, 5.2], [4, 0]]],
  V: [4, [[0, 0], [2, 6], [4, 0]]],
  W: [4.8, [[0, 0], [1.2, 6], [2.4, 2], [3.6, 6], [4.8, 0]]],
  X: [4, [[0, 0], [4, 6]], [[4, 0], [0, 6]]],
  Y: [4, [[0, 0], [2, 3], [4, 0]], [[2, 3], [2, 6]]],
  Z: [4, [[0, 0], [4, 0], [0, 6], [4, 6]]],
  0: [3.5, [[0.7, 0], [2.8, 0], [3.5, 0.8], [3.5, 5.2], [2.8, 6], [0.7, 6], [0, 5.2], [0, 0.8], [0.7, 0]]],
  1: [1.8, [[0, 1.2], [1.8, 0], [1.8, 6]]],
  2: [3.5, [[0, 0.9], [0.8, 0], [2.7, 0], [3.5, 0.9], [3.5, 2.3], [0, 6], [3.5, 6]]],
  3: [3.5, [[0, 0], [3.5, 0], [1.6, 2.6], [2.7, 2.6], [3.5, 3.4], [3.5, 5.2], [2.7, 6], [0.8, 6], [0, 5.2]]],
  4: [3.5, [[2.6, 6], [2.6, 0], [0, 4.2], [3.5, 4.2]]],
  5: [3.5, [[3.5, 0], [0.3, 0], [0, 2.8], [2.6, 2.6], [3.5, 3.4], [3.5, 5.2], [2.7, 6], [0.8, 6], [0, 5.2]]],
  6: [3.5, [[3.2, 0], [1.4, 0], [0, 2], [0, 5.2], [0.8, 6], [2.7, 6], [3.5, 5.2], [3.5, 3.8], [2.7, 3], [0, 3.2]]],
  7: [3.5, [[0, 0], [3.5, 0], [1.2, 6]]],
  8: [3.5, [[1.75, 3], [0.6, 3], [0, 2.3], [0, 0.7], [0.7, 0], [2.8, 0], [3.5, 0.7], [3.5, 2.3], [2.9, 3], [1.75, 3], [0.7, 3], [0, 3.8], [0, 5.2], [0.8, 6], [2.7, 6], [3.5, 5.2], [3.5, 3.8], [2.8, 3], [1.75, 3]]],
  9: [3.5, [[3.5, 2.8], [2.7, 3.2], [0.8, 3.2], [0, 2.4], [0, 0.8], [0.8, 0], [2.7, 0], [3.5, 0.8], [3.5, 4], [2.1, 6], [0.3, 6]]],
  '/': [2.4, [[2.4, -0.4], [0, 6.4]]],
  '-': [2.6, [[0, 3], [2.6, 3]]],
  '+': [3.4, [[0, 3], [3.4, 3]], [[1.7, 1.3], [1.7, 4.7]]],
  '.': [0.5, [[0.25, 5.4], [0.25, 6]]],
  ':': [0.5, [[0.25, 1.5], [0.25, 2.1]], [[0.25, 5.4], [0.25, 6]]],
  '%': [4, [[4, 0], [0, 6]], [[0.3, 0.2], [1.3, 0.2], [1.3, 1.8], [0.3, 1.8], [0.3, 0.2]], [[2.7, 4.2], [3.7, 4.2], [3.7, 5.8], [2.7, 5.8], [2.7, 4.2]]],
  ' ': [2.2],
}
const TRACK = 1.7   // letter spacing in font units: airy, like EDENA's spaced capitals

function textWidth(str, scale) {
  let w = 0
  for (const ch of str) w += ((FONT[ch] || FONT[' '])[0] + TRACK) * scale
  return w - TRACK * scale
}

// Centred text; shrinks the scale until it fits maxW (EDENA's fit()).
export function text(s, str, cx, cy, color, { cap = 9, maxW = Infinity, width = 1.1, alpha = 1, squeeze = false } = {}) {
  str = String(str).toUpperCase()
  let scale = cap / 6
  if (!squeeze) while (textWidth(str, scale) > maxW && scale > 0.8) scale -= 0.05
  const sx = squeeze ? Math.min(1, maxW / textWidth(str, scale)) : 1   // squeeze: narrower letters, same height
  let x = cx - textWidth(str, scale) * sx / 2
  const y = cy - 3 * scale
  const lines = []
  for (const ch of str) {
    const [w, ...ps] = FONT[ch] || FONT[' ']
    for (const l of ps) lines.push(l.map(([u, v]) => [x + u * scale * sx, y + v * scale]))
    x += (w + TRACK) * scale * sx
  }
  stroke(s, lines, color, width, alpha)
}

// ---------------------------------------------------------------- keys
// A key: { label, sub, color, active, dim, glyph } where glyph is one of GLYPH_NAMES.
// Icons in EDENA's line language (edena/src/ct/draw.ts): one hairline drawing, about 24 px, above the label.
const arc = (cx, cy, r, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] })
const ring = (cx, cy, r) => arc(cx, cy, r, 0, Math.PI * 2, 32)
const head = (x, y, ang, l = 5) => [[x + l * Math.cos(ang + 2.6), y + l * Math.sin(ang + 2.6)], [x, y], [x + l * Math.cos(ang - 2.6), y + l * Math.sin(ang - 2.6)]]
// The shared icon language: drawn on its 24-unit
// grid, one unit to a pixel, centred on the key. Its solid shapes (transport, markers, mosh) are filled with
// scanlines, since the CT's look has only strokes.
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
const bez = (a, b, c, d, n = 10) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [0, 1].map(j => u * u * u * a[j] + 3 * u * u * t * b[j] + 3 * u * t * t * c[j] + t * t * t * d[j]) })
const fill = poly => {
  const ys = poly.map(p => p[1]), out = []
  for (let y = Math.min(...ys) + 0.5; y < Math.max(...ys); y += 1) {
    const xs = []
    for (let i = 0; i < poly.length - 1; i++) { const [ax, ay] = poly[i], [bx, by] = poly[i + 1]; if ((ay <= y) !== (by <= y)) xs.push(ax + (y - ay) * (bx - ax) / (by - ay)) }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([[xs[i], y], [xs[i + 1], y]])
  }
  return out
}
const grid = f => (cx, cy) => f().map(l => l.map(([x, y]) => [cx + x - 12, cy + y - 12]))
const circ = (x, y, r, n = 28) => Array.from({ length: n + 1 }, (_, i) => [x + r * Math.cos(i * 2 * Math.PI / n), y + r * Math.sin(i * 2 * Math.PI / n)])
const arcU = (x, y, r, a0, a1, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [x + r * Math.cos(a), y + r * Math.sin(a)] })
const fwd = grid(() => [...fill(rect(15.4, 5, 2.6, 14)), ...fill([[5, 5], [5, 19], [14.5, 12], [5, 5]])])
const GLYPHS = {
  more: fwd,
  back: grid(() => [...fill(rect(6, 5, 2.6, 14)), ...fill([[19, 5], [19, 19], [9.5, 12], [19, 5]])]),
  // a film frame with its sprocket marks
  clip: (cx, cy) => [[[cx - 12, cy - 8], [cx + 12, cy - 8], [cx + 12, cy + 8], [cx - 12, cy + 8], [cx - 12, cy - 8]],
    ...[-7, 0, 7].flatMap((x) => [[[cx + x - 1.5, cy - 5], [cx + x + 1.5, cy - 5]], [[cx + x - 1.5, cy + 5], [cx + x + 1.5, cy + 5]]])],
  // a circle half hatched: the tone of the whole picture
  look: (cx, cy) => [ring(cx, cy, 10), [[cx, cy - 10], [cx, cy + 10]], ...[-7, -3.5].map((x) => { const h = Math.sqrt(100 - x * x); return [[cx + x, cy - h], [cx + x, cy + h]] })],
  // a ring and the fading echoes it leaves behind
  trails: (cx, cy) => [ring(cx + 6, cy, 6), arc(cx - 1, cy, 7, Math.PI * 0.6, Math.PI * 1.4, 10), arc(cx - 7, cy, 8, Math.PI * 0.65, Math.PI * 1.35, 10)],
  // a line running down into drips
  melt: (cx, cy) => [[[cx - 12, cy - 9], [cx + 12, cy - 9]], [[cx - 8, cy - 9], [cx - 8, cy + 1]], ring(cx - 8, cy + 3, 2),
    [[cx, cy - 9], [cx, cy + 6]], ring(cx, cy + 8, 2), [[cx + 8, cy - 9], [cx + 8, cy - 3]], ring(cx + 8, cy - 1, 2)],
  // a small sun: the glow
  bloom: (cx, cy) => [ring(cx, cy, 4.5), ...Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return [[cx + 7.5 * Math.cos(a), cy + 7.5 * Math.sin(a)], [cx + 12 * Math.cos(a), cy + 12 * Math.sin(a)]] })],
  // an eye: open the output window
  view: (cx, cy) => [arc(cx, cy + 11, 16, -Math.PI * 0.78, -Math.PI * 0.22, 16), arc(cx, cy - 11, 16, Math.PI * 0.22, Math.PI * 0.78, 16), ring(cx, cy, 3.5)],
  // a circle turning back to where it started
  reset: (cx, cy) => { const a1 = -Math.PI * 0.35; return [arc(cx, cy, 9, -Math.PI * 1.85, a1), head(cx + 9 * Math.cos(a1), cy + 9 * Math.sin(a1), a1 + Math.PI / 2)] },
  // the record mark
  rec: (cx, cy) => [ring(cx, cy, 10), ring(cx, cy, 4), ring(cx, cy, 2)],
  // two open chevrons
  speed: (cx, cy) => [[[cx - 10, cy - 8], [cx - 2, cy], [cx - 10, cy + 8]], [[cx, cy - 8], [cx + 8, cy], [cx, cy + 8]]],
  // three bands, each slipped against the next: time or depth in layers (strata, time bands)
  layers: (cx, cy) => [-8, 0, 8].map((y, i) => [[cx - 12 + i * 3, cy + y], [cx + 6 + i * 3, cy + y]]),
  // the icon language, one shape per operation
  home: grid(() => [[[4, 12], [12, 5], [20, 12]], [[6.5, 11], [6.5, 19], [17.5, 19], [17.5, 11]], [[10, 19], [10, 14], [14, 14], [14, 19]]]),
  source: grid(() => [rect(4, 6, 16, 12), [[8, 6], [8, 18]], [[16, 6], [16, 18]], ...[9, 12, 15].flatMap(y => [[[5.5, y], [6.5, y]], [[17.5, y], [18.5, y]]])]),
  mosh: grid(() => [rect(6, 6, 10, 2.6), rect(9, 9.6, 11, 2.6), rect(4, 13.2, 11, 2.6), rect(8, 16.8, 9, 2.6)].flatMap(fill)),
  node: grid(() => [rect(3.5, 7, 5.5, 5.5), rect(15, 11.5, 5.5, 5.5), [[9, 9.75], [12, 9.75], [12, 14.25], [15, 14.25]]]),
  render: grid(() => [[[5, 14], [5, 19], [19, 19], [19, 14]], [[12, 15], [12, 4]], [[8, 8], [12, 4], [16, 8]]]),
  forward: fwd,
  freeze: grid(() => [[[12, 3], [12, 21]], [[4.2, 7.5], [19.8, 16.5]], [[19.8, 7.5], [4.2, 16.5]], [[10, 4.5], [12, 6], [14, 4.5]], [[10, 19.5], [12, 18], [14, 19.5]],
    [[5, 6.4], [5.5, 8.6], [7.7, 8]], [[19, 17.6], [18.5, 15.4], [16.3, 16]], [[19, 6.4], [18.5, 8.6], [16.3, 8]], [[5, 17.6], [5.5, 15.4], [7.7, 16]]]),
  lfo: grid(() => [[...bez([3, 12], [6, 4], [9, 4], [12, 12]), ...bez([12, 12], [15, 20], [18, 20], [21, 12]).slice(1)]]),
  'mark-in': grid(() => [...fill(rect(6, 4, 2.4, 16)), ...fill([[11, 8], [17, 12], [11, 16], [11, 8]])]),
  'mark-out': grid(() => [...fill(rect(15.6, 4, 2.4, 16)), ...fill([[13, 8], [7, 12], [13, 16], [13, 8]])]),
  effect: grid(() => [rect(5, 5, 14, 14), [...bez([7, 17], [10, 17], [10, 12], [12, 12]), ...bez([12, 12], [14, 12], [14, 7], [17, 7]).slice(1)]]),
  play: grid(() => fill([[8, 5], [19, 12], [8, 19], [8, 5]])),
  pause: grid(() => [...fill(rect(8, 5, 3, 14)), ...fill(rect(13, 5, 3, 14))]),
  stop: grid(() => fill(rect(6, 6, 12, 12))),
  record: grid(() => fill(circ(12, 12, 6))),
  loop: grid(() => [[[5, 10], [17, 10]], [[14, 7], [17, 10], [14, 13]], [[19, 14], [7, 14]], [[10, 11], [7, 14], [10, 17]]]),
  undo: grid(() => [[[8, 4], [4, 8], [8, 12]], [[4, 8], [14, 8], ...arcU(14, 13, 5, -Math.PI / 2, Math.PI / 2)]]),
  redo: grid(() => [[[16, 4], [20, 8], [16, 12]], [[20, 8], [10, 8], ...arcU(10, 13, 5, -Math.PI / 2, -Math.PI * 1.5)]]),
  save: grid(() => [[[5, 5], [16, 5], [19, 8], [19, 19], [5, 19], [5, 5]], [[8, 5], [8, 9], [15, 9], [15, 5]], rect(8, 13, 8, 6)]),
  add: grid(() => [[[12, 5], [12, 19]], [[5, 12], [19, 12]]]),
  delete: grid(() => [[[5, 7], [19, 7]], [[9.5, 7], [9.5, 5], [14.5, 5], [14.5, 7]], [[7, 7], [8, 19], [16, 19], [17, 7]]]),
  folder: grid(() => [[[4, 8], [9, 8], [11, 10], [20, 10], [20, 18], [4, 18], [4, 8]]]),
  settings: grid(() => [circ(12, 12, 3.3), [[12, 3], [12, 6]], [[12, 18], [12, 21]], [[3, 12], [6, 12]], [[18, 12], [21, 12]],
    [[5.6, 5.6], [7.8, 7.8]], [[16.2, 16.2], [18.4, 18.4]], [[18.4, 5.6], [16.2, 7.8]], [[7.8, 16.2], [5.6, 18.4]]]),
  slice: grid(() => [[[4, 8], [12, 8], [15, 11], [7, 11], [4, 8]], [[15, 9.5], [20, 9.5]], ...[3, 7.6, 12.2, 16.8].map(y => [[18, y], [18, y + 2.2]])]),
  import: grid(() => [[[14, 6], [20, 6], [20, 18], [14, 18]], [[4, 12], [15, 12]], [[11, 8], [15, 12], [11, 16]]]),
  volume: grid(() => [[[4, 9], [8, 9], [13, 5], [13, 19], [8, 15], [4, 15], [4, 9]], arcU(13, 12, 5, -1, 1), arcU(13, 12, 8, -1, 1)]),
  mute: grid(() => [[[4, 9], [8, 9], [12, 5], [12, 19], [8, 15], [4, 15], [4, 9]], [[16, 9], [21, 15]], [[21, 9], [16, 15]]]),
  scroll: grid(() => [[[8, 7], [12, 3], [16, 7]], [[12, 3], [12, 21]], [[8, 17], [12, 21], [16, 17]]]),
  desktop: grid(() => [rect(3, 4, 18, 13), [[12, 17], [12, 21]], [[7, 21], [17, 21]]]),
  tasks: grid(() => [rect(3, 4, 12, 11), [[17, 8], [21, 8], [21, 20], [8, 20], [8, 17]], [[3, 7], [15, 7]]]),
  keyboard: grid(() => [rect(3, 6, 18, 12), ...[7, 12, 17].flatMap(x => [[[x - 1, 10], [x + 1, 10]], [[x - 1, 13], [x + 1, 13]]]), [[8, 16], [16, 16]]]),
  zoom: grid(() => [circ(10, 10, 6), [[14.5, 14.5], [21, 21]], [[7, 10], [13, 10]], [[10, 7], [10, 13]]]),
}
export const GLYPH_NAMES = Object.keys(GLYPHS)
const BUILTIN_GLYPHS = { ...GLYPHS }
/** Device and server diagram use the same validated polyline assets. */
export const glyphLines = name => BUILTIN_GLYPHS[name]?.(0, 0)
export const currentGlyphLines = name => GLYPHS[name]?.(0, 0)
export function setGlyphs(icons = {}) {
  for (const name of GLYPH_NAMES) {
    const lines = icons[name]?.lines
    GLYPHS[name] = lines ? (cx, cy) => lines.map(line => line.map(([x, y]) => [x + cx, y + cy])) : BUILTIN_GLYPHS[name]
  }
}

// One title above a dominant glyph, including on global Home. No bottom banners:
// the top edge is easiest to read on the tilted CT. Full labels remain in Customize.
export const KEY_LAYOUT = Object.freeze({ titleY: 16, titleCap: 8.5, titleWidth: 78, iconY: 55, iconScale: 1.9 })
export function keyTitle(label) {
  let title = String(label ?? '').trim().toUpperCase()
  if (textWidth(title, KEY_LAYOUT.titleCap / 6) <= KEY_LAYOUT.titleWidth) return title
  while (title && textWidth(title + '..', KEY_LAYOUT.titleCap / 6) > KEY_LAYOUT.titleWidth) title = title.slice(0, -1)
  return title.trimEnd() + '..'
}
function fillRect(s, x0, y0, x1, y1, color, alpha = 1) { paint(s, x0, y0, x1 - 1, y1 - 1, color, alpha, () => 1) }
function paintTile(s, k, x, y, skin) {
  const a = k.dim ? 0.42 : 1, c = k.color || INK.bone, P = 3, F = KEY - 2 * P
  const fx = x + P, fy = y + P
  fillRect(s, fx, fy, fx + F, fy + F, skin.tile)
  roundRect(s, fx + 1, fy + 1, F - 2, F - 2, 5, c, k.active ? 1.8 : 1, a * (k.active ? 1 : 0.4))
  text(s, keyTitle(k.label), x + KEY / 2, y + KEY_LAYOUT.titleY, k.active ? INK.bone : c,
    { cap: KEY_LAYOUT.titleCap, maxW: KEY_LAYOUT.titleWidth, width: 1.2, alpha: a })
  if (k.glyph) {
    const geometry = GLYPHS[k.glyph](0, 0)
    const extent = Math.max(1, ...geometry.flat().flatMap(([u, v]) => [Math.abs(u), Math.abs(v)]))
    const g = Math.min(KEY_LAYOUT.iconScale, 24 / extent), cx = x + KEY / 2, cy = y + KEY_LAYOUT.iconY
    const lines = geometry.map(l => l.map(([u, v]) => [cx + u * g, cy + v * g]))
    stroke(s, lines, c, 1.25 * g, a)
  }
  if (k.active) dot(s, x + 78, y + 78, 2.5, INK.bone, a)
}

export function paintKey(s, k, x, y, skin) {
  if (k.glyph && !GLYPHS[k.glyph]) k = { ...k, glyph: undefined }
  return paintTile(s, k, x, y, skin || { tile: INK.night })
}

const two = n => String(n).padStart(2, '0')

// The 12 keys for the page on show. `generator` / `effect` are TD's current picks.
export function keysFor({ page, fxOffset = 0, generator, effect }) {
  if (page === 'gen') {
    const keys = GEN_ORDER.map((g, i) => ({ label: g, sub: `gen ${two(i + 1)}`, color: INK.sage, active: g === generator }))
    keys.push({ label: 'gen', sub: `${GEN_ORDER.length} of ${GEN_ORDER.length}`, color: INK.dust, dim: true })
    return keys
  }
  const keys = []
  for (let k = 0; k < 11; k++) {
    const f = FX_ORDER[k + fxOffset]
    keys.push(f ? { label: f, sub: `fx ${two(k + fxOffset + 1)}`, color: INK.rose, active: f === effect } : null)
  }
  const more = FX_ORDER.length > 11
  keys.push(!more ? null : fxOffset
    ? { label: 'back', sub: 'page 2/2', color: INK.sand, glyph: 'back' }
    : { label: 'more', sub: 'page 1/2', color: INK.sand, glyph: 'more' })
  return keys
}

export function renderKeys(keys, skin) {   // skin: an app's { tile, deep } (icon language section 4), else the night ground
  const s = surface(360, 270, skin ? skin.deep : INK.night)
  keys.forEach((k, i) => k && paintKey(s, k, (i % 4) * KEY, Math.floor(i / 4) * KEY, skin))
  return s
}

// ---------------------------------------------------------------- side strips
// Each 60x270 side screen carries three cells, one level with each dial beside it (EDENA's
// stripCanvas): a hairline tick on the dial side, the parameter name, and its value 0-100.
// The strip is still a touch fader; a faint rail on the inner edge marks where the fader sits.
export const KNOB_NAMES = JSON.parse(fs.readFileSync(new URL('./knob-names.json', import.meta.url), 'utf8'))

// side: 'left' (the effect's dials) or 'right' (the generator's). k: the 3 values 0..1, or null.
// fader: 0..1, bottom to top.
export function renderStrip(side, name, k, fader) {
  const s = surface(60, 270)
  const color = side === 'left' ? INK.rose : INK.sage
  const names = KNOB_NAMES[name] || ['', '', '']
  const tick = side === 'left' ? 4.5 : 55.5, rail = side === 'left' ? 56.5 : 3.5, cx = side === 'left' ? 31 : 29
  for (let i = 0; i < 3; i++) {
    const y = i * 90, unused = !names[i] || /^unused/i.test(names[i])
    stroke(s, [[[tick, y + 22], [tick, y + 68]]], color, 1, unused ? 0.3 : 1)
    if (unused) { stroke(s, [[[cx - 6, y + 45], [cx + 6, y + 45]]], INK.dust, 1, 0.6); continue }
    text(s, names[i], cx, y + 33, INK.dust, { cap: 5, maxW: 44, width: 1 })
    if (k && k[i] != null) text(s, Math.round(k[i] * 100), cx, y + 55, INK.bone, { cap: 10, maxW: 44, width: 1.2 })
  }
  if (fader != null) {
    stroke(s, [[[rail, 6], [rail, 264]]], color, 1, 0.25)
    const fy = 264 - Math.max(0, Math.min(1, fader)) * 258
    stroke(s, [[[rail, Math.max(6, fy - 7)], [rail, Math.min(264, fy + 7)]]], color, 2, 1)
  }
  return s
}

// RGB565, little-endian: the CT's centre and strip screens (the wheel screen is big-endian).
export function toRgb565(s, bigEndian = false) {
  const out = Buffer.alloc(s.w * s.h * 2)
  for (let i = 0; i < s.w * s.h; i++) {
    const r = Math.round(s.px[i * 3]), g = Math.round(s.px[i * 3 + 1]), b = Math.round(s.px[i * 3 + 2])
    const v = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)
    if (bigEndian) out.writeUInt16BE(v, i * 2); else out.writeUInt16LE(v, i * 2)
  }
  return out
}

// A PNG of exactly what the CT is sent, decoded back from the RGB565 bytes.
export function rgb565ToPng(buf, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const v = buf.readUInt16LE((y * w + x) * 2), o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = (v >> 11) << 3; raw[o + 1] = ((v >> 5) & 0x3f) << 2; raw[o + 2] = (v & 0x1f) << 3
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export const PAGES = {
  gen: { page: 'gen', generator: 'spectrum' },
  fx1: { page: 'fx', fxOffset: 0, effect: 'dreamfb' },
  fx2: { page: 'fx', fxOffset: 11, effect: 'refract' },
}

// Self-check: packing, sizes, every page renders, a PNG preview of each.
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const one = surface(1, 1, '#ff0000'); console.assert(toRgb565(one).readUInt16LE(0) === 0xf800, 'red packs to 0xF800')
  const blue = surface(1, 1, '#0000ff'); console.assert(toRgb565(blue, true).readUInt16BE(0) === 0x001f, 'blue packs to 0x001F')
  fs.mkdirSync(new URL('./preview/', import.meta.url), { recursive: true })
  for (const [name, st] of Object.entries(PAGES)) {
    const keys = keysFor(st), buf = toRgb565(renderKeys(keys))
    console.assert(buf.length === 360 * 270 * 2, 'centre screen is 360x270x2 bytes')
    fs.writeFileSync(new URL(`./preview/keys-${name}.png`, import.meta.url), rgb565ToPng(buf, 360, 270))
    console.log(name, keys.map(k => k ? k.label : '-').join(' | '))
  }
  for (const n of [...GEN_ORDER, ...FX_ORDER]) console.assert(KNOB_NAMES[n], `knob names for ${n}`)
  for (const [side, name, k, f] of [['left', 'dreamfb', [0.842, 0.438, 0.5], 0.62], ['right', 'spectrum', [0.224, 0.909, 0.25], 0.5], ['right', 'deepreef', [0.4, 0.5, 0.5], 0.5]]) {
    const buf = toRgb565(renderStrip(side, name, k, f))
    console.assert(buf.length === 60 * 270 * 2, 'strip is 60x270x2 bytes')
    fs.writeFileSync(new URL(`./preview/strip-${side}-${name}.png`, import.meta.url), rgb565ToPng(buf, 60, 270))
  }
  console.log('ok: previews in ./preview/')
}
