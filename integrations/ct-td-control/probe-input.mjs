// Raw CT input probe: open the CT, log every input event, close CLEANLY. Nothing goes to TD.
//   node probe-input.mjs [seconds=30] [--wait-replug]
// --wait-replug: wait for the CT to leave USB and come back (or 45 s of it staying put) first.
// Always ends with dev.close(): a killed process leaves the deck stuck (see connect-ct.mjs).
// Takes the shared claim (ct-claim.mjs) and refuses if another owner holds the CT. Forked by the
// ct-router panel for its input test: every event goes to the panel over IPC, and 'stop' ends it.
import { findCT, connectCT } from './connect-ct.mjs'
import * as ctClaim from './ct-claim.mjs'

const secs = Number(process.argv.find(a => /^\d+$/.test(a)) || 30)
const log = (...a) => console.log(new Date().toISOString(), ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))

if (process.argv.includes('--wait-replug')) {
  log('waiting for replug (CT to leave USB and return)...')
  let gone = false
  for (let t = 0; t < 180; t++) {
    const p = await findCT()
    if (!p && !gone) { gone = true; log('CT unplugged') }
    if (p && gone) { log('CT back on', p, '- settling 3 s'); await wait(3000); break }
    if (p && !gone && t >= 45) { log('CT never left USB in 45 s - assuming already replugged'); break }
    await wait(1000)
  }
}

const held = ctClaim.claim('probe')
if (held) { log(`the CT is claimed by ${held.owner} (pid ${held.pid}); stop it first`); process.exit(2) }
let pendingStop = null, stopFn = why => { pendingStop = why }   // a stop during the handshake waits for finish()
if (process.send) {
  process.on('message', m => { if (m === 'stop') stopFn('router: stop') })
  process.on('disconnect', () => stopFn('router gone'))
}
const t0 = Date.now()
const dev = await connectCT().catch(e => { log('CONNECT FAILED:', e.message); process.exit(1) })
log('CT open on', dev.path, 'in', Date.now() - t0, 'ms; info', JSON.stringify(await dev.getInfo().catch(e => 'getInfo failed: ' + e.message)))

ctClaim.update({ state: 'connected', port: dev.path })
let lastInput = Date.now(), lastEvent = ''
const claimTimer = setInterval(() => ctClaim.update({ lastInput, lastEvent }), ctClaim.REFRESH_MS)

const seen = {}
const hit = (k, detail, msg) => {
  seen[k] = (seen[k] || 0) + 1; lastInput = Date.now(); lastEvent = k
  log('EVENT', k, detail)
  if (process.send && process.connected) process.send({ key: k, ...msg })
}
dev.on('rotate', e => hit(`rotate ${e.id}`, `delta ${e.delta}`, { ev: 'rotate', id: e.id, delta: e.delta }))
dev.on('down', e => hit(`down ${e.id}`, '', { ev: 'down', id: e.id }))
dev.on('touchstart', e => { const c = e.changedTouches[0]; hit(`touch ${c.target.screen}${c.target.key !== undefined ? ' key ' + c.target.key : ''}`, `x ${c.x} y ${c.y}`, { ev: 'touch', screen: c.target.screen, key: c.target.key, x: c.x, y: c.y }) })
dev.on('disconnect', e => log('DISCONNECT', e && e.message))

let closing = false
async function finish(why) {
  if (closing) return
  closing = true
  clearInterval(claimTimer)
  log(why, '- events per control:', JSON.stringify(seen), 'total', Object.values(seen).reduce((a, b) => a + b, 0))
  await dev.setButtonColor({ id: 0, color: '#000000' }).catch(() => {})
  await dev.close().catch(e => log('close error', e.message))
  log('CT closed cleanly')
  ctClaim.release()
  process.exit(0)
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => finish(sig))   // SIGHUP: console closed
stopFn = finish
if (pendingStop) finish(pendingStop)

await dev.setButtonColor({ id: 0, color: '#00c850' }).catch(e => log('LED set failed', e.message))
log(`ARMED - ${secs} s raw capture (button 0 should be green)`)
await wait(secs * 1000)
await finish('DONE')
