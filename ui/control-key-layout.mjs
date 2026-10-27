import {COLORS,CONTROL_DISPLAY_COLORS as C} from '../host/schema.mjs'
// Pure shared key scene: 90px device tiles and desktop SVG consume these same primitives.
import {fitLabel,textLines,textWidth} from './control-font.mjs'
import {keyModel} from './control-presentation.mjs'
export const KEY_STATE_LAYOUT=Object.freeze({size:90,face:C.face,ink:C.ink,quiet:C.quiet,title:{cap:11,width:1.4,maxWidth:76,y:15,rows:[12,27]},dialTitle:{cap:7.5,width:1.2,maxWidth:52,y:24,rows:[16,30]},border:{x:3,y:3,w:84,h:84,r:6,on:{color:C.on,width:3},off:{color:C.off,width:1},unknown:{color:C.quiet,width:1.4},unavailable:{color:C.unavailable,width:1.4},plain:{color:C.plain,width:1.4}},icon:{x:45,y:35,extent:9,twoLineY:40,twoLineExtent:5},state:{x:45,y:63,cap:16,width:1.8,box:{x:20,y:47,w:50,h:32,r:11}},selection:{color:C.selection,width:2.5,points:[[16,45],[9,45],[9,78],[16,78]]}})
export function keyDisplayLabel(label,control){
 const action=control?.do,upper=String(control?.label??label??'').trim().toUpperCase()
 if(action?.moshpit?.verb==='toggle'&&action.moshpit.param==='bypass'&&['','ON / OFF','ON/OFF','ENABLE','BYPASS'].includes(upper))return 'BYPASS'
 if(action?.td?.type==='rigPulse'&&action.td.par==='Defaultsmear'&&upper==='DEFAULTS')return 'PARAM RESET'
 return label
}
export function keyScene(reading,{label='',control=null,iconLines=[],color=COLORS.sand,active=false,dim=false,available=true}={}){
 const L=KEY_STATE_LAYOUT,m=keyModel(reading),unavailable=!available||control?.do?.none===true,toggle=m.kind==='toggle'||m.kind==='selection'&&typeof m.enabled==='boolean'
 const state=unavailable?'unavailable':toggle?(m.enabled===true?'on':m.enabled===false?'off':'unknown'):'plain'
 const border=L.border[state],rects=[{...L.border,color:border.color,width:border.width,role:'border'}],strokes=[]
 const labelText=keyDisplayLabel(label,control)||(unavailable?'UNAVAIL.':''),title=fitLabel(labelText,L.title)
 const addText=(value,x,y,cap,width,c,role)=>strokes.push({role,text:value,lines:textLines(value,x,y,cap),width,color:c})
 title.forEach((t,i)=>addText(t,45,title.length===1?L.title.y:L.title.rows[i],L.title.cap,L.title.width,unavailable?L.quiet:L.ink,'label'))
 if(unavailable)addText('-',45,55,16,1.8,L.quiet,'unavailable')
 else {
  const extent=toggle?(title.length>1?L.icon.twoLineExtent:L.icon.extent):20,cy=toggle?(title.length>1?L.icon.twoLineY:L.icon.y):title.length===1?55:59
  const bound=Math.max(1,...iconLines.flat().flatMap(([u,v])=>[Math.abs(u),Math.abs(v)])),scale=extent/bound
  if(iconLines.length)strokes.push({role:'glyph',lines:iconLines.map(line=>line.map(([u,v])=>[45+u*scale,cy+v*scale])),width:1.5,color:toggle?(state==='on'?L.border.on.color:L.quiet):color})
  if(toggle){rects.push({...L.state.box,color:border.color,width:1,role:'state-box'});addText(m.enabled===true?'ON':m.enabled===false?'OFF':'-',L.state.x,L.state.y,L.state.cap,L.state.width,state==='unknown'?L.quiet:L.ink,'state')}
  if(m.kind==='selection'&&m.selected===null)addText('-',75,78,8,1.2,L.quiet,'unknown')
  if(m.selected===true)strokes.push({role:'selection',lines:[L.selection.points],width:L.selection.width,color:L.selection.color})
  else if(active&&m.kind==='plain')strokes.push({role:'active',lines:[[[74,76],[77,79],[82,72]]],width:2,color:L.ink})
 }
 return {size:L.size,face:L.face,rects,strokes,model:m,toggle,state,label:labelText,labelLines:title,opacity:dim?.55:1}
}
export function dialLabelLines(label){
 const L=KEY_STATE_LAYOUT.dialTitle
 // Keep single-word controls such as TRANSPOSE whole, with a readable lower size bound.
 const cap=/\s/.test(String(label))?L.cap:Math.max(6,Math.min(L.cap,L.cap*(L.maxWidth-.5)/(textWidth(label,L.cap)||1)))
 return fitLabel(label,{...L,cap}).map((s,i,all)=>({text:s,cap,lines:textLines(s,30,all.length===1?L.y:L.rows[i],cap),width:L.width,color:KEY_STATE_LAYOUT.ink}))
}
