// Normal-mode UI, disposable in-memory profile server, no router/device/installed writes.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ensureScratch } from './build-scratch/bootstrap.mjs'
const managed = ensureScratch('build')
const playwright = process.env.WAXYCT_MOSHPIT_SRC
  ? pathToFileURL(path.join(process.env.WAXYCT_MOSHPIT_SRC, 'node_modules/playwright/index.mjs')).href
  : new URL('../../moshpit-v3/node_modules/playwright/index.mjs', import.meta.url).href
const { chromium } = await import(playwright)
import { loadIcons } from '../host/icon-library.mjs'
import { profileRevision } from '../host/profiles.mjs'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const profiles=Object.fromEntries(fs.readdirSync(path.join(root,'config/profiles')).filter(n=>n.endsWith('.json')).map(n=>[n.slice(0,-5),JSON.parse(fs.readFileSync(path.join(root,'config/profiles',n)))]))
const apps=JSON.parse(fs.readFileSync(path.join(root,'config/apps.json'))),requests=[]
let hold=false
const json=(res,data)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost')
 if(url.pathname==='/api/profile'&&req.method==='POST') {
  let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body)
  const current=()=>JSON.stringify(profiles[data.id]),revision=()=>profileRevision(current())
  if(!data.text)return json(res,{text:current(),revision:revision()})
  const request={data,respond(accept=true){
   if(!accept)return json(res,{ok:false,conflict:true,problems:['Fixture external-edit conflict']})
   if(!Object.hasOwn(data,'expectedRevision')||data.expectedRevision!==revision())return json(res,{ok:false,conflict:true,problems:['Missing or stale profile revision']})
   profiles[data.id]=JSON.parse(data.text);json(res,{ok:true,revision:revision()})
  }}
  requests.push(request);if(!hold)request.respond();return
 }
 if(req.method!=='GET'){res.writeHead(405);return res.end('No app/device actions in this fixture')}
 if(url.pathname==='/api/icons')return json(res,{...loadIcons(path.join(root,'config')),scratch:true})
 if(url.pathname==='/api/apps')return json(res,apps)
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname))
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
profiles['legacy-fixture']={...structuredClone(profiles.windows),name:'LEGACY FIXTURE',app:'legacy-fixture',tier:'legacy'}
apps['legacy-fixture']={name:'Legacy fixture',color:'green',tier:'legacy'}
const status={now:Date.now(),usb:{present:true,port:'FIXTURE'},replug:{goneAt:0,backAt:0},claim:{owner:'waxyct',state:'connected',updated:Date.now(),since:Date.now(),lastInput:Date.now()},procs:{edena:[],bridges:[],loupedeck:[]},td:{ok:false},power:{suspend:{},hub:{}},hooks:{},edena:{},busy:null,steps:[],test:null,error:null,children:{},note:'Disposable field-edit fixture',host:{profile:'moshpit',page:0,profileName:'MOSHPIT',pageName:'IN',connected:true,errors:[],profiles:Object.entries(profiles).map(([id,p])=>({id,name:p.name,appId:p.app,pages:p.pages.map(x=>x.name),tier:p.tier||'current'})),apps:Object.entries(apps).filter(([id])=>!id.startsWith('_')).map(([id,a])=>({id,...a})),moshpit:{moshpit:{phase:'connected',slots:[]}}}}
const waitCount=async n=>{for(let i=0;i<100&&requests.length<n;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(requests.length,n)}
let browser
try {
 browser=await chromium.launch({channel:'msedge',headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{window.EventSource=class{addEventListener(){}close(){}}})
 await page.goto(`http://127.0.0.1:${server.address().port}/ui/index.html`)
 await page.waitForFunction(()=>window.WAXY);await page.evaluate(s=>WAXY.status(s),status)
 await page.getByRole('tab',{name:'Map',exact:true}).click()
 // Unchanged renders must preserve native select focus; innerHTML serialization is not a render key.
 await page.locator('#app-select').focus()
 await page.evaluate(()=>{window.focusedAppSelect=document.querySelector('#app-select');for(let i=0;i<3;i++)renderProfileBar()})
 const stableAppSelect=()=>page.evaluate(()=>focusedAppSelect===document.querySelector('#app-select')&&document.activeElement===focusedAppSelect)
 assert(await stableAppSelect(),'unchanged profile-bar renders preserve the exact focused App select')
 await page.evaluate(s=>{WAXY.status(s);WAXY.status(s)},status)
 assert(await stableAppSelect(),'unchanged status snapshots preserve App focus')
 await page.waitForTimeout(2100)
 assert(await stableAppSelect(),'periodic render ticks preserve App focus')

 const settled=()=>page.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved ')&&!document.querySelector('#undobtn').disabled)
 const select=async k=>{const el=page.locator(`[data-k="${k}"]`);if(!await el.evaluate(e=>e.classList.contains('sel')))await el.click()}
 await select('center:0');const original=await page.locator('#flabel').inputValue()
 await page.locator('#flabel').fill('TAB LABEL');await page.locator('#flabel').press('Tab');await waitCount(1);await settled()
 assert.equal(profiles.moshpit.pages[0].keys['0'].label,'TAB LABEL')
 await select('center:2');await select('center:0');assert.equal(await page.locator('#flabel').inputValue(),'TAB LABEL')
 await page.locator('#undobtn').click();await waitCount(2);await page.waitForFunction(()=>!document.querySelector('#redobtn').disabled)
 assert.equal(profiles.moshpit.pages[0].keys['0'].label,original,'Undo restores the label saved on Tab')
 await select('center:0')
 const untouched=structuredClone(profiles.moshpit.pages[0].keys['2'])
 await page.locator('#flabel').fill('CLICK KEY');await select('center:2');await waitCount(3);await settled()
 assert.equal(profiles.moshpit.pages[0].keys['0'].label,'CLICK KEY','click-away commits the departing control')
 assert.deepEqual(profiles.moshpit.pages[0].keys['2'],untouched,'newly selected control is unchanged')
 await select('knobTL');await page.locator('#flabel').fill('TAB KNOB');await page.locator('#flabel').press('Tab');await waitCount(4);await settled()
 assert.equal(profiles.moshpit.pages[0].dials.TL.name,'TAB KNOB')
 await page.locator('#flabel').fill('CLICK KNOB');await select('center:0');await waitCount(5);await settled()
 assert.equal(profiles.moshpit.pages[0].dials.TL.name,'CLICK KNOB')
 hold=true
 await page.locator('#flabel').fill('ENTER ONCE');await page.locator('#flabel').press('Enter');await waitCount(6)
 await page.locator('#flabel').press('Tab');assert.equal(requests.length,6)
 requests[5].respond();hold=false;await settled();await page.waitForTimeout(100)
 assert.equal(requests.length,6,'Enter then blur does not enqueue a duplicate save')
 // Keep an old node to simulate a delayed change after selection, then reject even reattached nodes.
 await page.evaluate(()=>{window.oldField=document.querySelector('#flabel')})
 await select('center:2')
 await page.evaluate(()=>{oldField.value='STALE';commitField(oldField);document.querySelector('#flabel').replaceWith(oldField);commitField(oldField);renderInspector()})
 assert.equal(requests.length,6,'detached or mismatched-owner fields cannot write')
 await page.locator('[data-scope="system"]').click();await page.locator('#q').fill('Keyboard shortcut');await page.locator('#lib .it').click()
 await page.locator('#fv').fill('ctrl+x');await page.locator('#fv').dispatchEvent('change')
 await page.locator('#q').click();assert.equal(requests.length,6,'pending Bind parameter change and blur remain a preview')
 await page.locator('#cancelbtn').click()
 // The fixture refuses missing/stale tokens without changing its in-memory file.
 const before=JSON.stringify(profiles.moshpit)
 for(const extra of [{},{expectedRevision:'stale'}]) {
  const refused=await fetch(`http://127.0.0.1:${server.address().port}/api/profile`,{method:'POST',body:JSON.stringify({id:'moshpit',text:JSON.stringify({...profiles.moshpit,name:'REFUSED'}),...extra})}).then(r=>r.json())
  assert.equal(refused.ok,false);assert.equal(refused.conflict,true);assert.equal(JSON.stringify(profiles.moshpit),before)
 }
 // Final usability pass exercises real select events and the existing save ACK path.
 await select('center:0');const originalColour=profiles.moshpit.pages[0].keys['0'].color
 hold=true;await page.locator('#fcolor').selectOption('green');await waitCount(9)
 assert.match(await page.locator('#editor-saved').textContent(),/Saving/)
 requests.at(-1).respond(false);hold=false
 await page.waitForFunction(()=>document.querySelector('#editor-saved').textContent.includes('Not saved'))
 assert.equal(profiles.moshpit.pages[0].keys['0'].color,originalColour,'refused colour change preserves profile')
 await page.locator('#fcolor').selectOption('green');await waitCount(10);await settled()
 assert.equal(profiles.moshpit.pages[0].keys['0'].color,'green');assert.match(await page.locator('#editor-saved').textContent(),/Saved/)
 await page.locator('#undobtn').click();await waitCount(11);await settled()
 assert.equal(profiles.moshpit.pages[0].keys['0'].color,originalColour,'colour undo restores inheritance')
 await select('center:0');await page.locator('#fcolor').selectOption('');await waitCount(12);await settled()
 assert.equal(profiles.moshpit.pages[0].keys['0'].color,undefined,'App colour removes local override')
 await page.evaluate(()=>{window.oldColour=document.querySelector('#fcolor')})
 await select('center:2')
 await page.evaluate(()=>{oldColour.value='green';document.querySelector('#fcolor').replaceWith(oldColour);oldColour.dispatchEvent(new Event('change',{bubbles:true}));renderInspector()})
 assert.equal(requests.length,12,'stale colour node cannot modify another key')
 await page.locator('#q').fill('')
 for(const size of [{width:1440,height:1000},{width:1280,height:800}]) {
  await page.setViewportSize(size)
  const bounds=await page.evaluate(()=>{
   const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}}
   return {library:rect('.lib'),inspector:rect('.insp'),label:rect('#flabel'),colour:rect('#fcolor'),toolbar:rect('.editor-toolbar'),bodyWidth:document.body.scrollWidth,viewport:innerWidth}
  })
  assert(bounds.library.height>bounds.inspector.height,'action selection is the larger pane')
  assert.equal(Math.round(bounds.label.y),Math.round(bounds.colour.y),'label and colour share a row')
  assert(bounds.bodyWidth<=bounds.viewport,'no horizontal page overflow')
  assert.equal(await page.locator('.editor-tools #activatebtn').count(),0)
  assert.equal(await page.locator('.device-tools #activatebtn').count(),1)
  if(process.env.EDENA_ARTIFACTS_DIR)await page.screenshot({path:path.join(process.env.EDENA_ARTIFACTS_DIR,'editor-'+size.width+'.png')})
 }
 await page.locator('#app-select').selectOption('main');await page.waitForFunction(()=>document.querySelector('#editing-target').textContent.includes('Home'))
 await page.locator('#app-select').selectOption('moshpit');await page.waitForFunction(()=>document.querySelector('#editing-target').textContent.includes('MOSHPIT'))
 assert(await page.locator('.app-picker .app-glyph svg').count())
 assert.equal(requests.length,12,'app selection does not save profiles')
 assert.equal(await page.locator('#app-select option[value="legacy-fixture"]').count(),0)
 await page.locator('[data-legacy]').click();await page.locator('#app-select').selectOption('legacy-fixture')
 await page.waitForFunction(()=>document.querySelector('#editing-target').textContent.includes('LEGACY FIXTURE'))
 assert.equal(await page.locator('#app-select').inputValue(),'legacy-fixture')
 await page.locator('[data-legacy]').click()
 assert.equal(await page.locator('#app-select option[value="legacy-fixture"]').count(),1,'current legacy app stays reachable when disclosure closes')
 await page.locator('#app-select').selectOption('moshpit')
 assert.equal(await page.locator('#app-select option[value="legacy-fixture"]').count(),0)
 assert.equal(requests.length,12,'legacy browsing never writes a profile')
 assert.deepEqual(errors,[])
 console.log('Normal-mode browser with read/ACK revisions and rejected missing/stale write tokens: key Tab/click-away, dial Tab/click-away, Undo, Enter+blur once, selection ownership, detached/stale field and pending Bind guards passed')
} catch(error) {
 console.error(error)
 throw error
} finally {
 await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})
}
