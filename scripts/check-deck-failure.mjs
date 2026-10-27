// Real deck-host -> queue -> adapter, with fake device/TD modules and an in-memory WebSocket.
// Scratch config only. Never imports connect-ct, opens hardware, or sends Windows input.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fork } from 'node:child_process'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waxyct-dry-host-'))
let preserveTmp = false
const bridge = path.join(tmp, 'bridge'), config = path.join(tmp, 'config')
fs.mkdirSync(bridge); fs.mkdirSync(path.join(config, 'profiles'), { recursive: true })
const write = (dir, file, value) => fs.writeFileSync(path.join(dir, file), typeof value === 'string' ? value : JSON.stringify(value))
write(config, 'settings.json', { startProfile: 'moshpit', holdMs: 500, escapeHoldMs: 1000, knobStep: 0.02 })
write(config, 'apps.json', { moshpit: { name: 'Moshpit', color: 'coral', target: 'moshpit', endpoint: 'ws://127.0.0.1:6193/control' } })
write(path.join(config, 'profiles'), 'main.json', { name: 'MAIN', color: 'bone', pages: [{ name: 'MAIN', keys: {} }] })
write(path.join(config, 'profiles'), 'moshpit.json', { name: 'MOSHPIT', color: 'coral', app: 'moshpit', pages: [{ name: 'HOME', keys: {}, wheel: { turn: { moshpit: { verb: 'step', commands: ['transport.prevFrame', 'transport.nextFrame'] } } } }] })
write(bridge, 'config.json', { td: {} })
write(bridge, 'ct-claim.mjs', 'export const REFRESH_MS = 1000; export const claim = () => null; export const update = () => {}; export const release = () => {};')
write(bridge, 'ct-draw.mjs', `
import {dialLabelLines} from ${JSON.stringify(new URL('../ui/control-key-layout.mjs',import.meta.url).href)};
const expected=dialLabelLines('DIAL IN').map(t=>JSON.stringify(t.lines)), seen=new Set();
export const setGlyphs=()=>{};export const surface=()=>({});export const renderKeys=()=>({});export const toRgb565=()=>Buffer.alloc(2);export const text=()=>{};
export const stroke=(_surface,lines)=>{const encoded=JSON.stringify(lines);if(expected.includes(encoded)){seen.add(encoded);if(seen.size===expected.length)process.send?.({type:'test-strip-label',text:'DIAL IN'});}};
`)

write(bridge, 'ct-td-map.mjs', "export const buildScript = () => ''; export const RIG_STATE_PY = ''; ")
write(bridge, 'td-client.mjs', 'export const makeTdClient = () => ({ handshake: async () => ({ok: false}), exec: async () => ({success: false}) });')
write(bridge, 'connect-ct.mjs', `
import { EventEmitter } from 'node:events';
export const findCT = async () => ({path: 'fake-ct'});
export const connectCT = async () => Object.assign(new EventEmitter(), {
  path: 'fake-ct', connection: { isReady: () => true }, send: async () => {},
  setBrightness: async () => {}, drawBuffer: async () => {}, setButtonColor: async () => {},
  vibrate: async () => { process.send?.({type: 'test-buzz'}); }, close: async () => {},
});
`)
write(tmp, 'boot.mjs', `
const pending = [];
let activeSocket;
const workspaceMode = process.env.WAXYCT_TEST_WORKSPACE === '1';
class OfflineSocket {
  constructor() { activeSocket = this; this.readyState = 1; queueMicrotask(() => this.onopen?.()); }
  send(raw) {
    const m = JSON.parse(raw);
    let reply = {type: 'ack', id: m.id};
    if (m.type === 'hello') reply = {...reply, version: 1, caps: workspaceMode ? ['workspace'] : [], ...(workspaceMode ? {workspace:'browse'} : {})};
    if (m.type === 'discover') reply = {...reply, generation: 1, targets: [], slots: [], ...(workspaceMode ? {workspace:'browse'} : {})};
    if (m.type === 'command') {
      process.send?.({type: 'test-wire', command: m.command, repeat: m.repeat});
      if (workspaceMode) { queueMicrotask(() => this.onmessage?.({data:JSON.stringify(reply)})); return; }
      pending.push(fail => this.onmessage?.({data: JSON.stringify(fail ? {type:'error', id:m.id, code:'CONTROL_FAILED', error:{code:'CONTROL_FAILED', message:'simulated refusal'}} : reply)}));
    } else queueMicrotask(() => this.onmessage?.({data: JSON.stringify(reply)}));
  }
  close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
}
globalThis.WebSocket = OfflineSocket;
process.on('message', m => {
  if (m?.type === 'test-ack') pending.shift()?.(m.fail);
  if (m?.type === 'test-forget-timeout') pending.shift();
  if (m?.type === 'test-workspace') activeSocket?.onmessage?.({data:JSON.stringify({type:'workspace', workspace:m.workspace})});
});
await import(${JSON.stringify(new URL('../host/deck-host.mjs', import.meta.url).href)});
`)

async function scenario(timeout, individual, workspaceMode = false) {
  if (workspaceMode) {
    const page = (name, workspace) => ({name, keys: {}, ...(workspace ? {enter:{moshpit:{verb:'command',command:'workspace.'+workspace}}} : {}), ...(workspace === 'browse' ? {dials:{TL:{name:'DIAL IN',turn:{moshpit:{verb:'step',commands:['mark.in.nudgeBack','mark.in.nudgeForward']}},press:{moshpit:{verb:'command',command:'mark.in'}}}}} : {})})
    write(path.join(config, 'profiles'), 'moshpit.json', {name:'MOSHPIT', color:'coral', app:'moshpit', followWorkspace:true, stripGestures:false, pages:[page('HOME'),page('IN','browse'),page('MOSH','mosh'),page('OUT','render'),page('MY FX','mosh')]})
  }
  const child = fork(path.join(tmp, 'boot.mjs'), ['--dry-input'], { execArgv: [], env: { ...process.env, WAXYCT_CONFIG: config, WAXYCT_BRIDGE: bridge, WAXYCT_TEST_WORKSPACE:workspaceMode ? '1' : '0' }, silent: true, windowsHide: true })
  const messages = [], wire = []
  let output = '', exited = false
  child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  child.on('exit', () => { exited = true })
  child.on('message', m => { messages.push(m); if (m.type === 'test-wire') wire.push(m) })
  const until = async (fn, ms = 6000) => {
    const end = Date.now() + ms
    while (!fn()) {
      if (exited || Date.now() > end) throw new Error(`dry host stopped or timed out:\n${output}`)
      await new Promise(r => setTimeout(r, 15))
    }
  }
  const emit = delta => child.send({ type: 'emit', ev: 'rotate', data: { id: 'knobCT', delta } })
  try {
    await until(() => output.includes('LIVE:') && messages.some(m => m.type === 'status' && m.connected && m.moshpit?.moshpit?.phase === 'connected'))
    if (workspaceMode) {
      const current = () => messages.filter(m => m.type === 'status').at(-1)
      const navigate = async (workspace, page) => { child.send({type:'test-workspace', workspace}); await until(() => current()?.moshpit?.moshpit?.workspace === workspace && current()?.page === page) }
      assert.equal(current().page, 1, 'connecting follows the actual IN workspace')
      await until(() => messages.some(m => m.type === 'test-strip-label'))
      for (const side of ['left','right']) {
        const touch = (ev, y) => child.send({type:'emit',ev,data:{changedTouches:[{target:{screen:side},y}]}})
        touch('touchstart',45); touch('touchend',45)
        touch('touchstart',45); touch('touchmove',10); touch('touchend',10)
      }
      await until(() => messages.filter(m => m.type === 'input' && m.ev === 'touch').length === 4)
      await new Promise(r => setTimeout(r,50))
      assert.equal(wire.length,0,'side strip tap/swipe are display-only, never dial actions')
      child.send({type:'emit',ev:'down',data:{id:'knobTL'}})
      await until(() => wire.length === 1)
      assert.equal(wire[0].command,'mark.in','physical knob press remains active')
      child.send({type:'emit',ev:'rotate',data:{id:'knobTL',delta:2}})
      await until(() => wire.length === 2)
      assert.deepEqual([wire[1].command,wire[1].repeat],['mark.in.nudgeForward',2],'physical knob rotation remains active')
      await navigate('render', 3)
      await navigate('settings', 3)
      assert.equal(wire.length, 2, 'app changes and unsupported Settings never echo an enter command')
      child.send({type:'page',page:5})
      await until(() => current()?.page === 4 && wire.length === 3)
      assert.equal(wire[2].command, 'workspace.mosh', 'manual CT page selection still enters the workspace')
      await navigate('browse', 1)
      await navigate('mosh', 4)
      assert.equal(wire.length, 3, 'return restores custom MOSH subpage without another enter')
      child.send({type:'switch',id:'main'}); await until(() => current()?.profile === 'main')
      const buzzes = messages.filter(m => m.type === 'test-buzz').length
      child.send({type:'emit',ev:'down',data:{id:1}})
      await until(() => messages.filter(m => m.type === 'test-buzz').length > buzzes)
      assert.equal(current().profile, 'main'); assert.equal(current().page, 0, 'round 2 on global Home cannot open a second hidden page')
      assert.equal(current().controlContext.target, 'system', 'Home status ignores TD availability')
      child.send({type:'test-workspace',workspace:'render'})
      await until(() => current()?.moshpit?.moshpit?.workspace === 'render')
      assert.equal(current().profile, 'main', 'background Moshpit feedback never steals CT ownership')
      console.log('ok dry host workspace: connect/app navigation, no echo, Settings, custom subpage memory, inactive profile')
      return
    }
    if (individual) for (let i = 0; i < 26; i++) emit(1)
    else emit(26)
    await until(() => wire.length === 1)
    await until(() => messages.filter(m => m.type === 'input' && m.ev === 'rotate').length === (individual ? 26 : 1))
    assert.equal(wire[0].repeat, individual ? 1 : 10)
    if (!timeout) child.send({ type: 'test-ack', fail: true })
    await until(() => messages.some(m => m.type === 'test-buzz') && messages.some(m => m.type === 'status' && /Moshpit:.*(refusal|did not answer)/.test(m.note?.text || '')))
    // Give the pump a turn after the failure; a swallowed error sends another batch immediately.
    await new Promise(r => setTimeout(r, 100))
    assert.equal(wire.length, 1, `${timeout ? 'timeout' : 'refusal'} must stop the ${individual ? 25 : 16} unsent detents`)
    assert.equal(messages.filter(m => m.type === 'test-buzz').length, 1, 'one vibration for the failure')
    if (timeout) child.send({ type: 'test-forget-timeout' })
    emit(-2)
    await until(() => wire.length === 2)
    assert.deepEqual([wire[1].command, wire[1].repeat], ['transport.prevFrame', 2], 'fresh input after failure still works')
    child.send({ type: 'test-ack' })
    console.log(`ok dry host ${timeout ? 'timeout' : 'refusal'} (${individual ? '26 individual detents' : 'one 26-detent event'}): flash + buzz, discarded burst tail, fresh input accepted`)
  } finally {
    if (!exited && child.connected) child.send('stop')
    const stopBy = Date.now() + 3000
    while (!exited && Date.now() < stopBy) await new Promise(r => setTimeout(r, 25))
    if (!exited) {
      preserveTmp = true
      // Leave a stuck test process intact for diagnosis. Detach its parent-side
      // handles so reporting the failure does not itself hang the test runner.
      if (child.connected) child.disconnect()
      child.unref()
      child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy()
      fs.writeFileSync(path.join(tmp, 'shutdown-failure.log'), `PID ${child.pid}\n${output}`)
      throw new Error(`dry host PID ${child.pid} did not stop gracefully; process left running and evidence preserved at ${tmp}`)
    }
  }
}
try {
  await scenario(false, false)
  await scenario(true, false)
  await scenario(false, true)
  await scenario(true, true)
  await scenario(false, false, true)
  console.log('deck host: 5 integration checks passed (4 failures + workspace sync; fake CT/TD, no sockets or Windows input)')
} finally { if (!preserveTmp) fs.rmSync(tmp, { recursive: true, force: true }) }
