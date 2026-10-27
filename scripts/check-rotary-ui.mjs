// Isolated browser proof of fixed modifier labels and every binding path staying read-only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import {fork} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const {chromium}=await import(process.env.CT_PLAYWRIGHT_MODULE || 'playwright')
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
assert.notEqual(port,9990)
const fixture=fork(path.join(root,'scripts/serve-icon-fixture.mjs'),[],{env:{...process.env,WAXYCT_FIXTURE_PORT:String(port)},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
let browser
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture startup timed out')),10000);fixture.stdout.on('data',d=>{if(String(d).includes('Icon scratch fixture')){clearTimeout(timer);resolve()}});fixture.once('exit',code=>reject(new Error('Fixture exited '+code)))})
 browser=await chromium.launch({channel:'msedge',headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${port}/?mock=deck-mosh&bare`)
 await page.waitForFunction(()=>window.WAXY&&window.MOCK_PROFILES&&document.querySelector('#apptabs').textContent.includes('Moshpit'))
 await page.getByRole('tab',{name:'Map',exact:true}).click()
 const original=await page.evaluate(()=>JSON.stringify(MOCK_PROFILES))
 for(const id of ['keyboard','fnL','fnR']){
  const control=page.locator(`[data-k="${id}"]`)
  assert.match(await control.textContent(),id==='keyboard'?/Fine/:/Fast/)
  await control.click()
  assert.match(await page.locator('#bound').textContent(),/Fixed modifier/)
  assert.equal(await page.locator('#fields input').count(),0)
  assert.equal(await page.locator('#trig').isVisible(),false)
  assert.equal(await page.locator('#shortcut-clear').isVisible(),false)
  await page.locator('[data-scope="system"]').click();await page.locator('#q').fill('Mute')
  assert.equal(await page.locator('#lib .it').first().getAttribute('aria-disabled'),'true')
  await page.locator('#lib .it').first().click({force:true})
  assert.equal(await page.locator('#applybtn').count(),0)
  await page.keyboard.press('Delete')
  assert.equal(await page.evaluate(()=>JSON.stringify(MOCK_PROFILES)),original)
 }
 // Action-first cannot target a modifier, nor advertise it as a valid drag destination.
 await page.locator('#insp-close').click();await page.locator('#lib .it').first().click()
 assert.equal(await page.locator('[data-k="keyboard"]').evaluate(e=>e.classList.contains('drop')),false)
 await page.locator('[data-k="keyboard"]').click()
 assert.equal(await page.locator('#ct').evaluate(e=>e.classList.contains('arming')),false)
 assert.equal(await page.locator('#applybtn').count(),0)
 assert.equal(await page.evaluate(()=>JSON.stringify(MOCK_PROFILES)),original)
 // All app pages present the same fixed controls, without requiring profile mutations.
 for(const app of ['Home','TouchDesigner','Moshpit']){
  await page.getByRole('tab',{name:app,exact:true}).click()
  assert.match(await page.locator('[data-k="keyboard"]').textContent(),/Fine/)
  assert.match(await page.locator('[data-k="fnL"]').textContent(),/Fast/)
 }
 await page.locator('[data-k="keyboard"]').click()
 const evidence=path.resolve(root,'../CT-MODIFIER-REVIEW/evidence');fs.mkdirSync(evidence,{recursive:true})
 await page.screenshot({path:path.join(evidence,'fixed-modifiers-1440.png')})
 await page.setViewportSize({width:980,height:780})
 assert.ok(await page.locator('#shortcuts').evaluate(e=>e.getBoundingClientRect().right<=innerWidth+1),'footer hints fit at 980px')
 await page.screenshot({path:path.join(evidence,'fixed-modifiers-980.png'),fullPage:true})
 assert.deepEqual(errors,[])
 console.log('Rotary UI: fixed labels on Home/Moshpit/TD, inspector, action-first, forced action, Delete, no profile mutations and compact footer passed')
}finally{
 if(browser)await browser.close()
 fixture.kill('SIGTERM')
 await new Promise(resolve=>{if(fixture.exitCode!==null)return resolve();fixture.once('exit',resolve)})
}
