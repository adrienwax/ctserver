// A stand-in Moshpit v3 control server: moshpit-v3/CONTROL-PROTOCOL.md v1 over a bare WebSocket (no packages), a
// fake project of one block with three nodes and an LFO, and Moshpit's own write rules (engine/src/control/
// params.ts applyControlWrite: param step x detents x fine/coarse, clamped, int rounding, bool flip, stale
// generations refused). For tests and for running the CT against "Moshpit" before Moshpit's server exists.
// Like Moshpit it writes an endpoint file { v, port, path, token, protocol } and refuses a hello without its token.
// (scripts/check-moshpit-real.mjs runs Moshpit's own server; this one needs no Moshpit repo.)
//   node scripts/mock-moshpit.mjs [port]        serves ws://127.0.0.1:<port>/control (6193 by default)
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
function frame(text) {
  const b = Buffer.from(text), n = b.length
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])])
  return Buffer.concat([head, b])
}
// Client frames are masked text frames (or a close); enough for this stand-in
function* frames(buf) {
  let i = 0
  while (buf.length - i >= 2) {
    const op = buf[i] & 15, masked = buf[i + 1] & 128
    let n = buf[i + 1] & 127, o = i + 2
    if (n === 126) { if (buf.length < o + 2) return; n = buf.readUInt16BE(o); o += 2 } else if (n === 127) { if (buf.length < o + 8) return; n = Number(buf.readBigUInt64BE(o)); o += 8 }
    const mask = masked ? buf.subarray(o, o + 4) : null
    if (masked) o += 4
    if (buf.length < o + n) return
    const data = Buffer.from(buf.subarray(o, o + n))
    if (mask) for (let k = 0; k < n; k++) data[k] ^= mask[k & 3]
    yield { op, data, end: o + n }
    i = o + n
  }
}

export function fakeProject() {
  const P = (key, label, type, d, min, max, step, extra = {}) => ({ key, label, type, default: d, min, max, step, ...extra })
  return {
    project: { id: 'p1', name: 'Mock project' }, generation: 1, activeBlock: 'b1',
    nodes: [
      { id: 'n1', name: 'Hold', params: [P('frames', 'Frames', 'int', 4, 1, 30, 1), P('mix', 'Mix', 'float', 0.5, 0, 1, 0.01), P('bypass', 'Bypass', 'bool', false)] },
      { id: 'n2', name: 'Melt', params: [P('amount', 'Amount', 'float', 0.2, 0, 1, 0.01), P('rate', 'Rate', 'beats', 1, 0.25, 8, 0.25), P('bypass', 'Bypass', 'bool', false)] },
      { id: 'n3', name: 'Tone', params: [P('mode', 'Mode', 'enum', 'warm', undefined, undefined, undefined, { options: ['warm', 'cold', 'uv'] }), P('gain', 'Gain', 'float', 1, 0, 2, 0.05), P('bypass', 'Bypass', 'bool', false)] },
    ],
    lfos: [{ id: 'l1', period: 4, phase: 0 }],
    commands: ['transport.play', 'transport.stop', 'transport.loop', 'transport.prevFrame', 'transport.nextFrame', 'mark.in', 'mark.out', 'block.prev', 'block.next', 'block.freeze', 'block.unfreeze',
      'workspace.browse', 'workspace.mosh', 'workspace.node', 'workspace.render', 'workspace.settings', 'edit.undo', 'edit.redo',
      'clip.prev', 'clip.next', 'mark.in.nudgeBack', 'mark.in.nudgeForward', 'mark.out.nudgeBack', 'mark.out.nudgeForward', 'render.start', 'source.selectAll', 'source.sendA', 'source.sendB', 'source.addBlock', 'mark.range.nudgeBack', 'mark.range.nudgeForward', 'folder.prev', 'folder.next', 'source.zoomOut', 'source.zoomIn', 'source.zoomFit'],
  }
}

export function startMockMoshpit({ empty = false, selection = true, workspace = null, port = 6193, endpointFile = path.join(os.tmpdir(), `mock-moshpit-${process.pid}-${Date.now()}.json`), token = randomBytes(24).toString('hex'), log = () => {} } = {}) {
  const proj = fakeProject()
  if (empty) { proj.nodes = []; proj.activeBlock = null }   // as a fresh Moshpit: no block, no slots, selected null
  const values = new Map(), defs = new Map(), gens = new Map(), clients = new Set(), modulated = new Set()
  const tpath = (n, p) => `/block/${proj.activeBlock}/node/${n.id}/param/${p.key}`
  for (const n of proj.nodes) for (const p of n.params) { values.set(tpath(n, p), p.default); defs.set(tpath(n, p), p); gens.set(tpath(n, p), proj.generation) }
  for (const l of proj.lfos) for (const f of ['period', 'phase']) { const k = `/lfo/${l.id}/${f}`; values.set(k, l[f]); defs.set(k, f === 'period' ? { key: f, type: 'beats', default: l[f], min: 0.25, max: 64, step: 0.25 } : { key: f, type: 'float', default: 0, min: 0, max: 1, step: 0.01 }); gens.set(k, proj.generation) }
  const commandsSeen = []
  let selected = null
  const selOf = () => { const i = proj.nodes.findIndex((n) => n.id === selected); return i < 0 ? null : { nodeId: selected, slot: i + 1 } }
  const targets = () => [...defs].map(([p, d]) => ({ path: p, generation: gens.get(p), param: d, value: values.get(p), modulated: modulated.has(p) }))
  const slots = () => proj.nodes.map((n, i) => ({ nodeId: n.id, name: n.name, index: i + 1, params: n.params.map((p) => tpath(n, p)) }))
  const push = (msg) => { for (const c of clients) if (c.subscribed) c.write(frame(JSON.stringify(msg))) }
  function write(w) {
    const d = defs.get(w.target)
    if (!d) return { type: 'error', code: 'CONTROL_STALE_TARGET', error: { code: 'CONTROL_STALE_TARGET', message: `no ${w.target} any more` } }
    if (w.generation !== gens.get(w.target)) return { type: 'error', code: 'CONTROL_STALE_TARGET', error: { code: 'CONTROL_STALE_TARGET', message: 'the target moved on', fix: 're-discover' } }
    const cur = values.get(w.target)
    let v
    if (d.type === 'bool') v = w.value !== undefined ? !!w.value : !cur
    else if (d.type === 'enum') { const o = d.options; v = w.value !== undefined ? String(w.value) : o[(((o.indexOf(cur) + Math.round(w.delta || 0)) % o.length) + o.length) % o.length] }
    else {
      const k = w.mode === 'fine' ? 0.1 : w.mode === 'coarse' ? 10 : 1
      v = w.value !== undefined ? Number(w.value) : Number(cur) + w.delta * (d.step ?? (d.max - d.min) / 200) * k
      if (!Number.isFinite(v)) return { type: 'error', code: 'PARAM_OUT_OF_RANGE', error: { code: 'PARAM_OUT_OF_RANGE', message: 'not a number' } }
      v = Math.min(d.max, Math.max(d.min, v)); if (d.type === 'int') v = Math.round(v); v = Number(v.toFixed(6))
    }
    values.set(w.target, v)
    push({ type: 'value', path: w.target, value: v })
    return { type: 'ack', value: v }
  }
  const server = http.createServer((req, res) => { res.writeHead(426); res.end('WebSocket only') })
  server.on('upgrade', (req, sock) => {
    if (req.url !== '/control') return sock.destroy()
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64')
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const c = { write: (b) => sock.writable && sock.write(b), subscribed: false, hello: false }
    clients.add(c)
    let buf = Buffer.alloc(0)
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      let used = 0
      for (const f of frames(buf)) {
        used = f.end
        if (f.op === 8) { sock.end(); return }
        if (f.op !== 1) continue
        let m; try { m = JSON.parse(f.data.toString()) } catch { continue }
        const reply = (x) => c.write(frame(JSON.stringify({ ...x, id: m.id })))
        if (!c.hello) {
          if (m.type !== 'hello') { reply({ type: 'error', code: 'NO_HELLO' }); sock.end(); return }
          if (m.protocol !== 'moshpit-control' || m.version !== 1) { reply({ type: 'error', code: 'PROTOCOL_VERSION', error: 'this Moshpit speaks moshpit-control v1' }); sock.end(); return }
          if (m.token !== token) { reply({ type: 'error', code: 'NOT_AUTHORISED' }); sock.end(); return }
          c.hello = true; reply({ type: 'welcome', version: 1, project: proj.project, ...(workspace ? {workspace} : {}), caps: ['discover', 'write', 'command', 'subscribe', 'value-push', 'resolved', 'ping', ...(workspace ? ['workspace'] : []), ...(selection ? ['selection', 'select'] : [])] }); continue
        }
        else if (m.type === 'discover') reply({ type: 'targets', generation: proj.generation, activeBlock: proj.activeBlock, targets: targets(), slots: slots(), commands: proj.commands, ...(workspace ? {workspace} : {}), ...(selection ? { selected: selOf() } : {}) })
        else if (m.type === 'select' && selection) { if (!proj.nodes.some((n) => n.id === m.nodeId)) { reply({ type: 'error', code: 'CONTROL_STALE_TARGET' }); continue } if (m.generation !== undefined && m.generation !== proj.generation) { reply({ type: 'error', code: 'CONTROL_STALE_TARGET' }); continue } selected = m.nodeId; reply({ type: 'ack', selected: selOf() }); push({ type: 'selection', generation: proj.generation, selected: selOf() }) }
        else if (m.type === 'subscribe') { c.subscribed = true; reply({ type: 'subscribed', paths: m.paths || [] }); for (const p of m.paths || []) if (values.has(p)) c.write(frame(JSON.stringify({ type: 'value', path: p, value: values.get(p) }))) }
        else if (m.type === 'unsubscribe') reply({ type: 'ack' })
        else if (m.type === 'write') reply(write(m.write || {}))
        else if (m.type === 'command') {
          if (!proj.commands.includes(m.command)) { reply({ type: 'error', code: 'PARAM_UNKNOWN', error: { code: 'PARAM_UNKNOWN', message: `no command ${m.command}` } }); continue }
          const n = Math.max(1, Math.min(10, Math.round(Number(m.repeat ?? 1)) || 1))
          for (let k = 0; k < n; k++) commandsSeen.push(m.command)
          reply({ type: 'ack', repeat: n })
        }
        else if (m.type === 'ping') reply({ type: 'pong' })
        else reply({ type: 'error', code: 'UNKNOWN_MESSAGE', message: m.type })
      }
      buf = buf.subarray(used)
    })
    sock.on('close', () => clients.delete(c))
    sock.on('error', () => clients.delete(c))
  })
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => {
    const at = server.address().port
    fs.writeFileSync(`${endpointFile}.tmp`, JSON.stringify({ v: 1, port: at, path: '/control', token, protocol: 'moshpit-control' }))
    fs.renameSync(`${endpointFile}.tmp`, endpointFile)
    log(`mock Moshpit on ws://127.0.0.1:${at}/control (endpoint file ${endpointFile})`)
    ok({
      port: at, endpointFile, token, values, commandsSeen, selected: () => selected, generation: () => proj.generation,
      selectFromApp(nodeId) { selected = nodeId; push({ type: 'selection', generation: proj.generation, selected: selOf() }) },
      workspaceFromApp(value) { workspace = value; push({ type: 'workspace', workspace }) },
      // an LFO starts driving a param: Moshpit marks it modulated and pushes the resolved value beside the base
      modulate(p, resolved) { modulated.add(p); push({ type: 'value', path: p, value: values.get(p), resolved }) },
      // the graph changes: every target's generation moves, and clients are told to re-read
      bumpGeneration(silent = false) { proj.generation++; for (const k of gens.keys()) gens.set(k, proj.generation); if (!silent) push({ type: 'targets-changed', generation: proj.generation }) },
      setFromApp(p, v) { values.set(p, v); push({ type: 'value', path: p, value: v }) },
      close: () => new Promise((r) => { fs.rmSync(endpointFile, { force: true }); for (const c of clients) c.write(Buffer.from([0x88, 0])); server.close(() => r()); server.closeAllConnections?.() }),
    })
  }))
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) startMockMoshpit({ port: Number(process.argv[2]) || 6193, log: console.log })
