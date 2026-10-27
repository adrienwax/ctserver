// Actual deck-host, delayed fake opens/closes. No CT, native input, sockets or owner config.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fork} from 'node:child_process'
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ct-deck-lifecycle-'))
const bridge=path.join(tmp,'bridge'),config=path.join(tmp,'config');fs.mkdirSync(bridge);fs.mkdirSync(path.join(config,'profiles'),{recursive:true})
const write=(dir,file,data)=>fs.writeFileSync(path.join(dir,file),typeof data==='string'?data:JSON.stringify(data))
write(config,'settings.json',{startProfile:'main'});write(config,'apps.json',{});write(path.join(config,'profiles'),'main.json',{name:'MAIN',color:'bone',pages:[{name:'MAIN',keys:{}}]})
write(bridge,'config.json',{td:{}})
write(bridge,'ct-claim.mjs',`const emit=m=>{if(process.connected)process.send(m);else console.log('FAKE '+JSON.stringify(m))};export const REFRESH_MS=100;export const claim=()=>{emit({type:'claim'});return null};export const update=value=>emit({type:'claim-update',value});export const release=()=>emit({type:'release'});`)
write(bridge,'ct-draw.mjs',`export const setGlyphs=()=>{};export const surface=()=>({});export const renderKeys=()=>({});export const toRgb565=()=>Buffer.alloc(2);export const text=()=>{};export const stroke=()=>{};`)
write(bridge,'ct-td-map.mjs',`export const buildScript=()=>'';export const RIG_STATE_PY='';`)
write(bridge,'td-client.mjs',`export const makeTdClient=()=>({handshake:async()=>({ok:false}),exec:async()=>({success:false})});`)
write(bridge,'connect-ct.mjs',`
import {EventEmitter} from 'node:events';import fs from 'node:fs';let seq=0,pending,device,closing,closeCalls=0,armed=false,ack;
const early=process.env.CASE.startsWith('early-');
const emit=m=>{if(process.connected)process.send(m);else console.log('FAKE '+JSON.stringify(m))};
if(early){
emit({type:'importing'});await new Promise(resolve=>{const timer=setInterval(()=>{if(fs.existsSync(process.env.IMPORT_RELEASE)){clearInterval(timer);resolve()}},10)});
const cleanup=setInterval(()=>{if(fs.existsSync(process.env.IMPORT_CLEANUP)){clearInterval(cleanup);process.emit('SIGTERM')}},10);
}
else process.on('message',m=>{if(m==='arm-ack'){armed=true;emit({type:'armed'})}if(m==='resolve-ack')ack?.();if(m==='resolve-open')pending?.();if(m==='disconnect-device')device?.emit('disconnect');if(m==='resolve-close')closing?.()});export const findCT=async()=>({path:'fake'});
const cosmetic=async stage=>{emit({type:'cosmetic',stage});if(process.env.CASE==='ack-brightness'&&stage==='brightness'||armed&&process.env.CASE==='ack-'+stage){emit({type:'ack-blocked',stage});await new Promise(r=>ack=r)}};
export const connectCT=async()=>{const id=++seq;emit({type:'opening',id});await new Promise(r=>early?setTimeout(r,100):pending=r);
device=Object.assign(new EventEmitter(),{path:'fake-'+id,connection:{isReady:()=>true},send:async()=>emit({type:'ping',id}),
setBrightness:async()=>{emit({type:'brightness',id});await cosmetic('brightness')},drawBuffer:async(screen,buffer)=>{emit({type:'draw',id});if(buffer.length>2){await cosmetic('frame-'+screen.id);if(screen.autoRefresh!==false)await device.refresh(screen.id)}},refresh:async screen=>cosmetic('refresh-'+screen),setButtonColor:async button=>{if(armed)await cosmetic('led'+button.id)},vibrate:async()=>{},
close:async()=>{closeCalls++;emit({type:'closing',id,listeners:device.eventNames().length});if(process.env.CASE==='close-failure'&&closeCalls===1)throw Error('controlled close failure');if(['reconnect','retry-delay'].includes(process.env.CASE)&&id===1){emit({type:'closed',id});return}if(!early)await new Promise(r=>closing=r);emit({type:'closed',id})}});return device};
`)
const failures=[]
for(const scenario of ['early-stop','early-disconnect','initial','reconnect','close-failure','retry-delay','ack-brightness',...[...['center','left','right','knob'].flatMap(id=>['frame-'+id,'refresh-'+id]),...Array.from({length:8},(_,i)=>'led'+i)].map(id=>'ack-'+id)]) {
let messages=[],output='',exit
const releaseFile=path.join(tmp,scenario+'-release'),cleanupFile=path.join(tmp,scenario+'-cleanup')
const child=fork(new URL('../host/deck-host.mjs',import.meta.url),['--dry-input'],{execArgv:[],env:{...process.env,WAXYCT_CONFIG:config,WAXYCT_BRIDGE:bridge,CASE:scenario,IMPORT_RELEASE:releaseFile,IMPORT_CLEANUP:cleanupFile},silent:true,windowsHide:true})
child.on('message',m=>messages.push(m));let stdoutBuffer='';child.stdout.on('data',b=>{output+=b;stdoutBuffer+=b;let i;while((i=stdoutBuffer.indexOf('\n'))>=0){const line=stdoutBuffer.slice(0,i);stdoutBuffer=stdoutBuffer.slice(i+1);if(line.startsWith('FAKE '))messages.push(JSON.parse(line.slice(5)))}});child.stderr.on('data',b=>output+=b);const finished=new Promise(r=>child.once('exit',code=>{exit=code;r()}))
const until=async(fn,ms=5000)=>{const end=Date.now()+ms;while(!fn()&&exit===undefined&&Date.now()<end)await new Promise(r=>setTimeout(r,10));return fn()}
try {
if(scenario.startsWith('early-')){
assert(await until(()=>messages.some(m=>m.type==='importing')),output);
if(scenario==='early-stop'){child.send('stop');child.send('stop')}else child.disconnect();
await new Promise(r=>setTimeout(r,60));fs.writeFileSync(releaseFile,'go');
if(scenario==='early-disconnect'){
await until(()=>messages.some(m=>m.type==='opening'),500);
if(messages.some(m=>m.type==='claim'||m.type==='opening'))failures.push('early-disconnect: claimed/opened after parent IPC disconnect during import');
fs.writeFileSync(cleanupFile,'cleanup');
}
assert(await until(()=>exit!==undefined),output);assert.equal(exit,0,output);
const opened=messages.findIndex(m=>m.type==='opening'),closed=messages.findIndex(m=>m.type==='closed'),released=messages.findIndex(m=>m.type==='release');
if(opened>=0)assert(closed>opened&&released>closed,'queued Stop must close any pending open before releasing claim');
console.log(scenario+': '+messages.map(m=>m.type).join(' -> '));continue;
}assert(await until(()=>messages.some(m=>m.type==='opening'&&m.id===1)),output)
if(scenario.startsWith('ack-')){
child.send('resolve-open');
if(scenario==='ack-brightness')assert(await until(()=>messages.some(m=>m.type==='ack-blocked')),output)
else {assert(await until(()=>output.includes('LIVE:')),output);child.send('arm-ack');assert(await until(()=>messages.some(m=>m.type==='armed')),output)}
child.send('stop');child.send('stop');
assert(await until(()=>messages.some(m=>m.type==='ack-blocked')),scenario+': target cosmetic stage not reached\n'+output);
assert(await until(()=>messages.some(m=>m.type==='closing'),3000),scenario+': missing ACK must not prevent close\n'+output);
assert.equal(exit,undefined,'actual close must still be awaited');assert(!messages.some(m=>m.type==='release'),'claim retained until close');
if(scenario==='ack-brightness')assert.equal(messages.find(m=>m.type==='closing').listeners,0,'cancelled startup brightness must not wire input');
const cosmeticCount=messages.filter(m=>m.type==='cosmetic').length;
child.send('resolve-ack');await new Promise(r=>setTimeout(r,40));
assert.equal(messages.filter(m=>m.type==='cosmetic').length,cosmeticCount,'late ACK must not resume blank sequence');
assert(!messages.some(m=>m.type==='release'),'late ACK is not actual close');
child.send('resolve-close');assert(await until(()=>exit!==undefined),output);assert.equal(exit,0,output);
assert(messages.findIndex(m=>m.type==='closed')<messages.findIndex(m=>m.type==='release'),'close before release');continue;
}
if(['reconnect','retry-delay'].includes(scenario)){child.send('resolve-open');assert(await until(()=>output.includes('LIVE:')),output);child.send('disconnect-device');
if(scenario==='reconnect')assert(await until(()=>messages.some(m=>m.type==='opening'&&m.id===2)),output)
else {assert(await until(()=>messages.some(m=>m.type==='closed'&&m.id===1)),output);child.send('stop');await finished;assert.equal(messages.filter(m=>m.type==='opening').length,1,'stop during retry delay must not open again');assert.equal(exit,0,output);continue}}
const mark=messages.length;child.send('stop');child.send('stop');await new Promise(r=>setTimeout(r,60));
if(exit!==undefined||messages.slice(mark).some(m=>m.type==='release'))failures.push(scenario+': released/exited while open pending')
if(exit===undefined){child.send('resolve-open');const id=scenario==='reconnect'?2:1;await until(()=>messages.some(m=>m.type==='closing'&&m.id===id));
if(messages.slice(mark).some(m=>m.type==='ping'))failures.push(scenario+': heartbeat sent after stop');
if(messages.some(m=>m.type==='closing'&&m.id===id&&m.listeners!==0))failures.push(scenario+': late device has active input listeners');
if(messages.slice(mark).some(m=>m.type==='brightness'||m.type==='claim-update'&&m.value.state==='connected'))failures.push(scenario+': late open published or set brightness after stop')
if(messages.slice(mark).some(m=>m.type==='release'))failures.push(scenario+': released before late device close settled')
if(scenario==='close-failure'){
assert(await until(()=>output.includes('CT close failed:')),output);assert.equal(exit,undefined,'failed close must keep process and claim alive');assert(!messages.slice(mark).some(m=>m.type==='release'));
child.send('stop');assert(await until(()=>messages.filter(m=>m.type==='closing'&&m.id===id).length===2),output)}
if(child.connected)child.send('resolve-close');await finished;
const closed=messages.findIndex(m=>m.type==='closed'&&m.id===id),released=messages.findIndex((m,i)=>i>=mark&&m.type==='release');if(closed<0||released<closed)failures.push(scenario+': missing close-before-release order')}
assert.equal(exit,0,output)
} finally { if(exit===undefined&&scenario.startsWith('early-')){fs.writeFileSync(releaseFile,'go');fs.writeFileSync(cleanupFile,'cleanup');await finished} else if(exit===undefined&&child.connected){child.send('resolve-ack');child.send('resolve-open');child.send('resolve-close');child.send('stop');await finished} }
}
try {assert.deepEqual(failures,[]);console.log('deck lifecycle: delayed-import queued stop/disconnect, pending initial/reconnect opens, repeated stop, failed-close retry, retry-delay stop, close-before-release, withheld brightness and all 16 framebuffer/refresh/LED ACKs passed (fake CT)')}
finally{assert.equal(path.dirname(tmp),path.resolve(os.tmpdir()));fs.rmSync(tmp,{recursive:true,force:true})}
