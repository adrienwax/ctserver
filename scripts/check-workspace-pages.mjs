import assert from 'node:assert/strict'
import fs from 'node:fs'
import { workspacePage, pageWorkspace } from '../host/workspace-pages.mjs'
import { pageOf } from '../host/schema.mjs'
import { makeRigProfile } from './make-rig-profile.mjs'
import { createMoshpitClient } from '../host/moshpit-client.mjs'
import { startMockMoshpit } from './mock-moshpit.mjs'
import { guardAppInput } from '../host/focus-guard.mjs'

for (const mode of ['front', 'focus', 'refused', 'drift', 'context', 'closed']) {
  let frontCalls = 0, focused = 0, current = true
  const failures = []
  const win = {
    front: async () => { frontCalls++; if(mode === 'context') current = false; return mode === 'front' || (frontCalls > 1 && mode !== 'drift') ? 'moshpit 3' : 'other' },
    running: async () => mode !== 'closed',
    focus: async () => { focused++; return mode === 'refused' ? 'refused' : 'ok' },
  }
  assert.equal(await guardAppInput(win, 'Moshpit 3.exe', () => current, m => failures.push(m)), ['front', 'focus'].includes(mode), `Save focus guard: ${mode}`)
  if(mode === 'context') assert.equal(focused, 0, 'changed page does not focus an app or send its shortcut')
}

const profile = JSON.parse(fs.readFileSync(new URL('../config/profiles/moshpit.json', import.meta.url)))
const original = JSON.stringify(profile)
assert.deepEqual(profile.pages.map(p => p.name), ['IN', 'MOSH FX', 'MOSH EDIT', 'OUT'])
assert.equal(profile.stripGestures, false, 'side strips are display-only; mappings belong to physical knobs')
for (let i = 0; i < profile.pages.length; i++) {
  const buttons = pageOf(profile, i).buttons
  assert.deepEqual(['a','b','c','d'].map(b => buttons[b].do.moshpit.command), ['transport.play','transport.stop','transport.prevFrame','transport.nextFrame'], 'confirmed physical transport order is unchanged')
}
for (const [workspace, index] of [['home', null], ['browse', 0], ['mosh', 1], ['node', 2], ['render', 3]]) assert.equal(workspacePage(profile, workspace), index)
assert.equal(workspacePage(profile, 'settings', 2), null, 'unsupported workspace leaves the CT alone')
assert.equal(workspacePage({...profile, followWorkspace: false}, 'browse'), null)
assert.equal(workspacePage({...profile, followWorkspace: undefined}, 'browse'), null, 'old owner profile does not opt in silently')
const custom = {...profile, pages: [...profile.pages, {name: 'MY FX', enter: {moshpit: {verb: 'command', command: 'workspace.mosh'}}, keys: {}}]}
assert.equal(workspacePage(custom, 'mosh', 4), 4, 'same-workspace subpage stays selected')
assert.equal(workspacePage(custom, 'mosh', 0, {mosh: 4}), 4, 'return restores the owner subpage')
assert.equal(workspacePage(custom, 'mosh', 0, {mosh: 99}), 1, 'removed remembered page falls back safely')
assert.equal(workspacePage({...profile, pages: profile.pages.filter(p => pageWorkspace(p) !== 'node')}, 'node'), 1, 'Graph may use a single MOSH page')
for (const i of [0, 3]) assert.ok(!JSON.stringify(pageOf(profile, i)).match(/block\.(?:prev|next|freeze|unfreeze)/), 'no hidden block controls in IN or OUT')
const input = pageOf(profile, 0)
assert.deepEqual(['TL','CL','BL','TR','CR','BR'].map(id => input.dials[id].name), ['IN','OUT','TRANSPOSE','CLIP','FOLDER','ZOOM'])
assert.equal(input.dials.BR.press.moshpit.command, 'source.zoomFit')
assert.equal(input.keys[8].do.moshpit.command, 'mark.in')
assert.equal(input.keys[9].do.moshpit.command, 'mark.out')
assert.equal(input.keys[10].do.moshpit.command, 'source.sendA')
assert.equal(input.keys[11].do.moshpit.command, 'source.sendB')
for (let i = 0; i < profile.pages.length; i++) assert.equal(pageOf(profile, i).buttons.save.do.keys, 'ctrl+s', 'physical Save saves the project on every page')
assert.equal(pageOf(profile, 3).keys[11].do.moshpit.command, 'render.start')
assert.equal(JSON.stringify(profile), original, 'following never edits the owner mapping')
const spec = JSON.parse(fs.readFileSync(new URL('../config/rigs/moshpit.json', import.meta.url)))
const overlap = structuredClone(spec); overlap.workspaces[1].keys[2] = 'mark.in'
assert.throws(() => makeRigProfile(overlap), /overlapping/)
const owner = structuredClone(spec); owner.workspaces[0].keys[1] = {label: 'MY ACTION', icon: 'source', do: {none: true}}
assert.equal(makeRigProfile(owner).pages[0].keys[1].label, 'MY ACTION', 'individual owner controls are accepted without editing generator')

const until = async f => { const end = Date.now()+5000; while(!f()) { if(Date.now()>end) throw new Error('workspace feedback timed out'); await new Promise(r => setTimeout(r, 10)) } }
for (const initial of ['browse', null]) {
  const mock = await startMockMoshpit({port: 0, workspace: initial})
  const client = createMoshpitClient({endpointFile: mock.endpointFile})
  try {
    let changes = 0
    client.onChange(why => { if(why === 'workspace') changes++ })
    client.start(); await until(() => client.connected())
    assert.equal(client.state().workspace, initial)
    if (initial) {
      const generation = client.state().generation
      mock.workspaceFromApp('render'); await until(() => client.state().workspace === 'render')
      mock.workspaceFromApp('render'); mock.workspaceFromApp('invalid')
      await new Promise(r => setTimeout(r, 30))
      assert.equal(changes, 1); assert.equal(client.state().workspace, 'render')
      assert.equal(client.state().generation, generation)
      assert.deepEqual(mock.commandsSeen, [], 'reading workspace feedback never echoes commands')
      await client.discover(); assert.equal(client.state().workspace, 'render')
    }
  } finally { client.stop(); await mock.close() }
}
console.log('workspace pages ok: contextual defaults, owner overrides, subpages, opt-in, optional v1 feedback and no command echo')
