// The Moshpit adapter against Moshpit's own control server: moshpit-v3's engine/src/control (hub, server,
// discovery, params) bundled from source with moshpit-v3's own esbuild, on a project of real node definitions,
// with a host shaped like moshpit-v3's engine/test/control.test.ts. No Moshpit window, no CT, no TD.
//   node scripts/check-moshpit-real.mjs [moshpit-v3 dir]      skipped (not failed) when the repo is not here
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createMoshpitClient, ctResolve, ctSide, BANKS } from '../host/moshpit-client.mjs'
import { pageOf, MOSHPIT_PENDING } from '../host/schema.mjs'
const cmdOf = (q) => q.verb === 'command' ? [q.command] : q.verb === 'step' ? q.commands : []


const root = path.resolve(process.argv[2] || process.env.WAXYCT_MOSHPIT_SRC || fileURLToPath(new URL('../../moshpit-v3/', import.meta.url)))
const esbuildMain = path.join(root, 'node_modules/esbuild/lib/main.js')
if (!fs.existsSync(path.join(root, 'engine/src/control/server.ts')) || !fs.existsSync(esbuildMain)) { console.log(`skipped: no Moshpit v3 control server or esbuild at ${root}`); process.exit(0) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waxyct-real-moshpit-'))
const endpointFile = path.join(tmp, 'control-endpoint.json')
// The server side, in Moshpit's own code. Driven over stdin: bump (the graph changed), stale (moved on silently), set (an edit made in Moshpit)
const entry = `
import * as readline from 'node:readline';
import { startControlServer } from './src/control/server';
import { applyControlWrite } from './src/control/params';
import { defForTarget } from './src/control/discovery';
import { BYPASS_KEY } from './src/control/discovery';
import { newBlock, newProject, withChain } from './src/project/build';
const doc = newProject('waxyct check');
doc.timeline.blocks = [withChain(newBlock('picture', 'S', 0, 90), [{ kind: 'fx.plane-desync' }, { kind: 'fx.feedback' }])];
const state = { generation: 1, commands: [], commits: 0 };
const host = {
  snapshot: () => ({ doc, generation: state.generation }),
  commit: (p, v) => {
    state.commits++;
    const m = /\\/node\\/([^/]+)\\/param\\/([^/]+)$/.exec(p);
    const n = doc.timeline.blocks[0].graph.nodes.find((x) => x.id === m?.[1]);
    if (n && m[2] === BYPASS_KEY) n.bypass = !!v; else if (n) n.params[m[2]] = v;
    const l = /^\\/lfo\\/([^/]+)\\/(period|phase)$/.exec(p);
    if (l) { const lfo = doc.modulators.lfos.find((x) => x.id === l[1]); lfo[l[2]] = v; }
  },
  write: async (w) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    const r = defForTarget(doc, w.target, state.generation);
    const value = applyControlWrite({ target: w.target, generation: state.generation }, r?.def, r?.value, w);
    host.commit(w.target, value);
    return { value, generation: state.generation, revision: state.commits };
  },
  command: (command, options) => { state.commands.push({ command, ...options }); },
  // as the app does (M1): the inspector's selection is the doc's view, then the hub pushes it
  select: (id) => { const b = doc.timeline.blocks[0]; doc.view = doc.view || {}; doc.view.perBlock = doc.view.perBlock || {}; doc.view.perBlock[b.id] = { ...(doc.view.perBlock[b.id] || {}), selected: [id] }; queueMicrotask(() => srv.hub.selectionChanged()); },
};
const srv = await startControlServer(host, { endpointFile: process.argv[2], port: 0, throttleMs: 50 });
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ ready: true, port: srv.port });
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const c = JSON.parse(line);
  if (c.cmd === 'bump') { state.generation++; srv.hub.structureChanged(); }
  if (c.cmd === 'stale') state.generation++;
  if (c.cmd === 'set') { host.commit(c.path, c.value); srv.hub.changed(c.path, c.value); }
  if (c.cmd === 'state') say({ state: { commands: state.commands, commits: state.commits, generation: state.generation } });
  if (c.cmd === 'quit') srv.close().then(() => process.exit(0));
});
`
const { build } = await import(pathToFileURL(esbuildMain).href)
await build({ stdin: { contents: entry, resolveDir: path.join(root, 'engine'), loader: 'ts', sourcefile: 'waxyct-real-server.ts' }, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  alias: { '@moshpit/core': path.join(root, 'core/src/index.ts'), '@moshpit/engine': path.join(root, 'engine/src/index.ts') },
  outfile: path.join(tmp, 'real-server.mjs'), external: ['bufferutil', 'utf-8-validate'], logLevel: 'silent',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } })

const child = spawn(process.execPath, [path.join(tmp, 'real-server.mjs'), endpointFile], { stdio: ['pipe', 'pipe', 'inherit'] })
const lines = []
let buf = ''
child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1) } })
const until = async (f, ms = 5000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 20)) } }
const tell = (o) => child.stdin.write(JSON.stringify(o) + '\n')
const ask = async () => { const n = lines.length; tell({ cmd: 'state' }); await until(() => lines.length > n && lines.at(-1).state); return lines.at(-1).state }

const rows = [], ok = (w) => rows.push(`ok   ${w}`)
const m = createMoshpitClient({ endpointFile })
try {
  await until(() => lines.some((l) => l.ready))
  m.start()
  await until(() => m.connected())
  const st = m.state()
  ok(`Moshpit's own server (bundled from ${path.basename(root)} source): handshake with the endpoint-file token, caps ${st.caps.join(', ')}`)
  assert.deepEqual(st.slots.map((s) => s.name), ['Plane desync', 'Feedback loop'])
  assert.equal(st.slots[0].params.at(-1).split('/').pop(), 'bypass', 'bypass is listed last in its slot')
  const lfos = [...st.targets.keys()].filter((p) => p.startsWith('/lfo/'))
  ok(`discovery: ${st.targets.size} targets, slots ${st.slots.map((s) => `"${s.name}"`).join(' and ')}, bypass last in each slot, ${lfos.length / 2} project LFO(s) after the nodes`)

  const p1 = { verb: 'knob', slot: 1, param: 1 }, path1 = m.resolve(p1), def1 = st.targets.get(path1).param
  const before = st.values.get(path1)
  const a = await m.act(p1, 3)
  assert.equal(a.generation, 1, 'asynchronous authoritative ACK generation is accepted')
  assert.equal(a.revision, 1, 'ACK is sent after host commit')
  assert.equal(a.value, Math.min(def1.max, before + 3 * def1.step), `3 detents x step ${def1.step}`)
  ok(`dial: slot 1 param 1 (${def1.label}) ${before} -> ${a.value}, Moshpit applying its step of ${def1.step}`)
  const f = await m.act(p1, 5, 'fine')
  assert.equal(f.value, Number((a.value + 5 * def1.step * 0.1).toFixed(6)))
  ok(`fine mode: 5 detents x ${def1.step} x 0.1 -> ${f.value}`)
  assert.equal(m.label(p1), def1.label)
  const r = await m.act({ verb: 'reset', slot: 1, param: 1 })
  assert.equal(r.value, def1.default)
  ok(`reset: back to the default ${def1.default}; the CT names the dial "${m.label(p1).toUpperCase()}" from Moshpit`)

  await m.act({ verb: 'toggle', slot: 2, param: 'bypass' })
  await until(() => m.on({ slot: 2, param: 'bypass' }))
  ok('toggle: Feedback loop bypass on, written with neither delta nor value, and pushed back lit')

  if (lfos.length) {
    const lp = { verb: 'knob', lfo: 1, field: 'period' }, l0 = st.values.get(m.resolve(lp))
    const l1 = await m.act(lp, 2)
    assert.notEqual(l1.value, l0)
    ok(`an LFO by position: LFO 1 period ${l0} -> ${l1.value}`)
  }
  const c = await m.act({ verb: 'step', commands: ['transport.prevFrame', 'transport.nextFrame'] }, 40)
  assert.equal(c.repeat, 10)
  await m.act({ verb: 'command', command: 'block.next' })
  const s1 = await ask()
  assert.deepEqual(s1.commands.filter((x) => x.command === 'transport.nextFrame'), [{command:'transport.nextFrame',mode:'normal',repeat:10}])
  assert.equal(s1.commands.at(-1).command, 'block.next')
  await m.act({ verb:'step',commands:['transport.prevFrame','transport.nextFrame'] },-3,'coarse')
  const modified = await ask()
  assert.deepEqual(modified.commands.at(-1), {command:'transport.prevFrame',mode:'coarse',repeat:3})
  ok('commands: capped ten-detent spin and three fast reverse detents dispatch atomically with captured mode; normal block.next')

  const path2 = m.resolve({ slot: 1, param: 2 }), d2 = st.targets.get(path2).param
  tell({ cmd: 'set', path: path2, value: d2.max })
  await until(() => m.norm({ slot: 1, param: 2 }) === 1)
  ok(`feedback: an edit made in Moshpit (${d2.label} to its max) reaches the CT through the throttle`)

  tell({ cmd: 'bump' })
  await until(() => m.state().generation === 2)
  await m.act(p1, 1)
  ok('the graph changed: targets-changed, re-discovered at generation 2, the next write landed')
  tell({ cmd: 'stale' })
  await new Promise((r) => setTimeout(r, 100))
  await assert.rejects(m.act(p1, 1), (e) => e.code === 'CONTROL_STALE_TARGET')
  await m.act(p1, 1)
  ok('a stale write: Moshpit refused it (CONTROL_STALE_TARGET), the CT re-read, the retry landed')

  const prof = JSON.parse(fs.readFileSync(new URL('../config/profiles/moshpit.json', import.meta.url), 'utf8'))
  const acts = (x) => (x && x.macro ? x.macro.map((y) => y.moshpit) : x && x.moshpit ? [x.moshpit] : []).filter(Boolean)
  let sent = 0, absent = 0, pending = 0
  for (let i = 0; i < prof.pages.length; i++) {
    const g = pageOf(prof, i)
    const all = [...acts(g.enter).map((x) => [x, 0]), ...Object.values(g.keys || {}).flatMap((k) => acts(k.do).map((x) => [x, 0])), ...Object.values(g.dials || {}).flatMap((d) => [...acts(d.turn).map((x) => [x, 1]), ...acts(d.press).map((x) => [x, 0])]),
      ...acts(g.wheel && g.wheel.turn).map((x) => [x, -1]), ...acts(g.wheel && g.wheel.tap).map((x) => [x, 0]), ...Object.values(g.buttons || {}).flatMap((b) => [...acts(b.do), ...acts(b.hold)].map((x) => [x, 0]))]
    // as the deck: select, selstep and bank are the CT's own cursors; "sel" is slot 1, and a bank dial is tried in every bank
    for (const [x0, d] of all.flatMap(([q, d]) => ctSide(q) ? [] : q.bank ? BANKS.map((_, b) => [ctResolve(q, 1, b), d]).filter(([r]) => r) : [[ctResolve(q, 1, 0), d]])) {
      const x = x0
      try { await m.act(x, d); sent++ } catch (e) { if (e.code === 'PARAM_UNKNOWN' && cmdOf(x).some((c) => MOSHPIT_PENDING.includes(c))) pending++; else if (e.code === 'PARAM_UNKNOWN' && (x.slot > m.state().slots.length || x.param > m.state().slots[x.slot - 1].params.filter((q) => !q.endsWith('/bypass')).length)) absent++; else throw new Error(`${g.name}: ${JSON.stringify(x)}: ${e.message}`) }
    }
  }
  ok(`the moshpit profile against Moshpit's own server: ${sent} actions taken; ${absent} aimed at an empty slot or a param the node lacks${pending ? `; ${pending} PENDING (commands Moshpit does not have yet)` : ''}`)
  // M1, when this Moshpit offers it: select through the CT, read it back from Moshpit's next targets
  if (m.syncs()) {
    const s2 = m.state().slots[1] || m.state().slots[0]
    let pushed = null
    const off = m.onChange((why, st) => { if (why === 'selection') pushed = st.selected })
    m.state().selected = null
    assert.equal(await m.select(s2.nodeId), true)
    const t0 = Date.now(); while (pushed !== s2.nodeId && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20))
    off()
    assert.equal(pushed, s2.nodeId, "Moshpit pushed the CT's selection back")
    await m.discover()
    assert.equal(m.state().selected, s2.nodeId, "Moshpit's targets carry the CT's selection")
    assert.equal(m.selectedSlot(), s2.index)
    ok(`selection sync: the CT selected "${s2.name}" (slot ${s2.index}); Moshpit's push and its next targets both say ${m.state().selected}`)
  } else ok('selection sync: PENDING (this Moshpit does not offer the "selection" cap; the CT keeps its own selection)')
  await m.act({ verb: 'reset', slot: 1, param: 1 })
  const burstBefore = m.state().values.get(m.resolve(p1))
  const burst = await Promise.all([m.act(p1, 2), m.act(p1, 3)])
  assert.equal(burst[1].value, Number(Math.min(def1.max, burstBefore + 5 * def1.step).toFixed(6)))
  assert.equal(burst[1].revision, burst[0].revision + 1)
  ok('asynchronous authoritative ACKs: parallel relative writes accumulate and carry sequential committed revisions')
} finally {
  m.stop()
  tell({ cmd: 'quit' })
  await new Promise((r) => { child.once('exit', r); setTimeout(r, 2000) })
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(rows.join('\n'))
}
console.log(`moshpit adapter ok against Moshpit's own control server: ${rows.length} checks`)
