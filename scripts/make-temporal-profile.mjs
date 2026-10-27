import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
export const PROFILE_ID='atlas-moshman-td-temporal-memory-abac500b'
export const PROJECT_ID='moshman-td-temporal-memory-abac500b'
export const PARAMETERS={
 SET:[['Setin','IN','clip',0,.9,0],['Speed','SPEED','x',.5,1.5,1],['Setwindow','MEMORY','frames',1,29,8],['Setout','OUT','clip',.1,1,1],['Setfit','FIT','x',.9,1.1,1],['Master','MASTER','level',0,1,1]],
 SMEAR:[['Smearframes','AGE','samples',1,29,8],['Smearstep','STEP','frames',1,2,1],['Smearoffset','OFFSET','frames',0,29,0],['Smearmix','MIX','mix',0,1,1],['Smearkeep','DECAY','x',.2,1,.7],['Master','MASTER','level',0,1,1]],
 BANDS:[['Bandsframes','AGE','frames',1,29,8],['Bandsstep','STEP','frames',1,2,1],['Bandsoffset','OFFSET','frames',0,29,0],['Bandsmix','MIX','mix',0,1,1],['Bandscount','BANDS','bands',2,24,8],['Master','MASTER','level',0,1,1]],
 MOTION:[['Motionamp','WANDER','frame',0,.03,.004],['Motionrate','RATE','Hz',.01,.12,.03],['Motiony','Y','height',-.05,.05,0],['Motionx','X','width',-.05,.05,0],['Motionzoom','ZOOM','x',.95,1.05,1],['Master','MASTER','level',0,1,1]],
 OUT:[['Outcontrast','CONTRAST','x',.5,1.5,1],['Outgamma','GAMMA','x',.5,1.5,1],['Outlift','LIFT','linear',-.1,.1,0],['Outsat','SAT','x',0,2,1],['Outhue','HUE','deg',-30,30,0],['Master','MASTER','level',0,1,1]],
}
const pulse=par=>({td:{type:'rigPulse',par}})

const tile=(label,icon,sub,action,color='bone',state)=>({label,icon,sub,color,do:action,...(state?{state}:{})})
export function makeTemporalProfile() {
 const positions=['TL','CL','BL','TR','CR','BR']
 return {name:'TEMPORAL MEMORY',app:'touchdesigner',color:'cyan',layout:'recipe-v1',stripGestures:false,
  metadata:{author:'MOSHMAN',version:'0.1.0-candidate',projectId:PROJECT_ID,title:'Temporal Memory'},
  rigIdentity:{parameter:'Projectid',value:PROJECT_ID},
  everyPage:{buttons:{home:{do:{main:true}},a:{do:pulse('Play')},b:{do:pulse('Pause')},c:{do:pulse('Stepback')},d:{do:pulse('Stepforward')}},
   wheel:{name:'FRAME',turn:{td:{type:'rigFrameStep'}},tap:pulse('Playpause')},keys:{
    '2':tile('VIEW','view','MONITOR',pulse('View'),'bone',{par:'Previewopen',equals:true}),
    '3':tile('RESET','reset','HISTORY',pulse('Resetstate'),'sand'),
    '4':tile('CLEAN','source','SELECT',pulse('Selectclean'),'bone',{par:'Selectedrecipe',equals:'clean'}),
    '5':tile('SMEAR','bloom','SELECT',pulse('Selectsmear'),'coral',{par:'Selectedrecipe',equals:'smear'}),
    '6':tile('BANDS','layers','SELECT',pulse('Selectbands'),'lilac',{par:'Selectedrecipe',equals:'bands'}),
    '8':tile('PREV','back','RECIPE',pulse('Selectprev')),
    '9':tile('NEXT','more','RECIPE',pulse('Selectnext')),
    '11':tile('OUTPUT','view','ON / OFF',pulse('Toggleoutput'),'sky',{par:'Outputgate',equals:true}),
   }},
  pages:Object.entries(PARAMETERS).map(([name,params])=>({name,
   keys:{'0':tile('ENABLE','effect','BYPASS',pulse(name==='SMEAR'?'Togglesmear':name==='BANDS'?'Togglebands':name==='MOTION'?'Togglemotion':'Toggleactive'),'sage',{par:name==='SMEAR'?'Smearenabled':name==='BANDS'?'Bandsenabled':name==='MOTION'?'Motionenabled':'Activeenabled',equals:true}),
    '1':tile('DEFAULTS','reset','PARAMETERS',pulse('Default'+name.toLowerCase()),'dust')},
   dials:Object.fromEntries(params.map(([par,label,unit],i)=>[positions[i],{name:label,unit,turn:{td:{type:'rigKnob',par}},press:{td:{type:'rigReset',par}}}]))
  }))}
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const destination=process.argv[2]
 if (!destination) throw new Error('Pass an explicit isolated output path; owner profiles are never a default target')
 if (fs.existsSync(destination)) throw new Error('Refusing to overwrite a profile; generate a separate candidate')
 fs.writeFileSync(destination,JSON.stringify(makeTemporalProfile(),null,2)+'\n')
 console.log(destination)
}