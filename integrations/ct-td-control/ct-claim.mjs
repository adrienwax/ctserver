// Who owns the CT. One claim file, shared by every process that opens the CT: the TD bridge, EDENA
// (which carries a copy of this file) and the ct-router panel's input probe. The panel reads it.
//
// A claim means "this process means to hold the CT". The owner keeps it through its own reconnects,
// so a second owner never grabs the port in the gap, and deletes it when it lets go. It is also the
// owner's status report: `state`, `port`, `lastInput`, `lastEvent`, refreshed every 2 s.
//
//   state: connecting | connected | quiet | heartbeat-lost | disconnected | not-found
//
// A claim blocks others only while its process is alive and its `updated` is under STALE_MS old, so an
// owner that crashed frees the CT on its own.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const CLAIM_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ct-router')
export const CLAIM_FILE = path.join(CLAIM_DIR, 'owner.json')
export const STALE_MS = 10000
export const REFRESH_MS = 2000

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

// null when there is no claim. A file that exists but does not parse is mid-write: report it as held,
// so nobody takes the CT on a half-written file; the next retry reads it whole.
export function readClaim() {
  let text
  try { text = fs.readFileSync(CLAIM_FILE, 'utf8') } catch { return null }
  try { return JSON.parse(text) } catch { return { owner: 'unknown', pid: -1, state: 'writing', updated: Date.now(), partial: true } }
}

// The claim that stops this process taking the CT, or null.
export function holder() {
  const c = readClaim()
  if (!c || c.pid === process.pid) return null
  if (c.partial) return c
  return alive(c.pid) && Date.now() - c.updated < STALE_MS ? c : null
}

// ponytail: rename is atomic on NTFS but fails while a reader has the file open; after 3 tries it
// writes in place, and readers treat a torn read as held (above).
function write(obj) {
  const tmp = `${CLAIM_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj))
  for (let i = 0; i < 3; i++) { try { fs.renameSync(tmp, CLAIM_FILE); return } catch {} }
  fs.writeFileSync(CLAIM_FILE, JSON.stringify(obj))
  fs.rmSync(tmp, { force: true })
}

// Take the claim for `owner`. Returns null on success, or the claim that holds the CT.
export function claim(owner, fields = {}) {
  fs.mkdirSync(CLAIM_DIR, { recursive: true })
  const h = holder()
  if (h) return h
  // ponytail: check-then-write, so two owners starting in the same millisecond could both win; the
  // port itself then refuses the second (Access denied), which is the failure there was before this file.
  const mine = readClaim()
  const since = mine && mine.pid === process.pid ? mine.since : Date.now()   // a re-claim keeps its start time
  write({ owner, pid: process.pid, state: 'connecting', ...fields, since, updated: Date.now() })
  return null
}

// Refresh this process's claim. Returns false if the claim is no longer ours.
export function update(fields) {
  const c = readClaim()
  if (!c || c.pid !== process.pid) return false
  write({ ...c, ...fields, updated: Date.now() })
  return true
}

export function release() {
  const c = readClaim()
  if (c && c.pid === process.pid) fs.rmSync(CLAIM_FILE, { force: true })
}

// Self-check: `node ct-claim.mjs`. Uses the real claim file, so it refuses to run while a live owner holds it.
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const assert = (await import('node:assert')).strict
  const { spawn } = await import('node:child_process')
  assert.equal(holder(), null, 'a live owner holds the CT; stop it before the self-check')
  assert.equal(claim('selftest'), null, 'free: claim succeeds')
  assert.ok(update({ state: 'connected' }) && readClaim().state === 'connected', 'update keeps our claim')
  const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e3)'])
  await new Promise((r) => other.once('spawn', r))
  write({ owner: 'other', pid: other.pid, state: 'connected', updated: Date.now() })
  assert.equal(claim('selftest').owner, 'other', 'a live, fresh claim blocks')
  assert.equal(update({ state: 'x' }), false, 'update does not touch a claim that is not ours')
  write({ owner: 'other', pid: other.pid, state: 'connected', updated: Date.now() - STALE_MS - 1 })
  assert.equal(holder(), null, 'a stale claim does not block')
  write({ owner: 'other', pid: other.pid, state: 'connected', updated: Date.now() })
  other.kill()
  await new Promise((r) => other.once('exit', r))
  assert.equal(holder(), null, 'a dead owner does not block')
  fs.writeFileSync(CLAIM_FILE, '{"own')
  assert.equal(holder().owner, 'unknown', 'a torn file blocks')
  fs.rmSync(CLAIM_FILE)
  assert.equal(claim('selftest'), null)
  release()
  assert.equal(fs.existsSync(CLAIM_FILE), false, 'release deletes our claim')
  console.log('ct-claim self-check: 10 checks ok')
}
