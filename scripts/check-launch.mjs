// Offline launch contract: only injected children; no application, shell or device is started.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { normalizeLaunch, launchGui } from '../host/launch.mjs'
import { checkApps, checkProfile } from '../host/profiles.mjs'

let checks = 0
const exe = 'C:\\Program Files\\Moshpit\\Moshpit 3.exe'
assert.deepEqual(normalizeLaunch(exe), { path: exe, args: [], env: {} }); checks++
const input = { path: exe, args: ['--title', 'a b & c', ''], env: { MOSHPIT_USER_DATA: 'C:\\Owner data', Path: 'custom path', ELECTRON_RUN_AS_NODE: '1' } }
const snapshot = structuredClone(input)
const inherited = { ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1', PATH: 'inherited', KEEP: 'kept', MOSHPIT_ENGINE_CACHE: 'cache folder' }
let call, unref = 0
const errors = []
const child = new EventEmitter()
child.unref = () => { assert.equal(child.listenerCount('error'), 1, 'error handler precedes detach'); unref++ }
const spawnImpl = (...args) => { call = args; return child }
assert.equal(launchGui(input, { spawnImpl, env: inherited, onError: (...args) => errors.push(args) }), child)
assert.equal(call[0], exe)
assert.deepEqual(call[1], input.args, 'arguments with spaces and shell characters stay separate and literal')
assert.equal(call[2].shell, false); assert.equal(call[2].detached, true); assert.equal(call[2].stdio, 'ignore')
assert.deepEqual(call[2].env, { KEEP: 'kept', MOSHPIT_ENGINE_CACHE: 'cache folder', MOSHPIT_USER_DATA: 'C:\\Owner data', Path: 'custom path' })
assert.equal(unref, 1)
assert.deepEqual(input, snapshot)
assert.equal(inherited.ELECTRON_RUN_AS_NODE, '1', 'parent environment is untouched')
checks++
const asynchronous = Object.assign(new Error('file missing'), { code: 'ENOENT' })
child.emit('error', asynchronous)
assert.deepEqual(errors, [[asynchronous, exe]], 'asynchronous spawn error is reported, not unhandled')
checks++
const syncErrors = []
assert.equal(launchGui(exe, { spawnImpl: () => { throw new Error('sync spawn failed') }, onError: error => syncErrors.push(error.message) }), null)
assert.deepEqual(syncErrors, ['sync spawn failed']); checks++
let dryPath
assert.equal(launchGui(input, { dry: true, onDry: path => { dryPath = path }, spawnImpl: () => { throw new Error('dry run spawned') } }), null)
assert.equal(dryPath, exe); checks++
const malformed = [null, [], 3, '', ' \t', 'x\0y', {}, { path: exe, args: 'one two' }, { path: exe, args: [3] }, { path: exe, args: ['bad\0arg'] }, { path: exe, env: [] }, { path: exe, env: { A: 1 } }, { path: exe, env: { 'A=B': 'x' } }, { path: exe, env: { A: 'x\0y' } }, { path: exe, env: { Path: 'a', PATH: 'b' } }, { path: exe, shell: true }]
for (const spec of malformed) {
  assert.throws(() => normalizeLaunch(spec), TypeError)
  let failed = false, spawned = false
  assert.equal(launchGui(spec, { spawnImpl: () => { spawned = true }, onError: () => { failed = true } }), null)
  assert.equal(failed, true); assert.equal(spawned, false)
  assert.ok(checkApps({ test: { name: 'Test', target: 'keys', launch: spec } }).some(error => error.includes('launch')))
}
checks++
for (const spec of [exe, input]) {
  assert.deepEqual(checkApps({ test: { name: 'Test', target: 'keys', launch: spec } }), [])
  const profile = { name: 'Test', app: { exe: 'fake.exe', launch: spec }, pages: [{ name: 'PAGE', keys: { '0': { label: 'START', do: { launch: spec } } } }] }
  assert.deepEqual(checkProfile(profile, ['test']), [])
  profile.app.launch = { path: exe, args: 'invalid' }
  profile.pages[0].keys['0'].do.launch = { path: exe, env: { A: false } }
  const failures = checkProfile(profile, ['test'])
  assert.ok(failures.some(error => error.includes('app.launch')))
  assert.ok(failures.some(error => error.includes('keys') && error.includes('launch.env')))
}
checks++
// String form also strips the Electron variable without requiring explicit environment overrides.
child.removeAllListeners('error')
assert.equal(launchGui(exe, { env: inherited, spawnImpl, onError: error => { throw error } }), child)
assert.deepEqual(call[1], [])
assert.ok(Object.keys(call[2].env).every(key => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'))
assert.equal(call[2].env.KEEP, 'kept'); checks++
console.log(`launch: ${checks} offline groups passed (string/object, environment isolation, literal arguments, validation, dry-run and sync/async failures)`)
