import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {createProjectLibrary} from '../host/project-library.mjs'
const sha=s=>createHash('sha256').update(s).digest('hex')
function setup(t, hooks={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ct-projects-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  fs.mkdirSync(path.join(dir,'profiles'))
  const write=(name,obj)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(obj))
  write('apps.json',{td:{name:'TouchDesigner',target:'td'}})
  write('profiles/pilot.json',{name:'Pilot',app:'td',pages:[{name:'SET'}],metadata:{author:'Waxy',version:'1'}})
  const file=path.join(dir,'pilot.toe'),runtime=path.join(dir,'TouchDesigner.exe')
  fs.writeFileSync(file,'project');fs.writeFileSync(runtime,'application')
  const entry={id:'pilot-v1',profileId:'pilot',appId:'td',title:'Temporal Memory',author:'Waxy',version:'1',approved:true,file:{path:file,sha256:sha('project')},runtime:{path:runtime,sha256:sha('application')}}
  const register=(entries=[entry])=>write('projects.json',{schemaVersion:1,projects:entries})
  register()
  const calls=[]
  const library=createProjectLibrary({configDir:dir,processes:async()=>[],launch:async(...args)=>{calls.push(args);return {pid:17}},...hooks})
  const open=()=>library.open({profileId:'pilot',projectId:'pilot-v1'})
  return {dir,write,file,runtime,entry,register,library,open,calls}
}
test('inventory is passive; explicit launch uses only pinned runtime and project',async t=>{
  const s=setup(t);assert.equal(s.library.list().projects[0].status,'ready');assert.equal(s.calls.length,0)
  assert.deepEqual(await s.open(),{ok:true,status:'dispatched',pid:17,projectId:'pilot-v1',profileId:'pilot'})
  assert.deepEqual(s.calls,[[s.runtime,s.file]])
  assert.equal((await s.open()).ok,false)
})
test('unlinked profile metadata remains discoverable',t=>{
  const s=setup(t);s.register([]);const row=s.library.list().projects[0]
  assert.equal(row.status,'unconfigured');assert.equal(row.author,'Waxy');assert.equal(row.canOpen,false)
})
test('missing files and changed pins refuse',async t=>{
  const s=setup(t);fs.writeFileSync(s.file,'changed');assert.equal(s.library.list().projects[0].status,'changed');assert.equal((await s.open()).ok,false)
  fs.unlinkSync(s.file);assert.equal(s.library.list().projects[0].status,'missing');assert.equal(s.calls.length,0)
})
test('imported launch arguments or commands cannot execute',async t=>{
  const s=setup(t);s.entry.args=['--command','bad'];s.register();assert.equal((await s.open()).ok,false);assert.equal(s.calls.length,0)
})
test('wrong app, extension, runtime, approval and duplicate IDs refuse',async t=>{
  const s=setup(t);const original=structuredClone(s.entry)
  for(const patch of [{appId:'other'},{approved:false},{runtime:{path:s.file,sha256:sha('project')}},{file:{path:s.runtime,sha256:sha('application')}}]) {
    s.register([{...original,...patch}]);assert.equal((await s.open()).ok,false)
  }
  s.register([original,original]);assert.equal((await s.open()).ok,false);assert.equal(s.calls.length,0)
})
test('any running TD refuses, including unknown executable path',async t=>{
  const s=setup(t,{processes:async()=>[{Name:'TouchDesigner.exe',ExecutablePath:null}]})
  assert.match((await s.open()).error,/already open/);assert.equal(s.calls.length,0)
})
test('process inspection failure refuses',async t=>{
  const s=setup(t,{processes:async()=>{throw new Error('inspection unavailable')}})
  assert.equal((await s.open()).ok,false);assert.equal(s.calls.length,0)
})
test('identity changed during process inspection refuses',async t=>{
  let s;s=setup(t,{processes:async()=>{fs.writeFileSync(s.file,'changed');return []}})
  assert.equal((await s.open()).ok,false);assert.equal(s.calls.length,0)
})
test('profile removed or parked during process inspection refuses',async t=>{
  let s;s=setup(t,{processes:async()=>{fs.unlinkSync(path.join(s.dir,'profiles/pilot.json'));return []}})
  assert.equal((await s.open()).ok,false);assert.equal(s.calls.length,0)
})
test('concurrent opens are serialized, no duplicate launches',async t=>{
  let release;const wait=new Promise(r=>release=r)
  const s=setup(t,{processes:async()=>{await wait;return []}})
  const first=s.open();assert.equal((await s.open()).ok,false);release();assert.equal((await first).ok,true);assert.equal(s.calls.length,1)
})
test('native spawn failure is not success and can be retried explicitly',async t=>{
  const s=setup(t,{launch:async()=>{throw new Error('spawn refused')}})
  assert.equal((await s.open()).error,'spawn refused')
  assert.equal((await s.open()).error,'spawn refused')
})
test('malformed registry and unknown IDs fail closed',async t=>{
  const s=setup(t);fs.writeFileSync(path.join(s.dir,'projects.json'),'{bad')
  assert.equal(s.library.list().projects[0].status,'unsupported');assert.equal((await s.open()).ok,false)
  assert.equal((await s.library.open({profileId:'../pilot',projectId:'pilot-v1'})).ok,false)
})
test('Home cancellation during process inspection prevents project dispatch',async t=>{let release;const wait=new Promise(r=>release=r);let current=true;const s=setup(t,{processes:async()=>{await wait;return []}});const pending=s.library.open({profileId:'pilot',projectId:'pilot-v1'},()=>current);current=false;release();assert.equal((await pending).ok,false);assert.equal(s.calls.length,0)});
