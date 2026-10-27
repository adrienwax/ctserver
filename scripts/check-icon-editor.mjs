// Real XML parsing via the existing build dependency; browser geometry APIs are not simulated.
// Actual editor script runs in a small DOM event harness to exercise deferred file/network ownership.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { DOMParser as XmlParser } from '@xmldom/xmldom'
import { normalizeSvg } from '../ui/icon-import.mjs'
const probe = new XmlParser().parseFromString('<svg/>', 'image/svg+xml')
const elementPrototype = Object.getPrototypeOf(probe.documentElement)
Object.defineProperty(elementPrototype, 'children', { configurable: true, get() { return Array.from(this.childNodes).filter(node => node.nodeType === 1) } })
globalThis.DOMParser = class extends XmlParser {
  parseFromString(...args) { const doc = super.parseFromString(...args); doc.querySelector = name => doc.getElementsByTagName(name)[0] || null; return doc }
}
globalThis.document = { createElementNS(ns, name) { const node = probe.createElementNS(ns, name); node.style = {}; return node } }
let checks = 0
const test = async (name, fn) => { await fn(); checks++; console.log(`ok ${name}`) }
await test('pixel and Inkscape millimetre roots normalize to the same 32-unit viewport', () => {
  for (const file of ['icon-import-pixels.svg', 'icon-import-inkscape.svg']) {
    const text = fs.readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
    const { svg, box } = normalizeSvg(text)
    assert.deepEqual(box, [0, 0, 24, 24]); assert.equal(svg.getAttribute('width'), '32'); assert.equal(svg.getAttribute('height'), '32')
    const path = svg.getElementsByTagName('path')[0]
    assert.equal(path.getAttribute('fill'), 'none'); assert.equal(path.getAttribute('stroke'), 'currentColor'); assert.equal(path.getAttribute('style'), '')
    if (file.includes('inkscape')) assert.equal(svg.getElementsByTagName('g')[0].getAttribute('transform'), 'translate(2,2)')
  }
})
await test('SVG normalization rejects executable resources, unsupported effects and compound paths', () => {
  const wrap = inner => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`
  for (const part of ['<script>alert(1)</script>', '<image href="file:///private"/>', '<path onload="run()" d="M0 0L1 1"/>', '<path style="stroke:url(http://example.com)" d="M0 0L1 1"/>', '<path opacity=".5" d="M0 0L1 1"/>', '<path filter="blur(2)" d="M0 0L1 1"/>', '<path style="stroke-dasharray:2,2" d="M0 0L1 1"/>', '<path d="M0 0L1 1 M2 2L3 3"/>']) assert.throws(() => normalizeSvg(wrap(part)), part)
})

const source = fs.readFileSync(new URL('../ui/icon-library.js', import.meta.url), 'utf8')
const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no }); return { promise, resolve, reject } }
async function harness() {
  const elements = new Map(), requests = []
  const element = () => ({ open: false, dataset: {}, listeners: {}, innerHTML: '', textContent: '',
    addEventListener(type, fn) { this.listeners[type] = fn }, setAttribute() {}, appendChild() {},
    querySelector(selector) { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector) },
    showModal() { this.open = true }, close() { this.open = false; this.listeners.close?.() }, click() {},
  })
  const dialog = element(), data = { icons: { home: { lines: [[[-1, 0], [1, 0]]] }, play: { lines: [[[0, -1], [0, 1]]] } }, folder: 'scratch' }
  const window = { SCHEMA: { ICONS: ['home', 'play'] }, ICON_TOOLS: { iconSvg: JSON.stringify, importSvg: JSON.parse }, dispatchEvent() {} }
  vm.runInNewContext(source, { window, document: { createElement: name => name === 'dialog' ? dialog : element(), body: { appendChild() {} } },
    fetch: async (url, options) => {
      if (url === '/api/icons') return { json: async () => structuredClone(data) }
      const pending = deferred(); requests.push({ body: JSON.parse(options.body), pending }); return { json: () => pending.promise }
    }, Event: class {}, location: { search: '' }, setTimeout, console,
  })
  await window.IconLibrary.ready
  const open = name => window.IconLibrary.open(name, () => {})
  const file = read => elements.get('input[type=file]').listeners.change({ target: { files: [{ text: read }], value: '' } })
  const click = attribute => dialog.listeners.click({ target: { closest: () => ({ hasAttribute: value => value === attribute }) } })
  return { window, dialog, elements, requests, data, open, file, click }
}
await test('late import cannot land on another icon after close/reopen', async () => {
  const h = await harness(), read = deferred()
  h.open('home'); const pending = h.file(() => read.promise)
  h.dialog.close(); h.open('play'); read.resolve('[[[5,5],[6,6]]]'); await pending
  assert.equal(h.elements.get('.icon-name').textContent, 'play')
  assert.notEqual(h.elements.get('.icon-origin').textContent, 'Imported preview · not saved')
  assert.notEqual(h.elements.get('.icon-large').innerHTML, '[[[5,5],[6,6]]]')
})
await test('the newest import wins when two file reads finish out of order', async () => {
  const h = await harness(), old = deferred(); h.open('home')
  const first = h.file(() => old.promise); await h.file(async () => '[[[3,3],[4,4]]]')
  old.resolve('[[[1,1],[2,2]]]'); await first
  assert.equal(h.elements.get('.icon-large').innerHTML, '[[[3,3],[4,4]]]')
})
await test('save completion preserves a new dialog draft and writes only its captured icon', async () => {
  const h = await harness(); h.open('home'); await h.file(async () => '[[[1,1],[2,2]]]')
  const save = h.click('data-icon-save'); await Promise.resolve()
  assert.equal(h.requests[0].body.name, 'home')
  h.dialog.close(); h.open('play'); await h.file(async () => '[[[3,3],[4,4]]]')
  h.requests[0].pending.resolve(h.data); await save
  assert.equal(h.elements.get('.icon-name').textContent, 'play')
  assert.equal(h.elements.get('.icon-large').innerHTML, '[[[3,3],[4,4]]]')
  assert.equal(h.elements.get('.icon-origin').textContent, 'Imported preview · not saved')
})
await test('save completion preserves a newer import even within the same icon session', async () => {
  const h = await harness(); h.open('home'); await h.file(async () => '[[[1,1],[2,2]]]')
  const save = h.click('data-icon-save'); await Promise.resolve()
  await h.file(async () => '[[[5,5],[6,6]]]')
  h.requests[0].pending.resolve(h.data); await save
  assert.equal(h.elements.get('.icon-large').innerHTML, '[[[5,5],[6,6]]]')
  assert.equal(h.elements.get('[data-icon-save]').disabled, false)
})
await test('reset completion cannot clear a new dialog import', async () => {
  const h = await harness(); h.open('home'); const reset = h.click('data-icon-reset'); await Promise.resolve()
  h.dialog.close(); h.open('play'); await h.file(async () => '[[[5,5],[6,6]]]')
  h.requests[0].pending.resolve(h.data); await reset
  assert.equal(h.elements.get('.icon-large').innerHTML, '[[[5,5],[6,6]]]')
})
console.log(`${checks} icon editor checks passed; XML normalization and async ownership only, browser geometry pending`)
