// Pure picker model checks: no router, files other than source, or native applications.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const context = {window:{}}
vm.runInNewContext(readFileSync(new URL('../ui/profile-picker.js',import.meta.url),'utf8'),context)
const {rowsFor,searchRows,openAllowed} = context.window.ProfilePicker
const apps = [{id:'touchdesigner',name:'TouchDesigner'},{id:'future',name:'Future host'},{id:'old',name:'Old app',tier:'legacy'},{id:'park',name:'Parked app',tier:'parked'}]
const profiles = [
  {id:'main',name:'Home'}, {id:'pilot',name:'Temporal Memory',appId:'touchdesigner'},
  {id:'future-profile',name:'Installed host',appId:'future'}, {id:'legacy',name:'Old mapping',appId:'old'},
  {id:'parked',name:'Parked mapping',appId:'park'}, {id:'parked-profile',name:'Parked profile',tier:'parked'},
  {id:'pick-generated',name:'Generated selector',pick:true},
]
const projects = [
  {profileId:'pilot',projectId:'a',title:'Memory A',author:'MOSHMAN',version:'1.2',appId:'touchdesigner',status:'ready',canOpen:true},
  {profileId:'pilot',projectId:'b',title:'Memory B',author:'Claude',version:'2.0',appId:'touchdesigner',status:'missing',canOpen:false,reason:'Saved project missing'},
  {profileId:'ghost',projectId:'stray',title:'No profile in host inventory',status:'ready',canOpen:true},
  {profileId:'future-profile',author:'Waxy',version:'3',status:'unconfigured',canOpen:false},
]
let checks = 0
const check = (name,fn) => {fn();checks++;console.log(`PASS ${name}`)}
const rows=rowsFor(profiles,projects,apps)
check('host inventory includes future active apps and excludes nonexistent project profiles',()=>{assert(rows.some(r=>r.appId==='future'));assert(!rows.some(r=>r.profileId==='ghost'))})
check('main first, selectors and legacy hidden',()=>{assert.equal(rows[0].profileId,'main');assert(!rows.some(r=>r.profileId==='legacy'||r.profileId==='pick-generated'))})
check('legacy disclosure never exposes parked apps or profiles',()=>{const all=rowsFor(profiles,projects,apps,true);assert(all.some(r=>r.profileId==='legacy'));assert(!all.some(r=>r.profileId.startsWith('parked')))})
check('multiple projects preserve separate identities',()=>{const same=rows.filter(r=>r.profileId==='pilot');assert.equal(same.length,2);assert.notEqual(same[0].key,same[1].key)})
check('metadata survives unconfigured rows',()=>{const row=rows.find(r=>r.profileId==='future-profile');assert.equal(row.author,'Waxy');assert.equal(row.version,'3');assert.equal(row.reason,'No project linked')})
check('search matches app author version and all terms',()=>{assert.equal(searchRows(rows,'touchdesigner MOSHMAN 1.2').length,1);assert.equal(searchRows(rows,'memory absent').length,0)})
check('missing project preserves explanation and mapping selection',()=>{const row=rows.find(r=>r.projectId==='b');assert.equal(row.reason,'Saved project missing');assert.equal(row.canOpen,false)})
const ready=rows.find(r=>r.projectId==='a')
check('only explicit online ready project may open',()=>{assert.equal(openAllowed(ready,{online:true}),true);assert.equal(openAllowed(ready),false)})
for(const state of [{mock:true},{loading:true},{opening:true},{error:'stale'}]) check(`opening refuses ${Object.keys(state)[0]}`,()=>assert.equal(openAllowed(ready,{online:true,...state}),false))
for(const status of ['missing','unsupported','unconfigured','changed','busy','invented']) check(`status ${status} refuses even a stale canOpen flag`,()=>{const row=rowsFor([profiles[1]],[{...projects[0],status,canOpen:true}],apps)[0];assert.equal(openAllowed(row,{online:true}),false)})
check('identity is required in addition to ready',()=>assert.equal(openAllowed({...ready,projectId:''},{online:true}),false))
console.log(`${checks} profile picker model checks passed; browser/native not exercised`)