import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const source=process.argv[2]||path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'))
const {readProfileVersion,saveProfile}=await import(pathToFileURL(path.join(source,'host/profiles.mjs')))
const ui=fs.readFileSync(path.join(source,'ui/app.js'),'utf8')
const part=(a,b)=>{const start=ui.indexOf(a),end=ui.indexOf(b,start);assert(start>=0&&end>start);return ui.slice(start,end)}
for(const scenario of ['save-undo','conflict','pending-before','save-during-read','selection-during-read','pending-during-read','invalid-repair','invalid-conflict','invalid-structure-repair','invalid-structure-conflict']) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ct-file-history-'));fs.mkdirSync(path.join(dir,'profiles'));fs.writeFileSync(path.join(dir,'apps.json'),'{}')
 const profile=label=>({name:'A',pages:[{name:'PAGE',keys:{0:{label,do:{keys:'ctrl+c'}}}}]})
 const old=profile('OLD'),external=profile('EXTERNAL'),file=path.join(dir,'profiles/a.json');fs.writeFileSync(file,JSON.stringify(old));const acknowledged=readProfileVersion(dir,'a')
 const concurrent=scenario==='save-during-read';fs.writeFileSync(file,scenario.includes('structure')?JSON.stringify({name:'Broken',pages:{}}):scenario.startsWith('invalid-')?'{bad json':JSON.stringify(concurrent?old:external))
 const elements=new Map(),el=s=>{if(!elements.has(s))elements.set(s,{value:'',textContent:'',className:'',opened:false,closed:false,showModal(){this.opened=true},close(){this.closed=true}});return elements.get(s)}
 let writes=0,releaseRead
 const deferred=concurrent||scenario==='selection-during-read'||scenario==='pending-during-read'
 const context=vm.createContext({MOCK:false,cache:{a:old},profileRevisions:{a:acknowledged.revision},contextRevision:0,edit:{profile:'a',page:0},$:el,
  fetch:async(_u,o)=>{const body=JSON.parse(o.body);if(body.text===undefined){const result=readProfileVersion(dir,body.id);if(deferred)await new Promise(resolve=>{releaseRead=resolve});return{json:async()=>result}}
   writes++;const result=saveProfile(dir,body.id,body.text,{expectedRevision:body.expectedRevision});return{json:async()=>result}},
  setSaved(){},toast(){},renderSurface(){},renderInspector(){},renderLibrary(){},renderProfileBar(){},cancelBindingContext(){context.contextRevision++},api:{post(){}},loadProfile(){}})
 vm.runInContext(part('const undoStack =',"$('#undobtn').onclick ="),context);vm.runInContext(part('let fileTarget =',"$('#escbtn').onclick"),context)
 vm.runInContext(part('async function loadProfile(', '// Files edited outside'),context)
 if(scenario.startsWith('invalid-')){assert(readProfileVersion(dir,'a').problems.length);await context.loadProfile('a',true);assert.equal(context.cache.a,old,'invalid disk data must not replace the last-good preview');assert.equal(context.profileRevisions.a,acknowledged.revision)}
 vm.runInContext("undoStack.push({id:'a',text:JSON.stringify(cache.a),msg:'Old history'},{id:'b',text:'{}',msg:'Other history'});redoStack.push({id:'b',text:'{}',msg:'Other redo'})",context)
 if(scenario==='pending-before')vm.runInContext('saving=1',context)
 const open=el('#filebtn').onclick()
 if(concurrent){context.newEdit={...old,name:'QUEUED'};assert.equal(await vm.runInContext("save(newEdit,'Queued')",context),true);releaseRead()}
 if(scenario==='pending-during-read'){vm.runInContext('saving=1',context);releaseRead()}
 if(scenario==='selection-during-read'){context.edit.profile='b';context.contextRevision++;releaseRead()}
 await open
 if(['pending-before','save-during-read','selection-during-read','pending-during-read'].includes(scenario)){
  assert.equal(el('#filedlg').opened,false,scenario+' must not open stale dialog');assert.equal(context.cache.a.name,concurrent?'QUEUED':'A');assert.equal(writes,concurrent?1:0)
 }else{
  assert.equal(el('#filedlg').opened,true)
  if(scenario.startsWith('invalid-'))assert.equal(context.cache.a,old,'repair keeps the last-good preview')
  const draft=scenario.startsWith('invalid-')?profile('REPAIRED'):JSON.parse(el('#file-text').value);draft.name='EDITED';el('#file-text').value=JSON.stringify(draft)
  if(scenario.endsWith('conflict'))fs.writeFileSync(file,JSON.stringify({...external,name:'NEW EXTERNAL'}))
  await el('#file-save').onclick()
  if(scenario.endsWith('conflict')){
   assert.equal(el('#filedlg').closed,false);assert.match(el('#file-text').value,/EDITED/);assert.equal(JSON.parse(fs.readFileSync(file)).name,'NEW EXTERNAL');assert.equal(context.cache.a.pages[0].keys[0].label,scenario.startsWith('invalid-')?'OLD':'EXTERNAL')
   assert.equal(vm.runInContext("undoStack.filter(x=>x.id==='a').length",context),0)
  }else if(scenario.startsWith('invalid-')){
   assert.equal(JSON.parse(fs.readFileSync(file)).pages[0].keys[0].label,'REPAIRED');assert.equal(el('#filedlg').closed,true);assert.equal(vm.runInContext("undoStack.filter(x=>x.id==='a').length",context),0);assert.equal(vm.runInContext("redoStack.filter(x=>x.id==='a').length",context),0);assert.equal(vm.runInContext("redoStack.filter(x=>x.id==='b').length",context),1)
  }else{
   assert.equal(JSON.parse(fs.readFileSync(file)).pages[0].keys[0].label,'EXTERNAL')
   await vm.runInContext('undo()',context)
   assert.equal(JSON.parse(fs.readFileSync(file)).pages[0].keys[0].label,'EXTERNAL','Undo must use the fresh File baseline')
   assert.equal(context.cache.a.pages[0].keys[0].label,'EXTERNAL');assert.equal(vm.runInContext("undoStack.filter(x=>x.id==='a').length",context),0)
   assert.equal(vm.runInContext("undoStack.filter(x=>x.id==='b').length",context),1)
   await vm.runInContext('redo()',context);assert.equal(JSON.parse(fs.readFileSync(file)).name,'EDITED')
  }
 }
 fs.rmSync(dir,{recursive:true,force:true})
}
console.log('PASS File baseline: external read/save/Undo/Redo preserves external content; stale old history dropped; conflict retains draft/external file; pending/concurrent saves and selection changes refuse stale dialog; invalid JSON/structure repair remains possible without unsafe Undo. Private files and actual handlers.')
