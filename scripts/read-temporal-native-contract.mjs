// Deliberately separate from the deck host. ROOT owns invoking this against its isolated TD.
// No defaults for port/identity/contract; no device, process launch or parameter writes.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {makeTdClient} from '../integrations/ct-td-control/td-client.mjs'
import {guardRigScript} from '../host/td-contract.mjs'
import {PROJECT_ID,PROFILE_ID} from './make-temporal-profile.mjs'
export function probeOptions(args) {
 const result={};for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--port','--project-id','--contract'].includes(key)||!args[i+1]||Object.hasOwn(result,key))throw new Error('Expected --port 9982 --project-id <pilot ID> --contract <absolute JSON path>');result[key]=args[i+1]}
 if(result['--port']!=='9982'||result['--project-id']!==PROJECT_ID||!path.isAbsolute(result['--contract']||''))throw new Error('Only the explicit isolated pilot on port 9982 is allowed')
 return {port:9982,projectId:PROJECT_ID,contractPath:result['--contract']}
}
export function contractControls(contract) {
 if(contract.variantId!==PROJECT_ID||contract.profileId!==PROFILE_ID||contract.ctRigPath!=='/project1/CT_RIG'||contract.projectidParameter!=='Projectid')throw new Error('Unexpected pilot contract identity')
 const controls=(contract.dials||[]).flatMap(p=>p.dials||[])
 if(controls.length!==30||new Set(contract.dials.map(p=>p.id)).size!==5)throw new Error('Expected five pages with 30 rotary bindings')
 const unique=new Map()
 for(const p of controls){if(!/^[A-Z][a-z0-9]+$/.test(p.name)||!['int','float'].includes(p.type)||![p.min,p.max,p.default].every(Number.isFinite)||p.max<=p.min||p.default<p.min||p.default>p.max)throw new Error('Invalid rotary contract: '+p.name);const old=unique.get(p.name);if(old&&['type','min','max','default'].some(k=>old[k]!==p[k]))throw new Error('Conflicting shared parameter: '+p.name);unique.set(p.name,p)}
 return [...unique.values()]
}
export const nativeReadScript=()=>guardRigScript(`_r=op('/project1/CT_RIG')
result={'parameters':{}}
for _p in _r.customPars:
    if _p.style in ('Float','Int','Toggle','Str','Pulse'):
        _row={'type':_p.style,'value':_p.eval()}
        if _p.style in ('Float','Int'):
            _row.update({'min':_p.normMin,'max':_p.normMax,'default':_p.default})
        result['parameters'][_p.name]=_row
`,{parameter:'Projectid',value:PROJECT_ID})
export async function readNativeContract(options,{client}={}) {
 if(options.port!==9982||options.projectId!==PROJECT_ID)throw new Error('Refusing a non-isolated target')
 const contract=JSON.parse(fs.readFileSync(options.contractPath,'utf8')),expected=contractControls(contract)
 const td=client||makeTdClient({execUrl:'http://127.0.0.1:9982/api/td/server/exec',handshakeUrl:'http://127.0.0.1:9982/api/td/server/td',timeoutMs:3000})
 const response=await td.exec(nativeReadScript())
 if(!response?.success||!response.data?.result?.parameters)throw new Error('Pilot identity/read refused: '+(response?.error||'no parameter snapshot'))
 const actual=response.data.result.parameters,mismatches=[]
 const close=(a,b)=>typeof a==='number'&&Math.abs(a-b)<1e-8
 for(const p of expected){const row=actual[p.name];if(!row){mismatches.push(p.name+': missing');continue}if(row.type.toLowerCase()!==p.type)mismatches.push(p.name+': type '+row.type+' != '+p.type);for(const key of ['min','max','default'])if(!close(row[key],p[key]))mismatches.push(p.name+': '+key+' '+row[key]+' != '+p[key])}
 for(const name of ['Play','Pause','Stepback','Stepforward','Playpause','Resetstate','View','Selectclean','Selectsmear','Selectbands','Selectprev','Selectnext','Toggleoutput','Togglemotion','Togglesmear','Togglebands','Toggleactive','Defaultset','Defaultsmear','Defaultbands','Defaultmotion','Defaultout'])if(actual[name]?.type!=='Pulse')mismatches.push(name+': missing Pulse')
 for(const [name,type] of Object.entries({Position:'Float',Framecount:'Int',Sourcefps:'Float',Currentframe:'Int',Historyfill:'Int',Historyneed:'Int',Historyhead:'Int',Status:'Str',Sourceready:'Toggle',Effectenabled:'Toggle',Previewopen:'Toggle',Projectid:'Str',Selectedrecipe:'Str',Playing:'Toggle',Activeenabled:'Toggle',Smearenabled:'Toggle',Bandsenabled:'Toggle',Motionenabled:'Toggle',Outputgate:'Toggle'}))if(actual[name]?.type!==type)mismatches.push(name+': missing '+type)
 return {ok:!mismatches.length,kind:'read-only-native-contract',port:9982,projectId:PROJECT_ID,contractPath:options.contractPath,mismatches,parameters:actual}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try{const report=await readNativeContract(probeOptions(process.argv.slice(2)));console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1}catch(error){console.error(error.message);process.exitCode=1}
}
