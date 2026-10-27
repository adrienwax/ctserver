// Pure shared display model. No device, browser, network or formatting inference.
const finite = n => typeof n === 'number' && Number.isFinite(n)
const clamp = n => Math.max(0, Math.min(1, n))
export const GAUGE_LAYOUT = Object.freeze({cx:120,cy:120,radius:100,majorInner:88,minorInner:94,tickOuter:105,valueX:95,valueY:107,labelY:66,unitY:138,profileY:174,pageY:190})
export function gaugePoint(norm, radius=GAUGE_LAYOUT.radius) {
  const angle=(70-140*norm)*Math.PI/180
  return [120+radius*Math.cos(angle),120+radius*Math.sin(angle)]
}
export function gaugeModel(reading, {profileName='',pageName=''}={}) {
  const p=reading?.presentation
  const state=p?.state || (reading?.available ? 'confirmed' : 'unavailable')
  const known=!!reading?.available && state==='confirmed' && typeof reading.text==='string' && !!reading.text.trim()
  const numeric=known && finite(p?.value)
  let range=null
  if(numeric && p.scale==='linear' && finite(p.min) && finite(p.max) && p.max>p.min) {
    const width=p.max-p.min, ticks=[], used=new Set()
    for(let i=0;i<=20;i++) {
      const value=p.kind==='integer' ? Math.round(p.min+width*i/20) : p.min+width*i/20
      const key=String(value), major=i%5===0
      if(used.has(key)) {if(major){const previous=ticks.find(t=>t.value===value);previous.major=true}continue}
      used.add(key);ticks.push({value,norm:clamp((value-p.min)/width),major})
    }
    range={min:p.min,max:p.max,norm:clamp((p.value-p.min)/width),zero:p.min<0&&p.max>0?clamp(-p.min/width):0,ticks}
  }
  return {label:reading?.label || '',text:known?reading.text:'—',
    valueText:known ? (typeof p?.valueText==='string' && p.valueText.trim()?p.valueText:reading.text) : '—',
    unit:known && typeof p?.valueText==='string' && typeof p?.unit==='string' ? p.unit : '',
    known,state,profile:profileName,page:pageName,range,
    position:known ? (range?.norm ?? (finite(reading.norm)?clamp(reading.norm):null)) : null,
    contextId:p?.contextId || null,coordinateSpace:p?.coordinateSpace || null}
}
export function keyModel(reading) {
  const kind=['toggle','selection','momentary'].includes(reading?.kind)?reading.kind:'plain'
  const state=reading?.state || 'unavailable', known=state==='confirmed'
  return {kind,state,enabled:known&&typeof reading?.enabled==='boolean'?reading.enabled:null,
    selected:known&&typeof reading?.selected==='boolean'?reading.selected:null}
}// Display state is part of the binding: an edited state condition must reject old feedback.
export const keyBindingKey = key => JSON.stringify([key?.do??null,key?.state??null])
