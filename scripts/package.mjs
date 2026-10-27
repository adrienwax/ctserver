// Packages this checkout using the managed E-drive run. The wrapper alone owns
// run cleanup after the whole process tree exits; failed runs remain inspectable.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bridgeRuntimeFiles, checkBridgeDisplay } from './bridge-runtime.mjs'
import { ensureScratch, configureToolCaches, requireScratchOutput } from './build-scratch/bootstrap.mjs'

const scratch = ensureScratch('package')
const unpackedOnly = process.argv.includes('--unpacked')
configureToolCaches(scratch)
const HERE = fileURLToPath(new URL('..', import.meta.url))
const BRIDGE = process.env.WAXYCT_BRIDGE_SRC || path.join(HERE, 'integrations', 'ct-td-control')
// Explicit release destinations remain possible, but may not route through a
// junction back to C or use a drive root. Never remove an existing destination.
function releaseDirectory(value) {
  const resolved = requireScratchOutput(path.win32.normalize(value))
  if (resolved === path.parse(resolved).root) throw new Error('A release directory cannot be the E-drive root.')
  return resolved
}
const RELEASES = releaseDirectory(process.env.WAXYCT_RELEASES || scratch.artifacts)
const builder = path.join(HERE, 'node_modules', 'electron-builder', 'cli.js')
const dist = path.join(HERE, 'node_modules', 'electron', 'dist')
const ct = path.join(scratch.temp, 'ct')
const info = path.join(scratch.temp, 'package-metadata')
const out = path.join(scratch.temp, 'builder-output')
const configFile = path.join(scratch.temp, 'electron-builder.json')
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'))
const { version } = pkg
const dest = path.join(RELEASES, `waxyct.${version}.exe`)
const folder = path.join(RELEASES, `waxyct.${version}`)
if (fs.existsSync(dest) || fs.existsSync(folder)) throw new Error(`Release ${version} already exists in ${RELEASES}. Choose a new version/output folder; existing releases are preserved.`)
const bridgeResources = pkg.build.extraResources.filter(r => typeof r === 'object' && r.from === 'build/ct')
if (bridgeResources.length !== 1) throw new Error('Expected exactly one build/ct resource declaration; review the packaging adapter.')
const config = {
  ...pkg.build,
  electronDist: dist,
  directories: { ...pkg.build.directories, output: out },
  files: [...pkg.build.files.filter(f => f !== 'build-info.json'), { from: info, to: '.', filter: ['build-info.json'] }],
  extraResources: pkg.build.extraResources.map(r => r === bridgeResources[0] ? { ...r, from: ct } : r),
}
// A tiny plan proves routing/configuration without copying runtimes, importing
// native modules, running the builder, downloading dependencies, or opening CT.
if (process.argv.includes('--plan')) {
  fs.mkdirSync(RELEASES, { recursive: true })
  fs.writeFileSync(path.join(RELEASES, 'package-plan.json'), JSON.stringify({ planOnly: true, source: HERE, run: scratch.run, temp: scratch.temp, artifacts: scratch.artifacts, outputs: { dest, folder }, config }, null, 2), { flag: 'wx' })
  console.log(`Package routing plan only: ${path.join(RELEASES, 'package-plan.json')}`)
  process.exit(0)
}
const runtimeFiles = bridgeRuntimeFiles(BRIDGE)
for (const p of [builder, path.join(dist, 'electron.exe'), path.join(BRIDGE, 'node_modules', 'loupedeck', 'package.json'), path.join(BRIDGE, 'node_modules', 'serialport', 'package.json')])
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}. Run npm ci, npm run setup:electron, then npm run setup:bridge in this checkout.`)
for (const [name, expected] of Object.entries(JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).devDependencies)) {
  const actual = JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules', name, 'package.json'), 'utf8')).version
  if (actual !== expected) throw new Error(`${name}: installed ${actual}, expected ${expected}; run npm ci`)
}
// Load the native dependencies with the exact Electron shipped, without importing
// bridge/host/router startup code, enumerating ports, or claiming a device.
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
execFileSync(path.join(dist, 'electron.exe'), ['--input-type=module', '-e', "await import('serialport'); await import('loupedeck'); console.log('CT dependency imports OK')"], { cwd: BRIDGE, env, stdio: 'pipe', windowsHide: true })
console.log('Local builder, Electron and versioned bridge dependencies are ready (native imports only; no CT opened).')
if (process.argv.includes('--check')) process.exit(0)

if (fs.existsSync(ct)) throw new Error(`Staging directory already exists: ${ct}. Inspect it before retrying.`)
const git = a => { try { return execFileSync('git', a, { cwd: HERE, encoding: 'utf8', windowsHide: true }).trim() } catch { return '' } }
const commit = (git(['rev-parse', '--short', 'HEAD']) || 'unknown') + (git(['status', '--porcelain', '--', 'router.mjs', 'host', 'ui', 'electron', 'integrations', 'scripts', 'package.json', 'package-lock.json', 'config']) ? '*' : '')
fs.mkdirSync(info, { recursive: true })
fs.writeFileSync(path.join(info, 'build-info.json'), JSON.stringify({ commit, built: new Date().toISOString() }) + '\n', { flag: 'wx' })
fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { flag: 'wx' })
fs.mkdirSync(ct, { recursive: true })
for (const f of runtimeFiles) fs.copyFileSync(path.join(BRIDGE, f), path.join(ct, f))
checkBridgeDisplay(ct, path.join(dist, 'electron.exe'), env)
if (fs.existsSync(path.join(BRIDGE, 'td'))) fs.cpSync(path.join(BRIDGE, 'td'), path.join(ct, 'td'), { recursive: true })
// electron-builder excludes node_modules in extraResources; main restores its name.
// Materialize the worktree dependency junction; managed scratch must contain plain files.
fs.cpSync(path.join(BRIDGE, 'node_modules'), path.join(ct, 'modules'), { recursive: true, dereference: true })
console.log(`waxyct ${version} (${commit}): building into ${out}`)
const r = spawnSync(process.execPath, [builder, '--win', ...(unpackedOnly ? ['--dir'] : ['portable']), '--projectDir', HERE, '--config', configFile], { stdio: 'inherit', cwd: HERE, windowsHide: true })
if (r.status !== 0) throw new Error(`electron-builder failed (${r.status}): ${r.error?.message || ''}`)
fs.mkdirSync(RELEASES, { recursive: true })
// Retain exclusive creation guarantees, including a concurrent publisher. No
// directory rename may merge into or replace an existing versioned runtime.
if (!unpackedOnly) fs.copyFileSync(path.join(out, `waxyct-${version}.exe`), dest, fs.constants.COPYFILE_EXCL)
fs.cpSync(path.join(out, 'win-unpacked'), folder, { recursive: true, errorOnExist: true, force: false })
console.log(`wrote ${unpackedOnly ? '' : dest + ' and '}${path.join(folder, 'waxyct.exe')}`)
