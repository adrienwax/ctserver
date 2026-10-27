// Project opening is separate from profile activation. Imported profiles can only
// reference an ID; executable paths and file pins belong to this local registry.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { checkProfile } from './profiles.mjs'
import { activeProfileFiles, readParkingRegistry } from './parking.mjs'
const exec = promisify(execFile)
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/
const SHA = /^[a-f0-9]{64}$/i
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const fail = (status, reason) => ({status, reason, canOpen:false})
const full = file => typeof file === 'string' && !file.includes('\0') && path.isAbsolute(file)
const base = file => path.basename(file).toLowerCase()

export async function windowsProcesses() {
  if (process.platform !== 'win32') throw new Error('Project opening is supported on Windows only')
  const {stdout} = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
    "@(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object Name,ExecutablePath,ProcessId) | ConvertTo-Json -Compress"],
    {windowsHide:true, timeout:10000, maxBuffer:4*1024*1024})
  const rows = JSON.parse(stdout)
  if (!Array.isArray(rows)) throw new Error('Could not verify running applications')
  return rows
}
export function dispatchProject(executable, project) {
  return new Promise((resolve, reject) => {
    const env = {...process.env}
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key]
    const child = spawn(executable, [project], {shell:false, detached:true, stdio:'ignore', env})
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve({pid:child.pid}) })
  })
}

export function createProjectLibrary({configDir, registryFile=path.join(configDir,'projects.json'),
  processes=windowsProcesses, launch=dispatchProject, now=Date.now}={}) {
  let opening = false, lastDispatch = -Infinity
  function inventory() {
    let apps = {}; try { apps=read(path.join(configDir,'apps.json')) } catch {}
    const parked = readParkingRegistry(configDir)
    for (const id of parked.apps) delete apps[id]
    const profiles = new Map()
    for (const filename of activeProfileFiles(configDir)) {
      try {const profile=read(path.join(configDir,'profiles',filename)); profiles.set(filename.slice(0,-5), profile)} catch {}
    }
    let entries=[], registryError=''
    if (fs.existsSync(registryFile)) {
      try {
        const registry=read(registryFile)
        if (registry.schemaVersion!==1 || !Array.isArray(registry.projects)) throw new Error('Unsupported project library format')
        entries=registry.projects
      } catch { registryError='Project library needs repair' }
    }
    return {apps, profiles, entries, registryError}
  }
  function inspect(entry, profileId, profile, apps, hashes=new Map()) {
    const appId=typeof profile.app==='string' ? profile.app : ''
    const result={profileId, projectId:typeof entry?.id==='string'?entry.id:(profile.metadata?.projectId || null),
      title:entry?.title || profile.metadata?.title || profile.name || profileId, appId, author:entry?.author || profile.metadata?.author || '',
      version:entry?.version || profile.metadata?.version || ''}
    const end=(status,reason)=>({...result,...fail(status,reason)})
    if (checkProfile(profile, activeProfileFiles(configDir).map(f=>f.slice(0,-5)), apps).length) return end('unsupported','Profile needs repair before opening its project')
    if (!entry) return end('unconfigured','No project linked')
    if (!ID.test(entry.id) || entry.profileId!==profileId || entry.appId!==appId) return end('unsupported','Project identity does not match this profile')
    // v1 supports only an explicitly pinned TD .toe opened by TouchDesigner.exe.
    // No imported args, commands, URLs, shell scripts, environment or launcher chains.
    const allowed=['id','profileId','appId','title','author','version','approved','file','runtime']
    if (Object.keys(entry).some(k=>!allowed.includes(k))) return end('unsupported','Unsupported project launch fields')
    if (apps[appId]?.target!=='td' || !full(entry.file?.path) || path.extname(entry.file.path).toLowerCase()!=='.toe'
      || !full(entry.runtime?.path) || base(entry.runtime.path)!=='touchdesigner.exe') return end('unsupported','This project has no supported direct opener')
    if (entry.approved!==true) return end('unconfigured','Project opening has not been approved locally')
    for (const [label,pin] of [['Project',entry.file],['Application',entry.runtime]]) {
      if (!SHA.test(pin.sha256) || Object.keys(pin).some(k=>!['path','sha256'].includes(k))) return end('unsupported',`${label} identity is incomplete`)
      try {
        if (!fs.statSync(pin.path).isFile()) return end('missing',`${label} file is missing`)
        if (!hashes.has(pin.path)) hashes.set(pin.path,hash(pin.path))
        if (hashes.get(pin.path)!==pin.sha256.toLowerCase()) return end('changed',`${label} has changed; review its identity before opening`)
      } catch { return end('missing',`${label} file is unavailable`) }
    }
    return {...result,status:'ready',reason:'Ready to open',canOpen:true}
  }
  function list() {
    const {apps,profiles,entries,registryError}=inventory(), projects=[], hashes=new Map()
    for (const [id,profile] of profiles) {
      const rows=entries.filter(e=>e?.profileId===id)
      if (!rows.length) projects.push({...inspect(null,id,profile,apps),...(registryError?fail('unsupported',registryError):{})})
      for (const row of rows) {
        const duplicate=entries.filter(e=>e?.id===row.id).length!==1
        const value=inspect(row,id,profile,apps,hashes)
        projects.push(duplicate?{...value,...fail('unsupported','Duplicate project identity')}:value)
      }
    }
    return {projects}
  }
  async function open({profileId,projectId}={}, current=()=>true) {
    if (!current()) return {ok:false,error:'Project selection changed'}
    if (opening || now()-lastDispatch<10000) return {ok:false,error:'A project is already opening; wait before trying again'}
    if (!ID.test(profileId||'') || !ID.test(projectId||'')) return {ok:false,error:'Choose a valid profile and project'}
    opening=true
    try {
      const {apps,profiles,entries}=inventory(), profile=profiles.get(profileId)
      const matches=entries.filter(e=>e?.id===projectId)
      if (!profile || matches.length!==1) throw new Error('Project or profile is unavailable')
      const entry=matches[0], checked=inspect(entry,profileId,profile,apps)
      if (!checked.canOpen) throw new Error(checked.reason)
      const running=await processes()
      if(!current())throw new Error('Project selection changed')
      if (!Array.isArray(running)) throw new Error('Could not verify running applications')
      if (running.some(p=>String(p.Name||p.name||'').toLowerCase()==='touchdesigner.exe'
        || (p.ExecutablePath && path.resolve(p.ExecutablePath).toLowerCase()===path.resolve(entry.runtime.path).toLowerCase()))) {
        throw new Error('TouchDesigner is already open. Save and close its project before opening another here.')
      }
      // Disk/config may change while process inspection is outstanding: re-read all identity.
      const fresh=inventory(), next=fresh.entries.filter(e=>e?.id===projectId)
      if (next.length!==1 || JSON.stringify(next[0])!==JSON.stringify(entry) || !fresh.profiles.has(profileId)) throw new Error('Project registration changed; choose it again')
      const verified=inspect(next[0],profileId,fresh.profiles.get(profileId),fresh.apps)
      if (!verified.canOpen) throw new Error(verified.reason)
      if(!current())throw new Error('Project selection changed')
      const child=await launch(entry.runtime.path,entry.file.path)
      lastDispatch=now()
      return {ok:true,status:'dispatched',pid:child.pid,projectId,profileId}
    } catch(error) { return {ok:false,error:error.message} }
    finally {opening=false}
  }
  return {list,open}
}