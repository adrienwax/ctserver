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
for(const operation of ['undo','redo']) for(const changed of [true,false]) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ct-cross-history-'))
  fs.mkdirSync(path.join(dir,'profiles'));fs.writeFileSync(path.join(dir,'apps.json'),'{}')
  const profile=name=>({name,pages:[{name:'PAGE',keys:{0:{label:name,do:{keys:'ctrl+c'}}}}]})
  const acknowledged=profile('ACKNOWLEDGED'),snapshot=profile('HISTORY'),external=profile('EXTERNAL')
  const file=path.join(dir,'profiles/a.json');fs.writeFileSync(file,JSON.stringify(acknowledged))
  const initial=readProfileVersion(dir,'a')
  if(changed)fs.writeFileSync(file,JSON.stringify(external))
  let writes=0
  const context=vm.createContext({MOCK:false,cache:{a:acknowledged,b:profile('OTHER')},profileRevisions:{a:initial.revision},edit:{profile:'b',page:0},
    fetch:async(_url,options)=>{const request=JSON.parse(options.body);assert.equal(request.id,'a');const result=request.text?(writes++,saveProfile(dir,'a',request.text,{expectedRevision:request.expectedRevision})):readProfileVersion(dir,'a');return {json:async()=>result}},
    setSaved(){},toast(){},renderSurface(){},renderInspector(){},renderProfileBar(){},renderLibrary(){},cancelBindingContext(){}})
  vm.runInContext(part('const undoStack =',"$('#undobtn').onclick ="),context)
  vm.runInContext(part('async function loadProfile(', '// Files edited outside'),context)
  const stack=operation==='undo'?'undoStack':'redoStack',opposite=operation==='undo'?'redoStack':'undoStack'
  context.snapshot=JSON.stringify(snapshot)
  vm.runInContext(`${stack}.push({id:'b',text:'{}',msg:'Other'}, {id:'a',text:snapshot,msg:'A'});${opposite}.push({id:'b',text:'{}',msg:'Other opposite'})`,context)
  await vm.runInContext(`${operation}()`,context)
  assert.equal(writes,changed?0:1,`${operation}: external reload must cancel the old entry before a write`)
  assert.equal(JSON.parse(fs.readFileSync(file)).name,changed?'EXTERNAL':'HISTORY')
  assert.equal(context.cache.a.name,changed?'EXTERNAL':'HISTORY')
  assert.equal(vm.runInContext(`${stack}.filter(x=>x.id==='b').length`,context),1)
  assert.equal(vm.runInContext(`${opposite}.filter(x=>x.id==='b').length`,context),1)
  assert.equal(vm.runInContext(`${stack}.filter(x=>x.id==='a').length`,context),0)
  assert.equal(vm.runInContext(`${opposite}.filter(x=>x.id==='a').length`,context),changed?0:1)
  fs.rmSync(dir,{recursive:true,force:true})
}
console.log('PASS: actual cross-profile Undo/Redo cancel invalidated entries with zero writes, preserve external cache/disk and other history; unchanged-revision operations succeed. Private files only.')
