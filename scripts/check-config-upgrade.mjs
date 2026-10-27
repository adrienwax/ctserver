// Offline ownership and recovery checks: all files live in a temporary directory.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { upgradeConfig } from '../host/config-upgrade.mjs'
import { writeGeneratedProfile } from './generated-profile.mjs'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waxyct-upgrade-'))
const shipped = path.join(tmp, 'release'), user = path.join(tmp, 'user'), file = 'profiles/moshpit.json'
const put = (root, f, value) => { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(value)) }
const get = (root, f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
const update = version => upgradeConfig({ shipped, user, version })
const status = () => get(user, '.updates/report.json').files.find(f => f.file === file).status
let n = 0
function check(name, fn) { fn(); n++; console.log(`ok ${name}`) }
try {
  put(shipped, file, { name: 'MOSHPIT', pages: [{ name: 'HOME' }] })
  check('first run seeds a baseline', () => { update('v1'); assert.equal(status(), 'added'); assert.deepEqual(get(user, file), get(user, '.shipped/' + file)) })
  check('format-only user saves do not block unchanged defaults', () => { fs.writeFileSync(path.join(user, file), JSON.stringify(get(user, file), null, 2)); update('v1'); assert.equal(status(), 'current') })
  check('untouched profile upgrades and keeps prior bytes', () => { put(shipped, file, { name: 'MOSHPIT', pages: [{ name: 'HOME' }, { name: 'FX' }] }); update('v2'); assert.equal(status(), 'updated'); assert.equal(fs.readdirSync(path.join(user, '.upgrade-history')).length, 1) })
  check('user dial edit survives next upgrade', () => { const p = get(user, file); p.pages[0].wheel = { turn: { keys: 'right' } }; put(user, file, p); put(shipped, file, { name: 'MOSHPIT 3', pages: [{ name: 'HOME' }] }); update('v3'); assert.equal(status(), 'preserved'); assert.deepEqual(get(user, file), p); assert.deepEqual(get(user, '.updates/incoming/' + file), get(shipped, file)) })
  check('rollback also preserves edited mappings', () => { const p = get(user, file); put(shipped, file, { name: 'MOSHPIT', pages: [{ name: 'HOME' }] }); update('v1'); assert.equal(status(), 'preserved'); assert.deepEqual(get(user, file), p) })
  check('older profile without baseline preserves exact custom bytes', () => { fs.rmSync(path.join(user, '.shipped', file)); const bytes = Buffer.from(' { "name": "MY LAYOUT", "pages": [] }\r\n'); fs.writeFileSync(path.join(user, file), bytes); update('v1'); assert.equal(status(), 'preserved'); assert.deepEqual(fs.readFileSync(path.join(user, file)), bytes) })
  check('adopting a candidate clears obsolete update', () => { put(user, file, get(user, '.updates/incoming/' + file)); update('v1'); assert.equal(status(), 'current'); assert.equal(fs.existsSync(path.join(user, '.updates/incoming', file)), false) })
  check('invalid user JSON is preserved for recovery', () => { fs.writeFileSync(path.join(user, file), '{broken'); update('v2'); assert.equal(status(), 'preserved'); assert.equal(fs.readFileSync(path.join(user, file), 'utf8'), '{broken') })
  check('one invalid shipped file refuses the whole plan before writes', () => { put(shipped, 'apps.json', { valid: true }); fs.writeFileSync(path.join(shipped, file), '{broken'); assert.throws(() => update('broken')); assert.equal(fs.existsSync(path.join(user, 'apps.json')), false) })
  check('source and user paths cannot be the same', () => assert.throws(() => upgradeConfig({ shipped, user: shipped }), /separate/))
  check('removed shipped profiles are retained', () => { fs.rmSync(path.join(shipped, file)); update('v4'); assert.equal(fs.existsSync(path.join(user, file)), true) })
  check('rigs, apps and settings have the same ownership policy', () => { for (const f of ['rigs/moshpit.json', 'settings.json', 'apps.json']) { put(shipped, f, { value: 1 }); put(user, f, { mine: true }) } update('v5'); for (const f of ['rigs/moshpit.json', 'settings.json', 'apps.json']) assert.deepEqual(get(user, f), { mine: true }) })
  const generated = path.join(tmp, 'generated', 'profiles', 'mine.json')
  check('generator creates a missing profile', () => assert.equal(writeGeneratedProfile(generated, '{"name":"Original"}'), 'created'))
  check('generator refuses to overwrite edited profile', () => { assert.equal(writeGeneratedProfile(generated, '{"name":"Changed"}'), 'candidate'); assert.equal(JSON.parse(fs.readFileSync(generated)).name, 'Original') })
  check('explicit regeneration archives the previous profile', () => { assert.match(writeGeneratedProfile(generated, '{"name":"Changed"}', { replace: true }), /replaced/); const history = path.join(tmp, 'generated', '.history'); assert.equal(JSON.parse(fs.readFileSync(path.join(history, fs.readdirSync(history)[0]))).name, 'Original') })
  check('identical regeneration does not create history', () => assert.equal(writeGeneratedProfile(generated, '{ "name": "Changed" }'), 'unchanged'))
  console.log(`configuration ownership: ${n} checks passed (no live files, CT or TD)`)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
