// Is waxyct still speaking Moshpit v3's contract? Reads the source of truth in the Moshpit repo and compares:
//   core/src/control.ts                COMMANDS == MOSHPIT_COMMANDS; targetPath() forms accepted by MOSHPIT_PATH
//   engine/src/control/params.ts       the ControlWrite fields host/moshpit-client.mjs sends; the stale code
//   engine/src/control/hub.ts          PROTOCOL, VERSION, MAX_REPEAT == the client's
//   engine/src/control/discovery.ts    BYPASS_KEY == the moshpit rig spec's bypass key
//   engine/src/control/server.ts       DEFAULT_PORT 6193, PATH /control, the endpoint file fields the client reads
//   app/electron/main.ts               the app name == the folder in config/apps.json's endpointFile
//   CONTROL-PROTOCOL.md                exists; every error code it lists is one the client handles by name or generically
//   node scripts/check-moshpit-contract.mjs [moshpit-v3 dir]      skipped (not failed) when the repo is not on this machine
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { MOSHPIT_COMMANDS, MOSHPIT_PATH, MOSHPIT_PENDING } from '../host/schema.mjs'
import { PROTOCOL, VERSION, MAX_REPEAT } from '../host/moshpit-client.mjs'

const strict = process.argv.includes('--strict')   // the deploy gate: a pending command is a problem
const root = process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.WAXYCT_MOSHPIT_SRC || fileURLToPath(new URL('../../moshpit-v3/', import.meta.url))
const read = (f) => { const p = path.join(root, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }
const ctl = read('core/src/control.ts') ?? read('engine/src/model/control.ts')
if (!ctl) { console.log(`skipped: no Moshpit v3 at ${root}`); process.exit(0) }
const problems = [], bad = (p) => problems.push(p)
const here = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

const block = (ctl.match(/export const COMMANDS = \[([\s\S]*?)\] as const/) || [])[1] || ''
const theirs = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
if (!theirs.length) bad('could not read COMMANDS')
const missing = theirs.filter((c) => !MOSHPIT_COMMANDS.includes(c)), extra = MOSHPIT_COMMANDS.filter((c) => !theirs.includes(c))
if (missing.length) bad(`Moshpit has commands waxyct does not: ${missing.join(', ')}`)
const pending = extra.filter((c) => MOSHPIT_PENDING.includes(c)), dropped = extra.filter((c) => !MOSHPIT_PENDING.includes(c))
if (dropped.length) bad(`waxyct lists commands Moshpit dropped: ${dropped.join(', ')}`)
if (pending.length && strict) bad(`waxyct uses commands Moshpit does not have yet: ${pending.join(', ')}`)
const landed = MOSHPIT_PENDING.filter((c) => theirs.includes(c))
if (landed.length) bad(`Moshpit now has ${landed.join(', ')}: take them out of MOSHPIT_PENDING`)
for (const sample of ['/block/b1/node/n1/param/amount', '/lfo/l1/period', '/lfo/l1/phase']) if (!MOSHPIT_PATH.test(sample)) bad(`MOSHPIT_PATH refuses ${sample}`)
if (!/`\/block\/\$\{t\.blockId\}\/node\/\$\{t\.nodeId\}\/param\/\$\{t\.param\}`/.test(ctl)) bad('targetPath() changed its node form: check MOSHPIT_PATH')
if (!/`\/lfo\/\$\{t\.lfoId\}\/\$\{t\.field\}`/.test(ctl) || !/field: 'period' \| 'phase'/.test(ctl)) bad('targetPath() changed its LFO form')

const prm = read('engine/src/control/params.ts')
if (prm) {
  const w = (prm.match(/export interface ControlWrite \{([\s\S]*?)\n\}/) || [])[1] || ''
  for (const f of ['target', 'generation', 'delta', 'value', 'mode', 'source']) if (!new RegExp(`\\b${f}\\??:`).test(w)) bad(`ControlWrite has no "${f}" any more`)
  if (!/'ct'/.test(w)) bad("ControlWrite's source no longer allows 'ct'")
  if (!/CONTROL_STALE_TARGET/.test(prm)) bad('the stale-target error code changed')
} else bad('engine/src/control/params.ts is missing')

const hub = read('engine/src/control/hub.ts'), disc = read('engine/src/control/discovery.ts'), srv = read('engine/src/control/server.ts'), main = read('app/electron/main.ts')
const constOf = (src, name) => ((src || '').match(new RegExp(`export const ${name} = ([^;]+);`)) || [])[1]
if (hub) {
  if (constOf(hub, 'PROTOCOL') !== `'${PROTOCOL}'`) bad(`hub PROTOCOL is ${constOf(hub, 'PROTOCOL')}; the client says '${PROTOCOL}'`)
  if (Number(constOf(hub, 'VERSION')) !== VERSION) bad(`hub VERSION is ${constOf(hub, 'VERSION')}; the client says ${VERSION}`)
  if (Number(constOf(hub, 'MAX_REPEAT')) !== MAX_REPEAT) bad(`hub MAX_REPEAT is ${constOf(hub, 'MAX_REPEAT')}; the client caps at ${MAX_REPEAT}`)
} else bad('engine/src/control/hub.ts is missing')
const spec = JSON.parse(here('config/rigs/moshpit.json'))
if (disc && constOf(disc, 'BYPASS_KEY') !== `'${spec.bypass}'`) bad(`Moshpit's BYPASS_KEY is ${constOf(disc, 'BYPASS_KEY')}; config/rigs/moshpit.json says '${spec.bypass}'`)
if (srv) {
  if (Number(constOf(srv, 'DEFAULT_PORT')) !== 6193) bad(`DEFAULT_PORT is ${constOf(srv, 'DEFAULT_PORT')}`)
  if (constOf(srv, 'PATH') !== "'/control'") bad(`PATH is ${constOf(srv, 'PATH')}`)
  for (const f of ['port', 'path', 'token', 'protocol']) if (!new RegExp(`\\b${f}\\b`).test((srv.match(/JSON\.stringify\(\{([^}]*)\}\)/) || [])[1] || '')) bad(`the endpoint file no longer has "${f}"`)
}
const apps = JSON.parse(here('config/apps.json'))
const appName = ((main || '').match(/app\.setName\('([^']+)'\)/) || [])[1]
if (appName && !(apps.moshpit && apps.moshpit.endpointFile || '').includes(`/${appName}/`)) bad(`Moshpit's userData folder is "${appName}"; apps.json's endpointFile is ${apps.moshpit && apps.moshpit.endpointFile}`)

const doc = read('CONTROL-PROTOCOL.md')
if (doc) {
  const codes = [...((doc.split('## Errors')[1] || '').split('\n## ')[0].matchAll(/^\| `([A-Z_]+)` \|/gm))].map((m) => m[1])
  const client = here('host/moshpit-client.mjs')
  // every listed code reaches the CT as an error with its code; these three change what the client does
  for (const c of ['PROTOCOL_VERSION', 'CONTROL_STALE_TARGET']) if (codes.includes(c) && !client.includes(c)) bad(`the client does not act on ${c}`)
  if (!codes.length) bad('could not read the error codes from CONTROL-PROTOCOL.md')
  if (!/control-endpoint\.json/.test(doc) || !(apps.moshpit && /control-endpoint\.json$/.test(apps.moshpit.endpointFile || ''))) bad('the endpoint file name differs between CONTROL-PROTOCOL.md and apps.json')
  if (!/\*\*`bypass`\*\*/.test(doc)) bad('CONTROL-PROTOCOL.md no longer names the bypass key `bypass`')
}
for (const p of problems) console.log('CONTRACT', p)
if (pending.length && !strict) console.log(`PENDING  ${pending.length} commands waxyct uses, not yet in Moshpit: ${pending.join(', ')}`)
console.log(problems.length ? `${problems.length} contract problems` : `contract ok against ${doc ? 'CONTROL-PROTOCOL.md v1 and ' : ''}moshpit-v3 source: ${theirs.length} commands, both path forms, ControlWrite, ${PROTOCOL} v${VERSION}, repeat cap ${MAX_REPEAT}, bypass key, port 6193 /control, endpoint file and app folder`)
process.exitCode = problems.length ? 1 : 0
