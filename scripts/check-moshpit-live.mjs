// The adapter against a RUNNING Moshpit (not in npm test: it needs Moshpit open, and it sends commands to it).
//   node scripts/check-moshpit-live.mjs [path to control-endpoint.json]
// Handshake and caps, discovery (slots, selected), every command waxyct's profile uses that is not transport or
// workspace (those change what Moshpit shows), a select (refused on an empty project), and the link still up.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createMoshpitClient } from '../host/moshpit-client.mjs'
import { MOSHPIT_COMMANDS } from '../host/schema.mjs'

const file = process.argv[2] || `${process.env.APPDATA}/Moshpit 3/control-endpoint.json`
const rows = [], ok = (t) => rows.push(`ok   ${t}`)
const until = async (f, ms = 5000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 20)) } }
const e = JSON.parse(fs.readFileSync(file, 'utf8'))
const m = createMoshpitClient({ endpointFile: file })
try {
  m.start()
  await until(() => m.connected())
  const st = m.state()
  ok(`handshake: ${e.protocol} on port ${e.port}${e.path}, project "${st.project && st.project.name}"; caps ${st.caps.join(' ')}`)
  assert.ok(m.syncs(), 'Moshpit offers select and selection')
  ok(`discovery: generation ${st.generation}, ${st.slots.length} slots, ${st.targets.size} targets, selected ${JSON.stringify(st.selected)}, ${st.commands.length} commands`)
  const missing = MOSHPIT_COMMANDS.filter((c) => !st.commands.includes(c))
  assert.deepEqual(missing, [], 'Moshpit lists every command waxyct uses')
  ok(`every one of waxyct's ${MOSHPIT_COMMANDS.length} commands is in Moshpit's list`)
  const sent = []
  for (const c of ['clip.prev', 'clip.next', 'mark.in.nudgeBack', 'mark.in.nudgeForward', 'mark.out.nudgeBack', 'mark.out.nudgeForward', 'mark.in', 'mark.out', 'render.start']) {
    const r = await m.act({ verb: 'command', command: c })
    assert.equal(r.type, 'ack'); sent.push(`${c} x${r.repeat}`)
  }
  ok(`commands acked: ${sent.join(', ')}`)
  const r = await m.act({ verb: 'step', commands: ['mark.in.nudgeBack', 'mark.in.nudgeForward'] }, 3)
  ok(`a 3-detent IN dial turn: one message, Moshpit ran it ${r.repeat} times`)
  const first = st.slots[0]
  if (first) {
    assert.equal(await m.select(first.nodeId), true)
    await until(() => m.state().selected === first.nodeId)
    ok(`select: the CT selected "${first.name}"; Moshpit's selection push says ${m.state().selected}`)
  } else {
    await assert.rejects(m.select('no-such-node'), (x) => x.code === 'CONTROL_STALE_TARGET')
    ok('select on an empty project: refused CONTROL_STALE_TARGET, the client re-read the targets')
  }
  await new Promise((res) => setTimeout(res, 500))
  assert.ok(m.connected(), 'the link is still up')
  ok(`still connected after every message (phase ${m.state().phase})`)
} finally {
  m.stop()
  console.log(rows.join('\n'))
}
console.log(`moshpit live ok: ${rows.length} checks against the running Moshpit`)
