import assert from 'node:assert/strict'
import {keyScene,dialLabelLines,KEY_STATE_LAYOUT as L} from '../ui/control-key-layout.mjs'
import {keyView} from '../ui/control-feedback-view.mjs'
const control={label:'TEST',do:{none:true}}, before=JSON.stringify(control)
const scene=keyScene(null,{label:'TEST',control})
assert.equal(scene.label,'TEST','saved identity must remain visible without an assigned action')
assert.equal(scene.state,'unavailable');assert(scene.strokes.some(p=>p.role==='unavailable'))
assert.equal(keyScene(null,{available:false,label:'MUTE'}).label,'MUTE')
assert.equal(keyScene(null,{available:false}).label,'UNAVAIL.')
assert.deepEqual(keyView(null,{label:'TEST',control}).scene,scene)
assert.match(keyView(null,{label:'TEST',control}).description,/unavailable/i)
assert.equal(JSON.stringify(control),before)
assert(L.dialTitle.cap<9,'smaller shared dial title')
for(const label of ['IN','OUT','TRANSPOSE','FREQUENCY','FILTER CUTOFF','VERY LONG OWNER LABEL']){
 const rows=dialLabelLines(label);assert(rows.length<=2)
 for(const row of rows)for(const line of row.lines)for(const [x,y] of line){assert(x>=3&&x<=57,label);assert(y>=6&&y<=36,label)}
}
assert.equal(dialLabelLines('TRANSPOSE').map(p=>p.text).join(' '),'TRANSPOSE')
assert.equal(dialLabelLines('FILTER CUTOFF').map(p=>p.text).join(' '),'FILTER CUTOFF')
console.log('PASS configured unavailable tile identity and smaller bounded shared dial labels; no config/OS/device changes')
