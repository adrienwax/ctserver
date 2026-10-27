import assert from 'node:assert/strict'
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
import {probeOptions,contractControls,nativeReadScript,readNativeContract} from './read-temporal-native-contract.mjs'
import {PROJECT_ID,PROFILE_ID,PARAMETERS} from './make-temporal-profile.mjs'
for(const args of [[],['--port','9981'],['--port','9982','--project-id','wrong'],['--port','9982','--project-id',PROJECT_ID,'--contract','relative.json'],['--port','9982','--project-id',PROJECT_ID,'--contract','C:/fake.json','--launch','true']])assert.throws(()=>probeOptions(args))
assert.equal(probeOptions(['--port','9982','--project-id',PROJECT_ID,'--contract','C:/fake.json']).port,9982)
const contract={variantId:PROJECT_ID,profileId:PROFILE_ID,ctRigPath:'/project1/CT_RIG',projectidParameter:'Projectid',dials:Object.entries(PARAMETERS).map(([id,params])=>({id,dials:params.map(([name,,unit,min,max,def])=>({name,min,max,default:def,type:unit==='frames'||unit==='samples'||unit==='bands'?'int':'float'}))}))}
assert.equal(contractControls(contract).length,26)
const wrong=structuredClone(contract);wrong.dials[1].dials[5].default=0;assert.throws(()=>contractControls(wrong))
const script=nativeReadScript();assert(script.startsWith('assert str('));assert(!/\.val\s*=|\.pulse\(|\.destroy\(|\.create\(/.test(script))
let called=false;await assert.rejects(readNativeContract({port:9981,projectId:PROJECT_ID},{client:{exec:()=>{called=true}}}));assert.equal(called,false)
console.log('native read runner guards: passed offline; no TD requests made')
const contractPath=fileURLToPath(new URL('./fixtures/temporal-memory-contract.json',import.meta.url))
const frozen=JSON.parse(fs.readFileSync(contractPath,'utf8')),actual={}
for(const p of contractControls(frozen))actual[p.name]={type:p.type==='int'?'Int':'Float',min:p.min,max:p.max,default:p.default,value:p.default}
for(const [name,type] of Object.entries(frozen.actions))actual[name]={type:type.split(' ')[0],value:0}
for(const name of ['Projectid','Selectedrecipe','Status'])actual[name]={type:'Str',value:name==='Projectid'?PROJECT_ID:''}
for(const name of ['Sourceready','Effectenabled','Activeenabled','Previewopen','Playing'])actual[name]={type:'Toggle',value:false}
for(const name of ['Framecount','Currentframe','Historyfill','Historyneed','Historyhead'])actual[name]={type:'Int',value:0}
for(const name of ['Position','Sourcefps'])actual[name]={type:'Float',value:0}
const client={exec:async script=>{assert.equal(script,nativeReadScript());return {success:true,data:{result:{parameters:actual}}}}}
const options={port:9982,projectId:PROJECT_ID,contractPath}
assert.equal((await readNativeContract(options,{client})).ok,true,'current frozen contract including integer Historyfill accepts a matching snapshot')
actual.Historyfill.type='Float';actual.Smearstep.min=.5
const mismatch=await readNativeContract(options,{client});assert.equal(mismatch.ok,false)
assert(mismatch.mismatches.includes('Historyfill: missing Int'));assert(mismatch.mismatches.some(x=>x.startsWith('Smearstep: min')))
console.log('frozen contract snapshot/mismatch checks passed using injected client only')