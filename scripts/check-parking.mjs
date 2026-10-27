import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { planParking, parkConfig, restoreParked, readParkingRegistry, activeProfileFiles } from '../host/parking.mjs'
import { loadConfig, saveProfile } from '../host/profiles.mjs'
import { upgradeConfig } from '../host/config-upgrade.mjs'
import { controlContext } from '../host/control-context.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'waxyct-parking-'))
const dir = path.join(root, 'owner'), shipped = path.join(root, 'shipped')
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2)) }
const read = f => fs.readFileSync(f, 'utf8')
let checks = 0
const check = (name, fn) => { fn(); checks++; }
try {
  const apps = { moshpit: { name:'Moshpit', target:'moshpit', endpointFile:'control-endpoint.json' }, blender: { name:'My Blender', target:'keys', exe:'owner-blender.exe', customOwner:'keep me' } }
  write(path.join(dir, 'apps.json'), apps)
  const home = { name:'Home', pages:[{name:'Home',keys:{0:{label:'BLENDER',do:{app:'blender'}},1:{label:'FILES',do:{launch:'explorer.exe'}}}}] }
  const blender = '{ "name": "OWNER ART", "app": "blender", "pages": [{"name":"Sculpt","keys":{}}] }\n'
  write(path.join(dir,'profiles/main.json'), home)
  write(path.join(dir,'profiles/blender-personal.json'), blender)
  write(path.join(dir,'.lastgood/blender-personal.json'), blender)
  write(path.join(dir,'rigs/blender-personal.json'), {app:'blender', target:'keys', custom:'owner'})
  write(path.join(dir,'.history/blender-personal-old.json'), 'owner-history')
  write(path.join(dir,'icons/custom.json'), 'owner-art')
  const homeBefore = read(path.join(dir,'profiles/main.json')), appsBefore = read(path.join(dir,'apps.json'))
  const options = {apps:['blender'],operation:'fixture'}
  check('preview does not write', () => { assert.equal(planParking(dir, options).profiles[0], 'blender-personal'); assert.equal(fs.existsSync(path.join(dir,'parked')), false) })
  const manifest = parkConfig(dir, options)
  check('exact owner bytes and metadata archived', () => { assert.equal(read(path.join(dir,'parked/fixture/files/profiles/blender-personal.json')),blender); assert.equal(read(path.join(dir,'parked/fixture/files/apps.json')),appsBefore); assert.equal(manifest.entries.blender.customOwner,'keep me') })
  check('history/art retained', () => { assert.equal(read(path.join(dir,'icons/custom.json')),'owner-art'); assert.equal(read(path.join(dir,'.history/blender-personal-old.json')),'owner-history') })
  check('cross-reference repaired', () => { const c=loadConfig(dir); assert.equal(c.errors.length,0); assert.equal(c.profiles.main.pages[0].keys[0],undefined); assert.ok(c.profiles.main.pages[0].keys[1]) })
  // Put both live and fallback copies back, as an old installer/recovery could do.
  write(path.join(dir,'profiles/blender-personal.json'),blender)
  write(path.join(dir,'.lastgood/blender-personal.json'),blender)
  write(path.join(dir,'profiles/another-blender.json'),{name:'Another',app:'blender',pages:[{name:'Page'}]})
  check('registry blocks live + lastgood + app alias', () => { const c=loadConfig(dir); assert.ok(!c.profiles['blender-personal']); assert.ok(!c.profiles['another-blender']); assert.ok(!c.apps.blender); assert.ok(!activeProfileFiles(dir).some(f=>f.includes('blender'))) })
  check('API save cannot resurrect', () => assert.equal(saveProfile(dir,'blender-personal',blender).ok,false))
  fs.rmSync(path.join(dir,'profiles/another-blender.json'))
  write(path.join(shipped,'apps.json'),apps); write(path.join(shipped,'profiles/blender-personal.json'),blender); write(path.join(shipped,'rigs/blender-personal.json'),{app:'blender'})
  fs.rmSync(path.join(dir,'profiles/blender-personal.json')); fs.rmSync(path.join(dir,'.lastgood/blender-personal.json'))
  check('older upgrade does not reseed parked', () => { const r=upgradeConfig({shipped,user:dir}); assert.equal(r.files.find(f=>f.file==='profiles/blender-personal.json').status,'parked'); assert.equal(fs.existsSync(path.join(dir,'profiles/blender-personal.json')),false); assert.equal(JSON.parse(read(path.join(dir,'apps.json'))).blender,undefined) })
  const mainParked = read(path.join(dir,'profiles/main.json'))
  write(path.join(dir,'profiles/main.json'),{name:'New owner main',pages:[{name:'Home'}]})
  check('restore conflict preflight writes nothing', () => { assert.throws(()=>restoreParked(dir,'fixture'),/Restore conflict/); assert.equal(fs.existsSync(path.join(dir,'profiles/blender-personal.json')),false); assert.ok(readParkingRegistry(dir).apps.includes('blender')) })
  write(path.join(dir,'profiles/main.json'),mainParked)
  write(path.join(dir,'icons/custom.json'),'new owner art')
  check('restore exact profiles and preserve newer shared art', () => { restoreParked(dir,'fixture'); assert.equal(read(path.join(dir,'profiles/blender-personal.json')),blender); assert.equal(read(path.join(dir,'profiles/main.json')),homeBefore); assert.equal(read(path.join(dir,'icons/custom.json')),'new owner art'); assert.equal(readParkingRegistry(dir).apps.length,0); assert.equal(loadConfig(dir).errors.length,0) })
  check('path traversal refused', () => assert.throws(()=>restoreParked(dir,'../../outside'),/Invalid/))
  check('Home does not report TD offline', () => assert.equal(controlContext({profile:{name:'Home'},profileId:'main',tdOk:false}).target,'system'))
  const p={name:'TD',appId:'touchdesigner',app:{target:'td'},pages:[{dials:{TL:{turn:{td:{type:'rigKnob',par:'Master'}}}}}]}, base={profile:p,profileId:'template',tdOk:true,tdProfileId:'template',tdCheckedAt:1000,now:1100}
  check('HTTP is not rig readiness', () => assert.equal(controlContext(base).phase,'missing-rig'))
  const tdState={clip:1,on:{},norm:{Master:.5},parameters:['Master']}
  check('fresh compatible rig is ready', () => assert.equal(controlContext({...base,tdState}).phase,'ready'))
  check('stale/wrong-profile/missing parameter not ready', () => { assert.equal(controlContext({...base,tdState,now:7000}).phase,'unknown'); assert.equal(controlContext({...base,tdState,tdProfileId:'mega'}).phase,'unknown'); assert.equal(controlContext({...base,tdState:{...tdState,parameters:[]}}).phase,'missing-rig') })
  check('old shipped archive protects newer Moshpit mapping, and restores its own baseline in isolation', () => {
    const copy = path.join(root, 'shipping-copy'); fs.cpSync(new URL('../config/', import.meta.url), copy, {recursive:true})
    const current = read(path.join(copy, 'profiles/moshpit.json'))
    assert.throws(() => restoreParked(copy,'shipped-unification-c4'), /Restore conflict/)
    assert.equal(read(path.join(copy, 'profiles/moshpit.json')), current)
    // New app defaults intentionally conflict with this historic restore. Reconstruct
    // only the disposable app-registry fixture before checking the Moshpit conflict.
    const manifest=JSON.parse(read(path.join(copy,'parked/shipped-unification-c4/manifest.json')))
    const currentApps=JSON.parse(read(path.join(copy,'apps.json')))
    for(const id of manifest.apps)delete currentApps[id]
    write(path.join(copy,'apps.json'),currentApps)
    for(const item of manifest.files){
      if(!item.path.startsWith('profiles/')||item.path==='profiles/moshpit.json')continue
      const archived=path.join(copy,'parked/shipped-unification-c4/files',item.path)
      if(fs.existsSync(archived))fs.copyFileSync(archived,path.join(copy,item.path))
    }
    assert.throws(() => restoreParked(copy,'shipped-unification-c4'), /Restore conflict: profiles\/moshpit.json has changed/)
    assert.equal(read(path.join(copy, 'profiles/moshpit.json')), current, 'old archive cannot overwrite the new mapping')
    // Reconstruct the archived pre-parking fixture only in this disposable copy.
    fs.copyFileSync(path.join(copy,'parked/shipped-unification-c4/files/profiles/moshpit.json'),path.join(copy,'profiles/moshpit.json'))
    // Restore only after every archived profile in this throwaway fixture is reset
    // to its own baseline; real owner files are never part of this test.
    for(const item of manifest.files){
      if(!item.path.startsWith('profiles/'))continue
      const archived=path.join(copy,'parked/shipped-unification-c4/files',item.path)
      if(fs.existsSync(archived))fs.copyFileSync(archived,path.join(copy,item.path))
    }
    restoreParked(copy,'shipped-unification-c4'); assert.equal(loadConfig(copy).errors.length,0)
  })
  check('maintenance preview preserves current bespoke profiles', () => {
    const tool=fileURLToPath(new URL('./park-config.mjs', import.meta.url))
    const config=fileURLToPath(new URL('../config', import.meta.url))
    const current=path.join(root,'current-unparked')
    fs.mkdirSync(current)
    fs.copyFileSync(path.join(config,'apps.json'),path.join(current,'apps.json'))
    fs.cpSync(path.join(config,'profiles'),path.join(current,'profiles'),{recursive:true})
    const preview=JSON.parse(execFileSync(process.execPath,[tool,current],{encoding:'utf8',windowsHide:true}))
    assert.equal(preview.preview,true)
    for(const id of ['windows','spotify','resolve','moshpit','touchdesigner']) assert.ok(!preview.apps.includes(id),`current app ${id} must stay active`)
    for(const id of ['windows','spotify','resolve']) assert.ok(!preview.files.some(f=>f.path===`profiles/${id}.json`),`current profile ${id} must stay active`)
  })
  console.log(`parking/context ok: ${checks} offline lifecycle and readiness checks`)
} finally { fs.rmSync(root,{recursive:true,force:true}) }
