// Exercise the actual router and its HTTP allowlist, not a permissive static UI fixture.
// USB discovery and OS process helpers are isolated; no live configuration, CT or app is touched.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'waxyct-router-ui-'))
const reserve=net.createServer()
await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve))
const port=reserve.address().port
await new Promise(resolve=>reserve.close(resolve))
assert.notEqual(port,9990,'never use the live router port')
const bridge=path.join(scratch,'bridge'),config=path.join(scratch,'profiles')
fs.mkdirSync(bridge);fs.mkdirSync(config)
fs.writeFileSync(path.join(bridge,'connect-ct.mjs'),'export async function findCT(){return null}\n')
fs.writeFileSync(path.join(scratch,'router-config.json'),JSON.stringify({port,hostAuto:false,bridgeDir:bridge,edenaDir:path.join(scratch,'no-edena'),tdUrl:'http://127.0.0.1:1/isolated-no-td'}))
const entry=path.join(scratch,'entry.mjs')
fs.writeFileSync(entry,`
import cp from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
const blocked=[],polls=[]
cp.execFile=(command,...args)=>{polls.push(command);queueMicrotask(()=>args.at(-1)(null,'[]',''));return {unref(){}}}
cp.execFileSync=()=>Buffer.from('')
cp.spawn=cp.fork=(command)=>{blocked.push(command);throw new Error('Native launch forbidden in isolated router test')}
syncBuiltinESMExports()
const router=await import(${JSON.stringify(pathToFileURL(path.join(root,'router.mjs')).href)})
process.send({ready:await router.ready})
process.on('message',async message=>{if(message==='close'){await router.shutdown('isolated test finished');process.send({blocked,polls});process.exit(0)}})
`)
let child,browser,log='',report
const errors=[]
try {
 child=fork(entry,[],{env:{...process.env,LOCALAPPDATA:path.join(scratch,'local'),APPDATA:path.join(scratch,'roaming'),WAXYCT_CONFIG:config,WAXYCT_ROUTER_CONFIG:path.join(scratch,'router-config.json')},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
 child.stdout.on('data',data=>{log+=data});child.stderr.on('data',data=>{log+=data})
 const ready=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Isolated router did not start: '+log)),10000)
  child.on('message',message=>{if(message.ready){clearTimeout(timer);resolve(message.ready)}else if(message.blocked)report=message})
  child.once('exit',code=>{clearTimeout(timer);reject(new Error('Isolated router exited '+code+': '+log))})
 })
 const base=ready.url
 assert.equal(base,`http://127.0.0.1:${port}`)
 const pending=[new URL('/',base).href],seen=new Set()
 while(pending.length) {
  const url=pending.shift();if(seen.has(url))continue;seen.add(url)
  const response=await fetch(url),body=await response.text()
  assert.equal(response.status,200,'missing real-router UI route: '+url)
  const mime=response.headers.get('content-type')||''
  if(/\.(?:m?js)$/.test(new URL(url).pathname))assert.match(mime,/javascript/)
  if(new URL(url).pathname==='/'||/\.(?:m?js)$/.test(new URL(url).pathname)) {
   // Includes static imports and the index's sequential script-loader filenames.
   for(const match of body.matchAll(/['"]((?:\.{0,2}\/)?[a-zA-Z0-9_./-]+\.(?:mjs|js|css))['"]/g)) {
    const dependency=new URL(match[1],url)
    if(dependency.origin===base)pending.push(dependency.href)
   }
  }
 }
 assert(seen.has(base+'/editor-model.mjs'),'the entrypoint must exercise the editor model import')
 assert(seen.has(base+'/host/schema.mjs'))
 for(const forbidden of ['/router.mjs','/config/settings.json','/ui/app.js','/../package.json'])assert.equal((await fetch(base+forbidden)).status,404)
 const abort=new AbortController(),events=await fetch(base+'/events',{signal:abort.signal}),reader=events.body.getReader()
 assert.match(events.headers.get('content-type'),/event-stream/)
 const first=new TextDecoder().decode((await reader.read()).value)
 assert.match(first,/event: status/);abort.abort()
 if(process.argv.includes('--browser')) {
  const {chromium}=await import(process.env.CT_PLAYWRIGHT_MODULE || 'playwright')
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:1000}})
  page.on('pageerror',error=>errors.push(error.message))
  page.on('response',response=>{if(/\.(mjs|js|css)(?:\?|$)/.test(response.url())&&response.status()>=400)errors.push(response.status()+' '+response.url())})
  await page.goto(base)
  await page.waitForFunction(()=>window.WAXY&&document.querySelector('#pill-state').textContent!=='Connecting',{},{timeout:10000})
  assert(await page.getByRole('tab',{name:'Map',exact:true}).isVisible())
  await page.getByRole('tab',{name:'Map',exact:true}).click()
  await page.getByRole('tab',{name:'Diagnose',exact:true}).click()
  assert.deepEqual(errors,[],'the real served module graph must boot without browser errors')
 }
 assert(!log.includes('FAILED inside waxyct'),log)
 console.log(`Actual router HTTP: ${seen.size} entrypoint/module/style routes, denied non-UI paths, live SSE${browser?', normal-mode Edge boot and tabs':''} passed; no CT/native app operations`)
} finally {
 await browser?.close()
 if(child&&child.exitCode===null) {
  const closed=new Promise(resolve=>child.once('exit',resolve))
  child.send('close');await closed
 }
 assert.deepEqual(report?.blocked||[],[],'test unexpectedly attempted a native launch')
 // Only the test-created scratch directory is removed, after the child has closed it.
 assert.equal(path.dirname(scratch),path.resolve(os.tmpdir()))
 assert(path.basename(scratch).startsWith('waxyct-router-ui-'))
 fs.rmSync(scratch,{recursive:true,force:true})
}
