import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {nativeWorkspacePage} from '../host/workspace-pages.mjs'
import {checkProfile} from '../host/profiles.mjs'
const source=fs.readFileSync(new URL('../host/deck-host.mjs',import.meta.url),'utf8')
const poll=source.slice(source.indexOf('async function pollNative()'),source.indexOf('let moshTick ='))
function fixture({pending=null,passive=false,up=false,next='Geometry Nodes'}={}){
 const profile={id:'blender',followWorkspace:true,pages:[{nativeWorkspace:'Layout'},{nativeWorkspace:'Geometry Nodes'}]}
 let connected=up,state={workspace:'Layout'},enters=0,resets=0
 const client={connected:()=>connected,state:()=>state,refresh:async()=>{connected=true;state={workspace:next}}}
 const ctx=vm.createContext({prof:()=>profile,nativeOf:()=>client,inputEpoch:0,stopping:false,passiveProfile:passive,pendingPageEntry:pending,view:{profile:'blender',page:0},lastPage:{},nativeWorkspacePage,enterPage(){enters++},rotaryModifiers:{reset(){resets++}},repaint(){},status(){}})
 vm.runInContext(poll,ctx)
 return {ctx,poll:()=>ctx.pollNative(),enters:()=>enters,resets:()=>resets}
}
for(const passive of [false,true]){
 const f=fixture({passive});await f.poll();assert.equal(f.ctx.view.page,1);assert.equal(f.enters(),0);assert.equal(f.resets(),1)
}
{
 const f=fixture({pending:{profile:'blender',page:0}});await f.poll();assert.equal(f.enters(),1);assert.equal(f.ctx.pendingPageEntry,null);assert.equal(f.ctx.view.page,0)
 await f.poll();assert.equal(f.enters(),1,'explicit entry is not repeated')
}
{
 const f=fixture({pending:{profile:'other',page:0}});await f.poll();assert.equal(f.enters(),0);assert.equal(f.ctx.view.page,1)
}
{
 const f=fixture({next:'Unknown'});await f.poll();assert.equal(f.enters(),0);assert.equal(f.ctx.view.page,0)
}
{
 const f=fixture({up:true});await f.poll();assert.equal(f.enters(),0);assert.equal(f.ctx.view.page,1)
}
for(const app of [{exe:'Other.exe',target:'native',driver:'windows-media'},{exe:'Other.exe',target:'native',endpointFile:'E:/test.json'},{exe:'Other.exe',target:'keys',driver:'windows-media'}]){
 assert(checkProfile({name:'Inline',app,pages:[{name:'Test'}]},[]).some(e=>e.includes('registered app')))
}
assert.deepEqual(checkProfile({name:'Legacy keys',app:{exe:'Other.exe',target:'keys'},pages:[{name:'Test'}]},[]),[])
assert.deepEqual(checkProfile({name:'Registered',app:'spotify',pages:[{name:'Test'}]},[],{spotify:{exe:'Spotify.exe',target:'native',driver:'windows-media'}}),[])
console.log('PASS reconnect follows observed workspace, explicit pending entry once, no unknown-workspace write; inline native drivers rejected')

function navigationFixture(connectedInitially=false){
 const actions=[];let connected=connectedInitially
 const p={id:'blender',appId:'blender',name:'Blender',app:{target:'native'},followWorkspace:true,pages:[{name:'VIEW',nativeWorkspace:'Layout',enter:{native:{verb:'command',command:'workspace.layout'}}},{name:'NODES',nativeWorkspace:'Geometry Nodes',enter:{native:{verb:'command',command:'workspace.geometry-nodes'}}}]}
 const client={connected:()=>connected,state:()=>({workspace:'Layout'}),refresh:async()=>{connected=true}}
 const ctx=vm.createContext({cfg:{profiles:{blender:p}},view:{profile:'blender',page:0},prof:()=>p,page:()=>p.pages[ctx.view.page],nativeOf:()=>client,moshOf:()=>null,inputEpoch:0,stopping:false,passiveProfile:false,pendingPageEntry:null,switchRequest:0,switching:false,lastPage:{},lastOfApp:{},nativeWorkspacePage,rotaryModifiers:{reset(){}},rememberWorkspacePage(){},repaint(){},status(){},buzz(){},log(){},flash(){},run:a=>actions.push(a),tdProfileSupported:()=>true,process:{env:{}},home:{invalidate(){}}})
 const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)))
 vm.runInContext(poll+slice('function goRound(', '// An app key on Home'),ctx)
 return {ctx,actions,profile:p,poll:()=>ctx.pollNative()}
}
for(const select of [f=>f.ctx.goPage(2),f=>f.ctx.goRound(2),f=>f.ctx.switchTo('blender','Home',2)]){
 const f=navigationFixture();await select(f)
 assert.equal(f.ctx.pendingPageEntry.page,1,'actual caller stores disconnected request');assert.equal(f.actions.length,0)
 await f.poll();assert.equal(f.actions.length,1);assert.equal(f.actions[0].native.command,'workspace.geometry-nodes');assert.equal(f.ctx.pendingPageEntry,null)
}
for(const connected of [false,true]){
 const f=navigationFixture(connected);await f.ctx.switchTo('blender','Home')
 assert.equal(f.ctx.pendingPageEntry,null);await f.poll();assert.equal(f.actions.length,0,'ordinary profile activation must not change workspace')
}
{
 const f=navigationFixture();f.ctx.goPage(2);await f.ctx.switchTo('blender','Home',1,true);await f.poll()
 assert.equal(f.actions.length,0);assert.equal(f.ctx.pendingPageEntry,null,'passive profile selection cancels former intent')
}
console.log('PASS actual goPage/goRound/Home page request persists while offline; ordinary/passive activation never changes app workspace')

for(const connected of [false,true]){
 const f=navigationFixture(connected);f.profile.followWorkspace=false;f.ctx.lastPage.blender=1
 await f.ctx.switchTo('blender','Home');await f.poll()
 assert.equal(f.ctx.view.page,0,'slot-based profile aligns with actual adapter bank on initial connection even when continuous following disabled')
 assert.equal(f.actions.length,0,'alignment changes CT only')
}
assert.equal(nativeWorkspacePage({followWorkspace:false,pages:[{nativeWorkspace:'transport'},{nativeWorkspace:'mixer'}]},'transport',1),null,'ongoing following remains opt-in')
console.log('PASS initial native bank alignment does not require ongoing workspace-follow or send app commands')
