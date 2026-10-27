// Numeric polylines only: the UI never inserts SVG supplied by an imported file.
export function validateLines(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 512) throw new Error('Use 1–512 polylines.')
  let count = 0
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2) throw new Error('Each line needs at least two points.')
    for (const point of line) {
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isFinite(n) || Math.abs(n) > 16)) throw new Error('Points must fit the 32 × 32 icon canvas.')
      if (++count > 8192) throw new Error('This icon is too detailed (maximum 8192 points).')
    }
  }
  return lines
}
const number = n => Number(n.toFixed(4))
export function iconSvg(lines, { decorative = false } = {}) {
  validateLines(lines)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -16 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"${decorative ? ' aria-hidden="true"' : ''}>${lines.map(line => `<polyline points="${line.map(p => p.map(number).join(',')).join(' ')}"/>`).join('')}</svg>`
}
/** Canonical on-disk SVG subset, identical in Node and browser. No XML entities or executable markup. */
export function parseIconSvg(text) {
  if (typeof text !== 'string' || text.length > 200000) throw new Error('SVG must be smaller than 200 KB.')
  const source = text.trim()
  const outer = /^<svg\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"\s+viewBox="-16 -16 32 32"\s+fill="none"\s+stroke="currentColor"\s+stroke-width="1\.4"\s+stroke-linecap="round"\s+stroke-linejoin="round">([\s\S]*)<\/svg>$/.exec(source)
  if (!outer) throw new Error('Use Import SVG in the icon library to normalize this file before saving it.')
  const body = outer[1], lines = [], re = /<polyline\s+points="([-+\d.eE,\s]+)"\s*\/>/g
  let match
  while ((match = re.exec(body))) {
    const nums = match[1].trim().split(/[\s,]+/).map(Number)
    if (nums.length % 2) throw new Error('A point needs both x and y.')
    lines.push(Array.from({ length: nums.length / 2 }, (_, i) => nums.slice(i * 2, i * 2 + 2)))
  }
  if (body.replace(re, '').trim()) throw new Error('Only numeric polylines are allowed in a saved icon.')
  return validateLines(lines)
}
