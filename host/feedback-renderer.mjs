import {keyScene,dialLabelLines} from '../ui/control-key-layout.mjs'
// Pure native drawing using the same presentation model as the desktop preview.
import {gaugeModel,gaugePoint,GAUGE_LAYOUT as G} from '../ui/control-presentation.mjs'
const bone='#f1e9da', quiet='#8f879f', rail='#414858', selectedColor='#e8a9b8'
const tint=(c,b='#14121d')=>'#'+[1,3,5].map(i=>Math.round(parseInt(b.slice(i,i+2),16)*.82+parseInt(c.slice(i,i+2),16)*.18).toString(16).padStart(2,'0')).join('')
const line=(D,s,a,b,c,w=1)=>D.stroke(s,[[a,b]],c,w)
const text=(D,s,t,x,y,cap=10,c=bone,maxW=130)=>D.text(s,String(t).replaceAll('—','-'),x,y,c,{cap,maxW,width:cap>18?1.8:1.2})
const arc=(D,s,a,b,c,w)=>D.stroke(s,[Array.from({length:65},(_,i)=>gaugePoint(a+(b-a)*i/64))],c,w)
export function renderFeedbackWheel(D,reading,{color='#81cedb',skin,profileName='',pageName=''}={}) {
 const s=D.surface(240,240,skin?.tile),m=gaugeModel(reading,{profileName,pageName})
 if(reading?.homeDetail){text(D,s,'BROWSE / SELECT',120,48,10,color,190);const words=String(reading.homeDetail).split(/\s+/),lines=[''];for(const word of words){if((lines.at(-1)+' '+word).trim().length>24)lines.push(word);else lines[lines.length-1]=(lines.at(-1)+' '+word).trim();}lines.slice(0,4).forEach((l,i)=>text(D,s,l,120,82+i*23,10,bone,205));text(D,s,reading.text,120,200,12,color,180);return s}
 if(!reading){text(D,s,profileName,120,104,16,color,190);text(D,s,pageName,120,140,10,quiet,190);return s}
 text(D,s,m.label||'WHEEL',G.valueX,G.labelY,11,color)
 text(D,s,m.valueText,G.valueX,G.valueY,32,bone,132)
 if(m.unit)text(D,s,m.unit,G.valueX,G.unitY,12,quiet,110)
 text(D,s,m.profile,G.valueX,G.profileY,8,quiet,122)
 text(D,s,m.page,G.valueX,G.pageY,7,quiet,110)
 if(!m.known)text(D,s,'NO READBACK',G.valueX,154,7,quiet,120)
 const r=m.range
 if(r){
  arc(D,s,0,1,rail,2);arc(D,s,Math.min(r.zero,r.norm),Math.max(r.zero,r.norm),color,4)
  for(const t of r.ticks)line(D,s,gaugePoint(t.norm,t.major?G.majorInner:G.minorInner),gaugePoint(t.norm,G.tickOuter),t.major?bone:quiet,t.major?2:1)
  if(r.zero>0)line(D,s,gaugePoint(r.zero,84),gaugePoint(r.zero,108),selectedColor,2)
  D.dot(s,...gaugePoint(r.norm),5,bone)
  text(D,s,String(r.min),140,203,9,quiet,70);text(D,s,String(r.max),140,36,9,quiet,70)
 }
 return s
}
export function renderFeedbackStrip(D,readings,{color='#81cedb',skin}={}) {
 const s=D.surface(60,270,skin?.tile)
 readings.forEach((reading,i)=>{
  const m=gaugeModel(reading),y=i*90
  if(!m.label && !m.known)return
  for(const t of dialLabelLines(m.label))D.stroke(s,t.lines.map(l=>l.map(([x,v])=>[x,y+v])),t.color,t.width);text(D,s,m.text,30,y+48,9,bone,52)
  line(D,s,[9,y+68],[51,y+68],rail,5)
  const n=m.position
  if(n===null){line(D,s,[25,y+68],[35,y+68],quiet,2);return}
  const zero=m.range?.zero||0
  line(D,s,[9+42*zero,y+68],[9+42*n,y+68],color,5)
  for(const x of [9,51])line(D,s,[x,y+64],[x,y+72],quiet,1)
  if(zero>0)line(D,s,[9+42*zero,y+62],[9+42*zero,y+74],selectedColor,1.5)
  line(D,s,[9+42*n,y+62],[9+42*n,y+74],bone,2)
 })
 return s
}
export function renderFeedbackKeys(D,keys,skin) {
 const s=D.surface(360,270,skin?.deep)
 keys.forEach((k,i)=>{
  if(!k)return
  const x=(i%4)*90,y=Math.floor(i/4)*90,scene=keyScene(k.feedback,{...k,iconLines:(D.currentGlyphLines||D.glyphLines)(k.glyph)||[]})
  const tile=D.surface(90,90,scene.face)
  for(const r of scene.rects)D.roundRect(tile,r.x,r.y,r.w,r.h,r.r,r.color,r.width,scene.opacity)
  for(const p of scene.strokes)D.stroke(tile,p.lines,p.color,p.width,scene.opacity)
  for(let row=0;row<90;row++)s.px.set(tile.px.subarray(row*270,(row+1)*270),((y+row)*360+x)*3)
 })
 return s
}
