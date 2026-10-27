// Actual host functions in inert fixtures: no router, device, app, or TD endpoint.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {guardRigScript,tdProfileSupported} from '../host/td-contract.mjs'
const source=fs.readFileSync(new URL('../host/deck-host.mjs',import.meta.url),'utf8')
const extract=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b)}
const profile={appId:'mp',app:{target:'moshpit'},pages:[{name:'IN',enter:{keys:'in'}},{name:'MOSH',enter:{keys:'mosh'}}]}
let callback,connected=false,workspace='browse';const actions=[]
const client={onChange:f=>callback=f,start(){},syncs:()=>true,selectedSlot:()=>0,connected:()=>connected,state:()=>({workspace,slots:[]})}
const ctx=vm.createContext({mosh:new Map(),createMoshpitClient:()=>client,process:{env:{}},cfg:{},log(){},sel:{},view:{profile:'mp',page:0},prof:()=>profile,page:()=>profile.pages[ctx.view.page],pendingPageEntry:null,passiveProfile:true,inputEpoch:0,moshTick:0,rotaryModifiers:{reset(){}},repaint(){},status(){},lastPage:{},workspacePages:{},WORKSPACES:['browse','compose'],workspacePage:(_p,w)=>w==='compose'?1:w==='browse'?0:null,pageWorkspace:()=>null,run:a=>actions.push(a),win:{running:async()=>true}})
vm.runInContext(extract('function moshOf(', '// Declared before')+extract('function rememberWorkspacePage()', 'function goMain()')+extract('async function enterPage()', 'async function switchTo('),ctx)
ctx.moshOf(profile)
connected=true;workspace='compose';callback('phase')
assert.equal(ctx.view.page,1);assert.equal(ctx.passiveProfile,true);assert.equal(actions.length,0)
connected=false;callback('phase');connected=true;workspace='legacy-unknown';callback('phase')
await ctx.enterPage();assert.equal(actions.length,0,'reconnect and feedback must preserve passive activation')
ctx.passiveProfile=false;await ctx.enterPage();assert.equal(actions.length,1,'explicit activation can still enter its page')
const identity={parameter:'Projectid',value:'test-project'}
let current={rigIdentity:identity},pending,script
const poll=vm.createContext({dev:{},stopping:false,pageTd:()=>[{}],view:{profile:'test'},prof:()=>current,inputEpoch:0,guardRigScript,tdProfileSupported,RIG_STATE_PY:'result={}',td:{exec:s=>{script=s;return new Promise(resolve=>pending=resolve)}},tdReadSequence:0,tdCheckedAt:0,tdProfileId:null,tdState:null,repaint(){},status(){}})
vm.runInContext(extract('async function readTd()', 'const tdPoll ='),poll)
for(const change of [()=>poll.inputEpoch++,()=>poll.view.profile='new',()=>current={rigIdentity:identity}]) {
 const request=poll.readTd();assert(script.startsWith('assert str('));change();pending({success:true,data:{result:{marker:'stale'}}});await request;assert.equal(poll.tdState,null)
}
const request=poll.readTd();pending({success:true,data:{result:{marker:'fresh'}}});await request;assert.equal(poll.tdState.marker,'fresh')
// Same-context replies can finish out of order without a page/epoch change.
for(const stale of [{success:true,data:{result:{marker:'older'}}},{success:false,error:'old failure'}]) {
 const old=poll.readTd(),resolveOld=pending,newer=poll.readTd(),resolveNew=pending
 resolveNew({success:true,data:{result:{marker:'newest'}}});await newer
 const checked=poll.tdCheckedAt
 resolveOld(stale);await old
 assert.equal(poll.tdState.marker,'newest');assert.equal(poll.tdCheckedAt,checked)
}
const old=poll.readTd(),resolveOld=pending
poll.view.profile='away';poll.inputEpoch++;poll.view.profile='new';poll.inputEpoch++
resolveOld({success:true,data:{result:{marker:'away-and-back'}}});await old
assert.equal(poll.tdState.marker,'newest')
console.log('passive feedback/reconnect, context and same-context read ordering: passed without native access')
