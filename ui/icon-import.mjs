import { parseIconSvg, validateLines } from './icon-model.mjs'
const shapes = new Set(['path', 'rect', 'line', 'polyline', 'polygon', 'circle', 'ellipse'])
/** Import plain, single-colour SVG geometry. Only rebuilt numeric shapes ever enter the DOM. */
export function normalizeSvg(text) {
  if (text.length > 200000 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Use a plain SVG smaller than 200 KB, without external resources.')
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('This file is not valid SVG.')
  const root = parsed.documentElement, box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  if (box.length !== 4 || box.some(n => !Number.isFinite(n)) || box[2] <= 0 || box[3] <= 0) throw new Error('SVG needs a finite viewBox with positive width and height.')
  const ns = 'http://www.w3.org/2000/svg', safe = document.createElementNS(ns, 'svg')
  safe.setAttribute('viewBox', box.join(' ')); safe.setAttribute('width', '32'); safe.setAttribute('height', '32')
  safe.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none'
  const attrs = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points', 'd', 'transform', 'fill', 'stroke'])
  const rebuild = (from, into) => {
    const presentation = (name, value) => {
      if (name === 'fill' || name === 'stroke') into.setAttribute(name, value === 'none' ? 'none' : 'currentColor')
      else if (['opacity', 'fill-opacity', 'stroke-opacity'].includes(name) && Number(value) !== 1) throw new Error('Remove transparency before importing this single-colour icon.')
      else if (name === 'stroke-dasharray' && value !== 'none') throw new Error('Convert dashed strokes to paths before importing.')
      else if (!['stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dashoffset', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'vector-effect', 'paint-order', 'color'].includes(name)) throw new Error(`Unsupported SVG style: ${name}.`)
    }
    for (const attr of Array.from(from.attributes)) {
      if (/^on/i.test(attr.name) || /href/i.test(attr.name) || /url\s*\(/i.test(attr.value)) throw new Error('Scripts and linked resources are not supported.')
      if (['opacity', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray'].includes(attr.name)) { presentation(attr.name, attr.value); continue }
      if (['filter', 'mask', 'clip-path'].includes(attr.name) && attr.value !== 'none') throw new Error('Remove SVG filters, masks and clipping before importing.')
      if (from === root && ['width', 'height', 'x', 'y'].includes(attr.name)) continue // viewBox owns normalization, not export units/size
      if (attr.name === 'style') {
        for (const declaration of attr.value.split(';').filter(s => s.trim())) {
          const pair = declaration.split(':'); if (pair.length !== 2) throw new Error('Unsupported SVG style declaration.')
          presentation(pair[0].trim(), pair[1].trim())
        }
        continue
      }
      if (!attrs.has(attr.name)) continue
      if (attr.name === 'fill' || attr.name === 'stroke') into.setAttribute(attr.name, attr.value === 'none' ? 'none' : 'currentColor')
      else {
        if (attr.name === 'd' ? /[^MmLlHhVvCcSsQqTtAaZz\d.,+\-\seE]/.test(attr.value) : attr.name === 'transform' ? !/^(\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\([-+\d.,\seE]+\)\s*)+$/.test(attr.value) : /[^\d.,+\-\seE]/.test(attr.value)) throw new Error(`Unsupported SVG ${attr.name}.`)
        if (attr.name === 'd' && (attr.value.match(/[mM]/g) || []).length > 1) throw new Error('Separate compound paths into individual paths before importing.')
        into.setAttribute(attr.name, attr.value)
      }
    }
    for (const node of from.children) {
      const name = node.localName
      if (['title', 'desc', 'metadata', 'namedview'].includes(name) || name === 'defs' && !node.children.length) continue
      if (name !== 'g' && !shapes.has(name)) throw new Error(`Unsupported SVG element: ${name}. Convert text to paths; remove images, masks and filters.`)
      const next = document.createElementNS(ns, name); rebuild(node, next); into.appendChild(next)
    }
  }
  rebuild(root, safe)
  return { svg: safe, box }
}
export function importSvg(text) {
  try { return parseIconSvg(text) } catch {}
  const { svg: safe, box } = normalizeSvg(text)
  document.body.appendChild(safe)
  try {
    const lines = []
    for (const shape of safe.querySelectorAll([...shapes].join(','))) {
      const length = shape.getTotalLength(), matrix = shape.getCTM()
      if (!matrix || !Number.isFinite(length)) throw new Error('Cannot measure this SVG shape.')
      const steps = Math.max(2, Math.min(512, Math.ceil(length * Math.max(32 / box[2], 32 / box[3]) * 2)))
      const points = Array.from({ length: steps + 1 }, (_, i) => { const p = shape.getPointAtLength(length * i / steps).matrixTransform(matrix); return [p.x - 16, p.y - 16] })
      const fill = getComputedStyle(shape).fill !== 'none', stroke = getComputedStyle(shape).stroke !== 'none'
      if (stroke) lines.push(points)
      if (fill && !['line'].includes(shape.localName)) {
        const poly = [...points, points[0]]
        for (let y = -15.5; y < 16; y += 1) {
          const intersections = []
          for (let i = 1; i < poly.length; i++) { const [a, b] = [poly[i - 1], poly[i]]; if ((a[1] <= y) !== (b[1] <= y)) intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) }
          intersections.sort((a, b) => a - b)
          for (let i = 0; i + 1 < intersections.length; i += 2) lines.push([[intersections[i], y], [intersections[i + 1], y]])
        }
      }
    }
    return validateLines(lines)
  } finally { safe.remove() }
}
