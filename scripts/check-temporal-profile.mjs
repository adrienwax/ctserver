import test from 'node:test'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {makeTemporalProfile,PARAMETERS,PROJECT_ID,PROFILE_ID} from './make-temporal-profile.mjs'
import {checkProfile} from '../host/profiles.mjs'
import {pageOf} from '../host/schema.mjs'
import {checkLayout} from './check-layout.mjs'
import {guardRigScript,stateTileActive} from '../host/td-contract.mjs'
import {controlContext} from '../host/control-context.mjs'
import {dialFeedback} from '../host/dial-feedback.mjs'
import {discreteDelta} from '../host/rotary-modifiers.mjs'
import {buildScript,RIG_STATE_PY} from '../integrations/ct-td-control/ct-td-map.mjs'
const p=makeTemporalProfile(), apps={touchdesigner:{target:'td',exe:'TouchDesigner.exe'}}
const check=x=>checkProfile(x,[PROFILE_ID],apps)
test('native profile, five pages and agreed 30 useful bindings pass schema/layout',()=>{
 assert.deepEqual(check(p),[]);assert.deepEqual(checkLayout(PROFILE_ID,p),[])
 assert.equal(p.pages.length,5)
 for(let i=0;i<5;i++) {
  const page=pageOf(p,i);assert.equal(Object.keys(page.dials).length,6);assert.equal(page.dials.BR.turn.td.par,'Master')
  assert.equal(page.enter,undefined);assert.equal(page.keys['1'].do.td.par,'Default'+page.name.toLowerCase())
  for(const d of Object.values(page.dials)){assert.equal(d.press.td.par,d.turn.td.par);assert.equal(d.press.td.type,'rigReset')}
 }
 assert.equal(p.stripGestures,false)
})
test('candidate schema rejects malformed units, identity, metadata and state',()=>{
 for(const mutate of [x=>x.metadata={command:'bad'},x=>x.rigIdentity.extra=true,x=>x.everyPage.keys['5'].state.extra=true,x=>x.rigIdentity.value="bad';raise",x=>x.pages[0].dials.TL.unit={},x=>x.everyPage.keys['5'].state={par:'bad-name',equals:'smear'}]) {
  const clone=structuredClone(p);mutate(clone);assert.ok(check(clone).length)
 }
})
test('state lamp uses only matching fresh project feedback',()=>{
 const key=p.everyPage.keys['5'],state={values:{Projectid:PROJECT_ID,Selectedrecipe:'smear'}}
 assert.equal(stateTileActive(key,p,state,true),true);assert.equal(stateTileActive(key,p,state,false),false)
 assert.equal(stateTileActive(key,p,{values:{Projectid:'other',Selectedrecipe:'smear'}},true),false)
})
test('actual units, source-frame wheel and unitless raw values coexist',()=>{
 const page=pageOf(p,0),state={values:{Speed:1.25,Currentframe:30,Framecount:301},norm:{Speed:.75},types:{Speed:'Float'}}
 const r=dialFeedback({page,tdOk:true,tdState:state});assert.equal(r.CL.text,'1.25 x');assert.equal(r.wheel.text,'30 f')
 assert.equal(dialFeedback({page:{dials:{TL:{name:'SPEED',turn:{td:{type:'rigKnob',par:'Speed'}}}}},tdOk:true,tdState:state}).TL.text,'1.25') // No unit declared: raw value, never inferred percent
 assert.equal(dialFeedback({page,tdOk:false,tdState:state}).CL.available,false)
})
test('wrong or incomplete rig is not ready',()=>{
 const needed=new Set(['Position','Framecount','Currentframe','Selectedrecipe','Activeenabled']);const walk=x=>{if(!x||typeof x!=='object')return;if(x.td?.par)needed.add(x.td.par);if(x.state?.par)needed.add(x.state.par);Object.values(x).forEach(walk)};walk(p)
 const args={profile:{...p,app:apps.touchdesigner},profileId:PROFILE_ID,tdProfileId:PROFILE_ID,tdOk:true,tdCheckedAt:100,now:101,tdState:{clip:0,on:{},norm:{},parameters:[...needed],values:{Projectid:PROJECT_ID}}}
 assert.equal(controlContext(args).phase,'ready')
 assert.equal(controlContext({...args,tdState:{...args.tdState,values:{Projectid:'wrong'}}}).phase,'missing-rig')
 assert.equal(controlContext({...args,tdState:{...args.tdState,parameters:[...needed].filter(x=>x!=='Framecount')}}).phase,'missing-rig')
})
test('actual generated Python on mock TD refuses wrong identity, scrubs exact frames and clamps',()=>{
 const script=buildScript({type:'rigFrameStep',step:discreteDelta(1,'coarse')},{},{},{})
 const guarded=guardRigScript(script,p.rigIdentity)
 assert.ok(guarded.includes('\n'));assert.ok(!guarded.includes('\\n'))
 const payload={script:guarded,stateScript:guardRigScript(RIG_STATE_PY,p.rigIdentity),id:PROJECT_ID,knobs:[.002,-.002,.2,0].map(delta=>buildScript({type:'rigKnob',par:'Count',delta},{},{},{}))}
 const python=String.raw`
import json,sys
from types import SimpleNamespace
x=json.load(sys.stdin)
class Par:
 def __init__(self,name,value,style='Float',lo=0,hi=1): self.name=name;self.val=value;self.style=style;self.normMin=lo;self.normMax=hi;self.default=value
 def eval(self): return self.val
ps=[Par('Projectid',x['id'],'Str'),Par('Position',.5),Par('Framecount',101,'Int',1,1000),Par('Count',8,'Int',1,29)]
r=SimpleNamespace(par=SimpleNamespace(**{p.name:p for p in ps}),customPars=ps)
g={'op':lambda path:r}
exec(x['script'],g);assert abs(r.par.Position.val-.55)<1e-12
r.par.Position.val=.99;exec(x['script'],g);assert r.par.Position.val==1
r.par.Projectid.val='wrong';r.par.Position.val=.5
try: exec(x['script'],g);raise RuntimeError('wrong rig allowed')
except AssertionError: pass
assert r.par.Position.val==.5
try: exec(x['stateScript'],g);raise RuntimeError('wrong rig read allowed')
except AssertionError: pass
r.par.Projectid.val=x['id'];r.par.Framecount.val=1
try: exec(x['script'],g);raise RuntimeError('invalid frame count allowed')
except AssertionError: pass
exec(x['stateScript'],g);assert g['result']['clip']==0;assert g['result']['values']['Projectid']==x['id']
exec(x['knobs'][0],g);assert r.par.Count.val==9
exec(x['knobs'][1],g);assert r.par.Count.val==8
exec(x['knobs'][2],g);assert r.par.Count.val==14
exec(x['knobs'][3],g);assert r.par.Count.val==14
r.par.Count.val=29;exec(x['knobs'][0],g);assert r.par.Count.val==29
r.par.Count.style='Float';r.par.Count.val=8;exec(x['knobs'][0],g);assert abs(r.par.Count.val-8.056)<1e-12
print('mock Python identity/frame/readback passed')
`
 const output=execFileSync(process.env.CT_TEST_PYTHON||'python',['-c',python],{input:JSON.stringify(payload),encoding:'utf8',windowsHide:true})
 assert.match(output,/passed/)
})
test('frozen MOSHMAN contract matches every slot/range and pulse/state binding',()=>{
 const contract=JSON.parse(fs.readFileSync(new URL('./fixtures/temporal-memory-contract.json',import.meta.url),'utf8'))
 for(const [i,declared] of contract.dials.entries()) {
  const page=pageOf(p,i),params=PARAMETERS[declared.id.toUpperCase()]
  for(const control of declared.dials) {
   assert.equal(page.dials[control.slot].turn.td.par,control.name)
   const local=params.find(row=>row[0]===control.name)
   assert.deepEqual(local.slice(3),[control.min,control.max,control.default],control.name)
   if(['Smearstep','Bandsstep'].includes(control.name)){assert.equal(control.type,'int');assert.equal(page.dials[control.slot].unit,'frames')}
  }
  const expected={SET:['Toggleactive','Activeenabled'],SMEAR:['Togglesmear','Smearenabled'],BANDS:['Togglebands','Bandsenabled'],MOTION:['Togglemotion','Motionenabled'],OUT:['Toggleactive','Activeenabled']}[page.name]
  assert.equal(page.keys['0'].do.td.par,expected[0]);assert.equal(page.keys['0'].state.par,expected[1])
  for(const key of Object.values(page.keys)) {
   assert.equal(key.do.td.type,'rigPulse');assert.equal(contract.actions[key.do.td.par],'Pulse')
   if(key.state){assert(contract.stateReadbacks.includes(key.state.par));assert(stateTileActive(key,p,{values:{Projectid:PROJECT_ID,[key.state.par]:key.state.equals}},true));assert(!stateTileActive(key,p,{values:{Projectid:PROJECT_ID,[key.state.par]:key.state.equals}},false))}
  }
  assert.equal(page.keys['2'].state.par,'Previewopen');assert.equal(page.keys['11'].state.par,'Outputgate')
  assert.equal(page.keys['8'].do.td.par,'Selectprev');assert.equal(page.keys['9'].do.td.par,'Selectnext')
  assert.equal(page.keys['7'],undefined);assert.equal(page.keys['10'],undefined)
 }
})