import {COLORS} from '../host/schema.mjs'
import {keyScene,dialLabelLines} from './control-key-layout.mjs'
// Desktop counterpart of the CT's readback presentation. Never interprets values or changes bindings.
import {gaugeModel,keyModel,GAUGE_LAYOUT,gaugePoint,keyBindingKey} from './control-presentation.mjs'
export {keyBindingKey}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const clamp=value=>Math.max(0,Math.min(1,value))
const point=(norm,radius=GAUGE_LAYOUT.radius)=>{const [x,y]=gaugePoint(clamp(norm),radius);return{x,y}}
const number=value=>Number(value.toFixed(3))
const line=(a,b,cls)=>`<line class="${cls}" x1="${number(a.x)}" y1="${number(a.y)}" x2="${number(b.x)}" y2="${number(b.y)}"/>`
const arc=(from,to,cls)=>{const a=point(from),b=point(to);return `<path class="${cls}" d="M ${number(a.x)} ${number(a.y)} A ${GAUGE_LAYOUT.radius} ${GAUGE_LAYOUT.radius} 0 0 ${to>=from?0:1} ${number(b.x)} ${number(b.y)}"/>`}
function strip(model){
 const position=model.position
 if(position===null||!Number.isFinite(position))return ''
 const zero=model.range?.min<0&&model.range?.max>0?model.range.zero:null, origin=typeof zero==='number'?zero:0
 const start=Math.min(origin,position),width=Math.abs(position-origin)
 const ticks=(model.range?[{norm:0,major:true},{norm:1,major:true}]:[]).map(t=>`<b class="gauge-tick${t.major?' major':''}" style="left:${clamp(t.norm)*100}%"></b>`).join('')
 return `<span class="dial-position${zero!==null&&zero!==undefined?' bipolar':''}" aria-hidden="true"><i style="left:${start*100}%;width:${width*100}%"></i>${ticks}${zero!==null&&zero!==undefined?`<b class="gauge-zero" style="left:${clamp(zero)*100}%"></b>`:''}<b class="gauge-pointer" style="left:${clamp(position)*100}%"></b></span>`
}
function wheel(model,mapping){
 let ruler=''
 if(model.range){
   const range=model.range,ticks=range.ticks||[]
   ruler=arc(0,1,'gauge-track')+ticks.map(t=>line(point(t.norm,t.major?GAUGE_LAYOUT.majorInner:GAUGE_LAYOUT.minorInner),point(t.norm,GAUGE_LAYOUT.tickOuter),`gauge-tick${t.major?' major':''}`)).join('')
   const origin=typeof range.zero==='number'?range.zero:0
   if(model.position!==null){
     ruler+=arc(origin,model.position,'gauge-fill')
     const p=point(model.position);ruler+=`<circle class="gauge-pointer" cx="${number(p.x)}" cy="${number(p.y)}" r="4.5"/>`
   }
   if(range.min<0&&range.max>0&&typeof range.zero==='number')ruler+=line(point(range.zero,86),point(range.zero,107),'gauge-zero')
   for(const [norm,value]of [[0,range.min],[1,range.max]]){const p=point(norm,78);ruler+=`<text class="gauge-limit" x="${number(p.x-4)}" y="${number(p.y+4)}" text-anchor="end">${esc(value)}</text>`}
 }
 const value=model.valueText||model.text||'—',unit=model.unit||''
 return `<svg class="wheel-gauge${model.range?' ranged':''}" viewBox="0 0 240 240" aria-hidden="true">${ruler}${mapping?`<text class="dial-map" x="101" y="44" text-anchor="middle">${esc(mapping)}</text>`:''}<text class="dial-label" x="${GAUGE_LAYOUT.valueX}" y="${GAUGE_LAYOUT.labelY}" text-anchor="middle"${model.label.length>15?' textLength="145" lengthAdjust="spacingAndGlyphs"':''}>${esc(model.label)}</text><text class="dial-value${model.known?'':' unavailable'}" x="${GAUGE_LAYOUT.valueX}" y="${GAUGE_LAYOUT.valueY}" text-anchor="middle"${value.length>6?' textLength="145" lengthAdjust="spacingAndGlyphs"':''}>${esc(value)}</text>${unit?`<text class="gauge-unit" x="${GAUGE_LAYOUT.valueX}" y="${GAUGE_LAYOUT.unitY}" text-anchor="middle">${esc(unit)}</text>`:''}${!model.known?`<text class="gauge-status" x="${GAUGE_LAYOUT.valueX}" y="156" text-anchor="middle">NO READBACK</text>`:''}<text class="gauge-profile" x="${GAUGE_LAYOUT.valueX}" y="${GAUGE_LAYOUT.profileY}" text-anchor="middle"${model.profile.length>20?' textLength="140" lengthAdjust="spacingAndGlyphs"':''}>${esc(model.profile)}</text><text class="gauge-page" x="${GAUGE_LAYOUT.valueX}" y="${GAUGE_LAYOUT.pageY}" text-anchor="middle"${model.page.length>20?' textLength="140" lengthAdjust="spacingAndGlyphs"':''}>${esc(model.page)}</text></svg>`
}
export function gaugeView(reading,{kind='dial',mapping='',label='',profileName='',pageName=''}={}){
 const model=gaugeModel(reading,{profileName,pageName})
 // Label fallback is configured identity, not a guessed reading.
 const shown={...model,label:model.label||label}
 const html=kind==='wheel'?wheel(shown,mapping):`${dialLabelSvg(shown.label)}<span class="dial-value${model.known?'':' unavailable'}">${esc(model.text||'—')}</span>${strip(model)}`
 return {html,model,description:`${shown.label}: ${model.known?model.text:'value unavailable'}${profileName?` · ${profileName} / ${pageName}`:''}`}
}
const polylines=p=>p.lines.map(l=>`<polyline points="${l.map(v=>v.map(number).join(',')).join(' ')}"/>`).join('')
const strokeSvg=p=>`<g fill="none" stroke="${p.color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round">${polylines(p)}</g>`
function dialLabelSvg(label){return `<svg class="lb dial-label" viewBox="0 0 60 36" aria-hidden="true"><title>${esc(label)}</title>${dialLabelLines(label).map(p=>strokeSvg({...p,lines:p.lines.map(l=>l.map(([x,y])=>[x,y-6]))})).join('')}</svg>`}
export function keyView(reading,{label='',icon='',iconLines=[],control=null,color=COLORS.sand,active=false,dim=false,available=true}={}){
 const scene=keyScene(reading,{label,iconLines,control,color,active,dim,available}),model=scene.model,selection=model.kind==='selection'
 const selectionText=selection?(model.selected===true?'Selected recipe':model.selected===false?'Recipe not selected':'Recipe selection unavailable'):''
 const shapes=scene.rects.map(r=>`<rect class="key-${r.role}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.r}" fill="none" stroke="${r.color}" stroke-width="${r.width}"/>`).join('')
 const strokes=scene.strokes.map(p=>{const cls={label:'key-label',state:'key-state',glyph:'key-glyph',unknown:'key-unknown',selection:'key-selection'}[p.role]||'key-'+p.role;const title=p.role==='state'||p.role==='unknown'?`<title>${p.text==='-'?'—':esc(p.text)}</title>`:'';return `<g class="${cls}">${title}${p.role==='glyph'?'<svg viewBox="0 0 90 90" width="90" height="90">'+strokeSvg(p)+'</svg>':strokeSvg(p)}</g>`}).join('')
 const fallback=icon&&!iconLines.length?`<svg x="25" y="${scene.toggle?26:35}" width="40" height="${scene.toggle?18:40}" viewBox="0 0 32 32">${icon}</svg>`:''
 const html=`<svg class="key-display" viewBox="0 0 90 90" aria-hidden="true" data-state="${scene.state}"><title class="lb">${esc(scene.label)}</title><rect width="90" height="90" fill="${scene.face}"/><g opacity="${scene.opacity}">${shapes}${strokes}${fallback}</g></svg>${selectionText?'<span class="key-feedback-text">'+selectionText+'</span>':''}`
 return {html,model,scene,description:[scene.label,scene.state==='unavailable'?'unavailable':'',scene.toggle?(model.enabled===true?'ON':model.enabled===false?'OFF':'value unavailable'):'',selectionText].filter(Boolean).join(', ')}
}
