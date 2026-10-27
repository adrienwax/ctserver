// Real desktop UI with synthetic host snapshots; no router/device/OS input or installed writes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import {fork} from 'node:child_process'
import {fileURLToPath, pathToFileURL} from 'node:url'
import { ensureScratch } from './build-scratch/bootstrap.mjs'
const managed = ensureScratch('build')
const playwright = process.env.WAXYCT_MOSHPIT_SRC
  ? pathToFileURL(path.join(process.env.WAXYCT_MOSHPIT_SRC, 'node_modules/playwright/index.mjs')).href
  : new URL('../../moshpit-v3/node_modules/playwright/index.mjs', import.meta.url).href
const { chromium } = await import(playwright)
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
assert.notEqual(port,9990)
const fixture=fork(path.join(root,'scripts/serve-icon-fixture.mjs'),[],{env:{...process.env,WAXYCT_FIXTURE_PORT:String(port)},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
let browser
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture startup timed out')),10000);fixture.stdout.on('data',d=>{if(String(d).includes('Icon scratch fixture')){clearTimeout(timer);resolve()}});fixture.once('exit',code=>reject(new Error('Fixture exited '+code)))})
 browser=await chromium.launch({channel:'msedge',headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${port}/?mock=deck-mosh&bare`)
 await page.waitForFunction(()=>window.WAXY&&window.MOCK_PROFILES&&document.querySelector('#apptabs').textContent.includes('Moshpit'))
 await page.evaluate(()=>{
   const deliver=WAXY.status
   window.feedbackPatch={};window.feedbackOffline=false
   WAXY.status=s=>{window.feedbackSnapshot=structuredClone(s);if(!window.feedbackOffline)deliver({...s,host:{...s.host,...window.feedbackPatch}})}
   window.setFeedbackPatch=patch=>{window.feedbackPatch={...window.feedbackPatch,...patch};WAXY.status(window.feedbackSnapshot)}
 })
 await page.waitForFunction(()=>window.feedbackSnapshot)
 const original=await page.evaluate(()=>JSON.stringify(MOCK_PROFILES))
 await page.evaluate(()=>{
   const pg=SCHEMA.pageOf(MOCK_PROFILES.moshpit,1)
   const data={TL:['Block','2 / 6',.2],CL:['Node','Hold',null],BL:['Bank','P1–3',0],TR:['Duration','2.50 beats',.23],CR:['Direction','Ping-pong',.5],BR:['Strength','0',0],wheel:['Frame','0012',.12]}
   window.feedbackGood=Object.fromEntries(Object.entries(data).map(([key,[label,text,norm]])=>[key,{label,text,norm,available:true,bindingKey:JSON.stringify((key==='wheel'?pg.wheel:pg.dials[key])?.turn??null)}]))
   setFeedbackPatch({dialFeedback:structuredClone(feedbackGood)})
 })
 const knob=id=>page.locator(`[data-k="knob${id}"]`),value=id=>knob(id).locator('.dial-value')
 assert.equal(await value('TR').textContent(),'2.50 beats');assert.equal(await value('CR').textContent(),'Ping-pong');assert.equal(await value('BR').textContent(),'0')
 assert.equal(await value('CT').textContent(),'0012');assert.equal(await knob('TR').locator('.dial-map').textContent(),'PARAM 4')
 assert.equal(await knob('TR').locator('.dial-label').textContent(),'Duration')
 assert.ok(await knob('TL').locator('.dial-label').evaluate(el=>el.getBoundingClientRect().height<=12),'short labels stay on one line')
 assert.ok(await value('TR').evaluate(el=>el.scrollWidth<=el.clientWidth),'ordinary unit-bearing values fit without truncation at 1440px')
 assert.equal(await knob('BR').locator('.dial-position>i').evaluate(el=>el.style.width),'0%')
 checks.push('All six knobs and wheel use host text verbatim; actual label, configured mapping, units, enum and zero position survive')
 await page.evaluate(()=>{const d=structuredClone(feedbackGood);d.TR.text='3.75 beats';d.TR.norm=.4;setFeedbackPatch({dialFeedback:d})})
 assert.equal(await value('TR').textContent(),'3.75 beats');checks.push('Incoming feedback updates without changing a mapping')
 for (const [bank,label] of [[0,'P1-6'],[1,'P7-8'],[2,'LFO']]) {
   await page.evaluate(bank=>setFeedbackPatch({moshpit:{...feedbackSnapshot.host.moshpit,moshpit:{...feedbackSnapshot.host.moshpit.moshpit,parameterPage:bank}}}),bank)
   assert.equal(await page.locator('[data-k="center:6"] .lb').textContent(),label)
 }
 checks.push('Live parameter-page screen key follows P1-6/P7-8/LFO without changing stored label')
 await page.evaluate(()=>{const d=structuredClone(feedbackGood);d.CR={...d.CR,label:'',text:'',available:false};setFeedbackPatch({dialFeedback:d})})
 assert.equal(await knob('CR').locator('.dial-label,.dial-value,.dial-map').count(),0)
 await page.evaluate(()=>setFeedbackPatch({dialFeedback:structuredClone(feedbackGood)}))
 checks.push('Missing six-wide parameter stays blank instead of inventing a PARAM label')
 await page.getByRole('tab',{name:'Map',exact:true}).click();await knob('TR').click()
 assert.ok(await page.locator('#fields #flabel').isVisible());assert.equal(await page.locator('#fields #flabel').inputValue(),'PARAM 4')
 assert.equal(await page.evaluate(()=>JSON.stringify(MOCK_PROFILES)),original);checks.push('Clicking a feedback-bearing knob still opens its configured mapping; no profile mutation')
 await page.locator('#insp-close').click()
 for(const patch of [{connected:false},{page:0},{profile:'template'}]){
   await page.evaluate(p=>setFeedbackPatch(p),patch);assert.equal(await value('TR').textContent(),'—')
   assert.equal(await knob('TR').locator('.dial-position').count(),0)
   await page.evaluate(()=>setFeedbackPatch({connected:true,page:1,profile:'moshpit'}))
 }
 await page.evaluate(()=>{feedbackOffline=true;WAXY.offline()});assert.equal(await value('TR').textContent(),'—')
 await page.evaluate(()=>{feedbackOffline=false;WAXY.status(feedbackSnapshot)})
 checks.push('Disconnect, router offline, different live page and different live profile suppress stale values and bars')
 await page.evaluate(()=>{const d=structuredClone(feedbackGood);d.TR.bindingKey='old mapping';d.CR.available=false;d.CR.text='STALE ENUM';setFeedbackPatch({dialFeedback:d})})
 assert.equal(await value('TR').textContent(),'—');assert.equal(await value('CR').textContent(),'—')
 assert.equal(await knob('TR').locator('.dial-label').textContent(),'PARAM 4')
 checks.push('Binding identity mismatch and unavailable feedback never reuse old values')
 await page.evaluate(()=>{const d=structuredClone(feedbackGood);d.TR.label='A very long mapped parameter label';d.TR.text='An exceptionally long enum option <img src=x onerror=alert(1)>';d.TR.norm=null;setFeedbackPatch({dialFeedback:d})})
 assert.equal(await knob('TR').locator('img').count(),0);assert.match(await knob('TR').getAttribute('title'),/exceptionally long enum option/)
 const evidence=managed.artifacts;fs.mkdirSync(evidence,{recursive:true})
 for(const width of [1440,980]){
   await page.setViewportSize({width,height:1000})
   const bounds=await knob('TR').evaluate(el=>{const p=el.getBoundingClientRect();return [...el.querySelectorAll('.dial-map,.dial-label,.dial-value,.dial-position')].map(c=>{const r=c.getBoundingClientRect();return{inside:r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom}})})
   assert.ok(bounds.every(r=>r.inside),`long label and value fit knob at ${width}px`)
   await page.screenshot({path:path.join(evidence,`dial-feedback-long-${width}.png`),fullPage:true})
 }
 await page.evaluate(()=>setFeedbackPatch({dialFeedback:structuredClone(feedbackGood)}));await page.setViewportSize({width:1440,height:1000})
 await page.getByRole('tab',{name:'Live',exact:true}).click();await page.screenshot({path:path.join(evidence,'dial-feedback-controls-1440.png')})
 assert.equal(await page.locator('[data-display] button').count(),6);assert.equal(await page.locator('[data-k="left"],[data-k="right"]').count(),0)
 assert.equal(await page.evaluate(()=>JSON.stringify(MOCK_PROFILES)),original)
 checks.push('Long text is bounded with full tooltip, escaped HTML, unchanged knob sizes and display-only side strips at 1440/980px')
 assert.deepEqual(errors,[])
 fs.writeFileSync(path.join(evidence,'dial-feedback-ui.json'),JSON.stringify({checks,errors,boundary:'Synthetic host snapshots, real desktop UI. No native device or live endpoints.'},null,2))
 console.log(JSON.stringify({checks,errors,evidence},null,2))
}finally{
 if(browser)await browser.close()
 if (fixture.connected) fixture.send('close')
 await new Promise(resolve=>{if(fixture.exitCode!==null)return resolve();fixture.once('exit',resolve)})
}
