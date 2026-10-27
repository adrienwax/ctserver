// Executes the actual Electron main module body with boundary-only Electron/router doubles.
// No native app, router, sockets, hardware, user config or profile is imported.
import { homeWindowBounds } from '../host/home-window.mjs'
import { ensureScratch } from './build-scratch/bootstrap.mjs'
const scratch=ensureScratch('build')
const fs=await import('node:fs/promises'),path=await import('node:path'),vm=await import('node:vm')
const {EventEmitter}=await import('node:events'),{createHash}=await import('node:crypto'),{strict:assert}=await import('node:assert')
const sourcePath=new URL('../electron/main.mjs',import.meta.url),source=await fs.readFile(sourcePath,'utf8')
const results=[],unhandled=[]
process.on('unhandledRejection',e=>unhandled.push(String(e)))
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const tick=()=>new Promise(r=>setImmediate(r))
async function fixture({pendingImport=false,pendingReady=false,startInTray=false,dialogResponse=1,dialogFails=false}={}){
 const app=new EventEmitter(),appReady=deferred(),routerImport=deferred(),routerReady=deferred(),windows=[],trays=[],quitEvents=[],stops=[],dialogs=[]
 app.isPackaged=false;app.requestSingleInstanceLock=()=>true;app.whenReady=()=>appReady.promise;app.getVersion=()=> 'test';app.getPath=()=>scratch.artifacts
 app.quit=()=>{const e={prevented:false,preventDefault(){this.prevented=true}};app.emit('before-quit',e);quitEvents.push(e);if(!e.prevented)app.exited=true}
 class BrowserWindow extends EventEmitter{constructor(){super();windows.push(this);this.shows=0;this.hides=0;this.focuses=0;this.minimized=false;this.webContents={setWindowOpenHandler:()=>{}}}isMinimized(){return this.minimized}restore(){this.minimized=false;this.restored=true}show(){this.shows++}hide(){this.hides++}focus(){this.focuses++}loadURL(url){this.url=url;return Promise.resolve()}}
 class Tray extends EventEmitter{constructor(){super();trays.push(this)}setToolTip(t){this.tooltip=t}setContextMenu(menu){this.menu=menu}}
 const dialog={showErrorBox:(title,message)=>dialogs.push({title,message}),showMessageBox:async options=>{dialogs.push(options);if(dialogFails)throw Error('dialog unavailable');return {response:dialogResponse}}}
 const router={hooks:{},ready:routerReady.promise,shutdown:()=>{const d=deferred();stops.push(d);return d.promise}}
 let homeInitializations=0
 const context=vm.createContext({initHomeCandidate:(candidateApp)=>{assert.equal(candidateApp,app);homeInitializations++;return false},homeWindowBounds,screen:{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},app,BrowserWindow,Menu:{setApplicationMenu:()=>{},buildFromTemplate:t=>t},Tray,dialog,shell:{openExternal:()=>{}},fs:{existsSync:()=>false},path,fileURLToPath:()=>path.join(scratch.artifacts,'electron','main.mjs'),upgradeConfig:()=>({files:[]}),process:{argv:startInTray?['--start-in-tray']:[],env:{},resourcesPath:scratch.artifacts},console,routerImport:routerImport.promise})
 const body=source.replace(/^import .*$/gm,'').replaceAll('import.meta.url',JSON.stringify(sourcePath.href)).replace("import('../router.mjs')",'routerImport')
 const loading=new vm.Script('(async()=>{'+body+'})()', {filename:sourcePath.pathname}).runInContext(context)
 loading.catch(e=>unhandled.push('module: '+e.stack))
 appReady.resolve();if(!pendingImport)routerImport.resolve(router);if(!pendingReady)routerReady.resolve({url:'http://offline.invalid'})
 await tick();assert.equal(homeInitializations,1,'Home boundary initialized');assert.equal(app.listenerCount('before-quit'),1,'Actual lifecycle handlers installed');return {app,windows,trays,quitEvents,stops,dialogs,router,loading,routerImport,routerReady,finish:async()=>{routerImport.resolve(router);routerReady.resolve({url:'http://offline.invalid'});for(const d of stops)d.resolve();await tick()}}
}
async function test(name,fn){let f;try{f=await fn();results.push({name,pass:true})}catch(e){results.push({name,pass:false,error:e.stack})}finally{await f?.finish()}}
await test('repeated Quit stays prevented until shared shutdown completes',async()=>{const f=await fixture();f.app.quit();await tick();f.app.quit();assert(f.quitEvents.every(e=>e.prevented));assert.equal(f.stops.length,1);assert(!f.app.exited);f.stops[0].resolve();await tick();assert(f.app.exited);assert.equal(f.quitEvents.filter(e=>!e.prevented).length,1);return f})
await test('shutdown failure keeps app alive and offers explicit retry',async()=>{const f=await fixture();f.app.quit();await tick();f.stops[0].reject(Error('owner close refused'));await tick();assert(!f.app.exited);assert(f.dialogs.some(d=>d.buttons?.some(b=>/retry/i.test(b))));f.app.quit();await tick();assert.equal(f.stops.length,2);assert(f.quitEvents.every(e=>e.prevented));f.stops[1].resolve();await tick();assert(f.app.exited);return f})
await test('Retry button requests a new attempt and success permits normal quit',async()=>{const f=await fixture({dialogResponse:0});f.app.quit();await tick();f.stops[0].reject(Error('first close failed'));await tick();assert.equal(f.stops.length,2);assert(!f.app.exited);assert(f.quitEvents.every(e=>e.prevented));f.stops[1].resolve();await tick();assert(f.app.exited);return f})
await test('failed early Quit can keep a diagnostic window open and retry later',async()=>{const f=await fixture({pendingReady:true});f.app.quit();await tick();f.routerReady.resolve({url:'http://offline.invalid'});await tick();assert.equal(f.windows.length,0);f.stops[0].reject(Error('early close failed'));await tick();assert.equal(f.windows.length,1);assert(!f.app.exited);f.app.quit();await tick();f.stops[1].resolve();await tick();assert(f.app.exited);return f})
await test('failure to display recovery dialog remains handled and retryable',async()=>{const f=await fixture({dialogFails:true});f.app.quit();await tick();f.stops[0].reject(Error('close refused'));await tick();assert(!f.app.exited);assert(f.dialogs.some(d=>d.title==='CT server is still open'));f.app.quit();await tick();f.stops[1].resolve();await tick();assert(f.app.exited);return f})
await test('Quit during router import cannot bypass shutdown or create a window',async()=>{const f=await fixture({pendingImport:true});f.app.quit();assert(f.quitEvents[0].prevented);f.routerImport.resolve(f.router);await tick();assert.equal(f.stops.length,1);assert.equal(f.windows.length,0);f.stops[0].resolve();await tick();assert(f.app.exited);return f})
await test('router readiness after Quit cannot create a window',async()=>{const f=await fixture({pendingReady:true});f.app.quit();await tick();f.routerReady.resolve({url:'http://offline.invalid'});await tick();assert.equal(f.windows.length,0);f.stops[0].resolve();await tick();return f})
await test('late ready-to-show and second-instance stay hidden while closing',async()=>{const f=await fixture();const w=f.windows[0];assert(w);f.app.quit();await tick();w.emit('ready-to-show');f.app.emit('second-instance');assert.equal(w.shows,0);f.stops[0].resolve();await tick();return f})
await test('ordinary close/minimize hide; tray and second-instance restore',async()=>{const f=await fixture({startInTray:true}),w=f.windows[0];w.emit('ready-to-show');assert.equal(w.shows,0);const e={prevented:false,preventDefault(){this.prevented=true}};w.emit('close',e);assert(e.prevented);assert.equal(w.hides,1);w.emit('minimize');assert.equal(w.hides,2);w.minimized=true;f.app.emit('second-instance');assert(w.restored);assert.equal(w.shows,1);f.trays[0].emit('click');f.trays[0].emit('double-click');assert.equal(w.shows,3);return f})
await tick();results.push({name:'no unhandled rejection',pass:unhandled.length===0,unhandled})
const report={source:sourcePath.href,sha256:createHash('sha256').update(source).digest('hex'),mode:'actual source with mocked boundaries; no native/hardware',results,pass:results.every(r=>r.pass)}
await fs.writeFile(path.join(scratch.artifacts,'ELECTRON-LIFECYCLE.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1
