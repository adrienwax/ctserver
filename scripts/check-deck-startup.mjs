// Real deck-host startup with inert bridge modules. No device, sockets, native UI or owner config.
import { ensureScratch } from './build-scratch/bootstrap.mjs'
const scratch = ensureScratch('portable-test')
const { default: assert } = await import('node:assert/strict')
const fs = await import('node:fs')
const path = await import('node:path')
const { fork } = await import('node:child_process')
const { fileURLToPath } = await import('node:url')
const value = name => { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1] }
const host = value('--host') || fileURLToPath(new URL('../host/deck-host.mjs', import.meta.url))
const scenarios = value('--scenario') ? [value('--scenario')] : ['absent', 'claimed', 'pending', 'absent-stop', 'claimed-stop']
assert(scenarios.every(s => ['absent', 'claimed', 'pending', 'absent-stop', 'claimed-stop'].includes(s)))
const root = fs.mkdtempSync(path.join(scratch.temp, 'deck-startup-'))
const write = (dir, file, data) => fs.writeFileSync(path.join(dir, file), typeof data === 'string' ? data : JSON.stringify(data))
const pause = ms => new Promise(r => setTimeout(r, ms))
const results = []
try {
for (const scenario of scenarios) {
 const dir = path.join(root, scenario), config = path.join(dir, 'config'), bridge = path.join(dir, 'bridge')
 fs.mkdirSync(path.join(config, 'profiles'), { recursive: true }); fs.mkdirSync(bridge)
 write(config, 'settings.json', { startProfile: 'rig' })
 write(config, 'apps.json', { td: { name: 'Inert TD', color: 'cyan', target: 'td' } })
 write(path.join(config, 'profiles'), 'main.json', { name: 'MAIN', color: 'bone', pages: [{ name: 'Home', keys: {4:{label:'PROFILES',icon:'layers',do:{home:'profiles'}}} }] })
 const dial = { name: 'SPEED', unit:'x', turn: { td: { type: 'rigKnob', par: 'Masterspeed' } } }
 write(path.join(config, 'profiles'), 'rig.json', { name: 'RIG', app: 'td', rigIdentity:{parameter:'Projectid',value:'inert-startup'}, color: 'cyan', pages: [{ name: 'Source', dials: { TL: dial } }, { name: 'Effects', dials: { TL: dial } }] })
 write(bridge, 'config.json', { td: {} })
 write(bridge, 'ct-claim.mjs', "let ready=process.env.STARTUP_CASE!=='claimed';const emit=m=>process.connected&&process.send(m);process.on('message',m=>{if(m==='allow-device')ready=true});export const REFRESH_MS=100;export const claim=()=>{emit({type:'claim'});return ready?null:{owner:'inert-other-owner',pid:123}};export const update=value=>emit({type:'claim-update',value});export const release=()=>emit({type:'released'});")
 write(bridge, 'ct-draw.mjs', "const emit=m=>process.connected&&process.send(m);export const setGlyphs=()=>{};export const glyphLines=()=>[];export const roundRect=()=>{};export const dot=()=>{};export const surface=(w,h)=>({px:new Uint8Array(w*h*3)});export const renderKeys=()=>({});export const toRgb565=()=>Buffer.alloc(2);export const text=(_s,text)=>emit({type:'draw-text',text});export const stroke=()=>{};")
 write(bridge, 'ct-td-map.mjs', "export const buildScript=()=> 'inert-action';export const RIG_STATE_PY='inert-read';")
 write(bridge, 'td-client.mjs', "let norm=.375;export const makeTdClient=()=>({handshake:async()=>({ok:true}),exec:async script=>{if(script.includes('inert-action'))norm=.625;return {success:true,data:{result:{clip:1,on:{},norm:{Masterspeed:norm},values:{Masterspeed:norm,Projectid:'inert-startup'},types:{Masterspeed:'Float'},ranges:{Masterspeed:{min:0,max:1,default:.375,scale:'linear'}},parameters:['Masterspeed']}}}}});")
 write(bridge, 'connect-ct.mjs', String.raw`
import {EventEmitter} from 'node:events'
const emit=m=>process.connected&&process.send(m)
let ready=process.env.STARTUP_CASE==='claimed', resolvePending
process.on('message',m=>{if(m==='allow-device'){ready=true;resolvePending?.()}})
export const findCT=async()=>null
export async function connectCT(){
 emit({type:'open-attempt'})
 if(!ready){
  if(process.env.STARTUP_CASE==='pending')await new Promise(resolve=>resolvePending=resolve)
  else throw Error('No Loupedeck CT found')
 }
 emit({type:'device-returned'})
 return Object.assign(new EventEmitter(),{
  path:'inert-startup-ct',connection:{isReady:()=>true},send:async()=>{},
  setBrightness:async()=>emit({type:'brightness'}),
  drawBuffer:async screen=>emit({type:'draw-screen',screen:screen.id}),refresh:async()=>{},
  setButtonColor:async button=>emit({type:'led',id:button.id}),vibrate:async()=>{},
  close:async()=>emit({type:'device-closed'})
 })
}
`)
 const messages = []; let output = '', closed = false, exitCode
 const child = fork(host, ['--dry-input'], { execArgv: [], windowsHide: true, silent: true, env: { ...process.env, WAXYCT_CONFIG: config, WAXYCT_BRIDGE: bridge, STARTUP_CASE: scenario.split('-')[0] } })
 child.on('message', m => messages.push(m))
 child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data)
 child.on('error', error => { output += error.stack; closed = true })
 child.on('close', code => { closed = true; exitCode = code })
 const send = data => { if (child.connected) child.send(data) }
 const until = async (fn, ms = 7000) => { const end = Date.now() + ms; while (!fn() && !closed && Date.now() < end) await pause(20); assert(fn(), scenario + ': timed out or exited (' + exitCode + ')\n' + output) }
 let failure
 try {
  // Two real timer ticks: all three waits used to leave feedback in the TDZ.
  await until(() => messages.filter(m => m.type === 'status' && !m.connected).length >= 2)
  assert.equal(closed, false); assert(!messages.some(m => m.type === 'device-returned'))
  if (scenario.startsWith('absent')) assert(messages.filter(m => m.type === 'open-attempt').length >= 2, 'absent CT retries')
  if (scenario.startsWith('claimed')) assert(!messages.some(m => m.type === 'open-attempt'), 'do not open while another owner holds claim')
  if (scenario === 'pending') assert.equal(messages.filter(m => m.type === 'open-attempt').length, 1, 'no overlapping pending opens')
  const offline = messages.find(m => m.type === 'status')
  assert.equal(offline.errors.length, 0)
  assert.equal(offline.dialFeedback.TL.label, 'SPEED'); assert.equal(offline.dialFeedback.TL.available, false)
  // Panel controls and reload remain usable while startup is suspended.
  let mark = messages.length; send({ type: 'page', page: 2 })
  await until(() => messages.slice(mark).some(m => m.type === 'status' && m.pageName === 'Effects' && !m.connected))
  mark = messages.length; send({ type: 'reload' })
  await until(() => messages.slice(mark).some(m => m.type === 'status' && m.pageName === 'Effects' && !m.connected))
  mark = messages.length; send({ type: 'escape' })
  await until(() => messages.slice(mark).some(m => m.type === 'status' && m.profile === 'main'))
  mark = messages.length; send({ type: 'switch', id: 'rig', page: 1 })
  await until(() => messages.slice(mark).some(m => m.type === 'status' && m.profile === 'rig' && m.pageName === 'Source' && !m.connected))
  if (scenario.endsWith('-stop')) {
   send('stop'); await until(() => closed); assert.equal(exitCode, 0, output)
   assert(!messages.some(m => m.type === 'device-returned'), 'Stop must not acquire a late device')
   assert.equal(messages.filter(m => m.type === 'released').length, 1)
   console.log(scenario + ': normal Stop while disconnected PASS')
  } else {
  send('allow-device')
  await until(() => messages.some(m => m.type === 'status' && m.connected && m.dialFeedback.TL.norm === .375), 10000)
  // Status IPC can precede the asynchronous repaint. Await the actual display
  // evidence, as the rotary-update check below already does.
  await until(() => messages.some(m => m.type === 'draw-text' && m.text === '0.375 x')
    && ['center','left','right','knob'].every(screen => messages.some(m => m.type === 'draw-screen' && m.screen === screen))
    && Array.from({length:8},(_,id)=>id).every(id => messages.some(m => m.type === 'led' && m.id === id)))
  for (const screen of ['center','left','right','knob']) assert(messages.some(m => m.type === 'draw-screen' && m.screen === screen), 'missing screen '+screen)
  for (let id=0;id<8;id++) assert(messages.some(m => m.type === 'led' && m.id === id), 'missing LED '+id)
  send({ type: 'emit', ev: 'rotate', data: { id: 'knobTL', delta: 1 } })
  await until(() => messages.some(m => m.type === 'status' && m.connected && m.dialFeedback.TL.norm === .625))
  await until(() => messages.some(m => m.type === 'draw-text' && m.text === '0.625 x'))
  send({type:'switch',id:'main',profileOnly:true});await until(()=>messages.filter(m=>m.type==='status').at(-1)?.profile==='main');
  send({type:'emit',ev:'touchstart',data:{changedTouches:[{target:{screen:'center',key:4}}]}});
  await until(()=>messages.some(m=>m.type==='status'&&m.home?.mode==='profiles'&&m.home.total===1));
  const latest=()=>messages.filter(m=>m.type==='status').at(-1);
  const oldRevision=latest().home.revision;
  send({type:'emit',ev:'rotate',data:{id:'knobCT',delta:1}});await until(()=>latest().home?.revision>oldRevision);
  send({type:'emit',ev:'touchstart',data:{changedTouches:[{target:{screen:'knob'}}]}});await until(()=>latest().home?.selected===true);
  assert.equal(latest().profile,'main','wheel browse/press must not activate');
  const pickedRevision=latest().home.revision;
  send({type:'home-input',revision:oldRevision,kind:'key',slot:10});await pause(40);assert.equal(latest().profile,'main','stale confirmation ignored');
  send({type:'home-input',revision:pickedRevision,kind:'key',slot:10});await until(()=>latest().profile==='rig');
  send('stop'); await until(() => closed); assert.equal(exitCode, 0, output)
  const close = messages.findIndex(m => m.type === 'device-closed'), release = messages.findIndex(m => m.type === 'released')
  assert(close >= 0 && release > close, 'device closes before claim release')
  }
  assert(!output.includes('ReferenceError') && !output.includes('draw failed'), output)
  console.log(scenario + ': disconnected status, panel actions, late connect, full draw/readout, rotary update and normal stop PASS')
 } catch (error) { failure = error }
 finally {
  if (!closed) { send('stop'); send('allow-device'); try { await until(() => closed) } catch (error) { failure ||= error } }
  fs.writeFileSync(path.join(scratch.artifacts, 'startup-'+scenario+'.log'), output)
  write(scratch.artifacts, 'startup-'+scenario+'.json', { scenario, host, exitCode, closed, passed: !failure, error: failure?.message, messages })
 }
 results.push({ scenario, passed: !failure, exitCode })
 if (failure) throw failure
}
} finally {
 write(scratch.artifacts, 'STARTUP-RESULTS.json', { host, results })
 // Managed wrapper owns cleanup after full process-tree exit; never delete a live test's files.
}

