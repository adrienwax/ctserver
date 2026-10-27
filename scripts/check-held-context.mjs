import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const text=fs.readFileSync(new URL('../host/deck-host.mjs',import.meta.url),'utf8')
const code=text.slice(text.indexOf('function onDown('),text.indexOf('function onRotate('))+
 text.slice(text.indexOf('function goPage('),text.indexOf('// A page\'s "enter"'))+
 text.slice(text.indexOf('async function switchTo('),text.indexOf('function appKey('))
function fixture(){
 const calls=[],timers=[]
 const page=name=>({name,buttons:{save:{do:{type:name+' tap'},hold:{type:name+' hold'}}}})
 const a={name:'A',pages:[page('A1'),page('A2')]},b={name:'B',pages:[page('B1')]}
 const ctx=vm.createContext({cfg:{profiles:{a,b},settings:{holdMs:500}},view:{profile:'a',page:0},holds:new Map(),DIAL_OF:{},BUTTONS:['save'],
  inputEpoch:0,switchRequest:0,switching:false,pendingPageEntry:null,passiveProfile:false,lastPage:{},lastOfApp:{},dev:{},
  page:()=>ctx.cfg.profiles[ctx.view.profile].pages[ctx.view.page],prof:()=>ctx.cfg.profiles[ctx.view.profile],
  actionContext:()=>JSON.stringify([ctx.inputEpoch,ctx.view.profile,ctx.view.page]),
  setTimeout:fn=>{const t={fn,cleared:false};timers.push(t);return t},clearTimeout:t=>{if(t)t.cleared=true},
  rotaryModifiers:{reset(){},fnHeld:()=>false},run:a=>calls.push(a.type),buzz(){},flash(){},log(){},repaint(){},status(){},rememberWorkspacePage(){},enterPage(){},
  moshOf:()=>null,tdProfileSupported:()=>true,goMain(){},escape(){},process:{},
 })
 vm.runInContext(code,ctx)
 return {ctx,calls,timers}
}
test('same-context tap and hold remain separate',()=>{
 const f=fixture();f.ctx.onDown('save');f.ctx.onUp('save');assert.deepEqual(f.calls,['A1 tap'])
 f.ctx.onDown('save');f.timers.at(-1).fn();f.ctx.onUp('save');assert.deepEqual(f.calls,['A1 tap','A1 hold'])
})
test('release after page change cannot invoke destination button',()=>{
 const f=fixture();f.ctx.onDown('save');f.ctx.goPage(2);f.ctx.onUp('save');assert.deepEqual(f.calls,[])
})
test('old hold timer cannot invoke source action on a new page',()=>{
 const f=fixture();f.ctx.onDown('save');f.ctx.goPage(2);f.timers[0].fn();f.ctx.onUp('save');assert.deepEqual(f.calls,[])
})
test('release and hold cannot cross an actual profile switch or away-and-back',async()=>{
 for(const release of [true,false]){
  const f=fixture();f.ctx.onDown('save');await f.ctx.switchTo('b','panel',1,true)
  await f.ctx.switchTo('a','panel',1,true)
  if(!release)f.timers[0].fn()
  f.ctx.onUp('save');assert.deepEqual(f.calls,[])
 }
})
