// The Moshpit v3 adapter, Route B: waxyct owns the CT; Moshpit serves a localhost WebSocket and waxyct is its
// client, as waxyct is TouchDesigner's. One client per Moshpit app (config/apps.json "endpoint").
//
// The wire is moshpit-v3/CONTROL-PROTOCOL.md, protocol "moshpit-control" v1 (authoritative since 7 Oct; waxyct's
// docs/MOSHPIT-WIRE.md proposed it). Moshpit announces itself in an endpoint file, <Moshpit userData>/control-
// endpoint.json = { v, port, path, token, protocol }: the port can change if 6193 is taken, and the token is
// required in hello. Both are re-read before every connection attempt.
//
// What it lifts from what already worked:
//   Moshpit 2.0 waxyct-bridge  reconnect backoff 500 / 1500 / 3000 ms, a liveness lease, stale-generation
//                              rejection, fine / coarse modes, raw encoder detents (Moshpit applies the step)
//   EDENA src/ct/bridge.ts     state pushed on change, so lit keys and dial bars follow without polling
//
//   const m = createMoshpitClient({ endpointFile, log })        (or { endpoint, token } for a fixed server)
//   m.start(); await m.act({ verb: 'knob', slot: 1, param: 1 }, 3); m.norm(...); m.on(...); m.stop()
import fs from 'node:fs'
import { WORKSPACES } from './workspace-pages.mjs'
export { bankLabel } from './schema.mjs'

export const PROTOCOL = 'moshpit-control'
export const VERSION = 1
const BACKOFF = [500, 1500, 3000]
const REQUEST_MS = 3000
const LEASE_MS = 8000            // no message from Moshpit in this long: the link is dead, reconnect
const PING_MS = 3000
export const MAX_REPEAT = 10      // Moshpit runs a command at most this many times per message (CONTROL-PROTOCOL.md)
export const UI_FEEDBACK_CAP = 'ui-feedback.v1'
const FEEDBACK_KEYS = ['in', 'out', 'transpose', 'clip', 'folder', 'zoom', 'frame', 'block']
export function sanitizeUiFeedback(feedback) {
  if (!feedback || !WORKSPACES.includes(feedback.workspace) || !feedback.values || typeof feedback.values !== 'object') return null
  const values = {}
  for (const key of FEEDBACK_KEYS) {
    const value = feedback.values[key]
    if (!value || typeof value.text !== 'string' || !value.text.trim()) continue
    values[key] = { text: value.text.replace(/[\r\n\t]/g, ' ').trim().slice(0, 96) }
    if (typeof value.norm === 'number' && Number.isFinite(value.norm)) values[key].norm = Math.max(0, Math.min(1, value.norm))
  }
  return { workspace: feedback.workspace, values }
}

// The CT's own cursors, resolved before an action reaches Moshpit: "slot": "sel" is the selected slot, and a bank
// dial ("bank": 1-3) is the nth control of the bank the right dials edit: params 1-3, params 4-6, or LFO 1's period
// and phase (the third is blank: null). The deck and the adapter checks share this one function.
export const BANKS = ['P1-3', 'P4-6', 'LFO']
export const SIX_BANKS = ['P1-6', 'P7-8', 'LFO']
export function ctResolve(v, slot = 1, b = 0) {
  if (!v || v.slot !== 'sel') return v
  const { bank: n, bankWidth, ...s } = { ...v, slot }
  if (n === undefined) return s
  if (bankWidth === 6 && b < 2) return b * 6 + n <= 8 ? { ...s, param: b * 6 + n } : null
  if (b < 2) return { ...s, param: b * 3 + n }
  const field = ['period', 'phase'][n - 1]
  if (!field) return null
  const { slot: _s, param: _p, ...lfo } = s
  return { ...lfo, lfo: 1, field }
}
// selstep and bank move the CT's cursors; they never go to Moshpit
export const ctSide = (v) => !!v && ['select', 'selstep', 'bank'].includes(v.verb)

export function createMoshpitClient({ endpoint, token, endpointFile, readFile, log = () => {}, WebSocketImpl = globalThis.WebSocket, clientVersion = '' } = {}) {
  let ws = null, want = false, attempt = 0, retry = null, lease = null, pinger = null, seq = 0
  const pending = new Map()      // request id -> { resolve, reject, timer }
  const listeners = new Set()
  // What Moshpit told us: the project's generation, its targets by path, and the active block's chain
  const st = { phase: 'stopped', detail: '', generation: null, project: null, workspace: null, caps: [], activeBlock: null, selected: null, targets: new Map(), slots: [], commands: [], values: new Map(), resolved: new Map(), feedback: null }
  const emit = (why) => { for (const f of listeners) { try { f(why, st) } catch {} } }
  const phase = (p, detail = '') => { if (st.phase !== p || st.detail !== detail) { st.phase = p; st.detail = detail; log(`moshpit: ${p}${detail ? ` - ${detail}` : ''}`); emit('phase') } }

  function send(msg) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true } return false }
  function request(msg) {
    const id = ++seq
    return new Promise((resolve, reject) => {
      if (!send({ ...msg, id })) return reject(Object.assign(new Error('Moshpit is not connected'), { code: 'NOT_CONNECTED' }))
      const timer = setTimeout(() => { pending.delete(id); reject(Object.assign(new Error(`Moshpit did not answer ${msg.type} in ${REQUEST_MS} ms`), { code: 'TIMEOUT' })) }, REQUEST_MS)
      pending.set(id, { resolve, reject, timer })
    })
  }
  function renewLease() { clearTimeout(lease); lease = setTimeout(() => { log('moshpit: no message in 8 s - reconnecting'); ws && ws.close() }, LEASE_MS) }
  const takeFeedback = (feedback) => { st.feedback = st.caps.includes(UI_FEEDBACK_CAP) ? sanitizeUiFeedback(feedback) : null }
  function clearLive() {
    st.targets = new Map(); st.values = new Map(); st.resolved = new Map(); st.slots = []; st.commands = []
    st.generation = null; st.workspace = null; st.selected = null; st.activeBlock = null; st.project = null; st.caps = []; st.feedback = null
  }

  // The targets message: every ControlTarget Moshpit exposes, and the active block's chain in order
  function takeTargets(m) {
    if (Array.isArray(m.caps)) st.caps = m.caps
    if (WORKSPACES.includes(m.workspace)) st.workspace = m.workspace
    st.generation = m.generation
    st.activeBlock = m.activeBlock || null
    st.targets = new Map((m.targets || []).map((t) => [t.path, t]))
    st.values = new Map()
    for (const t of m.targets || []) if (t.value !== undefined) st.values.set(t.path, t.value)
    st.resolved = new Map()
    st.slots = m.slots || []      // [{ nodeId, name, index, params: [path, ...] }], the active block's nodes in chain order
    st.commands = m.commands || []
    st.selected = (m.selected && m.selected.nodeId) || null   // M1: Moshpit's inspector selection
    takeFeedback(m.feedback)
    emit('targets')
  }
  function onMessage(raw) {
    renewLease()
    let m
    try { m = JSON.parse(raw) } catch { return log('moshpit: a message that is not JSON was ignored') }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer)
      if (m.type === 'error') return p.reject(errorOf(m))
      return p.resolve(m)
    }
    switch (m.type) {
      case 'workspace':
        if (WORKSPACES.includes(m.workspace) && st.workspace !== m.workspace) { st.workspace = m.workspace; st.feedback = null; emit('workspace') }
        return
      case 'ui-feedback': takeFeedback(m.feedback); return emit('feedback')
      case 'value':                                  // pushed feedback (a dial, the mouse, an undo); throttled by Moshpit to <= 20 Hz per target
        st.values.set(m.path, m.value)
        if (m.resolved !== undefined) st.resolved.set(m.path, m.resolved); else st.resolved.delete(m.path)
        return emit('value')
      case 'selection':                              // M1: the selection moved in Moshpit (the mouse, the graph, the CT)
        st.selected = (m.selected && m.selected.nodeId) || null
        return emit('selection')
      case 'targets-changed': return discover().catch((e) => log(`moshpit: re-discovery failed: ${e.message}`))   // the graph or the active block moved
      case 'pong': return
      case 'error': return log(`moshpit: ${errorOf(m).message}`)
    }
  }
  // An error message is { type: "error", id, code, error? }: error is a string, or MoshpitError JSON with a message
  function errorOf(m) {
    const e = m.error, text = typeof e === 'string' ? e : e && (e.message || e.fix) ? [e.message, e.fix].filter(Boolean).join(' ') : ''
    return Object.assign(new Error(text ? `${m.code}: ${text}` : m.code), { code: m.code, detail: e })
  }
  // Where Moshpit is: the endpoint file (port, path, token) when there is one, else the fixed endpoint
  function where() {
    if (!endpointFile) return endpoint ? { url: endpoint, token } : null
    let e
    try { e = JSON.parse((readFile || ((f) => fs.readFileSync(f, 'utf8')))(endpointFile)) } catch { return null }
    if (!e || e.protocol !== PROTOCOL || !Number.isInteger(e.port) || typeof e.token !== 'string') return null
    return { url: `ws://127.0.0.1:${e.port}${e.path || '/control'}`, token: e.token }
  }

  async function discover() { const socket = ws; const m = await request({ type: 'discover' }); if (ws !== socket || !want) return m; takeTargets(m); await request({ type: 'subscribe', paths: [...st.targets.keys()] }).catch(() => {}); return m }

  function connect() {
    if (!want) return
    if (!WebSocketImpl) return phase('error', 'this Node has no WebSocket client')
    const at = where()
    if (!at) return schedule(endpointFile ? 'Moshpit is not running (no control endpoint file)' : 'no Moshpit endpoint set')
    phase('connecting', at.url)
    let sock
    try { sock = new WebSocketImpl(at.url) } catch (e) { return schedule(e.message) }
    ws = sock
    sock.onopen = async () => {
      renewLease()
      try {
        const w = await request({ type: 'hello', protocol: PROTOCOL, version: VERSION, client: 'waxyct', clientVersion, token: at.token })
        if (ws !== sock || !want) return
        if (w.version !== VERSION) { phase('error', `Moshpit speaks ${PROTOCOL} v${w.version}; waxyct speaks v${VERSION}`); want = false; return sock.close() }
        st.project = w.project || null
        st.workspace = WORKSPACES.includes(w.workspace) ? w.workspace : null
        st.caps = w.caps || []
        takeFeedback(w.feedback)
        attempt = 0
        await discover()
        if (ws !== sock || !want) return
        phase('connected', st.project ? st.project.name : '')
        clearInterval(pinger); pinger = setInterval(() => send({ type: 'ping' }), PING_MS)
      } catch (e) {
        // a version mismatch will not mend itself: stop and say so. A refused token is re-read on the next try.
        if (e.code === 'PROTOCOL_VERSION') { phase('error', `Moshpit refused the protocol: ${e.message}`); want = false }
        else log(`moshpit: handshake failed: ${e.message}`)
        sock.close()
      }
    }
    sock.onmessage = (e) => { if (ws === sock) onMessage(typeof e.data === 'string' ? e.data : String(e.data)) }
    sock.onerror = () => {}
    sock.onclose = () => {
      if (ws !== sock) return
      ws = null; clearTimeout(lease); clearInterval(pinger)
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Object.assign(new Error('Moshpit closed the link'), { code: 'NOT_CONNECTED' })) }
      pending.clear()
      clearLive()
      emit('targets')
      schedule('closed')
    }
  }
  function schedule(why) {
    if (!want) return phase('stopped')
    const ms = BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]
    phase('waiting', `${why}; retrying in ${ms / 1000} s (is Moshpit open?)`)
    clearTimeout(retry); retry = setTimeout(connect, ms)
  }

  // An action's target path: absolute, or relative to the active block (slot n, param by position or key)
  function resolve(a) {
    if (a.path) return a.path
    if (a.lfo) { const l = [...st.targets.keys()].filter((p) => p.startsWith('/lfo/') && p.endsWith(`/${a.field || 'period'}`))[a.lfo - 1]; return l || null }
    const s = st.slots[a.slot - 1]
    if (!s) return null
    if (typeof a.param === 'number') return s.params[a.param - 1] || null
    return s.params.find((p) => p.endsWith(`/param/${a.param}`)) || null
  }
  const def = (path) => (st.targets.get(path) || {}).param || null

  // One CT action. delta: encoder detents for a turn (Moshpit applies the param's step); mode: fine / coarse.
  async function act(a, delta = 0, mode = 'normal') {
    if (a.verb === 'command') return request({ type: 'command', command: a.command })
    // The action queue splits coalesced wheel turns into ACK-paced chunks <= MAX_REPEAT.
    // Retain the protocol safety cap for direct callers too (CONTROL-PROTOCOL.md).
    if (a.verb === 'step') {
      const supportsMode = st.caps.includes('rotary-command-mode.v1')
      if (mode !== 'normal' && !supportsMode) throw Object.assign(new Error('Update Moshpit to use held rotary modifiers for frame and browsing controls'), { code: 'ROTARY_MODE_UNSUPPORTED' })
      return request({ type: 'command', command: a.commands[delta < 0 ? 0 : 1], repeat: Math.min(MAX_REPEAT, Math.abs(delta) || 1), ...(supportsMode ? { mode } : {}) })
    }
    const path = resolve(a)
    if (!path) throw Object.assign(new Error(a.path ? `Moshpit has no ${a.path}` : `slot ${a.slot} has no parameter ${a.param}`), { code: 'PARAM_UNKNOWN' })
    const t = st.targets.get(path)
    const write = { target: path, generation: a.captured ? a.generation : t ? t.generation : st.generation, source: 'ct', mode }
    if (a.verb === 'knob') write.delta = delta
    else if (a.verb === 'reset') { const d = def(path) || {}; write.value = d.initial ?? d.default }
    // toggle: no value; Moshpit flips a bool (applyControlWrite)
    try {
      const r = await request({ type: 'write', write })
      if (r.value !== undefined && st.phase === 'connected' && st.targets.has(path)) { st.values.set(path, r.value); emit('value') }
      return r
    } catch (e) {
      if (e.code === 'CONTROL_STALE_TARGET') { await discover(); throw Object.assign(new Error('Moshpit moved on; the CT re-read it, try again'), { code: e.code }) }
      throw e
    }
  }

  // For the CT: a dial's value 0-1, and whether a toggle is on
  function norm(a) {
    const path = resolve(a), d = path && def(path)
    if (!d) return null
    const v = st.values.get(path)
    if (v === undefined || v === null) return null
    if (d.type === 'bool') return v ? 1 : 0
    if (d.type === 'enum') { const o = d.options || []; return o.length > 1 ? Math.max(0, o.indexOf(String(v))) / (o.length - 1) : 0 }
    const min = d.min ?? 0, max = d.max ?? 1, n = Number(v)
    return Number.isFinite(n) && max > min ? Math.min(1, Math.max(0, (n - min) / (max - min))) : null
  }
  const on = (a) => { const path = resolve(a); return !!(path && st.values.get(path)) }
  // An LFO drives it: the target says "modulated", and pushes carry the resolved (moving) value
  const modulated = (a) => { const path = resolve(a); return !!(path && ((st.targets.get(path) || {}).modulated || st.resolved.has(path))) }
  // M1: one selection. Only sent to a Moshpit that offers it (caps "select" and "selection"); an older one keeps
  // the CT's own. A stale generation or a node with no slot comes back CONTROL_STALE_TARGET: re-read, then say so.
  const syncs = () => st.caps.includes('select') && st.caps.includes('selection')
  async function select(nodeId) {
    if (!syncs() || !nodeId) return false
    try {
      const r = await request({ type: 'select', nodeId, generation: st.generation })
      if (!syncs() || st.phase !== 'connected') return false
      st.selected = (r.selected && r.selected.nodeId) || nodeId
      emit('selection')
      return true
    } catch (e) {
      if (e.code === 'CONTROL_STALE_TARGET') { await discover().catch(() => {}); throw Object.assign(new Error('Moshpit moved on; the CT re-read it, try again'), { code: e.code }) }
      throw e
    }
  }
  const selectedSlot = () => { const i = st.slots.findIndex((s) => s.nodeId === st.selected); return i + 1 }   // 0: none, or not in this block
  const slotName = (n) => (st.slots[n - 1] || {}).name || ''
  const label = (a) => { const path = resolve(a), d = path && def(path); return d ? d.label || d.key : '' }   // Moshpit's own name for the param
  const reading = (a) => { const path = resolve(a), param = path && def(path); return param && st.values.has(path) ? { param, value: st.values.get(path), norm: norm(a) } : null }

  return {
    start() { if (want) return; want = true; connect() },
    stop() { want = false; clearTimeout(retry); clearTimeout(lease); clearInterval(pinger); if (ws) ws.close(); ws = null; clearLive(); phase('stopped'); emit('targets') },
    act, norm, on, modulated, resolve, slotName, label, reading, discover, select, selectedSlot, syncs,
    state: () => st,
    connected: () => st.phase === 'connected',
    onChange(f) { listeners.add(f); return () => listeners.delete(f) },
  }
}
