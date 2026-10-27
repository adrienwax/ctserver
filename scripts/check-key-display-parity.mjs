// Pure renderer checks plus review artifacts. No router/device/TD/application launch.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {KEY_STATE_LAYOUT as L,keyScene,keyDisplayLabel,dialLabelLines} from '../ui/control-key-layout.mjs'
import {textLines,textWidth,fitLabel,displayText} from '../ui/control-font.mjs'
import {keyView} from '../ui/control-feedback-view.mjs'
import {pageOf} from '../host/schema.mjs'
import {renderFeedbackKeys} from '../host/feedback-renderer.mjs'
import * as D from '../integrations/ct-td-control/ct-draw.mjs'
const confirmed=(enabled,kind='toggle',selected=null)=>({kind,state:'confirmed',enabled,selected})
const bypass={label:'ON / OFF',icon:'effect',do:{moshpit:{verb:'toggle',slot:'sel',param:'bypass'}}}
const defaults={label:'DEFAULTS',icon:'reset',do:{td:{type:'rigPulse',par:'Defaultsmear'}}}
assert.equal(keyDisplayLabel(bypass.label,bypass),'BYPASS')
assert.equal(keyDisplayLabel('LIVE NODE NAME',bypass),'BYPASS')
assert.equal(keyDisplayLabel(defaults.label,defaults),'PARAM RESET')
assert.equal(keyDisplayLabel('OWNER NAME',{...defaults,label:'OWNER NAME'}),'OWNER NAME')
assert.equal(keyDisplayLabel('DEFAULTS',{do:{td:{type:'recordToggle'}}}),'DEFAULTS')
const fixtures=[
 {name:'bypass-on',control:bypass,label:bypass.label,glyph:'effect',feedback:confirmed(true)},
 {name:'enable-off',control:{label:'ENABLE'},label:'ENABLE',glyph:'effect',feedback:confirmed(false)},
 {name:'unknown',label:'ENABLE',glyph:'effect',feedback:{kind:'toggle',state:'stale',enabled:true}},
 {name:'unavailable',control:{do:{none:true}},label:'EMPTY',glyph:'effect',feedback:confirmed(false)},
 {name:'selected-off',label:'SMEAR',glyph:'bloom',feedback:confirmed(false,'selection',true)},
 {name:'selected-only',label:'SMEAR',glyph:'bloom',feedback:confirmed(null,'selection',true)},
 {name:'param-reset',control:defaults,label:defaults.label,glyph:'reset',feedback:{kind:'momentary'}},
 {name:'long-toggle',label:'SOURCE POWER',glyph:'effect',feedback:confirmed(true)},
 {name:'long-label',label:'VERY LONG OWNER LABEL',glyph:'node',feedback:{kind:'plain'}},
]
const scenes=fixtures.map(f=>keyScene(f.feedback,{...f,iconLines:D.currentGlyphLines(f.glyph)}))
assert.equal(scenes[0].state,'on');assert.equal(scenes[1].state,'off');assert.equal(scenes[2].state,'unknown');assert.equal(scenes[3].state,'unavailable')
assert.equal(scenes[2].strokes.find(s=>s.role==='state').text,'-')
assert.equal(scenes[4].rects[0].color,L.border.off.color);assert(scenes[4].strokes.some(s=>s.role==='selection'))
assert(!scenes[5].strokes.some(s=>s.role==='state'));assert(scenes[5].strokes.some(s=>s.role==='glyph'))
assert.deepEqual(scenes[6].labelLines,['PARAM','RESET'])
assert.equal(L.state.y,L.state.box.y+L.state.box.h/2)
const longToggle=scenes.find(s=>s.label==='SOURCE POWER'),labelBottom=Math.max(...longToggle.strokes.filter(s=>s.role==='label').flatMap(s=>s.lines.flat().map(p=>p[1]))),iconTop=Math.min(...longToggle.strokes.filter(s=>s.role==='glyph').flatMap(s=>s.lines.flat().map(p=>p[1])));assert(iconTop>labelBottom+1,'two-line title must not overlap toggle icon');
assert.equal(L.state.width,1.8);assert.equal(L.border.on.width,3);assert.equal(L.border.off.width,1)
assert.equal(L.selection.points[0][1],L.selection.points[1][1]);assert.equal(L.selection.points[2][1],L.selection.points[3][1])
// Existing bitmap and new shared font use exactly the same primitive letter points.
for(const label of ['ABCXYZ','0123456789','ON','OFF','BYPASS','+ - / % : .']){
 const a=D.surface(220,40),b=D.surface(220,40)
 D.text(a,label,110,20,'#ffffff',{cap:11,maxW:Infinity,width:1.4});D.stroke(b,textLines(label,110,20,11),'#ffffff',1.4)
 assert.deepEqual(D.toRgb565(a),D.toRgb565(b),'font drift: '+label)
}
let labels=0,controls=0
const root=new URL('../config/profiles/',import.meta.url)
for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.json'))){const original=fs.readFileSync(new URL(file,root),'utf8'),p=JSON.parse(original)
 for(let i=0;i<p.pages.length;i++) {const page=pageOf(p,i);assert.equal(displayText(page.name),String(page.name||'').toUpperCase(),'unsupported page glyph');for(const d of Object.values(page.dials||{})){if(d.unit)assert.equal(displayText(d.unit),d.unit.toUpperCase(),'unsupported unit glyph')} 
  for(const key of Object.values(page.keys||{})){const scene=keyScene({kind:'plain'},{label:key.label,control:key,iconLines:D.currentGlyphLines(key.icon)||[]});for(const line of scene.labelLines){assert(textWidth(line,L.title.cap)<=L.title.maxWidth);labels++}controls++}
  for(const dial of Object.values(page.dials||{}))for(const t of dialLabelLines(dial.name||'')){assert(textWidth(t.text,t.cap)<=52.000001);labels++}
 }
 assert.equal(fs.readFileSync(new URL(file,root),'utf8'),original)
}
const output=process.env.CT_DISPLAY_RASTER==='1'?process.env.EDENA_ARTIFACTS_DIR:null
if(output){
 fs.mkdirSync(output,{recursive:true})
 const sharp=createRequire(process.env.CT_TEST_NODE_PACKAGE || import.meta.url)('sharp')
 const native=renderFeedbackKeys(D,fixtures)
 const nativePNG=D.rgb565ToPng(D.toRgb565(native),360,270)
 fs.writeFileSync(path.join(output,'key-native.png'),nativePNG)
 const views=fixtures.map(f=>keyView(f.feedback,{...f,iconLines:D.currentGlyphLines(f.glyph)}))
 for(let i=0;i<views.length;i++)assert.deepEqual(views[i].scene,scenes[i],'browser and device scene differ')
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="360" height="270" viewBox="0 0 360 270"><rect width="360" height="270" fill="'+D.INK.night+'"/>'+views.map((v,i)=>'<g transform="translate('+(i%4*90)+' '+(Math.floor(i/4)*90)+')">'+v.html.split('<span')[0].replace('<svg class=', '<svg width=\"90\" height=\"90\" class=')+'</g>').join('')+'</svg>'
 fs.writeFileSync(path.join(output,'key-browser.svg'),svg)
 await sharp(Buffer.from(svg)).png().toFile(path.join(output,'key-browser.png'))
 const a=await sharp(nativePNG).removeAlpha().raw().toBuffer(),b=await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer()
 let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);const mean=sum/a.length
 // SVG and distance-field rasterizers antialias differently; scene primitives must match exactly above.
 assert(mean<12,'raster disagreement beyond edge antialias: '+mean)
 const header=Buffer.from('<svg width="760" height="64"><rect width="760" height="64" fill="#10141c"/><text x="20" y="38" fill="white" font-size="20">Device bitmap</text><text x="400" y="38" fill="white" font-size="20">Browser SVG</text></svg>')
 await sharp({create:{width:760,height:344,channels:3,background:'#10141c'}}).composite([{input:header,left:0,top:0},{input:nativePNG,left:20,top:64},{input:path.join(output,'key-browser.png'),left:400,top:64}]).png().toFile(path.join(output,'KEY-PARITY.png'))
 fs.writeFileSync(path.join(output,'key-parity.json'),JSON.stringify({controls,labels,states:fixtures.map(f=>f.name),sharedSceneExact:true,strokeFontExact:true,rasterMeanAbsoluteError:mean,layout:L,boundary:'Offline source renderers only; no hardware or app acceptance'},null,2))
}
console.log('PASS key display parity: '+controls+' current-profile controls; '+labels+' label lines; true/false/stale/unavailable/selection, aliases, font identity, bounded geometry')

