// Actual firmware parser -> host input handlers, queue and adapter. No CT, OS keys or app.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { LoupedeckCT } from '../integrations/ct-td-control/node_modules/loupedeck/device.js'
import { createRotaryModifiers, continuousFactor, discreteDelta, volumeChunks } from '../host/rotary-modifiers.mjs'
import { createActionQueue } from '../host/action-queue.mjs'
import { createMoshpitClient } from '../host/moshpit-client.mjs'
import { guardRigScript, tdProfileSupported } from '../host/td-contract.mjs'
import { buildScript } from '../integrations/ct-td-control/ct-td-map.mjs'

const source=fs.readFileSync(new URL('../host/deck-host.mjs',import.meta.url),'utf8')
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const device=new LoupedeckCT({autoConnect:false,reconnectInterval:0})
const rotaryModifiers=createRotaryModifiers(), calls=[]
const pg={ dials:Object.fromEntries(['TL','CL','BL','TR','CR','BR'].map(id=>[id,{turn:{volume:1}}])), wheel:{turn:{volume:1}},
 buttons:Object.fromEntries(['a','b','c','d','keyboard','fnL','fnR'].map(id=>[id,{do:{keys:id}}])) }
const ctx=vm.createContext({view:{profile:"moshpit"},home:{move(){},select(){}},dev:device,rotaryModifiers,lastInput:0,quietWarned:0,lastEvent:'',stopping:false,process:{},
 onTouch:()=>{},onStrip:()=>{},page:()=>pg,prof:()=>({}),BUTTONS:['a','b','c','d','keyboard','fnL','fnR','undo'],inputEpoch:0,
 holds:new Map(),actionContext:()=>1,cfg:{settings:{}},setTimeout,clearTimeout,buzz:()=>{},goRound:()=>{},goMain:()=>{},
 run:(action,what,delta=0,mode='normal')=>calls.push({action,what,delta,mode}),log:()=>{},reconnect:()=>rotaryModifiers.reset(),
})
vm.runInContext(source.slice(source.indexOf('function wire('),source.indexOf('// Strips always')),ctx)
ctx.wire(device)
const down=code=>device.onButton(Buffer.from([code,0]))
const up=code=>device.onButton(Buffer.from([code,1]))
const turn=(code,delta=1)=>device.onRotate(Buffer.from([code,delta&255]))
down(0x11) // Keyboard, not FnL
for(let id=0;id<=6;id++)turn(id)
assert.equal(calls.length,7);assert.ok(calls.every(c=>c.mode==='fine'))
down(0x14);turn(0);assert.equal(calls.at(-1).mode,'fine','Keyboard takes priority over Fn')
up(0x11);turn(0,-3);assert.equal(calls.at(-1).mode,'coarse');assert.equal(calls.at(-1).delta,-3)
up(0x14);turn(0);assert.equal(calls.at(-1).mode,'normal')
down(0x17);turn(6);assert.equal(calls.at(-1).mode,'coarse','either physical Fn is fast')
const before=calls.length
for(const code of [0x15,0x18,0x16,0x19])down(code)
assert.equal(calls.length,before+4);assert.ok(calls.slice(-4).every(c=>c.mode==='normal'),'ABCD never inherit held rotary mode')
assert.ok(!calls.some(c=>['keyboard','fnL','fnR'].includes(c.what)),'modifier press is reserved, never sends existing OS binding')
device.emit('disconnect');turn(1);assert.equal(calls.at(-1).mode,'normal')

// Firmware Undo 0x10: Fn chord is one native command, never a Windows shortcut.
// Fake only the hold clock; the parser and host button handlers above are real.
const timers=new Map();let timerId=0
ctx.setTimeout=fn=>{timers.set(++timerId,fn);return timerId}
ctx.clearTimeout=id=>timers.delete(id)
const undo={moshpit:{verb:'command',command:'edit.undo'}},redo={moshpit:{verb:'command',command:'edit.redo'}}
pg.buttons.undo={do:undo,hold:redo}
const fired=()=>{for(const [id,fn] of timers){timers.delete(id);fn()}}
const historyCalls=()=>calls.filter(c=>c.what==='undo'||c.what==='undo (hold)')
for(const fn of [0x14,0x17])for(const releaseFnFirst of [false,true]){
  const n=historyCalls().length
  down(fn);down(0x10);down(0x10)
  fired()
  if(releaseFnFirst){up(fn);up(0x10)}else{up(0x10);up(fn)}
  assert.equal(historyCalls().length,n+1)
  assert.equal(historyCalls().at(-1).action.moshpit.command,'edit.redo')
}
down(0x11);down(0x14);down(0x10);up(0x10);up(0x14)
assert.equal(historyCalls().at(-1).action.moshpit.command,'edit.redo','Keyboard fine priority does not hide held Fn')
down(0x10);up(0x10);up(0x11)
assert.equal(historyCalls().at(-1).action.moshpit.command,'edit.undo','Keyboard alone is not Redo')
let historyCount=historyCalls().length
down(0x10);assert.equal(historyCalls().length,historyCount);up(0x10)
assert.equal(historyCalls().length,historyCount+1);assert.equal(historyCalls().at(-1).action.moshpit.command,'edit.undo')
historyCount=historyCalls().length
down(0x10);fired();up(0x10)
assert.equal(historyCalls().length,historyCount+1);assert.equal(historyCalls().at(-1).action.moshpit.command,'edit.redo','existing long-press remains')
down(0x10);down(0x14);up(0x10);up(0x14)
assert.equal(historyCalls().at(-1).action.moshpit.command,'edit.undo','Fn pressed after Undo does not relabel its pending tap')
pg.buttons.undo={do:{keys:'ctrl+z'}}
down(0x14);down(0x10);up(0x10);up(0x14)
assert.equal(historyCalls().at(-1).action.keys,'ctrl+z','owner remapping remains untouched')
pg.buttons.undo={do:undo,hold:redo}
down(0x14);down(0x10);rotaryModifiers.reset();ctx.inputEpoch++
historyCount=historyCalls().length
down(0x10);fired();up(0x10)
assert.equal(historyCalls().length,historyCount,'context changes cannot retrigger the same held physical press')
down(0x10);up(0x10)
assert.equal(historyCalls().at(-1).action.moshpit.command,'edit.undo','next physical tap after release works normally')
down(0x14);down(0x10);rotaryModifiers.reset()
const replacement=new LoupedeckCT({autoConnect:false,reconnectInterval:0})
ctx.dev=replacement;ctx.wire(replacement)
replacement.onButton(Buffer.from([0x10,0]));replacement.onButton(Buffer.from([0x10,1]))
assert.equal(historyCalls().at(-1).action.moshpit.command,'edit.undo','a replacement device is not latched by the retired device')
ctx.dev=device
assert.equal(timers.size,0)
down(0x11);ctx.dev=null;up(0x11);const stale=calls.length;turn(1);assert.equal(calls.length,stale,'old device input cannot affect a new owner')
rotaryModifiers.reset();assert.equal(rotaryModifiers.mode(),'normal')

// Navigation executes the real host bodies, including clearing held state.
const nav=vm.createContext({home:{setProfile(){},reset(){}},rotaryModifiers,inputEpoch:0,pendingPageEntry:null,view:{profile:'moshpit',page:0},
 lastPage:{},workspacePages:{},page:()=>({}),prof:()=>({pages:[{},{}]}),pageWorkspace:()=>null,
 workspacePage:()=>1,WORKSPACES:[],repaint:()=>{},status:()=>{},enterPage:()=>{},buzz:()=>{},
})
vm.runInContext(source.slice(source.indexOf('function rememberWorkspacePage('),source.indexOf('// A page\'s "enter"')),nav)
for(const op of [()=>nav.goPage(2),()=>nav.goRound(1),()=>nav.followWorkspace('mash'),()=>nav.goMain()]){
 nav.view={profile:'moshpit',page:0};rotaryModifiers.down('keyboard');op();assert.equal(rotaryModifiers.mode(),'normal')
}

// Queue captures the mode per event; releasing it cannot relabel an ACK-blocked burst.
let release, jobs=[]
const queue=createActionQueue({context:()=>1,execute:async job=>{jobs.push(job);if(jobs.length===1)await new Promise(r=>release=r)}})
const step={moshpit:{verb:'step',commands:['transport.prevFrame','transport.nextFrame']}}
queue.run('wheel',step,'wheel',1,'normal');queue.run('wheel',step,'wheel',26,'coarse');queue.run('wheel',step,'wheel',-2,'fine')
release();await tick()
assert.deepEqual(jobs.map(j=>[j.delta,j.mode]),[[1,'normal'],[10,'coarse'],[10,'coarse'],[6,'coarse'],[-2,'fine']])

// Actual focus-follow poll: only a confirmed switch clears the held mode and an ACK-blocked
// rotary tail. A new profile's first detent is normal even if no key-up arrived from the old one.
{
 let poll, front='td.exe', finish, started=[]
 const held=createRotaryModifiers()
 const focus=vm.createContext({tdProfileSupported,rotaryModifiers:held,inputEpoch:0,pendingPageEntry:{profile:'moshpit',page:1},
  view:{profile:'moshpit',page:0},lastPage:{td:1},dev:{},stopping:false,switching:false,
  cfg:{profiles:{moshpit:{id:'moshpit',name:'Moshpit',followFocus:true,app:{exe:'moshpit.exe'}},td:{id:'td',name:'TD',followFocus:true,app:{exe:'td.exe'}}}},
  prof:()=>({sticky:false}),win:{front:async()=>front},exeName:value=>value,
  // The host owns intervals through its lifecycle registry; capture only this poll callback.
  every:fn=>{poll=fn;return 1},log:()=>{},repaint:()=>{},status:()=>{},
 })
 const lanes=createActionQueue({context:()=>focus.inputEpoch,execute:async job=>{started.push(job);if(started.length===1)await new Promise(resolve=>finish=resolve)}})
 focus.lanes=lanes
 vm.runInContext(source.slice(source.indexOf('let focusSeen ='),source.indexOf('// TD\'s state, while')),focus)
 held.down('keyboard');lanes.run('wheel',step,'wheel',1,held.mode());lanes.run('wheel',step,'wheel',8,held.mode())
 await poll();assert.equal(held.mode(),'fine','one focus observation is not a profile boundary');assert.equal(focus.inputEpoch,0)
 await poll();assert.equal(focus.view.profile,'td');assert.equal(focus.view.page,1);assert.equal(held.mode(),'normal');assert.equal(focus.pendingPageEntry,null)
 finish();await tick();assert.equal(started.length,1,'unsent old-profile rotary tail is discarded')
 lanes.run('wheel',step,'wheel',1,held.mode());await tick();assert.equal(started.at(-1).mode,'normal');assert.equal(started.at(-1).context,1)
 held.down('fnR');front='moshpit.exe';await poll();await poll();assert.equal(held.mode(),'normal','focus-follow also releases coarse Fn mode')
 assert.equal(focus.inputEpoch,2)
}

assert.equal(continuousFactor('fine'),.1);assert.equal(continuousFactor('coarse'),10)
assert.equal(discreteDelta(1,'fine'),1);assert.equal(discreteDelta(-3,'coarse'),-15)
const volumes=[];await volumeChunks(57,n=>volumes.push(n));assert.deepEqual(volumes,[20,20,17])
let current=true;const cancelled=[];await volumeChunks(-57,async n=>{cancelled.push(n);current=false},()=>current);assert.deepEqual(cancelled,[-20])
assert.match(buildScript({type:'rigClipStep',step:-15},{},{},{}),/\+\(-15\)/,'TD clip step retains magnitude')

// Execute the actual host act() for system/TD values, not just the scaling helper.
const sent=[]
const actCtx=vm.createContext({page:()=>({}),actionContext:()=>1,stopping:false,counts:{actions:0},ACTIONS:['volume','scroll','td','keys'],
 discreteDelta,continuousFactor,volumeChunks,guardRigScript,tdProfileSupported,prof:()=>({rigIdentity:{parameter:'Projectid',value:'test-rig'}}),cfg:{settings:{knobStep:.02}},
 win:{volume:async n=>{sent.push(['volume',n]);return'ok'},scroll:async n=>{sent.push(['scroll',n]);return'ok'},keys:async n=>{sent.push(['keys',n]);return'ok'}},
 tdCfg:{tdPaths:{},scaling:{},guards:{}},buildScript:t=>{sent.push(['td',t]);return'test'},td:{exec:async()=>({success:true})},tdOk:null,readTd:()=>{},
})
vm.runInContext(source.slice(source.indexOf('async function act('),source.indexOf('const hex =')),actCtx)
await actCtx.act({volume:1},'turn TL',11,1,'coarse')
assert.deepEqual(sent.splice(0),[['volume',20],['volume',20],['volume',15]])
await actCtx.act({scroll:1},'turn TR',-4,1,'coarse');assert.deepEqual(sent.splice(0),[['scroll',-20]])
await actCtx.act({keys:['left','right']},'turn TR',12,1,'normal');assert.equal(sent.length,12,'coalesced shortcuts do not silently lose detents above ten');sent.length=0
await actCtx.act({td:{type:'rigKnob',par:'Speed'}},'turn TL',3,1,'fine');assert.equal(sent[0][1].delta,.006);sent.length=0
await actCtx.act({td:{type:'rigKnob',par:'Speed'}},'turn TL',3,1,'coarse');assert.equal(sent[0][1].delta,.6);sent.length=0
await actCtx.act({td:{type:'rigClipStep'}},'turn BL',-3,1,'coarse');assert.equal(sent[0][1].step,-15)

for(const supported of [false,true]){
 const messages=[]
 class Socket{
  constructor(){this.readyState=1;queueMicrotask(()=>this.onopen?.())}
  send(raw){const m=JSON.parse(raw);messages.push(m);let reply={type:'ack',id:m.id}
   if(m.type==='hello')reply={...reply,version:1,caps:[]}
   if(m.type==='discover')reply={...reply,generation:1,targets:[],slots:[],caps:supported?['rotary-command-mode.v1']:[]}
   queueMicrotask(()=>this.onmessage?.({data:JSON.stringify(reply)}))
  }
  close(){this.readyState=3;queueMicrotask(()=>this.onclose?.())}
 }
 const client=createMoshpitClient({endpoint:'ws://offline.invalid',WebSocketImpl:Socket})
 try{
  client.start();await tick();assert.ok(client.connected())
  await client.act(step.moshpit,3,'normal')
  assert.equal(messages.at(-1).repeat,3);assert.equal(messages.at(-1).mode,supported?'normal':undefined)
  if(supported){await client.act(step.moshpit,-2,'coarse');assert.equal(messages.at(-1).mode,'coarse');assert.equal(messages.at(-1).repeat,2)}
  else await assert.rejects(client.act(step.moshpit,1,'fine'),/Update Moshpit/)
  await client.act({verb:'command',command:'transport.play'},0,'coarse');assert.equal(messages.at(-1).mode,undefined,'buttons do not gain rotary mode')
 }finally{client.stop()}
}
console.log('rotary modifiers: parser, all seven encoders, ABCD isolation, context reset, captured ACK queue, Home/TD scaling and protocol capability checks passed (no hardware/OS/app)')
