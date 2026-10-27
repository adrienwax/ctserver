// Authenticated local app adapters. No generic remote property access or code execution.
import fs from 'node:fs'
import path from 'node:path'

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value)
export function checkNativeAction(a, turn = false) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false
  if (Object.keys(a).some(k => !['verb','command','parameter','slot'].includes(k))) return false
  if (a.verb === 'command') return !turn && id(a.command) && a.parameter === undefined && a.slot === undefined
  if (!['turn','reset','toggle'].includes(a.verb) || (a.verb === 'turn') !== !!turn || a.command !== undefined) return false
  return (id(a.parameter) && a.slot === undefined) || (Number.isInteger(a.slot) && a.slot >= 1 && a.slot <= 6 && a.parameter === undefined)
}
export function checkNativeState(s, endpoint) {
  if (!s || s.appId !== endpoint.appId || s.sessionId !== endpoint.sessionId || !id(s.contextId) || typeof s.workspace !== 'string') throw Error('Adapter identity or context mismatch')
  if (!Array.isArray(s.parameters) || s.parameters.length > 64 || !Array.isArray(s.actions) || s.actions.length > 128 || !s.actions.every(id)) throw Error('Invalid adapter controls')
  const seen = new Set()
  for (const p of s.parameters) {
    if (!id(p.id) || seen.has(p.id) || typeof p.label !== 'string' || p.label.length > 24 || !['float','int','bool'].includes(p.type)) throw Error('Invalid adapter parameter')
    seen.add(p.id)
    if (p.available === false) continue
    if (p.type === 'bool') { if (typeof p.value !== 'boolean') throw Error('Invalid toggle value'); continue }
    if (![p.value,p.min,p.max,p.step].every(Number.isFinite) || p.min >= p.max || p.step <= 0 || p.value < p.min || p.value > p.max) throw Error('Invalid parameter range')
    if (p.type === 'int' && !Number.isInteger(p.value)) throw Error('Invalid integer value')
    if (p.default !== undefined && (!Number.isFinite(p.default) || p.default < p.min || p.default > p.max)) throw Error('Invalid parameter default')
  }
  return s
}
export const nativeEndpointPath = value => typeof value==='string'?value.replace(/%(LOCALAPPDATA|APPDATA)%/g,(_,key)=>process.env[key]||'%'+key+'%'):''
export function createNativeClient({transport=null, appId, endpointFile, now = Date.now, request = fetch, read = file => fs.readFileSync(file,'utf8')}) {
  let endpoint = null, snapshot = null, checked = 0, detail = 'Start the app adapter', busy = false, epoch = 0, stopped = false
  const fresh = () => !stopped && snapshot && now() - checked < 2500
  function readEndpoint() {
    if(transport)return transport.endpoint()
    endpointFile=nativeEndpointPath(endpointFile)
    if (!path.isAbsolute(endpointFile || '')) throw Error('Adapter endpoint path must be absolute')
    const raw = read(endpointFile)
    if (raw.length > 8192) throw Error('Adapter endpoint too large')
    const e = JSON.parse(raw)
    if (e.appId !== appId || !Number.isInteger(e.port) || e.port < 1024 || e.port > 65535 || !Number.isInteger(e.pid) || e.pid <= 0 || !id(e.sessionId) || typeof e.token !== 'string' || !/^[a-zA-Z0-9_-]{32,256}$/.test(e.token)) throw Error('Invalid adapter endpoint')
    return e
  }
  async function wire(e, route, body) {
    if(transport){
      let timer
      try{return await Promise.race([transport.exchange(route,body),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('App adapter timed out; no retry')),1500)})])}
      finally{clearTimeout(timer)}
    }
    const r = await request(`http://127.0.0.1:${e.port}/${route}`, {method:body?'POST':'GET',headers:{Authorization:`Bearer ${e.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(1500),redirect:'error'})
    if (!r.ok) throw Error(`Adapter refused request (${r.status})`)
    const reader = r.body.getReader(); let length=0,parts=[]
    try { for (;;) {const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536)throw Error('Adapter reply too large');parts.push(Buffer.from(value))} }
    finally { await reader.cancel().catch(()=>{}) }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  }
  async function refresh() {
    if (busy || stopped) return
    busy=true; const token=epoch
    try {const e=readEndpoint(), s=checkNativeState(await wire(e,'state'),e);if(token!==epoch||stopped)return;endpoint=e;snapshot=s;checked=now();detail='Live app feedback'}
    catch(e){if(token===epoch){snapshot=null;endpoint=null;detail=e.code==='ENOENT'?'Start the app adapter':e.message}}
    finally {busy=false}
  }
  function parameter(action) {return fresh() ? (action.slot ? snapshot.parameters[action.slot-1] : snapshot.parameters.find(p=>p.id===action.parameter)) : null}
  function capture(action) {
    if (!fresh()) return null
    const p=parameter(action)
    if(action.verb==='command' ? !snapshot.actions.includes(action.command) : !p || p.available===false) return null
    return {verb:action.verb,...(action.verb==='command'?{command:action.command}:{parameter:p.id}),sessionId:snapshot.sessionId,contextId:snapshot.contextId}
  }
  async function act(captured, detents, mode, current=()=>true) {
    if(!captured||!fresh()||captured.sessionId!==snapshot.sessionId||captured.contextId!==snapshot.contextId||!current())throw Error('App context changed; use the control again')
    if(!['normal','fine','coarse'].includes(mode)||!Number.isSafeInteger(detents)||Math.abs(detents)>320)throw Error('Invalid native control movement')
    const e=readEndpoint()
    if(e.sessionId!==endpoint.sessionId||e.token!==endpoint.token||e.port!==endpoint.port||e.pid!==endpoint.pid)throw Error('App adapter restarted; use the control again')
    const body={...captured,mode,...(captured.verb==='turn'?{detents}:{})}
    // A timed-out write is never retried: its outcome may already have occurred.
    const result=await wire(e,'action',body)
    if(!result?.ok)throw Error(result?.error||'App did not accept the control')
    await refresh()
    return result
  }
  return {refresh,capture,act,parameter,connected:()=>!!fresh(),state:()=>({phase:fresh()?'ready':'unavailable',detail,...(fresh()?snapshot:{}),checkedAt:checked}),stop(){stopped=true;epoch++;snapshot=null;endpoint=null}}
}
