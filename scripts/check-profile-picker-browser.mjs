// Controlled browser UI only. Static snapshots and recording-only APIs; no router/native/CT imports.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import vm from 'node:vm'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {ensureScratch} from './build-scratch/bootstrap.mjs'
import {parseIconSvg} from '../ui/icon-model.mjs'
const managed=ensureScratch('portable-test'), root=fileURLToPath(new URL('..',import.meta.url))
const {chromium}=await import(process.env.CT_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.CT_PLAYWRIGHT_MODULE).href : 'playwright')
const readJSON=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))
// Serve exactly the production allowlist without importing or executing the router.
const routerSource=fs.readFileSync(path.join(root,'router.mjs'),'utf8')
const uiLiteral=routerSource.match(/const UI = (\{[\s\S]*?\n\})/)
assert(uiLiteral,'Production UI allowlist must remain inspectable')
const uiFiles=vm.runInNewContext(`(${uiLiteral[1]})`,Object.create(null),{timeout:1000})
assert(uiFiles['/profile-picker.js'],'Production router must serve profile-picker.js')
const profiles=Object.fromEntries(['main','template','moshpit'].map(id=>[id,readJSON(`config/profiles/${id}.json`)]))
const apps={moshpit:{name:'Moshpit',target:'moshpit'},touchdesigner:{name:'TouchDesigner',target:'td'},future:{name:'Future host',target:'td'},old:{name:'Old tool',target:'td',tier:'legacy'},park:{name:'Parked tool',target:'td',tier:'parked'}}
for (const [id,name,app,tier] of [['pilot','Temporal Memory','touchdesigner'],['future-profile','Another installed app','future'],['legacy','Old mapping','old','legacy'],['parked','Parked mapping','park','parked']]) profiles[id]={...structuredClone(profiles.template),name,app,tier}
for(let i=0;i<24;i++)profiles[`variant-${i}`]={...structuredClone(profiles.template),name:`Time Bands ${String(i+1).padStart(2,'0')}`}
const projects=[{profileId:'pilot',projectId:'pilot-v1',title:'Temporal Memory study',appId:'touchdesigner',author:'MOSHMAN',version:'1.0',status:'ready',canOpen:true},{profileId:'pilot',projectId:'pilot-v2',title:'Temporal Memory alternate',appId:'touchdesigner',author:'Claude',version:'2.0',status:'missing',reason:'Saved project missing',canOpen:false},{profileId:'future-profile',author:'Waxy',version:'3.0',status:'unconfigured',canOpen:false}]
const pilotId='atlas-moshman-td-temporal-memory-abac500b'
profiles[pilotId]=readJSON(`config/profiles/${pilotId}.json`)
const pilot=profiles[pilotId]
projects.push({profileId:pilotId,projectId:pilot.metadata.projectId,title:pilot.metadata.title,appId:pilot.app,author:pilot.metadata.author,version:pilot.metadata.version,status:'unconfigured',canOpen:false,reason:'Fixture has no native project link'})
const icons=Object.fromEntries(fs.readdirSync(path.join(root,'ui/icons')).filter(n=>n.endsWith('.svg')).map(n=>[n.slice(0,-4),{lines:parseIconSvg(fs.readFileSync(path.join(root,'ui/icons',n),'utf8')),source:'default'}]))
const host={apps:Object.entries(apps).map(([id,a])=>({id,...a})),profile:'main',page:0,profileName:'Home',pageName:'Home',connected:true,errors:[],profiles:Object.entries(profiles).map(([id,p])=>({id,name:p.name,appId:p.app||null,tier:p.tier||'current',color:p.color,pages:p.pages.map(pg=>pg.name)}))}
const state={now:Date.now(),usb:{present:true,port:'TEST'},replug:{},claim:{owner:'waxyct',state:'connected',lastInput:Date.now(),since:Date.now()},procs:{edena:[],edenaMain:null,bridges:[],loupedeck:[]},td:{ok:true},power:{suspend:{ac:0,dc:0},hub:{name:'Fixture',allowOff:false}},hooks:{bridge:true,edena:true},edena:{},busy:null,target:null,steps:[],error:null,test:null,autostart:false,children:{host:1},host,note:'Browser fixture only'}
const mutations=[],streams=new Set(),checks=[],errors=[],outside=[]
let failInventory=false, refuseOpen=false
const broadcast=()=>{state.now=Date.now();for(const stream of streams)stream.write(`event: status\ndata: ${JSON.stringify(state)}\n\n`)}
const json=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1')
 if(req.method==='GET'&&url.pathname==='/events'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});streams.add(res);req.on('close',()=>streams.delete(res));broadcast();return}
 if(req.method==='GET'&&url.pathname==='/api/projects')return failInventory ? json(res,{error:'Fixture unavailable'},503) : json(res,{projects})
 if(req.method==='GET'&&url.pathname==='/api/apps')return json(res,apps)
 if(req.method==='GET'&&url.pathname==='/api/profiles')return json(res,profiles)
 if(req.method==='GET'&&url.pathname==='/api/icons')return json(res,{icons,folder:'Browser fixture',scratch:true})
 if(req.method==='POST'){
   let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}')
   if(url.pathname==='/api/profile'&&!body.text)return json(res,{text:JSON.stringify(profiles[body.id])})
   mutations.push({path:url.pathname,body})
   if(url.pathname==='/api/deck'&&body.type==='switch'){assert.equal(body.profileOnly,true,'Panel switches must never launch/focus/handoff apps');host.profile=body.id;host.page=0;host.profileName=profiles[body.id].name;host.pageName=profiles[body.id].pages[0].name;broadcast();return json(res,{ok:true})}
   if(url.pathname==='/api/project/open')return refuseOpen ? json(res,{ok:false,error:'Existing project is active; close it yourself first'},409) : json(res,{ok:true,fixture:true})
   return json(res,{ok:false,error:'Only recording fixture actions are available'},400)
 }
 const entry=uiFiles[url.pathname]
 if(!entry)return json(res,{error:'Not in production UI allowlist'},404)
 const file=path.resolve(root,'ui',entry[0])
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,{error:'Not found'},404)
 res.writeHead(200,{'content-type':entry[1],'cache-control':'no-store'});res.end(fs.readFileSync(file))
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;assert(![9990,9991,9981].includes(port))
const origin=`http://127.0.0.1:${port}`;let browser
try{
 browser=await chromium.launch({channel:'msedge',headless:true})
 const context=await browser.newContext({viewport:{width:1280,height:800}})
 await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();outside.push(route.request().url());return route.abort()})
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
 await page.goto(origin+'/');await page.waitForFunction(()=>document.querySelector('.profile-picker-current')?.textContent==='Home')
 const toggle=page.locator('.profile-picker-toggle'), search=page.getByRole('combobox',{name:'Search profiles and projects'}), open=page.getByRole('button',{name:'Open project',exact:true})
 await toggle.click();await search.fill('MOSHMAN study');await page.waitForFunction(()=>document.querySelectorAll('[data-option]').length===1)
 const textBefore=await search.inputValue();broadcast();await page.waitForTimeout(1100);assert.equal(await search.inputValue(),textBefore);assert(await search.evaluate(el=>document.activeElement===el));checks.push('Live snapshot and timer preserve search text/focus')
 await search.press('Enter');await page.waitForFunction(()=>document.querySelector('.profile-picker-current').textContent==='Temporal Memory');assert.equal(mutations.filter(m=>m.path==='/api/project/open').length,0);assert(mutations.some(m=>m.path==='/api/deck'&&m.body.id==='pilot'&&m.body.profileOnly===true));checks.push('Keyboard selection switches only the profile via existing API')
 await open.click();await page.waitForFunction(()=>document.querySelector('.profile-project-state').textContent.includes('project open requested'));assert.deepEqual(mutations.find(m=>m.path==='/api/project/open').body,{profileId:'pilot',projectId:'pilot-v1'});checks.push('Separate explicit opening sends exact profile/project identity to recording fixture')
 refuseOpen=true;await open.click();await page.waitForFunction(()=>document.querySelector('.profile-project-state').textContent.includes('Existing project is active'));refuseOpen=false;checks.push('Backend refusal remains visible; no automatic retry')
 failInventory=true;await toggle.click();await page.waitForFunction(()=>document.querySelector('.profile-picker-count').textContent.includes('unavailable'));assert(await open.isDisabled());await search.press('Escape');failInventory=false;checks.push('Inventory failure fails closed without removing profile browsing')
 await page.getByRole('tab',{name:'Map',exact:true}).click();const beforeMap=mutations.length;await toggle.click();await search.fill('Future host');await search.press('Enter');assert.equal(mutations.length,beforeMap);await page.getByRole('tab',{name:'Live',exact:true}).click();checks.push('Map selection changes editor context without activating CT or opening project')
 await toggle.click();await search.fill('Claude');await search.press('Enter');assert(await open.isDisabled());assert((await page.locator('.profile-project-state').textContent()).includes('Saved project missing'));checks.push('Second project under same profile is distinct and missing cannot open')
 for(const status of ['busy','changed','unsupported']){projects[0].status=status;projects[0].canOpen=false;projects[0].reason=`Fixture ${status}`;await toggle.click();await search.fill('MOSHMAN study');await search.press('Enter');await page.waitForFunction(s=>document.querySelector('.profile-project-state').textContent.includes(`Fixture ${s}`),status);assert(await open.isDisabled())}
 checks.push('Busy/changed/unsupported inventory disables opening with reason')
 await toggle.click();await search.fill('Future host');assert.equal(await page.locator('[data-option]').count(),1);await search.press('Enter');assert((await page.locator('.profile-project-meta').textContent()).includes('Waxy'));checks.push('Real new app inventory and author/version metadata are displayed without hardcoded app IDs')
 await toggle.click();await search.fill('Parked');assert.equal(await page.locator('[data-option]').count(),0);await search.press('Escape');await page.getByRole('button',{name:/Legacy \(/}).click();await toggle.click();await search.fill('Old mapping');assert.equal(await page.locator('[data-option]').count(),1);await search.fill('Parked');assert.equal(await page.locator('[data-option]').count(),0);await search.press('Escape');checks.push('Legacy disclosure works; parked remains excluded')
 await toggle.click();await search.fill('0.1.0-candidate');assert.equal(await page.locator('[data-option]').count(),1);await search.press('Enter');assert((await page.locator('.profile-project-meta').textContent()).includes('MOSHMAN / v0.1.0-candidate'));assert.equal(await page.getByRole('tab',{name:/SET|SMEAR|BANDS|MOTION|OUT/}).count(),5);assert(await open.isDisabled());checks.push('Actual generated pilot profile exposes five pages and real author/version metadata without native project permission')
 await page.getByRole('tab',{name:'Map',exact:true}).click();await toggle.click();await search.fill('Future host');await search.press('Enter');await page.getByRole('button',{name:'Activate on CT',exact:true}).click();assert(mutations.some(m=>m.path==='/api/deck'&&m.body.id==='future-profile'&&m.body.profileOnly===true));await page.getByRole('tab',{name:'Live',exact:true}).click();checks.push('Explicit Activate on CT also uses profileOnly, preserving app ownership')
 projects[0].status='ready';projects[0].canOpen=true;delete projects[0].reason
 for(const width of [1280,980]){
   await page.setViewportSize({width,height:800});await toggle.click();await search.fill('Memory')
   const bounds=await page.locator('.profile-picker-popup').evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight}})
   assert(bounds.left>=0&&bounds.right<=bounds.w&&bounds.bottom<=bounds.h,`picker contained at ${width}`)
   const header=await page.locator('.profile-picker-row').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));assert(header.scroll<=header.client+1,`picker row no horizontal overflow at ${width}`)
   await page.screenshot({path:path.join(managed.artifacts,`profile-picker-${width}.png`)});await search.press('Escape')
 }
 checks.push('Picker popup/row fit 1280×800 and 980×800; screenshots captured')
 const beforeMock=mutations.length
 await page.addInitScript(rows=>{window.MOCK_PROJECTS=rows},projects)
 await page.goto(origin+'/?mock=deck-td&bare');await page.waitForFunction(()=>document.querySelector('.profile-project-state')?.textContent.includes('Browser demo'))
 await toggle.click();await search.fill('MOSHMAN study');await search.press('Enter');assert(await open.isDisabled());await open.dispatchEvent('click');await page.waitForTimeout(100);assert.equal(mutations.length,beforeMock);checks.push('MOCK mode refuses native open even synthetic click and ready fixture')
 assert.deepEqual(outside,[]);assert.deepEqual(errors,[])
 fs.writeFileSync(path.join(managed.artifacts,'profile-picker-browser.json'),JSON.stringify({checks,errors,mutations,port,boundary:'Static fixture and owned headless browser only. No native app, router, CT or TD calls.'},null,2));console.log(JSON.stringify({checks,evidence:managed.artifacts},null,2))
}finally{if(browser)await browser.close();for(const stream of streams)stream.end();await new Promise(resolve=>server.close(resolve))}