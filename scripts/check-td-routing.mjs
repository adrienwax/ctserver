import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {execFileSync} from 'node:child_process'
import {loadConfig} from '../host/profiles.mjs'
import {tdProfileSupported,guardRigScript,rigStateMatches} from '../host/td-contract.mjs'
import {continuousFactor,discreteDelta} from '../host/rotary-modifiers.mjs'
const root=new URL('../',import.meta.url),ID='atlas-moshman-td-temporal-memory-abac500b'
const host=fs.readFileSync(new URL('../host/deck-host.mjs',import.meta.url),'utf8')
function config(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ct-routing-'))
 t.after(()=>{assert(dir.startsWith(path.join(os.tmpdir(),'ct-routing-')));fs.rmSync(dir,{recursive:true,force:true})})
 fs.cpSync(new URL('../config/profiles',import.meta.url),path.join(dir,'profiles'),{recursive:true})
 for(const name of ['apps.json','settings.json'])fs.copyFileSync(new URL('../config/'+name,import.meta.url),path.join(dir,name))
 return dir
}
function appChoice(cfg,lastOfApp={}){
 const selected=[],notes=[]
 const ctx=vm.createContext({cfg,lastOfApp,switchTo:id=>selected.push(id),flash:s=>notes.push(s),buzz(){}})
 vm.runInContext(host.slice(host.indexOf('function appKey('),host.indexOf('// ---- actions')),ctx)
 ctx.appKey('touchdesigner');return {selected,notes}
}
test('fresh TD entry selects guarded Temporal; legacy authored files stay intact and hidden normally',t=>{
 const dir=config(t),bytes=Object.fromEntries(['mega','template'].map(id=>[id,fs.readFileSync(path.join(dir,'profiles',id+'.json'))]))
 const cfg=loadConfig(dir);assert.deepEqual(cfg.errors,[])
 assert.equal(cfg.apps.touchdesigner.default,ID);assert.deepEqual(appChoice(cfg).selected,[ID])
 for(const id of ['mega','template']){assert.equal(cfg.profiles[id].tier,'legacy');assert.equal(tdProfileSupported(cfg.profiles[id]),false);assert.deepEqual(fs.readFileSync(path.join(dir,'profiles',id+'.json')),bytes[id])}
 assert.equal(tdProfileSupported(cfg.profiles.moshpit),true);assert.equal(cfg.profiles.moshpit.rigIdentity,undefined)
 const ui=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(new URL('../ui/profile-picker.js',import.meta.url),'utf8'),ui)
 const apps=Object.entries(cfg.apps).map(([id,a])=>({id,...a})),rows=ui.window.ProfilePicker.rowsFor(Object.values(cfg.profiles),[],apps)
 assert(rows.some(r=>r.profileId===ID));assert(!rows.some(r=>['mega','template'].includes(r.profileId)))
 const legacy=ui.window.ProfilePicker.rowsFor(Object.values(cfg.profiles),[],apps,true)
 assert(legacy.some(r=>r.profileId==='mega'),'authored mapping remains discoverable for editing')
 assert.equal(cfg.profiles['pick-touchdesigner'],undefined,'one current pilot needs no legacy chooser')
})
test('saved legacy start/default/lastOfApp and last-good recovery cannot resurrect TD dispatch',t=>{
 const dir=config(t)
 const apps=JSON.parse(fs.readFileSync(path.join(dir,'apps.json')));apps.touchdesigner.default='template';fs.writeFileSync(path.join(dir,'apps.json'),JSON.stringify(apps))
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({startProfile:'mega'}))
 loadConfig(dir) // establish a genuine old last-good copy
 fs.writeFileSync(path.join(dir,'profiles/mega.json'),'{broken')
 const cfg=loadConfig(dir)
 assert.equal(cfg.settings.startProfile,'main')
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'settings.json'))).startProfile,'mega','saved owner preference is not rewritten')
 assert(cfg.errors.some(e=>e.usingLastGood));assert.equal(cfg.profiles.mega.tier,'legacy')
 for(const stale of ['mega','template'])assert.deepEqual(appChoice(cfg,{touchdesigner:stale}).selected,[ID])
 delete cfg.profiles[ID];const missing=appChoice(cfg,{touchdesigner:'template'});assert.deepEqual(missing.selected,[]);assert.match(missing.notes[0],/no current profile/)
})
test('direct switch/picker bypass cannot activate legacy TD, including profile-only requests',t=>{
 const cfg=loadConfig(config(t)),notes=[]
 const ctx=vm.createContext({home:{invalidate(){}},cfg,tdProfileSupported,flash:s=>notes.push(s),buzz(){},view:{profile:'main',page:0}})
 vm.runInContext(host.slice(host.indexOf('async function switchTo('),host.indexOf('function appKey(')),ctx)
 return (async()=>{for(const id of ['mega','template'])for(const only of [false,true])await ctx.switchTo(id,'panel',1,only)
 assert.equal(notes.length,4);assert(notes.every(x=>/unavailable/.test(x)));assert.equal(ctx.view.profile,'main')})()
})
test('stale direct TD action cannot dispatch without supported profile identity',async t=>{
 const cfg=loadConfig(config(t)),sent=[],notes=[]
 let profile
 const ctx=vm.createContext({actionContext:()=>1,stopping:false,counts:{actions:0},ACTIONS:['td'],discreteDelta,continuousFactor,guardRigScript,tdProfileSupported,prof:()=>profile,cfg:{settings:{knobStep:.02}},
 tdCfg:{tdPaths:{},scaling:{},guards:{}},buildScript:()=> 'result=1',td:{exec:async s=>{sent.push(s);return {success:true}}},tdOk:false,readTd(){},flash:s=>notes.push(s),buzz(){}})
 vm.runInContext(host.slice(host.indexOf('async function act('),host.indexOf('function buzz()')),ctx)
 for(const p of [cfg.profiles.mega,cfg.profiles.template,{app:{target:'td'}},cfg.profiles.main]){
  profile=p;await ctx.act({td:{type:'rigPulse',par:'Toggleactive'}},'test',0,1)
 }
 assert.equal(sent.length,0);assert.equal(notes.length,4)
 profile=cfg.profiles[ID];await ctx.act({td:{type:'rigPulse',par:'Toggleactive'}},'test',0,1)
 assert.equal(sent.length,1);assert.match(sent[0],/Different TD project; action refused/)
 assert(sent[0].indexOf('assert str(')<sent[0].indexOf('result=1'))
 assert.equal(rigStateMatches({app:{target:'td'}},{values:{}}),false)
 assert.equal(rigStateMatches(cfg.profiles[ID],{values:{Projectid:'wrong'}}),false)
 assert.equal(rigStateMatches(cfg.profiles[ID],{values:{Projectid:cfg.profiles[ID].rigIdentity.value}}),true)
 assert.throws(()=>guardRigScript('write()',null),/unavailable/)
})
test('same-call Python identity guard denies wrong, missing parameter and missing rig before mutation',t=>{
 const cfg=loadConfig(config(t)),identity=cfg.profiles[ID].rigIdentity
 const script=guardRigScript("applied.append('write')",identity)
 const python=String.raw`
import json,sys
from types import SimpleNamespace
x=json.load(sys.stdin)
for kind in ['match','wrong','missing-par','missing-rig']:
 applied=[]
 if kind=='missing-rig': rig=None
 elif kind=='missing-par': rig=SimpleNamespace(par=SimpleNamespace())
 else: rig=SimpleNamespace(par=SimpleNamespace(Projectid=SimpleNamespace(eval=lambda: x['identity'] if kind=='match' else 'wrong')))
 try: exec(x['script'],{'op':lambda path:rig,'applied':applied})
 except (AssertionError,AttributeError): pass
 assert applied==(['write'] if kind=='match' else []),(kind,applied)
print('same-call matching/missing/wrong rig guard passed')
`
 const output=execFileSync(process.env.CT_TEST_PYTHON||'python',['-c',python],{input:JSON.stringify({script,identity:identity.value}),encoding:'utf8',windowsHide:true})
 assert.match(output,/guard passed/)
})

function focusFixture(cfg){
 const ctx=vm.createContext({cfg,view:{profile:'main',page:0},dev:{},stopping:false,switching:false,inputEpoch:0,pendingPageEntry:null,lastPage:{},
  prof:()=>ctx.cfg.profiles[ctx.view.profile],tdProfileSupported,exeName:s=>s,
  win:{front:async()=> 'touchdesigner.exe'},rotaryModifiers:{reset(){}},lanes:{clear(){}},log(){},repaint(){},status(){},
  every:fn=>{ctx.poll=fn;return null},
 })
 vm.runInContext(host.slice(host.indexOf('let focusSeen ='),host.indexOf("// TD's state,")),ctx)
 return ctx
}
test('focus-follow cannot reactivate authored legacy TD mappings',async t=>{
 const cfg=loadConfig(config(t));cfg.profiles.mega.followFocus=true;cfg.profiles.template.followFocus=true
 const ctx=focusFixture(cfg);await ctx.poll();await ctx.poll();assert.equal(ctx.view.profile,'main')
})
test('focus-follow selects supported TD and still permits app-wide Moshpit',async t=>{
 const cfg=loadConfig(config(t));cfg.profiles.mega.followFocus=true;cfg.profiles[ID].followFocus=true;cfg.profiles.moshpit.followFocus=true
 const ctx=focusFixture(cfg);await ctx.poll();await ctx.poll();assert.equal(ctx.view.profile,ID)
 ctx.win.front=async()=>cfg.profiles.moshpit.app.exe.toLowerCase()
 await ctx.poll();await ctx.poll();assert.equal(ctx.view.profile,'moshpit')
})
test('focus-follow discards stale foreground replies after navigation or profile eligibility changes',async t=>{
 const original=loadConfig(config(t))
 for(const change of ['navigation','replacement','identity']){
  const cfg=structuredClone(original);cfg.profiles[ID].followFocus=true
  const ctx=focusFixture(cfg);await ctx.poll()
  let done;ctx.win.front=()=>new Promise(resolve=>done=resolve)
  const pending=ctx.poll()
  if(change==='navigation')ctx.inputEpoch++
  else if(change==='replacement')cfg.profiles[ID]={...cfg.profiles[ID]}
  else delete cfg.profiles[ID].rigIdentity
  done('touchdesigner.exe');await pending;assert.equal(ctx.view.profile,'main',change)
 }
})
