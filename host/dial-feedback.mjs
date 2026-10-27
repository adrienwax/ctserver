// One presentation model for both the physical displays and desktop CT view.
import { ctResolve, BANKS } from './moshpit-client.mjs'

const positions = ['TL', 'CL', 'BL', 'TR', 'CR', 'BR']
const pairs = new Map([
  ['mark.in.nudgeBack|mark.in.nudgeForward', 'in'], ['mark.out.nudgeBack|mark.out.nudgeForward', 'out'],
  ['mark.range.nudgeBack|mark.range.nudgeForward', 'transpose'], ['clip.prev|clip.next', 'clip'],
  ['folder.prev|folder.next', 'folder'], ['source.zoomOut|source.zoomIn', 'zoom'],
  ['transport.prevFrame|transport.nextFrame', 'frame'],
  ['block.prev|block.next', 'block'],
])
const bounded = (n) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null
const unavailable = (label = '') => ({ label, text: label ? '—' : '', norm: null, available: false })

export function formatParameter(param, value) {
  if (!param || value === undefined || value === null) return null
  if (param.type === 'bool') return typeof value === 'boolean' ? (value ? 'On' : 'Off') : null
  if (param.type === 'enum') return (param.options || []).includes(String(value)) ? String(value) : null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (param.unit === '%') {
    const magnitude = Math.abs(value)
    if (magnitude > 0 && magnitude < 0.0001) return value < 0 ? '>−0.0001%' : '<0.0001%'
    return `${Number(magnitude > 0 && magnitude < 1 ? value.toPrecision(2) : value.toFixed(1))}%`
  }
  // Keep fine-mode substeps visible, even when a parameter's normal detent is 1.
  const step = Number(param.step)
  const [mantissa, exponent = '0'] = String(step).toLowerCase().split('e')
  const stepDecimals = step > 0 && Number.isFinite(step) ? Math.max(0, (mantissa.split('.')[1]?.length || 0) - Number(exponent)) : 2
  const precision = param.type === 'int' ? 0 : Math.min(6, Math.max(4, stepDecimals + 1))
  const text = String(Number(value.toFixed(precision)))
  return `${text}${param.unit ? ` ${param.unit}` : param.type === 'beats' ? ' beats' : ''}`
}

function presentation(param,value,{contextId='',coordinateSpace=null,valueRole=null}={}) {
  const numeric=typeof value==='number'&&Number.isFinite(value)
  const kind=param?.type==='int'?'integer':numeric?'continuous':'text'
  const percent=param?.unit==='%', magnitude=Math.abs(value)
  const valueText=percent&&numeric ? (magnitude>0&&magnitude<0.0001?(value<0?'>−0.0001':'<0.0001'):String(Number(magnitude>0&&magnitude<1?value.toPrecision(2):value.toFixed(1)))) : formatParameter({...param,type:param?.type==='beats'?'float':param?.type,unit:''},value)
  const bounds=numeric&&Number.isFinite(param?.min)&&Number.isFinite(param?.max)&&param.max>param.min
  return {state:'confirmed',kind,value:numeric?value:null,valueText,unit:param?.unit || (param?.type==='beats'?'beats':''),
    min:bounds?param.min:null,max:bounds?param.max:null,scale:bounds?'linear':null,
    default:Number.isFinite(param?.initial??param?.default)?(param.initial??param.default):null,contextId,coordinateSpace,valueRole}
}
export function dialFeedback({ page = {}, client = null, nativeClient = null, selection = 1, bank = 0, tdState = null, tdOk = false, contextId='' } = {}) {
  const snapshot = {}
  function one(dial) {
    if (!dial) return unavailable()
    let label = dial.name || ''
    if(dial.turn?.native){
      const p=nativeClient?.parameter(dial.turn.native)
      if(!p||p.available===false)return unavailable(label)
      const text=formatParameter(p,p.value)
      return {label:p.label||label,text,norm:typeof p.value==='number'?(p.value-p.min)/(p.max-p.min):null,available:true,presentation:presentation(p,p.value,{contextId:nativeClient.state().contextId,valueRole:'app'})}
    }
    const action = dial.turn?.moshpit
    if (action) {
      if (!client?.connected()) return unavailable(label)
      const state = client.state()
      if (action.verb === 'bank') return { label, text: BANKS[bank] || BANKS[0], norm: bank / (BANKS.length - 1), available: true }
      if (action.verb === 'selstep') {
        const text = client.slotName(selection)
        return text ? { label, text, norm: state.slots.length > 1 ? (selection - 1) / (state.slots.length - 1) : null, available: true } : unavailable(label)
      }
      if (action.verb === 'knob') {
        const resolved = ctResolve(action, selection, bank)
        if (!resolved) return unavailable()
        label = client.label(resolved) || label
        const reading = client.reading(resolved)
        if (action.bankWidth === 6 && !reading) return unavailable()
        const text = reading && formatParameter(reading.param, reading.value)
        return text !== null && text !== undefined ? { label, text, norm: bounded(reading.norm), available: true, presentation:presentation(reading.param,reading.value,{contextId,valueRole:'base'}) } : unavailable(label)
      }
      const key = action.verb === 'step' && pairs.get((action.commands || []).join('|'))
      const feedback = state.feedback
      const value = key && feedback?.workspace === state.workspace && (['frame', 'block'].includes(key) || feedback.workspace === 'browse') && feedback.values[key]
      return value ? { label, text: value.text, norm: bounded(value.norm), available: true } : unavailable(label)
    }
    const td = dial.turn?.td
    if (td?.type === 'rigFrameStep' && tdOk) {
      const frame=tdState?.values?.Currentframe, count=tdState?.values?.Framecount
      return Number.isFinite(frame) && Number.isFinite(count) && count>1 ? {label,text:`${Math.round(frame)} f`,norm:bounded(frame/(count-1)),available:true,presentation:presentation({type:'int',unit:'f',min:0,max:count-1},frame,{contextId,coordinateSpace:'source-frame'})} : unavailable(label)
    }
    if (td?.type === 'rigKnob' && tdOk) {
      const value=tdState?.values?.[td.par], norm=bounded(tdState?.norm?.[td.par]), meta=tdState?.ranges?.[td.par]
      const param={type:tdState?.types?.[td.par]==='Int'?'int':'float',unit:dial.unit??'',step:0.01,
        ...(meta?.scale==='linear'?{min:meta.min,max:meta.max,default:meta.default}:{})}
      const text=formatParameter(param,value)
      return text!==null ? {label,text,norm,available:true,presentation:presentation(param,value,{contextId})} : unavailable(label)
    }
    // A normalized position is not a raw value or a percent unit.
    return unavailable(label)
  }
  const entry = (dial) => { const reading=one(dial); return {...reading,presentation:reading.presentation??{state:reading.available?'confirmed':'unavailable',kind:'text',contextId},bindingKey:JSON.stringify(dial?.turn??null)} }
  for (const position of positions) snapshot[position] = entry(page.dials?.[position])
  if (page.wheel) snapshot.wheel = entry({ ...page.wheel, name: page.wheel.name || (page.wheel.turn?.moshpit ? 'FRAME' : 'WHEEL') })
  return snapshot
}
