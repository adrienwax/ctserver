// Real queue -> real host act -> generated Python -> inert TD Par. No native access.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {execFileSync} from 'node:child_process'
import {createActionQueue} from '../host/action-queue.mjs'
import {continuousFactor,discreteDelta} from '../host/rotary-modifiers.mjs'
import {guardRigScript,tdProfileSupported} from '../host/td-contract.mjs'
import {buildScript} from '../integrations/ct-td-control/ct-td-map.mjs'
const source=fs.readFileSync(new URL('../host/deck-host.mjs',import.meta.url),'utf8')
const act=source.slice(source.indexOf('async function act('),source.indexOf('function buzz()'))
const tick=()=>new Promise(resolve=>setImmediate(resolve))
async function scripts(events,mode,blocked) {
 const emitted=[];let release
 const ctx=vm.createContext({actionContext:()=>1,stopping:false,counts:{actions:0},ACTIONS:['td'],discreteDelta,continuousFactor,guardRigScript,tdProfileSupported,prof:()=>({rigIdentity:{parameter:'Projectid',value:'test-rig'}}),cfg:{settings:{knobStep:.02}},tdCfg:{tdPaths:{},scaling:{},guards:{}},buildScript,td:{exec:async script=>{emitted.push(script);if(blocked&&emitted.length===1)await new Promise(resolve=>release=resolve);return {success:true}}},tdOk:false,readTd(){}})
 vm.runInContext(act,ctx)
 const errors=[],queue=createActionQueue({context:()=>1,execute:job=>ctx.act(job.action,job.what,job.delta,job.context,job.mode),error:e=>errors.push(e)})
 for(const delta of events){queue.run('TL',{td:{type:'rigKnob',par:'Count'}},'TL',delta,mode);if(!blocked)await tick()}
 release?.();await tick();assert.equal(errors.length,0)
 return emitted
}
const cases=[]
for(const mode of ['fine','normal','coarse'])for(const sign of [-1,1])for(const max of [29,1001])for(const style of ['Int','Float']) {
 const variants=await Promise.all([scripts(Array(10).fill(sign),mode,false),scripts(Array(10).fill(sign),mode,true),scripts([10*sign],mode,false)])
 cases.push({name:`${mode}/${sign}/${max}/${style}`,max,style,start:max===29?8:500,variants})
}
for(const mode of ['fine','normal','coarse'])for(const style of ['Int','Float']) {
 const variants=await Promise.all([scripts([...Array(20).fill(1),...Array(3).fill(-1)],mode,false),scripts([...Array(20).fill(1),...Array(3).fill(-1)],mode,true),scripts([20,-3],mode,false)])
 cases.push({name:`clamp-reversal/${mode}/${style}`,max:29,style,start:28,variants})
}
const python=String.raw`
import json,sys
from types import SimpleNamespace
class Par:
 def __init__(self,c): self.val=c['start'];self.normMin=1;self.normMax=c['max'];self.style=c['style']
 def eval(self): return self.val
for c in json.load(sys.stdin):
 values=[]
 for scripts in c['variants']:
  p=Par(c);r=SimpleNamespace(par=SimpleNamespace(Count=p,Projectid=SimpleNamespace(eval=lambda:'test-rig')));g={'op':lambda path:r}
  for script in scripts: exec(script,g)
  values.append(p.val)
 assert max(values)-min(values)<1e-8,(c['name'],values)
 if c['name']=='fine/1/29/Int': assert values==[18,18,18],values
print('30 queue/host/Python equivalence groups passed')
`
const output=execFileSync(process.env.CT_TEST_PYTHON||'python',['-c',python],{input:JSON.stringify(cases),encoding:'utf8',windowsHide:true})
assert.match(output,/30 queue/);console.log(output.trim())
