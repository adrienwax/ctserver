// Desktop control feedback against synthetic pilot snapshots, using a test-owned headless browser.
// No router, hardware, TD, installed profile writes, or device input.
import assert from 'node:assert/strict'
import {keyFeedback} from '../host/key-feedback.mjs'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import {fork} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {ensureScratch} from './build-scratch/bootstrap.mjs'
import {gaugeModel,gaugePoint,GAUGE_LAYOUT} from '../ui/control-presentation.mjs'
const managed=ensureScratch('portable-test'),root=path.resolve(fileURLToPath(new URL('..',import.meta.url)))
const dependency=process.env.WAXYCT_MOSHPIT_SRC||path.resolve(root,'../Moshpit')
const {chromium}=await import(pathToFileURL(path.join(dependency,'node_modules/playwright/index.mjs')).href)
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));assert(![9981,9990,9991].includes(port))
const fixture=fork(path.join(root,'scripts/serve-icon-fixture.mjs'),[],{env:{...process.env,WAXYCT_FIXTURE_PORT:String(port)},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
let browser
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture startup timed out')),10000);fixture.stdout.on('data',d=>{if(String(d).includes('Icon scratch fixture')){clearTimeout(timer);resolve()}});fixture.once('exit',code=>reject(Error('Fixture exited '+code)))})
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[],outside=[]
 const origin=`http://127.0.0.1:${port}`
 await page.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();outside.push(route.request().url());return route.abort()})
 page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?mock=deck-td&bare')
 await page.waitForFunction(()=>window.WAXY&&window.MOCK_PROFILES&&window.ControlFeedbackView)
 await page.evaluate(()=>{
  const deliver=WAXY.status
  window.gaugePilot='atlas-moshman-td-temporal-memory-abac500b';window.gaugePatch={profile:gaugePilot,page:0,profileName:MOCK_PROFILES[gaugePilot].name,pageName:'SET'};window.gaugeOffline=false
  WAXY.status=s=>{window.gaugeSnapshot=structuredClone(s);if(!gaugeOffline)deliver({...s,...(window.gaugeClaimOverride?{claim:window.gaugeClaimOverride}:{}),host:{...s.host,...gaugePatch}})}
  window.patchGauge=patch=>{gaugePatch={...gaugePatch,...patch};WAXY.status(gaugeSnapshot)}
 })
 await page.waitForFunction(()=>window.gaugeSnapshot&&document.querySelector('#editing-target').textContent.includes('TEMPORAL'))
 await page.evaluate(()=>{
  const pg=SCHEMA.pageOf(MOCK_PROFILES[gaugePilot],0)
  window.confirmed=(key,label,text,norm,presentation)=>({label,text,norm,available:true,presentation,bindingKey:JSON.stringify((key==='wheel'?pg.wheel:pg.dials[key])?.turn??null)})
  window.numeric=(value,min,max,unit='',kind='float')=>({state:'confirmed',kind,value,valueText:String(value),unit,min,max,scale:'linear'})
  window.gaugeGood={TL:confirmed('TL','OFFSET','-25%',.375,numeric(-25,-100,100,'%')),CL:confirmed('CL','SPEED','1.25x',.25),BL:confirmed('BL','MEMORY','25 frames',.2,numeric(25,1,120,'frames','integer')),TR:confirmed('TR','MIX','65%',.65,numeric(65,0,100,'%')),CR:confirmed('CR','FIT','Contain',null),BR:confirmed('BR','MASTER','0',0),wheel:confirmed('wheel','FRAME','120 f',120/899,numeric(120,0,899,'f','integer'))}
  window.keyReading=(slot,kind,enabled,selected=null)=>({bindingKey:ControlFeedbackView.keyBindingKey(pg.keys[slot]),kind,state:'confirmed',enabled,selected})
  window.keysGood={'0':keyReading('0','toggle',true),'2':keyReading('2','toggle',false),'5':keyReading('5','selection',false,true),'6':keyReading('6','selection',true,false),'11':keyReading('11','toggle',null)}
  patchGauge({dialFeedback:gaugeGood,keyFeedback:keysGood})
 })
 const original=await page.evaluate(()=>JSON.stringify(MOCK_PROFILES))
 const wheel=page.locator('[data-k="knobCT"]'),knob=id=>page.locator(`[data-k="knob${id}"]`),key=n=>page.locator(`[data-k="center:${n}"]`)
 assert.equal(await wheel.locator('.dial-value').textContent(),'120');assert.equal(await wheel.locator('.gauge-unit').textContent(),'f')
 assert.deepEqual(await wheel.locator('.gauge-limit').allTextContents(),['0','899']);assert.equal(await wheel.locator('.gauge-tick').count(),21)
 const pt=gaugePoint(120/899),circle=await wheel.locator('.gauge-pointer').evaluate(el=>[Number(el.getAttribute('cx')),Number(el.getAttribute('cy'))]);assert(Math.abs(pt[0]-circle[0])<.001&&Math.abs(pt[1]-circle[1])<.001)
 assert.equal(await wheel.locator('svg').getAttribute('viewBox'),'0 0 240 240');assert.equal(await wheel.locator('.gauge-profile').textContent(),'TEMPORAL MEMORY');assert.equal(await wheel.locator('.gauge-page').textContent(),'SET')
 checks.push('Wheel shares exact240geometry/tick count with model, correct source-frame endpoints, unit and profile/page context')
 assert.equal(await knob('TL').locator('.dial-position>i').evaluate(el=>el.style.left),'37.5%');assert.equal(await knob('TL').locator('.dial-position>i').evaluate(el=>el.style.width),'12.5%');assert.equal(await knob('TL').locator('.gauge-zero').evaluate(el=>el.style.left),'50%')
 assert.equal(await knob('TR').locator('.gauge-tick').count(),2);assert.equal(await knob('TR').locator('.dial-position>i').evaluate(el=>el.getBoundingClientRect().height),5);assert.equal(await knob('CL').locator('.gauge-tick').count(),0);assert.equal(await knob('CL').locator('.dial-value').textContent(),'1.25x')
 checks.push('Stronger bars have authoritative ticks, bipolar center fill, and legacy text-only feedback has no invented ruler')
 assert.equal(await key(0).locator('.key-state').textContent(),'ON');assert.equal(await key(2).locator('.key-state').textContent(),'OFF');assert.equal(await key(11).locator('.key-state').textContent(),'—')
 assert.equal(await key(5).locator('.key-state').textContent(),'OFF');assert.equal(await key(5).locator('.key-selection').count(),1);assert.equal(await key(6).locator('.key-state').textContent(),'ON');assert.equal(await key(6).locator('.key-selection').count(),0)
 assert.equal(await key(5).locator('.lb').textContent(),'SMEAR');assert.equal(await key(3).locator('.key-glyph svg').count(),1)
 checks.push('ConfirmedON/OFF/unknown and selected-off differ; selection bracket does not imply enabled; configured label and momentary glyph preserved')
 await page.evaluate(()=>patchGauge({keyFeedback:{...keysGood,'5':{...keysGood['5'],enabled:null}}}));assert.equal(await key(5).locator('.key-state').count(),0);assert.equal(await key(5).locator('.key-glyph svg').count(),1);assert.equal(await key(5).locator('.key-selection').count(),1);assert.equal(await key(5).locator('.key-feedback-text').textContent(),'Selected recipe');await key(5).screenshot({path:path.join(managed.artifacts,'selection-known-without-enabled.png')})
 await page.evaluate(()=>patchGauge({keyFeedback:{...keysGood,'5':{...keysGood['5'],enabled:null,state:'unavailable'}}}));assert.equal(await key(5).locator('.key-state').count(),0);assert.equal(await key(5).locator('.key-unknown').textContent(),'—');assert.equal(await key(5).locator('.key-selection').count(),0);await key(5).screenshot({path:path.join(managed.artifacts,'selection-unavailable.png')});await page.evaluate(()=>patchGauge({keyFeedback:keysGood}));checks.push('Actual selection-only contract preserves artwork and selected bracket without inventing enabled; unknown selection has distinct dash marker')
 await page.screenshot({path:path.join(managed.artifacts,'control-feedback-pilot-1440.png')});await wheel.screenshot({path:path.join(managed.artifacts,'wheel-frame.png')})
 for(const [name,value,min,max,unit]of [['percent',65,0,100,'%'],['bipolar',-25,-100,100,'%']]){
  await page.evaluate(({name,value,min,max,unit})=>patchGauge({dialFeedback:{...gaugeGood,wheel:confirmed('wheel',name.toUpperCase(),`${value}${unit}`,(value-min)/(max-min),numeric(value,min,max,unit))}}),{name,value,min,max,unit})
  assert.equal(await wheel.locator('.gauge-zero').count(),min<0?1:0);await wheel.screenshot({path:path.join(managed.artifacts,`wheel-${name}.png`)})
 }
 await page.evaluate(()=>patchGauge({dialFeedback:{...gaugeGood,wheel:confirmed('wheel','SPEED','1.25x',.2)}}));assert.equal(await wheel.locator('.gauge-limit,.gauge-tick,.gauge-fill').count(),0);assert.equal(await wheel.locator('.dial-value').textContent(),'1.25x');await wheel.screenshot({path:path.join(managed.artifacts,'wheel-text-only.png')})
 checks.push('Wheel percent/bipolar/text-only variants render without guessing units or rulers')
 await page.getByRole('tab',{name:'Map',exact:true}).click()
 for(const patch of [{connected:false},{profile:'template'},{page:1}]){
  await page.evaluate(p=>patchGauge({...p,dialFeedback:gaugeGood,keyFeedback:keysGood}),patch)
  assert.equal(await wheel.locator('.dial-value').textContent(),'—');assert.equal(await wheel.locator('.gauge-tick').count(),0);assert.equal(await wheel.locator('.gauge-status').textContent(),'NO READBACK');assert.equal(await key(0).locator('.key-state').textContent(),'—');assert.equal(await key(5).locator('.key-selection').count(),0)
  await page.evaluate(()=>patchGauge({connected:true,profile:gaugePilot,page:0}))
 }
 await page.evaluate(()=>{gaugeOffline=true;WAXY.offline()});assert.equal(await key(0).locator('.key-state').textContent(),'—');assert.equal(await wheel.locator('.dial-value').textContent(),'—');await page.evaluate(()=>{gaugeOffline=false;WAXY.status(gaugeSnapshot)})
 await page.evaluate(()=>patchGauge({dialFeedback:{...gaugeGood,wheel:{...gaugeGood.wheel,bindingKey:'old binding'}},keyFeedback:{...keysGood,'0':{...keysGood['0'],bindingKey:'old binding'}}}));assert.equal(await wheel.locator('.dial-value').textContent(),'—');assert.equal(await key(0).locator('.key-state').textContent(),'—')
 await wheel.screenshot({path:path.join(managed.artifacts,'wheel-unavailable.png')});checks.push('Different live profile/page, disconnect, offline and binding mismatch suppress both stale rulers and key states')
 await page.evaluate(()=>patchGauge({dialFeedback:gaugeGood,keyFeedback:{...keysGood,'5':{...keysGood['5'],enabled:true}}}));assert.equal(await key(5).locator('.key-state').textContent(),'ON');assert.equal(await key(5).locator('.key-selection').count(),1)
 await knob('TL').click();assert(await page.locator('#fields #flabel').isVisible());assert.equal(await page.locator('#fields #flabel').inputValue(),'IN');assert.equal(await page.evaluate(()=>JSON.stringify(MOCK_PROFILES)),original)
 await page.locator('#insp-close').click();await page.getByRole('tab',{name:'Live',exact:true}).click()
 for(const width of [1440,980]){
  await page.setViewportSize({width,height:1000});const bounds=await wheel.locator('svg').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right&&a.top>=b.top&&a.bottom<=b.bottom});assert(bounds,`wheel SVG fits at${width}`);for(const pos of ['TL','CL','BL','TR','CR','BR']){const fit=await knob(pos).evaluate(el=>{const outer=el.getBoundingClientRect(),label=el.querySelector('.dial-label').getBoundingClientRect(),value=el.querySelector('.dial-value').getBoundingClientRect(),rail=el.querySelector('.dial-position')?.getBoundingClientRect();return label.bottom<=value.top+1&&value.top>=outer.top&&value.bottom<=outer.bottom-2&&(!rail||value.bottom<=rail.top+1)});assert(fit,`dial label/value/rail fit at${width}: ${pos}`)};
  await page.screenshot({path:path.join(managed.artifacts,`control-feedback-selected-on-${width}.png`)})
 }
 checks.push('Selection withON remains distinct; Map inspector and bindings unchanged; wheel fits1440/980')
 await page.getByRole('tab',{name:'Map',exact:true}).click()
 for(const field of ['par','equals']){
   const sameDo=await page.evaluate(field=>{
     window.stateIdentityOriginal=structuredClone(MOCK_PROFILES[gaugePilot])
     const key=MOCK_PROFILES[gaugePilot].pages[0].keys['0'],before=JSON.stringify(key.do)
     key.state[field]=field==='par'?'Differentgate':false
     loadProfile(gaugePilot,true);patchGauge({keyFeedback:keysGood})
     return JSON.stringify(key.do)===before
   },field)
   assert(sameDo,`state.${field} fixture must preserve do`)
   assert.equal(await key(0).locator('.key-state').textContent(),'—',`state.${field} edit must reject prior readback even with unchanged do`)
   await page.evaluate(()=>{MOCK_PROFILES[gaugePilot]=stateIdentityOriginal;loadProfile(gaugePilot,true);patchGauge({keyFeedback:keysGood})})
   assert.equal(await key(0).locator('.key-state').textContent(),'ON','restored matching state accepts its readback')
 }
 checks.push('Changing state.par or state.equals independently rejects stale key feedback while do remains identical; restoring descriptor restores confirmed state')
 await page.evaluate(()=>{
   window.kindFixtureOriginal=structuredClone(MOCK_PROFILES[gaugePilot])
   const keys=MOCK_PROFILES[gaugePilot].pages[0].keys
   keys['0']={label:'MP TOGGLE',icon:'effect',do:{moshpit:{verb:'toggle',path:'transport.playing'}}}
   keys['2']={label:'MP SELECT',icon:'source',do:{moshpit:{verb:'select',slot:1}}}
   keys['5']={label:'TD VIEW',icon:'view',do:{td:{type:'rigView'}}}
   keys['6']={label:'TD CLIP',icon:'source',do:{td:{type:'rigClip',n:2}}}
   loadProfile(gaugePilot,true)
   window.kindReadings=Object.fromEntries(['0','2','5','6'].map(slot=>{const toggle=['0','5'].includes(slot);return[slot,{bindingKey:ControlFeedbackView.keyBindingKey(keys[slot]),kind:toggle?'toggle':'selection',state:'confirmed',enabled:toggle?true:null,selected:toggle?null:true}]}))
   patchGauge({keyFeedback:kindReadings})
 })
 for(const slot of [0,5])assert.equal(await key(slot).locator('.key-state').textContent(),'ON')
 for(const slot of [2,6])assert.equal(await key(slot).locator('.key-selection').count(),1)
 const assertUnknownKinds=async()=>{for(const slot of [0,5])assert.equal(await key(slot).locator('.key-state').textContent(),'—');for(const slot of [2,6]){assert.equal(await key(slot).locator('.key-unknown').textContent(),'—');assert.equal(await key(slot).locator('.key-selection').count(),0)}}
 for(const patch of [{connected:false},{profile:'template'},{page:1}]){
   await page.evaluate(p=>patchGauge(p),patch);await assertUnknownKinds();await page.evaluate(()=>patchGauge({connected:true,profile:gaugePilot,page:0}))
 }
 await page.evaluate(()=>{gaugeClaimOverride={owner:'probe',state:'connected'};patchGauge({})});await assertUnknownKinds();await page.evaluate(()=>{gaugeClaimOverride=null;patchGauge({})})
 await page.evaluate(()=>{gaugeOffline=true;WAXY.offline()});await assertUnknownKinds();await page.evaluate(()=>{gaugeOffline=false;WAXY.status(gaugeSnapshot)})
 await page.evaluate(()=>patchGauge({keyFeedback:Object.fromEntries(Object.entries(kindReadings).map(([key,value])=>[key,{...value,bindingKey:'old binding'}]))}));await assertUnknownKinds()
 await page.screenshot({path:path.join(managed.artifacts,'control-feedback-fallback-kinds.png')})
 await page.evaluate(()=>{MOCK_PROFILES[gaugePilot]=kindFixtureOriginal;loadProfile(gaugePilot,true);patchGauge({keyFeedback:keysGood})})
 assert.equal(await page.evaluate(()=>JSON.stringify(MOCK_PROFILES)),original)
 checks.push('Bare Moshpit toggle/select and TD rigView/rigClip keep correct unknown presentation across offline, disconnect, wrong profile/page/claim, and stale binding; temporary fixture restored')
 // Exercise actual renderSurface wiring with authoritative app/profile display facts.
 const displayKeys={'0':{label:'MOSHPIT',icon:'source',do:{app:'moshpit'}},'2':{label:'PROFILE',icon:'source',do:{switch:'moshpit-graph'}},'5':{label:'HANDOFF',icon:'source',do:{app:'edena'}}}
 const displayContext={page:{keys:displayKeys},profile:{appId:'moshpit',pick:true},apps:{moshpit:{exe:'Moshpit.exe'},edena:{exe:'Edena.exe',target:'handoff'}},profiles:{'moshpit-graph':{id:'moshpit-graph',app:{exe:'Moshpit.exe'}}},view:{profile:'moshpit-graph'},lastOfApp:{moshpit:'moshpit-graph'}}
 await page.evaluate(keys=>{window.displayOriginal=structuredClone(MOCK_PROFILES[gaugePilot]);Object.assign(MOCK_PROFILES[gaugePilot].pages[0].keys,keys);loadProfile(gaugePilot,true)},displayKeys)
 for(const running of [true,false]){
   const readings=keyFeedback({...displayContext,running:{'Moshpit.exe':running}})
   await page.evaluate(readings=>patchGauge({keyFeedback:readings}),readings)
   for(const slot of [0,2]){assert.equal(await key(slot).locator('.key-active').count(),1);assert.equal(await key(slot).locator('.key-display>g').getAttribute('opacity'),running?'1':'0.55')}
   assert.equal(await key(5).locator('.key-display>g').getAttribute('opacity'),'1','handoff keys are not dimmed based on process absence')
 }
 const assertNoDisplayFacts=async()=>{for(const slot of [0,2]){assert.equal(await key(slot).locator('.key-active').count(),0);assert.equal(await key(slot).locator('.key-display>g').getAttribute('opacity'),'1')}}
 for(const patch of [{connected:false},{profile:'template'},{page:1}]){await page.evaluate(p=>patchGauge(p),patch);await assertNoDisplayFacts();await page.evaluate(()=>patchGauge({connected:true,profile:gaugePilot,page:0}))}
 await page.evaluate(()=>{gaugeClaimOverride={owner:'probe'};patchGauge({})});await assertNoDisplayFacts();await page.evaluate(()=>{gaugeClaimOverride=null;patchGauge({})})
 await page.evaluate(()=>{gaugeOffline=true;WAXY.offline()});await assertNoDisplayFacts();await page.evaluate(()=>{gaugeOffline=false;WAXY.status(gaugeSnapshot)})
 await page.evaluate(()=>patchGauge({keyFeedback:Object.fromEntries(Object.entries(gaugePatch.keyFeedback).map(([slot,r])=>[slot,{...r,bindingKey:'old binding'}]))}));await assertNoDisplayFacts()
 await page.evaluate(()=>{MOCK_PROFILES[gaugePilot]=displayOriginal;loadProfile(gaugePilot,true);patchGauge({keyFeedback:keysGood})})
 assert.equal(await page.evaluate(()=>JSON.stringify(MOCK_PROFILES)),original)
 checks.push('Actual renderSurface preserves host app/profile active markers and running opacity, handoff exemption, and rejects display facts on disconnected/offline/wrong profile/page/owner/binding')
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[])
 fs.writeFileSync(path.join(managed.artifacts,'control-feedback-ui.json'),JSON.stringify({checks,errors,layout:GAUGE_LAYOUT,boundary:'Static fixture synthetic state, owned browser only; no native/device/TD acceptance.'},null,2));console.log(JSON.stringify({checks,evidence:managed.artifacts},null,2))
}finally{if(browser)await browser.close();if(fixture.connected)fixture.send('close');await new Promise(resolve=>{if(fixture.exitCode!==null)return resolve();fixture.once('exit',resolve)})}