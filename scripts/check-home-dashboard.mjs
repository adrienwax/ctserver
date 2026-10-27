import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createHomeDashboard} from '../host/home-dashboard.mjs';import {checkProfile} from '../host/profiles.mjs';
const base=JSON.parse(fs.readFileSync(new URL('../config/profiles/main.json',import.meta.url),'utf8')).pages[0];
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:r=>resolve(r)}};
function rig(extra={}){const calls=[],requests=[];let profiles=[{id:'mp',name:'Moshpit',appId:'mp',tier:'current',supported:true,pages:['IN','MOSH']},{id:'td',name:'Temporal Memory',appId:'td',tier:'current',supported:true,pages:['SET','SMEAR']},{id:'old',tier:'legacy',supported:true,pages:['OLD']},{id:'bad',tier:'current',supported:false,pages:['BAD']}];const h=createHomeDashboard({inventory:()=>({profiles,apps:{mp:{name:'Moshpit'},td:{name:'TouchDesigner'}},connected:false}),request:async(op,payload,current)=>{requests.push([op,payload,current]);return extra.request?extra.request(op,payload,current):{projects:[]}},activate:async(...args)=>calls.push(args),...extra});return {h,calls,requests,replace:p=>profiles=p,snap:()=>h.snapshot(base)}}
test('twelve real Home actions and no imaginary volume',()=>{const r=rig(),s=r.snap();assert.equal(Object.keys(s.page.keys).length,12);assert.equal(s.page.dials.TL.turn.volume,1);assert.equal(s.page.dials.TR.turn.scroll,-1);assert.equal(s.page.wheel,undefined);assert.equal(s.page.keys[8].label,'DEVICE');assert.match(s.detail,/disconnected/);assert.equal(r.calls.length,0)});
test('schema permits only supported Home press intents',()=>{for(const value of ['apps','projects','profiles','pages','guides','setup','device'])assert.deepEqual(checkProfile({name:'Home',pages:[{name:'Home',keys:{0:{label:'TEST',do:{home:value}}}}]},[],{}),[]);for(const value of ['launch','../bad',{},null])assert(checkProfile({name:'Home',pages:[{name:'Home',keys:{0:{label:'TEST',do:{home:value}}}}]},[],{}).length)});
test('wheel browse/press never activates; Use is passive selection',async()=>{const r=rig();await r.h.action('profiles');r.h.move(1);r.h.select();assert.equal(r.calls.length,0);await r.h.action('key10');assert.deepEqual(r.calls[0].slice(0,3),['td',undefined,true]);assert.equal(r.snap().selectedProfile,'td')});
test('exact profile/page pairing and explicit Enter',async()=>{const r=rig();r.h.setProfile('td');await r.h.action('pages');r.h.move(1);r.h.select();assert.equal(r.calls.length,0);await r.h.action('key10');assert.deepEqual(r.calls[0].slice(0,3),['td',2,false])});
test('page picker has truthful empty state before a profile is selected',async()=>{const r=rig();await r.h.action('pages');assert.equal(r.snap().total,0);assert.match(r.snap().detail,/profile first/);r.h.select();await r.h.action('key10');assert.equal(r.calls.length,0)});
test('only real supported current inventory; pagination and boundaries',async()=>{const r=rig();r.replace(Array.from({length:15},(_,i)=>({id:'p'+i,name:'Profile '+i,tier:'current',supported:true,pages:['SET']})));await r.h.action('profiles');r.h.move(7);assert.equal(r.snap().highlight,1);assert.equal(r.snap().page.keys[1].label,'PROFILE 7');r.h.move(1000);assert.equal(r.snap().index,14);r.h.move(-1000);assert.equal(r.snap().index,0)});
test('missing/changed projects select but cannot open',async()=>{for(const status of ['missing','changed','busy','unsupported']){const r=rig({request:async()=>({projects:[{profileId:'td',projectId:'p',title:'Actual project',status,canOpen:false,reason:status}]})});await r.h.action('projects');r.h.select();await r.h.action('key10');assert.equal(r.requests.filter(x=>x[0]==='open').length,0);assert.equal(r.calls.length,0)}});
test('explicit Open passes exact IDs once, ignores second tap while pending',async()=>{const d=deferred(),seen=[];const r=rig({request:async(op,p,c)=>{seen.push([op,p,c]);return op==='inventory'?{projects:[{profileId:'td',projectId:'pinned-id',title:'Project',status:'ready',canOpen:true}]}:d.promise}});await r.h.action('projects');r.h.select();assert.equal(seen.length,1);const first=r.h.action('key10');await r.h.action('key10');assert.deepEqual(seen[1][1],{profileId:'td',projectId:'pinned-id'});r.h.reset();assert.equal(seen[1][2](),false);d.resolve({ok:true});await first;assert.equal(r.snap().mode,'home')});
test('late inventory cannot replace a different chooser or Home',async()=>{const d=deferred(),r=rig({request:()=>d.promise});const waiting=r.h.action('projects');await r.h.action('profiles');d.resolve({projects:[{profileId:'td',projectId:'old',title:'Late'}]});await waiting;assert.equal(r.snap().mode,'profiles');assert.equal(r.snap().total,2)});
test('removed profile/page cannot be entered from stale confirmation',async()=>{const r=rig();r.h.setProfile('td');await r.h.action('pages');r.h.select();r.replace([]);await r.h.action('key10');assert.equal(r.calls.length,0);assert.equal(r.snap().mode,'home')});
test('refresh clears prior confirmation and full names survive short tile labels',async()=>{const r=rig();await r.h.action('profiles');r.h.move(1);r.h.select();assert.match(r.snap().detail,/selects controls/);await r.h.action('key11');assert.equal(r.snap().selected,false);assert.equal(r.calls.length,0)});
test('panel and Guides use enum operations, never supplied executable text',async()=>{const r=rig();for(const name of ['setup','device','guides'])await r.h.action(name);assert.deepEqual(r.requests.map(x=>x[0]),['setup','device','guides']);await r.h.action('explorer.exe');assert.equal(r.requests.length,3)});

test('panel double tap is single-flight and cancelled on Home navigation',async()=>{const d=deferred(),seen=[];const r=rig({request:(op,p,current)=>{seen.push([op,current]);return d.promise}});const first=r.h.action('guides');await r.h.action('guides');assert.equal(seen.length,1);r.h.reset();assert.equal(seen[0][1](),false);d.resolve({message:'old response'});await first;assert.doesNotMatch(r.snap().detail,/old response/)});

test('Apps groups profiles by real app and requires separate Open',async()=>{const r=rig();r.replace([{id:'mp',appId:'mp',name:'Main',tier:'current',supported:true,pages:['MOSH']},{id:'mp2',appId:'mp',name:'Extra',tier:'current',supported:true,pages:['IN']},{id:'td',appId:'td',name:'Temporal',tier:'current',supported:true,pages:['SET']}]);await r.h.action('apps');assert.equal(r.snap().total,2);r.h.move(1);r.h.select();assert.equal(r.calls.length,0);assert.equal(r.snap().page.keys[10].label,'OPEN');await r.h.action('key10');assert.deepEqual(r.calls[0].slice(0,3),['td',undefined,false]);assert.equal(r.calls[0][4],'app')});
test('removed app profile invalidates pending Open',async()=>{const r=rig();await r.h.action('apps');r.h.select();r.replace([]);await r.h.action('key10');assert.equal(r.calls.length,0);assert.equal(r.snap().mode,'home')});

test('all six Home dials have real jobs; four chooser dials never activate',async()=>{
 const r=rig();r.h.setProfile('td');assert.equal(Object.keys(base.dials).length,6);
 for(const slot of ['CL','BL','CR','BR']){
  const d=base.dials[slot];await r.h.action(d.turn.home,1);assert(r.snap().mode===d.turn.home.slice(7));
  await r.h.action(d.press.home);assert.equal(r.calls.length,0);assert.equal(r.requests.filter(x=>x[0]==='open').length,0);
  const feedback=r.snap().dialFeedback[slot];assert.equal(feedback.norm,null);assert.equal(feedback.presentation.kind,'text');
 }
});
test('profile dial turn picks index; press selects same row; explicit Use activates',async()=>{
 const r=rig();await r.h.action('browse-profiles',1);assert.equal(r.snap().index,1);
 await r.h.action('pick-profiles');assert(r.snap().selected);assert.equal(r.calls.length,0);
 assert.equal(r.snap().dialFeedback.BL.text,'2/2');await r.h.action('key10');assert.equal(r.calls[0][0],'td');assert.equal(r.calls[0][2],true);
});
test('late project dial reply cannot select or move a replacement chooser',async()=>{
 const d=deferred(),r=rig({request:()=>d.promise});const pending=r.h.action('pick-projects');await r.h.action('profiles');
 d.resolve({projects:[{profileId:'td',projectId:'old',title:'Late'}]});await pending;
 assert.equal(r.snap().mode,'profiles');assert.equal(r.snap().index,0);assert(!r.snap().selected);assert.equal(r.calls.length,0);
});
test('chooser dial ignores noninteger and excessive movement stays bounded',async()=>{
 const r=rig();await r.h.action('browse-profiles',NaN);assert.equal(r.snap().index,0);
 await r.h.action('browse-profiles',9999);assert.equal(r.snap().index,1);await r.h.action('browse-profiles',-9999);assert.equal(r.snap().index,0);
});

test('actual shipped Home validates; rotary confirmation intents rejected',()=>{
 const root=new URL('../config/',import.meta.url),apps=JSON.parse(fs.readFileSync(new URL('apps.json',root),'utf8'));
 const ids=fs.readdirSync(new URL('profiles/',root)).filter(n=>n.endsWith('.json')).map(n=>n.slice(0,-5));
 const main=JSON.parse(fs.readFileSync(new URL('profiles/main.json',root),'utf8'));
 assert.deepEqual(checkProfile(main,ids,apps),[]);
 for(const action of ['key10','pick-apps','pick-profiles','pick-pages','pick-projects','setup','apps']){
  const changed=structuredClone(main);changed.pages[0].dials.CL.turn={home:action};
  assert(checkProfile(changed,ids,apps).some(e=>e.includes('rotation only browses')),action);
 }
});

test('actual host and queue discard a replaced chooser continuation',async()=>{
 const {createActionQueue}=await import('../host/action-queue.mjs');
 const {discreteDelta}=await import('../host/rotary-modifiers.mjs');
 const {ACTIONS}=await import('../host/schema.mjs');
 const vm=await import('node:vm');
 const source=fs.readFileSync(new URL('../host/deck-host.mjs',import.meta.url),'utf8');
 for(const first of ['browse-profiles','pick-profiles']){
  let epoch=0,queue;const errors=[],calls=[];
  const profiles=Array.from({length:4},(_,i)=>({id:'p'+i,appId:'a'+i,name:'Profile '+i,tier:'current',supported:true,pages:['SET']}));
  const h=createHomeDashboard({inventory:()=>({profiles,apps:Object.fromEntries(profiles.map((p,i)=>[p.appId,{name:'App '+i}]))}),request:async()=>({projects:[]}),activate:(...a)=>calls.push(a),change:()=>{epoch++;queue?.clear()}});
  const ctx=vm.createContext({actionContext:()=>epoch,stopping:false,counts:{actions:0},ACTIONS,discreteDelta,view:{profile:'main'},home:h});
  vm.runInContext(source.slice(source.indexOf('async function act('),source.indexOf('function buzz()')),ctx);
  queue=createActionQueue({context:()=>epoch,execute:j=>ctx.act(j.action,j.what,j.delta,j.context,j.mode),error:e=>errors.push(e)});
  queue.run('BL',{home:first},'Profile dial',1);queue.run('CL',{home:'browse-apps'},'Apps dial',1);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(errors,[]);assert.equal(h.snapshot(base).mode,'apps');assert.equal(h.snapshot(base).index,1);
  assert.equal(h.snapshot(base).selected,false);assert.equal(calls.length,0);
 }
});

