// Offline model/raster/context checks. Pure imports; no host/device/network launch.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {execFileSync} from 'node:child_process'
import {gaugeModel,keyModel,keyBindingKey} from '../ui/control-presentation.mjs'
import {dialFeedback} from '../host/dial-feedback.mjs'
import {keyFeedback} from '../host/key-feedback.mjs'
import {rigStateMatches} from '../host/td-contract.mjs'
import {renderFeedbackWheel,renderFeedbackStrip,renderFeedbackKeys} from '../host/feedback-renderer.mjs'
import * as D from '../integrations/ct-td-control/ct-draw.mjs'
import {RIG_STATE_PY} from '../integrations/ct-td-control/ct-td-map.mjs'
const profile={rigIdentity:{parameter:'Projectid',value:'fixture'}}
const pg={dials:{TL:{name:'SPEED',unit:'x',turn:{td:{type:'rigKnob',par:'Speed'}}}},wheel:{name:'FRAME',turn:{td:{type:'rigFrameStep'}}},keys:{
 0:{label:'ENABLE',do:{td:{type:'rigPulse',par:'Toggleactive'}},state:{par:'Activeenabled',equals:true}},
 1:{label:'SMEAR',do:{td:{type:'rigPulse',par:'Selectsmear'}},state:{par:'Selectedrecipe',equals:'smear'}},
 2:{label:'RESET',do:{td:{type:'rigPulse',par:'Reset'}}}
}}
const state={values:{Projectid:'fixture',Speed:1.25,Currentframe:120,Framecount:900,Activeenabled:false,Selectedrecipe:'smear'},types:{Speed:'Float'},norm:{Speed:.75},ranges:{Speed:{min:.5,max:1.5,default:1,scale:'linear'}}}
let feedback=dialFeedback({page:pg,tdState:state,tdOk:true,contextId:'fixture/SET'})
let g=gaugeModel(feedback.TL,{profileName:'TEMPORAL',pageName:'SET'})
assert.equal(g.valueText,'1.25');assert.equal(g.unit,'x');assert.equal(g.range.norm,.75);assert.equal(g.profile,'TEMPORAL');assert.equal(g.page,'SET')
assert.equal(feedback.TL.presentation.default,1)
let w=gaugeModel(feedback.wheel);assert.equal(w.range.max,899);assert.equal(w.range.norm,120/899);assert.equal(w.coordinateSpace,'source-frame');assert.ok(w.range.ticks.every(t=>Number.isInteger(t.value)))
const withoutRange=dialFeedback({page:pg,tdState:{...state,ranges:{}},tdOk:true}).TL
g=gaugeModel(withoutRange);assert.equal(g.known,true);assert.equal(g.valueText,'1.25');assert.equal(g.range,null)
assert.equal(gaugeModel({...withoutRange,presentation:{...withoutRange.presentation,min:1,max:10,scale:'log'}}).range,null)
const normalizedOnly=dialFeedback({page:pg,tdState:{norm:{Speed:.4}},tdOk:true}).TL
assert.equal(normalizedOnly.available,false);assert.equal(normalizedOnly.text,'—')
const legacy=gaugeModel({label:'Frame',text:'0012 f',norm:.2,available:true});assert.equal(legacy.valueText,'0012 f');assert.equal(legacy.unit,'');assert.equal(legacy.range,null)
const noFeedback=dialFeedback({page:pg,tdState:state,tdOk:false});assert.equal(gaugeModel(noFeedback.TL).known,false);assert.equal(gaugeModel(noFeedback.wheel).range,null)
const client={connected:()=>true,state:()=>({}),label:()=> 'OFFSET',reading:()=>({param:{type:'float',unit:'%',min:-100,max:100,initial:12,default:0},value:-25,norm:.375})}
const mp=dialFeedback({page:{dials:{TL:{turn:{moshpit:{verb:'knob',slot:1,param:1}}}}},client}).TL
assert.equal(mp.presentation.valueRole,'base');assert.equal(mp.presentation.default,12);assert.equal(gaugeModel(mp).range.zero,.5);assert.equal(gaugeModel(mp).range.norm,.375)
const boolClient={...client,reading:()=>({param:{type:'bool'},value:false,norm:0})}
let keys=keyFeedback({page:pg,profile,tdState:state,tdOk:true});assert.equal(keys[0].enabled,false);assert.equal(keys[1].selected,true);assert.equal(keys[1].enabled,null);assert.equal(keys[2].kind,'momentary');assert.equal(keys[2].enabled,null)
assert.equal(keyFeedback({page:pg,profile,tdState:{...state,values:{...state.values,Projectid:'other'}},tdOk:true})[0].enabled,null)
assert.equal(keyFeedback({page:pg,profile,tdState:{...state,values:{Projectid:'fixture'}},tdOk:true})[0].enabled,null)
assert.equal(keyFeedback({page:pg,profile,tdState:state,tdOk:false})[0].enabled,null)
assert.equal(keyFeedback({page:{keys:{0:{do:{moshpit:{verb:'toggle',slot:1,param:1}}}}},client:boolClient})[0].enabled,false)
assert.equal(keyModel({kind:'toggle',state:'stale',enabled:true}).enabled,null)
// A stable action with a changed readback condition must not accept the old lamp.
assert.equal(keys[0].bindingKey,keyBindingKey(pg.keys[0]))
assert.notEqual(keys[0].bindingKey,keyBindingKey({...pg.keys[0],state:{...pg.keys[0].state,par:'Outputgate'}}))
assert.notEqual(keys[0].bindingKey,keyBindingKey({...pg.keys[0],state:{...pg.keys[0].state,equals:false}}))
// Execute the actual host freshness function with controlled clocks/context, not a copy.
const host=fs.readFileSync(new URL('../host/deck-host.mjs',import.meta.url),'utf8')
const freshCode=host.slice(host.indexOf('const currentTdFresh ='),host.indexOf('const currentDialFeedback ='))+';globalThis.check=currentTdFresh'
const ctx=vm.createContext({tdOk:true,tdProfileId:'p',view:{profile:'p'},tdCheckedAt:1000,tdState:state,rigStateMatches,prof:()=>profile,Date:{now:()=>5999}});vm.runInContext(freshCode,ctx);assert.equal(ctx.check(),true)
ctx.Date.now=()=>6000;assert.equal(ctx.check(),false);ctx.Date.now=()=>2000;ctx.view.profile='other';assert.equal(ctx.check(),false);ctx.view.profile='p';ctx.tdState={values:{Projectid:'other'}};assert.equal(ctx.check(),false)
assert.ok(host.includes('surfaceSignatures.get(surface) === signature'));assert.ok(host.includes('draw.toRgb565(w, true)'))
// Execute the exact extended TD read in a fake parameter environment; no TD process.
const python=String.raw`
import json
class Par:
 def __init__(self,name,style,value,lo=0,hi=1,default=0):
  self.name=name;self.style=style;self.v=value;self.normMin=lo;self.normMax=hi;self.default=default
 def eval(self):return self.v
class Rig:
 customPars=[Par('Speed','Float',1.25,.5,1.5,1),Par('Activeenabled','Toggle',False),Par('Projectid','Str','fixture')]
 class Params:pass
 par=Params()
def op(path):return Rig()
exec(${JSON.stringify(RIG_STATE_PY)})
print(json.dumps(result))
`
const py=process.env.CT_TEST_PYTHON||'python'
const read=JSON.parse(execFileSync(py,['-c',python],{encoding:'utf8',windowsHide:true}))
assert.deepEqual(read.ranges.Speed,{min:.5,max:1.5,default:1,scale:'linear'});assert.equal(read.values.Speed,1.25);assert.equal(read.norm.Speed,.75)
// Unmapped wheel is intentional context, not a readback fault; inspect actual text calls.
const labels=[],spy={...D,text:(s,t,...args)=>{labels.push(t);return D.text(s,t,...args)}}
renderFeedbackWheel(spy,undefined,{profileName:'HOME',pageName:'Main'});assert.ok(labels.includes('HOME'));assert.ok(!labels.includes('NO READBACK'))
labels.length=0;renderFeedbackWheel(spy,withoutRange,{profileName:'TEMPORAL',pageName:'SET'});assert.ok(labels.includes('1.25'));assert.ok(!labels.includes('NO READBACK'))
labels.length=0;renderFeedbackWheel(spy,noFeedback.wheel);assert.ok(labels.includes('NO READBACK'));assert.ok(!labels.includes('120'))
// Current-context numeric zero and explicit false remain known, distinct from null.
const zero=dialFeedback({page:pg,tdState:{...state,values:{...state.values,Speed:0}},tdOk:true}).TL;assert.equal(gaugeModel(zero).known,true);assert.equal(gaugeModel(zero).valueText,'0')
const outputs=[['wheel-frame',renderFeedbackWheel(D,feedback.wheel,{profileName:'TEMPORAL',pageName:'SET'}),true],['wheel-value-only',renderFeedbackWheel(D,withoutRange,{profileName:'TEMPORAL',pageName:'SET'}),true],['wheel-unknown',renderFeedbackWheel(D,noFeedback.wheel,{profileName:'TEMPORAL',pageName:'SET'}),true],['strip',renderFeedbackStrip(D,[feedback.TL,mp,noFeedback.TL]),false],['keys',renderFeedbackKeys(D,Object.entries(pg.keys).map(([i,k])=>({...k,glyph:'play',feedback:keys[i]}))),false]]
const out=process.env.EDENA_ARTIFACTS_DIR
for(const [name,s,be]of outputs){assert.ok([...s.px].every(Number.isFinite));const b=D.toRgb565(s,be);assert.equal(b.length,s.w*s.h*2);const le=be?Buffer.from(b).swap16():b;if(out){fs.writeFileSync(path.join(out,name+'.rgb565'),b);fs.writeFileSync(path.join(out,name+'.png'),D.rgb565ToPng(le,s.w,s.h))}}
assert.equal(D.toRgb565(D.surface(1,1,'#ff0000'),true).readUInt16BE(),0xf800)
console.log('PASS gauges: actual TD read metadata; raw/legacy/no-range/bipolar/source frames; unknown vs zero; key selection vs toggle; real host expiry/context guard; native pixel sizes/BE wheel; five offline PNGs')
