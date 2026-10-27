// Exercise the actual async host function with deferred OS checks, no applications/devices.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {tdProfileSupported} from '../host/td-contract.mjs'
const text = fs.readFileSync(new URL('../host/deck-host.mjs', import.meta.url), 'utf8')
const source = text.slice(text.indexOf('async function switchTo('), text.indexOf('function appKey('))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function fixture({ connected = true } = {}) {
  const waits = [], enters = [], contexts = []
  const ctx = vm.createContext({
    cfg: { profiles: { main: { name:'Home',pages:[{name:'Home'}] }, moshpit:{name:'Moshpit',appId:'moshpit',app:{exe:'fake.exe'},pages:[{name:'IN'},{name:'FX'}]}, td:{name:'TD',appId:'td',app:{exe:'td.exe'},pages:[{name:'Source'}]} } },
    view:{profile:'main',page:0}, inputEpoch:0, switchRequest:0, switching:false, pendingPageEntry:null, passiveProfile:false, lastPage:{}, lastOfApp:{},
    home:{invalidate:()=>{}}, rotaryModifiers:{reset:()=>{}}, tdProfileSupported,
    win:{ running:async () => { const w=deferred(); waits.push(w); return w.promise }, focus:async ()=>'ok' },
    flash:()=>{},buzz:()=>{},log:()=>{},repaint:()=>{}, status:()=>contexts.push({...ctx.view}), rememberWorkspacePage:()=>{}, launch:()=>{}, wait:async()=>{},
    moshOf:()=>({connected:()=>connected,state:()=>({workspace:'browse'})}), followWorkspace:()=>{ctx.view.page=0;return true}, enterPage:()=>enters.push({...ctx.view}), process:{env:{},send:()=>{}},
  })
  vm.runInContext(source,ctx)
  return {ctx,waits,enters,contexts}
}
{
  const f=fixture(), promise=f.ctx.switchTo('moshpit','panel',2)
  assert.equal(f.ctx.view.profile,'main'); assert.equal(f.enters.length,0,'page cannot run on former profile while OS check waits')
  f.waits[0].resolve(true); await promise
  assert.equal(f.ctx.view.profile,'moshpit'); assert.equal(f.ctx.view.page,1)
  assert.deepEqual(f.enters,[{profile:'moshpit',page:1}],'requested page enters only its captured app')
}
{
  const f=fixture(), old=f.ctx.switchTo('moshpit','panel',2), newer=f.ctx.switchTo('td','panel',1)
  f.waits[1].resolve(true); await newer; f.waits[0].resolve(true); await old
  assert.equal(f.ctx.view.profile,'td'); assert.deepEqual(f.enters,[{profile:'td',page:0}],'late older launch never redirects current app')
}
{
  const f=fixture(), promise=f.ctx.switchTo('moshpit','panel',2)
  f.ctx.inputEpoch++; f.waits[0].resolve(true); await promise
  assert.equal(f.ctx.view.profile,'main'); assert.equal(f.enters.length,0,'Home or another navigation cancels delayed activation')
}
{
  const f=fixture(); await f.ctx.switchTo('moshpit','panel',99)
  assert.equal(f.waits.length,0); assert.equal(f.ctx.view.profile,'main','invalid requested page never starts activation')
}
{
  const f=fixture({connected:false}), promise=f.ctx.switchTo('moshpit','panel',2)
  f.waits[0].resolve(true); await promise
  assert.equal(f.enters.length,0); assert.equal(f.ctx.pendingPageEntry.profile,'moshpit'); assert.equal(f.ctx.pendingPageEntry.page,1,'explicit disconnected workspace remains pending until protocol readiness')
}
{
  const f=fixture(); f.ctx.cfg.profiles.moshpit.app.launch='must-not-launch.exe'
  f.ctx.launch=()=>{throw new Error('Profile-only selection launched an app')}
  f.ctx.win.focus=()=>{throw new Error('Profile-only selection stole focus')}
  await f.ctx.switchTo('moshpit','panel',1,true)
  assert.equal(f.ctx.view.profile,'moshpit'); assert.equal(f.waits.length,0)
  assert.equal(f.enters.length,0); assert.equal(f.ctx.pendingPageEntry,null)
}
{
  const f=fixture(); f.ctx.cfg.profiles.td.handoff=true
  f.ctx.process.send=()=>{throw new Error('Profile-only selection took over the hardware')}
  await f.ctx.switchTo('td','panel',undefined,true)
  assert.equal(f.ctx.view.profile,'main'); assert.equal(f.waits.length,0)
}
console.log('profile activation: 7 async target/page isolation checks passed (no OS input or hardware)')

// Published daily Home uses exact routes without candidate environment switches.
const tick=()=>new Promise(resolve=>setImmediate(resolve))
for(const id of ['moshpit','td']) {
  const f=fixture(), routes=[], launches=[], focused=[]
  f.ctx.cfg.profiles[id].appId=id==='td'?'touchdesigner':'moshpit'
  f.ctx.homeAppRoute=aid=>{routes.push(aid);return {file:'verified-'+aid+'.exe'}}
  f.ctx.launch=file=>launches.push(file);f.ctx.win.focus=async exe=>{focused.push(exe);return 'ok'}
  const promise=f.ctx.switchTo(id,'Home app');f.waits[0].resolve(false);await tick()
  assert.equal(f.waits.length,2);f.waits[1].resolve(true);await promise
  assert.deepEqual(routes,[f.ctx.cfg.profiles[id].appId]);assert.deepEqual(launches,['verified-'+routes[0]+'.exe'])
  assert.equal(focused.length,1);assert.equal(f.ctx.view.profile,id)
}
for(const error of ['Missing route','Changed release']) {
  const f=fixture(), notes=[], launches=[];f.ctx.homeAppRoute=()=>({error});f.ctx.flash=s=>notes.push(s);f.ctx.launch=p=>launches.push(p)
  const promise=f.ctx.switchTo('moshpit','Home app');f.waits[0].resolve(false);await promise
  assert.deepEqual(notes,[error]);assert.deepEqual(launches,[]);assert.equal(f.ctx.view.profile,'main')
}
for(const mode of ['running','profile-only','implicit','stale']) {
  const f=fixture(), launches=[];f.ctx.homeAppRoute=()=>{throw Error('Unexpected Home route: '+mode)};f.ctx.launch=p=>launches.push(p)
  const promise=f.ctx.switchTo('moshpit',mode==='implicit'?'panel':'Home app',undefined,mode==='profile-only')
  if(mode==='stale')f.ctx.inputEpoch++
  if(mode!=='profile-only')f.waits[0].resolve(mode==='running')
  await promise;assert.deepEqual(launches,[]);if(mode==='profile-only')assert.equal(f.waits.length,0)
}
{
  const f=fixture(), launches=[];f.ctx.homeAppRoute=()=>{throw Error('Other apps retain configured launch')};f.ctx.cfg.profiles.td.appId='resolve';f.ctx.cfg.profiles.td.app.launch='configured.exe';f.ctx.launch=p=>launches.push(p)
  const promise=f.ctx.switchTo('td','Home app');f.waits[0].resolve(false);await tick();f.waits[1].resolve(true);await promise
  assert.deepEqual(launches,['configured.exe'])
}
console.log('daily Home activation: pinned Moshpit/TD success, missing/changed refusal, already-running/profile-only/implicit/stale guards and other configured app launch passed; all OS/launch methods stubbed')
