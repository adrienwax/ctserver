// Compare the unpacked candidate with its source without launching the application.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bridgeRuntimeFiles, checkBridgeDisplay } from './bridge-runtime.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version
const folder = path.resolve(process.argv[2] || path.join(root, 'release', `waxyct.${version}`))
const app = path.join(folder, 'resources', 'app'), ct = path.join(folder, 'resources', 'ct')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const checks = []
function match(a, b, name) { assert.equal(hash(a), hash(b), `Packaged bytes differ: ${name}`); checks.push(name) }
function tree(source, dest, prefix = '') {
  for (const f of fs.readdirSync(source, { withFileTypes: true })) {
    if (f.name.startsWith('.') || f.name.startsWith('_backup-')) continue
    const a = path.join(source, f.name), b = path.join(dest, f.name), name = prefix + f.name
    if (f.isDirectory()) tree(a, b, name + '/')
    else match(a, b, name)
  }
}
for (const d of ['host', 'ui', 'electron', 'config']) tree(path.join(root, d), path.join(app, d), d + '/')
for (const f of ['router.mjs', 'waxyct.ico', 'build-info.json']) match(path.join(root, f), path.join(app, f), f)
match(path.join(root, 'scripts/park-config.mjs'), path.join(app, 'scripts/park-config.mjs'), 'scripts/park-config.mjs')
// electron-builder removes build-time scripts/dependencies from the shipped manifest.
const { build: _build, scripts: _scripts, devDependencies: _dev, ...runtimeManifest } = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app, 'package.json'))), runtimeManifest)
const bridge = path.join(root, 'integrations', 'ct-td-control')
for (const f of bridgeRuntimeFiles(bridge)) match(path.join(bridge, f), path.join(ct, f), `ct/${f}`)
checkBridgeDisplay(ct, path.join(folder, 'waxyct.exe'), { ...process.env, ELECTRON_RUN_AS_NODE: '1' })
tree(path.join(bridge, 'td'), path.join(ct, 'td'), 'ct/td/')
tree(path.join(bridge, 'node_modules'), path.join(ct, 'modules'), 'ct/modules/')
for (const hidden of ['.lastgood', '.history', '.shipped', '.updates', '.upgrade-history', '.generated']) assert.equal(fs.existsSync(path.join(app, 'config', hidden)), false, `${hidden} must not ship`)
const portable = path.join(path.dirname(folder), `waxyct.${version}.exe`)
const report = { version, verified: new Date().toISOString(), kind: 'unpacked byte comparison; no application or CT launched', source: JSON.parse(fs.readFileSync(path.join(app, 'build-info.json'))), matchedFiles: checks.length, portable: { file: portable, bytes: fs.statSync(portable).size, sha256: hash(portable) }, files: checks }
fs.writeFileSync(path.join(path.dirname(folder), `waxyct.${version}.verification.json`), JSON.stringify(report, null, 2) + '\n')
console.log(`Package verified: ${checks.length} files match source; private history excluded; portable SHA256 ${report.portable.sha256}`)
