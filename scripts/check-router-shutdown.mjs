// Actual router source with inert OS/HTTP/device dependencies. No real owner is forked.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fork } from 'node:child_process'
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ct-router-shutdown-'))
const bridge=path.join(tmp,'bridge'); fs.mkdirSync(bridge)
fs.writeFileSync(path.join(bridge,'connect-ct.mjs'),'export const findCT=async()=>{if(process.env.CASE==="startup")await new Promise(r=>globalThis.resumeUsb=r);return null}')
fs.writeFileSync(path.join(tmp,'config.json'),JSON.stringify({hostAuto:true,bridgeDir:bridge,edenaDir:tmp,port:61999}))
const entry=path.join(tmp,'boot.mjs')
fs.writeFileSync(entry,`
import cp from 'node:child_process'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import {EventEmitter} from 'node:events'; import {syncBuiltinESMExports} from 'node:module';
let owner,serve; const failures=[]; let stops=0;
cp.execFile=(cmd,...args)=>{queueMicrotask(()=>args.at(-1)(null,'[]',''));return {unref(){}}};cp.execFileSync=()=>'';
cp.spawn=()=>{throw Error('forbidden native launch')};
cp.fork=()=>{owner=new EventEmitter();owner.pid=process.pid;owner.send=()=>{stops++};
fs.writeFileSync(path.join(process.env.LOCALAPPDATA,'ct-router','owner.json'),JSON.stringify({owner:'waxyct',pid:process.pid,updated:Date.now(),state:'connected'}));return owner};
http.createServer=handler=>(serve=handler,Object.assign(new EventEmitter(),{listen(_p,_h,cb){queueMicrotask(cb);return this}}));
globalThis.fetch=async()=>({ok:false,json:async()=>({})});syncBuiltinESMExports();
const router=await import(${JSON.stringify(new URL('../router.mjs',import.meta.url).href)});await router.ready;
if(process.env.CASE==='startup'){
await router.shutdown('startup quit');globalThis.resumeUsb?.();await new Promise(r=>setTimeout(r,1200));
if(owner)failures.push('startup continuation forked an owner after successful shutdown');process.send?.({failures,stops});process.exit(failures.length?1:0);
}
while(!owner) await new Promise(r=>setTimeout(r,5));
const first=router.shutdown('first'); const second=router.shutdown('second');
if(first!==second) failures.push('concurrent callers do not share the pending shutdown');
let secondDone=false;void second.then(()=>{secondDone=true},()=>{secondDone=true});
await new Promise(r=>setTimeout(r,30));if(secondDone)failures.push('second caller resolved while owned child still alive');
const results=await Promise.allSettled([first,second]);if(results.some(r=>r.status!=='rejected'))failures.push('stop timeout was swallowed');
for(const url of ['/api/owner','/api/deck']){
const request=new EventEmitter();Object.assign(request,{method:'POST',url,headers:{'x-ct-router':'1',host:'127.0.0.1:61999'},setEncoding(){}});
let status;const response={writeHead(code){status=code},end(){}};serve(request,response);request.emit('data',JSON.stringify({to:'edena',type:'switch',id:'main'}));request.emit('end');
if(status!==409)failures.push('shutdown pause accepts manual operation '+url);
}
const count=stops;const retry=router.shutdown('retry');await new Promise(r=>setTimeout(r,20));
if(stops<=count)failures.push('retry did not request clean stop again');owner.emit('exit',0);await retry;
process.send?.({failures,stops});process.exit(failures.length?1:0);
`)
let output='',report
try {
for(const mode of ['active','startup']) {
const child=fork(entry,[],{execArgv:[],env:{...process.env,CASE:mode,LOCALAPPDATA:path.join(tmp,'local'),APPDATA:path.join(tmp,'roaming'),WAXYCT_ROUTER_CONFIG:path.join(tmp,'config.json'),WAXYCT_CONFIG:path.join(tmp,'profiles')},silent:true,windowsHide:true})
child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('message',m=>report=m)
const code=await new Promise(resolve=>child.once('exit',resolve))
assert.equal(code,0,JSON.stringify(report)+'\n'+output);assert.deepEqual(report.failures,[])
}
console.log('router shutdown: shared pending, timeout rejection, retry, manual pause and startup pause passed (fake owners only)')
} finally { assert.equal(path.dirname(tmp),path.resolve(os.tmpdir()));fs.rmSync(tmp,{recursive:true,force:true}) }
