import assert from 'node:assert/strict'
import { actionIdentity, bindingTarget, sameBindingTarget, applyActionAppearance, controlledAppStatus } from '../ui/editor-model.mjs'
const target = bindingTarget({profile:'moshpit',page:1},'center:0','do',3)
assert(sameBindingTarget(target,{profile:'moshpit',page:1},'center:0','do',3))
for (const [edit,key,trig,rev] of [[{profile:'main',page:1},'center:0','do',3],[{profile:'moshpit',page:2},'center:0','do',3],[{profile:'moshpit',page:1},'center:1','do',3],[{profile:'moshpit',page:1},'center:0','hold',3],[{profile:'moshpit',page:1},'center:0','do',4]]) assert(!sameBindingTarget(target,edit,key,trig,rev))
assert.deepEqual(applyActionAppearance({icon:'mark-in',sub:'old'},{label:'MUTE',icon:'mute'}),{icon:'mute',label:'MUTE',iconSource:'auto'})
assert.equal(applyActionAppearance({icon:'look',iconSource:'custom'},{icon:'mute'}).icon,'look')
assert(!('icon' in applyActionAppearance({icon:'mark-in'},{label:'KEYS'})))
assert.equal(actionIdentity({page:2},'moshpit'),actionIdentity({page:2},'moshpit'))
assert.notEqual(actionIdentity({page:2},'moshpit'),actionIdentity({page:2},'td'))
const base={now:1000,claim:{owner:'waxyct'},host:{profile:'moshpit',profiles:[{id:'moshpit',appId:'moshpit'}],apps:[{id:'moshpit',target:'moshpit',name:'Moshpit'}],moshpit:{moshpit:{phase:'connected'}}},td:{ok:false}}
assert.equal(controlledAppStatus(base,true,1001).text,'Moshpit · Connected')
assert.equal(controlledAppStatus({...base,host:{...base.host,profile:'main'}},true,1001).text,'')
assert.notEqual(controlledAppStatus(base,false,1001).kind,'ok')
assert.notEqual(controlledAppStatus(base,true,20000).kind,'ok')
assert.equal(controlledAppStatus({...base,host:{controlContext:{name:'TouchDesigner',target:'td',phase:'missing-rig',checkedAt:1000}}},true,1001).text,'TouchDesigner · Rig unavailable')
console.log('UI model: binding context, automatic/custom artwork, stable action identity and live app status passed')
import fs from 'node:fs'
import vm from 'node:vm'
const app=fs.readFileSync(new URL('../ui/app.js',import.meta.url),'utf8')
const extract=(start,end)=>{
 const first=app.indexOf(start),last=app.indexOf(end,first)
 assert(first>=0&&last>first,`Missing source boundaries: ${start} / ${end}`)
 return app.slice(first,last)
}
// Top-level handlers close at column zero. Do not include the next UI initializer:
// its DOM/module dependencies are unrelated to the handler being exercised here.
const extractFunction=name=>{
 const declaration=new RegExp(`^function ${name}\\([^\\n]*\\) \\{`,'m').exec(app)
 assert(declaration,`Missing function: ${name}`)
 const rest=app.slice(declaration.index),closing=/^\}/m.exec(rest)
 assert(closing,`Missing function end: ${name}`)
 return rest.slice(0,closing.index+1)
}
const elements=new Map()
const $=s=>{if(!elements.has(s))elements.set(s,{hidden:false,classList:{remove(){}}});return elements.get(s)}
const cleanup=extract('function cancelBindingContext() {','const now =')
const selection=extract('function select(k, trig) {',"$('#ct').onclick =")
const open=extractFunction('openProfile')
const nav={view:'customize',edit:{profile:'moshpit',page:1},armed:{name:'page',act:{page:4}},pending:{act:{keys:'ctrl+x'}},dragItem:{},sel:null,renaming:null,learn:false,contextRevision:0,$,$$:()=>[],
 profileList:()=>[{id:'td-template',appId:'touchdesigner'}],lastEdited:{},deckLive:false,renderSurface(){},renderInspector(){},renderLibrary(){},loadProfile(){},render(){}}
vm.runInNewContext(cleanup+selection+open+"\nopenProfile('td-template')",nav)
assert.equal(nav.armed,null);assert.equal(nav.pending,null);assert.equal(nav.dragItem,null);assert.equal(nav.contextRevision,1)
const profileCalls=[]
nav.view='controls';nav.deckLive=true;nav.api={post:(url,body)=>profileCalls.push({url,body})}
vm.runInNewContext("openProfile('td-template')",nav)
assert.deepEqual(JSON.parse(JSON.stringify(profileCalls)),[{url:'/api/deck',body:{type:'switch',id:'td-template',profileOnly:true}}],'panel navigation only activates controls, never launches the associated app')
nav.view='customize';nav.deckLive=false
const click=extract("$('#ct').onclick =", "$('#insp-close').onclick")
nav.edit={profile:'moshpit',page:1};nav.pending={act:{keys:'ctrl+x'}};nav.sel={k:'center:0',trig:'do'};nav.profileList=()=>[{id:'main'}];nav.slotOf=()=>null
vm.runInNewContext(click,nav)
$('#ct').onclick({target:{closest:()=>({dataset:{k:'b0'}})}})
assert.equal(nav.edit.profile,'main');assert.equal(nav.pending,null);assert.equal(nav.sel,null)
let saved
const bind=extract('function bind(k, trig, act, msg, item) {','// Which trigger an action lands on')
const fixture={pages:[{keys:{'0':{label:'MARK IN',icon:'mark-in',do:{moshpit:{verb:'command',command:'mark.in'}}}}}]}
const ctx={assignmentValid:()=>true,slotOf:()=>({kind:'key',slot:'0',name:'Key 1'}),curProfile:()=>fixture,structuredClone,isLocked:()=>false,isShared:()=>false,homeOf:(_i,p)=>p.pages[0],SECTION:{key:'keys'},isSet:a=>!!a&&!a.none,tidyEveryPage(){},remember(){},TRIG:{do:'tap'},applyActionAppearance,save:p=>{saved=p}}
vm.runInNewContext(bind+"\nbind('center:0','do',{media:'mute'},'Bound',{name:'Mute',label:'MUTE',icon:'mute'})",ctx)
assert.equal(saved.pages[0].keys['0'].icon,'mute')
const serialized=JSON.parse(JSON.stringify(saved));assert.equal(serialized.pages[0].keys['0'].iconSource,'auto')
assert.equal(fixture.pages[0].keys['0'].icon,'mark-in','prior snapshot stays valid for undo')
console.log('Actual UI handlers: app navigation, diagram Home, rebind and persisted icon metadata passed')
// Failed saves roll cache back and keep the undo entry available for another attempt.
const saveSource=extract('async function doSave(', 'async function undo()')
const original={pages:[{name:'IN'}]},changed={pages:[{name:'OUT'}]}
const failed={MOCK:false,profileRevisions:{},cache:{moshpit:changed},saveEpoch:{},fetch:async()=>({json:async()=>({ok:false,problems:['fixture rejection']})}),setSaved(){},toast(){},renderSurface(){},renderInspector(){},renderProfileBar(){},undoStack:[],redoStack:[]}
await vm.runInNewContext(saveSource+`\ndoSave('moshpit', ${JSON.stringify(JSON.stringify(original))}, cache.moshpit, 'Changed', {})`,failed)
assert.deepEqual(JSON.parse(JSON.stringify(failed.cache.moshpit)),original)
assert.equal(failed.undoStack.length,0)
const undoSource=extract('async function undo()', 'async function redo()')
const undoEntry={id:'moshpit',text:JSON.stringify(original),msg:'Changed'}
const history={saving:0,undoStack:[undoEntry],redoStack:[],edit:{profile:'moshpit',page:0},cache:{moshpit:changed},cancelBindingContext(){},save:async()=>false,renderProfileBar(){},toast(){}}
await vm.runInNewContext(undoSource+'\nundo()',history)
assert.equal(history.undoStack.length,1);assert.equal(history.redoStack.length,0)
console.log('Failed-save and refused-undo regressions passed')

// Execute the actual asynchronous save queue, with manually delayed router acknowledgements.
// A refused predecessor cancels descendants instead of implicitly retrying their rejected fields.
const queueSource=extract('const undoStack =', "$('#undobtn').onclick =")
const profile=label=>({pages:[{keys:{0:{label,do:{media:'mute'}}}}]})
function queuedFixture() {
 const requests=[],messages=[],statuses=[]
 const context=vm.createContext({MOCK:false,profileRevisions:{},cache:{moshpit:profile('ORIGINAL'),td:profile('TD ORIGINAL')},edit:{profile:'moshpit',page:0},
  fetch:(_url,options)=>new Promise(resolve=>requests.push({body:JSON.parse(options.body),respond:ok=>resolve({json:async()=>({ok,problems:ok?[]:['fixture refusal']})})})),
  setSaved:(text,kind)=>statuses.push({text,kind}),toast:message=>messages.push(message),renderSurface(){},renderInspector(){},renderProfileBar(){},cancelBindingContext(){}})
 vm.runInContext(queueSource,context)
 const run=code=>vm.runInContext(code,context)
 const save=(label,id='moshpit')=>{context.nextProfile=profile(label);return run(`save(nextProfile, 'Label ${label}', {id:${JSON.stringify(id)}})`)}
 return {context,requests,messages,statuses,run,save}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
for (const results of [[false,false],[false,true],[true,false],[true,true]]) {
 const f=queuedFixture(),a=f.save('FIRST'),b=f.save('SECOND');await tick()
 assert.deepEqual(f.statuses.at(-1),{text:'Saving…',kind:''},'pending edit cannot claim to be saved')
 assert.equal(f.requests.length,1,'writes are serialized')
 f.requests[0].respond(results[0]);await tick()
 if(results[0]) {assert.equal(f.requests.length,2);f.requests[1].respond(results[1])}
 const outcomes=await Promise.all([a,b])
 assert.deepEqual(outcomes,results[0]?results:[false,false],'dependent edit is cancelled even if the next response would succeed')
 const expected=results[0]?(results[1]?'SECOND':'FIRST'):'ORIGINAL'
 assert.equal(f.context.cache.moshpit.pages[0].keys[0].label,expected,'cache contains only acknowledged fields')
 assert.equal(f.run('undoStack.length'),results[0] ? 1+Number(results[1]) : 0)
 assert.equal(f.run('saving'),0)
 assert.equal(f.statuses.at(-1).kind,results.every(Boolean)?'ok':'bad')
 if(!results[0]) assert(f.messages.some(message=>message.includes('Later edits')&&message.includes('retry')))
 f.context.colourEdit=structuredClone(f.context.cache.moshpit);f.context.colourEdit.pages[0].keys[0].color='sage'
 const recovery=f.run("save(colourEdit,'Colour only')");await tick()
 const recovered=f.requests.at(-1)
 assert.equal(JSON.parse(recovered.body.text).pages[0].keys[0].label,expected,'unrelated recovery never persists a refused label')
 recovered.respond(true);assert.equal(await recovery,true)
 const undone=f.run('undo()');await tick();assert.equal(JSON.parse(f.requests.at(-1).body.text).pages[0].keys[0].color,undefined)
 f.requests.at(-1).respond(true);await undone
 const redone=f.run('redo()');await tick();assert.equal(JSON.parse(f.requests.at(-1).body.text).pages[0].keys[0].color,'sage')
 f.requests.at(-1).respond(true);await redone
}
const cross=queuedFixture(),refused=cross.save('FIRST'),cancelled=cross.save('SECOND'),independent=cross.save('TD SAVED','td');await tick()
cross.requests[0].respond(false);await tick();assert.equal(cross.requests.length,2);assert.equal(cross.requests[1].body.id,'td')
cross.requests[1].respond(true);assert.deepEqual(await Promise.all([refused,cancelled,independent]),[false,false,true])
assert.equal(cross.context.cache.moshpit.pages[0].keys[0].label,'ORIGINAL');assert.equal(cross.context.cache.td.pages[0].keys[0].label,'TD SAVED')
assert.equal(cross.run('undoStack[0].id'),'td','history keeps the acknowledged profile owner')
cross.run("undoStack.push({id:'moshpit',text:JSON.stringify(cache.moshpit),msg:'Fixture'});redoStack.push({id:'moshpit',text:JSON.stringify(cache.moshpit),msg:'Fixture'})")
const pending=cross.save('THIRD'),pastCount=cross.run('undoStack.length'),futureCount=cross.run('redoStack.length')
await cross.run('undo()');await cross.run('redo()');assert.equal(cross.run('undoStack.length'),pastCount);assert.equal(cross.run('redoStack.length'),futureCount)
await tick();cross.requests.at(-1).respond(false);await pending
assert.equal(cross.run('undoStack.length'),pastCount);assert.equal(cross.run('redoStack.length'),futureCount,'failed saves preserve available Redo')
console.log('Queued saves: fail/fail, fail/success cancellation, success/fail, success/success, unrelated recovery, cross-profile ownership and Undo/Redo passed')
