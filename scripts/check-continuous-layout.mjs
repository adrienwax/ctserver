// Profile and real host dispatch checks only: no hardware, installed config or Windows input.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { ctResolve, BANKS, bankLabel } from '../host/moshpit-client.mjs'
import { checkProfile } from '../host/profiles.mjs'
import { captureAction, createActionQueue } from '../host/action-queue.mjs'
import { dialFeedback } from '../host/dial-feedback.mjs'

const profile = JSON.parse(fs.readFileSync(new URL('../config/profiles/moshpit.json', import.meta.url)))
const apps = JSON.parse(fs.readFileSync(new URL('../config/apps.json', import.meta.url)))
assert.deepEqual(checkProfile(profile, ['main','moshpit'], apps), [])
for (const page of profile.pages.slice(1, 3)) {
  assert.ok(Object.values(page.keys).every(k => !k.hold), 'center-screen keys have no unsupported hold actions')
  assert.deepEqual(Object.values(page.dials).map(d => d.turn.moshpit.bank), [1,2,3,4,5,6])
  assert.ok(Object.values(page.dials).every(d => d.turn.moshpit.bankWidth === 6 && d.turn.moshpit.verb === 'knob' && d.press.moshpit.verb === 'reset'))
  assert.equal(page.keys[4].do.moshpit.step, -1); assert.equal(page.keys[5].do.moshpit.step, 1)
  assert.equal(page.keys[6].do.moshpit.width, 6)
  assert.equal(page.keys[10].do.moshpit.command, 'block.prev'); assert.equal(page.keys[11].do.moshpit.command, 'block.next')
}
assert.equal(profile.pages[1].keys[9].do.moshpit.command, 'workspace.node')
assert.equal(profile.pages[2].keys[9].do.moshpit.command, 'workspace.mosh')
const bad = structuredClone(profile); bad.pages[1].dials.TL.turn.moshpit.bankWidth = 4
assert.ok(checkProfile(bad, ['main','moshpit'], apps).some(s => s.includes('bankWidth')))
const badStep = structuredClone(profile); badStep.pages[1].keys[4].do.moshpit.step = -2
assert.ok(checkProfile(badStep, ['main','moshpit'], apps).some(s => s.includes('step')))
for (let b = 0; b < 3; b++) {
  assert.equal(bankLabel(6,b), ['P1-6','P7-8','LFO'][b]); assert.equal(bankLabel(undefined,b), BANKS[b])
  for (let n = 1; n <= 6; n++) {
    const resolved = ctResolve({verb:'knob',slot:'sel',bank:n,bankWidth:6}, 7, b)
    if (b === 0 || b === 1 && n <= 2) assert.deepEqual(resolved, {verb:'knob',slot:7,param:b*6+n})
    else if (b === 2 && n <= 2) assert.deepEqual(resolved, {verb:'knob',lfo:1,field:n === 1 ? 'period' : 'phase'})
    else assert.equal(resolved, null)
  }
  for (let n = 1; n <= 3; n++) {
    const legacy = ctResolve({verb:'knob',slot:'sel',bank:n}, 2, b)
    if (b < 2) assert.equal(legacy.param, b*3+n)
    else if (n === 3) assert.equal(legacy,null)
  }
}

const host = fs.readFileSync(new URL('../host/deck-host.mjs', import.meta.url), 'utf8')
const selection = {moshpit:4}, banks = {moshpit:0}, picked = [], writes = []
const slots = Array.from({length:9},(_,i)=>({nodeId:`n${i+1}`}))
const client = { state:()=>({slots,generation:3}), connected:()=>true,
  select:async id=>picked.push(id), resolve:a=>a.slot && a.param ? `/block/b/node/n${a.slot}/param/p${a.param}` : null,
  act:async(a,delta)=>writes.push([a,delta]) }
const ctx = vm.createContext({captureAction,sel:selection,bank:banks,prof:()=>({appId:'moshpit'}),moshOf:()=>client,
  buzz:()=>{},repaint:()=>{},status:()=>{},flash:()=>{},inputEpoch:0,moshTick:0,
  actionContext:()=> 'same',stopping:false,counts:{actions:0},ACTIONS:['moshpit'],discreteDelta:n=>n,BANKS})
vm.runInContext(host.slice(host.indexOf('function run(action'),host.indexOf('function buzz()',host.indexOf('function run(action'))),ctx)
await ctx.act(profile.pages[1].keys[4].do,'node previous',0); assert.equal(selection.moshpit,3)
for(let i=0;i<8;i++)await ctx.act(profile.pages[1].keys[5].do,'node next',0)
assert.equal(selection.moshpit,9); assert.equal(picked.at(-1),'n9','screen next reaches nodes beyond direct tiles')
const epochs=[]
for(let i=0;i<3;i++){await ctx.act(profile.pages[1].keys[6].do,'parameter page',0);epochs.push(vm.runInContext('inputEpoch',ctx))}
assert.equal(banks.moshpit,0); assert.ok(epochs[1]>epochs[0] && epochs[2]>epochs[1],'every parameter page changes input epoch')
const d=profile.pages[1].dials.TL.turn
const captured=captureAction(d,client,9,1)
assert.equal(captured.moshpit.path,'/block/b/node/n9/param/p7')
assert.equal(captured.moshpit.generation,3)
await ctx.act(captured,'turn',1);assert.equal(writes.at(-1)[0].path,captured.moshpit.path)
let epoch=0, release; const applied=[]
const wait=new Promise(r=>release=r)
const q=createActionQueue({context:()=>epoch,execute:async job=>{applied.push(job.action);if(applied.length===1)await wait}})
q.run('TL',captured,'turn',1);q.run('TL',captured,'turn',1);epoch++
q.run('TL',captureAction(d,client,9,0),'turn',1);release();await new Promise(r=>setImmediate(r))
assert.deepEqual(applied.map(a=>a.moshpit.path),['/block/b/node/n9/param/p7','/block/b/node/n9/param/p1'],'bank change discards pending old-target turns')
const sparse={connected:()=>true,state:()=>({slots}),label:()=>'',reading:a=>a.param===1?{param:{type:'float'},value:42,norm:.42}:null}
const reading=dialFeedback({page:profile.pages[1],client:sparse,selection:1})
assert.equal(reading.TL.text,'42')
for(const key of ['CL','BL','TR','CR','BR'])assert.deepEqual([reading[key].label,reading[key].text,reading[key].available],['','',false])
console.log('continuous layout ok: all six mappings, legacy banks, P7/8/LFO, sparse nodes, screen navigation, epoch and stale queue safety')
