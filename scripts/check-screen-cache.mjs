import {keyFeedback} from '../host/key-feedback.mjs'
import {renderFeedbackKeys,renderFeedbackStrip,renderFeedbackWheel} from '../host/feedback-renderer.mjs'
// Execute the real repaint function and rasterizer with fake ACKs. No CT/serial imports.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { performance } from 'node:perf_hooks'
import * as draw from '../integrations/ct-td-control/ct-draw.mjs'
import { COLORS, TILES, pageOf } from '../host/schema.mjs'

const source = fs.readFileSync(new URL('../host/deck-host.mjs', import.meta.url), 'utf8')
const profile = JSON.parse(fs.readFileSync(new URL('../config/profiles/moshpit.json', import.meta.url), 'utf8'))
profile.appId = profile.id = 'moshpit'
const page = pageOf(profile, 0)
const tick = () => new Promise(resolve => setImmediate(resolve))
const device = () => ({
  path: 'same-fake-port', calls: [], holdNext: '', failNext: '', release: null,
  async drawBuffer({ id }, buffer) {
    this.calls.push({ id, bytes: buffer.length })
    if (this.failNext === id) { this.failNext = ''; throw new Error('fake write failure') }
    if (this.holdNext === id) { this.holdNext = ''; await new Promise(resolve => { this.release = resolve }) }
  },
  async setButtonColor({ id }) { this.calls.push({ id: `led${id}`, bytes: 0 }) },
})
let feedback = Object.fromEntries(['TL', 'CL', 'BL', 'TR', 'CR', 'BR'].map(label => [label, { label, text: '0', norm: 0, available: true }]))
feedback.wheel = { label: 'FRAME', text: '0 f', norm: 0, available: true }
const first = device(), messages = []
const displayProfile={appId:'moshpit',pick:true},displayPage={keys:{'0':{label:'MOSHPIT',do:{app:'moshpit'}},'1':{label:'GRAPH',do:{switch:'graph'}}}}
const displayContext=vm.createContext({keyFeedback,prof:()=>displayProfile,page:()=>displayPage,mosh:new Map(),native:new Map(),sel:{},bank:{},tdState:null,currentTdFresh:()=>false,cfg:{apps:{moshpit:{exe:'Moshpit.exe'}},profiles:{graph:{id:'graph',app:{exe:'Moshpit.exe'}}}},view:{profile:'graph'},running:{},lastOfApp:{moshpit:'graph'}})
vm.runInContext(source.slice(source.indexOf('const baseKeyFeedback ='),source.indexOf('function moshOf')),displayContext)
for(const running of [false,true]){
 displayContext.running['Moshpit.exe']=running
 const facts=vm.runInContext('currentKeyFeedback()',displayContext)
 for(const slot of ['0','1'])assert.deepEqual(facts[slot].display,{active:true,dim:!running})
}

const context = vm.createContext({ dev: first, stopping: false, drawing: false, prof: () => profile, page: () => page,
  view: { profile: 'moshpit', page: 0 }, cfg: { profiles: {}, apps: {} }, mres: value => value, moshOf: () => null,
  tdState: null, sel: {}, running: {}, currentDialFeedback: () => structuredClone(feedback), moshTick: 0,
  currentKeyFeedback: (profile,page) => keyFeedback({profile,page}), renderFeedbackKeys, renderFeedbackStrip, renderFeedbackWheel, draw, COLORS, TILES, log: (...args) => messages.push(args), queueMicrotask,
})
vm.runInContext(source.slice(source.indexOf('const hex ='), source.indexOf('function statusKeys()')), context)
const ids = d => d.calls.map(call => call.id)
const full = ['center', 'left', 'right', 'knob', ...Array.from({ length: 8 }, (_, i) => `led${i}`)]
const frame = n => { feedback = { ...feedback, wheel: { ...feedback.wheel, text: `${n} f`, norm: n / 600 } }; context.moshTick++ }
const until = async test => { for (let i = 0; !test(); i++) { if (i > 100) throw new Error('fake ACK test did not settle'); await tick() } }

const nativeRender=context.renderFeedbackKeys
let paintedKeys
const originalKeyFeedback=context.currentKeyFeedback
context.currentKeyFeedback=(...args)=>Object.fromEntries(Object.entries(originalKeyFeedback(...args)).map(([slot,r])=>[slot,{...r,display:{active:true,dim:true}}]))
context.renderFeedbackKeys=(...args)=>{paintedKeys=args[1];return nativeRender(...args)}
await context.repaint(true); assert.deepEqual(ids(first), full)
assert(paintedKeys.filter(Boolean).every(k=>k.active===true&&k.dim===true),'real repaint forwards authoritative display facts')
context.renderFeedbackKeys=nativeRender
context.currentKeyFeedback=originalKeyFeedback
await context.repaint(true)
first.calls = []; context.moshTick++
await context.repaint(false); assert.deepEqual(ids(first), [], 'unrelated tick does not send unchanged pixels')
const started = performance.now()
for (let i = 1; i <= 20; i++) { frame(i); await context.repaint(false) }
const wheelMs = performance.now() - started
assert.deepEqual(ids(first), Array(20).fill('knob'))
assert.equal(first.calls.reduce((n, call) => n + call.bytes, 0), 2_304_000)
first.calls = []
feedback = { ...feedback, TR: { ...feedback.TR, text: '12.5 %', norm: .125 } }
await context.repaint(false); assert.deepEqual(ids(first), ['right'], 'one parameter only redraws its strip')
first.calls = []; await context.repaint(true); assert.deepEqual(ids(first), full)

// Coalesce intermediate frames without converting the final pass into full force.
first.calls = []; first.holdNext = 'knob'; frame(21)
const held = context.repaint(false); await until(() => !!first.release)
frame(22); await context.repaint(false); frame(23); await context.repaint(false)
first.release(); first.release = null; await held; await until(() => !context.drawing)
assert.deepEqual(ids(first), ['knob', 'knob'])
assert.match(vm.runInContext('drawnSig', context), /23 f/, 'trailing update displays the latest frame')

// A real forced redraw queued during a draw must still invalidate every surface.
first.calls = []; first.holdNext = 'knob'; frame(24)
const forced = context.repaint(false); await until(() => !!first.release)
await context.repaint(true); first.release(); first.release = null; await forced; await until(() => !context.drawing)
assert.deepEqual(ids(first), ['knob', ...full])

first.calls = []; first.failNext = 'right'
feedback = { ...feedback, TR: { ...feedback.TR, text: '13 %', norm: .13 } }
await context.repaint(false); assert.deepEqual(ids(first), ['right']); assert.ok(messages.some(args => args[0] === 'draw failed:'))
first.calls = []; await context.repaint(false); assert.deepEqual(ids(first), full, 'failure never becomes a cached success')

// Retire the old device while it still owes an ACK. The replacement (same path)
// can draw immediately; the old continuation cannot write into or invalidate it.
first.calls = []; first.holdNext = 'center'
const retired = context.repaint(true); await until(() => !!first.release)
context.dev = null; await context.repaint(false)
const replacement = device(); context.dev = replacement
await context.repaint(false); assert.deepEqual(ids(replacement), full)
first.release(); first.release = null; await retired
assert.deepEqual(ids(first), ['center'], 'retired pass stops before the next surface')
replacement.calls = []; await context.repaint(false); assert.deepEqual(ids(replacement), [], 'old completion does not erase replacement cache')
context.stopping = true; await context.repaint(true); assert.deepEqual(ids(replacement), [])
console.log(`Screen cache passed: initial/unchanged/wheel/strip/force/coalescing/failure/device replacement; 20 wheel updates = 2304000 pixel bytes, ${wheelMs.toFixed(1)}ms raster+VM, no hardware`)
